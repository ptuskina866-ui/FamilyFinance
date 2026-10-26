-- Confirmed merchant preferences and bank-observed bills. No historical money/category rewrite.
BEGIN;
CREATE TABLE IF NOT EXISTS public.merchant_rules (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),household_id UUID NOT NULL REFERENCES public.households(id) ON DELETE CASCADE,
 merchant_key TEXT NOT NULL CHECK(length(merchant_key) BETWEEN 3 AND 250),transaction_type TEXT NOT NULL CHECK(transaction_type IN ('expense','income')),
 display_name TEXT NOT NULL CHECK(length(btrim(display_name)) BETWEEN 1 AND 80),category_id TEXT NOT NULL CHECK(category_id ~ '^[a-z][a-z0-9-]{0,63}$'),
 created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT now(),updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 UNIQUE(household_id,merchant_key,transaction_type)
);
CREATE INDEX IF NOT EXISTS merchant_rules_creator ON public.merchant_rules(created_by);
ALTER TABLE public.merchant_rules ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.merchant_rules FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.merchant_rules TO authenticated;
DO $$ DECLARE action TEXT;BEGIN
 FOREACH action IN ARRAY ARRAY['SELECT','INSERT','UPDATE','DELETE'] LOOP
  EXECUTE format('DROP POLICY IF EXISTS %I ON public.merchant_rules','merchant_rules_'||lower(action));
  EXECUTE format('CREATE POLICY %I ON public.merchant_rules FOR %s TO authenticated %s','merchant_rules_'||lower(action),action,
   CASE WHEN action='INSERT' THEN 'WITH CHECK(household_id=(SELECT public.get_my_household_id()))'
   WHEN action='UPDATE' THEN 'USING(household_id=(SELECT public.get_my_household_id())) WITH CHECK(household_id=(SELECT public.get_my_household_id()))'
   ELSE 'USING(household_id=(SELECT public.get_my_household_id()))' END);
 END LOOP;
 IF NOT EXISTS(SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='merchant_rules') THEN ALTER PUBLICATION supabase_realtime ADD TABLE public.merchant_rules; END IF;
END $$;

CREATE OR REPLACE FUNCTION finance_private.merchant_identity(description TEXT) RETURNS JSONB LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE normalized TEXT:=lower(normalize(coalesce(description,''),NFKC));row RECORD;key TEXT;
BEGIN
 FOR row IN SELECT * FROM (VALUES
 ('mak-by','Мак.by','mak[.]by|мак[.]by'),
 ('netflix','Netflix','netflix'),
 ('spotify','Spotify','spotify'),
 ('apple','Apple','apple[.]com/bill|apple[.]com'),
 ('yandex-plus','Яндекс Плюс','yandex[ .]*plus|яндекс[ .]*плюс'),
 ('euroopt','Евроопт','euroopt|евроопт|edostavka|е-доставка'),
 ('green','Green','green|грин'),
 ('santa','Санта','santa|санта'),
 ('sosedi','Соседи','sosedi|соседи'),
 ('hippo','Гиппо','gippo|hippo|гиппо'),
 ('wildberries','Wildberries','wildberries|вайлдберриз'),
 ('ozon','Ozon','ozon|озон'),
 ('a1','А1','a1|velcom'),
 ('mts','МТС','mts|мтс'),
 ('byfly','Byfly','byfly')
 ) AS brands(id,name,pattern) LOOP
  IF normalized ~ ('(^|[^[:alnum:]])('||row.pattern||')($|[^[:alnum:]])') THEN RETURN jsonb_build_object('key','brand:'||row.id,'name',row.name); END IF;
 END LOOP;
 key:=btrim(regexp_replace(normalized,'[^[:alnum:]]+',' ','g'));
 IF length(key) NOT BETWEEN 2 AND 240 OR key !~ '[[:alpha:]]' OR key ~ '^(покупка|оплата|платеж|платёж|расход|продукты|еда|кафе|такси|перевод|другое|импорт выписки|без комментария)$' THEN key:=''; ELSE key:='raw:'||key; END IF;
 RETURN jsonb_build_object('key',key,'name',btrim(coalesce(description,'')));
