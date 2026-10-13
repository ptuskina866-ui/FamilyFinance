-- Additive planning tools. Existing cashflow amounts/categories remain untouched.
BEGIN;
CREATE SCHEMA IF NOT EXISTS finance_private;
REVOKE ALL ON SCHEMA finance_private FROM PUBLIC,anon,authenticated;
ALTER TABLE public.income_distributions ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','cancelled'));
ALTER TABLE public.income_distributions ADD COLUMN IF NOT EXISTS revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0);
ALTER TABLE public.income_distributions ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE public.savings_goals ADD COLUMN IF NOT EXISTS purpose TEXT NOT NULL DEFAULT 'goal' CHECK(purpose IN ('goal','emergency','expense_fund'));
ALTER TABLE public.savings_goals ADD COLUMN IF NOT EXISTS essential_amount NUMERIC(12,2);
ALTER TABLE public.savings_goals ADD COLUMN IF NOT EXISTS reserve_months INTEGER;
ALTER TABLE public.savings_goals ADD COLUMN IF NOT EXISTS essential_categories TEXT[] NOT NULL DEFAULT '{}';
DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='fund_target_consistent' AND conrelid='public.savings_goals'::regclass) THEN
    ALTER TABLE public.savings_goals ADD CONSTRAINT fund_target_consistent CHECK(
      (purpose='emergency' AND essential_amount IS NOT NULL AND essential_amount>0 AND essential_amount::text NOT IN ('NaN','Infinity','-Infinity') AND reserve_months IS NOT NULL AND reserve_months BETWEEN 1 AND 12 AND target_amount=essential_amount*reserve_months AND deadline IS NULL)
      OR (purpose<>'emergency' AND essential_amount IS NULL AND reserve_months IS NULL));
  END IF;
END $$;
CREATE TABLE IF NOT EXISTS public.income_templates(
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),household_id UUID NOT NULL REFERENCES public.households(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK(length(btrim(name)) BETWEEN 1 AND 80),items JSONB NOT NULL CHECK(jsonb_typeof(items)='array'),
  is_archived BOOLEAN NOT NULL DEFAULT false,created_at TIMESTAMPTZ NOT NULL DEFAULT now(),updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS income_templates_household_idx ON public.income_templates(household_id);
CREATE TABLE IF NOT EXISTS public.budget_rollovers(
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),household_id UUID NOT NULL REFERENCES public.households(id) ON DELETE CASCADE,
  source_month DATE NOT NULL,target_month DATE NOT NULL,mode TEXT NOT NULL CHECK(mode IN ('repeat','carry','goal','release')),
  amount NUMERIC(12,2) NOT NULL CHECK(amount>=0 AND amount::text NOT IN ('NaN','Infinity','-Infinity')),items JSONB NOT NULL,
  created_by UUID NOT NULL REFERENCES public.profiles(id),created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(household_id,source_month),CHECK(target_month=(source_month+interval '1 month')::date AND extract(day FROM source_month)=1)
);
CREATE TABLE IF NOT EXISTS public.income_distribution_revisions(
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),household_id UUID NOT NULL REFERENCES public.households(id) ON DELETE CASCADE,
  distribution_id UUID NOT NULL REFERENCES public.income_distributions(id),revision INTEGER NOT NULL,
  action TEXT NOT NULL CHECK(action IN ('edit','cancel')),before_state JSONB NOT NULL,after_state JSONB NOT NULL,refund JSONB NOT NULL,
  created_by UUID NOT NULL REFERENCES public.profiles(id),created_at TIMESTAMPTZ NOT NULL DEFAULT now(),UNIQUE(distribution_id,revision)
);
CREATE INDEX IF NOT EXISTS distribution_revisions_household_idx ON public.income_distribution_revisions(household_id);

CREATE OR REPLACE FUNCTION finance_private.budget_spent(h UUID,category TEXT,month DATE)
RETURNS NUMERIC LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT COALESCE(sum(amount),0) FROM public.transactions WHERE household_id=h AND kind='cashflow' AND type='expense'
 AND (category_id=category OR (category='food' AND category_id LIKE 'food-%')) AND date>=month AND date<(month+interval '1 month')::date;
