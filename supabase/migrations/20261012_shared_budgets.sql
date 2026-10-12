-- Shared monthly envelopes and confirmed, one-use income allocation.
BEGIN;
CREATE TABLE IF NOT EXISTS public.category_budgets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id UUID NOT NULL REFERENCES public.households(id) ON DELETE CASCADE,
  month DATE NOT NULL CHECK (extract(day FROM month)=1),
  category_id TEXT NOT NULL CHECK (length(btrim(category_id)) BETWEEN 1 AND 64 AND category_id <> 'salary' AND category_id !~ '^income-'),
  allocated_amount NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (allocated_amount>=0 AND allocated_amount::text NOT IN ('NaN','Infinity','-Infinity')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (household_id,month,category_id)
);
CREATE TABLE IF NOT EXISTS public.income_distributions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id UUID NOT NULL REFERENCES public.households(id) ON DELETE CASCADE,
  income_transaction_id UUID NOT NULL UNIQUE REFERENCES public.transactions(id),
  month DATE NOT NULL,
  total_amount NUMERIC(12,2) NOT NULL CHECK (total_amount>0 AND total_amount::text NOT IN ('NaN','Infinity','-Infinity')),
  items JSONB NOT NULL CHECK (jsonb_typeof(items)='array'),
  created_by UUID NOT NULL REFERENCES public.profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS income_distributions_household_month_idx ON public.income_distributions(household_id,month);
ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS income_distribution_id UUID REFERENCES public.income_distributions(id);

CREATE OR REPLACE FUNCTION public.guard_distribution_link()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path='' AS $$
DECLARE privileged BOOLEAN;
BEGIN
  SELECT rolsuper OR rolbypassrls INTO privileged FROM pg_catalog.pg_roles WHERE rolname=current_user;
  IF NEW.income_distribution_id IS NOT NULL THEN
    IF NOT COALESCE(privileged,false) THEN RAISE EXCEPTION 'Use income distribution RPC'; END IF;
    IF NEW.kind<>'goal_deposit' OR NOT EXISTS(SELECT 1 FROM public.income_distributions WHERE id=NEW.income_distribution_id AND household_id=NEW.household_id) THEN
      RAISE EXCEPTION 'Distribution must belong to the goal movement household';
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS guard_distribution_link ON public.transactions;
CREATE TRIGGER guard_distribution_link BEFORE INSERT OR UPDATE ON public.transactions FOR EACH ROW EXECUTE FUNCTION public.guard_distribution_link();
REVOKE ALL ON FUNCTION public.guard_distribution_link() FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.finance_current_month()
RETURNS DATE LANGUAGE sql STABLE SET search_path='' AS $$
  SELECT date_trunc('month',now() AT TIME ZONE 'Europe/Minsk')::date;
$$;
CREATE OR REPLACE FUNCTION public.finance_budget_reserved(p_household UUID)
RETURNS NUMERIC LANGUAGE sql STABLE SET search_path='' AS $$
  SELECT COALESCE(sum(greatest(0,b.allocated_amount-COALESCE((SELECT sum(t.amount)
    FROM public.transactions t WHERE t.household_id=b.household_id AND t.kind='cashflow' AND t.type='expense'
      AND (t.category_id=b.category_id OR (b.category_id='food' AND t.category_id LIKE 'food-%')) AND t.date>=b.month AND t.date<(b.month+interval '1 month')::date),0))),0)
  FROM public.category_budgets b WHERE b.household_id=p_household AND b.month=public.finance_current_month();
$$;
CREATE OR REPLACE FUNCTION public.finance_reserved(p_household UUID)
RETURNS NUMERIC LANGUAGE sql STABLE SET search_path='' AS $$
  SELECT COALESCE((SELECT sum(current_amount) FROM public.savings_goals WHERE household_id=p_household AND NOT is_archived),0)
    +public.finance_budget_reserved(p_household);
