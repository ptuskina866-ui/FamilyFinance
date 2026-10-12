-- ====================================================================
-- Скрипт инициализации БД для приложения "Семейный Бюджет"
-- Скопируйте этот код и запустите его в Supabase -> SQL Editor -> New Query
-- ====================================================================

-- 1. Создание таблицы семейных групп (домохозяйств)
CREATE TABLE IF NOT EXISTS households (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- 2. Создание таблицы пользовательских профилей
CREATE TABLE IF NOT EXISTS profiles (
  id UUID REFERENCES auth.users ON DELETE CASCADE PRIMARY KEY,
  name TEXT NOT NULL,
  avatar TEXT NOT NULL DEFAULT '👤',
  color TEXT NOT NULL DEFAULT '#3b82f6',
  household_id UUID REFERENCES households ON DELETE SET NULL,
  updated_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- 3. Создание таблицы транзакций (доходов и расходов)
CREATE TABLE IF NOT EXISTS transactions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  type TEXT NOT NULL CHECK (type IN ('income', 'expense')),
  amount NUMERIC(12, 2) NOT NULL,
  category_id TEXT NOT NULL,
  comment TEXT DEFAULT '',
  added_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  household_id UUID REFERENCES households(id) ON DELETE CASCADE,
  date DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- 4. Включение безопасности на уровне строк (Row Level Security - RLS)
ALTER TABLE households ENABLE ROW LEVEL SECURITY;
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;

-- ====================================================================
-- ВСПОМОГАТЕЛЬНАЯ ФУНКЦИЯ ДЛЯ ОБХОДА РЕКУРСИИ В RLS
-- ====================================================================
-- Функция определена с SECURITY DEFINER, что позволяет выполнять запросы
-- к таблице profiles в обход её политик RLS (с правами создателя базы данных).
-- Это предотвращает бесконечную рекурсию при проверке household_id.
CREATE OR REPLACE FUNCTION public.get_my_household_id()
RETURNS UUID AS $$
  SELECT household_id FROM public.profiles WHERE id = auth.uid();
$$ LANGUAGE sql SECURITY DEFINER;

-- 5. Политики безопасности RLS для таблицы households

-- Разрешить любому пользователю создавать семейную группу (включая анонимных при регистрации)
DROP POLICY IF EXISTS "Любой пользователь может создать семью" ON households;
CREATE POLICY "Любой пользователь может создать семью" ON households
  FOR INSERT WITH CHECK (true);

-- Разрешить любому пользователю просматривать семью по ID (нужно для проверки существования при присоединении)
DROP POLICY IF EXISTS "Пользователи могут искать семью по ID" ON households;
CREATE POLICY "Пользователи могут искать семью по ID" ON households
  FOR SELECT USING (true);

-- Разрешить пользователям обновлять информацию только о своей семье
DROP POLICY IF EXISTS "Пользователи могут изменять данные своей семьи" ON households;
CREATE POLICY "Пользователи могут изменять данные своей семьи" ON households
  FOR UPDATE USING (
    id = public.get_my_household_id()
  );

-- 6. Политики безопасности RLS для таблицы profiles

-- Разрешить создание собственного профиля при регистрации
DROP POLICY IF EXISTS "Пользователи создают собственный профиль" ON profiles;
CREATE POLICY "Пользователи создают собственный профиль" ON profiles
  FOR INSERT WITH CHECK (auth.uid() = id);

-- Разрешить чтение профилей только членов своей семьи
DROP POLICY IF EXISTS "Пользователи видят профили своей семьи" ON profiles;
CREATE POLICY "Пользователи видят профили своей семьи" ON profiles
  FOR SELECT USING (
    id = auth.uid() OR
    household_id = public.get_my_household_id()
  );

-- Разрешить обновление только своего профиля
DROP POLICY IF EXISTS "Пользователи обновляют только свой профиль" ON profiles;
CREATE POLICY "Пользователи обновляют только свой профиль" ON profiles
  FOR UPDATE USING (auth.uid() = id);

-- 7. Политики безопасности RLS для таблицы transactions

-- Разрешить просмотр транзакций только членов своей семьи (по совпадению household_id)
DROP POLICY IF EXISTS "Пользователи могут просматривать транзакции своей семьи" ON transactions;
CREATE POLICY "Пользователи могут просматривать транзакции своей семьи" ON transactions
  FOR SELECT USING (
    household_id = public.get_my_household_id()
  );

-- Разрешить добавление транзакций только в рамках своей семьи
DROP POLICY IF EXISTS "Пользователи могут создавать транзакции в своей семье" ON transactions;
CREATE POLICY "Пользователи могут создавать транзакции в своей семье" ON transactions
  FOR INSERT WITH CHECK (
    household_id = public.get_my_household_id()
  );

-- Разрешить удаление транзакций любым членом той же семьи
DROP POLICY IF EXISTS "Пользователи могут удалять транзакции в своей семье" ON transactions;
CREATE POLICY "Пользователи могут удалять транзакции в своей семье" ON transactions
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid()
        AND profiles.household_id = transactions.household_id
    )
  );

