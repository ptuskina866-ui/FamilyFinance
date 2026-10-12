# Accounts and savings migration — 2026-10-12

This release adds real account balances, transfers and savings reservations while preserving transaction amounts and categories. Apply `supabase/migrations/20261012_accounts_and_savings.sql` to an existing database. The matching section is also appended to `supabase_schema.sql` for fresh installations. The working Supabase migration was applied on 2026-10-12 after the user authorized rollout and connected Supabase.

## Before applying

1. Back up the database and review its actual schema and policies. Repository SQL is not evidence that production matches it.
2. Check `profiles.role`: the registration trigger preserves the existing repository insert without `role`; a legacy live `role NOT NULL` column without a default must be resolved before deployment. Do not invent a role value or drop the column blindly.
3. Check existing data for null/negative/nonfinite savings values, nonpositive targets, nonpositive/nonfinite operation amounts, recurring days outside 1–28, and `added_by` profiles belonging to another household. Existing data is not repaired silently. Resolve any discrepancies explicitly before initializing accounts.
4. Audit all existing `households`/`profiles` policies and any custom membership-changing functions. PostgreSQL combines permissive policies with OR: an additional broad live policy can undermine the hardened repository policies.
5. Deploy this migration and the updated frontend together. Refresh installed PWAs. Old cached clients attempting direct goal amount updates, direct transaction deletion or registration by household UUID will receive errors. Existing sign-in and existing memberships remain intact.
6. First run against an isolated Supabase/PostgreSQL instance, then review a household's initialization preview. Development validation used an isolated PostgreSQL-compatible PGlite engine; Supabase Auth email delivery, hosted PostgREST and Realtime delivery require staging verification.

The migration is additive and repeatable. It creates tables, columns, indexes, policies, triggers and functions. It does not remove existing financial rows, change their amounts/categories, automatically classify old savings entries or move funds.

## Exact money and accounts

All values are PostgreSQL `NUMERIC(12,2)`. RPC amount arguments reject nonfinite values, zero movements and fractions smaller than a kopeck instead of silently rounding them. The frontend computes money in integer kopecks. This first release supports BYN accounts only; foreign currency consolidation requires explicit currency/rate rules before extending it.

`accounts` contains household ownership, name, `bank|cash|savings` kind, BYN currency, opening balance, archive state and creation date. Opening balances are starting capital and do not become income. Account balance is opening balance plus cashflow operations and both sides of transfers. Goal reservations do not change account balances.

`transactions.kind` separates `cashflow`, `transfer`, `goal_deposit` and `goal_release`. New fields connect source account, transfer destination, savings goal and recurring template. A transfer is a single ledger row, with one source and one destination; it affects neither income/expense analytics nor household capital.

Savings are a reservation within total household capital. `available = capital − active goal reservations`; reserving/releasing funds does not represent consumption/income. Existing household records with incomplete history may have negative available funds after migration. The application must show that discrepancy and request reconciliation, not manufacture income or erase savings.

## Explicit initialization and old savings entries

`initialize_finance(p_legacy_transaction_ids uuid[] default '{}')` locks the caller's household, creates a zero-opening-balance main account when needed and assigns unassigned cashflow transactions to it. Only identifiers explicitly reviewed in the initialization preview may be reclassified:

- An expense in category `savings` with a valid `[goal_id:UUID]` marker referencing an existing goal in the same household becomes `goal_deposit` and receives a structured `goal_id`.
- An income in category `savings` whose comment starts `Закрытие копилки:` becomes `goal_release`. Historical closed goals may no longer exist, so its `goal_id` remains null.

Unselected entries stay cashflow. No transaction amounts, categories or existing goal amounts are changed. Unknown, foreign-household and unsupported identifiers reject the entire initialization call, including account creation. Repeating a reviewed initialization is safe. A deposit referencing a deleted goal cannot be automatically classified by this release; it needs explicit manual reconciliation. The preview must not imply all legacy savings entries have been found.

## Atomic operation contract