$$;
CREATE OR REPLACE FUNCTION public.guard_planning_write()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path='' AS $$
DECLARE privileged BOOLEAN;
BEGIN
  SELECT rolsuper OR rolbypassrls INTO privileged FROM pg_catalog.pg_roles WHERE rolname=current_user;
  IF NOT COALESCE(privileged,false) THEN RAISE EXCEPTION 'Use planning RPC for budgets and income distribution'; END IF;
  IF TG_OP='UPDATE' AND NEW.household_id IS DISTINCT FROM OLD.household_id THEN RAISE EXCEPTION 'Planning records cannot change household'; END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.set_category_budget(p_category_id TEXT,p_amount NUMERIC,p_month DATE)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE h UUID; old_free NUMERIC; new_free NUMERIC; result_id UUID;
BEGIN
  h:=public.finance_household_lock();
  IF p_month IS DISTINCT FROM public.finance_current_month() THEN RAISE EXCEPTION 'Only the current month can be funded'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.accounts WHERE household_id=h AND NOT is_archived) THEN RAISE EXCEPTION 'Initialize accounts first'; END IF;
  IF p_amount IS NULL OR p_amount<0 OR p_amount::text IN ('NaN','Infinity','-Infinity') OR p_amount<>round(p_amount,2) OR p_amount>9999999999.99 THEN RAISE EXCEPTION 'Budget amount must be nonnegative with at most two decimals'; END IF;
  old_free:=public.finance_capital(h)-public.finance_reserved(h);
  IF p_amount>0 AND EXISTS(SELECT 1 FROM public.category_budgets WHERE household_id=h AND month=p_month AND allocated_amount>0 AND category_id<>btrim(p_category_id)
    AND ((btrim(p_category_id)='food' AND category_id LIKE 'food-%') OR (btrim(p_category_id) LIKE 'food-%' AND category_id='food'))) THEN RAISE EXCEPTION 'Food budgets overlap'; END IF;
  INSERT INTO public.category_budgets(household_id,month,category_id,allocated_amount)
    VALUES(h,p_month,btrim(p_category_id),p_amount)
    ON CONFLICT(household_id,month,category_id) DO UPDATE SET allocated_amount=excluded.allocated_amount,updated_at=now()
    RETURNING id INTO result_id;
  new_free:=public.finance_capital(h)-public.finance_reserved(h);
  IF new_free<0 AND new_free<old_free THEN RAISE EXCEPTION 'Insufficient unassigned funds'; END IF;
  RETURN result_id;
END $$;

