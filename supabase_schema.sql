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

-- 13. Shared budgets (2026-10-12)
-- Shared monthly envelopes and confirmed, one-use income allocation.
BEGIN;
CREATE TABLE IF NOT EXISTS public.category_budgets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id UUID NOT NULL REFERENCES public.households(id) ON DELETE CASCADE,
  month DATE NOT NULL CHECK (extract(day FROM month)=1),
  category_id TEXT NOT NULL CHECK (length(btrim(category_id)) BETWEEN 1 AND 64 AND category_id <> 'salary' AND category_id !~ '^income-'),
  allocated_amount NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (allocated_amount>=0 AND allocated_amount::text NOT IN ('NaN','Infinity','-Infinity')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (household_id,month,category_id)
);
CREATE TABLE IF NOT EXISTS public.income_distributions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id UUID NOT NULL REFERENCES public.households(id) ON DELETE CASCADE,
  income_transaction_id UUID NOT NULL UNIQUE REFERENCES public.transactions(id),
  month DATE NOT NULL,
  total_amount NUMERIC(12,2) NOT NULL CHECK (total_amount>0 AND total_amount::text NOT IN ('NaN','Infinity','-Infinity')),
  items JSONB NOT NULL CHECK (jsonb_typeof(items)='array'),
  created_by UUID NOT NULL REFERENCES public.profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS income_distributions_household_month_idx ON public.income_distributions(household_id,month);
ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS income_distribution_id UUID REFERENCES public.income_distributions(id);

CREATE OR REPLACE FUNCTION public.guard_distribution_link()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path='' AS $$
DECLARE privileged BOOLEAN;
BEGIN
  SELECT rolsuper OR rolbypassrls INTO privileged FROM pg_catalog.pg_roles WHERE rolname=current_user;
  IF NEW.income_distribution_id IS NOT NULL THEN
    IF NOT COALESCE(privileged,false) THEN RAISE EXCEPTION 'Use income distribution RPC'; END IF;
    IF NEW.kind<>'goal_deposit' OR NOT EXISTS(SELECT 1 FROM public.income_distributions WHERE id=NEW.income_distribution_id AND household_id=NEW.household_id) THEN
      RAISE EXCEPTION 'Distribution must belong to the goal movement household';
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS guard_distribution_link ON public.transactions;
CREATE TRIGGER guard_distribution_link BEFORE INSERT OR UPDATE ON public.transactions FOR EACH ROW EXECUTE FUNCTION public.guard_distribution_link();
REVOKE ALL ON FUNCTION public.guard_distribution_link() FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.finance_current_month()
RETURNS DATE LANGUAGE sql STABLE SET search_path='' AS $$
  SELECT date_trunc('month',now() AT TIME ZONE 'Europe/Minsk')::date;
$$;
CREATE OR REPLACE FUNCTION public.finance_budget_reserved(p_household UUID)
RETURNS NUMERIC LANGUAGE sql STABLE SET search_path='' AS $$
  SELECT COALESCE(sum(greatest(0,b.allocated_amount-COALESCE((SELECT sum(t.amount)
    FROM public.transactions t WHERE t.household_id=b.household_id AND t.kind='cashflow' AND t.type='expense'
      AND (t.category_id=b.category_id OR (b.category_id='food' AND t.category_id LIKE 'food-%')) AND t.date>=b.month AND t.date<(b.month+interval '1 month')::date),0))),0)
  FROM public.category_budgets b WHERE b.household_id=p_household AND b.month=public.finance_current_month();
$$;
CREATE OR REPLACE FUNCTION public.finance_reserved(p_household UUID)
RETURNS NUMERIC LANGUAGE sql STABLE SET search_path='' AS $$
  SELECT COALESCE((SELECT sum(current_amount) FROM public.savings_goals WHERE household_id=p_household AND NOT is_archived),0)
    +public.finance_budget_reserved(p_household);
$$;
CREATE OR REPLACE FUNCTION public.guard_planning_write()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path='' AS $$
DECLARE privileged BOOLEAN;
BEGIN
  SELECT rolsuper OR rolbypassrls INTO privileged FROM pg_catalog.pg_roles WHERE rolname=current_user;
  IF NOT COALESCE(privileged,false) THEN RAISE EXCEPTION 'Use planning RPC for budgets and income distribution'; END IF;
  IF TG_OP='UPDATE' AND NEW.household_id IS DISTINCT FROM OLD.household_id THEN RAISE EXCEPTION 'Planning records cannot change household'; END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.set_category_budget(p_category_id TEXT,p_amount NUMERIC,p_month DATE)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE h UUID; old_free NUMERIC; new_free NUMERIC; result_id UUID;
BEGIN
  h:=public.finance_household_lock();
  IF p_month IS DISTINCT FROM public.finance_current_month() THEN RAISE EXCEPTION 'Only the current month can be funded'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.accounts WHERE household_id=h AND NOT is_archived) THEN RAISE EXCEPTION 'Initialize accounts first'; END IF;
  IF p_amount IS NULL OR p_amount<0 OR p_amount::text IN ('NaN','Infinity','-Infinity') OR p_amount<>round(p_amount,2) OR p_amount>9999999999.99 THEN RAISE EXCEPTION 'Budget amount must be nonnegative with at most two decimals'; END IF;
  old_free:=public.finance_capital(h)-public.finance_reserved(h);
  IF p_amount>0 AND EXISTS(SELECT 1 FROM public.category_budgets WHERE household_id=h AND month=p_month AND allocated_amount>0 AND category_id<>btrim(p_category_id)
    AND ((btrim(p_category_id)='food' AND category_id LIKE 'food-%') OR (btrim(p_category_id) LIKE 'food-%' AND category_id='food'))) THEN RAISE EXCEPTION 'Food budgets overlap'; END IF;
  INSERT INTO public.category_budgets(household_id,month,category_id,allocated_amount)
    VALUES(h,p_month,btrim(p_category_id),p_amount)
    ON CONFLICT(household_id,month,category_id) DO UPDATE SET allocated_amount=excluded.allocated_amount,updated_at=now()
    RETURNING id INTO result_id;
  new_free:=public.finance_capital(h)-public.finance_reserved(h);
  IF new_free<0 AND new_free<old_free THEN RAISE EXCEPTION 'Insufficient unassigned funds'; END IF;
  RETURN result_id;
END $$;

