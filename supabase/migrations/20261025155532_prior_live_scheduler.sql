-- Native schedule remains separate from the portable schema and isolated PGlite tests.
BEGIN;
CREATE OR REPLACE FUNCTION finance_private.enqueue_prior_auto()
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE endpoint TEXT; ticket TEXT;
BEGIN
 DELETE FROM finance_private.prior_auto_tickets WHERE expires_at<now();
 IF NOT EXISTS(SELECT 1 FROM public.prior_automation a JOIN finance_private.prior_connections c ON c.owner_id=a.owner_id AND c.household_id=a.household_id
  JOIN public.profiles p ON p.id=a.owner_id AND p.household_id=a.household_id WHERE a.enabled AND a.next_run_at<=now()
   AND (c.secret_id IS NOT NULL OR(c.credential_secret_id IS NOT NULL AND NOT c.auth_blocked))) THEN RETURN; END IF;
 SELECT decrypted_secret INTO endpoint FROM vault.decrypted_secrets WHERE name='finapp_prior_auto_endpoint';
 IF endpoint IS NULL OR endpoint !~ '^https://[a-z0-9]+\.supabase\.co/functions/v1/prior-auto-sync$' THEN RETURN; END IF;
 ticket:=replace(gen_random_uuid()::text||gen_random_uuid()::text,'-','');
 INSERT INTO finance_private.prior_auto_tickets(token_hash,expires_at) VALUES(encode(sha256(convert_to(ticket,'UTF8')),'hex'),now()+interval '2 minutes');
 PERFORM net.http_post(url:=endpoint,body:=jsonb_build_object('ticket',ticket),headers:='{"Content-Type":"application/json"}'::jsonb,timeout_milliseconds:=100000);
END $$;
REVOKE ALL ON FUNCTION finance_private.enqueue_prior_auto() FROM PUBLIC,anon,authenticated;
SELECT cron.schedule('finapp-prior-auto','* * * * *','select finance_private.enqueue_prior_auto();');
COMMIT;
