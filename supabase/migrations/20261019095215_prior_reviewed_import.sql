-- Reviewed local Priorbank handoff. No bank credentials, network calls or balance correction.
BEGIN;
CREATE SCHEMA IF NOT EXISTS finance_private;
REVOKE ALL ON SCHEMA finance_private FROM PUBLIC, anon, authenticated;

CREATE TABLE IF NOT EXISTS public.prior_import_sources (
  household_id UUID NOT NULL REFERENCES public.households(id) ON DELETE CASCADE,
  owner_id UUID NOT NULL,
  source_key TEXT NOT NULL CHECK (source_key ~ '^[a-f0-9]{64}$'),
  account_id UUID NOT NULL REFERENCES public.accounts(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (household_id, source_key),
  UNIQUE (household_id, account_id),
  UNIQUE (household_id, owner_id, source_key)
);
CREATE TABLE IF NOT EXISTS public.prior_import_days (
  household_id UUID NOT NULL,
  owner_id UUID NOT NULL,
  source_key TEXT NOT NULL,
  day DATE NOT NULL,
  signature TEXT NOT NULL CHECK (signature ~ '^[a-f0-9]{64}$'),
  imported_keys TEXT[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (household_id, source_key, day),
  FOREIGN KEY (household_id, owner_id, source_key)
    REFERENCES public.prior_import_sources(household_id, owner_id, source_key) ON DELETE CASCADE
);
DO $$ DECLARE tab TEXT; action TEXT;
BEGIN
  FOREACH tab IN ARRAY ARRAY['prior_import_sources','prior_import_days'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',tab);
    FOREACH action IN ARRAY ARRAY['SELECT','DELETE'] LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I',tab||'_'||lower(action),tab);
      EXECUTE format('CREATE POLICY %I ON public.%I FOR %s TO authenticated USING(household_id=(SELECT public.get_my_household_id()) AND owner_id=(SELECT auth.uid()))',tab||'_'||lower(action),tab,action);
    END LOOP;
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I',tab||'_insert',tab);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR INSERT TO authenticated WITH CHECK(household_id=(SELECT public.get_my_household_id()) AND owner_id=(SELECT auth.uid()))',tab||'_insert',tab);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I',tab||'_update',tab);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated USING(household_id=(SELECT public.get_my_household_id()) AND owner_id=(SELECT auth.uid())) WITH CHECK(household_id=(SELECT public.get_my_household_id()) AND owner_id=(SELECT auth.uid()))',tab||'_update',tab);
    -- Only the guarded atomic RPC may mutate receipts. Deleting a ledger row retains its receipt.
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated',tab);
    EXECUTE format('GRANT SELECT ON public.%I TO authenticated',tab);
  END LOOP;
END $$;

-- Internal invoker helper. Public entry points own the household lock and explicit auth check.
CREATE OR REPLACE FUNCTION finance_private.prepare_prior_import(h UUID, a UUID, s JSONB)
RETURNS JSONB LANGUAGE plpgsql SET search_path='' AS $$
DECLARE r JSONB; c JSONB; rows JSONB; days JSONB; imported JSONB; source TEXT;
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
  -- Until stable bank transaction IDs are verified, a later upload must recheck every
  -- previously imported day, including a day that became empty after a bank correction.
  IF EXISTS(SELECT 1 FROM public.prior_import_days WHERE household_id=h AND source_key=source AND (day<first_day OR day>last_day OR day>=closed_before)) THEN RAISE EXCEPTION 'PRIOR_RANGE_COVERAGE'; END IF;
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
  SELECT coalesce(jsonb_agg(jsonb_build_object('index',idx,'day',day,'description',description,'amount',amount::text,'key',key,'canonical',canonical) ORDER BY idx),'[]'::jsonb) INTO rows FROM keyed;
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
  RETURN jsonb_build_object('rows',rows,'days',days,'source',source,'importedIndexes',imported,
    'linked',EXISTS(SELECT 1 FROM public.prior_import_sources WHERE household_id=h AND source_key=source));
END $$;

CREATE OR REPLACE FUNCTION public.preview_prior_import(p_account_id UUID,p_snapshot JSONB)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET statement_timeout='10s' AS $$
DECLARE h UUID; prepared JSONB;
BEGIN
  h:=public.finance_household_lock();
  prepared:=finance_private.prepare_prior_import(h,p_account_id,p_snapshot);
  RETURN jsonb_build_object('importedIndexes',prepared->'importedIndexes','linked',prepared->'linked');
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
    IF NOT (item->>'confirmExisting')::boolean AND EXISTS(SELECT 1 FROM public.transactions WHERE household_id=h AND account_id=p_account_id AND kind='cashflow'
      AND date=(row->>'day')::date AND public.transactions.amount=abs(v_amount) AND type=CASE WHEN v_amount<0 THEN 'expense' ELSE 'income' END) THEN RAISE EXCEPTION 'PRIOR_CONFIRM_EXISTING'; END IF;
    INSERT INTO public.transactions(household_id,added_by,type,amount,category_id,comment,date,kind,account_id)
      VALUES(h,auth.uid(),CASE WHEN v_amount<0 THEN 'expense' ELSE 'income' END,abs(v_amount),item->>'categoryId',row->>'description',(row->>'day')::date,'cashflow',p_account_id);
    SELECT value INTO v_day FROM jsonb_array_elements(prepared->'days') WHERE value->>'day'=row->>'day';
    INSERT INTO public.prior_import_days(household_id,owner_id,source_key,day,signature,imported_keys)
      VALUES(h,auth.uid(),source,(row->>'day')::date,v_day->>'signature',ARRAY[row->>'key'])
      ON CONFLICT(household_id,source_key,day) DO UPDATE SET imported_keys=array_append(public.prior_import_days.imported_keys,row->>'key');
    imported:=imported+1;
  END LOOP;
  RETURN jsonb_build_object('imported',imported,'skipped',skipped);
END $$;
REVOKE ALL ON FUNCTION finance_private.prepare_prior_import(UUID,UUID,JSONB) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.preview_prior_import(UUID,JSONB),public.import_prior_operations(UUID,JSONB,JSONB) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.preview_prior_import(UUID,JSONB),public.import_prior_operations(UUID,JSONB,JSONB) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
