-- Priorbank v2. Credentials are separate Vault secrets; all new financial writes are opt-in.
BEGIN;
ALTER TABLE finance_private.prior_connections ADD COLUMN IF NOT EXISTS credential_secret_id UUID;
ALTER TABLE finance_private.prior_connections ADD COLUMN IF NOT EXISTS auth_blocked BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE finance_private.prior_connections ADD COLUMN IF NOT EXISTS last_reauth_at TIMESTAMPTZ;
ALTER TABLE public.prior_automation ADD COLUMN IF NOT EXISTS live_enabled BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE public.prior_automation ADD COLUMN IF NOT EXISTS live_requested BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE public.prior_automation ADD COLUMN IF NOT EXISTS live_probe JSONB;
ALTER TABLE public.prior_automation ADD COLUMN IF NOT EXISTS last_snapshot_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS public.prior_bank_events (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), owner_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
 household_id UUID NOT NULL REFERENCES public.households(id) ON DELETE CASCADE,
 account_id UUID NOT NULL REFERENCES public.accounts(id), source_key TEXT NOT NULL,
 aliases TEXT[] NOT NULL, match_key TEXT NOT NULL,
 state TEXT NOT NULL CHECK(state IN ('provisional','posted','cancelled','needs_review')),
 bank_amount NUMERIC(12,2) NOT NULL, applied_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
 original_amount NUMERIC(12,2), original_currency TEXT NOT NULL,
 day DATE NOT NULL, occurred_at TIMESTAMPTZ NOT NULL, precise_time BOOLEAN NOT NULL,
 description TEXT NOT NULL, transaction_id UUID REFERENCES public.transactions(id) ON DELETE SET NULL,
 suppressed BOOLEAN NOT NULL DEFAULT false, reason TEXT, observed_state TEXT, suggested_category TEXT NOT NULL DEFAULT 'other',
 history JSONB NOT NULL DEFAULT '[]', created_at TIMESTAMPTZ NOT NULL DEFAULT now(), last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 CHECK(source_key ~ '^[a-f0-9]{64}$' AND match_key ~ '^[a-f0-9]{64}$'),
 CHECK(bank_amount::text NOT IN ('NaN','Infinity','-Infinity') AND applied_amount::text NOT IN ('NaN','Infinity','-Infinity'))
);
CREATE INDEX IF NOT EXISTS prior_bank_events_household ON public.prior_bank_events(household_id);
CREATE INDEX IF NOT EXISTS prior_bank_events_owner_match ON public.prior_bank_events(owner_id,source_key,match_key);
CREATE INDEX IF NOT EXISTS prior_bank_events_account ON public.prior_bank_events(account_id);
CREATE UNIQUE INDEX IF NOT EXISTS prior_bank_events_transaction ON public.prior_bank_events(transaction_id) WHERE transaction_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS prior_bank_events_aliases ON public.prior_bank_events USING gin(aliases);
CREATE INDEX IF NOT EXISTS prior_bank_events_owner_amount_day ON public.prior_bank_events(owner_id,source_key,bank_amount,day);
CREATE INDEX IF NOT EXISTS prior_bank_events_owner_time ON public.prior_bank_events(owner_id,source_key,occurred_at);
CREATE INDEX IF NOT EXISTS prior_transaction_candidates ON public.transactions(household_id,account_id,date,amount,type) WHERE kind='cashflow';
ALTER TABLE public.prior_bank_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.prior_bank_events FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.prior_bank_events TO authenticated;
DO $$ DECLARE action TEXT; BEGIN
 FOREACH action IN ARRAY ARRAY['SELECT','INSERT','UPDATE','DELETE'] LOOP
  EXECUTE format('DROP POLICY IF EXISTS %I ON public.prior_bank_events','prior_bank_events_'||lower(action));
  EXECUTE format('CREATE POLICY %I ON public.prior_bank_events FOR %s TO authenticated %s','prior_bank_events_'||lower(action),action,
   CASE WHEN action='INSERT' THEN 'WITH CHECK(household_id=(SELECT public.get_my_household_id()) AND owner_id=(SELECT auth.uid()))'
   WHEN action='UPDATE' THEN 'USING(household_id=(SELECT public.get_my_household_id()) AND owner_id=(SELECT auth.uid())) WITH CHECK(household_id=(SELECT public.get_my_household_id()) AND owner_id=(SELECT auth.uid()))'
   WHEN action='SELECT' THEN 'USING(household_id=(SELECT public.get_my_household_id()))'
   ELSE 'USING(household_id=(SELECT public.get_my_household_id()) AND owner_id=(SELECT auth.uid()))' END);
 END LOOP;
 IF NOT EXISTS(SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='prior_bank_events') THEN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.prior_bank_events;
 END IF;
END $$;

CREATE OR REPLACE FUNCTION finance_private.erase_prior_credentials() RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF OLD.credential_secret_id IS NOT NULL AND (TG_OP='DELETE' OR NEW.credential_secret_id IS DISTINCT FROM OLD.credential_secret_id) THEN
  DELETE FROM vault.secrets WHERE id=OLD.credential_secret_id;
 END IF;
 RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION finance_private.erase_prior_credentials() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS erase_prior_credentials ON finance_private.prior_connections;
CREATE TRIGGER erase_prior_credentials AFTER DELETE OR UPDATE OF credential_secret_id ON finance_private.prior_connections FOR EACH ROW EXECUTE FUNCTION finance_private.erase_prior_credentials();

DO $$ BEGIN
 IF to_regprocedure('finance_private.prior_connection_state_v1(uuid,text,jsonb)') IS NULL THEN
  ALTER FUNCTION public.prior_connection_state(UUID,TEXT,JSONB) SET SCHEMA finance_private;
  ALTER FUNCTION finance_private.prior_connection_state(UUID,TEXT,JSONB) RENAME TO prior_connection_state_v1;
 END IF;
