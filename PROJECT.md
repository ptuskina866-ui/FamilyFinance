# PROJECT.md

# FinApp / FamilyFinance

## Purpose

FinApp is a mobile-first personal and household finance PWA.

The application helps users:

- track income and expenses;
- manage household finances;
- analyze spending;
- import bank transactions;
- manage recurring transactions;
- create savings goals;
- estimate progress toward financial goals;
- understand how much money is safe to spend.

## Product name

Repository:
FamilyFinance

PWA short name:
FinApp

## Stack

Frontend:
- React 18
- TypeScript
- Vite
- Tailwind CSS

Backend:
- Supabase
- PostgreSQL
- Supabase Auth
- Supabase Realtime
- Supabase Edge Functions

Libraries:
- @supabase/supabase-js
- lucide-react
- pdfjs-dist
- recharts
- vite-plugin-pwa

Deployment:
- Cloudflare

## Main project structure

src/App.tsx
Application root and screen composition.

src/AppContext.tsx
Primary financial application state and data operations.

src/AuthContext.tsx
Supabase authentication, user profile and household state.

src/types.ts
Shared domain types.

src/supabaseClient.ts
Supabase browser client.

src/components/
Reusable application components.

src/screens/
Application screens.

src/services/
Integration and service logic.

src/lib/money.ts and src/lib/finance.ts
Exact integer-kopeck arithmetic, account balances, savings reservations, spending estimates and contribution-based goal plans.

src/demo/DemoApp.tsx
Development-only local demo (`?demo=1`). It reuses application screens, persists only isolated demo records and makes no Supabase requests. It is excluded from production builds.

supabase/functions/
Supabase Edge Functions.

supabase_schema.sql
Database initialization script (tables, functions, RLS policies, registration trigger, and Realtime publications). Changes must be statically checked for syntax and idempotency; full execution verification requires an isolated test Supabase/PostgreSQL environment. Do not assume exact schema identity with the live database without explicit verification.

## Screens

- HomeScreen
- AnalyticsScreen
- AddTransactionScreen
- BankStatementScreen
- PlansScreen
- ProfileScreen
- LoginScreen
- RegisterScreen

## Important components

- BankSyncModal
- BottomNav
- CarGoalForecastCard
- CategoryGrid
- ErrorBoundary
- Layout
- MoneyLeaksCard
- PayDreamFirstBanner
- SafeToSpendCard

## Main domain entities

### Household

Represents a shared family/household financial workspace.

Table:
households

### Profile

Application profile associated with a Supabase Auth user.

Table:
profiles

Profiles belong to households.

### Transaction

Income or expense operation.

Table:
transactions

Fields include:

- type
- amount
- category
- comment
- date
- creator
- household
- source account and optional transfer destination
- kind: cashflow / transfer / goal_deposit / goal_release
- optional goal and recurring-template links

### Account

Table: `accounts`. Household-owned BYN bank, cash or savings account with an opening balance. Opening capital and transfers are excluded from income/expense analytics. Transfers are one atomic ledger row with both accounts.

### Recurring transaction

Recurring income or expense.

Table:
recurring_transactions

### Savings goal

Financial saving target.

Table:
savings_goals

Fields include:

- target amount
- current amount
- deadline
- completion state
- archive state

Goal funds are reservations within household capital. Reserving/releasing does not move funds between bank accounts or count as consumption/income. Archive releases funds while preserving history. Server RPCs update goal funds and ledger rows atomically.

## Security model

Supabase Row Level Security is enabled.

Financial data is isolated by household.

Helper function:

public.get_my_household_id()

is used by RLS policies to resolve the authenticated user's household.

Client code must not circumvent this model.

The installed accounts release adds one-use, seven-day household invitations. Signup creates a household or consumes a validated invitation in the registration trigger; arbitrary household UUID metadata and direct profile membership changes are rejected. Existing memberships remain intact.

## Authentication

Supabase Auth is used.

After signup, a database trigger creates the corresponding profile.

AuthContext manages:

- Supabase session;
- authenticated user;
- profile;
- household.

## Bank integration

FinApp supports bank statement import and parses Alfa-Bank card statement PDF and 1C formats locally via `pdfjs-dist` and `alfaBankService.ts`.

Key implementation areas:

src/services/alfaBankService.ts

src/components/BankSyncModal.tsx

src/screens/BankStatementScreen.tsx

supabase/functions/alfa-sync

docs/alfa-bank-integration-research.md

Direct API synchronization (`alfa-sync`) remains unavailable pending approved bank access. Fabricated login success, accounts and transactions have been removed from both client and Edge Function. The endpoint returns an explicit 503 `ALFA_CONNECTION_NOT_CONFIGURED`, keeps JWT verification enabled, and neither reads credentials nor calls undocumented banking endpoints. Statement parsing/import remains available and unchanged. Current access findings and owner setup are documented in `docs/alfa-bank-integration-research.md`.