-- ====================================================================
-- 8. ТРИГГЕР ДЛЯ АВТОМАТИЧЕСКОГО СОЗДАНИЯ ПРОФИЛЯ ПРИ РЕГИСТРАЦИИ
-- ====================================================================
-- Этот триггер срабатывает на стороне базы данных при регистрации нового 
-- пользователя в Supabase Auth и копирует метаданные профиля (имя, аватар,
-- цвет, household_id) из auth.users в таблицу profiles с правами администратора.
-- Это решает проблему RLS-ограничений в случае, если включено подтверждение email.

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, name, avatar, color, household_id)
  VALUES (
    new.id,
    COALESCE(new.raw_user_meta_data->>'name', 'Участник'),
    COALESCE(new.raw_user_meta_data->>'avatar', '👤'),
    COALESCE(new.raw_user_meta_data->>'color', '#3b82f6'),
    CASE 
      WHEN (new.raw_user_meta_data->>'household_id') IS NOT NULL AND (new.raw_user_meta_data->>'household_id') <> ''
      THEN (new.raw_user_meta_data->>'household_id')::UUID
      ELSE NULL
    END
  );
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Привязка функции к событию создания пользователя в auth.users
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();

-- ====================================================================
-- 9. НАСТРОЙКА SUPABASE REALTIME
-- ====================================================================
-- Добавляет таблицы в публикацию Supabase Realtime для включения
-- трансляции событий (INSERT, UPDATE, DELETE) клиентам по вебсокетам.
-- Блок проверяет, добавлены ли уже таблицы, чтобы избежать ошибок дублирования.
DO $$
BEGIN
  -- Добавляем transactions, если её еще нет в публикации
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_rel pr
    JOIN pg_publication p ON p.oid = pr.prpubid
    JOIN pg_class c ON c.oid = pr.prrelid
    WHERE p.pubname = 'supabase_realtime' AND c.relname = 'transactions'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE transactions;
  END IF;

  -- Добавляем profiles, если её еще нет в публикации
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_rel pr
    JOIN pg_publication p ON p.oid = pr.prpubid
    JOIN pg_class c ON c.oid = pr.prrelid
    WHERE p.pubname = 'supabase_realtime' AND c.relname = 'profiles'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE profiles;
  END IF;
END $$;

-- 10. Таблица регулярных платежей
CREATE TABLE IF NOT EXISTS recurring_transactions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  household_id UUID REFERENCES households(id) ON DELETE CASCADE,
  added_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  type TEXT NOT NULL CHECK (type IN ('income', 'expense')),
  amount NUMERIC(12, 2) NOT NULL,
  category_id TEXT NOT NULL,
  comment TEXT DEFAULT '',
  day_of_month INT NOT NULL CHECK (day_of_month BETWEEN 1 AND 28),
  last_applied DATE,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

ALTER TABLE recurring_transactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Пользователи видят регулярные своей семьи" ON recurring_transactions;
CREATE POLICY "Пользователи видят регулярные своей семьи" ON recurring_transactions
  FOR SELECT USING (household_id = public.get_my_household_id());

DROP POLICY IF EXISTS "Пользователи создают регулярные в своей семье" ON recurring_transactions;
CREATE POLICY "Пользователи создают регулярные в своей семье" ON recurring_transactions
  FOR INSERT WITH CHECK (household_id = public.get_my_household_id());

DROP POLICY IF EXISTS "Пользователи удаляют регулярные своей семьи" ON recurring_transactions;
CREATE POLICY "Пользователи удаляют регулярные своей семьи" ON recurring_transactions
  FOR DELETE USING (household_id = public.get_my_household_id());

DROP POLICY IF EXISTS "Пользователи обновляют регулярные своей семьи" ON recurring_transactions;
CREATE POLICY "Пользователи обновляют регулярные своей семьи" ON recurring_transactions
  FOR UPDATE USING (household_id = public.get_my_household_id());

