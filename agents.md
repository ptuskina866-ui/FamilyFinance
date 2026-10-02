# AGENTS.md

# FinApp AI Development Instructions

## Before making changes

Always read:

1. AGENTS.md
2. PROJECT.md
3. TASKS.md

Then inspect the existing implementation related to the task.

Do not start coding until you understand how the current feature works.

## Core principles

FinApp is an existing production-oriented application.

Preserve existing behavior unless the task explicitly requires changing it.

Prefer small, focused changes over large rewrites.

Do not refactor unrelated code.

Do not replace an existing implementation only because another approach looks cleaner.

Reuse existing project patterns whenever possible.

## Tech stack

Frontend:
- React 18
- TypeScript
- Vite
- Tailwind CSS

Backend/data:
- Supabase
- PostgreSQL
- Supabase Auth
- Row Level Security
- Supabase Realtime
- Supabase Edge Functions

Other:
- vite-plugin-pwa
- PDF.js
- Recharts
- Lucide React

Deployment:
- Cloudflare

## Application architecture

Main screens are located in:

src/screens/

Reusable UI is located in:

src/components/

Application state is primarily handled through:

src/AppContext.tsx
src/AuthContext.tsx

Supabase client:

src/supabaseClient.ts

External/integration services:

src/services/

Supabase backend functions:

supabase/functions/

Database schema:

supabase_schema.sql

## Financial data rules

Financial calculations must be deterministic.

Never use floating-point approximations when they can cause visible monetary errors.

Preserve existing database NUMERIC values correctly.

Do not silently modify transaction amounts.

Do not silently change transaction categories.

Any automatic categorization or bank import must allow the user to verify the resulting data.

Imported bank operations must not create duplicates.

When modifying bank-statement parsing, preserve support for all previously supported statement formats.

## Household isolation

FinApp supports household-level financial data.

Never expose data from another household.

Every database change involving user data must be checked against Supabase RLS rules.

Do not bypass RLS from the client.

When adding tables containing household-owned data:

- include household_id;
- enable RLS;
- add appropriate SELECT / INSERT / UPDATE / DELETE policies;
- ensure policies use the authenticated user's household.

## Authentication

Authentication is handled by Supabase Auth.

Do not implement custom password storage.

Do not store authentication tokens manually unless required by Supabase.

Profile and household loading logic must remain compatible with AuthContext.

## Supabase

Never expose:

- service-role keys;
- database passwords;
- private API credentials;
- access tokens.

Client-side Supabase configuration must use environment variables.

Do not hardcode credentials into source files.

Publishable/anon keys may be used on the client, but should still be configured through the environment.

Database schema changes must also be reflected in repository SQL/migrations.

## UI design system

Preserve the existing FinApp visual language:

- Neo-Fintech
- Liquid Glass
- frosted surfaces
- restrained gradients
- rounded cards
- mobile-first interface
- clear financial hierarchy

Do not introduce an unrelated design language.

Before creating a new component, inspect similar existing components.

Reuse existing spacing, typography, radius and glass patterns.

Avoid excessive visual effects that reduce readability.

Financial information must remain easy to scan.

## Mobile and PWA

FinApp is primarily a mobile PWA.

Every UI change must be checked for narrow mobile screens.

Avoid hover-only interactions.

Respect safe areas where applicable.

Do not break standalone PWA behavior.

When touching caching or service-worker behavior, take stale cached versions into account.

## Bank integrations

Current bank-related implementation includes Alfa-Bank support.

Relevant areas include:

src/components/BankSyncModal.tsx
src/screens/BankStatementScreen.tsx
src/services/alfaBankService.ts
supabase/functions/alfa-sync

Treat bank parsing as sensitive financial logic.

When changing it:

- inspect existing parsers first;
- preserve old formats;
- handle malformed input;
- prevent duplicate imports;
- test representative statement formats.

## TypeScript

Keep strict typing.

Avoid `any` unless there is a documented reason.

Prefer existing domain types from src/types.ts.

If domain data changes, update shared types rather than defining inconsistent local copies.

## State management

Inspect AppContext before introducing additional global state.

Do not introduce another state-management library unless there is a strong architectural reason.

Keep server-backed data and local UI state clearly separated.

## Dependencies

Do not introduce new npm dependencies unless necessary.

Before adding one:

1. verify that existing dependencies cannot solve the problem;
2. consider bundle size;
3. consider mobile/PWA impact;
4. explain why it is needed.

## Database changes

Before changing the database:

- inspect supabase_schema.sql;
- inspect existing RLS policies;
- identify affected application code.

Never drop tables or user data without explicit approval.

Prefer additive and backwards-compatible schema changes.

## Build verification

Current project commands:

npm install
npm run dev
npm run build

There is currently no dedicated automated test script.

At minimum after code changes:

1. run `npm run build`;
2. resolve TypeScript errors;
3. inspect the final diff.

If tests are later added, run them before completing work.

## Git workflow

Do not:

- force push;
- rewrite history;
- delete unrelated changes;
- commit secrets;
- modify unrelated files.

Before finishing:

- inspect git diff;
- report changed files;
- report build/test results;
- mention anything that could not be verified.

## Documentation

If architecture, database schema, integrations or important business rules change:

update PROJECT.md.

After meaningful task progress:

update TASKS.md.

## Multi-agent workflow

This repository may be edited by multiple AI coding agents.

Before starting a task:

- inspect the current git status;
- read TASKS.md;
- do not assume previous agent work is complete.

When finishing:

- update TASKS.md with completed work;
- leave the repository in a buildable state;
- clearly document unfinished work.

If reviewing another agent's implementation:

- inspect the diff rather than reimplementing the task;
- focus on correctness, regressions, security and missing edge cases.