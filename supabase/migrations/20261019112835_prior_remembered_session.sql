-- Remember only encrypted bank sessions, never passwords or Supabase user JWTs.
BEGIN;
CREATE TABLE IF NOT EXISTS finance_private.prior_connections (
  owner_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  household_id UUID NOT NULL REFERENCES public.households(id) ON DELETE CASCADE,
  revision UUID NOT NULL DEFAULT gen_random_uuid(),
  secret_id UUID,
  login_key TEXT CHECK(login_key ~ '^[a-f0-9]{64}$'),
  selected_source TEXT CHECK(selected_source ~ '^[a-f0-9]{64}$'),
  last_success_at TIMESTAMPTZ,
  reauth_required BOOLEAN NOT NULL DEFAULT false,
  preview JSONB,
  CHECK(preview IS NULL OR octet_length(preview::text)<=10000000)
);
CREATE INDEX IF NOT EXISTS prior_connections_household ON finance_private.prior_connections(household_id);
ALTER TABLE finance_private.prior_connections ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON finance_private.prior_connections FROM PUBLIC,anon,authenticated;
DO $$ DECLARE action TEXT;
BEGIN
  FOREACH action IN ARRAY ARRAY['SELECT','DELETE'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON finance_private.prior_connections','prior_connections_'||lower(action));
    EXECUTE format('CREATE POLICY %I ON finance_private.prior_connections FOR %s TO authenticated USING(household_id=(SELECT public.get_my_household_id()) AND owner_id=(SELECT auth.uid()))','prior_connections_'||lower(action),action);
  END LOOP;
  DROP POLICY IF EXISTS prior_connections_insert ON finance_private.prior_connections;
  CREATE POLICY prior_connections_insert ON finance_private.prior_connections FOR INSERT TO authenticated WITH CHECK(household_id=(SELECT public.get_my_household_id()) AND owner_id=(SELECT auth.uid()));
  DROP POLICY IF EXISTS prior_connections_update ON finance_private.prior_connections;
  CREATE POLICY prior_connections_update ON finance_private.prior_connections FOR UPDATE TO authenticated USING(household_id=(SELECT public.get_my_household_id()) AND owner_id=(SELECT auth.uid())) WITH CHECK(household_id=(SELECT public.get_my_household_id()) AND owner_id=(SELECT auth.uid()));
END $$;

CREATE OR REPLACE FUNCTION finance_private.erase_prior_session()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF OLD.secret_id IS NOT NULL AND (TG_OP='DELETE' OR NEW.secret_id IS DISTINCT FROM OLD.secret_id) THEN
    DELETE FROM vault.secrets WHERE id=OLD.secret_id;
  END IF;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION finance_private.erase_prior_session() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS erase_prior_session ON finance_private.prior_connections;
CREATE TRIGGER erase_prior_session AFTER DELETE OR UPDATE OF secret_id ON finance_private.prior_connections FOR EACH ROW EXECUTE FUNCTION finance_private.erase_prior_session();

CREATE OR REPLACE FUNCTION public.prior_connection_state(p_owner UUID,p_action TEXT,p_data JSONB DEFAULT '{}')
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET statement_timeout='8s' AS $$
DECLARE h UUID; c finance_private.prior_connections; secret UUID; s JSONB; preferred TEXT; account UUID; result JSONB;
BEGIN
  SELECT household_id INTO h FROM public.profiles WHERE id=p_owner;
  IF h IS NULL THEN RAISE EXCEPTION 'PRIOR_CONNECTION_MEMBER'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('prior-connection:'||p_owner::text,0));
  INSERT INTO finance_private.prior_connections(owner_id,household_id) VALUES(p_owner,h) ON CONFLICT DO NOTHING;
  SELECT * INTO c FROM finance_private.prior_connections WHERE owner_id=p_owner FOR UPDATE;
  IF c.household_id<>h THEN
    UPDATE finance_private.prior_connections SET household_id=h,revision=gen_random_uuid(),secret_id=NULL,login_key=NULL,selected_source=NULL,last_success_at=NULL,preview=NULL,reauth_required=false WHERE owner_id=p_owner RETURNING * INTO c;
  END IF;
  IF p_action IN ('save','touch','expire') AND (p_data->>'revision') IS DISTINCT FROM c.revision::text THEN RAISE EXCEPTION 'PRIOR_CONNECTION_CHANGED'; END IF;
  IF p_action='save' THEN
    s:=p_data->'session';
    IF jsonb_typeof(s) IS DISTINCT FROM 'object' OR octet_length(s::text)>50000
      OR EXISTS(SELECT 1 FROM jsonb_object_keys(s) k WHERE k NOT IN ('token','client','userSession'))
      OR jsonb_typeof(s->'token') IS DISTINCT FROM 'string' OR length(s->>'token') NOT BETWEEN 1 AND 16000
      OR jsonb_typeof(s->'client') IS DISTINCT FROM 'string' OR length(s->>'client') NOT BETWEEN 1 AND 16000
      OR jsonb_typeof(s->'userSession') IS DISTINCT FROM 'string' OR length(s->>'userSession') NOT BETWEEN 1 AND 16000
      OR coalesce(p_data->>'loginKey','') !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'PRIOR_CONNECTION_FORMAT'; END IF;
    secret:=vault.create_secret(s::text,NULL,'FinApp Priorbank session');
    UPDATE finance_private.prior_connections SET secret_id=secret,login_key=p_data->>'loginKey',revision=gen_random_uuid(),reauth_required=false,preview=p_data->'preview',last_success_at=now() WHERE owner_id=p_owner RETURNING * INTO c;
  ELSIF p_action IN ('disconnect','expire') THEN
    UPDATE finance_private.prior_connections SET secret_id=NULL,login_key=NULL,preview=NULL,last_success_at=NULL,revision=gen_random_uuid(),reauth_required=(p_action='expire') WHERE owner_id=p_owner RETURNING * INTO c;
  ELSIF p_action='touch' THEN
    IF c.secret_id IS NULL THEN RAISE EXCEPTION 'PRIOR_CONNECTION_CHANGED'; END IF;
    UPDATE finance_private.prior_connections SET preview=p_data->'preview',last_success_at=now() WHERE owner_id=p_owner RETURNING * INTO c;
  ELSIF p_action='select' THEN
    IF coalesce(p_data->>'sourceKey','') !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'PRIOR_CONNECTION_FORMAT'; END IF;
    UPDATE finance_private.prior_connections SET selected_source=p_data->>'sourceKey' WHERE owner_id=p_owner RETURNING * INTO c;
  ELSIF p_action NOT IN ('status','load') OR p_action IS NULL THEN RAISE EXCEPTION 'PRIOR_CONNECTION_FORMAT';
  END IF;
  preferred:=c.selected_source;
  IF preferred IS NULL THEN
    SELECT CASE WHEN count(*)=1 THEN min(source_key) END INTO preferred FROM public.prior_import_sources WHERE household_id=h AND owner_id=p_owner;
  END IF;
  SELECT account_id INTO account FROM public.prior_import_sources WHERE household_id=h AND owner_id=p_owner AND source_key=preferred;
  result:=jsonb_build_object('connected',c.secret_id IS NOT NULL,'reauthRequired',c.reauth_required,'lastSyncedAt',c.last_success_at,'selectedSourceKey',preferred,'accountId',account);
  IF p_action='load' THEN
    SELECT decrypted_secret::jsonb INTO s FROM vault.decrypted_secrets WHERE id=c.secret_id;
    RETURN result||jsonb_build_object('revision',c.revision,'loginKey',c.login_key,'session',s,'preview',c.preview,'cacheFresh',c.last_success_at>now()-interval '60 seconds');
  END IF;
  -- Revision is an opaque CAS generation; it contains no bank credentials.
  RETURN result||jsonb_build_object('revision',c.revision);
