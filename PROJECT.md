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

Direct API synchronization (`alfa-sync`) is currently in demonstration/research mode. Official Open API connectivity research is documented in `docs/alfa-bank-integration-research.md`; bank FAQ confirms Open API is free, but production access for individuals requires contract approval from Alfa-Bank.

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

## Accounts release deployment

Apply `supabase/migrations/20261012_accounts_and_savings.sql` together with the updated frontend after reviewing the actual schema. The same SQL section is included in `supabase_schema.sql` for fresh installations. Details: `docs/migration-accounts.md`.

The accounts migration was applied to the configured Supabase project on 2026-10-12 after inspection and a private same-project backup. `finance_schema_version()` returns 1. All 131 existing transactions and four goals were compared with the backup and remained unchanged. The live `profiles.role` field is NOT NULL with a default of 'Участник', compatible with the revised registration trigger. Cloudflare Workers Builds is connected to GitHub main for frontend publishing. Account initialization remains an explicit, reviewed user action.

Working URL: https://familyfinance.ptuskina866.workers.dev/. Cloudflare must set the two VITE variables in **Build variables and secrets**. Runtime Worker bindings do not configure this static Vite bundle. Builds now fail before publishing if either variable is absent. The corrected deployed bundle, login screen, Supabase Auth settings and accounts capability RPC were verified successfully with the deployed public key.

## Shared monthly budgets and income distribution

`src/lib/planning.ts` calculates envelope spending/reservations, unassigned daily consumption, uncovered recurring bills, and a 35-day cashflow scenario in integer kopecks. `src/components/BudgetPlanner.tsx` is the third Plans subtab. `category_budgets` and `income_distributions` are household-owned, RLS-enabled, Realtime tables; direct client writes are revoked. Funding is performed only through household-locked RPCs `set_category_budget` and `distribute_income`.

Budgets represent the total monthly category allocation; only its unspent part is reserved. Available funds equal capital minus active goals minus unspent current-month budgets. Funded purchases and scheduled bills are excluded from the unassigned daily pool to prevent double reservation. General food and individual food-store budgets cannot overlap. Setting a budget to zero releases its remaining funds, preserving expense history. Budgets expire at the month boundary and do not carry forward automatically.

Planning uses Europe/Minsk as the shared BYN household calendar, including travel across time zones. The application refreshes at a planning-day boundary. Planning rows and ledger rows are paginated to avoid hosted API response limits.

Income distribution is a confirmed, atomic, one-use action for an already posted income in the current month. Its allocations cannot exceed either that income or current free funds. It adds available budget money above already spent amounts, reserves goal contributions and records the decision without creating a second income. Source income cannot be deleted, re-dated, changed to an expense or reduced below the distribution total. Releasing a goal or budget does not make that income eligible for a second distribution. Full reversal/editing of a distribution is future work; partial plans must be reviewed before confirming.

`supabase/migrations/20261012_shared_budgets.sql` was installed on 2026-10-12 after a private snapshot of current transactions, goals, accounts and affected RPC definitions. All existing rows remained unchanged. The accounts capability marker stays at 1 for installed-client compatibility; `finance_planning_version()` is 1. The same migration is appended to the fresh-install schema. Details and validation: `docs/budgets-release.md`.