END $$;
REVOKE ALL ON FUNCTION finance_private.prior_connection_state_v1(UUID,TEXT,JSONB) FROM PUBLIC,anon,authenticated,service_role;
CREATE OR REPLACE FUNCTION public.prior_connection_state(p_owner UUID,p_action TEXT,p_data JSONB DEFAULT '{}') RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET statement_timeout='8s' AS $$
DECLARE c finance_private.prior_connections; h UUID; result JSONB; credentials JSONB; secret UUID; action TEXT:=p_action;
BEGIN
 SELECT household_id INTO h FROM public.profiles WHERE id=p_owner;
 IF h IS NULL THEN RAISE EXCEPTION 'PRIOR_CONNECTION_MEMBER'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('prior-connection:'||p_owner::text,0));
 SELECT * INTO c FROM finance_private.prior_connections WHERE owner_id=p_owner FOR UPDATE;
 IF c.household_id IS DISTINCT FROM h AND c.owner_id IS NOT NULL THEN
  UPDATE finance_private.prior_connections SET credential_secret_id=NULL,auth_blocked=false,last_reauth_at=NULL WHERE owner_id=p_owner;
 END IF;
 IF p_action='request' THEN
  UPDATE public.prior_automation SET next_run_at=least(next_run_at,greatest(now(),coalesce(last_attempt_at,'-infinity')+interval '60 seconds')) WHERE owner_id=p_owner AND household_id=h AND enabled AND issue IS NULL;
  RETURN '{}'::jsonb;
 END IF;
 IF p_action IN ('reauth','auth_failed','rotate') THEN
  IF c.revision::text IS DISTINCT FROM p_data->>'revision' OR c.household_id IS DISTINCT FROM h THEN RAISE EXCEPTION 'PRIOR_CONNECTION_CHANGED'; END IF;
  IF p_action='reauth' THEN
   IF c.credential_secret_id IS NULL OR c.auth_blocked OR c.last_reauth_at>now()-interval '10 minutes' THEN RETURN '{}'::jsonb; END IF;
   -- Only an already-held owner/login lease can obtain credentials for one renewal attempt.
   IF NOT EXISTS(SELECT 1 FROM finance_private.prior_connection_attempts WHERE owner_id=p_owner AND attempt_id=(p_data->>'attempt')::uuid AND lease_until>now() AND scope='owner:'||p_owner::text) THEN RAISE EXCEPTION 'PRIOR_CONNECTION_CHANGED'; END IF;
   UPDATE finance_private.prior_connections SET last_reauth_at=now() WHERE owner_id=p_owner;
   SELECT decrypted_secret::jsonb INTO credentials FROM vault.decrypted_secrets WHERE id=c.credential_secret_id;
   RETURN jsonb_build_object('credentials',credentials);
  ELSIF p_action='auth_failed' THEN
   UPDATE finance_private.prior_connections SET auth_blocked=true WHERE owner_id=p_owner;
   RETURN '{}'::jsonb;
  END IF;
  action:='save';
 ELSIF p_action='save_auto' THEN
  credentials:=p_data->'credentials';
  IF jsonb_typeof(credentials) IS DISTINCT FROM 'object' OR EXISTS(SELECT 1 FROM jsonb_object_keys(credentials) k WHERE k NOT IN ('login','password'))
   OR coalesce(length(credentials->>'login'),0) NOT BETWEEN 1 AND 128 OR coalesce(length(credentials->>'password'),0) NOT BETWEEN 1 AND 16
   OR jsonb_typeof(credentials->'login') IS DISTINCT FROM 'string' OR jsonb_typeof(credentials->'password') IS DISTINCT FROM 'string'
   OR credentials->>'login' ~ '[[:cntrl:]]' OR credentials->>'password' ~ '[[:cntrl:]]' THEN RAISE EXCEPTION 'PRIOR_CONNECTION_FORMAT'; END IF;
  action:='save';
 END IF;
 result:=finance_private.prior_connection_state_v1(p_owner,action,p_data-'credentials');
 IF p_action='save_auto' THEN
  secret:=vault.create_secret(credentials::text,NULL,'FinApp Priorbank automatic login');
  UPDATE finance_private.prior_connections SET credential_secret_id=secret,auth_blocked=false,last_reauth_at=NULL WHERE owner_id=p_owner;
 ELSIF p_action IN ('save','disconnect') THEN
  UPDATE finance_private.prior_connections SET credential_secret_id=NULL,auth_blocked=false,last_reauth_at=NULL WHERE owner_id=p_owner;
 ELSIF p_action='expire' AND c.credential_secret_id IS NOT NULL THEN
  UPDATE finance_private.prior_connections SET login_key=c.login_key,preview=c.preview WHERE owner_id=p_owner;
  IF NOT c.auth_blocked THEN UPDATE public.prior_automation SET issue='network',next_run_at=now()+interval '15 minutes' WHERE owner_id=p_owner AND household_id=h AND enabled; END IF;
 END IF;
 SELECT * INTO c FROM finance_private.prior_connections WHERE owner_id=p_owner;
 -- These fields are service-only. Legacy public envelopes still use an explicit whitelist.
 RETURN result||jsonb_build_object('autoReconnect',c.credential_secret_id IS NOT NULL AND NOT c.auth_blocked,
   'liveEnabled',coalesce((SELECT enabled AND live_enabled FROM public.prior_automation WHERE owner_id=p_owner AND household_id=h),false),
   'liveRequested',coalesce((SELECT enabled AND live_requested FROM public.prior_automation WHERE owner_id=p_owner AND household_id=h),false),
   'liveReady',coalesce((SELECT live_probe->>'valid'='true' FROM public.prior_automation WHERE owner_id=p_owner AND household_id=h),false),
   'automationRevision',(SELECT revision FROM public.prior_automation WHERE owner_id=p_owner AND household_id=h));
END $$;
REVOKE ALL ON FUNCTION public.prior_connection_state(UUID,TEXT,JSONB) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.prior_connection_state(UUID,TEXT,JSONB) TO service_role;