CREATE OR REPLACE FUNCTION public.distribute_income(p_income_id UUID,p_items JSONB,p_month DATE)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE h UUID; source public.transactions%ROWTYPE; item JSONB; amount NUMERIC; total NUMERIC:=0; distribution UUID; movement UUID; base NUMERIC; spent NUMERIC;
BEGIN
  h:=public.finance_household_lock();
  IF p_month IS DISTINCT FROM public.finance_current_month() THEN RAISE EXCEPTION 'Only the current month can be funded'; END IF;
  SELECT * INTO source FROM public.transactions WHERE id=p_income_id AND household_id=h FOR UPDATE;
  IF NOT FOUND OR source.kind<>'cashflow' OR source.type<>'income' OR source.date<p_month OR source.date>=(p_month+interval '1 month')::date
    OR source.date>(now() AT TIME ZONE 'Europe/Minsk')::date THEN RAISE EXCEPTION 'A posted income from this month is required'; END IF;
  IF EXISTS(SELECT 1 FROM public.income_distributions WHERE income_transaction_id=p_income_id) THEN RAISE EXCEPTION 'Income already distributed'; END IF;
  IF p_items IS NULL OR jsonb_typeof(p_items)<>'array' OR jsonb_array_length(p_items) NOT BETWEEN 1 AND 32 THEN RAISE EXCEPTION 'Choose at least one allocation'; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_items) x GROUP BY x->>'targetType',x->>'targetId' HAVING count(*)>1) THEN RAISE EXCEPTION 'Duplicate allocation target'; END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(p_items) LOOP
    IF item->>'targetType' NOT IN ('budget','goal') OR item->>'targetType' IS NULL OR NULLIF(btrim(item->>'targetId'),'') IS NULL
      OR item->>'targetId' IS DISTINCT FROM btrim(item->>'targetId') THEN RAISE EXCEPTION 'Invalid allocation target'; END IF;
    amount:=(item->>'amount')::numeric;
    PERFORM public.finance_validate_amount(amount);
    total:=total+amount;
  END LOOP;
  IF total>source.amount OR total>public.finance_capital(h)-public.finance_reserved(h) THEN RAISE EXCEPTION 'Allocation exceeds income or unassigned funds'; END IF;
  INSERT INTO public.income_distributions(household_id,income_transaction_id,month,total_amount,items,created_by)
    VALUES(h,p_income_id,p_month,total,p_items,auth.uid()) RETURNING id INTO distribution;
  FOR item IN SELECT value FROM jsonb_array_elements(p_items) LOOP
    amount:=(item->>'amount')::numeric;
    IF item->>'targetType'='budget' THEN
      SELECT COALESCE(max(allocated_amount),0) INTO base FROM public.category_budgets WHERE household_id=h AND month=p_month AND category_id=item->>'targetId';
      SELECT COALESCE(sum(t.amount),0) INTO spent FROM public.transactions t WHERE t.household_id=h AND t.kind='cashflow' AND t.type='expense'
        AND (t.category_id=item->>'targetId' OR (item->>'targetId'='food' AND t.category_id LIKE 'food-%')) AND t.date>=p_month AND t.date<(p_month+interval '1 month')::date;
      PERFORM public.set_category_budget(item->>'targetId',greatest(base,spent)+amount,p_month);
    ELSE
      movement:=public.change_goal_funds((item->>'targetId')::uuid,amount,(now() AT TIME ZONE 'Europe/Minsk')::date);
      UPDATE public.transactions SET income_distribution_id=distribution WHERE id=movement;
    END IF;
  END LOOP;
  RETURN distribution;
END $$;

DO $$ DECLARE item TEXT; action TEXT; BEGIN
  FOREACH item IN ARRAY ARRAY['category_budgets','income_distributions'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',item);
    FOREACH action IN ARRAY ARRAY['SELECT','INSERT','UPDATE','DELETE'] LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I',item||'_household_'||lower(action),item);
      IF action='SELECT' OR action='DELETE' THEN
        EXECUTE format('CREATE POLICY %I ON public.%I FOR %s TO authenticated USING(household_id=public.get_my_household_id())',item||'_household_'||lower(action),item,action);
      ELSIF action='INSERT' THEN
        EXECUTE format('CREATE POLICY %I ON public.%I FOR INSERT TO authenticated WITH CHECK(household_id=public.get_my_household_id())',item||'_household_insert',item);
      ELSE
        EXECUTE format('CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated USING(household_id=public.get_my_household_id()) WITH CHECK(household_id=public.get_my_household_id())',item||'_household_update',item);
      END IF;
    END LOOP;
    EXECUTE format('REVOKE ALL ON public.%I FROM anon,authenticated',item);
    EXECUTE format('GRANT SELECT ON public.%I TO authenticated',item);
    EXECUTE format('DROP TRIGGER IF EXISTS guard_planning_write ON public.%I',item);
    EXECUTE format('CREATE TRIGGER guard_planning_write BEFORE INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.guard_planning_write()',item);
    IF EXISTS(SELECT 1 FROM pg_publication WHERE pubname='supabase_realtime') AND NOT EXISTS(SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename=item) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I',item);
    END IF;
  END LOOP;
END $$;
REVOKE ALL ON FUNCTION public.finance_current_month(),public.finance_budget_reserved(UUID),public.finance_reserved(UUID),public.guard_planning_write() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.set_category_budget(TEXT,NUMERIC,DATE),public.distribute_income(UUID,JSONB,DATE) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.set_category_budget(TEXT,NUMERIC,DATE),public.distribute_income(UUID,JSONB,DATE) TO authenticated;
-- Updated atomic money functions are appended below before the final COMMIT.

CREATE OR REPLACE FUNCTION public.change_goal_funds(p_goal_id UUID, p_amount NUMERIC, p_date DATE)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_household UUID; v_goal public.savings_goals%ROWTYPE; v_reserved NUMERIC; v_id UUID;
BEGIN
  v_household := public.finance_household_lock();
  PERFORM public.finance_validate_amount(p_amount, true);
  IF p_date IS NULL THEN RAISE EXCEPTION 'Date required'; END IF;
  SELECT * INTO v_goal FROM public.savings_goals WHERE id = p_goal_id AND household_id = v_household FOR UPDATE;
  IF NOT FOUND OR v_goal.is_archived THEN RAISE EXCEPTION 'Active household goal required'; END IF;
  SELECT public.finance_reserved(v_household) INTO v_reserved;
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

CREATE OR REPLACE FUNCTION public.delete_finance_transaction(p_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_household UUID; v_tx public.transactions%ROWTYPE; v_goal public.savings_goals%ROWTYPE; v_reserved NUMERIC; v_new_capital NUMERIC;
BEGIN
  v_household := public.finance_household_lock();
  SELECT * INTO v_tx FROM public.transactions WHERE id = p_id AND household_id = v_household FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Household transaction required'; END IF;
  IF EXISTS(SELECT 1 FROM public.income_distributions WHERE income_transaction_id=p_id) THEN RAISE EXCEPTION 'Distributed income history cannot be deleted'; END IF;
  IF v_tx.kind IN ('goal_deposit', 'goal_release') AND v_tx.goal_id IS NOT NULL THEN
    SELECT * INTO v_goal FROM public.savings_goals WHERE id = v_tx.goal_id AND household_id = v_household FOR UPDATE;
    IF NOT FOUND OR v_goal.is_archived THEN RAISE EXCEPTION 'Cannot reverse movements of an archived goal'; END IF;
    IF v_tx.kind = 'goal_deposit' AND v_goal.current_amount < v_tx.amount THEN RAISE EXCEPTION 'Goal funds have already been released'; END IF;
    IF v_tx.kind = 'goal_release' THEN
      SELECT public.finance_reserved(v_household) INTO v_reserved;
      IF public.finance_capital(v_household) - v_reserved < v_tx.amount THEN RAISE EXCEPTION 'Insufficient funds to restore the reservation'; END IF;
    END IF;
    UPDATE public.savings_goals SET current_amount = current_amount + CASE WHEN v_tx.kind = 'goal_deposit' THEN -v_tx.amount ELSE v_tx.amount END WHERE id = v_tx.goal_id;
  ELSIF v_tx.kind = 'transfer' THEN
    IF public.finance_account_balance(v_tx.target_account_id) < v_tx.amount THEN RAISE EXCEPTION 'Transferred funds have already been spent'; END IF;
  ELSIF v_tx.kind = 'cashflow' AND v_tx.type = 'income' THEN
    SELECT public.finance_reserved(v_household) INTO v_reserved;
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
  IF EXISTS(SELECT 1 FROM public.income_distributions WHERE income_transaction_id=p_id AND (p_type<>'income' OR p_amount<total_amount OR p_date IS DISTINCT FROM v_tx.date)) THEN RAISE EXCEPTION 'Distributed income must preserve its date, type and allocated amount'; END IF;
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
  SELECT public.finance_reserved(v_household) INTO v_reserved;
  UPDATE public.transactions SET type = p_type, amount = p_amount, category_id = p_category_id,
    comment = COALESCE(p_comment, ''), added_by = p_added_by, date = p_date, account_id = p_account_id WHERE id = p_id;
  IF v_new_capital-public.finance_reserved(v_household)<0 AND v_new_capital-public.finance_reserved(v_household)<v_capital-v_reserved THEN RAISE EXCEPTION 'Release goal reservations or budgets before reducing unassigned funds'; END IF;
END;
$$;

-- Keep the accounts capability marker compatible with already installed PWA clients.
CREATE OR REPLACE FUNCTION public.finance_planning_version() RETURNS INTEGER LANGUAGE sql IMMUTABLE SET search_path='' AS $$ SELECT 1; $$;
REVOKE ALL ON FUNCTION public.finance_planning_version() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.finance_planning_version() TO anon,authenticated;
NOTIFY pgrst, 'reload schema';
COMMIT;

-- 14. Flexible planning (2026-10-13)
-- Additive planning tools. Existing cashflow amounts/categories remain untouched.
BEGIN;
CREATE SCHEMA IF NOT EXISTS finance_private;
REVOKE ALL ON SCHEMA finance_private FROM PUBLIC,anon,authenticated;
ALTER TABLE public.income_distributions ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','cancelled'));
ALTER TABLE public.income_distributions ADD COLUMN IF NOT EXISTS revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0);
ALTER TABLE public.income_distributions ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE public.savings_goals ADD COLUMN IF NOT EXISTS purpose TEXT NOT NULL DEFAULT 'goal' CHECK(purpose IN ('goal','emergency','expense_fund'));
ALTER TABLE public.savings_goals ADD COLUMN IF NOT EXISTS essential_amount NUMERIC(12,2);
ALTER TABLE public.savings_goals ADD COLUMN IF NOT EXISTS reserve_months INTEGER;
ALTER TABLE public.savings_goals ADD COLUMN IF NOT EXISTS essential_categories TEXT[] NOT NULL DEFAULT '{}';
DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='fund_target_consistent' AND conrelid='public.savings_goals'::regclass) THEN
    ALTER TABLE public.savings_goals ADD CONSTRAINT fund_target_consistent CHECK(
      (purpose='emergency' AND essential_amount IS NOT NULL AND essential_amount>0 AND essential_amount::text NOT IN ('NaN','Infinity','-Infinity') AND reserve_months IS NOT NULL AND reserve_months BETWEEN 1 AND 12 AND target_amount=essential_amount*reserve_months AND deadline IS NULL)
      OR (purpose<>'emergency' AND essential_amount IS NULL AND reserve_months IS NULL));
  END IF;
