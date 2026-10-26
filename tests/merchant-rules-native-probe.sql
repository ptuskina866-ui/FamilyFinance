-- Synthetic rollback-only probe; no banking endpoint, existing household or secret is touched.
BEGIN;
DO $$
DECLARE actor UUID:=gen_random_uuid();h UUID;account UUID;first_tx UUID;second_tx UUID;payment UUID;event UUID;bill UUID;next_tx UUID;next_event UUID;today DATE:=(now() AT TIME ZONE 'Europe/Minsk')::date;before_count INT;
BEGIN
 INSERT INTO auth.users(id,raw_user_meta_data) VALUES(actor,jsonb_build_object('name','Synthetic rules probe','household_action','create','household_name','FinApp learning rollback probe'));
 PERFORM set_config('request.jwt.claim.sub',actor::text,true);
 PERFORM public.initialize_finance('{}'::uuid[]);
 SELECT household_id INTO h FROM public.profiles WHERE id=actor;
 SELECT id INTO account FROM public.accounts WHERE household_id=h LIMIT 1;
 INSERT INTO public.transactions(household_id,added_by,account_id,type,amount,category_id,comment,date,kind)
 VALUES(h,actor,account,'expense',12.99,'subscriptions','Netflix.com',(today-interval '2 months')::date,'cashflow') RETURNING id INTO first_tx;
 INSERT INTO public.transactions(household_id,added_by,account_id,type,amount,category_id,comment,date,kind)
 VALUES(h,actor,account,'expense',12.99,'subscriptions','Netflix.com',(today-interval '1 month')::date,'cashflow') RETURNING id INTO second_tx;
 bill:=public.confirm_bank_bill(ARRAY[first_tx,second_tx]);
 SELECT count(*) INTO before_count FROM public.transactions WHERE household_id=h;
 PERFORM public.apply_due_recurring(today);
 IF (SELECT count(*) FROM public.transactions WHERE household_id=h)<>before_count THEN RAISE EXCEPTION 'Bank bill auto-posted money';END IF;
 INSERT INTO public.transactions(household_id,added_by,account_id,type,amount,category_id,comment,date,kind,import_origin)
 VALUES(h,actor,account,'expense',12.99,'subscriptions','Netflix.com',today,'cashflow','prior-auto') RETURNING id INTO payment;
 INSERT INTO public.prior_bank_events(owner_id,household_id,account_id,source_key,aliases,match_key,state,bank_amount,original_currency,day,occurred_at,precise_time,description)
 VALUES(actor,h,account,repeat('a',64),ARRAY[repeat('a',64)||':1'],repeat('b',64),'provisional',-12.99,'BYN',today,now(),true,'Netflix.com') RETURNING id INTO event;
 UPDATE public.prior_bank_events SET transaction_id=payment WHERE id=event;
 IF NOT EXISTS(SELECT 1 FROM public.transactions WHERE id=payment AND recurring_id=bill AND recurring_month=date_trunc('month',today)::date) THEN RAISE EXCEPTION 'Bank charge did not satisfy bill';END IF;
 PERFORM public.save_transaction_with_rule(payment,'expense',12.99,'cafes','Personal note',actor,today,account,true,'My Netflix');
 IF NOT EXISTS(SELECT 1 FROM public.merchant_rules WHERE household_id=h AND merchant_key='brand:netflix' AND category_id='cafes' AND display_name='My Netflix') THEN RAISE EXCEPTION 'Merchant preference missing';END IF;
 INSERT INTO public.transactions(household_id,added_by,account_id,type,amount,category_id,comment,date,kind,import_origin)
 VALUES(h,actor,account,'expense',15,'other','Netflix.com',today,'cashflow','prior-auto') RETURNING id INTO next_tx;
 INSERT INTO public.prior_bank_events(owner_id,household_id,account_id,source_key,aliases,match_key,state,bank_amount,original_currency,day,occurred_at,precise_time,description)
 VALUES(actor,h,account,repeat('a',64),ARRAY[repeat('c',64)||':1'],repeat('c',64),'provisional',-15,'BYN',today,now(),true,'Netflix.com') RETURNING id INTO next_event;
 UPDATE public.prior_bank_events SET transaction_id=next_tx WHERE id=next_event;
 IF NOT EXISTS(SELECT 1 FROM public.transactions WHERE id=next_tx AND category_id='cafes' AND recurring_id IS NULL AND amount=15) THEN RAISE EXCEPTION 'Future rule or occurrence isolation failed';END IF;
 UPDATE public.prior_bank_events SET state='posted' WHERE id=event;
 IF NOT EXISTS(SELECT 1 FROM public.transactions WHERE id=payment AND comment='Personal note' AND amount=12.99) THEN RAISE EXCEPTION 'Settlement changed note/money';END IF;
 UPDATE public.prior_bank_events SET state='cancelled' WHERE id=event;
 IF EXISTS(SELECT 1 FROM public.transactions WHERE id=payment AND recurring_id IS NOT NULL) THEN RAISE EXCEPTION 'Cancellation retained paid occurrence';END IF;
 IF has_table_privilege('authenticated','public.merchant_rules','INSERT') OR has_table_privilege('anon','public.merchant_rules','SELECT') OR has_function_privilege('authenticated','finance_private.link_bank_bill(uuid,text)','EXECUTE') THEN RAISE EXCEPTION 'Native access regression';END IF;
END $$;
SELECT 'passed: native merchant preference, monthly confirmation, no synthetic expense, actual charge link, settlement/note preservation, cancellation and grants; rolled back' status;
ROLLBACK;
