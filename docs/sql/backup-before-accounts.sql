-- Private, same-project snapshot before the first accounts release.
-- Not an application migration. Run once immediately before applying the release.
-- This schema is not exposed through the Data API; only administrators can read it.
BEGIN;
CREATE SCHEMA finapp_release_backup_20261012;
REVOKE ALL ON SCHEMA finapp_release_backup_20261012 FROM PUBLIC, anon, authenticated;
CREATE TABLE finapp_release_backup_20261012.households AS TABLE public.households;
CREATE TABLE finapp_release_backup_20261012.profiles AS TABLE public.profiles;
CREATE TABLE finapp_release_backup_20261012.transactions AS TABLE public.transactions;
CREATE TABLE finapp_release_backup_20261012.savings_goals AS TABLE public.savings_goals;
CREATE TABLE finapp_release_backup_20261012.recurring_transactions AS TABLE public.recurring_transactions;
CREATE TABLE finapp_release_backup_20261012.schema_snapshot AS
  SELECT 'function'::text AS object_type, p.proname::text AS object_name, pg_get_functiondef(p.oid) AS definition
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.proname IN ('handle_new_user','get_my_household_id');
DO $$ DECLARE item TEXT; BEGIN
  FOREACH item IN ARRAY ARRAY['households','profiles','transactions','savings_goals','recurring_transactions','schema_snapshot'] LOOP
    EXECUTE format('ALTER TABLE finapp_release_backup_20261012.%I ENABLE ROW LEVEL SECURITY', item);
    EXECUTE format('REVOKE ALL ON TABLE finapp_release_backup_20261012.%I FROM PUBLIC, anon, authenticated', item);
  END LOOP;
END $$;
COMMIT;