$$;
CREATE OR REPLACE FUNCTION public.transfer_category_budget(p_from TEXT,p_to TEXT,p_amount NUMERIC,p_month DATE)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE h UUID; source public.category_budgets%ROWTYPE; target NUMERIC; old_free NUMERIC;
BEGIN
 h:=public.finance_household_lock(); PERFORM public.finance_validate_amount(p_amount);
 IF p_month IS DISTINCT FROM public.finance_current_month() OR p_from IS NULL OR p_to IS NULL OR p_from=p_to OR p_from<>btrim(p_from) OR p_to<>btrim(p_to) THEN RAISE EXCEPTION 'Choose different current-month categories'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.accounts WHERE household_id=h AND NOT is_archived) THEN RAISE EXCEPTION 'Initialize accounts first'; END IF;
 SELECT * INTO source FROM public.category_budgets WHERE household_id=h AND month=p_month AND category_id=p_from FOR UPDATE;
 IF NOT FOUND OR greatest(0,source.allocated_amount-finance_private.budget_spent(h,p_from,p_month))<p_amount THEN RAISE EXCEPTION 'Transfer exceeds category remainder'; END IF;
 old_free:=public.finance_capital(h)-public.finance_reserved(h);
 UPDATE public.category_budgets SET allocated_amount=allocated_amount-p_amount,updated_at=now() WHERE id=source.id;
 SELECT greatest(COALESCE(max(allocated_amount),0),finance_private.budget_spent(h,p_to,p_month)) INTO target FROM public.category_budgets WHERE household_id=h AND month=p_month AND category_id=p_to;
 IF EXISTS(SELECT 1 FROM public.category_budgets WHERE household_id=h AND month=p_month AND allocated_amount>0 AND category_id<>p_to
  AND ((p_to='food' AND category_id LIKE 'food-%') OR (p_to LIKE 'food-%' AND category_id='food'))) THEN RAISE EXCEPTION 'Food budgets overlap'; END IF;
 INSERT INTO public.category_budgets(household_id,month,category_id,allocated_amount) VALUES(h,p_month,p_to,target+p_amount)
 ON CONFLICT(household_id,month,category_id) DO UPDATE SET allocated_amount=excluded.allocated_amount,updated_at=now();
 IF public.finance_capital(h)-public.finance_reserved(h) IS DISTINCT FROM old_free THEN RAISE EXCEPTION 'Budget transfer must preserve free funds'; END IF;
END $$;

CREATE OR REPLACE FUNCTION finance_private.distribution_refund(h UUID,distribution UUID)
RETURNS JSONB LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT COALESCE(jsonb_agg(jsonb_build_object('targetType',i->>'targetType','targetId',i->>'targetId','amount',
 least((i->>'amount')::numeric,CASE WHEN i->>'targetType'='budget' THEN
   COALESCE((SELECT greatest(0,b.allocated_amount-finance_private.budget_spent(h,b.category_id,b.month)) FROM public.category_budgets b WHERE b.household_id=h AND b.month=d.month AND b.category_id=i->>'targetId'),0)
 ELSE COALESCE((SELECT greatest(0,least(g.current_amount,COALESCE((SELECT sum(CASE WHEN t.kind='goal_deposit' THEN t.amount WHEN t.kind='goal_release' THEN -t.amount ELSE 0 END) FROM public.transactions t WHERE t.household_id=h AND t.income_distribution_id=d.id AND t.goal_id=g.id),0))) FROM public.savings_goals g WHERE g.household_id=h AND g.id=(i->>'targetId')::uuid AND NOT g.is_archived),0) END)) ORDER BY ord),'[]'::jsonb)
 FROM public.income_distributions d CROSS JOIN LATERAL jsonb_array_elements(d.items) WITH ORDINALITY x(i,ord)
 WHERE d.id=distribution AND d.household_id=h AND d.status='active';
$$;
CREATE OR REPLACE FUNCTION public.guard_distribution_link()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path='' AS $$
DECLARE privileged BOOLEAN;
BEGIN
 SELECT rolsuper OR rolbypassrls INTO privileged FROM pg_catalog.pg_roles WHERE rolname=current_user;
 IF NEW.income_distribution_id IS NOT NULL THEN
  IF NOT COALESCE(privileged,false) THEN RAISE EXCEPTION 'Use income distribution RPC'; END IF;
  IF NEW.kind NOT IN ('goal_deposit','goal_release') OR NOT EXISTS(SELECT 1 FROM public.income_distributions WHERE id=NEW.income_distribution_id AND household_id=NEW.household_id) THEN RAISE EXCEPTION 'Distribution must belong to the goal movement household'; END IF;
 END IF; RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION public.change_income_distribution(p_id UUID,p_items JSONB,p_expected_revision INTEGER,p_refund_preview JSONB)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE h UUID; d public.income_distributions%ROWTYPE; source public.transactions%ROWTYPE; item JSONB; amount NUMERIC; total NUMERIC:=0; refund JSONB; movement UUID; before_state JSONB; base NUMERIC;