-- 11. Таблица целей накоплений
CREATE TABLE IF NOT EXISTS savings_goals (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  household_id UUID REFERENCES households(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  target_amount NUMERIC(12, 2) NOT NULL,
  current_amount NUMERIC(12, 2) DEFAULT 0,
  emoji TEXT DEFAULT '🎯',
  deadline DATE,
  is_completed BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

ALTER TABLE savings_goals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Пользователи видят цели своей семьи" ON savings_goals;
CREATE POLICY "Пользователи видят цели своей семьи" ON savings_goals
  FOR SELECT USING (household_id = public.get_my_household_id());

DROP POLICY IF EXISTS "Пользователи создают цели в своей семье" ON savings_goals;
CREATE POLICY "Пользователи создают цели в своей семье" ON savings_goals
  FOR INSERT WITH CHECK (household_id = public.get_my_household_id());

DROP POLICY IF EXISTS "Пользователи обновляют цели своей семьи" ON savings_goals;
CREATE POLICY "Пользователи обновляют цели своей семьи" ON savings_goals
  FOR UPDATE USING (household_id = public.get_my_household_id());

DROP POLICY IF EXISTS "Пользователи удаляют цели своей семьи" ON savings_goals;
CREATE POLICY "Пользователи удаляют цели своей семьи" ON savings_goals
  FOR DELETE USING (household_id = public.get_my_household_id());

-- Добавляем новые таблицы в Realtime
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_rel pr
    JOIN pg_publication p ON p.oid = pr.prpubid
    JOIN pg_class c ON c.oid = pr.prrelid
    WHERE p.pubname = 'supabase_realtime' AND c.relname = 'recurring_transactions'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE recurring_transactions;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_rel pr
    JOIN pg_publication p ON p.oid = pr.prpubid
    JOIN pg_class c ON c.oid = pr.prrelid
    WHERE p.pubname = 'supabase_realtime' AND c.relname = 'savings_goals'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE savings_goals;
  END IF;
END $$;

-- 12. Accounts and atomic savings (2026-10-12)
-- Accounts, exact savings reservations, atomic money operations and household invitations.
-- Apply to a BACKED UP, reviewed database with the new frontend deployed together.
-- This migration never reclassifies existing transactions without initialize_finance consent.
BEGIN;

CREATE TABLE IF NOT EXISTS public.accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id UUID NOT NULL REFERENCES public.households(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 80),
  kind TEXT NOT NULL CHECK (kind IN ('bank', 'cash', 'savings')),
  currency TEXT NOT NULL DEFAULT 'BYN' CHECK (currency = 'BYN'),
  opening_balance NUMERIC(12, 2) NOT NULL DEFAULT 0,
  is_archived BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS account_id UUID REFERENCES public.accounts(id);
ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS target_account_id UUID REFERENCES public.accounts(id);
ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'cashflow';
ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS goal_id UUID REFERENCES public.savings_goals(id) ON DELETE SET NULL;
ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS recurring_id UUID REFERENCES public.recurring_transactions(id) ON DELETE SET NULL;
ALTER TABLE public.recurring_transactions ADD COLUMN IF NOT EXISTS account_id UUID REFERENCES public.accounts(id);
ALTER TABLE public.savings_goals ADD COLUMN IF NOT EXISTS is_archived BOOLEAN NOT NULL DEFAULT false;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'transactions_finance_kind_check' AND conrelid = 'public.transactions'::regclass) THEN
    ALTER TABLE public.transactions ADD CONSTRAINT transactions_finance_kind_check
      CHECK (kind IN ('cashflow', 'transfer', 'goal_deposit', 'goal_release')) NOT VALID;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS accounts_household_idx ON public.accounts(household_id);
CREATE INDEX IF NOT EXISTS transactions_account_idx ON public.transactions(account_id);
CREATE UNIQUE INDEX IF NOT EXISTS transactions_recurring_occurrence_uidx
  ON public.transactions(recurring_id, date) WHERE recurring_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.household_invites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id UUID NOT NULL REFERENCES public.households(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  created_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '7 days'),
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS household_invites_household_idx ON public.household_invites(household_id);

-- All definer functions fix search_path and check the caller's household themselves.
-- Anonymous signup can check readiness without reading a household-owned table.
CREATE OR REPLACE FUNCTION public.finance_schema_version()
RETURNS INTEGER LANGUAGE sql IMMUTABLE SET search_path = '' AS $$ SELECT 1; $$;

CREATE OR REPLACE FUNCTION public.get_my_household_id()
RETURNS UUID LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT household_id FROM public.profiles WHERE id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION public.finance_household_lock()
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_household UUID;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  SELECT household_id INTO v_household FROM public.profiles WHERE id = auth.uid();
  IF v_household IS NULL THEN RAISE EXCEPTION 'Household required'; END IF;
  PERFORM 1 FROM public.households WHERE id = v_household FOR UPDATE;
  RETURN v_household;
END;
$$;

CREATE OR REPLACE FUNCTION public.finance_capital(p_household UUID)
RETURNS NUMERIC LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT COALESCE((SELECT sum(opening_balance) FROM public.accounts WHERE household_id = p_household), 0)
    + COALESCE((SELECT sum(CASE WHEN type = 'income' THEN amount ELSE -amount END)
      FROM public.transactions WHERE household_id = p_household AND kind = 'cashflow'), 0);
$$;

CREATE OR REPLACE FUNCTION public.finance_account_balance(p_account UUID)
RETURNS NUMERIC LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT a.opening_balance + COALESCE((SELECT sum(
    CASE WHEN t.kind = 'cashflow' AND t.account_id = a.id THEN CASE WHEN t.type = 'income' THEN t.amount ELSE -t.amount END
      WHEN t.kind = 'transfer' AND t.account_id = a.id THEN -t.amount
      WHEN t.kind = 'transfer' AND t.target_account_id = a.id THEN t.amount ELSE 0 END)
    FROM public.transactions t WHERE t.account_id = a.id OR t.target_account_id = a.id), 0)
  FROM public.accounts a WHERE a.id = p_account;
$$;

CREATE OR REPLACE FUNCTION public.finance_validate_amount(p_amount NUMERIC, p_allow_negative BOOLEAN DEFAULT false)
RETURNS VOID LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF p_amount IS NULL OR p_amount::text IN ('NaN', 'Infinity', '-Infinity')
    OR p_amount <> round(p_amount, 2) OR abs(p_amount) > 9999999999.99
    OR (NOT p_allow_negative AND p_amount <= 0) OR (p_allow_negative AND p_amount = 0) THEN
    RAISE EXCEPTION 'Amount must be a finite nonzero value with at most two decimal places';
  END IF;
END;
$$;

-- Trigger runs as INVOKER: direct API writes run as authenticated; definer RPCs
-- run as their privileged owner. A client-controlled setting cannot bypass this guard.
CREATE OR REPLACE FUNCTION public.guard_finance_write()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE v_household UUID; v_privileged BOOLEAN; v_default UUID;
BEGIN
  SELECT COALESCE(rolsuper OR rolbypassrls, false) INTO v_privileged
    FROM pg_catalog.pg_roles WHERE rolname = current_user;
  v_household := CASE WHEN TG_OP = 'DELETE' THEN OLD.household_id ELSE NEW.household_id END;
  IF NOT v_privileged AND (auth.uid() IS NULL OR v_household IS DISTINCT FROM public.get_my_household_id()) THEN
    RAISE EXCEPTION 'Household access denied';
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.household_id IS DISTINCT FROM OLD.household_id THEN
    RAISE EXCEPTION 'Financial records cannot change household';
  END IF;
  -- Serializes every client mutation with atomic RPCs, including normal expenses.
  PERFORM 1 FROM public.households WHERE id = v_household FOR UPDATE;

  IF TG_TABLE_NAME = 'accounts' THEN
    IF NOT v_privileged AND (TG_OP <> 'UPDATE' OR NEW.opening_balance IS DISTINCT FROM OLD.opening_balance
      OR NEW.currency IS DISTINCT FROM OLD.currency OR NEW.kind IS DISTINCT FROM OLD.kind) THEN
      RAISE EXCEPTION 'Use account RPC for financial account changes';
    END IF;
  ELSIF TG_TABLE_NAME = 'savings_goals' THEN
    IF NOT v_privileged AND (TG_OP = 'DELETE'
      OR (TG_OP = 'INSERT' AND (COALESCE(NEW.current_amount, 0) <> 0 OR NEW.is_archived))
      OR (TG_OP = 'UPDATE' AND (NEW.current_amount IS DISTINCT FROM OLD.current_amount OR NEW.is_archived IS DISTINCT FROM OLD.is_archived))) THEN
      RAISE EXCEPTION 'Use savings RPC for goal funds or archive';
    END IF;
    IF TG_OP <> 'DELETE' THEN
      IF NEW.current_amount IS NULL OR NEW.current_amount < 0 OR NEW.target_amount <= 0
        OR NEW.current_amount::text IN ('NaN', 'Infinity', '-Infinity') OR NEW.target_amount::text IN ('NaN', 'Infinity', '-Infinity') THEN
        RAISE EXCEPTION 'Goal values must be nonnegative with a positive target';
      END IF;
      NEW.is_completed := NEW.current_amount >= NEW.target_amount;
    END IF;
  ELSIF TG_TABLE_NAME = 'transactions' THEN
    IF NOT v_privileged AND (TG_OP <> 'INSERT' OR NEW.kind <> 'cashflow' OR NEW.goal_id IS NOT NULL
      OR NEW.target_account_id IS NOT NULL OR NEW.recurring_id IS NOT NULL) THEN
      RAISE EXCEPTION 'Use finance RPC for transfers, goal movements or deletion';
    END IF;
    IF TG_OP <> 'DELETE' THEN
      IF NEW.amount <= 0 OR NEW.amount::text IN ('NaN', 'Infinity', '-Infinity') THEN RAISE EXCEPTION 'Transaction amount must be finite and positive'; END IF;
      IF NEW.kind = 'cashflow' AND NEW.account_id IS NULL THEN
        SELECT id INTO v_default FROM public.accounts WHERE household_id = v_household AND NOT is_archived ORDER BY created_at, id LIMIT 1;
        NEW.account_id := v_default;
        IF v_default IS NULL AND EXISTS (SELECT 1 FROM public.accounts WHERE household_id = v_household) THEN
          RAISE EXCEPTION 'An active account is required';
        END IF;
      END IF;
      IF NEW.kind = 'transfer' AND (NEW.account_id IS NULL OR NEW.target_account_id IS NULL OR NEW.account_id = NEW.target_account_id OR NEW.type <> 'expense') THEN
        RAISE EXCEPTION 'Transfer requires two different accounts';
      END IF;
      IF NEW.kind <> 'transfer' AND NEW.target_account_id IS NOT NULL THEN RAISE EXCEPTION 'Only transfers have a target account'; END IF;
      IF NEW.kind = 'goal_deposit' AND NEW.type <> 'expense' OR NEW.kind = 'goal_release' AND NEW.type <> 'income' THEN
        RAISE EXCEPTION 'Invalid goal movement direction';
      END IF;
      IF NEW.account_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.accounts WHERE id = NEW.account_id AND household_id = v_household AND (v_privileged OR NOT is_archived)) THEN
        RAISE EXCEPTION 'Account belongs to another household or is archived';
      END IF;
      IF NEW.target_account_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.accounts WHERE id = NEW.target_account_id AND household_id = v_household AND NOT is_archived) THEN
        RAISE EXCEPTION 'Target account belongs to another household or is archived';
      END IF;
      IF NEW.goal_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.savings_goals WHERE id = NEW.goal_id AND household_id = v_household) THEN
        RAISE EXCEPTION 'Goal belongs to another household';
      END IF;
      IF NEW.recurring_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.recurring_transactions WHERE id = NEW.recurring_id AND household_id = v_household) THEN
        RAISE EXCEPTION 'Recurring template belongs to another household';
      END IF;
    END IF;
  ELSIF TG_TABLE_NAME = 'recurring_transactions' AND TG_OP <> 'DELETE' THEN
    IF NEW.amount <= 0 OR NEW.amount::text IN ('NaN', 'Infinity', '-Infinity') THEN RAISE EXCEPTION 'Recurring amount must be finite and positive'; END IF;
    IF NEW.account_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.accounts WHERE id = NEW.account_id AND household_id = v_household AND NOT is_archived) THEN
      RAISE EXCEPTION 'Recurring account belongs to another household or is archived';
    END IF;
  END IF;
  IF TG_TABLE_NAME IN ('transactions', 'recurring_transactions') AND TG_OP <> 'DELETE' THEN
    IF NEW.added_by IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = NEW.added_by AND household_id = v_household) THEN
      RAISE EXCEPTION 'Member belongs to another household';
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

