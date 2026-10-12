# Первый этап FinApp: счета и накопления

Первый этап реализован и проверен. Дизайн сохранен. Рабочая база обновлена 12 октября 2026 года после резервного копирования; исходные операции и цели сохранены. [Подробности миграции](migration-accounts.md).

## Попробовать

Запустить `npm run dev`, открыть http://127.0.0.1:5173/?demo=1. Демо хранит только свои данные на устройстве, не подключается к рабочей Supabase и имеет кнопку сброса.

1. Добавить счет с нулевым начальным остатком и записать перевод с основной карты. Общая сумма денег не изменится.
2. В «Планах» отложить деньги на отпуск. Остатки счетов сохранятся, свободная сумма уменьшится, резерв увеличится.
3. Вернуть часть резерва или архивировать цель. Сумма вернется в свободный остаток, история останется.
4. На главной найти покупку, исправить сумму/категорию/счет и проверить аналитику.
5. Создать цель со сроком: появится необходимый ежемесячный взнос. Прогноз по истории появляется только при реальных пополнениях.

## Проверено

- 23 автоматических теста точности денег, финансовых правил и загрузки профиля.
- 71 исполняемая SQL-проверка миграции, RLS, атомарности, приглашений и повторных регулярных операций.
- Сборка приложения и PWA; весь JavaScript и PDF-воркер включены в кеш.
- Интерфейс на ширине 320/390 px, основные операции, сохранение демо после обновления, импорт пяти тестовых операций 1C и запуск PDF-воркера.

## Что остается

Применить миграцию и проверить действующую схему, регистрацию/приглашения, Realtime и параллельные запросы в hosted Supabase. Работающий сервер проверен только на готовность нового интерфейса API: он вернул PGRST202; схема и реальные данные не изменялись.

Следующие функциональные этапы: общие конверты, распределение зарплаты, календарь до следующего дохода и сравнение сценариев покупки. Полноценный ввод без интернета, мультивалютность, новая банковская синхронизация и надежная серверная идентичность импортов пока не реализованы.

## Файлы этого этапа

Финансовая модель и состояние:

- `src/types.ts`
- `src/lib/money.ts`, `src/lib/finance.ts`, `src/lib/authLoadGuard.ts`
- `src/AppContext.tsx`, `src/AuthContext.tsx`, `src/App.tsx`
- `src/supabaseClient.ts` — дополнена изоляция демо; предыдущая настройка окружения сохранена.

Интерфейс:

- `src/components/AccountsPanel.tsx`, `src/components/TransactionEditor.tsx`
- `src/components/CarGoalForecastCard.tsx`, `src/components/PayDreamFirstBanner.tsx`, `src/components/MoneyLeaksCard.tsx`
- `src/screens/HomeScreen.tsx`, `src/screens/AddTransactionScreen.tsx`, `src/screens/AnalyticsScreen.tsx`, `src/screens/PlansScreen.tsx`
- `src/screens/BankStatementScreen.tsx`, `src/components/BankSyncModal.tsx`
- `src/screens/ProfileScreen.tsx`, `src/screens/RegisterScreen.tsx`
- `src/demo/DemoApp.tsx`

База, загрузка и проверки:

- `supabase/migrations/20261012_accounts_and_savings.sql`, `supabase_schema.sql`
- `src/services/alfaBankService.ts` — только отложенная загрузка PDF.js, без изменения парсеров.
- `vite.config.ts`
- `tests/finance.test.mjs`, `tests/auth.test.mjs`, `tests/database.test.mjs`
- `scripts/test-finance.mjs`, `package.json`, `package-lock.json`, `.gitignore`

Документация: `PROJECT.md`, `TASKS.md`, `docs/product-roadmap.md`, `docs/migration-accounts.md`, этот отчет. Ранее существовавшие изменения `.env.example` и исследование банковской интеграции сохранены.
