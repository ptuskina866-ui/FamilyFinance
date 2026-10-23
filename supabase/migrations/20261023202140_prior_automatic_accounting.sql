-- Explicit owner opt-in; backend jobs never retain passwords or user JWTs.
BEGIN;
ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS import_origin TEXT CHECK(import_origin IS NULL OR import_origin='prior-auto');
CREATE TABLE IF NOT EXISTS public.prior_automation (
  owner_id UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  household_id UUID NOT NULL REFERENCES public.households(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES public.accounts(id),
  source_key TEXT NOT NULL CHECK(source_key ~ '^[a-f0-9]{64}$'),
  enabled BOOLEAN NOT NULL DEFAULT false,
  started_on DATE NOT NULL DEFAULT (now() AT TIME ZONE 'Europe/Minsk')::date,
  revision UUID NOT NULL DEFAULT gen_random_uuid(),
  last_checked_at TIMESTAMPTZ, last_attempt_at TIMESTAMPTZ,
  next_run_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  issue TEXT CHECK(issue IN ('network','bank_limit','reauth','history_changed','gap','account','format')),
  imported_count INT NOT NULL DEFAULT 0 CHECK(imported_count>=0),
  additional_count INT NOT NULL DEFAULT 0 CHECK(additional_count>=0)
);
CREATE INDEX IF NOT EXISTS prior_automation_household ON public.prior_automation(household_id);
CREATE TABLE IF NOT EXISTS public.prior_automation_reviews (
  owner_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  household_id UUID NOT NULL REFERENCES public.households(id) ON DELETE CASCADE,
  source_key TEXT NOT NULL, event_key TEXT NOT NULL,
  day DATE NOT NULL, description TEXT NOT NULL, amount NUMERIC(12,2) NOT NULL,
  reason TEXT NOT NULL CHECK(reason IN ('similar','transfer')), ignored BOOLEAN NOT NULL DEFAULT false,
  PRIMARY KEY(owner_id,source_key,event_key)
);
CREATE INDEX IF NOT EXISTS prior_automation_reviews_household ON public.prior_automation_reviews(household_id);
DO $$ DECLARE tab TEXT; action TEXT;
BEGIN
  FOREACH tab IN ARRAY ARRAY['prior_automation','prior_automation_reviews'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',tab);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated',tab);
    EXECUTE format('GRANT SELECT ON public.%I TO authenticated',tab);
    FOREACH action IN ARRAY ARRAY['SELECT','INSERT','UPDATE','DELETE'] LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I',tab||'_'||lower(action),tab);
      EXECUTE format('CREATE POLICY %I ON public.%I FOR %s TO authenticated %s',tab||'_'||lower(action),tab,action,
        CASE WHEN action='INSERT' THEN 'WITH CHECK(household_id=(SELECT public.get_my_household_id()) AND owner_id=(SELECT auth.uid()))'
        WHEN action='UPDATE' THEN 'USING(household_id=(SELECT public.get_my_household_id()) AND owner_id=(SELECT auth.uid())) WITH CHECK(household_id=(SELECT public.get_my_household_id()) AND owner_id=(SELECT auth.uid()))'
        ELSE 'USING(household_id=(SELECT public.get_my_household_id()) AND owner_id=(SELECT auth.uid()))' END);
    END LOOP;
    IF NOT EXISTS(SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename=tab) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I',tab);
    END IF;
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.set_prior_automation(p_enabled BOOLEAN,p_account_id UUID DEFAULT NULL,p_source_key TEXT DEFAULT NULL)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE h UUID; c finance_private.prior_connections;
BEGIN
  h:=public.finance_household_lock();
  PERFORM pg_advisory_xact_lock(hashtextextended('prior-connection:'||auth.uid()::text,0));
  IF p_enabled IS NULL THEN RAISE EXCEPTION 'PRIOR_AUTO_INPUT'; END IF;
  IF NOT p_enabled THEN
    UPDATE public.prior_automation SET enabled=false,revision=gen_random_uuid() WHERE owner_id=auth.uid() AND household_id=h;
    RETURN;
  END IF;
  SELECT * INTO c FROM finance_private.prior_connections WHERE owner_id=auth.uid() AND household_id=h;
  IF c.secret_id IS NULL THEN RAISE EXCEPTION 'PRIOR_AUTO_SESSION'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.accounts WHERE id=p_account_id AND household_id=h AND kind='bank' AND currency='BYN' AND NOT is_archived)
    OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(c.preview->'cards') s WHERE s->'card'->>'sourceKey'=p_source_key AND s->'card'->>'currency'='BYN') THEN RAISE EXCEPTION 'PRIOR_AUTO_ACCOUNT'; END IF;
  IF EXISTS(SELECT 1 FROM public.prior_import_sources WHERE household_id=h AND ((source_key=p_source_key AND (account_id<>p_account_id OR owner_id<>auth.uid())) OR (account_id=p_account_id AND source_key<>p_source_key))) THEN RAISE EXCEPTION 'PRIOR_SOURCE_BOUND'; END IF;
  IF EXISTS(SELECT 1 FROM public.prior_automation WHERE owner_id=auth.uid() AND (household_id<>h OR source_key<>p_source_key OR account_id<>p_account_id)) THEN RAISE EXCEPTION 'PRIOR_SOURCE_BOUND'; END IF;
  INSERT INTO public.prior_import_sources(household_id,owner_id,source_key,account_id) VALUES(h,auth.uid(),p_source_key,p_account_id) ON CONFLICT DO NOTHING;
  UPDATE finance_private.prior_connections SET selected_source=p_source_key WHERE owner_id=auth.uid();
  INSERT INTO public.prior_automation(owner_id,household_id,account_id,source_key,enabled) VALUES(auth.uid(),h,p_account_id,p_source_key,true)
  ON CONFLICT(owner_id) DO UPDATE SET enabled=true,revision=gen_random_uuid(),next_run_at=now(),issue=NULL;