-- Readiness is explicit; existing enabled users are migrated only after a successful shadow probe.
CREATE OR REPLACE FUNCTION public.set_prior_live(p_enabled BOOLEAN) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE h UUID;
BEGIN
 h:=public.finance_household_lock();
 PERFORM pg_advisory_xact_lock(hashtextextended('prior-connection:'||auth.uid()::text,0));
 IF p_enabled IS NULL OR NOT EXISTS(SELECT 1 FROM public.prior_automation WHERE owner_id=auth.uid() AND household_id=h AND enabled) THEN RAISE EXCEPTION 'PRIOR_AUTO_SESSION'; END IF;
 UPDATE public.prior_automation SET live_requested=p_enabled,live_enabled=p_enabled AND coalesce(live_probe->>'valid'='true',false),revision=gen_random_uuid(),next_run_at=now(),issue=NULL WHERE owner_id=auth.uid() AND household_id=h;
END $$;
REVOKE ALL ON FUNCTION public.set_prior_live(BOOLEAN) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.set_prior_live(BOOLEAN) TO authenticated;

CREATE OR REPLACE FUNCTION public.request_prior_sync() RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE h UUID;
BEGIN
 h:=public.finance_household_lock();
 UPDATE public.prior_automation SET next_run_at=least(next_run_at,greatest(now(),coalesce(last_attempt_at,'-infinity')+interval '60 seconds'))
 WHERE owner_id=auth.uid() AND household_id=h AND enabled AND issue IS NULL;
END $$;
REVOKE ALL ON FUNCTION public.request_prior_sync() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.request_prior_sync() TO authenticated;

CREATE OR REPLACE FUNCTION finance_private.prior_event_deleted() RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 UPDATE public.prior_bank_events SET suppressed=true WHERE transaction_id=OLD.id AND household_id=OLD.household_id;
 RETURN OLD;
END $$;
REVOKE ALL ON FUNCTION finance_private.prior_event_deleted() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS prior_event_deleted ON public.transactions;
CREATE TRIGGER prior_event_deleted BEFORE DELETE ON public.transactions FOR EACH ROW EXECUTE FUNCTION finance_private.prior_event_deleted();

-- Only the trusted reconciler may give an explicitly cancelled event a zero ledger effect.
DO $$ DECLARE body TEXT; needle TEXT:='IF NEW.amount <= 0 OR NEW.amount::text IN (''NaN'', ''Infinity'', ''-Infinity'') THEN RAISE EXCEPTION ''Transaction amount must be finite and positive''; END IF;'; BEGIN
 body:=pg_get_functiondef('public.guard_finance_write()'::regprocedure);
 IF position(needle IN body)>0 THEN
  body:=replace(body,needle,'IF (NEW.amount <= 0 AND NOT (v_privileged AND NEW.amount=0 AND EXISTS(SELECT 1 FROM public.prior_bank_events e WHERE e.transaction_id=NEW.id AND e.household_id=NEW.household_id AND e.state=''cancelled''))) OR NEW.amount::text IN (''NaN'',''Infinity'',''-Infinity'') THEN RAISE EXCEPTION ''Transaction amount must be finite and positive''; END IF;');
  EXECUTE body;
 ELSIF position('prior_bank_events' IN body)=0 THEN RAISE EXCEPTION 'PRIOR_GUARD_CHANGED'; END IF;
END $$;

CREATE OR REPLACE FUNCTION finance_private.prior_live_receipt(h UUID,p_owner UUID,source TEXT,r JSONB) RETURNS VOID LANGUAGE plpgsql SET search_path='' AS $$
DECLARE receipt TEXT:=r->>'legacyKey'; warning TEXT;
BEGIN
 IF r->>'source'<>'history' OR receipt IS NULL THEN RETURN; END IF;
 warning:=encode(sha256(convert_to(jsonb_build_array(r->'legacy'->>'description',(r->'legacy'->>'accountAmount')::numeric)::text,'UTF8')),'hex');
 INSERT INTO public.prior_import_days(household_id,owner_id,source_key,day,signature,imported_keys,warning_keys)
  VALUES(h,p_owner,source,(r->>'day')::date,repeat('0',64),ARRAY[receipt],ARRAY[warning])
  ON CONFLICT(household_id,source_key,day) DO UPDATE SET imported_keys=CASE WHEN receipt=ANY(public.prior_import_days.imported_keys) THEN public.prior_import_days.imported_keys ELSE array_append(public.prior_import_days.imported_keys,receipt) END,
   warning_keys=CASE WHEN warning=ANY(public.prior_import_days.warning_keys) THEN public.prior_import_days.warning_keys ELSE array_append(public.prior_import_days.warning_keys,warning) END;
END $$;
REVOKE ALL ON FUNCTION finance_private.prior_live_receipt(UUID,UUID,TEXT,JSONB) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.complete_prior_live_job(p_owner UUID,p_revision UUID,p_connection_revision UUID,p_snapshot JSONB,p_shadow BOOLEAN DEFAULT false)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET statement_timeout='20s' AS $$
#variable_conflict use_variable
DECLARE a public.prior_automation; c finance_private.prior_connections; h UUID; r JSONB; rows JSONB; e public.prior_bank_events;
 t public.transactions; amount NUMERIC; effect NUMERIC; reason TEXT; phase TEXT; old_phase TEXT;
 n INT:=0; changed INT:=0; candidates INT; matched UUID[]:='{}'; source_kind TEXT:=''; entry UUID;
 legacy_key TEXT; day_signature TEXT; day_row RECORD; old_amount NUMERIC; reversal_description TEXT;