Bank import logic is considered sensitive because incorrect parsing can corrupt financial analytics.

## PWA

FinApp is configured as an installable PWA.

Manifest:

Name:
FamilyFinance

Short name:
FinApp

Display:
standalone

Orientation:
portrait

Service worker update mode:
autoUpdate

The application is primarily designed for mobile usage.

PDF.js is loaded on demand; its worker is included in the PWA asset cache. Financial data remains server-backed and requires a network connection; offline entry/synchronization is a future feature.

## UI

Current visual direction:

Neo-Fintech / Liquid Glass.

Key characteristics:

- frosted glass surfaces;
- clean mobile cards;
- rounded geometry;
- restrained modern financial UI;
- strong information hierarchy.

New screens and components should remain visually consistent with this system.

## Important business behavior

Transactions are shared within a household.

Financial analytics rely on transaction accuracy.

Bank-imported transactions must avoid duplication.

Savings and forecasting functionality relies on correct historic transaction data.

Financial values must not be silently rounded, altered or dropped.

Accounts initialization previews recognizable old savings deposits/refunds and the resulting capital/reserved/free balances. Only selected rows change their accounting kind; monetary values and category IDs remain untouched. Unselected legacy rows remain cashflow, and incomplete history can leave a visible negative free balance requiring reconciliation.

The daily estimate has no artificial positive minimum, excludes goal reservations and unposted remaining monthly obligations, and never treats forecast income as available funds. Goal forecasts use actual linked net contributions; insufficient history produces no invented savings rate.

Transactions are loaded in stable 500-row pages so the hosted API response limit does not silently truncate account balances. Goals and recurring templates subscribe to household Realtime updates. Regular occurrences are applied atomically with a unique template/date identity; missed months are not backfilled.

Auth profile loading rejects stale responses after user changes or sign-out, and financial loading accepts only a profile belonging to the current authenticated user.

## Environment

Expected frontend environment variables:

VITE_SUPABASE_URL

VITE_SUPABASE_ANON_KEY

Secrets must never be committed to the repository.

## Development

Install dependencies:

npm install

Start development server:

npm run dev

Production build:

npm run build

Preview build:

npm run preview

## Current technical limitations

`npm test` checks exact money, financial calculations, forecasts and auth-loading races using the Node test runner and installed TypeScript compiler.

`npm run test:database` runs executable PostgreSQL migration/RLS/atomicity checks in isolated PGlite. PGlite is a development-only dependency and does not enter the mobile bundle. Hosted Supabase Auth, Realtime and concurrent independent connections still require staging verification.

`npm run build` checks TypeScript, production assets and PWA generation.

Bank parser fixtures and robust server-side import identity remain future test/implementation work. Account selection now scopes duplicate preview to the chosen account; existing heuristic duplicate detection remains.

## Automatic recurring-expense insights

`src/lib/recurringInsights.ts` derives read-only monthly hypotheses from the already loaded household ledger. Main and Plans → Payments share `src/components/RecurringInsights.tsx`. Two adjacent monthly payments produce an explicitly preliminary suggestion; three to six produce a longer observed rhythm. Each merchant/account group needs exactly one expense per consecutive month and billing days within four days (month-end clamped). Generic comments, invalid/future/stale rows, transfers, savings movements and auto-posted recurring rows do not count as evidence. Merchant punctuation/case are normalized; account and merchant/branch numbers stay distinct.

Each insight shows original dates/amounts, latest exact-cent price change and an estimated next date, including passed dates without treating them as debt. The main screen can filter the journal to those original transaction IDs and restore all operations. Existing active recurring templates are marked only for the same account and merchant. Insufficient history produces a useful empty state; the last recorded operation is displayed without claiming that bank synchronization occurred.

Suggestions never create recurring templates, write transactions, change categories/amounts or reserve funds; existing confirmed templates retain their current automatic posting behavior. The analysis uses the Minsk planning day, adds no dependencies, schema, external AI or new data stores, and is limited to one monthly cadence. Known limitations: exact normalized descriptions can miss merchants with changing reference text; two payments can be coincidental; completeness still depends on imported history. Release checks and publication status: `docs/automation-insights-release.md`.

## Accounts release deployment

Apply `supabase/migrations/20261012_accounts_and_savings.sql` together with the updated frontend after reviewing the actual schema. The same SQL section is included in `supabase_schema.sql` for fresh installations. Details: `docs/migration-accounts.md`.

The accounts migration was applied to the configured Supabase project on 2026-10-12 after inspection and a private same-project backup. `finance_schema_version()` returns 1. All 131 existing transactions and four goals were compared with the backup and remained unchanged. The live `profiles.role` field is NOT NULL with a default of 'Участник', compatible with the revised registration trigger. Cloudflare Workers Builds is connected to GitHub main for frontend publishing. Account initialization remains an explicit, reviewed user action.