CREATE OR REPLACE FUNCTION public.distribute_income(p_income_id UUID,p_items JSONB,p_month DATE)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE h UUID; source public.transactions%ROWTYPE; item JSONB; amount NUMERIC; total NUMERIC:=0; distribution UUID; movement UUID; base NUMERIC; spent NUMERIC;
BEGIN
  h:=public.finance_household_lock();
  IF p_month IS DISTINCT FROM public.finance_current_month() THEN RAISE EXCEPTION 'Only the current month can be funded'; END IF;
  SELECT * INTO source FROM public.transactions WHERE id=p_income_id AND household_id=h FOR UPDATE;
  IF NOT FOUND OR source.kind<>'cashflow' OR source.type<>'income' OR source.date<p_month OR source.date>=(p_month+interval '1 month')::date
    OR source.date>(now() AT TIME ZONE 'Europe/Minsk')::date THEN RAISE EXCEPTION 'A posted income from this month is required'; END IF;
  IF EXISTS(SELECT 1 FROM public.income_distributions WHERE income_transaction_id=p_income_id) THEN RAISE EXCEPTION 'Income already distributed'; END IF;
  IF p_items IS NULL OR jsonb_typeof(p_items)<>'array' OR jsonb_array_length(p_items) NOT BETWEEN 1 AND 32 THEN RAISE EXCEPTION 'Choose at least one allocation'; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_items) x GROUP BY x->>'targetType',x->>'targetId' HAVING count(*)>1) THEN RAISE EXCEPTION 'Duplicate allocation target'; END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(p_items) LOOP
    IF item->>'targetType' NOT IN ('budget','goal') OR item->>'targetType' IS NULL OR NULLIF(btrim(item->>'targetId'),'') IS NULL
      OR item->>'targetId' IS DISTINCT FROM btrim(item->>'targetId') THEN RAISE EXCEPTION 'Invalid allocation target'; END IF;
    amount:=(item->>'amount')::numeric;
    PERFORM public.finance_validate_amount(amount);
    total:=total+amount;
  END LOOP;
  IF total>source.amount OR total>public.finance_capital(h)-public.finance_reserved(h) THEN RAISE EXCEPTION 'Allocation exceeds income or unassigned funds'; END IF;
  INSERT INTO public.income_distributions(household_id,income_transaction_id,month,total_amount,items,created_by)
    VALUES(h,p_income_id,p_month,total,p_items,auth.uid()) RETURNING id INTO distribution;
  FOR item IN SELECT value FROM jsonb_array_elements(p_items) LOOP
    amount:=(item->>'amount')::numeric;
    IF item->>'targetType'='budget' THEN
      SELECT COALESCE(max(allocated_amount),0) INTO base FROM public.category_budgets WHERE household_id=h AND month=p_month AND category_id=item->>'targetId';
      SELECT COALESCE(sum(t.amount),0) INTO spent FROM public.transactions t WHERE t.household_id=h AND t.kind='cashflow' AND t.type='expense'
        AND (t.category_id=item->>'targetId' OR (item->>'targetId'='food' AND t.category_id LIKE 'food-%')) AND t.date>=p_month AND t.date<(p_month+interval '1 month')::date;
      PERFORM public.set_category_budget(item->>'targetId',greatest(base,spent)+amount,p_month);
    ELSE
      movement:=public.change_goal_funds((item->>'targetId')::uuid,amount,(now() AT TIME ZONE 'Europe/Minsk')::date);
      UPDATE public.transactions SET income_distribution_id=distribution WHERE id=movement;
    END IF;
  END LOOP;
  RETURN distribution;
END $$;