BEGIN
 SELECT household_id INTO h FROM public.profiles WHERE id=p_owner;
 IF h IS NULL THEN RETURN NULL; END IF;
 PERFORM 1 FROM public.households WHERE id=h FOR UPDATE;
 PERFORM pg_advisory_xact_lock(hashtextextended('prior-connection:'||p_owner::text,0));
 SELECT * INTO a FROM public.prior_automation WHERE owner_id=p_owner AND household_id=h FOR UPDATE;
 SELECT * INTO c FROM finance_private.prior_connections WHERE owner_id=p_owner AND household_id=h;
 IF a.owner_id IS NULL OR NOT a.enabled OR a.revision IS DISTINCT FROM p_revision OR c.revision IS DISTINCT FROM p_connection_revision OR c.secret_id IS NULL THEN RETURN NULL; END IF;
 IF jsonb_typeof(p_snapshot) IS DISTINCT FROM 'object' OR octet_length(p_snapshot::text)>12000000 OR p_snapshot->'version' IS DISTINCT FROM '2'::jsonb
  OR p_snapshot->>'sourceKey' IS DISTINCT FROM a.source_key OR jsonb_typeof(p_snapshot->'records') IS DISTINCT FROM 'array' OR jsonb_array_length(p_snapshot->'records')>2000
  OR (p_snapshot->>'fetchedAt')::timestamptz NOT BETWEEN now()-interval '5 minutes' AND now()+interval '1 minute'
  OR (p_snapshot->>'to')::date<>(now() AT TIME ZONE 'Europe/Minsk')::date OR (p_snapshot->>'to')::date-(p_snapshot->>'from')::date NOT BETWEEN 0 AND 30 THEN RAISE EXCEPTION 'PRIOR_LIVE_INPUT'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.accounts WHERE id=a.account_id AND household_id=h AND kind='bank' AND currency='BYN' AND NOT is_archived) THEN RAISE EXCEPTION 'PRIOR_LIVE_ACCOUNT'; END IF;
 IF NOT p_shadow AND a.last_snapshot_at>(p_snapshot->>'fetchedAt')::timestamptz THEN RETURN jsonb_build_object('imported',0,'stale',true); END IF;
 FOR r IN SELECT value FROM jsonb_array_elements(p_snapshot->'records') LOOP
  IF coalesce(r->>'key','') !~ '^[a-f0-9]{64}:[1-9][0-9]{0,3}$' OR coalesce(r->>'matchKey','') !~ '^[a-f0-9]{64}$'
   OR coalesce(r->>'amount','') !~ '^-?(0|[1-9][0-9]{0,9})\.[0-9]{2}$' OR coalesce(r->>'day','') !~ '^\d{4}-\d{2}-\d{2}$'
   OR coalesce(r->>'description','')='' OR length(r->>'description')>4000 OR coalesce(r->>'originalCurrency','') !~ '^[A-Z]{3}$'
   OR coalesce(r->>'state','') NOT IN ('provisional','posted','cancelled','needs_review') OR coalesce(r->>'source','') NOT IN ('history','additional')
   OR coalesce(r->>'category','') !~ '^[a-z][a-z0-9-]{0,63}$' OR jsonb_typeof(r->'preciseTime') IS DISTINCT FROM 'boolean'
   OR jsonb_typeof(r->'transfer') IS DISTINCT FROM 'boolean' OR jsonb_typeof(r->'legacy') IS DISTINCT FROM 'object'
   OR (r->>'occurredAt')::timestamptz IS NULL OR ((r->>'occurredAt')::timestamptz AT TIME ZONE 'Europe/Minsk')::date<>(r->>'day')::date
   OR (r->'originalAmount'<>'null'::jsonb AND coalesce(r->>'originalAmount','') !~ '^-?(0|[1-9][0-9]{0,9})\.[0-9]{2}$') THEN RAISE EXCEPTION 'PRIOR_LIVE_ROW'; END IF;
  IF r->>'state'<>'cancelled' AND ((r->>'source'='history' AND (r->>'amount')::numeric IS DISTINCT FROM (r->'legacy'->>'accountAmount')::numeric)
   OR (r->>'source'='additional' AND (r->>'amount')::numeric IS DISTINCT FROM -(r->'legacy'->>'operationAmount')::numeric)) THEN RAISE EXCEPTION 'PRIOR_LIVE_SIGN'; END IF;
 END LOOP;
 -- Legacy receipt hashes stay byte-compatible with the SQL NUMERIC canonical representation.
 WITH canonical AS (
  SELECT value AS row,ordinality AS ord,CASE WHEN value->>'source'='history' THEN jsonb_build_array(value->'legacy'->>'date',value->'legacy'->>'description',
   (value->'legacy'->>'accountAmount')::numeric,(value->'legacy'->>'operationAmount')::numeric,value->'legacy'->>'operationCurrency',(value->'legacy'->>'fee')::numeric) END AS canon
  FROM jsonb_array_elements(p_snapshot->'records') WITH ORDINALITY
 ), keyed AS (
  SELECT *,encode(sha256(convert_to(canon::text,'UTF8')),'hex')||':'||row_number() OVER(PARTITION BY canon ORDER BY ord) AS receipt FROM canonical
 ) SELECT coalesce(jsonb_agg(row||jsonb_build_object('legacyKey',receipt,'canonical',canon) ORDER BY CASE WHEN row->>'source'='history' THEN 0 ELSE 1 END,ord),'[]') INTO rows FROM keyed;
 -- Shadow matching runs against actual household receipts and manual rows without creating events or money.
 UPDATE public.prior_automation SET live_probe=jsonb_build_object('valid',true,'at',now(),'records',jsonb_array_length(rows),
  'additional',(SELECT count(*) FROM jsonb_array_elements(rows) v WHERE v->>'source'='additional'),
  'timed',(SELECT count(*) FROM jsonb_array_elements(rows) v WHERE v->>'preciseTime'='true'),
  'manualMatches',(SELECT count(*) FROM jsonb_array_elements(rows) v WHERE EXISTS(SELECT 1 FROM public.transactions tx WHERE tx.household_id=h AND tx.account_id=a.account_id AND tx.kind='cashflow'
   AND tx.import_origin IS DISTINCT FROM 'prior-auto' AND tx.date=(v->>'day')::date AND tx.amount=abs((v->>'amount')::numeric) AND tx.type=CASE WHEN (v->>'amount')::numeric<0 THEN 'expense' ELSE 'income' END)),
  'receiptMatches',(SELECT count(*) FROM jsonb_array_elements(rows) v WHERE v->>'source'='history' AND EXISTS(SELECT 1 FROM public.prior_import_days d WHERE d.household_id=h AND d.source_key=a.source_key AND v->>'legacyKey'=ANY(d.imported_keys))),
  'overlapPairs',(SELECT coalesce(sum(least(posted,early)),0) FROM (SELECT count(*) FILTER(WHERE v->>'source'='history') posted,count(*) FILTER(WHERE v->>'source'='additional') early FROM jsonb_array_elements(rows) v GROUP BY v->>'matchKey',v->>'amount') pairs)) WHERE owner_id=p_owner;
 IF p_shadow OR NOT a.live_enabled THEN
  IF a.live_requested THEN UPDATE public.prior_automation SET live_enabled=true,revision=gen_random_uuid(),next_run_at=now() WHERE owner_id=p_owner AND household_id=h AND enabled; END IF;
  RETURN jsonb_build_object('imported',0,'shadow',true);
 END IF;
 IF coalesce((a.last_checked_at AT TIME ZONE 'Europe/Minsk')::date,a.started_on)<(now() AT TIME ZONE 'Europe/Minsk')::date-30 THEN RAISE EXCEPTION 'PRIOR_LIVE_GAP'; END IF;
 FOR r IN SELECT value FROM jsonb_array_elements(rows) LOOP
  IF (r->>'day')::date NOT BETWEEN greatest(a.started_on,(p_snapshot->>'from')::date) AND (p_snapshot->>'to')::date THEN CONTINUE; END IF;
  IF source_kind<>r->>'source' THEN matched:='{}';source_kind:=r->>'source'; END IF;
  amount:=(r->>'amount')::numeric;phase:=r->>'state';reason:=NULL;legacy_key:=r->>'legacyKey';entry:=NULL;
  SELECT * INTO e FROM public.prior_bank_events WHERE owner_id=p_owner AND household_id=h AND source_key=a.source_key AND aliases @> ARRAY[r->>'key'] LIMIT 1 FOR UPDATE;
  -- A bank-labelled full reversal may cancel one uniquely identified purchase. Multiple
  -- matching purchases remain for review; an ordinary credit/refund is never guessed.
  IF e.id IS NULL AND r->>'source'='history' AND amount>0 AND r->>'description' ~* '^Reversal[.]\s+Retail\s' THEN
   reversal_description:=lower(regexp_replace(btrim(regexp_replace(r->>'description','^Reversal[.]\s+','','i')),'\s+',' ','g'));
   SELECT count(*) INTO candidates FROM public.prior_bank_events old WHERE old.owner_id=p_owner AND old.household_id=h AND old.source_key=a.source_key
    AND old.bank_amount=-amount AND old.original_currency=r->>'originalCurrency' AND old.state IN ('provisional','posted') AND NOT old.suppressed
    AND lower(regexp_replace(btrim(old.description),'\s+',' ','g'))=reversal_description AND (r->>'day')::date-old.day BETWEEN 0 AND 30;
   IF candidates=1 THEN
    SELECT * INTO e FROM public.prior_bank_events old WHERE old.owner_id=p_owner AND old.household_id=h AND old.source_key=a.source_key
     AND old.bank_amount=-amount AND old.original_currency=r->>'originalCurrency' AND old.state IN ('provisional','posted') AND NOT old.suppressed
     AND lower(regexp_replace(btrim(old.description),'\s+',' ','g'))=reversal_description AND (r->>'day')::date-old.day BETWEEN 0 AND 30 LIMIT 1 FOR UPDATE;
    amount:=e.bank_amount;phase:='cancelled';
   ELSIF candidates>1 THEN reason:='ambiguous'; END IF;
  END IF;
  IF e.id IS NULL THEN
   -- Exact amounts pair identical occurrences one-to-one, including overlap of the two lists.
   SELECT * INTO e FROM public.prior_bank_events WHERE owner_id=p_owner AND household_id=h AND source_key=a.source_key AND match_key=r->>'matchKey'
    AND bank_amount=amount AND NOT(id=ANY(matched)) AND state<>'cancelled' ORDER BY created_at,id LIMIT 1 FOR UPDATE;
   IF e.id IS NULL THEN
    SELECT count(*) INTO candidates FROM public.prior_bank_events WHERE owner_id=p_owner AND household_id=h AND source_key=a.source_key AND match_key=r->>'matchKey' AND NOT(id=ANY(matched)) AND (state IN ('provisional','posted') OR suppressed);
    IF candidates=1 AND r->>'preciseTime'='true' THEN
     SELECT * INTO e FROM public.prior_bank_events WHERE owner_id=p_owner AND household_id=h AND source_key=a.source_key AND match_key=r->>'matchKey' AND NOT(id=ANY(matched)) AND (state IN ('provisional','posted') OR suppressed) LIMIT 1 FOR UPDATE;
    ELSIF candidates>0 THEN reason:='ambiguous'; END IF;
   END IF;
  END IF;
  IF e.id IS NOT NULL AND ((r->>'source'='additional' AND e.state='posted') OR(e.state='cancelled' AND phase<>'cancelled')) THEN
   UPDATE public.prior_bank_events SET aliases=CASE WHEN r->>'key'=ANY(aliases) THEN aliases ELSE array_append(aliases,r->>'key') END,last_seen_at=now() WHERE id=e.id;
   IF r->>'source'='history' THEN PERFORM finance_private.prior_live_receipt(h,p_owner,a.source_key,r); END IF;
   matched:=array_append(matched,e.id);CONTINUE;
  END IF;
  IF e.id IS NULL THEN
   IF phase='cancelled' THEN reason:='ambiguous'; END IF;
   IF r->>'transfer'='true' OR r->>'category'='transfer' THEN reason:='transfer'; END IF;
   IF phase='needs_review' THEN reason:=coalesce(reason,'format'); END IF;
   IF reason IS NULL AND EXISTS(SELECT 1 FROM public.prior_bank_events old WHERE old.owner_id=p_owner AND old.household_id=h AND old.source_key=a.source_key
    AND old.state='provisional' AND NOT old.suppressed AND old.bank_amount=amount AND abs(old.day-(r->>'day')::date)<=3
    AND NOT(old.match_key=r->>'matchKey' AND old.id=ANY(matched))
    AND (NOT old.precise_time OR r->>'preciseTime'='false' OR to_char(old.occurred_at AT TIME ZONE 'Europe/Minsk','HH24:MI:SS')=to_char((r->>'occurredAt')::timestamptz AT TIME ZONE 'Europe/Minsk','HH24:MI:SS'))) THEN reason:='ambiguous'; END IF;
   IF reason IS NULL AND EXISTS(SELECT 1 FROM public.prior_bank_events old WHERE old.owner_id=p_owner AND old.household_id=h AND old.source_key=a.source_key
    AND old.precise_time AND r->>'preciseTime'='true' AND old.occurred_at=(r->>'occurredAt')::timestamptz AND old.match_key<>r->>'matchKey'
    AND sign(old.bank_amount)=sign(amount) AND old.original_currency=r->>'originalCurrency') THEN reason:='ambiguous'; END IF;
   IF reason IS NULL AND EXISTS(SELECT 1 FROM public.transactions tx WHERE tx.household_id=h AND tx.account_id=a.account_id AND tx.kind='cashflow'
    AND tx.date=(r->>'day')::date AND tx.amount=abs(amount) AND tx.type=CASE WHEN amount<0 THEN 'expense' ELSE 'income' END
    AND NOT EXISTS(SELECT 1 FROM public.prior_bank_events old WHERE old.transaction_id=tx.id)) THEN reason:='similar'; END IF;
   INSERT INTO public.prior_bank_events(owner_id,household_id,account_id,source_key,aliases,match_key,state,bank_amount,original_amount,original_currency,day,occurred_at,precise_time,description,reason,observed_state,suggested_category)
    VALUES(p_owner,h,a.account_id,a.source_key,ARRAY[r->>'key'],r->>'matchKey',CASE WHEN reason IS NULL THEN phase ELSE 'needs_review' END,amount,(r->>'originalAmount')::numeric,r->>'originalCurrency',(r->>'day')::date,(r->>'occurredAt')::timestamptz,(r->>'preciseTime')::boolean,r->>'description',reason,phase,r->>'category') RETURNING * INTO e;
   IF r->>'source'='history' AND EXISTS(SELECT 1 FROM public.prior_import_days d WHERE d.household_id=h AND d.source_key=a.source_key AND d.day=(r->>'day')::date AND legacy_key=ANY(d.imported_keys)) THEN
    -- Preserve old receipts, including a user's deliberate deletion; never backfill old money.
    UPDATE public.prior_bank_events SET suppressed=true,state='posted',reason='legacy_receipt' WHERE id=e.id RETURNING * INTO e;
    -- Link a receipt to its unique, unchanged automatic row; a deleted, manually entered
    -- or ambiguous row remains a tombstone. This prevents an old row shadowing a new purchase.
    SELECT count(*) INTO candidates FROM public.transactions tx WHERE tx.household_id=h AND tx.account_id=a.account_id AND tx.kind='cashflow' AND tx.import_origin='prior-auto'
     AND tx.amount=abs(amount) AND tx.type=CASE WHEN amount<0 THEN 'expense' ELSE 'income' END AND tx.date=(r->>'day')::date AND tx.comment=r->>'description'
     AND NOT EXISTS(SELECT 1 FROM public.prior_bank_events mapped WHERE mapped.transaction_id=tx.id);
    IF candidates=1 THEN
     SELECT tx.id INTO entry FROM public.transactions tx WHERE tx.household_id=h AND tx.account_id=a.account_id AND tx.kind='cashflow' AND tx.import_origin='prior-auto'
      AND tx.amount=abs(amount) AND tx.type=CASE WHEN amount<0 THEN 'expense' ELSE 'income' END AND tx.date=(r->>'day')::date AND tx.comment=r->>'description'
      AND NOT EXISTS(SELECT 1 FROM public.prior_bank_events mapped WHERE mapped.transaction_id=tx.id) LIMIT 1 FOR UPDATE;
     UPDATE public.prior_bank_events SET transaction_id=entry,applied_amount=amount,suppressed=false,reason=NULL WHERE id=e.id RETURNING * INTO e;
    END IF;
   END IF;
  END IF;
  matched:=array_append(matched,e.id);old_phase:=e.state;old_amount:=e.bank_amount;
  IF e.suppressed THEN
   UPDATE public.prior_bank_events SET aliases=CASE WHEN r->>'key'=ANY(aliases) THEN aliases ELSE array_append(aliases,r->>'key') END,last_seen_at=now() WHERE id=e.id;
   IF r->>'source'='history' THEN PERFORM finance_private.prior_live_receipt(h,p_owner,a.source_key,r); END IF;
   CONTINUE;
  END IF;
  IF e.state='needs_review' THEN reason:=e.reason; END IF;
  IF phase='needs_review' THEN reason:=coalesce(reason,'format'); END IF;
  effect:=CASE WHEN phase='cancelled' THEN 0 ELSE amount END;
  IF e.transaction_id IS NOT NULL THEN
   SELECT * INTO t FROM public.transactions WHERE id=e.transaction_id AND household_id=h FOR UPDATE;
   IF t.id IS NULL THEN
    UPDATE public.prior_bank_events SET suppressed=true,transaction_id=NULL WHERE id=e.id;CONTINUE;
   END IF;
   IF t.account_id IS DISTINCT FROM a.account_id OR t.kind<>'cashflow' OR t.import_origin IS DISTINCT FROM 'prior-auto'
    OR t.amount IS DISTINCT FROM abs(e.applied_amount) OR t.type IS DISTINCT FROM (CASE WHEN e.applied_amount<0 OR(e.applied_amount=0 AND e.bank_amount<0) THEN 'expense' ELSE 'income' END) OR t.date IS DISTINCT FROM e.day THEN reason:='edited'; END IF;
  END IF;
  IF reason IS NULL THEN
   -- Set state before zeroing the projection, so the finance trigger can verify cancellation.
   UPDATE public.prior_bank_events SET state=phase WHERE id=e.id;
   IF e.transaction_id IS NULL AND effect<>0 THEN
    INSERT INTO public.transactions(household_id,added_by,type,amount,category_id,comment,date,kind,account_id,import_origin)
     VALUES(h,p_owner,CASE WHEN effect<0 THEN 'expense' ELSE 'income' END,abs(effect),r->>'category',r->>'description',(r->>'day')::date,'cashflow',a.account_id,'prior-auto') RETURNING id INTO entry;
    n:=n+1;
   ELSIF e.transaction_id IS NOT NULL THEN
    entry:=e.transaction_id;
    UPDATE public.transactions SET amount=abs(effect),type=CASE WHEN effect=0 THEN type WHEN effect<0 THEN 'expense' ELSE 'income' END,date=CASE WHEN phase='cancelled' THEN e.day ELSE (r->>'day')::date END WHERE id=entry;
   END IF;
   IF e.applied_amount IS DISTINCT FROM effect OR old_phase IS DISTINCT FROM phase THEN changed:=changed+1; END IF;
  END IF;
  UPDATE public.prior_bank_events SET aliases=CASE WHEN r->>'key'=ANY(aliases) THEN aliases ELSE array_append(aliases,r->>'key') END,
   state=CASE WHEN reason IS NULL THEN phase ELSE 'needs_review' END,observed_state=phase,bank_amount=amount,
   applied_amount=CASE WHEN reason IS NULL THEN effect ELSE applied_amount END,transaction_id=coalesce(entry,transaction_id),
   original_amount=CASE WHEN phase='cancelled' THEN original_amount ELSE (r->>'originalAmount')::numeric END,original_currency=r->>'originalCurrency',reason=reason,
   day=CASE WHEN reason IS NULL AND phase<>'cancelled' THEN (r->>'day')::date ELSE day END,last_seen_at=now(),
   history=CASE WHEN old_amount IS DISTINCT FROM amount OR old_phase IS DISTINCT FROM phase THEN history||jsonb_build_array(jsonb_build_object('at',now(),'fromState',old_phase,'toState',phase,'oldAmount',old_amount::text,'amount',amount::text,'reason',reason,'observation',r->'legacy')) ELSE history END
   WHERE id=e.id RETURNING * INTO e;
  -- The old reviewed import must also see the settled alias as already accounted for.
  IF r->>'source'='history' AND (e.transaction_id IS NOT NULL OR e.suppressed) AND amount<>0 THEN
   PERFORM finance_private.prior_live_receipt(h,p_owner,a.source_key,r);
  END IF;
 END LOOP;
 FOR day_row IN SELECT d::date AS day FROM generate_series((p_snapshot->>'from')::timestamp,(p_snapshot->>'to')::timestamp,interval '1 day') d LOOP
  SELECT encode(sha256(convert_to(coalesce(string_agg((v->'canonical')::text,E'\n' ORDER BY (v->'canonical')::text),''),'UTF8')),'hex') INTO day_signature FROM jsonb_array_elements(rows) v WHERE v->>'source'='history' AND v->>'day'=day_row.day::text;
  UPDATE public.prior_import_days d SET signature=day_signature WHERE d.household_id=h AND d.source_key=a.source_key AND d.day=day_row.day;
 END LOOP;
 UPDATE public.prior_automation SET last_checked_at=now(),last_snapshot_at=(p_snapshot->>'fetchedAt')::timestamptz,next_run_at=date_trunc('minute',now())+interval '1 minute',issue=NULL,imported_count=imported_count+n,
  additional_count=(SELECT count(*) FROM public.prior_bank_events WHERE owner_id=p_owner AND household_id=h AND state='provisional' AND NOT suppressed) WHERE owner_id=p_owner;
 RETURN jsonb_build_object('imported',n,'updated',changed,'issue',NULL);
