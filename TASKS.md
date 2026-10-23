# TASKS.md

## Current automatic Priorbank accounting · 2026-10-23

- Implemented one-time owner opt-in, automatic income/expense history entries including today, exact source amounts, shared immutable occurrence receipts, append-only day updates and atomic pause on changed/removed history. Explicit own transfers/manual collisions stay in a review list; unverified additional lists never affect balances. One BYN card/account; no new runtime dependencies.
- Server: ticket-authenticated prior-auto-sync, native Cron/pg_net every two minutes, encrypted remembered sessions, existing owner/login leases and bounded backoff. Disconnect/household changes invalidate stale work; expiry pauses until bank login. No passwords/user JWTs retained or automatic login.
- UI: Air switch/setup, status/counters/review, Home status and journal origin label; app return refreshes financial data. Categories are shared between reviewed/browser and background paths without changing existing mappings.
- Passing: 69 app checks, 28 bank/server checks, seven SQL scenarios / 330 assertions, new 320/390 px automation UI and existing remembered-bank UI. Native rollback probe checks Vault, today income/expense, exact balance, repeat and stale-disable; ticket-to-Edge HTTP 200 with zero jobs, native scheduler run succeeded. Production 180 ledger rows/accounts/goals retain original hashes. Backend/migrations installed; frontend publication being verified. Live bank speed/status transitions remain tomorrow owner verification. Details: docs/prior-automatic-accounting.md.

## Current Air accents and Belarus categories · 2026-10-20

- Added restrained blue/violet/green landmarks to the approved Air interface: daily guidance, actions/navigation, accounts, savings/planning and chart. Added 31 categories (20 expense / 11 income), merchant/name search, grouped tones and readable mobile category grids. Existing category IDs/transactions remain intact; no schema, backend or dependencies changed.
- Import suggestions now check income before stores, handle new explicit scenarios and no longer treat the substring «газ» inside «магазин» as utilities. Existing review, financial amounts/dates and duplicate protections stay intact. Refunds show their cashflow meaning before manual save.
- Passing: 69 app checks, 26 bank/server checks, browser regressions at 320/390/1024 px, Air planning forms and remembered-bank flows. New 320/390 px category scenarios save a 12.34 expense and 150.01 income only in an isolated demo, verify exact balances/labels/editor, search/type/group behavior, icon sizes and no clipping. Synthetic CSV/tab/comma/1C/card/account PDF-text/foreign-currency cases preserve original money/dates. Build and diff pass. File inventory and limits: `docs/air-accents-categories-release.md`.
- Published in PR #17 / merge `583b77b`: Cloudflare build `75b099af-dc0a-4482-ad92-1a8e23149fbf` SUCCESS, version `3eff45ae-faad-415e-84f7-907c0637fdd1`. Fresh production `index-DgGYSmcr.js`/`index-B9j_dCYJ.css`, manifest, updated worker and icons return 200; new catalogue/accent assets confirmed. Login 390×844 and registration 320×640 pass without runtime errors/overflow. Live authenticated bank, physical Safari/keyboard/installed PWA remain unverified; working financial records untouched.

## Current approved Air design · 2026-10-20

- Implemented the owner-approved «Воздух» concept across all eight screens and existing dialogs: neutral light/white/charcoal system, restrained glass navigation, open home balance, circular actions, header privacy and existing transfer dialog access. Priorbank has a short introduction, dedicated login state and reviewed import; Alfa is secondary. Planning fields/buttons are consistent, emergency categories disclose on request, and profile bank access is a single labelled button. No domain/backend changes or dependencies.
- Passing: 63 app checks, 26 bank/server checks; existing screen/browser scenarios at 320/390/1024 px and remembered-bank scenarios at 320/390 px. Added Air form regressions at 320×640/390×640: goal/reserve/recurring, budget/transfer/template, emergency/fund, focus, profile-to-bank and no horizontal clipping. Visual review and TypeScript/Vite/PWA build pass. Only isolated demo/synthetic data; physical Safari/keyboard/installed PWA and live owner bank response remain unverified.
- Published: core PR #15 / merge `cea8a9c`, then icons PR #16 / merge `f34b04e`. Latest release Cloudflare build `713f8756-3681-4cd5-b422-95fb2adfd122` SUCCESS, version `c10eae54-5f6d-485a-97e9-75f4fd45cb8b`. Production `index-Dl3HyA8s.js`/`index-CS3czsl3.css`, neutral manifest and updated worker return 200. BloomFi artwork is replaced by the neutral wallet SVG and 48/192/512 PNGs; asset dimensions/HTML links and fresh login 390×844/registration 320×640 pass without overflow/runtime errors. Details and file inventory: `docs/air-design-release.md`.

