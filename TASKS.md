# TASKS.md

# Current work

Accounts/savings migration applied to working Supabase with private backup and unchanged financial rows verified. Frontend publishing through connected Cloudflare Workers Builds is underway. Stage two: shared category budgets and confirmed income distribution. Development demo: `http://127.0.0.1:5173/?demo=1`.

## Project maintenance backlog

### High priority

- Verify frontend deployment, signup/invitation delivery, Realtime and concurrent money RPC calls in hosted Supabase. Server-side accounts migration is installed; local PostgreSQL tests are not proof of the entire hosted lifecycle.
- Ensure deployment environments provide `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.
- Keep the private pre-release backup until rollout and accounting reconciliation are accepted; do not remove it without explicit authorization.
- Await user/bank feedback on production API conditions for individuals from Alfa-Bank; evaluate Sandbox prototype implementation (see `docs/alfa-bank-integration-research.md`).
- Add automated tests for bank statement parsing.

### Medium priority

- Add tests for financial calculations and savings forecasts.
- Review bank-import duplicate detection.
- Review Supabase schema and RLS consistency (including full execution of `supabase_schema.sql` and trigger testing in an isolated test PostgreSQL/Supabase instance; audit household isolation).

## Recently completed

- Connected Supabase and applied the accounts release to the working database on 2026-10-12:
  - Inspected actual columns, constraints, functions and policies. Confirmed profiles.role NOT NULL with default 'Участник'; no invalid transaction/goal values or cross-household attributed members found.
  - Created private `finapp_release_backup_20261012` in the same project with RLS and no client grants, then applied additive accounts migration.
  - Verified schema version 1, protection of account reads, removal of global household listing, and equality of all original 131 transactions/four goals against backup. No legacy entries were classified and no goal balances were changed.
  - Cloudflare GitHub check confirms existing automatic Workers Builds for main. Frontend release verification and stage-two planning work continue.
- Implemented the first accounts/savings prototype release on 2026-10-12:
  - Household BYN accounts, opening balances, single-row transfers, exact monetary calculations, capital/reserved/free balances and a reviewed initialization preview preserving legacy amounts/categories.
  - Goal reservations/releases/history/archive, actual contribution forecasts and required monthly deadline contributions; removed artificial spending/forecast minimums and ungrounded monthly savings claims.
  - Transaction editing/search/account filtering, account selection for manual/imported operations, inline errors and pending guards, and complete paginated ledger loading.
  - Additive SQL migration and matching initialization schema; atomic goal/transfer/edit/delete/recurring RPCs, household-scoped guards/RLS and protected one-use invitations. Hardened auth profile loading against stale responses.
  - Development-only local demo using real screens, isolated data persistence/reset and blocked Supabase calls; production output excludes the demo.
  - Loaded PDF.js separately and cached its worker so all application JS is precached by PWA. Existing bank parsing algorithms/formats were preserved.
  - Added exact-money/domain/auth tests (23 passing) and an isolated executable SQL suite (71 assertions passing); PGlite is a development dependency only. Build and verification results/file inventory are recorded in `docs/migration-accounts.md` and `docs/accounts-release.md`.
  - Browser-checked 320/390 px screens: account creation, transfers, reserves/releases, oversized amount errors, exact 0.80 goal completion, archive/history, edit, manual account entry, persistence and category totals. Live schema migration, hosted Auth/Realtime and multi-connection concurrency remain unverified.
- Completed product expansion analysis on 2026-10-12; proposals and verified code limitations are documented in `docs/product-roadmap.md`:
  - Proposed accounts/transfers, savings allocations, shared budgets, goal funding plans, salary allocation, cash-flow calendar, offline entry, and purchase/life scenarios while preserving the current visual style. These are proposals, not implemented or approved features.
  - Identified savings transfers counted as income/expense, heuristic spending limits and forecasts, non-atomic goal updates, client-side recurring/import duplication risks, device-local budget, and a repository-schema household membership security gap. Live database policy identity and authorized UI behavior were not verified.
  - Confirmed GitHub main and local HEAD match; preserved existing uncommitted changes. Application code, production data, and remote repository were not changed.
  - Verified `npm run build` successfully, including TypeScript and PWA generation. Vite reports a large main JS bundle; no dedicated automated test script exists.
- Researched direct free connection feasibility for Alfa-Bank Belarus and Priorbank (findings in `docs/alfa-bank-integration-research.md`):
  - Official pricing: Alfa-Bank explicitly states in FAQ that *«Open API предоставляется бесплатно»* (https://developerhub.alfabank.by/developerhub/site/pages/faq.jag). Sandbox registration and testing are free.
  - Production access status: Possibility of obtaining production access by an individual for a personal family application remains unconfirmed (bank requires application, meeting, and a signed contract; terms for individuals without legal entity / IP are not confirmed).
  - Credentials & architecture: Connection belongs to a specific authenticated user (`auth.uid()`); household isolation does not replace owner check. Bank secrets are accessible only to backend proxy (Supabase Edge Function / Cloudflare Worker), with encryption keys in server secrets/vault. Database secret storage is an optional long-term architecture option, not a prototype requirement (in-memory session state is sufficient).
  - Network & protocols: Direct GET `/` on gateway `developerhub.alfabank.by:8273` lacked `Access-Control-Allow-Origin`; `OPTIONS` preflight on `/individual/1.0.0/*` remains unverified. Port 8273 itself is not blocked by WHATWG Fetch / browsers, but backend proxy is required to protect `client_secret`. TLS certificate is valid HARICA DV TLS ECC (expired GlobalSign certificate from ZenPlugins is obsolete).
  - Transaction identification: `apiTransaction.id` may be absent per `converters.js` (`apiTransaction.id || null`); ID stability, scope of uniqueness, and hold-to-settled transitions require verification.
  - Priorbank comparison: Uses unofficial mobile app scraping requiring user's primary Internet Bank login/password (salted SHA-512); poses critical credential exposure risks and is not recommended.
  - Licensing: ZenPlugins is licensed under GPLv3; copyleft obligations must be respected if code is reused (FinApp uses independent TypeScript architecture).
  - Sandbox prototype plan: strictly test user authorization (`personId="TEST"`, `login="API"`), fetching test accounts/statement, and UI preview only — strictly NO writing to working database (including manual import).
  - Drafted user action items and inquiry letter to Alfa-Bank.
- Fixed `supabase_schema.sql` reproducibility and registration trigger compatibility:
  - Closed unclosed `DO $$` block in first Realtime configuration section before `CREATE TABLE recurring_transactions`.
  - Removed unused `role` field from `handle_new_user()` trigger `INSERT` and `VALUES` to match `CREATE TABLE profiles` and `src/AuthContext.tsx` metadata.
  - Corrected section numbering for sequential object definitions.
  - Statically validated SQL block delimiters, parentheses, dependency ordering, and idempotency (`IF NOT EXISTS`, `DROP POLICY IF EXISTS`, `DROP TRIGGER IF EXISTS`).
  - Read-only check of remote database confirmed legacy `role` column exists on remote `profiles`, but no remote DDL changes were applied and constraints could not be read via anon client; compatibility of the modified trigger with the remote DB is explicitly marked unconfirmed.
  - Verified frontend build with `npm run build`. Note: live SQL execution and trigger registration remain to be verified in an isolated test environment.
- Removed hardcoded Supabase configuration fallback from `src/supabaseClient.ts` and added explicit developer-facing error validation for missing environment variables. Updated `.env.example` to use placeholders.
- Added support for Alfa-Bank card statement PDF format.
- Added merchant mapping improvements.
- Updated authentication screens to Neo-Fintech / Liquid Glass design.
- Enabled PWA automatic service-worker updates.
- Added Cloudflare deployment configuration.