END $$;
REVOKE ALL ON FUNCTION public.complete_prior_live_job(UUID,UUID,UUID,JSONB,BOOLEAN) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.complete_prior_live_job(UUID,UUID,UUID,JSONB,BOOLEAN) TO service_role;

-- Preserve the legacy entrypoint; an old worker may not race a v2 financial commit.
DO $$ BEGIN
 IF to_regprocedure('finance_private.complete_prior_auto_job_v1(uuid,uuid,uuid,jsonb,jsonb,text)') IS NULL THEN
  ALTER FUNCTION public.complete_prior_auto_job(UUID,UUID,UUID,JSONB,JSONB,TEXT) SET SCHEMA finance_private;
  ALTER FUNCTION finance_private.complete_prior_auto_job(UUID,UUID,UUID,JSONB,JSONB,TEXT) RENAME TO complete_prior_auto_job_v1;
 END IF;
END $$;
REVOKE ALL ON FUNCTION finance_private.complete_prior_auto_job_v1(UUID,UUID,UUID,JSONB,JSONB,TEXT) FROM PUBLIC,anon,authenticated,service_role;
CREATE OR REPLACE FUNCTION public.complete_prior_auto_job(p_owner UUID,p_revision UUID,p_connection_revision UUID,p_snapshot JSONB DEFAULT NULL,p_categories JSONB DEFAULT '[]',p_issue TEXT DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE result JSONB;
BEGIN
 IF p_issue='gap' THEN
  UPDATE public.prior_automation a SET issue='gap',next_run_at='infinity'
   FROM public.profiles p,finance_private.prior_connections c
   WHERE a.owner_id=p_owner AND a.enabled AND a.revision=p_revision AND p.id=a.owner_id AND p.household_id=a.household_id
    AND c.owner_id=a.owner_id AND c.household_id=a.household_id AND c.revision=p_connection_revision;
  RETURN jsonb_build_object('imported',0);
 END IF;
 IF p_issue IS NULL AND EXISTS(SELECT 1 FROM public.prior_automation WHERE owner_id=p_owner AND live_enabled) THEN RETURN jsonb_build_object('imported',0); END IF;
 result:=finance_private.complete_prior_auto_job_v1(p_owner,p_revision,p_connection_revision,p_snapshot,p_categories,p_issue);
 IF result IS NOT NULL AND (p_issue='busy' OR (p_issue IS NULL AND result->>'issue' IS NULL)) THEN
  UPDATE public.prior_automation SET next_run_at=date_trunc('minute',now())+interval '1 minute' WHERE owner_id=p_owner AND revision=p_revision AND enabled;
 END IF;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.complete_prior_auto_job(UUID,UUID,UUID,JSONB,JSONB,TEXT) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.complete_prior_auto_job(UUID,UUID,UUID,JSONB,JSONB,TEXT) TO service_role;

CREATE OR REPLACE FUNCTION public.claim_prior_auto_job(p_ticket TEXT) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET statement_timeout='8s' AS $$
DECLARE owners JSONB;
BEGIN
 IF coalesce(p_ticket,'') !~ '^[a-f0-9]{64}$' THEN RETURN NULL; END IF;
 DELETE FROM finance_private.prior_auto_tickets WHERE token_hash=encode(sha256(convert_to(p_ticket,'UTF8')),'hex') AND expires_at>now();
 IF NOT FOUND THEN RETURN NULL; END IF;
 WITH due AS (
  SELECT a.owner_id FROM public.prior_automation a JOIN public.profiles p ON p.id=a.owner_id AND p.household_id=a.household_id
  JOIN finance_private.prior_connections c ON c.owner_id=a.owner_id AND c.household_id=a.household_id
  WHERE a.enabled AND a.next_run_at<=now() AND (c.secret_id IS NOT NULL OR (c.credential_secret_id IS NOT NULL AND NOT c.auth_blocked))
  ORDER BY a.next_run_at LIMIT 2 FOR UPDATE OF a SKIP LOCKED
 ), claimed AS (
  UPDATE public.prior_automation a SET last_attempt_at=now(),next_run_at=now()+interval '5 minutes' FROM due WHERE a.owner_id=due.owner_id RETURNING a.owner_id,a.revision,a.source_key,a.last_checked_at,a.started_on
 ) SELECT coalesce(jsonb_agg(to_jsonb(claimed)),'[]') INTO owners FROM claimed;
 RETURN owners;
END $$;
REVOKE ALL ON FUNCTION public.claim_prior_auto_job(TEXT) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_prior_auto_job(TEXT) TO service_role;

CREATE OR REPLACE FUNCTION finance_private.prior_profile_changed() RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF TG_OP='DELETE' OR OLD.household_id IS DISTINCT FROM NEW.household_id THEN DELETE FROM finance_private.prior_connections WHERE owner_id=OLD.id; END IF;
 RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION finance_private.prior_profile_changed() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS prior_profile_changed ON public.profiles;
CREATE TRIGGER prior_profile_changed AFTER UPDATE OF household_id OR DELETE ON public.profiles FOR EACH ROW EXECUTE FUNCTION finance_private.prior_profile_changed();

CREATE OR REPLACE FUNCTION public.resolve_prior_event(p_event UUID,p_action TEXT,p_amount NUMERIC,p_state TEXT) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE h UUID; e public.prior_bank_events; effect NUMERIC; entry UUID;
BEGIN
 h:=public.finance_household_lock();
 PERFORM pg_advisory_xact_lock(hashtextextended('prior-connection:'||auth.uid()::text,0));
 SELECT * INTO e FROM public.prior_bank_events WHERE id=p_event AND owner_id=auth.uid() AND household_id=h FOR UPDATE;
 IF e.id IS NULL OR e.state<>'needs_review' OR e.suppressed OR e.bank_amount IS DISTINCT FROM p_amount OR e.observed_state IS DISTINCT FROM p_state THEN RAISE EXCEPTION 'PRIOR_REVIEW_CHANGED'; END IF;
 IF p_action='ignore' THEN
  UPDATE public.prior_bank_events SET suppressed=true,reason='kept_by_user' WHERE id=e.id;RETURN;
 END IF;
 IF p_action<>'apply' OR p_state NOT IN ('provisional','posted','cancelled') OR (p_state<>'cancelled' AND p_amount=0) THEN RAISE EXCEPTION 'PRIOR_REVIEW_INPUT'; END IF;
 effect:=CASE WHEN p_state='cancelled' THEN 0 ELSE p_amount END;
 UPDATE public.prior_bank_events SET state=p_state WHERE id=e.id;
 entry:=e.transaction_id;
 IF entry IS NOT NULL THEN
  UPDATE public.transactions SET amount=abs(effect),type=CASE WHEN effect=0 THEN type WHEN effect<0 THEN 'expense' ELSE 'income' END,date=e.day
   WHERE id=entry AND household_id=h AND account_id=e.account_id AND kind='cashflow';
  IF NOT FOUND THEN RAISE EXCEPTION 'PRIOR_REVIEW_CHANGED'; END IF;
 ELSIF effect<>0 THEN
  INSERT INTO public.transactions(household_id,added_by,type,amount,category_id,comment,date,kind,account_id,import_origin)
   VALUES(h,auth.uid(),CASE WHEN effect<0 THEN 'expense' ELSE 'income' END,abs(effect),e.suggested_category,e.description,e.day,'cashflow',e.account_id,'prior-auto') RETURNING id INTO entry;
 END IF;
 UPDATE public.prior_bank_events SET transaction_id=entry,applied_amount=effect,reason=NULL,
  history=history||jsonb_build_array(jsonb_build_object('at',now(),'fromState',e.state,'toState',p_state,'oldAmount',e.applied_amount::text,'amount',effect::text,'reason','owner_confirmed')) WHERE id=e.id;
END $$;
REVOKE ALL ON FUNCTION public.resolve_prior_event(UUID,TEXT,NUMERIC,TEXT) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.resolve_prior_event(UUID,TEXT,NUMERIC,TEXT) TO authenticated;

NOTIFY pgrst,'reload schema';
COMMIT;
