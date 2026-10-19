# TASKS.md

# Current work

Server Priorbank flow published in PR #11 / merge `832c70e`: inline one-time login via authenticated Supabase `prior-connect`, without PC/loopback/popup. Cloudflare build `415c7e3a-bec8-483b-a8a5-fe57b756118f` succeeded, version `8255a626-9145-44a1-926f-7f065decbaeb`; fresh production browser received `index-rM2N6tnY.js` / HTTP 200, server connector present, loopback/server-key name/bank protocol absent, no runtime errors or mobile overflow. Backend v1/migration are installed and verified. Explicit server-handling consent, no saved bank password/session, service-only owner/login leases and existing reviewed import are implemented. 62 app checks, 20 bank/server tests and 254 isolated SQL assertions pass; synthetic mobile success/error/cancel and demo blocking pass. Existing financial row hashes remain unchanged. First real server-IP bank login/receipt/import, physical Safari and additional bank confirmation remain owner verification. Existing 31-day pilot and no background refresh remain. Details: `docs/prior-server-connection.md`.

## Project maintenance backlog

### High priority

- Verify frontend deployment, signup/invitation delivery, Realtime and concurrent money RPC calls in hosted Supabase. Server-side accounts migration is installed; local PostgreSQL tests are not proof of the entire hosted lifecycle.
- Ensure deployment environments provide `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.
- Keep the private pre-release backup until rollout and accounting reconciliation are accepted; do not remove it without explicit authorization.
- Priorbank pilot published: owner-driven first selected import/balance reconciliation remains. Before continuous automation verify stable operation/account IDs, history completeness, shared cards/accounts, pending/settled changes and movement beyond the 31-day window. Additional bank confirmation and session expiry remain untested. Never request bank passwords/codes in chat or save them on the FinApp server. Alfa personal Open API is unavailable per reviewed bank reply; reconsideration needs new bank evidence (see `docs/alfa-bank-integration-research.md`).
- Add automated tests for bank statement parsing.

### Medium priority

- Add tests for financial calculations and savings forecasts.
- Review bank-import duplicate detection.
- Review Supabase schema and RLS consistency (including full execution of `supabase_schema.sql` and trigger testing in an isolated test PostgreSQL/Supabase instance; audit household isolation).

## Recently completed

- Server Priorbank connector (2026-10-19): authenticated Edge Function and inline phone form replace loopback navigation. Shared protocol/parser reuse preserves local-preview tests; one-time password handling is explicit, financial whitelist and reviewed import are unchanged. Private owner/login leases, exact-origin CORS, input/response bounds, no automatic retry and hard demo blocking. Hosted backend/migration checks and frontend release are recorded in `docs/prior-server-connection.md`.

- Direct Priorbank handoff (2026-10-19): primary Connect action and optional collapsed file fallback, origin/window/256-bit token/version checks, exact financial whitelist, acknowledgment, cancellation/timeouts/popup errors, cleanup on user/household changes. Existing account/category review and duplicate receipts are reused. Synthetic browser flow works from HTTPS to loopback, 320/390 px without overflow, password cleared, no session/full bank ID/available balance in the message, no remote POSTs or financial writes. See `docs/prior-direct-connection.md` for final checks/publication.

- Reviewed Priorbank import pilot (2026-10-19): explicit single-card JSON download, strict financial whitelist without credentials/session/full bank IDs/balances, BYN bank-account selection, original account/foreign amounts, editable existing category suggestions and pre-save net balance change. No automatic transaction selection/save; bulk selection leaves ambiguities for individual verification.
  - Additive source/day receipts with household + owner RLS and SELECT-only client grants; guarded RPCs serialize and atomically commit ledger/receipts. Stable re-uploads are skipped, including after deliberate ledger deletion/editing. Reordered rows and identical real purchases preserve occurrence counts; changed or disappeared history and non-covering periods stop the pilot rather than guessing bank IDs.
  - One window up to 31 days; excludes fetch-day/today/additional/outside/zero/foreign-account rows. No continuous synchronization or bank credential storage. Tests, UI review and publication status: `docs/prior-import-release.md`.

- Local Priorbank preview (2026-10-19), isolated from production: strict TypeScript Node helper, loopback-only form and five auth/read request paths. One login attempt, no automatic retry/refresh/scheduling; unsupported extra confirmation stops explicitly. Passwords longer than 16 characters are rejected locally without truncation or a request to weaken them.
  - Preview preserves separate account/operation/fee amounts and currencies, credit-limit distinction, additional bank lists, possible duplicates and outside-period rows. No import, recalculation or classification of existing financial data.
  - 13 dedicated protocol/local-server tests and 50 existing app tests pass. App build/PWA passes with the same production asset `index-Ca_feLNw.js`; Node types are development-only. Mobile UI checked at 320/390 px on intercepted synthetic data: cleared password, source amounts, duplicate warning, reset, error handling, no HTML injection/storage/runtime errors.
  - Real Node initial handshake returned HTTP 200 without user credentials. The owner subsequently confirmed real cards/operations and matching available sums plus sampled amounts/currencies on 2026-10-19. Completeness and stable import identities remain unverified; no financial import was performed as part of the preview.

- Automatic monthly expense discovery (2026-10-16): shared main/Payments card, preliminary two-month versus longer three-to-six-month rhythms, source evidence, estimated dates and exact amount-change explanations. Journal filtering opens the original records; browsing does not change balances or financial data.
  - Account isolation, conservative merchant grouping, ambiguous/repeated/future/malformed row handling and exclusion of auto-posted/transfer/savings rows. No new schema or runtime dependencies.
  - Removed fabricated bank success/accounts/operations from the client and replaced the unused prototype banking endpoint with an explicit unavailable response. Official PDF/1C/CSV parser prefix preserved.
  - Rechecked live bank FAQ: production approval required; Personal route uses Alfa-Business Online and does not establish access for a private household app. No repeat message was sent during this release. The earlier 03/05 October correspondence was reviewed on 19 October and overrides the presumed registration step: personal Open API unavailable.
  - 50 calculation/auth/bank checks and all 176 isolated SQL checks pass. Build/PWA passes; mobile review, hidden amounts, journal restore, preliminary and empty results verified at 320/390 px. Fresh production bundle/config/login/API and live bank refusal verified; actual signed-in production UI and cross-device Realtime remain outside this verification. Details: `docs/automation-insights-release.md`.

- Flexible-planning publication confirmed: PR #5 merged as `896df49`, Cloudflare build succeeded, version `4f8709ee-3385-4295-a8bb-c612da76e699`. Fresh production bundle `index-B3_EbYgB.js` contains funds/templates/revision/month-review APIs, correctly configured project and publishable key; flexible capability endpoint returns 200/1. New tables verified with 12 household policies, three Realtime publications and no direct/anonymous writes/reads. Tests used a fresh browser context to avoid reading a superseded PWA asset; existing tabs need reload after worker activation.

- Implemented the accepted next release (flexible budgets, salary templates, future-expense funds) on 2026-10-13.
  - Atomic transfers conserve capital/free balance, including deficits; overspent destinations receive the full transferred remainder.
  - Current-month distribution editing/cancellation uses refund previews, revision checks, compensating goal movements and an immutable revision journal. Used expenses remain intact.
  - One reviewed choice per previous month: repeat, carry, save to a goal, or leave free. No automatic/duplicate carryover.
  - Fixed/percentage salary templates use ordered priorities and exact arithmetic, prepare a reviewed draft, and archive without deleting history.
  - Funds reuse goals and reserve accounting; emergency coverage has user-confirmed essential expenses and expense funds have target/deadline.
  - 38 calculation/auth tests and 176 executable SQL checks pass. Local UI flows verified at 320/390 px, including mixed salary plan, revision/cancellation, month review, transfers, template creation and fund contributions. Production/PWA build passes.
  - Supabase CLI generated migration file; installed with private pre-release snapshot. Existing transactions/goals/accounts/budgets/distributions unchanged. New tables have household policies/read-only client grants; internal helpers are private.

- Final production verification on 2026-10-13: PR #3 merged as `8cbe769`; Cloudflare build succeeded, version `6c6dcf8a-906f-4743-88f7-7aa8915d3cba`. Deployed `index-C8GZ1VfW.js` includes budget/distribution/calendar features and the configured Supabase project. Login renders without runtime errors at 390 px; planning capability API returns 200/1. Both new tables have all eight household policies and Realtime publication; authenticated read allowed, direct inserts and anonymous read denied.

- Second stage: shared monthly budgets, atomic income distribution and a 35-day recurring cashflow calendar, preserving existing visuals.
  - Goals and remaining category budgets both reserve capital; funded expenses and funded future bills do not consume the free daily pool twice.
  - Food category/store overlap prevented; zero budget releases remaining money; no automatic rollover or unconfirmed income allocation.
  - Income distribution validated against actual income and unassigned funds; unique source, guarded income editing/deletion and transactional rollback.
  - Planning tables have household RLS, read-only client grants and Realtime; RPCs lock the household. Private pre-budget snapshots saved before deployment.
  - Working database checked: existing transactions, goals and accounts unchanged; no budgets or distributions created on behalf of the user.
  - 31 calculation/auth tests and 112 SQL checks pass; mobile 320/390 px and local confirmed distribution verified. Hosted authenticated Realtime and concurrent connections still need dedicated staging validation.
- Repaired Cloudflare publication: configured build variables with the owner, triggered a new build, verified deployed login with no runtime errors and real Auth/capability endpoints returning 200. Added a missing-variable build guard.

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