DO $$ DECLARE v_table TEXT; BEGIN
  FOREACH v_table IN ARRAY ARRAY['accounts', 'transactions', 'recurring_transactions', 'savings_goals'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS guard_finance_write ON public.%I', v_table);
    EXECUTE format('CREATE TRIGGER guard_finance_write BEFORE INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.guard_finance_write()', v_table);
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.initialize_finance(p_legacy_transaction_ids UUID[] DEFAULT '{}')
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_household UUID; v_account UUID; v_id UUID; v_tx public.transactions%ROWTYPE; v_goal UUID;
BEGIN
  v_household := public.finance_household_lock();
  SELECT id INTO v_account FROM public.accounts WHERE household_id = v_household AND NOT is_archived ORDER BY created_at, id LIMIT 1;
  IF v_account IS NULL THEN
    INSERT INTO public.accounts(household_id, name, kind) VALUES (v_household, 'Основной счёт', 'bank') RETURNING id INTO v_account;
  END IF;
  FOREACH v_id IN ARRAY COALESCE(p_legacy_transaction_ids, '{}'::UUID[]) LOOP
    SELECT * INTO v_tx FROM public.transactions WHERE id = v_id AND household_id = v_household;
    IF NOT FOUND THEN RAISE EXCEPTION 'Reviewed transaction not found in your household'; END IF;
    IF v_tx.kind IN ('goal_deposit', 'goal_release') THEN CONTINUE; END IF;
    IF v_tx.kind <> 'cashflow' OR v_tx.category_id <> 'savings' THEN RAISE EXCEPTION 'Transaction is not a recognized legacy savings movement'; END IF;
    IF v_tx.type = 'expense' THEN
      v_goal := NULL;
      SELECT g.id INTO v_goal FROM public.savings_goals g
      WHERE g.household_id = v_household AND g.id::text = substring(v_tx.comment FROM '\[goal_id:([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})\]');
      IF v_goal IS NULL THEN RAISE EXCEPTION 'Legacy deposit must reference an existing household goal'; END IF;
      UPDATE public.transactions SET kind = 'goal_deposit', goal_id = v_goal WHERE id = v_id;
    ELSIF v_tx.type = 'income' AND v_tx.comment LIKE 'Закрытие копилки:%' THEN
      UPDATE public.transactions SET kind = 'goal_release' WHERE id = v_id;
    ELSE RAISE EXCEPTION 'Transaction is not a recognized legacy savings movement';
    END IF;
  END LOOP;
  UPDATE public.transactions SET account_id = v_account WHERE household_id = v_household AND account_id IS NULL AND kind = 'cashflow';
END;
$$;

CREATE OR REPLACE FUNCTION public.create_finance_account(p_name TEXT, p_kind TEXT, p_opening_balance NUMERIC)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_household UUID; v_id UUID;
BEGIN
  v_household := public.finance_household_lock();
  IF p_name IS NULL OR length(btrim(p_name)) NOT BETWEEN 1 AND 80 OR p_kind NOT IN ('bank', 'cash', 'savings') THEN
    RAISE EXCEPTION 'Valid account name and kind required';
  END IF;
  IF p_opening_balance <> 0 THEN PERFORM public.finance_validate_amount(p_opening_balance, true); END IF;
  IF p_opening_balance IS NULL OR p_opening_balance < 0 THEN RAISE EXCEPTION 'Opening balance must be nonnegative'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.accounts WHERE household_id = v_household) THEN
    PERFORM public.initialize_finance();
  END IF;
  INSERT INTO public.accounts(household_id, name, kind, opening_balance) VALUES (v_household, btrim(p_name), p_kind, p_opening_balance) RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.transfer_finance(p_from UUID, p_to UUID, p_amount NUMERIC, p_date DATE, p_comment TEXT)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_household UUID; v_id UUID;