END $$;
REVOKE ALL ON FUNCTION finance_private.merchant_identity(TEXT) FROM PUBLIC,anon,authenticated;
ALTER TABLE public.prior_bank_events ADD COLUMN IF NOT EXISTS merchant_key TEXT;
ALTER TABLE public.prior_bank_events ADD COLUMN IF NOT EXISTS merchant_name TEXT;
ALTER TABLE public.prior_bank_events ADD COLUMN IF NOT EXISTS rule_category TEXT;
ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS recurring_month DATE CHECK(recurring_month=date_trunc('month',recurring_month)::date);
ALTER TABLE public.recurring_transactions ADD COLUMN IF NOT EXISTS match_mode TEXT NOT NULL DEFAULT 'scheduled' CHECK(match_mode IN ('scheduled','bank'));
ALTER TABLE public.recurring_transactions ADD COLUMN IF NOT EXISTS merchant_key TEXT;
ALTER TABLE public.recurring_transactions DROP CONSTRAINT IF EXISTS recurring_transactions_day_of_month_check;
ALTER TABLE public.recurring_transactions ADD CONSTRAINT recurring_transactions_day_of_month_check CHECK(day_of_month BETWEEN 1 AND CASE WHEN match_mode='bank' THEN 31 ELSE 28 END);
CREATE UNIQUE INDEX IF NOT EXISTS bank_bill_occurrence ON public.transactions(recurring_id,recurring_month) WHERE recurring_id IS NOT NULL AND recurring_month IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS bank_bill_merchant ON public.recurring_transactions(household_id,account_id,merchant_key) WHERE is_active AND match_mode='bank';
CREATE INDEX IF NOT EXISTS prior_bank_events_merchant ON public.prior_bank_events(household_id,merchant_key,day);

CREATE OR REPLACE FUNCTION finance_private.guard_bank_bill() RETURNS TRIGGER LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF current_user IN ('anon','authenticated') AND (NEW.match_mode='bank' OR NEW.merchant_key IS NOT NULL) THEN RAISE EXCEPTION 'Use bank bill confirmation'; END IF;
 IF NEW.match_mode='bank' AND (NEW.type<>'expense' OR coalesce(NEW.merchant_key,'')='' OR NEW.account_id IS NULL) THEN RAISE EXCEPTION 'Bank bill requires an expense, merchant and account'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION finance_private.guard_bank_bill() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS guard_bank_bill ON public.recurring_transactions;
CREATE TRIGGER guard_bank_bill BEFORE INSERT OR UPDATE ON public.recurring_transactions FOR EACH ROW EXECUTE FUNCTION finance_private.guard_bank_bill();

-- This helper links one actual bank charge; it never creates a payment or changes money.
CREATE OR REPLACE FUNCTION finance_private.link_bank_bill(tx UUID,key TEXT) RETURNS VOID LANGUAGE plpgsql SET search_path='' AS $$
DECLARE t public.transactions;r public.recurring_transactions;month DATE;due DATE;
BEGIN
 SELECT * INTO t FROM public.transactions WHERE id=tx;
 IF t.id IS NULL OR t.kind<>'cashflow' OR t.type<>'expense' OR t.amount<=0 OR t.recurring_id IS NOT NULL THEN RETURN; END IF;
 month:=date_trunc('month',t.date)::date;
 SELECT * INTO r FROM public.recurring_transactions WHERE household_id=t.household_id AND account_id=t.account_id AND merchant_key=key AND match_mode='bank' AND is_active;
 IF r.id IS NULL THEN RETURN; END IF;
 due:=month+least(r.day_of_month-1,extract(day FROM (month+interval '1 month'-interval '1 day'))::int-1);
 IF abs(t.date-due)>4 OR abs(t.amount-r.amount)>greatest(1,r.amount*0.20) OR EXISTS(SELECT 1 FROM public.transactions WHERE recurring_id=r.id AND recurring_month=month) THEN RETURN; END IF;
 UPDATE public.transactions SET recurring_id=r.id,recurring_month=month WHERE id=t.id;