END $$;
REVOKE ALL ON FUNCTION public.set_prior_automation(BOOLEAN,UUID,TEXT) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.set_prior_automation(BOOLEAN,UUID,TEXT) TO authenticated;

-- Ignoring an exception is explicit and does not create or delete financial entries.
CREATE OR REPLACE FUNCTION public.ignore_prior_automation_review(p_event_key TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'PRIOR_AUTH'; END IF;
  UPDATE public.prior_automation_reviews SET ignored=true WHERE owner_id=auth.uid() AND household_id=public.get_my_household_id() AND event_key=p_event_key;
END $$;
REVOKE ALL ON FUNCTION public.ignore_prior_automation_review(TEXT) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.ignore_prior_automation_review(TEXT) TO authenticated;

CREATE TABLE IF NOT EXISTS finance_private.prior_auto_tickets(token_hash TEXT PRIMARY KEY,expires_at TIMESTAMPTZ NOT NULL);
ALTER TABLE finance_private.prior_auto_tickets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON finance_private.prior_auto_tickets FROM PUBLIC,anon,authenticated;
CREATE OR REPLACE FUNCTION public.claim_prior_auto_job(p_ticket TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE owners JSONB;
BEGIN
  IF coalesce(p_ticket,'') !~ '^[a-f0-9]{64}$' THEN RETURN NULL; END IF;
  DELETE FROM finance_private.prior_auto_tickets WHERE token_hash=encode(sha256(convert_to(p_ticket,'UTF8')),'hex') AND expires_at>now();
  IF NOT FOUND THEN RETURN NULL; END IF;
  WITH due AS (
    SELECT a.owner_id FROM public.prior_automation a
    JOIN public.profiles p ON p.id=a.owner_id AND p.household_id=a.household_id
    JOIN finance_private.prior_connections c ON c.owner_id=a.owner_id AND c.household_id=a.household_id AND c.secret_id IS NOT NULL
    WHERE a.enabled AND a.next_run_at<=now() ORDER BY a.next_run_at LIMIT 2 FOR UPDATE OF a SKIP LOCKED
  ), claimed AS (
    UPDATE public.prior_automation a SET last_attempt_at=now(),next_run_at=now()+interval '5 minutes' FROM due WHERE a.owner_id=due.owner_id RETURNING a.owner_id,a.revision,a.source_key,a.last_checked_at,a.started_on
  ) SELECT coalesce(jsonb_agg(to_jsonb(claimed)),'[]') INTO owners FROM claimed;
  RETURN owners;
END $$;
REVOKE ALL ON FUNCTION public.claim_prior_auto_job(TEXT) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_prior_auto_job(TEXT) TO service_role;

CREATE OR REPLACE FUNCTION finance_private.prepare_prior_automatic(h UUID, a UUID, s JSONB, p_owner UUID)
RETURNS JSONB LANGUAGE plpgsql SET search_path='' AS $$
DECLARE r JSONB; c JSONB; rows JSONB; days JSONB; imported JSONB; possible JSONB; source TEXT;
  d DATE; first_day DATE; last_day DATE; closed_before DATE; today DATE := (now() AT TIME ZONE 'Europe/Minsk')::date;
BEGIN
  IF p_owner IS NULL OR NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=p_owner AND household_id=h) THEN RAISE EXCEPTION 'PRIOR_AUTH'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.accounts WHERE id=a AND household_id=h AND NOT is_archived AND currency='BYN' AND kind='bank') THEN RAISE EXCEPTION 'PRIOR_ACCOUNT'; END IF;
  IF s IS NULL OR jsonb_typeof(s)<>'object' OR octet_length(s::text)>8000000
    OR s->>'format' IS DISTINCT FROM 'finapp-prior' OR s->'version' IS DISTINCT FROM '1'::jsonb
    OR EXISTS(SELECT 1 FROM jsonb_object_keys(s) k WHERE k NOT IN ('format','version','from','to','fetchedAt','card')) THEN RAISE EXCEPTION 'PRIOR_FORMAT'; END IF;
  IF coalesce(s->>'from','') !~ '^\d{4}-\d{2}-\d{2}$' OR coalesce(s->>'to','') !~ '^\d{4}-\d{2}-\d{2}$' THEN RAISE EXCEPTION 'PRIOR_PERIOD'; END IF;
  first_day:=(s->>'from')::date; last_day:=(s->>'to')::date;
  IF first_day>last_day OR last_day>today OR last_day-first_day>30 THEN RAISE EXCEPTION 'PRIOR_PERIOD'; END IF;
  IF coalesce(s->>'fetchedAt','') !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$' THEN RAISE EXCEPTION 'PRIOR_PERIOD'; END IF;
  closed_before:=((s->>'fetchedAt')::timestamptz AT TIME ZONE 'Europe/Minsk')::date;
  IF closed_before>today THEN RAISE EXCEPTION 'PRIOR_PERIOD'; END IF;
  c:=s->'card';
  IF jsonb_typeof(c) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'PRIOR_FORMAT'; END IF;
  source:=c->>'sourceKey';
  IF coalesce(source,'') !~ '^[a-f0-9]{64}$' OR c->>'currency' IS DISTINCT FROM 'BYN'
    OR coalesce(length(c->>'title'),0) NOT BETWEEN 1 AND 200 OR coalesce(c->>'maskedNumber','') !~ '^(•••• [0-9]{4}|Номер скрыт)$'
    OR EXISTS(SELECT 1 FROM jsonb_object_keys(c) k WHERE k NOT IN ('sourceKey','title','maskedNumber','currency','records')) THEN RAISE EXCEPTION 'PRIOR_FORMAT'; END IF;
  IF jsonb_typeof(c->'records') IS DISTINCT FROM 'array' OR jsonb_array_length(c->'records')>2000 THEN RAISE EXCEPTION 'PRIOR_ROWS'; END IF;
  IF EXISTS(SELECT 1 FROM public.prior_import_sources WHERE household_id=h AND source_key=source AND (owner_id<>p_owner OR account_id<>a)) THEN RAISE EXCEPTION 'PRIOR_SOURCE_BOUND'; END IF;
  IF EXISTS(SELECT 1 FROM public.prior_import_sources WHERE household_id=h AND account_id=a AND source_key<>source) THEN RAISE EXCEPTION 'PRIOR_ACCOUNT_BOUND'; END IF;
  -- Rolling windows retain all receipts; automatic jobs verify imported occurrences below.
  FOR r IN SELECT value FROM jsonb_array_elements(c->'records') LOOP
    IF jsonb_typeof(r)<>'object' THEN RAISE EXCEPTION 'PRIOR_ROW'; END IF;
    IF EXISTS(SELECT 1 FROM jsonb_object_keys(r) k WHERE k NOT IN ('date','description','accountAmount','operationAmount','operationCurrency','fee','source'))
      OR jsonb_typeof(r->'date') IS DISTINCT FROM 'string' OR coalesce(r->>'date','') !~ '^\d{4}-\d{2}-\d{2}' OR length(r->>'date')>80
      OR jsonb_typeof(r->'description') IS DISTINCT FROM 'string' OR length(r->>'description') NOT BETWEEN 1 AND 4000
      OR coalesce(r->>'source','') NOT IN ('history','additional') OR coalesce(r->>'operationCurrency','') !~ '^[A-Z]{3}$'
      OR jsonb_typeof(r->'operationAmount') IS DISTINCT FROM 'string' OR coalesce(r->>'operationAmount','') !~ '^-?(0|[1-9][0-9]{0,9})\.[0-9]{2}$'
      OR NOT (r ? 'accountAmount' AND r ? 'fee') THEN RAISE EXCEPTION 'PRIOR_ROW'; END IF;
    d:=left(r->>'date',10)::date;
    IF (r->>'source'='history' OR r->'accountAmount'<>'null'::jsonb) AND
      (jsonb_typeof(r->'accountAmount') IS DISTINCT FROM 'string' OR coalesce(r->>'accountAmount','') !~ '^-?(0|[1-9][0-9]{0,9})\.[0-9]{2}$') THEN RAISE EXCEPTION 'PRIOR_AMOUNT'; END IF;
    IF r->'fee'<>'null'::jsonb AND (jsonb_typeof(r->'fee') IS DISTINCT FROM 'string' OR coalesce(r->>'fee','') !~ '^-?(0|[1-9][0-9]{0,9})\.[0-9]{2}$') THEN RAISE EXCEPTION 'PRIOR_AMOUNT'; END IF;
  END LOOP;
  WITH eligible AS (
    SELECT (ordinality-1)::int AS idx, left(value->>'date',10) AS day,
      value->>'description' AS description, (value->>'accountAmount')::numeric AS amount,
      jsonb_build_array(value->>'date',value->>'description',(value->>'accountAmount')::numeric,
        (value->>'operationAmount')::numeric,value->>'operationCurrency',(value->>'fee')::numeric) AS canonical
    FROM jsonb_array_elements(c->'records') WITH ORDINALITY
    WHERE value->>'source'='history' AND left(value->>'date',10)::date BETWEEN first_day AND last_day
      AND left(value->>'date',10)::date<=least(closed_before,today) AND (value->>'accountAmount')::numeric<>0
  ), keyed AS (
    SELECT *, encode(sha256(convert_to(canonical::text,'UTF8')),'hex')||':'||row_number() OVER(PARTITION BY canonical ORDER BY idx) AS key FROM eligible
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object('index',idx,'day',day,'description',description,'amount',amount::text,'key',key,'canonical',canonical,'warningKey',encode(sha256(convert_to(jsonb_build_array(description,amount)::text,'UTF8')),'hex')) ORDER BY idx),'[]'::jsonb) INTO rows FROM keyed;
  SELECT coalesce(jsonb_agg(jsonb_build_object('day',day,'signature',signature)),'[]'::jsonb) INTO days FROM (
    SELECT day::date::text AS day, encode(sha256(convert_to(coalesce(string_agg((r.value->'canonical')::text,E'\n' ORDER BY (r.value->'canonical')::text),''),'UTF8')),'hex') AS signature
    FROM generate_series(first_day::timestamp,least(last_day,closed_before,today)::timestamp,interval '1 day') day
    LEFT JOIN jsonb_array_elements(rows) r(value) ON r.value->>'day'=day::date::text GROUP BY day
  ) daily;
  -- A changing day may append rows; every previously imported occurrence must remain.
  IF EXISTS(SELECT 1 FROM public.prior_import_days d,unnest(d.imported_keys) k
    WHERE d.household_id=h AND d.source_key=source AND d.day BETWEEN first_day AND last_day
    AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(rows) incoming WHERE incoming->>'key'=k)) THEN RAISE EXCEPTION 'PRIOR_DAY_CHANGED'; END IF;
  SELECT coalesce(jsonb_agg((row->>'index')::int),'[]'::jsonb) INTO imported
    FROM jsonb_array_elements(rows) row JOIN public.prior_import_days receipt
    ON receipt.household_id=h AND receipt.source_key=source AND receipt.day=(row->>'day')::date
    WHERE row->>'key'=ANY(receipt.imported_keys);
  SELECT coalesce(jsonb_agg((row->>'index')::int),'[]'::jsonb) INTO possible FROM jsonb_array_elements(rows) row
  WHERE EXISTS(SELECT 1 FROM public.prior_import_days old WHERE old.household_id=h AND old.source_key=source AND old.day<>(row->>'day')::date AND old.day<first_day AND abs(old.day-(row->>'day')::date)<=31 AND row->>'warningKey'=ANY(old.warning_keys));
  RETURN jsonb_build_object('rows',rows,'days',days,'source',source,'importedIndexes',imported,
    'possibleIndexes',possible,'linked',EXISTS(SELECT 1 FROM public.prior_import_sources WHERE household_id=h AND source_key=source));