DO $$ DECLARE item TEXT; action TEXT; BEGIN
  FOREACH item IN ARRAY ARRAY['category_budgets','income_distributions'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',item);
    FOREACH action IN ARRAY ARRAY['SELECT','INSERT','UPDATE','DELETE'] LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I',item||'_household_'||lower(action),item);
      IF action='SELECT' OR action='DELETE' THEN
        EXECUTE format('CREATE POLICY %I ON public.%I FOR %s TO authenticated USING(household_id=public.get_my_household_id())',item||'_household_'||lower(action),item,action);
      ELSIF action='INSERT' THEN
        EXECUTE format('CREATE POLICY %I ON public.%I FOR INSERT TO authenticated WITH CHECK(household_id=public.get_my_household_id())',item||'_household_insert',item);
      ELSE
        EXECUTE format('CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated USING(household_id=public.get_my_household_id()) WITH CHECK(household_id=public.get_my_household_id())',item||'_household_update',item);
      END IF;
    END LOOP;
    EXECUTE format('REVOKE ALL ON public.%I FROM anon,authenticated',item);
    EXECUTE format('GRANT SELECT ON public.%I TO authenticated',item);
    EXECUTE format('DROP TRIGGER IF EXISTS guard_planning_write ON public.%I',item);
    EXECUTE format('CREATE TRIGGER guard_planning_write BEFORE INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.guard_planning_write()',item);
    IF EXISTS(SELECT 1 FROM pg_publication WHERE pubname='supabase_realtime') AND NOT EXISTS(SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename=item) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I',item);
    END IF;
  END LOOP;
END $$;
REVOKE ALL ON FUNCTION public.finance_current_month(),public.finance_budget_reserved(UUID),public.finance_reserved(UUID),public.guard_planning_write() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.set_category_budget(TEXT,NUMERIC,DATE),public.distribute_income(UUID,JSONB,DATE) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.set_category_budget(TEXT,NUMERIC,DATE),public.distribute_income(UUID,JSONB,DATE) TO authenticated;
-- Updated atomic money functions are appended below before the final COMMIT.

CREATE OR REPLACE FUNCTION public.change_goal_funds(p_goal_id UUID, p_amount NUMERIC, p_date DATE)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_household UUID; v_goal public.savings_goals%ROWTYPE; v_reserved NUMERIC; v_id UUID;
BEGIN
  v_household := public.finance_household_lock();
  PERFORM public.finance_validate_amount(p_amount, true);
  IF p_date IS NULL THEN RAISE EXCEPTION 'Date required'; END IF;
  SELECT * INTO v_goal FROM public.savings_goals WHERE id = p_goal_id AND household_id = v_household FOR UPDATE;
  IF NOT FOUND OR v_goal.is_archived THEN RAISE EXCEPTION 'Active household goal required'; END IF;
  SELECT public.finance_reserved(v_household) INTO v_reserved;
  IF p_amount > 0 AND public.finance_capital(v_household) - v_reserved < p_amount THEN RAISE EXCEPTION 'Insufficient unreserved funds'; END IF;
  IF v_goal.current_amount + p_amount < 0 THEN RAISE EXCEPTION 'Cannot release more than the saved amount'; END IF;
  UPDATE public.savings_goals SET current_amount = current_amount + p_amount WHERE id = p_goal_id;
  INSERT INTO public.transactions(household_id, type, amount, category_id, comment, added_by, date, kind, goal_id)
    VALUES (v_household, CASE WHEN p_amount > 0 THEN 'expense' ELSE 'income' END, abs(p_amount), 'savings',
      CASE WHEN p_amount > 0 THEN 'Резервирование: ' ELSE 'Возврат из цели: ' END || v_goal.name,
      auth.uid(), p_date, CASE WHEN p_amount > 0 THEN 'goal_deposit' ELSE 'goal_release' END, p_goal_id) RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_finance_transaction(p_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_household UUID; v_tx public.transactions%ROWTYPE; v_goal public.savings_goals%ROWTYPE; v_reserved NUMERIC; v_new_capital NUMERIC;
BEGIN
  v_household := public.finance_household_lock();
  SELECT * INTO v_tx FROM public.transactions WHERE id = p_id AND household_id = v_household FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Household transaction required'; END IF;
  IF EXISTS(SELECT 1 FROM public.income_distributions WHERE income_transaction_id=p_id) THEN RAISE EXCEPTION 'Distributed income history cannot be deleted'; END IF;
  IF v_tx.kind IN ('goal_deposit', 'goal_release') AND v_tx.goal_id IS NOT NULL THEN
    SELECT * INTO v_goal FROM public.savings_goals WHERE id = v_tx.goal_id AND household_id = v_household FOR UPDATE;
    IF NOT FOUND OR v_goal.is_archived THEN RAISE EXCEPTION 'Cannot reverse movements of an archived goal'; END IF;
    IF v_tx.kind = 'goal_deposit' AND v_goal.current_amount < v_tx.amount THEN RAISE EXCEPTION 'Goal funds have already been released'; END IF;
    IF v_tx.kind = 'goal_release' THEN
      SELECT public.finance_reserved(v_household) INTO v_reserved;
      IF public.finance_capital(v_household) - v_reserved < v_tx.amount THEN RAISE EXCEPTION 'Insufficient funds to restore the reservation'; END IF;
    END IF;
    UPDATE public.savings_goals SET current_amount = current_amount + CASE WHEN v_tx.kind = 'goal_deposit' THEN -v_tx.amount ELSE v_tx.amount END WHERE id = v_tx.goal_id;
  ELSIF v_tx.kind = 'transfer' THEN
    IF public.finance_account_balance(v_tx.target_account_id) < v_tx.amount THEN RAISE EXCEPTION 'Transferred funds have already been spent'; END IF;
  ELSIF v_tx.kind = 'cashflow' AND v_tx.type = 'income' THEN
    SELECT public.finance_reserved(v_household) INTO v_reserved;
    v_new_capital := public.finance_capital(v_household) - v_tx.amount;
    IF v_reserved > 0 AND v_new_capital < v_reserved THEN RAISE EXCEPTION 'Release goal reservations before deleting this income'; END IF;
  END IF;
  DELETE FROM public.transactions WHERE id = p_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_finance_transaction(p_id UUID, p_type TEXT, p_amount NUMERIC,
  p_category_id TEXT, p_comment TEXT, p_added_by UUID, p_date DATE, p_account_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_household UUID; v_tx public.transactions%ROWTYPE; v_capital NUMERIC; v_new_capital NUMERIC; v_reserved NUMERIC;
BEGIN
  v_household := public.finance_household_lock();
  PERFORM public.finance_validate_amount(p_amount);
  SELECT * INTO v_tx FROM public.transactions WHERE id = p_id AND household_id = v_household FOR UPDATE;
  IF NOT FOUND OR v_tx.kind <> 'cashflow' THEN RAISE EXCEPTION 'Household cashflow transaction required'; END IF;
  IF EXISTS(SELECT 1 FROM public.income_distributions WHERE income_transaction_id=p_id AND (p_type<>'income' OR p_amount<total_amount OR p_date IS DISTINCT FROM v_tx.date)) THEN RAISE EXCEPTION 'Distributed income must preserve its date, type and allocated amount'; END IF;
  IF p_type IS NULL OR p_type NOT IN ('income', 'expense') OR p_date IS NULL
    OR p_category_id IS NULL OR length(btrim(p_category_id)) = 0 THEN RAISE EXCEPTION 'Valid type, category and date required'; END IF;
  IF p_account_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.accounts WHERE id = p_account_id AND household_id = v_household AND NOT is_archived) THEN
    RAISE EXCEPTION 'Active household account required';
  END IF;
  IF p_added_by IS NULL OR NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_added_by AND household_id = v_household) THEN
    RAISE EXCEPTION 'Household member required';
  END IF;
  IF v_tx.recurring_id IS NOT NULL AND p_date IS DISTINCT FROM v_tx.date THEN
    RAISE EXCEPTION 'Recurring occurrence date cannot change; edit its amount or other details';
  END IF;
  v_capital := public.finance_capital(v_household);
  v_new_capital := v_capital - CASE WHEN v_tx.type = 'income' THEN v_tx.amount ELSE -v_tx.amount END
    + CASE WHEN p_type = 'income' THEN p_amount ELSE -p_amount END;
  SELECT public.finance_reserved(v_household) INTO v_reserved;
  UPDATE public.transactions SET type = p_type, amount = p_amount, category_id = p_category_id,
    comment = COALESCE(p_comment, ''), added_by = p_added_by, date = p_date, account_id = p_account_id WHERE id = p_id;
  IF v_new_capital-public.finance_reserved(v_household)<0 AND v_new_capital-public.finance_reserved(v_household)<v_capital-v_reserved THEN RAISE EXCEPTION 'Release goal reservations or budgets before reducing unassigned funds'; END IF;
END;
$$;

-- Keep the accounts capability marker compatible with already installed PWA clients.
CREATE OR REPLACE FUNCTION public.finance_planning_version() RETURNS INTEGER LANGUAGE sql IMMUTABLE SET search_path='' AS $$ SELECT 1; $$;
REVOKE ALL ON FUNCTION public.finance_planning_version() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.finance_planning_version() TO anon,authenticated;
NOTIFY pgrst, 'reload schema';
COMMIT;
