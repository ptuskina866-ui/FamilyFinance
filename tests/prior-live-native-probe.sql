-- Run only as a database administrator. Synthetic users, Vault secrets and ledger rows
-- stay in this transaction and are rolled back. This never calls a banking endpoint.
BEGIN;
DO $$
DECLARE actor UUID:=gen_random_uuid(); h UUID; account UUID; c JSONB; a public.prior_automation; s JSONB; result JSONB;
 creds UUID; lease UUID:=gen_random_uuid(); income UUID; expense UUID; today TEXT:=(now() AT TIME ZONE 'Europe/Minsk')::date::text;
BEGIN
 INSERT INTO auth.users(id,raw_user_meta_data) VALUES(actor,jsonb_build_object('name','Synthetic probe','household_action','create','household_name','FinApp v2 rollback probe'));
 PERFORM set_config('request.jwt.claim.sub',actor::text,true);
 PERFORM public.initialize_finance('{}'::uuid[]);
 SELECT household_id INTO h FROM public.profiles WHERE id=actor;
 SELECT id INTO account FROM public.accounts WHERE household_id=h LIMIT 1;
 c:=public.prior_connection_state(actor,'status');
 c:=public.prior_connection_state(actor,'save_auto',jsonb_build_object('revision',c->>'revision','loginKey',repeat('a',64),
  'session',jsonb_build_object('token','SYNTHETIC','client','SYNTHETIC','userSession','SYNTHETIC'),
  'credentials',jsonb_build_object('login','SyntheticProbe','password','Synthetic123!'),
  'preview',jsonb_build_object('cards',jsonb_build_array(jsonb_build_object('card',jsonb_build_object('sourceKey',repeat('f',64),'currency','BYN'))))));
 SELECT credential_secret_id INTO creds FROM finance_private.prior_connections WHERE owner_id=actor;
 IF creds IS NULL OR EXISTS(SELECT 1 FROM vault.secrets WHERE id=creds AND secret LIKE '%Synthetic123!%') THEN RAISE EXCEPTION 'Native credential encryption failed'; END IF;
 IF public.prior_connection_state(actor,'load') ? 'credentials' THEN RAISE EXCEPTION 'Credentials leaked through load'; END IF;
 PERFORM public.set_prior_automation(true,account,repeat('f',64));
 PERFORM public.set_prior_live(true);
 s:=jsonb_build_object('version',2,'sourceKey',repeat('f',64),'from',today,'to',today,'fetchedAt',to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'records',jsonb_build_array(
  jsonb_build_object('key',repeat('1',64)||':1','matchKey',repeat('d',64),'day',today,'occurredAt',today||'T12:00:01+03:00','preciseTime',true,'description','Retail Synthetic','amount','-12.34','originalAmount','12.34','originalCurrency','BYN','source','additional','state','provisional','category','other','transfer',false,'legacy',jsonb_build_object('date',today,'description','Retail Synthetic','accountAmount',NULL,'operationAmount','12.34','operationCurrency','BYN','fee','0.00','source','additional')),
  jsonb_build_object('key',repeat('2',64)||':1','matchKey',repeat('e',64),'day',today,'occurredAt',today||'T12:00:02+03:00','preciseTime',true,'description','Synthetic income','amount','150.01','originalAmount','-150.01','originalCurrency','BYN','source','additional','state','provisional','category','income-other','transfer',false,'legacy',jsonb_build_object('date',today,'description','Synthetic income','accountAmount',NULL,'operationAmount','-150.01','operationCurrency','BYN','fee','0.00','source','additional'))));
 SELECT * INTO a FROM public.prior_automation WHERE owner_id=actor;
 result:=public.complete_prior_live_job(actor,a.revision,(c->>'revision')::uuid,s,true);
 IF EXISTS(SELECT 1 FROM public.transactions WHERE household_id=h) OR result->>'shadow'<>'true' THEN RAISE EXCEPTION 'Shadow wrote money'; END IF;
 SELECT * INTO a FROM public.prior_automation WHERE owner_id=actor;
 result:=public.complete_prior_live_job(actor,a.revision,(c->>'revision')::uuid,s,false);
 IF (result->>'imported')::int<>2 OR public.finance_capital(h)<>137.67 THEN RAISE EXCEPTION 'Native provisional balance failed'; END IF;
 SELECT id INTO expense FROM public.transactions WHERE household_id=h AND type='expense';
 SELECT id INTO income FROM public.transactions WHERE household_id=h AND type='income';
 UPDATE public.transactions SET category_id='cafes',comment='Owner note' WHERE id=expense;
 result:=public.complete_prior_live_job(actor,a.revision,(c->>'revision')::uuid,s,false);
 IF (result->>'imported')::int<>0 THEN RAISE EXCEPTION 'Native repeat duplicated money'; END IF;
 PERFORM public.claim_prior_connection(actor,repeat('a',64),lease);
 result:=public.prior_connection_state(actor,'reauth',jsonb_build_object('revision',c->>'revision','attempt',lease));
 IF result->'credentials'->>'password'<>'Synthetic123!' THEN RAISE EXCEPTION 'Native renewal secret missing'; END IF;
 result:=public.prior_connection_state(actor,'reauth',jsonb_build_object('revision',c->>'revision','attempt',lease));
 IF result<>'{}'::jsonb THEN RAISE EXCEPTION 'Native renewal repeated'; END IF;
 PERFORM public.prior_connection_state(actor,'disconnect');
 IF EXISTS(SELECT 1 FROM vault.secrets WHERE id=creds) THEN RAISE EXCEPTION 'Native credential cleanup failed'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.transactions WHERE id=expense AND category_id='cafes' AND comment='Owner note') OR NOT EXISTS(SELECT 1 FROM public.transactions WHERE id=income AND amount=150.01) THEN RAISE EXCEPTION 'Native ledger changed on disconnect'; END IF;
 IF has_function_privilege('authenticated','public.complete_prior_live_job(uuid,uuid,uuid,jsonb,boolean)','EXECUTE') OR has_table_privilege('anon','public.prior_bank_events','SELECT') THEN RAISE EXCEPTION 'Native privilege isolation failed'; END IF;
END $$;
SELECT 'passed: native Vault, shadow, provisional income/expense, exact balance, repeat, renewal guard, disconnect, privileges; rolled back' AS status;
ROLLBACK;