END $$;
REVOKE ALL ON FUNCTION public.prior_connection_state(UUID,TEXT,JSONB) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.prior_connection_state(UUID,TEXT,JSONB) TO service_role;

-- Retain warning fingerprints after ledger edits/deletions, including across date windows.
ALTER TABLE public.prior_import_days ADD COLUMN IF NOT EXISTS warning_keys TEXT[] NOT NULL DEFAULT '{}';
UPDATE public.prior_import_days d SET warning_keys=coalesce((
  SELECT array_agg(DISTINCT encode(sha256(convert_to(jsonb_build_array(t.comment,CASE WHEN t.type='expense' THEN -t.amount ELSE t.amount END)::text,'UTF8')),'hex'))
  FROM public.transactions t JOIN public.prior_import_sources b ON b.household_id=d.household_id AND b.source_key=d.source_key AND b.owner_id=d.owner_id
  WHERE t.household_id=d.household_id AND t.account_id=b.account_id AND t.date=d.day AND t.kind='cashflow'
),'{}') WHERE warning_keys='{}';

CREATE OR REPLACE FUNCTION finance_private.prepare_prior_import(h UUID, a UUID, s JSONB)
RETURNS JSONB LANGUAGE plpgsql SET search_path='' AS $$
DECLARE r JSONB; c JSONB; rows JSONB; days JSONB; imported JSONB; possible JSONB; source TEXT;
  d DATE; first_day DATE; last_day DATE; closed_before DATE; today DATE := (now() AT TIME ZONE 'Europe/Minsk')::date;