All public RPCs require authentication and check household membership. They serialize on the household row. Internal helpers and trigger functions cannot be called through the public API. Definer functions use a fixed empty search path and qualified table names.

| RPC | Result and behavior |
| --- | --- |
| `initialize_finance(p_legacy_transaction_ids uuid[] = '{}')` | `void`; consent-based legacy setup described above. |
| `create_finance_account(p_name text, p_kind text, p_opening_balance numeric)` | New account UUID; nonnegative opening balance, name up to 80 characters. Ensures initialization before the first additional account. |
| `transfer_finance(p_from uuid, p_to uuid, p_amount numeric, p_date date, p_comment text)` | Ledger UUID; different active household accounts, positive amount, sufficient source balance. |
| `change_goal_funds(p_goal_id uuid, p_amount numeric, p_date date)` | Ledger UUID; signed amount, atomic exact goal update and reservation/release entry. Positive amounts require unreserved capital; releases cannot exceed saved funds. |
| `archive_savings_goal(p_goal_id uuid, p_date date)` | `void`; atomically releases the current reservation and archives the goal. Repeated archive has no additional effect. |
| `delete_finance_transaction(p_id uuid)` | `void`; atomically reverses linked goal changes and deletes the ledger entry. Rejects reversal of spent/released funds, archived-goal movements, and income deletion that would leave funded goals unsupported. |
| `update_finance_transaction(p_id uuid, p_type text, p_amount numeric, p_category_id text, p_comment text, p_added_by uuid, p_date date, p_account_id uuid)` | `void`; edits household cashflow only, checks active account/member and prevents edits that worsen unsupported savings reservations. Preserves recurring identity; changing a recurring occurrence date is rejected. |
| `apply_due_recurring(p_today date)` | Number of newly applied operations. Household lock and unique `(recurring_id,date)` prevent duplicate occurrences; updates `last_applied` in the same transaction. |
| `create_household_invite()` | One-use 73-character invitation token; expires after seven days. |

Regular transactions preserve the existing current-month behavior: this release does not backfill missed months or run scheduled bank debits. Applying them requires an active template account or active default account. An intentional deletion of an applied occurrence keeps `last_applied`, preventing immediate recreation that month.

The date of a generated recurring operation identifies its occurrence. Its amount, category, comment and account can be corrected, but moving its date while retaining the template identity could suppress a later scheduled occurrence; the edit RPC therefore keeps that date fixed.

Direct cashflow insertion is allowed for manual operations/import, with same-household account and attributed member checks. When accounts exist, omitted accounts resolve to the main active account for compatibility. Direct special ledger writes/deletion, account opening-balance changes and goal fund/archive mutations are rejected: use the atomic RPCs. Income/expense entry may overdraw an account, preserving existing behavior; transfer and savings reservation cannot invent available funds.

## Secure household registration

Household UUID is an identifier, not an invitation. Global household enumeration is removed, unauthenticated/client household creation is disabled, and direct profile membership reassignment is blocked.

`finance_schema_version()` returns the constant integer `1` and is safe for anonymous callers. The signup screen uses this readiness check instead of reading the protected accounts table. It exposes no household information.

The updated signup sends ordinary Supabase Auth metadata:

- Create: `household_action: "create"`, `household_name`, and existing `name/avatar/color`.
- Join: `household_action: "join"`, `invite_token`, and existing `name/avatar/color`.

The registration trigger atomically creates the household/profile or validates and consumes the invitation. `household_id` metadata does not grant access. Older clients sending only that field are rejected explicitly. Any existing household member can issue an invitation; this release does not add owner/editor/viewer roles. Tokens are two random UUIDs, stored only as SHA-256 hashes, expire in seven days and cannot be reused. Raw tokens are returned once to the member who creates them. Share tokens intentionally; possessing a valid token authorizes joining that household.

New household-owned tables enable RLS with household policies for all four operations. Invitation mutations are additionally denied through table grants; creation and consumption happen only through checked definer code. Existing foreign household users cannot inspect accounts, transfer into/from them, reserve their goals or change their own membership to gain access.

