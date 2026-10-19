-- No credentials or financial payloads. Private short-lived rate/lease metadata only.
BEGIN;
CREATE SCHEMA IF NOT EXISTS finance_private;
REVOKE ALL ON SCHEMA finance_private FROM PUBLIC, anon, authenticated;
CREATE TABLE IF NOT EXISTS finance_private.prior_connection_attempts (
  scope TEXT PRIMARY KEY,
  household_id UUID NOT NULL REFERENCES public.households(id) ON DELETE CASCADE,
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  attempt_id UUID NOT NULL,
  last_started_at TIMESTAMPTZ NOT NULL,
  lease_until TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS prior_connection_attempts_expiry ON finance_private.prior_connection_attempts(last_started_at);
CREATE INDEX IF NOT EXISTS prior_connection_attempts_owner ON finance_private.prior_connection_attempts(owner_id,attempt_id);
CREATE INDEX IF NOT EXISTS prior_connection_attempts_household ON finance_private.prior_connection_attempts(household_id);
ALTER TABLE finance_private.prior_connection_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON finance_private.prior_connection_attempts FROM PUBLIC, anon, authenticated;
DO $$ DECLARE action TEXT;
BEGIN
  FOREACH action IN ARRAY ARRAY['SELECT','DELETE'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON finance_private.prior_connection_attempts','prior_connection_'||lower(action));
    EXECUTE format('CREATE POLICY %I ON finance_private.prior_connection_attempts FOR %s TO authenticated USING(household_id=(SELECT public.get_my_household_id()) AND owner_id=(SELECT auth.uid()))','prior_connection_'||lower(action),action);
  END LOOP;
  DROP POLICY IF EXISTS prior_connection_insert ON finance_private.prior_connection_attempts;
  CREATE POLICY prior_connection_insert ON finance_private.prior_connection_attempts FOR INSERT TO authenticated WITH CHECK(household_id=(SELECT public.get_my_household_id()) AND owner_id=(SELECT auth.uid()));
  DROP POLICY IF EXISTS prior_connection_update ON finance_private.prior_connection_attempts;
  CREATE POLICY prior_connection_update ON finance_private.prior_connection_attempts FOR UPDATE TO authenticated USING(household_id=(SELECT public.get_my_household_id()) AND owner_id=(SELECT auth.uid())) WITH CHECK(household_id=(SELECT public.get_my_household_id()) AND owner_id=(SELECT auth.uid()));
END $$;

CREATE OR REPLACE FUNCTION public.claim_prior_connection(p_owner UUID,p_login_key TEXT,p_attempt UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET statement_timeout='5s' AS $$
DECLARE h UUID; key TEXT; changed INTEGER;
BEGIN
  SELECT household_id INTO h FROM public.profiles WHERE id=p_owner;
  IF h IS NULL THEN RAISE EXCEPTION 'PRIOR_CONNECTION_MEMBER'; END IF;
  IF p_attempt IS NULL OR p_login_key IS NULL OR p_login_key !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'PRIOR_CONNECTION_FORMAT'; END IF;
  DELETE FROM finance_private.prior_connection_attempts WHERE last_started_at < now()-interval '7 days';
  FOREACH key IN ARRAY ARRAY['owner:'||p_owner::text,'login:'||p_login_key] LOOP
    INSERT INTO finance_private.prior_connection_attempts AS current(scope,household_id,owner_id,attempt_id,last_started_at,lease_until)
      VALUES(key,h,p_owner,p_attempt,now(),now()+interval '120 seconds')
    ON CONFLICT(scope) DO UPDATE SET household_id=EXCLUDED.household_id,owner_id=EXCLUDED.owner_id,attempt_id=EXCLUDED.attempt_id,last_started_at=EXCLUDED.last_started_at,lease_until=EXCLUDED.lease_until
      WHERE current.lease_until<=now() AND current.last_started_at<=now()-interval '60 seconds';
    GET DIAGNOSTICS changed=ROW_COUNT;
    IF changed<>1 THEN RAISE EXCEPTION 'PRIOR_CONNECTION_LIMIT'; END IF;
  END LOOP;
END $$;
CREATE OR REPLACE FUNCTION public.release_prior_connection(p_owner UUID,p_attempt UUID)
RETURNS VOID LANGUAGE sql SECURITY DEFINER SET search_path='' SET statement_timeout='5s' AS $$
  UPDATE finance_private.prior_connection_attempts SET lease_until=now() WHERE owner_id=p_owner AND attempt_id=p_attempt;
$$;
REVOKE ALL ON FUNCTION public.claim_prior_connection(UUID,TEXT,UUID),public.release_prior_connection(UUID,UUID) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_prior_connection(UUID,TEXT,UUID),public.release_prior_connection(UUID,UUID) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