BEGIN
 h:=public.finance_household_lock();
 SELECT * INTO d FROM public.income_distributions WHERE id=p_id AND household_id=h FOR UPDATE;
 IF NOT FOUND OR d.month<>public.finance_current_month() THEN RAISE EXCEPTION 'Current-month household distribution required'; END IF;
 IF p_expected_revision IS DISTINCT FROM d.revision THEN RAISE EXCEPTION 'Distribution changed; refresh the preview'; END IF;
 refund:=finance_private.distribution_refund(h,d.id);
 IF p_refund_preview IS DISTINCT FROM refund THEN RAISE EXCEPTION 'Reservations changed; refresh the preview'; END IF;
 IF d.status='cancelled' AND p_items IS NULL THEN RETURN; END IF;
 before_state:=to_jsonb(d);
 SELECT * INTO source FROM public.transactions WHERE id=d.income_transaction_id AND household_id=h FOR UPDATE;
 IF NOT FOUND OR source.type<>'income' OR source.kind<>'cashflow' OR source.date>(now() AT TIME ZONE 'Europe/Minsk')::date THEN RAISE EXCEPTION 'Posted household income required'; END IF;
 IF p_items IS NOT NULL THEN
  IF jsonb_typeof(p_items)<>'array' OR jsonb_array_length(p_items) NOT BETWEEN 1 AND 32 THEN RAISE EXCEPTION 'Choose at least one allocation'; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_items) i GROUP BY i->>'targetType',i->>'targetId' HAVING count(*)>1) THEN RAISE EXCEPTION 'Duplicate allocation target'; END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(p_items) LOOP
   IF item->>'targetType' IS NULL OR item->>'targetType' NOT IN ('budget','goal') OR NULLIF(btrim(item->>'targetId'),'') IS NULL OR item->>'targetId' IS DISTINCT FROM btrim(item->>'targetId') THEN RAISE EXCEPTION 'Invalid allocation target'; END IF;
   amount:=(item->>'amount')::numeric; PERFORM public.finance_validate_amount(amount); total:=total+amount;
  END LOOP;
  IF total>source.amount THEN RAISE EXCEPTION 'Allocation exceeds income or unassigned funds'; END IF;
 END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(refund) LOOP
  amount:=(item->>'amount')::numeric; IF amount<=0 THEN CONTINUE; END IF;
  IF item->>'targetType'='budget' THEN
   UPDATE public.category_budgets SET allocated_amount=allocated_amount-amount,updated_at=now() WHERE household_id=h AND month=d.month AND category_id=item->>'targetId';
  ELSE
   movement:=public.change_goal_funds((item->>'targetId')::uuid,-amount,(now() AT TIME ZONE 'Europe/Minsk')::date);
   UPDATE public.transactions SET income_distribution_id=d.id WHERE id=movement;
  END IF;
 END LOOP;
 IF p_items IS NOT NULL THEN
  IF total>public.finance_capital(h)-public.finance_reserved(h) THEN RAISE EXCEPTION 'Allocation exceeds income or unassigned funds'; END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(p_items) LOOP
   amount:=(item->>'amount')::numeric;
   IF item->>'targetType'='budget' THEN
    SELECT greatest(COALESCE(max(allocated_amount),0),finance_private.budget_spent(h,item->>'targetId',d.month)) INTO base FROM public.category_budgets WHERE household_id=h AND month=d.month AND category_id=item->>'targetId';
    PERFORM public.set_category_budget(item->>'targetId',base+amount,d.month);
   ELSE
    movement:=public.change_goal_funds((item->>'targetId')::uuid,amount,(now() AT TIME ZONE 'Europe/Minsk')::date);
    UPDATE public.transactions SET income_distribution_id=d.id WHERE id=movement;
   END IF;
  END LOOP;
 END IF;
 UPDATE public.income_distributions SET status=CASE WHEN p_items IS NULL THEN 'cancelled' ELSE 'active' END,
  items=COALESCE(p_items,items),total_amount=CASE WHEN p_items IS NULL THEN total_amount ELSE total END,revision=revision+1,updated_at=now() WHERE id=d.id RETURNING * INTO d;
 INSERT INTO public.income_distribution_revisions(household_id,distribution_id,revision,action,before_state,after_state,refund,created_by)
 VALUES(h,d.id,d.revision,CASE WHEN p_items IS NULL THEN 'cancel' ELSE 'edit' END,before_state,to_jsonb(d),refund,auth.uid());
