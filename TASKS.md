# TASKS.md

# Current work

No active implementation task.

## Project maintenance backlog

### High priority

- Remove hardcoded Supabase configuration fallback from `src/supabaseClient.ts`.
- Ensure deployment environments provide `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.
- Add automated tests for bank statement parsing.

### Medium priority

- Add tests for financial calculations and savings forecasts.
- Review bank-import duplicate detection.
- Review Supabase schema and RLS consistency.

## Recently completed

- Added support for Alfa-Bank card statement PDF format.
- Added merchant mapping improvements.
- Updated authentication screens to Neo-Fintech / Liquid Glass design.
- Enabled PWA automatic service-worker updates.
- Added Cloudflare deployment configuration.