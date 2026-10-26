-- Preserve the detected month-end rhythm instead of fixing February's 28/29th forever.
BEGIN;
DO $$ DECLARE body TEXT;needle TEXT:='extract(day FROM t.date)::int,account,''bank'',key)';replacement TEXT:=$replacement$
 CASE /* bank-bill-month-end-v1 */ WHEN NOT EXISTS(SELECT 1 FROM jsonb_array_elements(rows) evidence
  WHERE (evidence->>'date')::date<>(date_trunc('month',(evidence->>'date')::date)+interval '1 month'-interval '1 day')::date)
 THEN 31 ELSE extract(day FROM t.date)::int END,account,'bank',key)$replacement$;
BEGIN
 body:=pg_get_functiondef('public.confirm_bank_bill(uuid[])'::regprocedure);
 IF position(needle IN body)>0 THEN EXECUTE replace(body,needle,replacement);
 ELSIF position('bank-bill-month-end-v1' IN body)=0 THEN RAISE EXCEPTION 'Bank bill function changed';END IF;
END $$;
NOTIFY pgrst,'reload schema';
COMMIT;