BEGIN
  v_household := public.finance_household_lock();
  PERFORM public.finance_validate_amount(p_amount);
  IF p_date IS NULL OR p_from IS NULL OR p_to IS NULL OR p_from = p_to THEN RAISE EXCEPTION 'Two accounts and a date required'; END IF;
  IF (SELECT count(*) FROM public.accounts WHERE id IN (p_from, p_to) AND household_id = v_household AND NOT is_archived) <> 2 THEN
    RAISE EXCEPTION 'Active household accounts required';
  END IF;
  IF public.finance_account_balance(p_from) < p_amount THEN RAISE EXCEPTION 'Insufficient account balance'; END IF;
  INSERT INTO public.transactions(household_id, type, amount, category_id, comment, added_by, date, account_id, target_account_id, kind)
    VALUES (v_household, 'expense', p_amount, 'savings', COALESCE(p_comment, ''), auth.uid(), p_date, p_from, p_to, 'transfer') RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.change_goal_funds(p_goal_id UUID, p_amount NUMERIC, p_date DATE)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_household UUID; v_goal public.savings_goals%ROWTYPE; v_reserved NUMERIC; v_id UUID;
BEGIN
  v_household := public.finance_household_lock();
  PERFORM public.finance_validate_amount(p_amount, true);
  IF p_date IS NULL THEN RAISE EXCEPTION 'Date required'; END IF;
  SELECT * INTO v_goal FROM public.savings_goals WHERE id = p_goal_id AND household_id = v_household FOR UPDATE;
  IF NOT FOUND OR v_goal.is_archived THEN RAISE EXCEPTION 'Active household goal required'; END IF;
  SELECT COALESCE(sum(current_amount), 0) INTO v_reserved FROM public.savings_goals WHERE household_id = v_household AND NOT is_archived;
  IF p_amount > 0 AND public.finance_capital(v_household) - v_reserved < p_amount THEN RAISE EXCEPTION 'Insufficient unreserved funds'; END IF;
  IF v_goal.current_amount + p_amount < 0 THEN RAISE EXCEPTION 'Cannot release more than the saved amount'; END IF;
  UPDATE public.savings_goals SET current_amount = current_amount + p_amount WHERE id = p_goal_id;
  INSERT INTO public.transactions(household_id, type, amount, category_id, comment, added_by, date, kind, goal_id)
    VALUES (v_household, CASE WHEN p_amount > 0 THEN 'expense' ELSE 'income' END, abs(p_amount), 'savings',
      CASE WHEN p_amount > 0 THEN 'Резервирование: ' ELSE 'Возврат из цели: ' END || v_goal.name,
      auth.uid(), p_date, CASE WHEN p_amount > 0 THEN 'goal_deposit' ELSE 'goal_release' END, p_goal_id) RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.archive_savings_goal(p_goal_id UUID, p_date DATE)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_household UUID; v_goal public.savings_goals%ROWTYPE;
