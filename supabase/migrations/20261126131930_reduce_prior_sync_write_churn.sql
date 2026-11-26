BEGIN;

-- Keep the reconciliation rules and permissions installed by the live-accounting
-- migration. Avoid writing rows whose values would be unchanged.
DO $migration$
DECLARE
  definition text := replace(pg_get_functiondef('public.complete_prior_live_job(uuid,uuid,uuid,jsonb,boolean)'::regprocedure), chr(13), '');
  original text;
  replacements text[][] := ARRAY[
    ARRAY[$old$last_seen_at=now() WHERE id=e.id;$old$,
          $new$last_seen_at=now() WHERE id=e.id AND NOT (r->>'key'=ANY(e.aliases));$new$, '2'],
    ARRAY[$old$SET state=phase WHERE id=e.id;$old$,
          $new$SET state=phase WHERE id=e.id AND old_phase IS DISTINCT FROM phase;$new$, '1'],
    ARRAY[$old$END WHERE id=entry;$old$,
          $new$END WHERE id=entry
     AND (t.amount IS DISTINCT FROM abs(effect)
       OR t.type IS DISTINCT FROM (CASE WHEN effect=0 THEN t.type WHEN effect<0 THEN 'expense' ELSE 'income' END)
       OR t.date IS DISTINCT FROM (CASE WHEN phase='cancelled' THEN e.day ELSE (r->>'day')::date END));$new$, '1'],
    ARRAY[$old$  UPDATE public.prior_bank_events SET aliases=CASE WHEN r->>'key'=ANY(aliases) THEN aliases ELSE array_append(aliases,r->>'key') END,
   state=CASE WHEN reason IS NULL THEN phase ELSE 'needs_review' END,$old$,
          $new$  IF NOT (r->>'key'=ANY(e.aliases))
   OR e.state IS DISTINCT FROM (CASE WHEN reason IS NULL THEN phase ELSE 'needs_review' END)
   OR e.observed_state IS DISTINCT FROM phase
   OR e.bank_amount IS DISTINCT FROM amount
   OR e.applied_amount IS DISTINCT FROM (CASE WHEN reason IS NULL THEN effect ELSE e.applied_amount END)
   OR e.transaction_id IS DISTINCT FROM coalesce(entry,e.transaction_id)
   OR (phase<>'cancelled' AND e.original_amount IS DISTINCT FROM (r->>'originalAmount')::numeric)
   OR e.original_currency IS DISTINCT FROM (r->>'originalCurrency')
   OR e.reason IS DISTINCT FROM reason
   OR (reason IS NULL AND phase<>'cancelled' AND e.day IS DISTINCT FROM (r->>'day')::date)
  THEN
  UPDATE public.prior_bank_events SET aliases=CASE WHEN r->>'key'=ANY(aliases) THEN aliases ELSE array_append(aliases,r->>'key') END,
   state=CASE WHEN reason IS NULL THEN phase ELSE 'needs_review' END,$new$, '1'],
    ARRAY[$old$   WHERE id=e.id RETURNING * INTO e;
  -- The old reviewed import$old$,
          $new$   WHERE id=e.id RETURNING * INTO e;
  END IF;
  -- The old reviewed import$new$, '1'],
    ARRAY[$old$AND d.day=day_row.day;$old$,
          $new$AND d.day=day_row.day AND d.signature IS DISTINCT FROM day_signature;$new$, '1']
  ];
  replacement text[];
BEGIN
  original := definition;
  FOREACH replacement SLICE 1 IN ARRAY replacements LOOP
    replacement[1] := replace(replacement[1], chr(13), '');
    replacement[2] := replace(replacement[2], chr(13), '');
    IF cardinality(string_to_array(definition, replacement[2])) - 1 = replacement[3]::integer THEN
      CONTINUE;
    ELSIF cardinality(string_to_array(definition, replacement[1])) - 1 = replacement[3]::integer THEN
      definition := replace(definition, replacement[1], replacement[2]);
    ELSE
      RAISE EXCEPTION 'Unexpected Priorbank reconciliation function';
    END IF;
  END LOOP;
  IF definition IS DISTINCT FROM original THEN
    EXECUTE definition;
  END IF;
END
$migration$;

CREATE OR REPLACE FUNCTION finance_private.prior_live_receipt(h uuid, p_owner uuid, source text, r jsonb)
RETURNS void LANGUAGE plpgsql SET search_path='' AS $$
DECLARE
  receipt text := r->>'legacyKey';
  warning text;
BEGIN
  IF r->>'source' <> 'history' OR receipt IS NULL THEN
    RETURN;
  END IF;
  warning := encode(sha256(convert_to(jsonb_build_array(r->'legacy'->>'description',
    (r->'legacy'->>'accountAmount')::numeric)::text,'UTF8')),'hex');
  INSERT INTO public.prior_import_days AS receipts
    (household_id,owner_id,source_key,day,signature,imported_keys,warning_keys)
  VALUES (h,p_owner,source,(r->>'day')::date,repeat('0',64),ARRAY[receipt],ARRAY[warning])
  ON CONFLICT (household_id,source_key,day) DO UPDATE SET
    imported_keys = CASE WHEN receipt=ANY(receipts.imported_keys) THEN receipts.imported_keys ELSE array_append(receipts.imported_keys,receipt) END,
    warning_keys = CASE WHEN warning=ANY(receipts.warning_keys) THEN receipts.warning_keys ELSE array_append(receipts.warning_keys,warning) END
  WHERE NOT (receipt=ANY(receipts.imported_keys) AND warning=ANY(receipts.warning_keys));
END
$$;
REVOKE ALL ON FUNCTION finance_private.prior_live_receipt(uuid,uuid,text,jsonb) FROM PUBLIC,anon,authenticated;

-- The account-level last_checked_at still advances on every successful poll.
COMMENT ON COLUMN public.prior_bank_events.last_seen_at IS 'Last observed change to reconciliation data or aliases.';

COMMIT;