END $$;

CREATE OR REPLACE FUNCTION public.save_income_template(p_id UUID,p_name TEXT,p_items JSONB)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE h UUID; item JSONB; v_value NUMERIC; result UUID;
BEGIN
 h:=public.finance_household_lock();
 IF p_name IS NULL OR length(btrim(p_name)) NOT BETWEEN 1 AND 80 OR p_items IS NULL OR jsonb_typeof(p_items)<>'array' OR jsonb_array_length(p_items) NOT BETWEEN 1 AND 32 THEN RAISE EXCEPTION 'Valid template name and items required'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_items) i GROUP BY i->>'targetType',i->>'targetId' HAVING count(*)>1) THEN RAISE EXCEPTION 'Duplicate allocation target'; END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(p_items) LOOP
  IF item->>'mode' IS NULL OR item->>'mode' NOT IN ('fixed','percent') OR item->>'targetType' IS NULL OR item->>'targetType' NOT IN ('budget','goal') OR NULLIF(btrim(item->>'targetId'),'') IS NULL OR item->>'targetId' IS DISTINCT FROM btrim(item->>'targetId') THEN RAISE EXCEPTION 'Invalid template item'; END IF;
  v_value:=(item->>'value')::numeric; PERFORM public.finance_validate_amount(v_value);
  IF item->>'mode'='percent' AND v_value>100 THEN RAISE EXCEPTION 'Percentage must be at most 100'; END IF;
  IF item->>'targetType'='goal' AND NOT EXISTS(SELECT 1 FROM public.savings_goals WHERE household_id=h AND id=(item->>'targetId')::uuid AND NOT is_archived) THEN RAISE EXCEPTION 'Active household goal required'; END IF;
  IF item->>'targetType'='budget' AND (length(item->>'targetId')>64 OR item->>'targetId'='salary' OR item->>'targetId'='savings' OR item->>'targetId' LIKE 'income-%') THEN RAISE EXCEPTION 'Expense category required'; END IF;
 END LOOP;
 IF p_id IS NULL THEN
  INSERT INTO public.income_templates(household_id,name,items) VALUES(h,btrim(p_name),p_items) RETURNING id INTO result;
 ELSE
  UPDATE public.income_templates SET name=btrim(p_name),items=p_items,updated_at=now() WHERE id=p_id AND household_id=h AND NOT is_archived RETURNING id INTO result;
  IF NOT FOUND THEN RAISE EXCEPTION 'Household template required'; END IF;
 END IF; RETURN result;