END $$;
CREATE TABLE IF NOT EXISTS public.income_templates(
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),household_id UUID NOT NULL REFERENCES public.households(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK(length(btrim(name)) BETWEEN 1 AND 80),items JSONB NOT NULL CHECK(jsonb_typeof(items)='array'),
  is_archived BOOLEAN NOT NULL DEFAULT false,created_at TIMESTAMPTZ NOT NULL DEFAULT now(),updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS income_templates_household_idx ON public.income_templates(household_id);
CREATE TABLE IF NOT EXISTS public.budget_rollovers(
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),household_id UUID NOT NULL REFERENCES public.households(id) ON DELETE CASCADE,
  source_month DATE NOT NULL,target_month DATE NOT NULL,mode TEXT NOT NULL CHECK(mode IN ('repeat','carry','goal','release')),
  amount NUMERIC(12,2) NOT NULL CHECK(amount>=0 AND amount::text NOT IN ('NaN','Infinity','-Infinity')),items JSONB NOT NULL,
  created_by UUID NOT NULL REFERENCES public.profiles(id),created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(household_id,source_month),CHECK(target_month=(source_month+interval '1 month')::date AND extract(day FROM source_month)=1)
);
CREATE TABLE IF NOT EXISTS public.income_distribution_revisions(
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),household_id UUID NOT NULL REFERENCES public.households(id) ON DELETE CASCADE,
  distribution_id UUID NOT NULL REFERENCES public.income_distributions(id),revision INTEGER NOT NULL,
  action TEXT NOT NULL CHECK(action IN ('edit','cancel')),before_state JSONB NOT NULL,after_state JSONB NOT NULL,refund JSONB NOT NULL,
  created_by UUID NOT NULL REFERENCES public.profiles(id),created_at TIMESTAMPTZ NOT NULL DEFAULT now(),UNIQUE(distribution_id,revision)
);
CREATE INDEX IF NOT EXISTS distribution_revisions_household_idx ON public.income_distribution_revisions(household_id);

CREATE OR REPLACE FUNCTION finance_private.budget_spent(h UUID,category TEXT,month DATE)
RETURNS NUMERIC LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT COALESCE(sum(amount),0) FROM public.transactions WHERE household_id=h AND kind='cashflow' AND type='expense'
 AND (category_id=category OR (category='food' AND category_id LIKE 'food-%')) AND date>=month AND date<(month+interval '1 month')::date;
$$;
CREATE OR REPLACE FUNCTION public.transfer_category_budget(p_from TEXT,p_to TEXT,p_amount NUMERIC,p_month DATE)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE h UUID; source public.category_budgets%ROWTYPE; target NUMERIC; old_free NUMERIC;
BEGIN
 h:=public.finance_household_lock(); PERFORM public.finance_validate_amount(p_amount);
 IF p_month IS DISTINCT FROM public.finance_current_month() OR p_from IS NULL OR p_to IS NULL OR p_from=p_to OR p_from<>btrim(p_from) OR p_to<>btrim(p_to) THEN RAISE EXCEPTION 'Choose different current-month categories'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.accounts WHERE household_id=h AND NOT is_archived) THEN RAISE EXCEPTION 'Initialize accounts first'; END IF;
 SELECT * INTO source FROM public.category_budgets WHERE household_id=h AND month=p_month AND category_id=p_from FOR UPDATE;
 IF NOT FOUND OR greatest(0,source.allocated_amount-finance_private.budget_spent(h,p_from,p_month))<p_amount THEN RAISE EXCEPTION 'Transfer exceeds category remainder'; END IF;
 old_free:=public.finance_capital(h)-public.finance_reserved(h);
 UPDATE public.category_budgets SET allocated_amount=allocated_amount-p_amount,updated_at=now() WHERE id=source.id;
 SELECT greatest(COALESCE(max(allocated_amount),0),finance_private.budget_spent(h,p_to,p_month)) INTO target FROM public.category_budgets WHERE household_id=h AND month=p_month AND category_id=p_to;
 IF EXISTS(SELECT 1 FROM public.category_budgets WHERE household_id=h AND month=p_month AND allocated_amount>0 AND category_id<>p_to
  AND ((p_to='food' AND category_id LIKE 'food-%') OR (p_to LIKE 'food-%' AND category_id='food'))) THEN RAISE EXCEPTION 'Food budgets overlap'; END IF;
 INSERT INTO public.category_budgets(household_id,month,category_id,allocated_amount) VALUES(h,p_month,p_to,target+p_amount)
 ON CONFLICT(household_id,month,category_id) DO UPDATE SET allocated_amount=excluded.allocated_amount,updated_at=now();
 IF public.finance_capital(h)-public.finance_reserved(h) IS DISTINCT FROM old_free THEN RAISE EXCEPTION 'Budget transfer must preserve free funds'; END IF;
END $$;

CREATE OR REPLACE FUNCTION finance_private.distribution_refund(h UUID,distribution UUID)
RETURNS JSONB LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT COALESCE(jsonb_agg(jsonb_build_object('targetType',i->>'targetType','targetId',i->>'targetId','amount',
 least((i->>'amount')::numeric,CASE WHEN i->>'targetType'='budget' THEN
   COALESCE((SELECT greatest(0,b.allocated_amount-finance_private.budget_spent(h,b.category_id,b.month)) FROM public.category_budgets b WHERE b.household_id=h AND b.month=d.month AND b.category_id=i->>'targetId'),0)
 ELSE COALESCE((SELECT greatest(0,least(g.current_amount,COALESCE((SELECT sum(CASE WHEN t.kind='goal_deposit' THEN t.amount WHEN t.kind='goal_release' THEN -t.amount ELSE 0 END) FROM public.transactions t WHERE t.household_id=h AND t.income_distribution_id=d.id AND t.goal_id=g.id),0))) FROM public.savings_goals g WHERE g.household_id=h AND g.id=(i->>'targetId')::uuid AND NOT g.is_archived),0) END)) ORDER BY ord),'[]'::jsonb)
 FROM public.income_distributions d CROSS JOIN LATERAL jsonb_array_elements(d.items) WITH ORDINALITY x(i,ord)
 WHERE d.id=distribution AND d.household_id=h AND d.status='active';