BEGIN
  v_household := public.finance_household_lock();
  IF p_date IS NULL THEN RAISE EXCEPTION 'Date required'; END IF;
  SELECT * INTO v_goal FROM public.savings_goals WHERE id = p_goal_id AND household_id = v_household FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Household goal required'; END IF;
  IF v_goal.is_archived THEN RETURN; END IF;
  IF v_goal.current_amount > 0 THEN PERFORM public.change_goal_funds(p_goal_id, -v_goal.current_amount, p_date); END IF;
  UPDATE public.savings_goals SET is_archived = true WHERE id = p_goal_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_finance_transaction(p_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_household UUID; v_tx public.transactions%ROWTYPE; v_goal public.savings_goals%ROWTYPE; v_reserved NUMERIC; v_new_capital NUMERIC;
BEGIN
  v_household := public.finance_household_lock();
  SELECT * INTO v_tx FROM public.transactions WHERE id = p_id AND household_id = v_household FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Household transaction required'; END IF;
  IF v_tx.kind IN ('goal_deposit', 'goal_release') AND v_tx.goal_id IS NOT NULL THEN
    SELECT * INTO v_goal FROM public.savings_goals WHERE id = v_tx.goal_id AND household_id = v_household FOR UPDATE;
    IF NOT FOUND OR v_goal.is_archived THEN RAISE EXCEPTION 'Cannot reverse movements of an archived goal'; END IF;
    IF v_tx.kind = 'goal_deposit' AND v_goal.current_amount < v_tx.amount THEN RAISE EXCEPTION 'Goal funds have already been released'; END IF;
    IF v_tx.kind = 'goal_release' THEN
      SELECT COALESCE(sum(current_amount), 0) INTO v_reserved FROM public.savings_goals WHERE household_id = v_household AND NOT is_archived;
      IF public.finance_capital(v_household) - v_reserved < v_tx.amount THEN RAISE EXCEPTION 'Insufficient funds to restore the reservation'; END IF;
    END IF;
    UPDATE public.savings_goals SET current_amount = current_amount + CASE WHEN v_tx.kind = 'goal_deposit' THEN -v_tx.amount ELSE v_tx.amount END WHERE id = v_tx.goal_id;
  ELSIF v_tx.kind = 'transfer' THEN
    IF public.finance_account_balance(v_tx.target_account_id) < v_tx.amount THEN RAISE EXCEPTION 'Transferred funds have already been spent'; END IF;
  ELSIF v_tx.kind = 'cashflow' AND v_tx.type = 'income' THEN
    SELECT COALESCE(sum(current_amount), 0) INTO v_reserved FROM public.savings_goals WHERE household_id = v_household AND NOT is_archived;
    v_new_capital := public.finance_capital(v_household) - v_tx.amount;
    IF v_reserved > 0 AND v_new_capital < v_reserved THEN RAISE EXCEPTION 'Release goal reservations before deleting this income'; END IF;
  END IF;
  DELETE FROM public.transactions WHERE id = p_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_finance_transaction(p_id UUID, p_type TEXT, p_amount NUMERIC,
  p_category_id TEXT, p_comment TEXT, p_added_by UUID, p_date DATE, p_account_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_household UUID; v_tx public.transactions%ROWTYPE; v_capital NUMERIC; v_new_capital NUMERIC; v_reserved NUMERIC;
BEGIN
  v_household := public.finance_household_lock();
  PERFORM public.finance_validate_amount(p_amount);
  SELECT * INTO v_tx FROM public.transactions WHERE id = p_id AND household_id = v_household FOR UPDATE;
  IF NOT FOUND OR v_tx.kind <> 'cashflow' THEN RAISE EXCEPTION 'Household cashflow transaction required'; END IF;
  IF p_type IS NULL OR p_type NOT IN ('income', 'expense') OR p_date IS NULL
    OR p_category_id IS NULL OR length(btrim(p_category_id)) = 0 THEN RAISE EXCEPTION 'Valid type, category and date required'; END IF;
  IF p_account_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.accounts WHERE id = p_account_id AND household_id = v_household AND NOT is_archived) THEN
    RAISE EXCEPTION 'Active household account required';
  END IF;
  IF p_added_by IS NULL OR NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_added_by AND household_id = v_household) THEN
    RAISE EXCEPTION 'Household member required';
  END IF;
  IF v_tx.recurring_id IS NOT NULL AND p_date IS DISTINCT FROM v_tx.date THEN
    RAISE EXCEPTION 'Recurring occurrence date cannot change; edit its amount or other details';
  END IF;
  v_capital := public.finance_capital(v_household);
  v_new_capital := v_capital - CASE WHEN v_tx.type = 'income' THEN v_tx.amount ELSE -v_tx.amount END
    + CASE WHEN p_type = 'income' THEN p_amount ELSE -p_amount END;
  SELECT COALESCE(sum(current_amount), 0) INTO v_reserved FROM public.savings_goals WHERE household_id = v_household AND NOT is_archived;
  -- Legacy discrepancies may be corrected gradually, but not made worse by an edit.
  IF v_new_capital < v_reserved AND v_new_capital < v_capital THEN
    RAISE EXCEPTION 'Release goal reservations before reducing household capital';
  END IF;
  UPDATE public.transactions SET type = p_type, amount = p_amount, category_id = p_category_id,
    comment = COALESCE(p_comment, ''), added_by = p_added_by, date = p_date, account_id = p_account_id WHERE id = p_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.apply_due_recurring(p_today DATE)
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_household UUID; v_rec public.recurring_transactions%ROWTYPE; v_date DATE; v_account UUID; v_count INTEGER := 0; v_inserted INTEGER;
BEGIN
  v_household := public.finance_household_lock();
  IF p_today IS NULL THEN RAISE EXCEPTION 'Date required'; END IF;
  FOR v_rec IN SELECT * FROM public.recurring_transactions WHERE household_id = v_household AND is_active ORDER BY id FOR UPDATE LOOP
    v_date := make_date(extract(year FROM p_today)::integer, extract(month FROM p_today)::integer, v_rec.day_of_month);
    IF v_date > p_today OR (v_rec.last_applied IS NOT NULL AND v_rec.last_applied >= v_date) THEN CONTINUE; END IF;
    v_account := v_rec.account_id;
    IF v_account IS NULL THEN SELECT id INTO v_account FROM public.accounts WHERE household_id = v_household AND NOT is_archived ORDER BY created_at, id LIMIT 1; END IF;
    IF v_account IS NULL OR NOT EXISTS (SELECT 1 FROM public.accounts WHERE id = v_account AND household_id = v_household AND NOT is_archived) THEN
      RAISE EXCEPTION 'Recurring transaction needs an active account';
    END IF;
    INSERT INTO public.transactions(household_id, type, amount, category_id, comment, added_by, date, account_id, kind, recurring_id)
      VALUES (v_household, v_rec.type, v_rec.amount, v_rec.category_id, COALESCE(v_rec.comment, ''), v_rec.added_by, v_date, v_account, 'cashflow', v_rec.id)
      ON CONFLICT (recurring_id, date) WHERE recurring_id IS NOT NULL DO NOTHING;
    GET DIAGNOSTICS v_inserted = ROW_COUNT;
    v_count := v_count + v_inserted;
    UPDATE public.recurring_transactions SET last_applied = v_date WHERE id = v_rec.id;
  END LOOP;
  RETURN v_count;