## Current home and bank clarity update · 2026-10-20

- Simplified Priorbank into connection, review and selected-save states. Settings/card selection/account binding are collapsed once known; explicit login consent, bank-session expiry, first-use confirmation, duplicate warnings and category review stay available. Equal account/purchase amounts are no longer repeated; foreign amounts and nonzero fees remain visible. Linked selections have a compact sticky save summary; first-use confirmation stays in the document flow.
- Home retains the balance/daily/month/accounts hierarchy; detailed daily explanation and extra goal/recurring cards disclose on request. The transfer notice now appears in its dialog. All calculations, persistence, parsers, Auth/RLS and backend are unchanged; no new dependencies.
- Passing: 63 app checks, 26 bank/server checks; refreshed browser regressions for 320/390/1024 px, short 320×640 bank flow, saved/unknown card choice, bulk selection/reset, first-account and possible-duplicate confirmation. Only synthetic/demo data; physical Safari/keyboard and live signed-in bank response remain unverified. Build/diff pass. Published in PR #14 / merge `b80680c`, Cloudflare build `5c515a94-0393-48f2-96fa-ab97c655fb0d` SUCCESS, version `ee306744-d490-4637-b1ef-da38051a5fdb`; fresh production `index-BNqwZqAu.js`/CSS/manifest/worker HTTP 200 and login checked. Release record: `docs/clean-home-bank-release.md`.

## Current premium design release · 2026-10-19

- Implemented requested redesign from the six supplied galleries: calm light/forest/lime system, Inter, softened glass, labelled navigation, shared headers and a reordered daily overview. All eight screens updated; categories are readable report rows, journal preserves actions/search, home money hiding is consistent, Priorbank opens first. No new dependencies or domain/backend changes.
- Passing: 63 app tests, 26 bank/server tests, TypeScript/Vite/PWA build. Real-screen demo browser scenarios at 320/390/1024 px cover navigation, privacy, search/dialogs/charts/planning, exact 1.23 BYN demo save, bank fallback and login/registration. Existing remembered-bank synthetic UI passes at 320/390 px. No real bank/Supabase requests or working-data writes in demo tests.
- Visual review completed; physical Safari/installed PWA and keyboard remain owner verification. Published in PR #13 / merge `3399fe6`, Cloudflare build `f729c4bb-2f58-4612-af79-7f91f0a88fa1` succeeded; fresh production login/assets verified. References, changed-file inventory and limits: `docs/premium-design-release.md`.

## Current Priorbank convenience release · 2026-10-19

- Owner confirms the previous server connector works. Implemented explicit Vault-encrypted bank sessions without password retention; automatic ten completed Minsk days on opening, remembered card/account and automatic receipt preflight. Linked-account save needs selection plus one Add action; unknown account keeps first-use confirmation. Expired session requests a new login; no automatic password retry.
- Additive migration installed and Edge prior-connect v2 ACTIVE/JWT-verified; native synthetic Vault/save/load/disconnect/CAS probes rolled back, financial hashes unchanged, client permissions denied and security advisories unchanged. Rolling per-request windows preserve import receipts and strict overlapping-day signatures, cross-date warning fingerprints survive ledger deletion.
- Passing: 63 app checks, 26 protocol/server checks, 294 SQL assertions in six scenarios; build/PWA. Synthetic real-component UI 320/390 px/StrictMode: opening/reopening, selection/save, expiry/new login, disconnect; no overflow/runtime errors. No new dependencies.
- Published in PR #12 (merge `1e9282c`), Cloudflare build `90751126-0964-47f9-8409-9c595a926c84`, version `6a124514-7ccc-4e37-9a44-0cab8881248e`, production `index-Hgz6sfc2.js` HTTP 200. After publication: one new owner login (old version discarded the session), then verify real revisit and bank-session lifetime. Stable bank IDs/history completeness/settlement changes, extra confirmation, actual Safari and cross-device lifecycle remain unverified. See `docs/prior-remembered-session.md` for scope, file inventory and limits.

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
