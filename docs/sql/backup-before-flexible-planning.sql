-- One-time private snapshot immediately before flexible planning.
BEGIN;
CREATE SCHEMA finapp_planning_backup_20261013;
REVOKE ALL ON SCHEMA finapp_planning_backup_20261013 FROM PUBLIC,anon,authenticated;
CREATE TABLE finapp_planning_backup_20261013.transactions AS TABLE public.transactions;
CREATE TABLE finapp_planning_backup_20261013.goals AS TABLE public.savings_goals;
CREATE TABLE finapp_planning_backup_20261013.accounts AS TABLE public.accounts;
CREATE TABLE finapp_planning_backup_20261013.budgets AS TABLE public.category_budgets;
CREATE TABLE finapp_planning_backup_20261013.distributions AS TABLE public.income_distributions;
CREATE TABLE finapp_planning_backup_20261013.functions AS
 SELECT p.proname::text AS name,pg_get_functiondef(p.oid) AS definition FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='public' AND p.proname IN ('guard_distribution_link','update_finance_transaction');
DO $$ DECLARE item TEXT; BEGIN
 FOREACH item IN ARRAY ARRAY['transactions','goals','accounts','budgets','distributions','functions'] LOOP
  EXECUTE format('ALTER TABLE finapp_planning_backup_20261013.%I ENABLE ROW LEVEL SECURITY',item);
  EXECUTE format('REVOKE ALL ON TABLE finapp_planning_backup_20261013.%I FROM PUBLIC,anon,authenticated',item);
 END LOOP;
END $$;
COMMIT;