END;
$$;

-- Membership is established only through the signup trigger and opaque invitations.
CREATE OR REPLACE FUNCTION public.guard_profile_membership()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE v_privileged BOOLEAN;
BEGIN
  SELECT COALESCE(rolsuper OR rolbypassrls, false) INTO v_privileged FROM pg_catalog.pg_roles WHERE rolname = current_user;
  IF NOT v_privileged AND (TG_OP = 'INSERT' AND NEW.household_id IS NOT NULL
    OR TG_OP = 'UPDATE' AND NEW.household_id IS DISTINCT FROM OLD.household_id) THEN
    RAISE EXCEPTION 'Household membership requires an invitation';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS guard_profile_membership ON public.profiles;
CREATE TRIGGER guard_profile_membership BEFORE INSERT OR UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.guard_profile_membership();

CREATE OR REPLACE FUNCTION public.create_household_invite()
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_household UUID; v_token TEXT;
BEGIN
  v_household := public.finance_household_lock();
  v_token := gen_random_uuid()::text || '-' || gen_random_uuid()::text;
  INSERT INTO public.household_invites(household_id, token_hash, created_by)
    VALUES (v_household, encode(sha256(convert_to(v_token, 'UTF8')), 'hex'), auth.uid());
  RETURN v_token;
END;
$$;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_household UUID; v_invite public.household_invites%ROWTYPE; v_action TEXT; v_name TEXT; v_token TEXT;
BEGIN
  v_action := NEW.raw_user_meta_data->>'household_action';
  IF v_action = 'create' THEN
    v_name := btrim(COALESCE(NEW.raw_user_meta_data->>'household_name', ''));
    IF length(v_name) NOT BETWEEN 1 AND 80 THEN RAISE EXCEPTION 'Household name required'; END IF;
    INSERT INTO public.households(name) VALUES (v_name) RETURNING id INTO v_household;
  ELSIF v_action = 'join' THEN
    v_token := btrim(COALESCE(NEW.raw_user_meta_data->>'invite_token', ''));
    IF length(v_token) <> 73 THEN RAISE EXCEPTION 'Valid invitation required'; END IF;
    SELECT * INTO v_invite FROM public.household_invites
      WHERE token_hash = encode(sha256(convert_to(v_token, 'UTF8')), 'hex') FOR UPDATE;
    IF NOT FOUND OR v_invite.used_at IS NOT NULL OR v_invite.expires_at <= now() THEN RAISE EXCEPTION 'Invitation invalid, expired or already used'; END IF;
    v_household := v_invite.household_id;
    UPDATE public.household_invites SET used_at = now() WHERE id = v_invite.id;
  ELSE
    RAISE EXCEPTION 'Update the application to create or join a household';
  END IF;
  INSERT INTO public.profiles(id, name, avatar, color, household_id)
    VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'name', 'Участник'),
      COALESCE(NEW.raw_user_meta_data->>'avatar', '👤'), COALESCE(NEW.raw_user_meta_data->>'color', '#3b82f6'), v_household);
  RETURN NEW;
