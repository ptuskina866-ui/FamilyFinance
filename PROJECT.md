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

supabase/functions/
Supabase Edge Functions.

supabase_schema.sql
Database schema, functions and RLS policies.

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

## Security model

Supabase Row Level Security is enabled.

Financial data is isolated by household.

Helper function:

public.get_my_household_id()

is used by RLS policies to resolve the authenticated user's household.

Client code must not circumvent this model.

## Authentication

Supabase Auth is used.

After signup, a database trigger creates the corresponding profile.

AuthContext manages:

- Supabase session;
- authenticated user;
- profile;
- household.

## Bank integration

FinApp contains Alfa-Bank integration and statement parsing.

Key implementation areas:

src/services/alfaBankService.ts

src/components/BankSyncModal.tsx

src/screens/BankStatementScreen.tsx

supabase/functions/alfa-sync

PDF parsing is supported through pdfjs-dist.

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

There is currently no dedicated automated test command in package.json.

Build/type-check is therefore the minimum required automated verification.

A future improvement should introduce unit tests for:

- bank parsers;
- financial calculations;
- forecasting logic;
- duplicate transaction detection.