END $$;

REVOKE ALL ON FUNCTION finance_private.prepare_prior_automatic(UUID,UUID,JSONB,UUID) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.complete_prior_auto_job(p_owner UUID,p_revision UUID,p_connection_revision UUID,p_snapshot JSONB DEFAULT NULL,p_categories JSONB DEFAULT '[]',p_issue TEXT DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET statement_timeout='15s' AS $$
DECLARE a public.prior_automation; c finance_private.prior_connections; h UUID; prepared JSONB; r JSONB; d JSONB; suggestion JSONB;
  n INT:=0; issue_code TEXT; v_amount NUMERIC; reason TEXT; today DATE:=(now() AT TIME ZONE 'Europe/Minsk')::date;
BEGIN
  SELECT household_id INTO h FROM public.profiles WHERE id=p_owner;
  IF h IS NULL THEN RETURN NULL; END IF;
  PERFORM 1 FROM public.households WHERE id=h FOR UPDATE;
  PERFORM pg_advisory_xact_lock(hashtextextended('prior-connection:'||p_owner::text,0));
  SELECT * INTO a FROM public.prior_automation WHERE owner_id=p_owner AND household_id=h FOR UPDATE;
  SELECT * INTO c FROM finance_private.prior_connections WHERE owner_id=p_owner AND household_id=h;
  IF a.owner_id IS NULL OR NOT a.enabled OR a.revision IS DISTINCT FROM p_revision OR c.revision IS DISTINCT FROM p_connection_revision OR c.secret_id IS NULL THEN RETURN NULL; END IF;
  IF p_issue IS NOT NULL THEN
    IF p_issue NOT IN ('network','bank_limit','reauth','format','account','busy') THEN RAISE EXCEPTION 'PRIOR_AUTO_INPUT'; END IF;
    UPDATE public.prior_automation SET issue=CASE WHEN p_issue='busy' THEN NULL ELSE p_issue END,next_run_at=now()+CASE WHEN p_issue='busy' THEN interval '2 minutes' WHEN p_issue='network' THEN interval '15 minutes' ELSE interval '1 hour' END WHERE owner_id=p_owner;
    RETURN jsonb_build_object('imported',0);
  END IF;
  BEGIN
    IF coalesce((a.last_checked_at AT TIME ZONE 'Europe/Minsk')::date,a.started_on)<today-30 THEN RAISE EXCEPTION 'PRIOR_AUTO_GAP'; END IF;
    IF NOT EXISTS(SELECT 1 FROM public.accounts WHERE id=a.account_id AND household_id=h AND NOT is_archived AND currency='BYN' AND kind='bank') THEN RAISE EXCEPTION 'PRIOR_AUTO_ACCOUNT'; END IF;
    IF p_snapshot->'card'->>'sourceKey' IS DISTINCT FROM a.source_key OR (p_snapshot->>'to')::date NOT BETWEEN today-1 AND today
      OR (p_snapshot->>'from')::date>greatest(a.started_on,today-30)
      OR (p_snapshot->>'fetchedAt')::timestamptz<now()-interval '5 minutes' THEN RAISE EXCEPTION 'PRIOR_AUTO_INPUT'; END IF;
    prepared:=finance_private.prepare_prior_automatic(h,a.account_id,p_snapshot,p_owner);
    IF jsonb_typeof(p_categories) IS DISTINCT FROM 'array' OR jsonb_array_length(p_categories)>2000 THEN RAISE EXCEPTION 'PRIOR_AUTO_INPUT'; END IF;
    FOR r IN SELECT value FROM jsonb_array_elements(prepared->'rows') LOOP
      IF (r->>'day')::date<a.started_on THEN CONTINUE; END IF;
      IF (prepared->'importedIndexes') @> jsonb_build_array((r->>'index')::int) THEN
        DELETE FROM public.prior_automation_reviews WHERE owner_id=p_owner AND source_key=a.source_key AND event_key=r->>'key';
        CONTINUE;
      END IF;
      IF EXISTS(SELECT 1 FROM public.prior_automation_reviews WHERE owner_id=p_owner AND source_key=a.source_key AND event_key=r->>'key' AND ignored) THEN CONTINUE; END IF;
      SELECT value INTO suggestion FROM jsonb_array_elements(p_categories) WHERE value->>'index'=r->>'index';
      IF suggestion IS NULL OR coalesce(suggestion->>'category','') !~ '^[a-z][a-z0-9-]{0,63}$' THEN RAISE EXCEPTION 'PRIOR_AUTO_INPUT'; END IF;
      v_amount:=(r->>'amount')::numeric; reason:=NULL;
      IF suggestion->>'category'='transfer' OR coalesce((suggestion->>'transfer')::boolean,false) THEN reason:='transfer';
      ELSIF (prepared->'possibleIndexes') @> jsonb_build_array((r->>'index')::int) OR EXISTS(
        SELECT 1 FROM public.transactions t WHERE t.household_id=h AND t.account_id=a.account_id AND t.kind='cashflow'
        AND t.import_origin IS DISTINCT FROM 'prior-auto' AND t.date=(r->>'day')::date AND t.amount=abs(v_amount) AND t.type=CASE WHEN v_amount<0 THEN 'expense' ELSE 'income' END
      ) THEN reason:='similar'; END IF;
      IF reason IS NOT NULL THEN
        INSERT INTO public.prior_automation_reviews(owner_id,household_id,source_key,event_key,day,description,amount,reason)
        VALUES(p_owner,h,a.source_key,r->>'key',(r->>'day')::date,r->>'description',v_amount,reason) ON CONFLICT DO NOTHING;
        CONTINUE;
      END IF;
      INSERT INTO public.transactions(household_id,added_by,type,amount,category_id,comment,date,kind,account_id,import_origin)
        VALUES(h,p_owner,CASE WHEN v_amount<0 THEN 'expense' ELSE 'income' END,abs(v_amount),suggestion->>'category',r->>'description',(r->>'day')::date,'cashflow',a.account_id,'prior-auto');
      SELECT value INTO d FROM jsonb_array_elements(prepared->'days') WHERE value->>'day'=r->>'day';
      INSERT INTO public.prior_import_days(household_id,owner_id,source_key,day,signature,imported_keys,warning_keys)
        VALUES(h,p_owner,a.source_key,(r->>'day')::date,d->>'signature',ARRAY[r->>'key'],ARRAY[r->>'warningKey'])
        ON CONFLICT(household_id,source_key,day) DO UPDATE SET signature=d->>'signature',imported_keys=array_append(public.prior_import_days.imported_keys,r->>'key'),warning_keys=array_append(public.prior_import_days.warning_keys,r->>'warningKey');
      n:=n+1;
    END LOOP;
    -- Keep manual review compatible with an append-only bank day, without erasing receipts.
    FOR d IN SELECT value FROM jsonb_array_elements(prepared->'days') LOOP
      UPDATE public.prior_import_days SET signature=d->>'signature' WHERE household_id=h AND source_key=a.source_key AND day=(d->>'day')::date;
    END LOOP;
    DELETE FROM public.prior_automation_reviews v WHERE v.owner_id=p_owner AND v.source_key=a.source_key
      AND v.day BETWEEN (p_snapshot->>'from')::date AND today AND NOT v.ignored
      AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(prepared->'rows') incoming WHERE incoming->>'key'=v.event_key);
    UPDATE public.prior_automation SET last_checked_at=now(),next_run_at=now()+interval '2 minutes',issue=NULL,imported_count=imported_count+n,
      additional_count=(SELECT count(*) FROM jsonb_array_elements(p_snapshot->'card'->'records') incoming WHERE incoming->>'source'='additional') WHERE owner_id=p_owner;
  EXCEPTION WHEN OTHERS THEN
    n:=0;
    issue_code:=CASE SQLERRM WHEN 'PRIOR_DAY_CHANGED' THEN 'history_changed' WHEN 'PRIOR_AUTO_GAP' THEN 'gap' WHEN 'PRIOR_AUTO_ACCOUNT' THEN 'account' ELSE 'format' END;
    UPDATE public.prior_automation SET issue=issue_code,next_run_at='infinity' WHERE owner_id=p_owner;
  END;
  RETURN jsonb_build_object('imported',n,'issue',issue_code);
