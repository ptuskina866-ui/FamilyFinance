-- Private snapshot immediately before the shared-budgets release; run once.
BEGIN;
CREATE TABLE finapp_release_backup_20261012.transactions_before_budgets AS TABLE public.transactions;
CREATE TABLE finapp_release_backup_20261012.goals_before_budgets AS TABLE public.savings_goals;
CREATE TABLE finapp_release_backup_20261012.accounts_before_budgets AS TABLE public.accounts;
CREATE TABLE finapp_release_backup_20261012.functions_before_budgets AS
  SELECT p.proname::text AS object_name, pg_get_functiondef(p.oid) AS definition
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.proname IN ('change_goal_funds','delete_finance_transaction','update_finance_transaction');
DO $$ DECLARE item TEXT; BEGIN
  FOREACH item IN ARRAY ARRAY['transactions_before_budgets','goals_before_budgets','accounts_before_budgets','functions_before_budgets'] LOOP
    EXECUTE format('ALTER TABLE finapp_release_backup_20261012.%I ENABLE ROW LEVEL SECURITY',item);
    EXECUTE format('REVOKE ALL ON TABLE finapp_release_backup_20261012.%I FROM PUBLIC,anon,authenticated',item);
  END LOOP;
END $$;
COMMIT;
