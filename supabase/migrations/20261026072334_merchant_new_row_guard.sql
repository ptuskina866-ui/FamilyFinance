-- A creation timestamp from this transaction identifies a new projection exactly.
-- Old receipt adoption must not depend on how recently the earlier row was created.
BEGIN;
DO $$ DECLARE body TEXT;needle TEXT:='t.created_at>=NEW.created_at-interval ''5 seconds''';BEGIN
 body:=pg_get_functiondef('finance_private.enrich_bank_event()'::regprocedure);
 IF position(needle IN body)>0 THEN EXECUTE replace(body,needle,'t.created_at=transaction_timestamp()');
 ELSIF position('t.created_at=transaction_timestamp()' IN body)=0 THEN RAISE EXCEPTION 'Bank enrichment function changed';END IF;
END $$;
COMMIT;