BEGIN
  IF auth.uid() IS NULL OR h IS DISTINCT FROM public.get_my_household_id() THEN RAISE EXCEPTION 'PRIOR_AUTH'; END IF;
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
  IF EXISTS(SELECT 1 FROM public.prior_import_sources WHERE household_id=h AND source_key=source AND (owner_id<>auth.uid() OR account_id<>a)) THEN RAISE EXCEPTION 'PRIOR_SOURCE_BOUND'; END IF;
  IF EXISTS(SELECT 1 FROM public.prior_import_sources WHERE household_id=h AND account_id=a AND source_key<>source) THEN RAISE EXCEPTION 'PRIOR_ACCOUNT_BOUND'; END IF;
  -- Rolling windows retain all receipts; overlapping days still require identical signatures.
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
      AND left(value->>'date',10)::date<closed_before AND (value->>'accountAmount')::numeric<>0
  ), keyed AS (
    SELECT *, encode(sha256(convert_to(canonical::text,'UTF8')),'hex')||':'||row_number() OVER(PARTITION BY canonical ORDER BY idx) AS key FROM eligible
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object('index',idx,'day',day,'description',description,'amount',amount::text,'key',key,'canonical',canonical,'warningKey',encode(sha256(convert_to(jsonb_build_array(description,amount)::text,'UTF8')),'hex')) ORDER BY idx),'[]'::jsonb) INTO rows FROM keyed;
  SELECT coalesce(jsonb_agg(jsonb_build_object('day',day,'signature',signature)),'[]'::jsonb) INTO days FROM (
    SELECT day::date::text AS day, encode(sha256(convert_to(coalesce(string_agg((r.value->'canonical')::text,E'\n' ORDER BY (r.value->'canonical')::text),''),'UTF8')),'hex') AS signature
    FROM generate_series(first_day::timestamp,least(last_day,closed_before-1)::timestamp,interval '1 day') day
    LEFT JOIN jsonb_array_elements(rows) r(value) ON r.value->>'day'=day::date::text GROUP BY day
  ) daily;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(days) AS input_day(value) JOIN public.prior_import_days receipt
    ON receipt.household_id=h AND receipt.source_key=source AND receipt.day=(input_day.value->>'day')::date
    WHERE receipt.signature<>input_day.value->>'signature') THEN RAISE EXCEPTION 'PRIOR_DAY_CHANGED'; END IF;
  SELECT coalesce(jsonb_agg((row->>'index')::int),'[]'::jsonb) INTO imported
    FROM jsonb_array_elements(rows) row JOIN public.prior_import_days receipt
    ON receipt.household_id=h AND receipt.source_key=source AND receipt.day=(row->>'day')::date
    WHERE row->>'key'=ANY(receipt.imported_keys);
  SELECT coalesce(jsonb_agg((row->>'index')::int),'[]'::jsonb) INTO possible FROM jsonb_array_elements(rows) row
  WHERE EXISTS(SELECT 1 FROM public.prior_import_days old WHERE old.household_id=h AND old.source_key=source AND old.day<>(row->>'day')::date AND abs(old.day-(row->>'day')::date)<=31 AND row->>'warningKey'=ANY(old.warning_keys));
  RETURN jsonb_build_object('rows',rows,'days',days,'source',source,'importedIndexes',imported,
    'possibleIndexes',possible,'linked',EXISTS(SELECT 1 FROM public.prior_import_sources WHERE household_id=h AND source_key=source));
END $$;

CREATE OR REPLACE FUNCTION public.preview_prior_import(p_account_id UUID,p_snapshot JSONB)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET statement_timeout='10s' AS $$
DECLARE h UUID; prepared JSONB;
BEGIN
  h:=public.finance_household_lock();
  prepared:=finance_private.prepare_prior_import(h,p_account_id,p_snapshot);
  RETURN jsonb_build_object('importedIndexes',prepared->'importedIndexes','linked',prepared->'linked','possibleIndexes',prepared->'possibleIndexes');
END $$;