Working URL: https://familyfinance.ptuskina866.workers.dev/. Cloudflare must set the two VITE variables in **Build variables and secrets**. Runtime Worker bindings do not configure this static Vite bundle. Builds now fail before publishing if either variable is absent. The corrected deployed bundle, login screen, Supabase Auth settings and accounts capability RPC were verified successfully with the deployed public key.

## Shared monthly budgets and income distribution

`src/lib/planning.ts` calculates envelope spending/reservations, unassigned daily consumption, uncovered recurring bills, and a 35-day cashflow scenario in integer kopecks. `src/components/BudgetPlanner.tsx` is the third Plans subtab. `category_budgets` and `income_distributions` are household-owned, RLS-enabled, Realtime tables; direct client writes are revoked. Funding is performed only through household-locked RPCs `set_category_budget` and `distribute_income`.

Budgets represent the total monthly category allocation; only its unspent part is reserved. Available funds equal capital minus active goals minus unspent current-month budgets. Funded purchases and scheduled bills are excluded from the unassigned daily pool to prevent double reservation. General food and individual food-store budgets cannot overlap. Setting a budget to zero releases its remaining funds, preserving expense history. Budgets expire at the month boundary and do not carry forward automatically.

Planning uses Europe/Minsk as the shared BYN household calendar, including travel across time zones. The application refreshes at a planning-day boundary. Planning rows and ledger rows are paginated to avoid hosted API response limits.

Income distribution is a confirmed atomic action for an already posted income in the current month. Its allocations cannot exceed either that income or current free funds. It adds available budget money above already spent amounts, reserves goal contributions and records the decision without creating a second income. Source income cannot be deleted, re-dated or changed to an expense; while its plan is active, it cannot be reduced below the distribution total. The flexible-planning extension allows reviewed editing/cancellation of that one distribution record, with revisions and reservation-preview checks; it does not create duplicate distributions.

`supabase/migrations/20261012_shared_budgets.sql` was installed on 2026-10-12 after a private snapshot of current transactions, goals, accounts and affected RPC definitions. All existing rows remained unchanged. The accounts capability marker stays at 1 for installed-client compatibility; `finance_planning_version()` is 1. The same migration is appended to the fresh-install schema. Details and validation: `docs/budgets-release.md`.

Stage-two frontend publication was confirmed on 2026-10-13: merged PR #3 (`8cbe769`), successful Cloudflare build and deployed version `6c6dcf8a-906f-4743-88f7-7aa8915d3cba`. Production bundle includes planning, renders login without runtime errors, and accesses the planning capability API successfully. Authenticated financial actions and cross-device Realtime remain separate verification items.

## Flexible planning, salary templates and funds

`src/lib/flexiblePlanning.ts` and the new BudgetManagement, IncomeTemplates and FundsPlanner components extend the existing financial model. No additional runtime dependencies were introduced. New database tables `income_templates`, `budget_rollovers`, `income_distribution_revisions` have household RLS, indexes, Realtime and read-only client grants; their changes use household-locked RPCs. Internal helpers are in the unexposed `finance_private` schema without client access.

Category transfers move only unspent reserves, fund an overspent destination above its prior spending, and preserve both capital and free funds, including an existing deficit. A previous month can be reviewed once: repeat its total plan into an empty month, reserve its remaining money again in current categories, direct it to one goal, or keep it free. Previous reserves already expire automatically; review never adds capital or refunds money a second time. Every choice uses a confirmed preview and current available funds.

Income edits/cancellations release only reserves currently available, including net goal contributions linked to that distribution. Existing purchases, amounts and categories are preserved. Partial consumption/release reduces the refund shown before confirmation. The server verifies both expected revision and refund JSON to reject stale decisions. Compensation rows preserve goal history. Cancelled plans can be assigned again by updating the same record. Only current-month distributions are editable.

Salary templates contain ordered fixed amounts or percentages of posted income, with exact integer-kopeck/BigInt calculations. Lower priorities can be partially funded when money is insufficient; the preview explains this and requires explicit confirmation. Templates themselves move no funds and archive without deleting distribution history.

Savings goals now support purposes `goal`, `emergency` and `expense_fund`. Existing goals remain `goal`; no existing savings amounts were reclassified. Emergency targets equal confirmed necessary monthly expenses times 1–12 months. A suggestion averages selected cashflow categories over three completed Minsk months, including zero months, and remains subject to user confirmation. Expense funds reuse goal reservations, target/deadline and contribution rules. All funds remain part of the same goal reserve, avoiding duplicate accounting.

Migration `supabase/migrations/20261013085847_flexible_planning.sql` was created with the Supabase CLI and installed after a private snapshot on 2026-10-13. Existing financial rows were compared with the snapshot and remained unchanged. Capability markers stay compatible at 1; `finance_flexible_planning_version()` is 1. Details: `docs/flexible-planning-release.md`.