END;
$$;

ALTER TABLE public.accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.household_invites ENABLE ROW LEVEL SECURITY;
DO $$ DECLARE v_table TEXT; v_action TEXT; BEGIN
  FOREACH v_table IN ARRAY ARRAY['accounts', 'household_invites'] LOOP
    FOREACH v_action IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE'] LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', v_table || '_household_' || lower(v_action), v_table);
      IF v_action = 'INSERT' THEN
        EXECUTE format('CREATE POLICY %I ON public.%I FOR INSERT TO authenticated WITH CHECK (household_id = public.get_my_household_id())', v_table || '_household_insert', v_table);
      ELSIF v_action = 'UPDATE' THEN
        EXECUTE format('CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated USING (household_id = public.get_my_household_id()) WITH CHECK (household_id = public.get_my_household_id())', v_table || '_household_update', v_table);
      ELSE
        EXECUTE format('CREATE POLICY %I ON public.%I FOR %s TO authenticated USING (household_id = public.get_my_household_id())', v_table || '_household_' || lower(v_action), v_table, v_action);
      END IF;
    END LOOP;
  END LOOP;
END $$;
-- Invitations cannot be minted, consumed, moved or extended through table API writes.
REVOKE ALL ON public.household_invites FROM anon, authenticated;
GRANT SELECT ON public.household_invites TO authenticated;
REVOKE ALL ON public.accounts FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.accounts TO authenticated;

DROP POLICY IF EXISTS "Любой пользователь может создать семью" ON public.households;
DROP POLICY IF EXISTS "Пользователи могут искать семью по ID" ON public.households;
DROP POLICY IF EXISTS households_members_select ON public.households;
CREATE POLICY households_members_select ON public.households FOR SELECT TO authenticated USING (id = public.get_my_household_id());
REVOKE INSERT ON public.households FROM anon, authenticated;

-- Internal helpers are unavailable as public RPCs, including definer lock helper.
REVOKE ALL ON FUNCTION public.finance_schema_version() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.finance_schema_version() TO anon, authenticated;
REVOKE ALL ON FUNCTION public.finance_household_lock() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finance_capital(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finance_account_balance(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finance_validate_amount(NUMERIC, BOOLEAN) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.guard_finance_write() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.guard_profile_membership() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_my_household_id() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_household_id() TO authenticated;
REVOKE ALL ON FUNCTION public.initialize_finance(UUID[]) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.create_finance_account(TEXT, TEXT, NUMERIC) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.transfer_finance(UUID, UUID, NUMERIC, DATE, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.change_goal_funds(UUID, NUMERIC, DATE) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.archive_savings_goal(UUID, DATE) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.delete_finance_transaction(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.update_finance_transaction(UUID, TEXT, NUMERIC, TEXT, TEXT, UUID, DATE, UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.apply_due_recurring(DATE) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.create_household_invite() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.initialize_finance(UUID[]), public.create_finance_account(TEXT, TEXT, NUMERIC),
  public.transfer_finance(UUID, UUID, NUMERIC, DATE, TEXT), public.change_goal_funds(UUID, NUMERIC, DATE),
  public.archive_savings_goal(UUID, DATE), public.delete_finance_transaction(UUID),
  public.update_finance_transaction(UUID, TEXT, NUMERIC, TEXT, TEXT, UUID, DATE, UUID), public.apply_due_recurring(DATE),
  public.create_household_invite() TO authenticated;

DO $$ DECLARE v_table TEXT; BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    FOREACH v_table IN ARRAY ARRAY['accounts', 'savings_goals', 'recurring_transactions'] LOOP
      IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = v_table) THEN
        EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', v_table);
      END IF;
    END LOOP;
  END IF;
END $$;
COMMIT;