END $$;
REVOKE ALL ON FUNCTION finance_private.link_bank_bill(UUID,TEXT) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION finance_private.enrich_bank_event() RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE identity JSONB;rule public.merchant_rules;t public.transactions;
BEGIN
 identity:=finance_private.merchant_identity(NEW.description);
 NEW.merchant_key:=nullif(identity->>'key','');NEW.merchant_name:=identity->>'name';
 IF NEW.transaction_id IS NOT NULL AND NOT NEW.suppressed THEN
  IF NEW.state='cancelled' THEN
   UPDATE public.transactions SET recurring_id=NULL,recurring_month=NULL WHERE id=NEW.transaction_id AND household_id=NEW.household_id AND recurring_month IS NOT NULL;
  ELSIF TG_OP='UPDATE' AND OLD.transaction_id IS DISTINCT FROM NEW.transaction_id THEN
   SELECT * INTO t FROM public.transactions WHERE id=NEW.transaction_id AND household_id=NEW.household_id AND account_id=NEW.account_id AND kind='cashflow' AND import_origin='prior-auto';
   IF t.id IS NOT NULL THEN
    -- Legacy adoption must not recategorize old journal rows.
    IF t.created_at>=NEW.created_at-interval '5 seconds' THEN
     SELECT * INTO rule FROM public.merchant_rules WHERE household_id=NEW.household_id AND merchant_key=NEW.merchant_key AND transaction_type=t.type;
     IF rule.id IS NOT NULL THEN
      UPDATE public.transactions SET category_id=rule.category_id WHERE id=t.id;
      NEW.rule_category:=rule.category_id;
     END IF;
    END IF;
   END IF;
  END IF;
  IF NEW.state<>'cancelled' THEN PERFORM finance_private.link_bank_bill(NEW.transaction_id,NEW.merchant_key);END IF;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION finance_private.enrich_bank_event() FROM PUBLIC,anon,authenticated;
-- Backfill metadata only, before enabling the trigger. Existing money/categories/notes stay intact.
UPDATE public.prior_bank_events SET merchant_key=nullif(finance_private.merchant_identity(description)->>'key',''),merchant_name=finance_private.merchant_identity(description)->>'name' WHERE merchant_key IS NULL;
DROP TRIGGER IF EXISTS enrich_bank_event ON public.prior_bank_events;
CREATE TRIGGER enrich_bank_event BEFORE INSERT OR UPDATE OF transaction_id,description,state ON public.prior_bank_events FOR EACH ROW EXECUTE FUNCTION finance_private.enrich_bank_event();

CREATE OR REPLACE FUNCTION public.save_transaction_with_rule(p_id UUID,p_type TEXT,p_amount NUMERIC,p_category_id TEXT,p_comment TEXT,p_added_by UUID,p_date DATE,p_account_id UUID,p_remember BOOLEAN DEFAULT false,p_merchant_name TEXT DEFAULT NULL)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE h UUID;e public.prior_bank_events;t public.transactions;key TEXT;
BEGIN
 h:=public.finance_household_lock();
 IF p_remember IS NULL THEN RAISE EXCEPTION 'Merchant preference required'; END IF;
 IF p_remember THEN
  SELECT * INTO e FROM public.prior_bank_events WHERE household_id=h AND transaction_id=p_id AND NOT suppressed AND state<>'cancelled' FOR UPDATE;
  SELECT * INTO t FROM public.transactions WHERE id=p_id AND household_id=h AND kind='cashflow' FOR UPDATE;
  key:=coalesce(e.merchant_key,finance_private.merchant_identity(t.comment)->>'key');
  IF t.id IS NULL OR NOT EXISTS(SELECT 1 FROM public.accounts WHERE id=t.account_id AND household_id=h AND kind='bank') OR coalesce(key,'')='' OR p_merchant_name IS NULL OR length(btrim(p_merchant_name)) NOT BETWEEN 1 AND 80 OR p_merchant_name ~ '[[:cntrl:]]'
   OR p_category_id !~ '^[a-z][a-z0-9-]{0,63}$' OR (p_type='income' AND p_category_id<>'salary' AND p_category_id !~ '^income-') OR (p_type='expense' AND (p_category_id='salary' OR p_category_id ~ '^income-')) THEN RAISE EXCEPTION 'Invalid merchant preference'; END IF;
 END IF;
 PERFORM public.update_finance_transaction(p_id,p_type,p_amount,p_category_id,p_comment,p_added_by,p_date,p_account_id);
 IF p_remember THEN
  INSERT INTO public.merchant_rules(household_id,merchant_key,transaction_type,display_name,category_id,created_by)
  VALUES(h,key,p_type,btrim(p_merchant_name),p_category_id,auth.uid())
  ON CONFLICT(household_id,merchant_key,transaction_type) DO UPDATE SET display_name=excluded.display_name,category_id=excluded.category_id,updated_at=now();
 END IF;