END $$;
CREATE OR REPLACE FUNCTION public.archive_income_template(p_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE h UUID; BEGIN h:=public.finance_household_lock(); UPDATE public.income_templates SET is_archived=true,updated_at=now() WHERE id=p_id AND household_id=h; IF NOT FOUND THEN RAISE EXCEPTION 'Household template required'; END IF; END $$;

CREATE OR REPLACE FUNCTION public.review_budget_month(p_mode TEXT,p_goal_id UUID,p_preview JSONB)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE h UUID; v_month DATE; previous DATE; preview JSONB; b RECORD; amount NUMERIC; base NUMERIC; total NUMERIC:=0; old_free NUMERIC; result UUID;
BEGIN
 h:=public.finance_household_lock(); v_month:=public.finance_current_month(); previous:=(v_month-interval '1 month')::date;
 IF p_mode IS NULL OR p_mode NOT IN ('repeat','carry','goal','release') THEN RAISE EXCEPTION 'Valid month review mode required'; END IF;
 IF EXISTS(SELECT 1 FROM public.budget_rollovers WHERE household_id=h AND source_month=previous) THEN RAISE EXCEPTION 'Previous month already reviewed'; END IF;
 SELECT COALESCE(jsonb_agg(jsonb_build_object('targetType','budget','targetId',s.category_id,'amount',s.amount) ORDER BY s.category_id COLLATE "C"),'[]'::jsonb) INTO preview
 FROM(SELECT category_id,CASE WHEN p_mode='repeat' THEN allocated_amount ELSE greatest(0,allocated_amount-finance_private.budget_spent(h,category_id,previous)) END AS amount
 FROM public.category_budgets WHERE household_id=h AND month=previous) s WHERE s.amount>0;
 IF preview='[]'::jsonb THEN RAISE EXCEPTION 'No previous month funds or plan'; END IF;
 IF p_preview IS DISTINCT FROM preview THEN RAISE EXCEPTION 'Previous month changed; refresh the preview'; END IF;
 IF p_mode='repeat' AND EXISTS(SELECT 1 FROM public.category_budgets WHERE household_id=h AND month=v_month AND allocated_amount>0) THEN RAISE EXCEPTION 'Current month already has a plan'; END IF;
 old_free:=public.finance_capital(h)-public.finance_reserved(h);
 FOR b IN SELECT value AS item FROM jsonb_array_elements(preview) LOOP
  amount:=(b.item->>'amount')::numeric; total:=total+amount;
  IF p_mode IN ('repeat','carry') THEN
   SELECT COALESCE(max(allocated_amount),0) INTO base FROM public.category_budgets WHERE household_id=h AND month=v_month AND category_id=b.item->>'targetId';
   PERFORM public.set_category_budget(b.item->>'targetId',CASE WHEN p_mode='repeat' THEN amount ELSE greatest(base,finance_private.budget_spent(h,b.item->>'targetId',v_month))+amount END,v_month);
  END IF;
 END LOOP;
 IF p_mode='goal' THEN PERFORM public.change_goal_funds(p_goal_id,total,(now() AT TIME ZONE 'Europe/Minsk')::date); END IF;
 IF public.finance_capital(h)-public.finance_reserved(h)<0 AND public.finance_capital(h)-public.finance_reserved(h)<old_free THEN RAISE EXCEPTION 'Insufficient unassigned funds'; END IF;
 INSERT INTO public.budget_rollovers(household_id,source_month,target_month,mode,amount,items,created_by) VALUES(h,previous,v_month,p_mode,total,preview,auth.uid()) RETURNING id INTO result;
 RETURN result;
END $$;

CREATE OR REPLACE FUNCTION public.save_finance_fund(p_id UUID,p_name TEXT,p_purpose TEXT,p_target NUMERIC,p_deadline DATE,p_essential NUMERIC,p_months INTEGER,p_categories TEXT[])
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE h UUID; result UUID; target NUMERIC;
BEGIN
 h:=public.finance_household_lock();
 IF NOT EXISTS(SELECT 1 FROM public.accounts WHERE household_id=h AND NOT is_archived) THEN RAISE EXCEPTION 'Initialize accounts first'; END IF;
 IF p_name IS NULL OR length(btrim(p_name)) NOT BETWEEN 1 AND 80 OR p_purpose IS NULL OR p_purpose NOT IN ('emergency','expense_fund') THEN RAISE EXCEPTION 'Valid fund name and purpose required'; END IF;
 IF p_purpose='emergency' THEN
  PERFORM public.finance_validate_amount(p_essential);
  IF p_months IS NULL OR p_months NOT BETWEEN 1 AND 12 OR p_deadline IS NOT NULL THEN RAISE EXCEPTION 'Emergency reserve needs 1 to 12 months and no deadline'; END IF;
  target:=p_essential*p_months;
  IF p_categories IS NULL OR cardinality(p_categories) NOT BETWEEN 1 AND 32 OR EXISTS(SELECT 1 FROM unnest(p_categories) c WHERE c IS NULL OR length(btrim(c)) NOT BETWEEN 1 AND 64 OR c='salary' OR c='savings' OR c LIKE 'income-%') THEN RAISE EXCEPTION 'Choose essential expense categories'; END IF;
 ELSE
  target:=p_target;
  IF p_deadline IS NULL OR p_deadline<(now() AT TIME ZONE 'Europe/Minsk')::date THEN RAISE EXCEPTION 'Future fund deadline required'; END IF;
 END IF;
 PERFORM public.finance_validate_amount(target);
 IF p_id IS NULL THEN
  INSERT INTO public.savings_goals(household_id,name,target_amount,current_amount,emoji,deadline,purpose,essential_amount,reserve_months,essential_categories)
  VALUES(h,btrim(p_name),target,0,CASE WHEN p_purpose='emergency' THEN '🛟' ELSE '🗓️' END,p_deadline,p_purpose,CASE WHEN p_purpose='emergency' THEN p_essential END,CASE WHEN p_purpose='emergency' THEN p_months END,CASE WHEN p_purpose='emergency' THEN p_categories ELSE '{}'::text[] END) RETURNING id INTO result;
 ELSE
  UPDATE public.savings_goals SET name=btrim(p_name),target_amount=target,deadline=p_deadline,purpose=p_purpose,essential_amount=CASE WHEN p_purpose='emergency' THEN p_essential END,reserve_months=CASE WHEN p_purpose='emergency' THEN p_months END,essential_categories=CASE WHEN p_purpose='emergency' THEN p_categories ELSE '{}'::text[] END WHERE id=p_id AND household_id=h AND NOT is_archived RETURNING id INTO result;
  IF NOT FOUND THEN RAISE EXCEPTION 'Active household goal required'; END IF;
 END IF; RETURN result;
END $$;

DO $$ DECLARE item TEXT; action TEXT; BEGIN
 FOREACH item IN ARRAY ARRAY['income_templates','budget_rollovers','income_distribution_revisions'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',item);
  FOREACH action IN ARRAY ARRAY['SELECT','INSERT','UPDATE','DELETE'] LOOP
   EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I',item||'_household_'||lower(action),item);
   IF action IN ('SELECT','DELETE') THEN
    EXECUTE format('CREATE POLICY %I ON public.%I FOR %s TO authenticated USING(household_id=(SELECT public.get_my_household_id()))',item||'_household_'||lower(action),item,action);
   ELSIF action='INSERT' THEN
    EXECUTE format('CREATE POLICY %I ON public.%I FOR INSERT TO authenticated WITH CHECK(household_id=(SELECT public.get_my_household_id()))',item||'_household_insert',item);
   ELSE
    EXECUTE format('CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated USING(household_id=(SELECT public.get_my_household_id())) WITH CHECK(household_id=(SELECT public.get_my_household_id()))',item||'_household_update',item);
   END IF;
  END LOOP;
  EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated',item); EXECUTE format('GRANT SELECT ON public.%I TO authenticated',item);
  EXECUTE format('DROP TRIGGER IF EXISTS guard_planning_write ON public.%I',item);
  EXECUTE format('CREATE TRIGGER guard_planning_write BEFORE INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.guard_planning_write()',item);
  IF EXISTS(SELECT 1 FROM pg_publication WHERE pubname='supabase_realtime') AND NOT EXISTS(SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename=item) THEN EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I',item); END IF;
 END LOOP;
END $$;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA finance_private FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.transfer_category_budget(TEXT,TEXT,NUMERIC,DATE),public.change_income_distribution(UUID,JSONB,INTEGER,JSONB),public.save_income_template(UUID,TEXT,JSONB),public.archive_income_template(UUID),public.review_budget_month(TEXT,UUID,JSONB),public.save_finance_fund(UUID,TEXT,TEXT,NUMERIC,DATE,NUMERIC,INTEGER,TEXT[]) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.transfer_category_budget(TEXT,TEXT,NUMERIC,DATE),public.change_income_distribution(UUID,JSONB,INTEGER,JSONB),public.save_income_template(UUID,TEXT,JSONB),public.archive_income_template(UUID),public.review_budget_month(TEXT,UUID,JSONB),public.save_finance_fund(UUID,TEXT,TEXT,NUMERIC,DATE,NUMERIC,INTEGER,TEXT[]) TO authenticated;
CREATE OR REPLACE FUNCTION public.update_finance_transaction(p_id UUID, p_type TEXT, p_amount NUMERIC,
  p_category_id TEXT, p_comment TEXT, p_added_by UUID, p_date DATE, p_account_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_household UUID; v_tx public.transactions%ROWTYPE; v_capital NUMERIC; v_new_capital NUMERIC; v_reserved NUMERIC;
BEGIN
  v_household := public.finance_household_lock();
  PERFORM public.finance_validate_amount(p_amount);
  SELECT * INTO v_tx FROM public.transactions WHERE id = p_id AND household_id = v_household FOR UPDATE;
  IF NOT FOUND OR v_tx.kind <> 'cashflow' THEN RAISE EXCEPTION 'Household cashflow transaction required'; END IF;
  IF EXISTS(SELECT 1 FROM public.income_distributions WHERE income_transaction_id=p_id AND (p_type<>'income' OR (status='active' AND p_amount<total_amount) OR p_date IS DISTINCT FROM v_tx.date)) THEN RAISE EXCEPTION 'Distributed income must preserve its date, type and allocated amount'; END IF;
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

CREATE OR REPLACE FUNCTION public.finance_flexible_planning_version() RETURNS INTEGER LANGUAGE sql IMMUTABLE SET search_path='' AS $$ SELECT 1; $$;
REVOKE ALL ON FUNCTION public.finance_flexible_planning_version() FROM PUBLIC; GRANT EXECUTE ON FUNCTION public.finance_flexible_planning_version() TO anon,authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