$$;
CREATE OR REPLACE FUNCTION public.guard_distribution_link()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path='' AS $$
DECLARE privileged BOOLEAN;
BEGIN
 SELECT rolsuper OR rolbypassrls INTO privileged FROM pg_catalog.pg_roles WHERE rolname=current_user;
 IF NEW.income_distribution_id IS NOT NULL THEN
  IF NOT COALESCE(privileged,false) THEN RAISE EXCEPTION 'Use income distribution RPC'; END IF;
  IF NEW.kind NOT IN ('goal_deposit','goal_release') OR NOT EXISTS(SELECT 1 FROM public.income_distributions WHERE id=NEW.income_distribution_id AND household_id=NEW.household_id) THEN RAISE EXCEPTION 'Distribution must belong to the goal movement household'; END IF;
 END IF; RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION public.change_income_distribution(p_id UUID,p_items JSONB,p_expected_revision INTEGER,p_refund_preview JSONB)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE h UUID; d public.income_distributions%ROWTYPE; source public.transactions%ROWTYPE; item JSONB; amount NUMERIC; total NUMERIC:=0; refund JSONB; movement UUID; before_state JSONB; base NUMERIC;
BEGIN
 h:=public.finance_household_lock();
 SELECT * INTO d FROM public.income_distributions WHERE id=p_id AND household_id=h FOR UPDATE;
 IF NOT FOUND OR d.month<>public.finance_current_month() THEN RAISE EXCEPTION 'Current-month household distribution required'; END IF;
 IF p_expected_revision IS DISTINCT FROM d.revision THEN RAISE EXCEPTION 'Distribution changed; refresh the preview'; END IF;
 refund:=finance_private.distribution_refund(h,d.id);
 IF p_refund_preview IS DISTINCT FROM refund THEN RAISE EXCEPTION 'Reservations changed; refresh the preview'; END IF;
 IF d.status='cancelled' AND p_items IS NULL THEN RETURN; END IF;
 before_state:=to_jsonb(d);
 SELECT * INTO source FROM public.transactions WHERE id=d.income_transaction_id AND household_id=h FOR UPDATE;
 IF NOT FOUND OR source.type<>'income' OR source.kind<>'cashflow' OR source.date>(now() AT TIME ZONE 'Europe/Minsk')::date THEN RAISE EXCEPTION 'Posted household income required'; END IF;
 IF p_items IS NOT NULL THEN
  IF jsonb_typeof(p_items)<>'array' OR jsonb_array_length(p_items) NOT BETWEEN 1 AND 32 THEN RAISE EXCEPTION 'Choose at least one allocation'; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_items) i GROUP BY i->>'targetType',i->>'targetId' HAVING count(*)>1) THEN RAISE EXCEPTION 'Duplicate allocation target'; END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(p_items) LOOP
   IF item->>'targetType' IS NULL OR item->>'targetType' NOT IN ('budget','goal') OR NULLIF(btrim(item->>'targetId'),'') IS NULL OR item->>'targetId' IS DISTINCT FROM btrim(item->>'targetId') THEN RAISE EXCEPTION 'Invalid allocation target'; END IF;
   amount:=(item->>'amount')::numeric; PERFORM public.finance_validate_amount(amount); total:=total+amount;
  END LOOP;
  IF total>source.amount THEN RAISE EXCEPTION 'Allocation exceeds income or unassigned funds'; END IF;
 END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(refund) LOOP
  amount:=(item->>'amount')::numeric; IF amount<=0 THEN CONTINUE; END IF;
  IF item->>'targetType'='budget' THEN
   UPDATE public.category_budgets SET allocated_amount=allocated_amount-amount,updated_at=now() WHERE household_id=h AND month=d.month AND category_id=item->>'targetId';
  ELSE
   movement:=public.change_goal_funds((item->>'targetId')::uuid,-amount,(now() AT TIME ZONE 'Europe/Minsk')::date);
   UPDATE public.transactions SET income_distribution_id=d.id WHERE id=movement;
  END IF;
 END LOOP;
 IF p_items IS NOT NULL THEN
  IF total>public.finance_capital(h)-public.finance_reserved(h) THEN RAISE EXCEPTION 'Allocation exceeds income or unassigned funds'; END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(p_items) LOOP
   amount:=(item->>'amount')::numeric;
   IF item->>'targetType'='budget' THEN
    SELECT greatest(COALESCE(max(allocated_amount),0),finance_private.budget_spent(h,item->>'targetId',d.month)) INTO base FROM public.category_budgets WHERE household_id=h AND month=d.month AND category_id=item->>'targetId';
    PERFORM public.set_category_budget(item->>'targetId',base+amount,d.month);
   ELSE
    movement:=public.change_goal_funds((item->>'targetId')::uuid,amount,(now() AT TIME ZONE 'Europe/Minsk')::date);
    UPDATE public.transactions SET income_distribution_id=d.id WHERE id=movement;
   END IF;
  END LOOP;
 END IF;
 UPDATE public.income_distributions SET status=CASE WHEN p_items IS NULL THEN 'cancelled' ELSE 'active' END,
  items=COALESCE(p_items,items),total_amount=CASE WHEN p_items IS NULL THEN total_amount ELSE total END,revision=revision+1,updated_at=now() WHERE id=d.id RETURNING * INTO d;
 INSERT INTO public.income_distribution_revisions(household_id,distribution_id,revision,action,before_state,after_state,refund,created_by)
 VALUES(h,d.id,d.revision,CASE WHEN p_items IS NULL THEN 'cancel' ELSE 'edit' END,before_state,to_jsonb(d),refund,auth.uid());
END $$;

CREATE OR REPLACE FUNCTION public.save_income_template(p_id UUID,p_name TEXT,p_items JSONB)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE h UUID; item JSONB; v_value NUMERIC; result UUID;
BEGIN
 h:=public.finance_household_lock();
 IF p_name IS NULL OR length(btrim(p_name)) NOT BETWEEN 1 AND 80 OR p_items IS NULL OR jsonb_typeof(p_items)<>'array' OR jsonb_array_length(p_items) NOT BETWEEN 1 AND 32 THEN RAISE EXCEPTION 'Valid template name and items required'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_items) i GROUP BY i->>'targetType',i->>'targetId' HAVING count(*)>1) THEN RAISE EXCEPTION 'Duplicate allocation target'; END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(p_items) LOOP
  IF item->>'mode' IS NULL OR item->>'mode' NOT IN ('fixed','percent') OR item->>'targetType' IS NULL OR item->>'targetType' NOT IN ('budget','goal') OR NULLIF(btrim(item->>'targetId'),'') IS NULL OR item->>'targetId' IS DISTINCT FROM btrim(item->>'targetId') THEN RAISE EXCEPTION 'Invalid template item'; END IF;
  v_value:=(item->>'value')::numeric; PERFORM public.finance_validate_amount(v_value);
  IF item->>'mode'='percent' AND v_value>100 THEN RAISE EXCEPTION 'Percentage must be at most 100'; END IF;
  IF item->>'targetType'='goal' AND NOT EXISTS(SELECT 1 FROM public.savings_goals WHERE household_id=h AND id=(item->>'targetId')::uuid AND NOT is_archived) THEN RAISE EXCEPTION 'Active household goal required'; END IF;
  IF item->>'targetType'='budget' AND (length(item->>'targetId')>64 OR item->>'targetId'='salary' OR item->>'targetId'='savings' OR item->>'targetId' LIKE 'income-%') THEN RAISE EXCEPTION 'Expense category required'; END IF;
 END LOOP;
 IF p_id IS NULL THEN
  INSERT INTO public.income_templates(household_id,name,items) VALUES(h,btrim(p_name),p_items) RETURNING id INTO result;
 ELSE
  UPDATE public.income_templates SET name=btrim(p_name),items=p_items,updated_at=now() WHERE id=p_id AND household_id=h AND NOT is_archived RETURNING id INTO result;
  IF NOT FOUND THEN RAISE EXCEPTION 'Household template required'; END IF;
 END IF; RETURN result;