END $$;
REVOKE ALL ON FUNCTION public.save_transaction_with_rule(UUID,TEXT,NUMERIC,TEXT,TEXT,UUID,DATE,UUID,BOOLEAN,TEXT) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.save_transaction_with_rule(UUID,TEXT,NUMERIC,TEXT,TEXT,UUID,DATE,UUID,BOOLEAN,TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.delete_merchant_rule(p_id UUID) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE h UUID;BEGIN h:=public.finance_household_lock();DELETE FROM public.merchant_rules WHERE id=p_id AND household_id=h;END $$;
REVOKE ALL ON FUNCTION public.delete_merchant_rule(UUID) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.delete_merchant_rule(UUID) TO authenticated;

-- Evidence is re-read and checked under the household lock; the client cannot invent a subscription.
CREATE OR REPLACE FUNCTION public.confirm_bank_bill(p_evidence UUID[]) RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE h UUID;ids UUID[];rows JSONB;t public.transactions;key TEXT;account UUID;months INT[];days INT[];r UUID;row JSONB;
BEGIN
 h:=public.finance_household_lock();
 IF coalesce(cardinality(p_evidence),0) NOT BETWEEN 2 AND 6 OR array_position(p_evidence,NULL) IS NOT NULL THEN RAISE EXCEPTION 'Two to six monthly payments required'; END IF;
 SELECT array_agg(DISTINCT x) INTO ids FROM unnest(p_evidence) x;
 IF coalesce(cardinality(ids),0) NOT BETWEEN 2 AND 6 THEN RAISE EXCEPTION 'Two to six monthly payments required'; END IF;
 SELECT jsonb_agg(to_jsonb(tx)||jsonb_build_object('key',coalesce(e.merchant_key,finance_private.merchant_identity(tx.comment)->>'key')) ORDER BY tx.date DESC,tx.id) INTO rows
 FROM public.transactions tx LEFT JOIN public.prior_bank_events e ON e.transaction_id=tx.id AND e.household_id=tx.household_id
 WHERE tx.household_id=h AND tx.id=ANY(ids) AND tx.type='expense' AND tx.kind='cashflow' AND tx.amount>0 AND tx.date<=(now() AT TIME ZONE 'Europe/Minsk')::date AND coalesce(e.state,'posted')<>'cancelled'
 AND (tx.recurring_id IS NULL OR EXISTS(SELECT 1 FROM public.recurring_transactions r WHERE r.id=tx.recurring_id AND r.household_id=h AND r.match_mode='bank'));
 IF coalesce(jsonb_array_length(rows),0)<>cardinality(ids) THEN RAISE EXCEPTION 'Payment evidence changed'; END IF;
 key:=rows->0->>'key';account:=(rows->0->>'account_id')::uuid;
 IF coalesce(key,'')='' OR NOT EXISTS(SELECT 1 FROM public.accounts WHERE id=account AND household_id=h AND kind='bank' AND NOT is_archived) THEN RAISE EXCEPTION 'Bank account and merchant required'; END IF;
 FOR row IN SELECT value FROM jsonb_array_elements(rows) LOOP
  IF row->>'key'<>key OR (row->>'account_id')::uuid IS DISTINCT FROM account THEN RAISE EXCEPTION 'Payment evidence changed'; END IF;
  months:=array_append(months,extract(year FROM (row->>'date')::date)::int*12+extract(month FROM (row->>'date')::date)::int);
  days:=array_append(days,least(28,extract(day FROM (row->>'date')::date)::int));
 END LOOP;
 IF (rows->0->>'date')::date<(date_trunc('month',now() AT TIME ZONE 'Europe/Minsk')-interval '1 month')::date
  OR (SELECT max(x)-min(x) FROM unnest(months)x)<>cardinality(months)-1 OR (SELECT count(DISTINCT x) FROM unnest(months)x)<>cardinality(months)
  OR (SELECT max(x)-min(x) FROM unnest(days)x)>4 THEN RAISE EXCEPTION 'Monthly rhythm changed'; END IF;
 -- Reject cherry-picked evidence when another same-merchant payment exists in an evidence month.
 IF EXISTS(SELECT 1 FROM public.transactions tx LEFT JOIN public.prior_bank_events e ON e.transaction_id=tx.id WHERE tx.household_id=h AND tx.account_id=account AND tx.kind='cashflow' AND tx.type='expense' AND tx.amount>0
  AND tx.date>=date_trunc('month',(rows->-1->>'date')::date)::date AND tx.date<(date_trunc('month',(rows->0->>'date')::date)+interval '1 month')::date
  AND coalesce(e.merchant_key,finance_private.merchant_identity(tx.comment)->>'key')=key AND NOT(tx.id=ANY(ids))
  AND (extract(year FROM tx.date)::int*12+extract(month FROM tx.date)::int)=ANY(months)) THEN RAISE EXCEPTION 'Ambiguous monthly payments'; END IF;
 SELECT id INTO r FROM public.recurring_transactions WHERE household_id=h AND account_id=account AND merchant_key=key AND match_mode='bank' AND is_active;
 IF r IS NOT NULL THEN RETURN r; END IF;
 IF EXISTS(SELECT 1 FROM public.recurring_transactions WHERE household_id=h AND account_id=account AND is_active AND finance_private.merchant_identity(comment)->>'key'=key) THEN RAISE EXCEPTION 'Existing payment plan requires review'; END IF;
 SELECT * INTO t FROM public.transactions WHERE id=(rows->0->>'id')::uuid;
 INSERT INTO public.recurring_transactions(household_id,added_by,type,amount,category_id,comment,day_of_month,account_id,match_mode,merchant_key)
 VALUES(h,auth.uid(),'expense',t.amount,t.category_id,coalesce((SELECT display_name FROM public.merchant_rules WHERE household_id=h AND merchant_key=key AND transaction_type='expense'),finance_private.merchant_identity(t.comment)->>'name'),extract(day FROM t.date)::int,account,'bank',key) RETURNING id INTO r;
 -- Attach reviewed historical evidence as paid occurrences; no extra expense is created.
 FOREACH account IN ARRAY ids LOOP PERFORM finance_private.link_bank_bill(account,key); END LOOP;
 RETURN r;
END $$;
REVOKE ALL ON FUNCTION public.confirm_bank_bill(UUID[]) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.confirm_bank_bill(UUID[]) TO authenticated;

CREATE OR REPLACE FUNCTION public.apply_due_recurring(p_today DATE) RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE h UUID;r public.recurring_transactions;due DATE;account UUID;n INT:=0;inserted INT;
BEGIN
 h:=public.finance_household_lock();IF p_today IS NULL THEN RAISE EXCEPTION 'Date required';END IF;
 FOR r IN SELECT * FROM public.recurring_transactions WHERE household_id=h AND is_active AND match_mode='scheduled' ORDER BY id FOR UPDATE LOOP
  due:=make_date(extract(year FROM p_today)::int,extract(month FROM p_today)::int,r.day_of_month);
  IF due>p_today OR r.last_applied>=due THEN CONTINUE;END IF;
  account:=r.account_id;IF account IS NULL THEN SELECT id INTO account FROM public.accounts WHERE household_id=h AND NOT is_archived ORDER BY created_at,id LIMIT 1;END IF;
  IF account IS NULL OR NOT EXISTS(SELECT 1 FROM public.accounts WHERE id=account AND household_id=h AND NOT is_archived) THEN RAISE EXCEPTION 'Recurring transaction needs an active account';END IF;
  INSERT INTO public.transactions(household_id,type,amount,category_id,comment,added_by,date,account_id,kind,recurring_id)
  VALUES(h,r.type,r.amount,r.category_id,coalesce(r.comment,''),r.added_by,due,account,'cashflow',r.id) ON CONFLICT(recurring_id,date) WHERE recurring_id IS NOT NULL DO NOTHING;
  GET DIAGNOSTICS inserted=ROW_COUNT;n:=n+inserted;UPDATE public.recurring_transactions SET last_applied=due WHERE id=r.id;
 END LOOP;
 RETURN n;
END $$;
NOTIFY pgrst,'reload schema';
COMMIT;