END $$;
REVOKE ALL ON FUNCTION public.complete_prior_auto_job(UUID,UUID,UUID,JSONB,JSONB,TEXT) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.complete_prior_auto_job(UUID,UUID,UUID,JSONB,JSONB,TEXT) TO service_role;

CREATE OR REPLACE FUNCTION finance_private.guard_prior_automation_connection()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF TG_OP='DELETE' OR NEW.household_id IS DISTINCT FROM OLD.household_id THEN
    DELETE FROM public.prior_automation_reviews WHERE owner_id=OLD.owner_id;
    DELETE FROM public.prior_automation WHERE owner_id=OLD.owner_id;
  ELSIF NEW.secret_id IS NULL THEN
    UPDATE public.prior_automation SET enabled=CASE WHEN NEW.reauth_required THEN enabled ELSE false END,
      issue=CASE WHEN NEW.reauth_required THEN 'reauth' ELSE NULL END,revision=gen_random_uuid(),next_run_at=now() WHERE owner_id=OLD.owner_id;
  ELSIF NEW.secret_id IS DISTINCT FROM OLD.secret_id THEN
    UPDATE public.prior_automation SET issue=NULL,next_run_at=now(),revision=gen_random_uuid() WHERE owner_id=OLD.owner_id;
  END IF;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION finance_private.guard_prior_automation_connection() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS guard_prior_automation_connection ON finance_private.prior_connections;
CREATE TRIGGER guard_prior_automation_connection AFTER UPDATE OF secret_id,household_id OR DELETE ON finance_private.prior_connections FOR EACH ROW EXECUTE FUNCTION finance_private.guard_prior_automation_connection();
NOTIFY pgrst,'reload schema';
COMMIT;