END $$;
CREATE OR REPLACE FUNCTION public.archive_income_template(p_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE h UUID; BEGIN h:=public.finance_household_lock(); UPDATE public.income_templates SET is_archived=true,updated_at=now() WHERE id=p_id AND household_id=h; IF NOT FOUND THEN RAISE EXCEPTION 'Household template required'; END IF; END $$;

CREATE OR REPLACE FUNCTION public.review_budget_month(p_mode TEXT,p_goal_id UUID,p_preview JSONB)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE h UUID; v_month DATE; previous DATE; preview JSONB; b RECORD; amount NUMERIC; base NUMERIC; total NUMERIC:=0; old_free NUMERIC; result UUID;
BEGIN
 h:=public.finance_household_lock(); v_month:=public.finance_current_month(); previous:=(v_month-interval '1 month')::date;
 IF p_mode IS NULL OR p_mode NOT IN ('repeat','carry','goal','release') THEN RAISE EXCEPTION 'Valid month review mode required'; END IF;
 IF EXISTS(SELECT 1 FROM public.budget_rollovers WHERE household_id=h AND source_month=previous) THEN RAISE EXCEPTION 'Previous month already reviewed'; END IF;
 SELECT COALESCE(jsonb_agg(jsonb_build_object('targetType','budget','targetId',s.category_id,'amount',s.amount) ORDER BY s.category_id COLLATE "C"),'[]'::jsonb) INTO preview
 FROM(SELECT category_id,CASE WHEN p_mode='repeat' THEN allocated_amount ELSE greatest(0,allocated_amount-finance_private.budget_spent(h,category_id,previous)) END AS amount
 FROM public.category_budgets WHERE household_id=h AND month=previous) s WHERE s.amount>0;
 IF preview='[]'::jsonb THEN RAISE EXCEPTION 'No previous month funds or plan'; END IF;
 IF p_preview IS DISTINCT FROM preview THEN RAISE EXCEPTION 'Previous month changed; refresh the preview'; END IF;
 IF p_mode='repeat' AND EXISTS(SELECT 1 FROM public.category_budgets WHERE household_id=h AND month=v_month AND allocated_amount>0) THEN RAISE EXCEPTION 'Current month already has a plan'; END IF;
 old_free:=public.finance_capital(h)-public.finance_reserved(h);
 FOR b IN SELECT value AS item FROM jsonb_array_elements(preview) LOOP
  amount:=(b.item->>'amount')::numeric; total:=total+amount;
  IF p_mode IN ('repeat','carry') THEN
   SELECT COALESCE(max(allocated_amount),0) INTO base FROM public.category_budgets WHERE household_id=h AND month=v_month AND category_id=b.item->>'targetId';
   PERFORM public.set_category_budget(b.item->>'targetId',CASE WHEN p_mode='repeat' THEN amount ELSE greatest(base,finance_private.budget_spent(h,b.item->>'targetId',v_month))+amount END,v_month);
  END IF;
 END LOOP;
 IF p_mode='goal' THEN PERFORM public.change_goal_funds(p_goal_id,total,(now() AT TIME ZONE 'Europe/Minsk')::date); END IF;
 IF public.finance_capital(h)-public.finance_reserved(h)<0 AND public.finance_capital(h)-public.finance_reserved(h)<old_free THEN RAISE EXCEPTION 'Insufficient unassigned funds'; END IF;
 INSERT INTO public.budget_rollovers(household_id,source_month,target_month,mode,amount,items,created_by) VALUES(h,previous,v_month,p_mode,total,preview,auth.uid()) RETURNING id INTO result;
 RETURN result;
END $$;

CREATE OR REPLACE FUNCTION public.save_finance_fund(p_id UUID,p_name TEXT,p_purpose TEXT,p_target NUMERIC,p_deadline DATE,p_essential NUMERIC,p_months INTEGER,p_categories TEXT[])
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE h UUID; result UUID; target NUMERIC;
BEGIN
 h:=public.finance_household_lock();
 IF NOT EXISTS(SELECT 1 FROM public.accounts WHERE household_id=h AND NOT is_archived) THEN RAISE EXCEPTION 'Initialize accounts first'; END IF;
 IF p_name IS NULL OR length(btrim(p_name)) NOT BETWEEN 1 AND 80 OR p_purpose IS NULL OR p_purpose NOT IN ('emergency','expense_fund') THEN RAISE EXCEPTION 'Valid fund name and purpose required'; END IF;
 IF p_purpose='emergency' THEN
  PERFORM public.finance_validate_amount(p_essential);
  IF p_months IS NULL OR p_months NOT BETWEEN 1 AND 12 OR p_deadline IS NOT NULL THEN RAISE EXCEPTION 'Emergency reserve needs 1 to 12 months and no deadline'; END IF;
  target:=p_essential*p_months;
  IF p_categories IS NULL OR cardinality(p_categories) NOT BETWEEN 1 AND 32 OR EXISTS(SELECT 1 FROM unnest(p_categories) c WHERE c IS NULL OR length(btrim(c)) NOT BETWEEN 1 AND 64 OR c='salary' OR c='savings' OR c LIKE 'income-%') THEN RAISE EXCEPTION 'Choose essential expense categories'; END IF;
 ELSE
  target:=p_target;
  IF p_deadline IS NULL OR p_deadline<(now() AT TIME ZONE 'Europe/Minsk')::date THEN RAISE EXCEPTION 'Future fund deadline required'; END IF;
 END IF;
 PERFORM public.finance_validate_amount(target);
 IF p_id IS NULL THEN
  INSERT INTO public.savings_goals(household_id,name,target_amount,current_amount,emoji,deadline,purpose,essential_amount,reserve_months,essential_categories)
  VALUES(h,btrim(p_name),target,0,CASE WHEN p_purpose='emergency' THEN '🛟' ELSE '🗓️' END,p_deadline,p_purpose,CASE WHEN p_purpose='emergency' THEN p_essential END,CASE WHEN p_purpose='emergency' THEN p_months END,CASE WHEN p_purpose='emergency' THEN p_categories ELSE '{}'::text[] END) RETURNING id INTO result;
 ELSE
  UPDATE public.savings_goals SET name=btrim(p_name),target_amount=target,deadline=p_deadline,purpose=p_purpose,essential_amount=CASE WHEN p_purpose='emergency' THEN p_essential END,reserve_months=CASE WHEN p_purpose='emergency' THEN p_months END,essential_categories=CASE WHEN p_purpose='emergency' THEN p_categories ELSE '{}'::text[] END WHERE id=p_id AND household_id=h AND NOT is_archived RETURNING id INTO result;
  IF NOT FOUND THEN RAISE EXCEPTION 'Active household goal required'; END IF;
 END IF; RETURN result;
END $$;

DO $$ DECLARE item TEXT; action TEXT; BEGIN
 FOREACH item IN ARRAY ARRAY['income_templates','budget_rollovers','income_distribution_revisions'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',item);
  FOREACH action IN ARRAY ARRAY['SELECT','INSERT','UPDATE','DELETE'] LOOP
   EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I',item||'_household_'||lower(action),item);
   IF action IN ('SELECT','DELETE') THEN
    EXECUTE format('CREATE POLICY %I ON public.%I FOR %s TO authenticated USING(household_id=(SELECT public.get_my_household_id()))',item||'_household_'||lower(action),item,action);
   ELSIF action='INSERT' THEN
    EXECUTE format('CREATE POLICY %I ON public.%I FOR INSERT TO authenticated WITH CHECK(household_id=(SELECT public.get_my_household_id()))',item||'_household_insert',item);
   ELSE
    EXECUTE format('CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated USING(household_id=(SELECT public.get_my_household_id())) WITH CHECK(household_id=(SELECT public.get_my_household_id()))',item||'_household_update',item);
   END IF;
  END LOOP;
  EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated',item); EXECUTE format('GRANT SELECT ON public.%I TO authenticated',item);
  EXECUTE format('DROP TRIGGER IF EXISTS guard_planning_write ON public.%I',item);
  EXECUTE format('CREATE TRIGGER guard_planning_write BEFORE INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.guard_planning_write()',item);
  IF EXISTS(SELECT 1 FROM pg_publication WHERE pubname='supabase_realtime') AND NOT EXISTS(SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename=item) THEN EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I',item); END IF;
 END LOOP;
END $$;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA finance_private FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.transfer_category_budget(TEXT,TEXT,NUMERIC,DATE),public.change_income_distribution(UUID,JSONB,INTEGER,JSONB),public.save_income_template(UUID,TEXT,JSONB),public.archive_income_template(UUID),public.review_budget_month(TEXT,UUID,JSONB),public.save_finance_fund(UUID,TEXT,TEXT,NUMERIC,DATE,NUMERIC,INTEGER,TEXT[]) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.transfer_category_budget(TEXT,TEXT,NUMERIC,DATE),public.change_income_distribution(UUID,JSONB,INTEGER,JSONB),public.save_income_template(UUID,TEXT,JSONB),public.archive_income_template(UUID),public.review_budget_month(TEXT,UUID,JSONB),public.save_finance_fund(UUID,TEXT,TEXT,NUMERIC,DATE,NUMERIC,INTEGER,TEXT[]) TO authenticated;
CREATE OR REPLACE FUNCTION public.update_finance_transaction(p_id UUID, p_type TEXT, p_amount NUMERIC,
  p_category_id TEXT, p_comment TEXT, p_added_by UUID, p_date DATE, p_account_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_household UUID; v_tx public.transactions%ROWTYPE; v_capital NUMERIC; v_new_capital NUMERIC; v_reserved NUMERIC;
BEGIN
  v_household := public.finance_household_lock();
  PERFORM public.finance_validate_amount(p_amount);
  SELECT * INTO v_tx FROM public.transactions WHERE id = p_id AND household_id = v_household FOR UPDATE;
  IF NOT FOUND OR v_tx.kind <> 'cashflow' THEN RAISE EXCEPTION 'Household cashflow transaction required'; END IF;
  IF EXISTS(SELECT 1 FROM public.income_distributions WHERE income_transaction_id=p_id AND (p_type<>'income' OR (status='active' AND p_amount<total_amount) OR p_date IS DISTINCT FROM v_tx.date)) THEN RAISE EXCEPTION 'Distributed income must preserve its date, type and allocated amount'; END IF;
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
  SELECT public.finance_reserved(v_household) INTO v_reserved;
  UPDATE public.transactions SET type = p_type, amount = p_amount, category_id = p_category_id,
    comment = COALESCE(p_comment, ''), added_by = p_added_by, date = p_date, account_id = p_account_id WHERE id = p_id;
  IF v_new_capital-public.finance_reserved(v_household)<0 AND v_new_capital-public.finance_reserved(v_household)<v_capital-v_reserved THEN RAISE EXCEPTION 'Release goal reservations or budgets before reducing unassigned funds'; END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.finance_flexible_planning_version() RETURNS INTEGER LANGUAGE sql IMMUTABLE SET search_path='' AS $$ SELECT 1; $$;
REVOKE ALL ON FUNCTION public.finance_flexible_planning_version() FROM PUBLIC; GRANT EXECUTE ON FUNCTION public.finance_flexible_planning_version() TO anon,authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;

-- 15. Reviewed Priorbank import (2026-10-19)
-- Reviewed local Priorbank handoff. No bank credentials, network calls or balance correction.
BEGIN;
CREATE SCHEMA IF NOT EXISTS finance_private;
REVOKE ALL ON SCHEMA finance_private FROM PUBLIC, anon, authenticated;

CREATE TABLE IF NOT EXISTS public.prior_import_sources (
  household_id UUID NOT NULL REFERENCES public.households(id) ON DELETE CASCADE,
  owner_id UUID NOT NULL,
  source_key TEXT NOT NULL CHECK (source_key ~ '^[a-f0-9]{64}$'),
  account_id UUID NOT NULL REFERENCES public.accounts(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (household_id, source_key),
  UNIQUE (household_id, account_id),
  UNIQUE (household_id, owner_id, source_key)
);
CREATE TABLE IF NOT EXISTS public.prior_import_days (
  household_id UUID NOT NULL,
  owner_id UUID NOT NULL,
  source_key TEXT NOT NULL,
  day DATE NOT NULL,
  signature TEXT NOT NULL CHECK (signature ~ '^[a-f0-9]{64}$'),
  imported_keys TEXT[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (household_id, source_key, day),
  FOREIGN KEY (household_id, owner_id, source_key)
    REFERENCES public.prior_import_sources(household_id, owner_id, source_key) ON DELETE CASCADE
);
DO $$ DECLARE tab TEXT; action TEXT;
BEGIN
  FOREACH tab IN ARRAY ARRAY['prior_import_sources','prior_import_days'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',tab);
    FOREACH action IN ARRAY ARRAY['SELECT','DELETE'] LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I',tab||'_'||lower(action),tab);
      EXECUTE format('CREATE POLICY %I ON public.%I FOR %s TO authenticated USING(household_id=(SELECT public.get_my_household_id()) AND owner_id=(SELECT auth.uid()))',tab||'_'||lower(action),tab,action);
    END LOOP;
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I',tab||'_insert',tab);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR INSERT TO authenticated WITH CHECK(household_id=(SELECT public.get_my_household_id()) AND owner_id=(SELECT auth.uid()))',tab||'_insert',tab);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I',tab||'_update',tab);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated USING(household_id=(SELECT public.get_my_household_id()) AND owner_id=(SELECT auth.uid())) WITH CHECK(household_id=(SELECT public.get_my_household_id()) AND owner_id=(SELECT auth.uid()))',tab||'_update',tab);
    -- Only the guarded atomic RPC may mutate receipts. Deleting a ledger row retains its receipt.
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated',tab);
    EXECUTE format('GRANT SELECT ON public.%I TO authenticated',tab);
  END LOOP;
END $$;

-- Internal invoker helper. Public entry points own the household lock and explicit auth check.
CREATE OR REPLACE FUNCTION finance_private.prepare_prior_import(h UUID, a UUID, s JSONB)
RETURNS JSONB LANGUAGE plpgsql SET search_path='' AS $$
DECLARE r JSONB; c JSONB; rows JSONB; days JSONB; imported JSONB; source TEXT;
  d DATE; first_day DATE; last_day DATE; closed_before DATE; today DATE := (now() AT TIME ZONE 'Europe/Minsk')::date;
BEGIN
  IF auth.uid() IS NULL OR h IS DISTINCT FROM public.get_my_household_id() THEN RAISE EXCEPTION 'PRIOR_AUTH'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.accounts WHERE id=a AND household_id=h AND NOT is_archived AND currency='BYN' AND kind='bank') THEN RAISE EXCEPTION 'PRIOR_ACCOUNT'; END IF;
  IF s IS NULL OR jsonb_typeof(s)<>'object' OR octet_length(s::text)>8000000
    OR s->>'format' IS DISTINCT FROM 'finapp-prior' OR s->'version' IS DISTINCT FROM '1'::jsonb
    OR EXISTS(SELECT 1 FROM jsonb_object_keys(s) k WHERE k NOT IN ('format','version','from','to','fetchedAt','card')) THEN RAISE EXCEPTION 'PRIOR_FORMAT'; END IF;
  IF coalesce(s->>'from','') !~ '^\d{4}-\d{2}-\d{2}$' OR coalesce(s->>'to','') !~ '^\d{4}-\d{2}-\d{2}$' THEN RAISE EXCEPTION 'PRIOR_PERIOD'; END IF;
  first_day:=(s->>'from')::date; last_day:=(s->>'to')::date;
  IF first_day>last_day OR last_day>today OR last_day-first_day>30 THEN RAISE EXCEPTION 'PRIOR_PERIOD'; END IF;
  IF coalesce(s->>'fetchedAt','') !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$' THEN RAISE EXCEPTION 'PRIOR_PERIOD'; END IF;
  closed_before:=((s->>'fetchedAt')::timestamptz AT TIME ZONE 'Europe/Minsk')::date;
  IF closed_before>today THEN RAISE EXCEPTION 'PRIOR_PERIOD'; END IF;
  c:=s->'card';
  IF jsonb_typeof(c) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'PRIOR_FORMAT'; END IF;
  source:=c->>'sourceKey';
  IF coalesce(source,'') !~ '^[a-f0-9]{64}$' OR c->>'currency' IS DISTINCT FROM 'BYN'
    OR coalesce(length(c->>'title'),0) NOT BETWEEN 1 AND 200 OR coalesce(c->>'maskedNumber','') !~ '^(•••• [0-9]{4}|Номер скрыт)$'
    OR EXISTS(SELECT 1 FROM jsonb_object_keys(c) k WHERE k NOT IN ('sourceKey','title','maskedNumber','currency','records')) THEN RAISE EXCEPTION 'PRIOR_FORMAT'; END IF;
  IF jsonb_typeof(c->'records') IS DISTINCT FROM 'array' OR jsonb_array_length(c->'records')>2000 THEN RAISE EXCEPTION 'PRIOR_ROWS'; END IF;
  IF EXISTS(SELECT 1 FROM public.prior_import_sources WHERE household_id=h AND source_key=source AND (owner_id<>auth.uid() OR account_id<>a)) THEN RAISE EXCEPTION 'PRIOR_SOURCE_BOUND'; END IF;
  IF EXISTS(SELECT 1 FROM public.prior_import_sources WHERE household_id=h AND account_id=a AND source_key<>source) THEN RAISE EXCEPTION 'PRIOR_ACCOUNT_BOUND'; END IF;
  -- Until stable bank transaction IDs are verified, a later upload must recheck every
  -- previously imported day, including a day that became empty after a bank correction.
  IF EXISTS(SELECT 1 FROM public.prior_import_days WHERE household_id=h AND source_key=source AND (day<first_day OR day>last_day OR day>=closed_before)) THEN RAISE EXCEPTION 'PRIOR_RANGE_COVERAGE'; END IF;
  FOR r IN SELECT value FROM jsonb_array_elements(c->'records') LOOP
    IF jsonb_typeof(r)<>'object' THEN RAISE EXCEPTION 'PRIOR_ROW'; END IF;
    IF EXISTS(SELECT 1 FROM jsonb_object_keys(r) k WHERE k NOT IN ('date','description','accountAmount','operationAmount','operationCurrency','fee','source'))
      OR jsonb_typeof(r->'date') IS DISTINCT FROM 'string' OR coalesce(r->>'date','') !~ '^\d{4}-\d{2}-\d{2}' OR length(r->>'date')>80
      OR jsonb_typeof(r->'description') IS DISTINCT FROM 'string' OR length(r->>'description') NOT BETWEEN 1 AND 4000
      OR coalesce(r->>'source','') NOT IN ('history','additional') OR coalesce(r->>'operationCurrency','') !~ '^[A-Z]{3}$'
      OR jsonb_typeof(r->'operationAmount') IS DISTINCT FROM 'string' OR coalesce(r->>'operationAmount','') !~ '^-?(0|[1-9][0-9]{0,9})\.[0-9]{2}$'
      OR NOT (r ? 'accountAmount' AND r ? 'fee') THEN RAISE EXCEPTION 'PRIOR_ROW'; END IF;
    d:=left(r->>'date',10)::date;
    IF (r->>'source'='history' OR r->'accountAmount'<>'null'::jsonb) AND
      (jsonb_typeof(r->'accountAmount') IS DISTINCT FROM 'string' OR coalesce(r->>'accountAmount','') !~ '^-?(0|[1-9][0-9]{0,9})\.[0-9]{2}$') THEN RAISE EXCEPTION 'PRIOR_AMOUNT'; END IF;
    IF r->'fee'<>'null'::jsonb AND (jsonb_typeof(r->'fee') IS DISTINCT FROM 'string' OR coalesce(r->>'fee','') !~ '^-?(0|[1-9][0-9]{0,9})\.[0-9]{2}$') THEN RAISE EXCEPTION 'PRIOR_AMOUNT'; END IF;
  END LOOP;
  WITH eligible AS (
    SELECT (ordinality-1)::int AS idx, left(value->>'date',10) AS day,
      value->>'description' AS description, (value->>'accountAmount')::numeric AS amount,
      jsonb_build_array(value->>'date',value->>'description',(value->>'accountAmount')::numeric,
        (value->>'operationAmount')::numeric,value->>'operationCurrency',(value->>'fee')::numeric) AS canonical
    FROM jsonb_array_elements(c->'records') WITH ORDINALITY
    WHERE value->>'source'='history' AND left(value->>'date',10)::date BETWEEN first_day AND last_day
      AND left(value->>'date',10)::date<closed_before AND (value->>'accountAmount')::numeric<>0
  ), keyed AS (
    SELECT *, encode(sha256(convert_to(canonical::text,'UTF8')),'hex')||':'||row_number() OVER(PARTITION BY canonical ORDER BY idx) AS key FROM eligible
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object('index',idx,'day',day,'description',description,'amount',amount::text,'key',key,'canonical',canonical) ORDER BY idx),'[]'::jsonb) INTO rows FROM keyed;
  SELECT coalesce(jsonb_agg(jsonb_build_object('day',day,'signature',signature)),'[]'::jsonb) INTO days FROM (
    SELECT day::date::text AS day, encode(sha256(convert_to(coalesce(string_agg((r.value->'canonical')::text,E'\n' ORDER BY (r.value->'canonical')::text),''),'UTF8')),'hex') AS signature
    FROM generate_series(first_day::timestamp,least(last_day,closed_before-1)::timestamp,interval '1 day') day
    LEFT JOIN jsonb_array_elements(rows) r(value) ON r.value->>'day'=day::date::text GROUP BY day
  ) daily;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(days) AS input_day(value) JOIN public.prior_import_days receipt
    ON receipt.household_id=h AND receipt.source_key=source AND receipt.day=(input_day.value->>'day')::date
    WHERE receipt.signature<>input_day.value->>'signature') THEN RAISE EXCEPTION 'PRIOR_DAY_CHANGED'; END IF;
  SELECT coalesce(jsonb_agg((row->>'index')::int),'[]'::jsonb) INTO imported
    FROM jsonb_array_elements(rows) row JOIN public.prior_import_days receipt
    ON receipt.household_id=h AND receipt.source_key=source AND receipt.day=(row->>'day')::date
    WHERE row->>'key'=ANY(receipt.imported_keys);
  RETURN jsonb_build_object('rows',rows,'days',days,'source',source,'importedIndexes',imported,
    'linked',EXISTS(SELECT 1 FROM public.prior_import_sources WHERE household_id=h AND source_key=source));
END $$;

CREATE OR REPLACE FUNCTION public.preview_prior_import(p_account_id UUID,p_snapshot JSONB)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET statement_timeout='10s' AS $$
DECLARE h UUID; prepared JSONB;
BEGIN
  h:=public.finance_household_lock();
  prepared:=finance_private.prepare_prior_import(h,p_account_id,p_snapshot);
  RETURN jsonb_build_object('importedIndexes',prepared->'importedIndexes','linked',prepared->'linked');
END $$;

CREATE OR REPLACE FUNCTION public.import_prior_operations(p_account_id UUID,p_snapshot JSONB,p_items JSONB)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET statement_timeout='10s' AS $$
DECLARE h UUID; prepared JSONB; item JSONB; row JSONB; v_day JSONB; seen INT[]:='{}'; idx INT;
  v_amount NUMERIC; imported INT:=0; skipped INT:=0; source TEXT;
BEGIN
  h:=public.finance_household_lock();
  prepared:=finance_private.prepare_prior_import(h,p_account_id,p_snapshot); source:=prepared->>'source';
  IF jsonb_typeof(p_items) IS DISTINCT FROM 'array' OR jsonb_array_length(p_items) NOT BETWEEN 1 AND 2000 THEN RAISE EXCEPTION 'PRIOR_SELECTION'; END IF;
  INSERT INTO public.prior_import_sources(household_id,owner_id,source_key,account_id) VALUES(h,auth.uid(),source,p_account_id) ON CONFLICT DO NOTHING;
  FOR item IN SELECT value FROM jsonb_array_elements(p_items) LOOP
    IF jsonb_typeof(item) IS DISTINCT FROM 'object' OR jsonb_typeof(item->'index') IS DISTINCT FROM 'number' OR coalesce(item->>'index','') !~ '^[0-9]{1,4}$'
      OR jsonb_typeof(item->'categoryId') IS DISTINCT FROM 'string' OR coalesce(item->>'categoryId','') !~ '^[a-z][a-z0-9-]{0,63}$'
      OR jsonb_typeof(item->'confirmExisting') IS DISTINCT FROM 'boolean' THEN RAISE EXCEPTION 'PRIOR_SELECTION'; END IF;
    idx:=(item->>'index')::int;
    IF idx=ANY(seen) THEN RAISE EXCEPTION 'PRIOR_SELECTION'; END IF;
    seen:=array_append(seen,idx);
    SELECT value INTO row FROM jsonb_array_elements(prepared->'rows') WHERE (value->>'index')::int=idx;
    IF row IS NULL THEN RAISE EXCEPTION 'PRIOR_SELECTION'; END IF;
    IF EXISTS(SELECT 1 FROM public.prior_import_days WHERE household_id=h AND source_key=source AND public.prior_import_days.day=(row->>'day')::date AND row->>'key'=ANY(imported_keys)) THEN skipped:=skipped+1; CONTINUE; END IF;
    v_amount:=(row->>'amount')::numeric;
    IF NOT (item->>'confirmExisting')::boolean AND EXISTS(SELECT 1 FROM public.transactions WHERE household_id=h AND account_id=p_account_id AND kind='cashflow'
      AND date=(row->>'day')::date AND public.transactions.amount=abs(v_amount) AND type=CASE WHEN v_amount<0 THEN 'expense' ELSE 'income' END) THEN RAISE EXCEPTION 'PRIOR_CONFIRM_EXISTING'; END IF;
    INSERT INTO public.transactions(household_id,added_by,type,amount,category_id,comment,date,kind,account_id)
      VALUES(h,auth.uid(),CASE WHEN v_amount<0 THEN 'expense' ELSE 'income' END,abs(v_amount),item->>'categoryId',row->>'description',(row->>'day')::date,'cashflow',p_account_id);
    SELECT value INTO v_day FROM jsonb_array_elements(prepared->'days') WHERE value->>'day'=row->>'day';
    INSERT INTO public.prior_import_days(household_id,owner_id,source_key,day,signature,imported_keys)
      VALUES(h,auth.uid(),source,(row->>'day')::date,v_day->>'signature',ARRAY[row->>'key'])
      ON CONFLICT(household_id,source_key,day) DO UPDATE SET imported_keys=array_append(public.prior_import_days.imported_keys,row->>'key');
    imported:=imported+1;
  END LOOP;
  RETURN jsonb_build_object('imported',imported,'skipped',skipped);
END $$;
REVOKE ALL ON FUNCTION finance_private.prepare_prior_import(UUID,UUID,JSONB) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.preview_prior_import(UUID,JSONB),public.import_prior_operations(UUID,JSONB,JSONB) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.preview_prior_import(UUID,JSONB),public.import_prior_operations(UUID,JSONB,JSONB) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;

-- 16. Server Priorbank connection (2026-10-19)
-- No credentials or financial payloads. Private short-lived rate/lease metadata only.
BEGIN;
CREATE SCHEMA IF NOT EXISTS finance_private;
REVOKE ALL ON SCHEMA finance_private FROM PUBLIC, anon, authenticated;
CREATE TABLE IF NOT EXISTS finance_private.prior_connection_attempts (
  scope TEXT PRIMARY KEY,
  household_id UUID NOT NULL REFERENCES public.households(id) ON DELETE CASCADE,
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  attempt_id UUID NOT NULL,
  last_started_at TIMESTAMPTZ NOT NULL,
  lease_until TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS prior_connection_attempts_expiry ON finance_private.prior_connection_attempts(last_started_at);
CREATE INDEX IF NOT EXISTS prior_connection_attempts_owner ON finance_private.prior_connection_attempts(owner_id,attempt_id);
CREATE INDEX IF NOT EXISTS prior_connection_attempts_household ON finance_private.prior_connection_attempts(household_id);
ALTER TABLE finance_private.prior_connection_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON finance_private.prior_connection_attempts FROM PUBLIC, anon, authenticated;
DO $$ DECLARE action TEXT;
BEGIN
  FOREACH action IN ARRAY ARRAY['SELECT','DELETE'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON finance_private.prior_connection_attempts','prior_connection_'||lower(action));
    EXECUTE format('CREATE POLICY %I ON finance_private.prior_connection_attempts FOR %s TO authenticated USING(household_id=(SELECT public.get_my_household_id()) AND owner_id=(SELECT auth.uid()))','prior_connection_'||lower(action),action);
  END LOOP;
  DROP POLICY IF EXISTS prior_connection_insert ON finance_private.prior_connection_attempts;
  CREATE POLICY prior_connection_insert ON finance_private.prior_connection_attempts FOR INSERT TO authenticated WITH CHECK(household_id=(SELECT public.get_my_household_id()) AND owner_id=(SELECT auth.uid()));
  DROP POLICY IF EXISTS prior_connection_update ON finance_private.prior_connection_attempts;
  CREATE POLICY prior_connection_update ON finance_private.prior_connection_attempts FOR UPDATE TO authenticated USING(household_id=(SELECT public.get_my_household_id()) AND owner_id=(SELECT auth.uid())) WITH CHECK(household_id=(SELECT public.get_my_household_id()) AND owner_id=(SELECT auth.uid()));
END $$;

CREATE OR REPLACE FUNCTION public.claim_prior_connection(p_owner UUID,p_login_key TEXT,p_attempt UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET statement_timeout='5s' AS $$
DECLARE h UUID; key TEXT; changed INTEGER;
BEGIN
  SELECT household_id INTO h FROM public.profiles WHERE id=p_owner;
  IF h IS NULL THEN RAISE EXCEPTION 'PRIOR_CONNECTION_MEMBER'; END IF;
  IF p_attempt IS NULL OR p_login_key IS NULL OR p_login_key !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'PRIOR_CONNECTION_FORMAT'; END IF;
  DELETE FROM finance_private.prior_connection_attempts WHERE last_started_at < now()-interval '7 days';
  FOREACH key IN ARRAY ARRAY['owner:'||p_owner::text,'login:'||p_login_key] LOOP
    INSERT INTO finance_private.prior_connection_attempts AS current(scope,household_id,owner_id,attempt_id,last_started_at,lease_until)
      VALUES(key,h,p_owner,p_attempt,now(),now()+interval '120 seconds')
    ON CONFLICT(scope) DO UPDATE SET household_id=EXCLUDED.household_id,owner_id=EXCLUDED.owner_id,attempt_id=EXCLUDED.attempt_id,last_started_at=EXCLUDED.last_started_at,lease_until=EXCLUDED.lease_until
      WHERE current.lease_until<=now() AND current.last_started_at<=now()-interval '60 seconds';
    GET DIAGNOSTICS changed=ROW_COUNT;
    IF changed<>1 THEN RAISE EXCEPTION 'PRIOR_CONNECTION_LIMIT'; END IF;
  END LOOP;
END $$;
CREATE OR REPLACE FUNCTION public.release_prior_connection(p_owner UUID,p_attempt UUID)
RETURNS VOID LANGUAGE sql SECURITY DEFINER SET search_path='' SET statement_timeout='5s' AS $$
  UPDATE finance_private.prior_connection_attempts SET lease_until=now() WHERE owner_id=p_owner AND attempt_id=p_attempt;
$$;
REVOKE ALL ON FUNCTION public.claim_prior_connection(UUID,TEXT,UUID),public.release_prior_connection(UUID,UUID) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_prior_connection(UUID,TEXT,UUID),public.release_prior_connection(UUID,UUID) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