## Verification

Run `npm run test:database` after `npm install`. The reproducible suite lives in `tests/database.test.mjs` and runs the real initialization/migration SQL in an isolated in-memory PostgreSQL engine. It needs no database credentials and makes no network/database mutations. `@electric-sql/pglite` 0.5.9 is pinned as a development dependency because existing frontend packages cannot execute PostgreSQL/RLS/trigger logic and Docker is unavailable in the development environment. It has no frontend import and adds nothing to the mobile bundle.

The suite checks that migration and initialization SQL match, executes the actual migration twice, also runs the complete fresh schema, and creates authenticated/anonymous roles with an `auth.uid()` test fixture. Its 71 meaningful checks cover rejected-preview rollback, initialization idempotency, unchanged amounts/categories, exact `0.10 + 0.70` completion, transfer account balances and invariant household capital, cross-household checks, direct-write protection, simulated ledger failure rolling back a goal update, guarded cashflow editing, recurring identity/idempotency, archive idempotency, and secure signup/invitation use. It verifies anonymous schema readiness without account-table read privileges, and additionally demonstrates compatibility with a legacy `profiles.role` default and intentionally checks failure/rollback for `role NOT NULL` without a default; this does not establish which constraints exist in production.

PGlite embeds PostgreSQL but does not reproduce hosted Supabase Auth, PostgREST request mapping/row limits, email confirmation, publication delivery or multiple simultaneous server connections. Those require staging verification before rollout. Frontend ledger pagination and server totals must also be verified with more than the hosted API's response-row limit so account balances do not rely on truncated history.

## Local prototype and browser verification

Start `npm run dev` and open `http://127.0.0.1:5173/?demo=1`. Demo is available only in development, uses the actual application screens, isolates its data in `ff_demo_v1`, disables Supabase persistence/auto-refresh and blocks Supabase fetch. Use the permanent reset button to restore sample data. Production builds contain no demo branch or demo data.

Final verification: `npm test` passes 23 finance/auth tests; `npm run test:database` passes 71 SQL assertions; `npm run build` passes TypeScript, production build and PWA generation. Vite retains a general large-chunk advisory, but all JS and the PDF worker are now included in precache.

Browser checks at 320 and 390 CSS pixels covered account creation, a 123.45 Br transfer, 100 Br reservation, 50 Br release, excessive-reserve error, edit/manual entry and reload persistence; exact goal completion from 0.10 + 0.70; archive releasing funds and retaining history; category totals including unrecognized IDs; five synthetic 1C entries (66.25 Br) assigned to the selected account. The final import category remains above the measured 205 px footer at 320 px. A generated one-page PDF exercised lazy PDF.js/worker decoding and the expected empty-statement error. This is not a representative real-bank PDF parsing regression suite.

Read-only readiness inspection of the configured Supabase returned HTTP 404 / PGRST202 for `finance_schema_version`, so the migration is not exposed by the working server yet. No financial rows or live schema were modified. Administrator SQL access is required to apply the saved migration; the browser anon configuration cannot perform schema changes.

## Working database rollout

The preceding readiness limitation describes the initial local-development state. On 2026-10-12 the user connected Supabase and authorized updating the working application. Actual schema inspection confirmed `profiles.role` is NOT NULL with default 'Участник', compatible with the trigger. A private same-project snapshot was created using `docs/sql/backup-before-accounts.sql`, then the release migration was installed. Verification confirmed version 1 and equality of all 131 original transactions and four goals, including amounts/categories, with the backup. Initialization remains a user-reviewed operation; no old transactions were reclassified during deployment.

Security advisors found the intentional authenticated SECURITY DEFINER RPCs and backup tables with RLS/no client policies, plus an existing disabled leaked-password check. The RPCs perform explicit household checks and use fixed search paths. The private backup deliberately denies all client access. See [RPC advisor](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable), [backup RLS advisor](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy), and [existing password setting](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection). No unrelated authentication settings were changed.