CREATE OR REPLACE FUNCTION public.import_prior_operations(p_account_id UUID,p_snapshot JSONB,p_items JSONB)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET statement_timeout='10s' AS $$
DECLARE h UUID; prepared JSONB; item JSONB; row JSONB; v_day JSONB; seen INT[]:='{}'; idx INT;
  v_amount NUMERIC; imported INT:=0; skipped INT:=0; source TEXT;
BEGIN
  h:=public.finance_household_lock();
  prepared:=finance_private.prepare_prior_import(h,p_account_id,p_snapshot); source:=prepared->>'source';
  IF jsonb_typeof(p_items) IS DISTINCT FROM 'array' OR jsonb_array_length(p_items) NOT BETWEEN 1 AND 2000 THEN RAISE EXCEPTION 'PRIOR_SELECTION'; END IF;
  INSERT INTO public.prior_import_sources(household_id,owner_id,source_key,account_id) VALUES(h,auth.uid(),source,p_account_id) ON CONFLICT DO NOTHING;
  FOR item IN SELECT value FROM jsonb_array_elements(p_items) LOOP
    IF jsonb_typeof(item) IS DISTINCT FROM 'object' OR jsonb_typeof(item->'index') IS DISTINCT FROM 'number' OR coalesce(item->>'index','') !~ '^[0-9]{1,4}$'
      OR jsonb_typeof(item->'categoryId') IS DISTINCT FROM 'string' OR coalesce(item->>'categoryId','') !~ '^[a-z][a-z0-9-]{0,63}$'
      OR jsonb_typeof(item->'confirmExisting') IS DISTINCT FROM 'boolean' THEN RAISE EXCEPTION 'PRIOR_SELECTION'; END IF;
    idx:=(item->>'index')::int;
    IF idx=ANY(seen) THEN RAISE EXCEPTION 'PRIOR_SELECTION'; END IF;
    seen:=array_append(seen,idx);
    SELECT value INTO row FROM jsonb_array_elements(prepared->'rows') WHERE (value->>'index')::int=idx;
    IF row IS NULL THEN RAISE EXCEPTION 'PRIOR_SELECTION'; END IF;
    IF EXISTS(SELECT 1 FROM public.prior_import_days WHERE household_id=h AND source_key=source AND public.prior_import_days.day=(row->>'day')::date AND row->>'key'=ANY(imported_keys)) THEN skipped:=skipped+1; CONTINUE; END IF;
    v_amount:=(row->>'amount')::numeric;
    IF NOT (item->>'confirmExisting')::boolean AND ((prepared->'possibleIndexes') @> jsonb_build_array(idx) OR EXISTS(SELECT 1 FROM public.transactions WHERE household_id=h AND account_id=p_account_id AND kind='cashflow'
      AND date=(row->>'day')::date AND public.transactions.amount=abs(v_amount) AND type=CASE WHEN v_amount<0 THEN 'expense' ELSE 'income' END)) THEN RAISE EXCEPTION 'PRIOR_CONFIRM_EXISTING'; END IF;
    INSERT INTO public.transactions(household_id,added_by,type,amount,category_id,comment,date,kind,account_id)
      VALUES(h,auth.uid(),CASE WHEN v_amount<0 THEN 'expense' ELSE 'income' END,abs(v_amount),item->>'categoryId',row->>'description',(row->>'day')::date,'cashflow',p_account_id);
    SELECT value INTO v_day FROM jsonb_array_elements(prepared->'days') WHERE value->>'day'=row->>'day';
    INSERT INTO public.prior_import_days(household_id,owner_id,source_key,day,signature,imported_keys,warning_keys)
      VALUES(h,auth.uid(),source,(row->>'day')::date,v_day->>'signature',ARRAY[row->>'key'],ARRAY[row->>'warningKey'])
      ON CONFLICT(household_id,source_key,day) DO UPDATE SET imported_keys=array_append(public.prior_import_days.imported_keys,row->>'key'),warning_keys=array_append(public.prior_import_days.warning_keys,row->>'warningKey');
    imported:=imported+1;
  END LOOP;
  RETURN jsonb_build_object('imported',imported,'skipped',skipped);
END $$;
REVOKE ALL ON FUNCTION finance_private.prepare_prior_import(UUID,UUID,JSONB) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.preview_prior_import(UUID,JSONB),public.import_prior_operations(UUID,JSONB,JSONB) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.preview_prior_import(UUID,JSONB),public.import_prior_operations(UUID,JSONB,JSONB) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
