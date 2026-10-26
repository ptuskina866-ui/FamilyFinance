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

-- 17. Remembered Priorbank session (2026-10-19)
-- Remember only encrypted bank sessions, never passwords or Supabase user JWTs.
BEGIN;
CREATE TABLE IF NOT EXISTS finance_private.prior_connections (
  owner_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  household_id UUID NOT NULL REFERENCES public.households(id) ON DELETE CASCADE,
  revision UUID NOT NULL DEFAULT gen_random_uuid(),
  secret_id UUID,
  login_key TEXT CHECK(login_key ~ '^[a-f0-9]{64}$'),
  selected_source TEXT CHECK(selected_source ~ '^[a-f0-9]{64}$'),
  last_success_at TIMESTAMPTZ,
  reauth_required BOOLEAN NOT NULL DEFAULT false,
  preview JSONB,
  CHECK(preview IS NULL OR octet_length(preview::text)<=10000000)
);
CREATE INDEX IF NOT EXISTS prior_connections_household ON finance_private.prior_connections(household_id);
ALTER TABLE finance_private.prior_connections ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON finance_private.prior_connections FROM PUBLIC,anon,authenticated;
DO $$ DECLARE action TEXT;
BEGIN
  FOREACH action IN ARRAY ARRAY['SELECT','DELETE'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON finance_private.prior_connections','prior_connections_'||lower(action));
    EXECUTE format('CREATE POLICY %I ON finance_private.prior_connections FOR %s TO authenticated USING(household_id=(SELECT public.get_my_household_id()) AND owner_id=(SELECT auth.uid()))','prior_connections_'||lower(action),action);
  END LOOP;
  DROP POLICY IF EXISTS prior_connections_insert ON finance_private.prior_connections;
  CREATE POLICY prior_connections_insert ON finance_private.prior_connections FOR INSERT TO authenticated WITH CHECK(household_id=(SELECT public.get_my_household_id()) AND owner_id=(SELECT auth.uid()));
  DROP POLICY IF EXISTS prior_connections_update ON finance_private.prior_connections;
  CREATE POLICY prior_connections_update ON finance_private.prior_connections FOR UPDATE TO authenticated USING(household_id=(SELECT public.get_my_household_id()) AND owner_id=(SELECT auth.uid())) WITH CHECK(household_id=(SELECT public.get_my_household_id()) AND owner_id=(SELECT auth.uid()));
END $$;

CREATE OR REPLACE FUNCTION finance_private.erase_prior_session()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF OLD.secret_id IS NOT NULL AND (TG_OP='DELETE' OR NEW.secret_id IS DISTINCT FROM OLD.secret_id) THEN
    DELETE FROM vault.secrets WHERE id=OLD.secret_id;
  END IF;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION finance_private.erase_prior_session() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS erase_prior_session ON finance_private.prior_connections;
CREATE TRIGGER erase_prior_session AFTER DELETE OR UPDATE OF secret_id ON finance_private.prior_connections FOR EACH ROW EXECUTE FUNCTION finance_private.erase_prior_session();

CREATE OR REPLACE FUNCTION public.prior_connection_state(p_owner UUID,p_action TEXT,p_data JSONB DEFAULT '{}')
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET statement_timeout='8s' AS $$
DECLARE h UUID; c finance_private.prior_connections; secret UUID; s JSONB; preferred TEXT; account UUID; result JSONB;
BEGIN
  SELECT household_id INTO h FROM public.profiles WHERE id=p_owner;
  IF h IS NULL THEN RAISE EXCEPTION 'PRIOR_CONNECTION_MEMBER'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('prior-connection:'||p_owner::text,0));
  INSERT INTO finance_private.prior_connections(owner_id,household_id) VALUES(p_owner,h) ON CONFLICT DO NOTHING;
  SELECT * INTO c FROM finance_private.prior_connections WHERE owner_id=p_owner FOR UPDATE;
  IF c.household_id<>h THEN
    UPDATE finance_private.prior_connections SET household_id=h,revision=gen_random_uuid(),secret_id=NULL,login_key=NULL,selected_source=NULL,last_success_at=NULL,preview=NULL,reauth_required=false WHERE owner_id=p_owner RETURNING * INTO c;
  END IF;
  IF p_action IN ('save','touch','expire') AND (p_data->>'revision') IS DISTINCT FROM c.revision::text THEN RAISE EXCEPTION 'PRIOR_CONNECTION_CHANGED'; END IF;
  IF p_action='save' THEN
    s:=p_data->'session';
    IF jsonb_typeof(s) IS DISTINCT FROM 'object' OR octet_length(s::text)>50000
      OR EXISTS(SELECT 1 FROM jsonb_object_keys(s) k WHERE k NOT IN ('token','client','userSession'))
      OR jsonb_typeof(s->'token') IS DISTINCT FROM 'string' OR length(s->>'token') NOT BETWEEN 1 AND 16000
      OR jsonb_typeof(s->'client') IS DISTINCT FROM 'string' OR length(s->>'client') NOT BETWEEN 1 AND 16000
      OR jsonb_typeof(s->'userSession') IS DISTINCT FROM 'string' OR length(s->>'userSession') NOT BETWEEN 1 AND 16000
      OR coalesce(p_data->>'loginKey','') !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'PRIOR_CONNECTION_FORMAT'; END IF;
    secret:=vault.create_secret(s::text,NULL,'FinApp Priorbank session');
    UPDATE finance_private.prior_connections SET secret_id=secret,login_key=p_data->>'loginKey',revision=gen_random_uuid(),reauth_required=false,preview=p_data->'preview',last_success_at=now() WHERE owner_id=p_owner RETURNING * INTO c;
  ELSIF p_action IN ('disconnect','expire') THEN
    UPDATE finance_private.prior_connections SET secret_id=NULL,login_key=NULL,preview=NULL,last_success_at=NULL,revision=gen_random_uuid(),reauth_required=(p_action='expire') WHERE owner_id=p_owner RETURNING * INTO c;
  ELSIF p_action='touch' THEN
    IF c.secret_id IS NULL THEN RAISE EXCEPTION 'PRIOR_CONNECTION_CHANGED'; END IF;
    UPDATE finance_private.prior_connections SET preview=p_data->'preview',last_success_at=now() WHERE owner_id=p_owner RETURNING * INTO c;
  ELSIF p_action='select' THEN
    IF coalesce(p_data->>'sourceKey','') !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'PRIOR_CONNECTION_FORMAT'; END IF;
    UPDATE finance_private.prior_connections SET selected_source=p_data->>'sourceKey' WHERE owner_id=p_owner RETURNING * INTO c;
  ELSIF p_action NOT IN ('status','load') OR p_action IS NULL THEN RAISE EXCEPTION 'PRIOR_CONNECTION_FORMAT';
  END IF;
  preferred:=c.selected_source;
  IF preferred IS NULL THEN
    SELECT CASE WHEN count(*)=1 THEN min(source_key) END INTO preferred FROM public.prior_import_sources WHERE household_id=h AND owner_id=p_owner;
  END IF;
  SELECT account_id INTO account FROM public.prior_import_sources WHERE household_id=h AND owner_id=p_owner AND source_key=preferred;
  result:=jsonb_build_object('connected',c.secret_id IS NOT NULL,'reauthRequired',c.reauth_required,'lastSyncedAt',c.last_success_at,'selectedSourceKey',preferred,'accountId',account);
  IF p_action='load' THEN
    SELECT decrypted_secret::jsonb INTO s FROM vault.decrypted_secrets WHERE id=c.secret_id;
    RETURN result||jsonb_build_object('revision',c.revision,'loginKey',c.login_key,'session',s,'preview',c.preview,'cacheFresh',c.last_success_at>now()-interval '60 seconds');
  END IF;
  -- Revision is an opaque CAS generation; it contains no bank credentials.
  RETURN result||jsonb_build_object('revision',c.revision);
END $$;
REVOKE ALL ON FUNCTION public.prior_connection_state(UUID,TEXT,JSONB) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.prior_connection_state(UUID,TEXT,JSONB) TO service_role;

-- Retain warning fingerprints after ledger edits/deletions, including across date windows.
ALTER TABLE public.prior_import_days ADD COLUMN IF NOT EXISTS warning_keys TEXT[] NOT NULL DEFAULT '{}';
UPDATE public.prior_import_days d SET warning_keys=coalesce((
  SELECT array_agg(DISTINCT encode(sha256(convert_to(jsonb_build_array(t.comment,CASE WHEN t.type='expense' THEN -t.amount ELSE t.amount END)::text,'UTF8')),'hex'))
  FROM public.transactions t JOIN public.prior_import_sources b ON b.household_id=d.household_id AND b.source_key=d.source_key AND b.owner_id=d.owner_id
  WHERE t.household_id=d.household_id AND t.account_id=b.account_id AND t.date=d.day AND t.kind='cashflow'
),'{}') WHERE warning_keys='{}';

CREATE OR REPLACE FUNCTION finance_private.prepare_prior_import(h UUID, a UUID, s JSONB)
RETURNS JSONB LANGUAGE plpgsql SET search_path='' AS $$
DECLARE r JSONB; c JSONB; rows JSONB; days JSONB; imported JSONB; possible JSONB; source TEXT;
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
  -- Rolling windows retain all receipts; overlapping days still require identical signatures.
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
  SELECT coalesce(jsonb_agg(jsonb_build_object('index',idx,'day',day,'description',description,'amount',amount::text,'key',key,'canonical',canonical,'warningKey',encode(sha256(convert_to(jsonb_build_array(description,amount)::text,'UTF8')),'hex')) ORDER BY idx),'[]'::jsonb) INTO rows FROM keyed;
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
  SELECT coalesce(jsonb_agg((row->>'index')::int),'[]'::jsonb) INTO possible FROM jsonb_array_elements(rows) row
  WHERE EXISTS(SELECT 1 FROM public.prior_import_days old WHERE old.household_id=h AND old.source_key=source AND old.day<>(row->>'day')::date AND abs(old.day-(row->>'day')::date)<=31 AND row->>'warningKey'=ANY(old.warning_keys));
  RETURN jsonb_build_object('rows',rows,'days',days,'source',source,'importedIndexes',imported,
    'possibleIndexes',possible,'linked',EXISTS(SELECT 1 FROM public.prior_import_sources WHERE household_id=h AND source_key=source));
END $$;

CREATE OR REPLACE FUNCTION public.preview_prior_import(p_account_id UUID,p_snapshot JSONB)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET statement_timeout='10s' AS $$
DECLARE h UUID; prepared JSONB;
BEGIN
  h:=public.finance_household_lock();
  prepared:=finance_private.prepare_prior_import(h,p_account_id,p_snapshot);
  RETURN jsonb_build_object('importedIndexes',prepared->'importedIndexes','linked',prepared->'linked','possibleIndexes',prepared->'possibleIndexes');
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
    IF NOT (item->>'confirmExisting')::boolean AND ((prepared->'possibleIndexes') @> jsonb_build_array(idx) OR EXISTS(SELECT 1 FROM public.transactions WHERE household_id=h AND account_id=p_account_id AND kind='cashflow'
      AND date=(row->>'day')::date AND public.transactions.amount=abs(v_amount) AND type=CASE WHEN v_amount<0 THEN 'expense' ELSE 'income' END)) THEN RAISE EXCEPTION 'PRIOR_CONFIRM_EXISTING'; END IF;
    INSERT INTO public.transactions(household_id,added_by,type,amount,category_id,comment,date,kind,account_id)
      VALUES(h,auth.uid(),CASE WHEN v_amount<0 THEN 'expense' ELSE 'income' END,abs(v_amount),item->>'categoryId',row->>'description',(row->>'day')::date,'cashflow',p_account_id);
    SELECT value INTO v_day FROM jsonb_array_elements(prepared->'days') WHERE value->>'day'=row->>'day';
    INSERT INTO public.prior_import_days(household_id,owner_id,source_key,day,signature,imported_keys,warning_keys)
      VALUES(h,auth.uid(),source,(row->>'day')::date,v_day->>'signature',ARRAY[row->>'key'],ARRAY[row->>'warningKey'])
      ON CONFLICT(household_id,source_key,day) DO UPDATE SET imported_keys=array_append(public.prior_import_days.imported_keys,row->>'key'),warning_keys=array_append(public.prior_import_days.warning_keys,row->>'warningKey');
    imported:=imported+1;
  END LOOP;
  RETURN jsonb_build_object('imported',imported,'skipped',skipped);
END $$;
REVOKE ALL ON FUNCTION finance_private.prepare_prior_import(UUID,UUID,JSONB) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.preview_prior_import(UUID,JSONB),public.import_prior_operations(UUID,JSONB,JSONB) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.preview_prior_import(UUID,JSONB),public.import_prior_operations(UUID,JSONB,JSONB) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;

-- 18. Automatic Priorbank accounting (2026-10-23)
-- Explicit owner opt-in; backend jobs never retain passwords or user JWTs.
BEGIN;
ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS import_origin TEXT CHECK(import_origin IS NULL OR import_origin='prior-auto');
CREATE TABLE IF NOT EXISTS public.prior_automation (
  owner_id UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  household_id UUID NOT NULL REFERENCES public.households(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES public.accounts(id),
  source_key TEXT NOT NULL CHECK(source_key ~ '^[a-f0-9]{64}$'),
  enabled BOOLEAN NOT NULL DEFAULT false,
  started_on DATE NOT NULL DEFAULT (now() AT TIME ZONE 'Europe/Minsk')::date,
  revision UUID NOT NULL DEFAULT gen_random_uuid(),
  last_checked_at TIMESTAMPTZ, last_attempt_at TIMESTAMPTZ,
  next_run_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  issue TEXT CHECK(issue IN ('network','bank_limit','reauth','history_changed','gap','account','format')),
  imported_count INT NOT NULL DEFAULT 0 CHECK(imported_count>=0),
  additional_count INT NOT NULL DEFAULT 0 CHECK(additional_count>=0)
);
CREATE INDEX IF NOT EXISTS prior_automation_household ON public.prior_automation(household_id);
CREATE TABLE IF NOT EXISTS public.prior_automation_reviews (
  owner_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  household_id UUID NOT NULL REFERENCES public.households(id) ON DELETE CASCADE,
  source_key TEXT NOT NULL, event_key TEXT NOT NULL,
  day DATE NOT NULL, description TEXT NOT NULL, amount NUMERIC(12,2) NOT NULL,
  reason TEXT NOT NULL CHECK(reason IN ('similar','transfer')), ignored BOOLEAN NOT NULL DEFAULT false,
  PRIMARY KEY(owner_id,source_key,event_key)
);
CREATE INDEX IF NOT EXISTS prior_automation_reviews_household ON public.prior_automation_reviews(household_id);
DO $$ DECLARE tab TEXT; action TEXT;
BEGIN
  FOREACH tab IN ARRAY ARRAY['prior_automation','prior_automation_reviews'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',tab);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated',tab);
    EXECUTE format('GRANT SELECT ON public.%I TO authenticated',tab);
    FOREACH action IN ARRAY ARRAY['SELECT','INSERT','UPDATE','DELETE'] LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I',tab||'_'||lower(action),tab);
      EXECUTE format('CREATE POLICY %I ON public.%I FOR %s TO authenticated %s',tab||'_'||lower(action),tab,action,
        CASE WHEN action='INSERT' THEN 'WITH CHECK(household_id=(SELECT public.get_my_household_id()) AND owner_id=(SELECT auth.uid()))'
        WHEN action='UPDATE' THEN 'USING(household_id=(SELECT public.get_my_household_id()) AND owner_id=(SELECT auth.uid())) WITH CHECK(household_id=(SELECT public.get_my_household_id()) AND owner_id=(SELECT auth.uid()))'
        ELSE 'USING(household_id=(SELECT public.get_my_household_id()) AND owner_id=(SELECT auth.uid()))' END);
    END LOOP;
    IF NOT EXISTS(SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename=tab) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I',tab);
    END IF;
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.set_prior_automation(p_enabled BOOLEAN,p_account_id UUID DEFAULT NULL,p_source_key TEXT DEFAULT NULL)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE h UUID; c finance_private.prior_connections;
BEGIN
  h:=public.finance_household_lock();
  PERFORM pg_advisory_xact_lock(hashtextextended('prior-connection:'||auth.uid()::text,0));
  IF p_enabled IS NULL THEN RAISE EXCEPTION 'PRIOR_AUTO_INPUT'; END IF;
  IF NOT p_enabled THEN
    UPDATE public.prior_automation SET enabled=false,revision=gen_random_uuid() WHERE owner_id=auth.uid() AND household_id=h;
    RETURN;
  END IF;
  SELECT * INTO c FROM finance_private.prior_connections WHERE owner_id=auth.uid() AND household_id=h;
  IF c.secret_id IS NULL THEN RAISE EXCEPTION 'PRIOR_AUTO_SESSION'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.accounts WHERE id=p_account_id AND household_id=h AND kind='bank' AND currency='BYN' AND NOT is_archived)
    OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(c.preview->'cards') s WHERE s->'card'->>'sourceKey'=p_source_key AND s->'card'->>'currency'='BYN') THEN RAISE EXCEPTION 'PRIOR_AUTO_ACCOUNT'; END IF;
  IF EXISTS(SELECT 1 FROM public.prior_import_sources WHERE household_id=h AND ((source_key=p_source_key AND (account_id<>p_account_id OR owner_id<>auth.uid())) OR (account_id=p_account_id AND source_key<>p_source_key))) THEN RAISE EXCEPTION 'PRIOR_SOURCE_BOUND'; END IF;
  IF EXISTS(SELECT 1 FROM public.prior_automation WHERE owner_id=auth.uid() AND (household_id<>h OR source_key<>p_source_key OR account_id<>p_account_id)) THEN RAISE EXCEPTION 'PRIOR_SOURCE_BOUND'; END IF;
  INSERT INTO public.prior_import_sources(household_id,owner_id,source_key,account_id) VALUES(h,auth.uid(),p_source_key,p_account_id) ON CONFLICT DO NOTHING;
  UPDATE finance_private.prior_connections SET selected_source=p_source_key WHERE owner_id=auth.uid();
  INSERT INTO public.prior_automation(owner_id,household_id,account_id,source_key,enabled) VALUES(auth.uid(),h,p_account_id,p_source_key,true)
  ON CONFLICT(owner_id) DO UPDATE SET enabled=true,revision=gen_random_uuid(),next_run_at=now(),issue=NULL;
END $$;
REVOKE ALL ON FUNCTION public.set_prior_automation(BOOLEAN,UUID,TEXT) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.set_prior_automation(BOOLEAN,UUID,TEXT) TO authenticated;

-- Ignoring an exception is explicit and does not create or delete financial entries.
CREATE OR REPLACE FUNCTION public.ignore_prior_automation_review(p_event_key TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'PRIOR_AUTH'; END IF;
  UPDATE public.prior_automation_reviews SET ignored=true WHERE owner_id=auth.uid() AND household_id=public.get_my_household_id() AND event_key=p_event_key;
END $$;
REVOKE ALL ON FUNCTION public.ignore_prior_automation_review(TEXT) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.ignore_prior_automation_review(TEXT) TO authenticated;

CREATE TABLE IF NOT EXISTS finance_private.prior_auto_tickets(token_hash TEXT PRIMARY KEY,expires_at TIMESTAMPTZ NOT NULL);
ALTER TABLE finance_private.prior_auto_tickets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON finance_private.prior_auto_tickets FROM PUBLIC,anon,authenticated;
CREATE OR REPLACE FUNCTION public.claim_prior_auto_job(p_ticket TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE owners JSONB;
BEGIN
  IF coalesce(p_ticket,'') !~ '^[a-f0-9]{64}$' THEN RETURN NULL; END IF;
  DELETE FROM finance_private.prior_auto_tickets WHERE token_hash=encode(sha256(convert_to(p_ticket,'UTF8')),'hex') AND expires_at>now();
  IF NOT FOUND THEN RETURN NULL; END IF;
  WITH due AS (
    SELECT a.owner_id FROM public.prior_automation a
    JOIN public.profiles p ON p.id=a.owner_id AND p.household_id=a.household_id
    JOIN finance_private.prior_connections c ON c.owner_id=a.owner_id AND c.household_id=a.household_id AND c.secret_id IS NOT NULL
    WHERE a.enabled AND a.next_run_at<=now() ORDER BY a.next_run_at LIMIT 2 FOR UPDATE OF a SKIP LOCKED
  ), claimed AS (
    UPDATE public.prior_automation a SET last_attempt_at=now(),next_run_at=now()+interval '5 minutes' FROM due WHERE a.owner_id=due.owner_id RETURNING a.owner_id,a.revision,a.source_key,a.last_checked_at,a.started_on
  ) SELECT coalesce(jsonb_agg(to_jsonb(claimed)),'[]') INTO owners FROM claimed;
  RETURN owners;
END $$;
REVOKE ALL ON FUNCTION public.claim_prior_auto_job(TEXT) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_prior_auto_job(TEXT) TO service_role;

CREATE OR REPLACE FUNCTION finance_private.prepare_prior_automatic(h UUID, a UUID, s JSONB, p_owner UUID)
RETURNS JSONB LANGUAGE plpgsql SET search_path='' AS $$
DECLARE r JSONB; c JSONB; rows JSONB; days JSONB; imported JSONB; possible JSONB; source TEXT;
  d DATE; first_day DATE; last_day DATE; closed_before DATE; today DATE := (now() AT TIME ZONE 'Europe/Minsk')::date;
BEGIN
  IF p_owner IS NULL OR NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=p_owner AND household_id=h) THEN RAISE EXCEPTION 'PRIOR_AUTH'; END IF;
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
  IF EXISTS(SELECT 1 FROM public.prior_import_sources WHERE household_id=h AND source_key=source AND (owner_id<>p_owner OR account_id<>a)) THEN RAISE EXCEPTION 'PRIOR_SOURCE_BOUND'; END IF;
  IF EXISTS(SELECT 1 FROM public.prior_import_sources WHERE household_id=h AND account_id=a AND source_key<>source) THEN RAISE EXCEPTION 'PRIOR_ACCOUNT_BOUND'; END IF;
  -- Rolling windows retain all receipts; automatic jobs verify imported occurrences below.
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
      AND left(value->>'date',10)::date<=least(closed_before,today) AND (value->>'accountAmount')::numeric<>0
  ), keyed AS (
    SELECT *, encode(sha256(convert_to(canonical::text,'UTF8')),'hex')||':'||row_number() OVER(PARTITION BY canonical ORDER BY idx) AS key FROM eligible
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object('index',idx,'day',day,'description',description,'amount',amount::text,'key',key,'canonical',canonical,'warningKey',encode(sha256(convert_to(jsonb_build_array(description,amount)::text,'UTF8')),'hex')) ORDER BY idx),'[]'::jsonb) INTO rows FROM keyed;
  SELECT coalesce(jsonb_agg(jsonb_build_object('day',day,'signature',signature)),'[]'::jsonb) INTO days FROM (
    SELECT day::date::text AS day, encode(sha256(convert_to(coalesce(string_agg((r.value->'canonical')::text,E'\n' ORDER BY (r.value->'canonical')::text),''),'UTF8')),'hex') AS signature
    FROM generate_series(first_day::timestamp,least(last_day,closed_before,today)::timestamp,interval '1 day') day
    LEFT JOIN jsonb_array_elements(rows) r(value) ON r.value->>'day'=day::date::text GROUP BY day
  ) daily;
  -- A changing day may append rows; every previously imported occurrence must remain.
  IF EXISTS(SELECT 1 FROM public.prior_import_days d,unnest(d.imported_keys) k
    WHERE d.household_id=h AND d.source_key=source AND d.day BETWEEN first_day AND last_day
    AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(rows) incoming WHERE incoming->>'key'=k)) THEN RAISE EXCEPTION 'PRIOR_DAY_CHANGED'; END IF;
  SELECT coalesce(jsonb_agg((row->>'index')::int),'[]'::jsonb) INTO imported
    FROM jsonb_array_elements(rows) row JOIN public.prior_import_days receipt
    ON receipt.household_id=h AND receipt.source_key=source AND receipt.day=(row->>'day')::date
    WHERE row->>'key'=ANY(receipt.imported_keys);
  SELECT coalesce(jsonb_agg((row->>'index')::int),'[]'::jsonb) INTO possible FROM jsonb_array_elements(rows) row
  WHERE EXISTS(SELECT 1 FROM public.prior_import_days old WHERE old.household_id=h AND old.source_key=source AND old.day<>(row->>'day')::date AND old.day<first_day AND abs(old.day-(row->>'day')::date)<=31 AND row->>'warningKey'=ANY(old.warning_keys));
  RETURN jsonb_build_object('rows',rows,'days',days,'source',source,'importedIndexes',imported,
    'possibleIndexes',possible,'linked',EXISTS(SELECT 1 FROM public.prior_import_sources WHERE household_id=h AND source_key=source));
END $$;

REVOKE ALL ON FUNCTION finance_private.prepare_prior_automatic(UUID,UUID,JSONB,UUID) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.complete_prior_auto_job(p_owner UUID,p_revision UUID,p_connection_revision UUID,p_snapshot JSONB DEFAULT NULL,p_categories JSONB DEFAULT '[]',p_issue TEXT DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET statement_timeout='15s' AS $$
DECLARE a public.prior_automation; c finance_private.prior_connections; h UUID; prepared JSONB; r JSONB; d JSONB; suggestion JSONB;
  n INT:=0; issue_code TEXT; v_amount NUMERIC; reason TEXT; today DATE:=(now() AT TIME ZONE 'Europe/Minsk')::date;
BEGIN
  SELECT household_id INTO h FROM public.profiles WHERE id=p_owner;
  IF h IS NULL THEN RETURN NULL; END IF;
  PERFORM 1 FROM public.households WHERE id=h FOR UPDATE;
  PERFORM pg_advisory_xact_lock(hashtextextended('prior-connection:'||p_owner::text,0));
  SELECT * INTO a FROM public.prior_automation WHERE owner_id=p_owner AND household_id=h FOR UPDATE;
  SELECT * INTO c FROM finance_private.prior_connections WHERE owner_id=p_owner AND household_id=h;
  IF a.owner_id IS NULL OR NOT a.enabled OR a.revision IS DISTINCT FROM p_revision OR c.revision IS DISTINCT FROM p_connection_revision OR c.secret_id IS NULL THEN RETURN NULL; END IF;
  IF p_issue IS NOT NULL THEN
    IF p_issue NOT IN ('network','bank_limit','reauth','format','account','busy') THEN RAISE EXCEPTION 'PRIOR_AUTO_INPUT'; END IF;
    UPDATE public.prior_automation SET issue=CASE WHEN p_issue='busy' THEN NULL ELSE p_issue END,next_run_at=now()+CASE WHEN p_issue='busy' THEN interval '2 minutes' WHEN p_issue='network' THEN interval '15 minutes' ELSE interval '1 hour' END WHERE owner_id=p_owner;
    RETURN jsonb_build_object('imported',0);
  END IF;
  BEGIN
    IF coalesce((a.last_checked_at AT TIME ZONE 'Europe/Minsk')::date,a.started_on)<today-30 THEN RAISE EXCEPTION 'PRIOR_AUTO_GAP'; END IF;
    IF NOT EXISTS(SELECT 1 FROM public.accounts WHERE id=a.account_id AND household_id=h AND NOT is_archived AND currency='BYN' AND kind='bank') THEN RAISE EXCEPTION 'PRIOR_AUTO_ACCOUNT'; END IF;
    IF p_snapshot->'card'->>'sourceKey' IS DISTINCT FROM a.source_key OR (p_snapshot->>'to')::date NOT BETWEEN today-1 AND today
      OR (p_snapshot->>'from')::date>greatest(a.started_on,today-30)
      OR (p_snapshot->>'fetchedAt')::timestamptz<now()-interval '5 minutes' THEN RAISE EXCEPTION 'PRIOR_AUTO_INPUT'; END IF;
    prepared:=finance_private.prepare_prior_automatic(h,a.account_id,p_snapshot,p_owner);
    IF jsonb_typeof(p_categories) IS DISTINCT FROM 'array' OR jsonb_array_length(p_categories)>2000 THEN RAISE EXCEPTION 'PRIOR_AUTO_INPUT'; END IF;
    FOR r IN SELECT value FROM jsonb_array_elements(prepared->'rows') LOOP
      IF (r->>'day')::date<a.started_on THEN CONTINUE; END IF;
      IF (prepared->'importedIndexes') @> jsonb_build_array((r->>'index')::int) THEN
        DELETE FROM public.prior_automation_reviews WHERE owner_id=p_owner AND source_key=a.source_key AND event_key=r->>'key';
        CONTINUE;
      END IF;
      IF EXISTS(SELECT 1 FROM public.prior_automation_reviews WHERE owner_id=p_owner AND source_key=a.source_key AND event_key=r->>'key' AND ignored) THEN CONTINUE; END IF;
      SELECT value INTO suggestion FROM jsonb_array_elements(p_categories) WHERE value->>'index'=r->>'index';
      IF suggestion IS NULL OR coalesce(suggestion->>'category','') !~ '^[a-z][a-z0-9-]{0,63}$' THEN RAISE EXCEPTION 'PRIOR_AUTO_INPUT'; END IF;
      v_amount:=(r->>'amount')::numeric; reason:=NULL;
      IF suggestion->>'category'='transfer' OR coalesce((suggestion->>'transfer')::boolean,false) THEN reason:='transfer';
      ELSIF (prepared->'possibleIndexes') @> jsonb_build_array((r->>'index')::int) OR EXISTS(
        SELECT 1 FROM public.transactions t WHERE t.household_id=h AND t.account_id=a.account_id AND t.kind='cashflow'
        AND t.import_origin IS DISTINCT FROM 'prior-auto' AND t.date=(r->>'day')::date AND t.amount=abs(v_amount) AND t.type=CASE WHEN v_amount<0 THEN 'expense' ELSE 'income' END
      ) THEN reason:='similar'; END IF;
      IF reason IS NOT NULL THEN
        INSERT INTO public.prior_automation_reviews(owner_id,household_id,source_key,event_key,day,description,amount,reason)
        VALUES(p_owner,h,a.source_key,r->>'key',(r->>'day')::date,r->>'description',v_amount,reason) ON CONFLICT DO NOTHING;
        CONTINUE;
      END IF;
      INSERT INTO public.transactions(household_id,added_by,type,amount,category_id,comment,date,kind,account_id,import_origin)
        VALUES(h,p_owner,CASE WHEN v_amount<0 THEN 'expense' ELSE 'income' END,abs(v_amount),suggestion->>'category',r->>'description',(r->>'day')::date,'cashflow',a.account_id,'prior-auto');
      SELECT value INTO d FROM jsonb_array_elements(prepared->'days') WHERE value->>'day'=r->>'day';
      INSERT INTO public.prior_import_days(household_id,owner_id,source_key,day,signature,imported_keys,warning_keys)
        VALUES(h,p_owner,a.source_key,(r->>'day')::date,d->>'signature',ARRAY[r->>'key'],ARRAY[r->>'warningKey'])
        ON CONFLICT(household_id,source_key,day) DO UPDATE SET signature=d->>'signature',imported_keys=array_append(public.prior_import_days.imported_keys,r->>'key'),warning_keys=array_append(public.prior_import_days.warning_keys,r->>'warningKey');
      n:=n+1;
    END LOOP;
    -- Keep manual review compatible with an append-only bank day, without erasing receipts.
    FOR d IN SELECT value FROM jsonb_array_elements(prepared->'days') LOOP
      UPDATE public.prior_import_days SET signature=d->>'signature' WHERE household_id=h AND source_key=a.source_key AND day=(d->>'day')::date;
    END LOOP;
    DELETE FROM public.prior_automation_reviews v WHERE v.owner_id=p_owner AND v.source_key=a.source_key
      AND v.day BETWEEN (p_snapshot->>'from')::date AND today AND NOT v.ignored
      AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(prepared->'rows') incoming WHERE incoming->>'key'=v.event_key);
    UPDATE public.prior_automation SET last_checked_at=now(),next_run_at=now()+interval '2 minutes',issue=NULL,imported_count=imported_count+n,
      additional_count=(SELECT count(*) FROM jsonb_array_elements(p_snapshot->'card'->'records') incoming WHERE incoming->>'source'='additional') WHERE owner_id=p_owner;
  EXCEPTION WHEN OTHERS THEN
    n:=0;
    issue_code:=CASE SQLERRM WHEN 'PRIOR_DAY_CHANGED' THEN 'history_changed' WHEN 'PRIOR_AUTO_GAP' THEN 'gap' WHEN 'PRIOR_AUTO_ACCOUNT' THEN 'account' ELSE 'format' END;
    UPDATE public.prior_automation SET issue=issue_code,next_run_at='infinity' WHERE owner_id=p_owner;
  END;
  RETURN jsonb_build_object('imported',n,'issue',issue_code);
END $$;
REVOKE ALL ON FUNCTION public.complete_prior_auto_job(UUID,UUID,UUID,JSONB,JSONB,TEXT) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.complete_prior_auto_job(UUID,UUID,UUID,JSONB,JSONB,TEXT) TO service_role;

CREATE OR REPLACE FUNCTION finance_private.guard_prior_automation_connection()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF TG_OP='DELETE' OR NEW.household_id IS DISTINCT FROM OLD.household_id THEN
    DELETE FROM public.prior_automation_reviews WHERE owner_id=OLD.owner_id;
    DELETE FROM public.prior_automation WHERE owner_id=OLD.owner_id;
  ELSIF NEW.secret_id IS NULL THEN
    UPDATE public.prior_automation SET enabled=CASE WHEN NEW.reauth_required THEN enabled ELSE false END,
      issue=CASE WHEN NEW.reauth_required THEN 'reauth' ELSE NULL END,revision=gen_random_uuid(),next_run_at=now() WHERE owner_id=OLD.owner_id;
  ELSIF NEW.secret_id IS DISTINCT FROM OLD.secret_id THEN
    UPDATE public.prior_automation SET issue=NULL,next_run_at=now(),revision=gen_random_uuid() WHERE owner_id=OLD.owner_id;
  END IF;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION finance_private.guard_prior_automation_connection() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS guard_prior_automation_connection ON finance_private.prior_connections;
CREATE TRIGGER guard_prior_automation_connection AFTER UPDATE OF secret_id,household_id OR DELETE ON finance_private.prior_connections FOR EACH ROW EXECUTE FUNCTION finance_private.guard_prior_automation_connection();
NOTIFY pgrst,'reload schema';
COMMIT;

-- 19. Priorbank live accounting (2026-10-25)
-- Priorbank v2. Credentials are separate Vault secrets; all new financial writes are opt-in.
BEGIN;
ALTER TABLE finance_private.prior_connections ADD COLUMN IF NOT EXISTS credential_secret_id UUID;
ALTER TABLE finance_private.prior_connections ADD COLUMN IF NOT EXISTS auth_blocked BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE finance_private.prior_connections ADD COLUMN IF NOT EXISTS last_reauth_at TIMESTAMPTZ;
ALTER TABLE public.prior_automation ADD COLUMN IF NOT EXISTS live_enabled BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE public.prior_automation ADD COLUMN IF NOT EXISTS live_requested BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE public.prior_automation ADD COLUMN IF NOT EXISTS live_probe JSONB;
ALTER TABLE public.prior_automation ADD COLUMN IF NOT EXISTS last_snapshot_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS public.prior_bank_events (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), owner_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
 household_id UUID NOT NULL REFERENCES public.households(id) ON DELETE CASCADE,
 account_id UUID NOT NULL REFERENCES public.accounts(id), source_key TEXT NOT NULL,
 aliases TEXT[] NOT NULL, match_key TEXT NOT NULL,
 state TEXT NOT NULL CHECK(state IN ('provisional','posted','cancelled','needs_review')),
 bank_amount NUMERIC(12,2) NOT NULL, applied_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
 original_amount NUMERIC(12,2), original_currency TEXT NOT NULL,
 day DATE NOT NULL, occurred_at TIMESTAMPTZ NOT NULL, precise_time BOOLEAN NOT NULL,
 description TEXT NOT NULL, transaction_id UUID REFERENCES public.transactions(id) ON DELETE SET NULL,
 suppressed BOOLEAN NOT NULL DEFAULT false, reason TEXT, observed_state TEXT, suggested_category TEXT NOT NULL DEFAULT 'other',
 history JSONB NOT NULL DEFAULT '[]', created_at TIMESTAMPTZ NOT NULL DEFAULT now(), last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 CHECK(source_key ~ '^[a-f0-9]{64}$' AND match_key ~ '^[a-f0-9]{64}$'),
 CHECK(bank_amount::text NOT IN ('NaN','Infinity','-Infinity') AND applied_amount::text NOT IN ('NaN','Infinity','-Infinity'))
);
CREATE INDEX IF NOT EXISTS prior_bank_events_household ON public.prior_bank_events(household_id);
CREATE INDEX IF NOT EXISTS prior_bank_events_owner_match ON public.prior_bank_events(owner_id,source_key,match_key);
CREATE INDEX IF NOT EXISTS prior_bank_events_account ON public.prior_bank_events(account_id);
CREATE UNIQUE INDEX IF NOT EXISTS prior_bank_events_transaction ON public.prior_bank_events(transaction_id) WHERE transaction_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS prior_bank_events_aliases ON public.prior_bank_events USING gin(aliases);
CREATE INDEX IF NOT EXISTS prior_bank_events_owner_amount_day ON public.prior_bank_events(owner_id,source_key,bank_amount,day);
CREATE INDEX IF NOT EXISTS prior_bank_events_owner_time ON public.prior_bank_events(owner_id,source_key,occurred_at);
CREATE INDEX IF NOT EXISTS prior_transaction_candidates ON public.transactions(household_id,account_id,date,amount,type) WHERE kind='cashflow';
ALTER TABLE public.prior_bank_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.prior_bank_events FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.prior_bank_events TO authenticated;
DO $$ DECLARE action TEXT; BEGIN
 FOREACH action IN ARRAY ARRAY['SELECT','INSERT','UPDATE','DELETE'] LOOP
  EXECUTE format('DROP POLICY IF EXISTS %I ON public.prior_bank_events','prior_bank_events_'||lower(action));
  EXECUTE format('CREATE POLICY %I ON public.prior_bank_events FOR %s TO authenticated %s','prior_bank_events_'||lower(action),action,
   CASE WHEN action='INSERT' THEN 'WITH CHECK(household_id=(SELECT public.get_my_household_id()) AND owner_id=(SELECT auth.uid()))'
   WHEN action='UPDATE' THEN 'USING(household_id=(SELECT public.get_my_household_id()) AND owner_id=(SELECT auth.uid())) WITH CHECK(household_id=(SELECT public.get_my_household_id()) AND owner_id=(SELECT auth.uid()))'
   WHEN action='SELECT' THEN 'USING(household_id=(SELECT public.get_my_household_id()))'
   ELSE 'USING(household_id=(SELECT public.get_my_household_id()) AND owner_id=(SELECT auth.uid()))' END);
 END LOOP;
 IF NOT EXISTS(SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='prior_bank_events') THEN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.prior_bank_events;
 END IF;
END $$;

CREATE OR REPLACE FUNCTION finance_private.erase_prior_credentials() RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF OLD.credential_secret_id IS NOT NULL AND (TG_OP='DELETE' OR NEW.credential_secret_id IS DISTINCT FROM OLD.credential_secret_id) THEN
  DELETE FROM vault.secrets WHERE id=OLD.credential_secret_id;
 END IF;
 RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION finance_private.erase_prior_credentials() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS erase_prior_credentials ON finance_private.prior_connections;
CREATE TRIGGER erase_prior_credentials AFTER DELETE OR UPDATE OF credential_secret_id ON finance_private.prior_connections FOR EACH ROW EXECUTE FUNCTION finance_private.erase_prior_credentials();

DO $$ BEGIN
 IF to_regprocedure('finance_private.prior_connection_state_v1(uuid,text,jsonb)') IS NULL THEN
  ALTER FUNCTION public.prior_connection_state(UUID,TEXT,JSONB) SET SCHEMA finance_private;
  ALTER FUNCTION finance_private.prior_connection_state(UUID,TEXT,JSONB) RENAME TO prior_connection_state_v1;
 END IF;
END $$;
REVOKE ALL ON FUNCTION finance_private.prior_connection_state_v1(UUID,TEXT,JSONB) FROM PUBLIC,anon,authenticated,service_role;
CREATE OR REPLACE FUNCTION public.prior_connection_state(p_owner UUID,p_action TEXT,p_data JSONB DEFAULT '{}') RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET statement_timeout='8s' AS $$
DECLARE c finance_private.prior_connections; h UUID; result JSONB; credentials JSONB; secret UUID; action TEXT:=p_action;
BEGIN
 SELECT household_id INTO h FROM public.profiles WHERE id=p_owner;
 IF h IS NULL THEN RAISE EXCEPTION 'PRIOR_CONNECTION_MEMBER'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('prior-connection:'||p_owner::text,0));
 SELECT * INTO c FROM finance_private.prior_connections WHERE owner_id=p_owner FOR UPDATE;
 IF c.household_id IS DISTINCT FROM h AND c.owner_id IS NOT NULL THEN
  UPDATE finance_private.prior_connections SET credential_secret_id=NULL,auth_blocked=false,last_reauth_at=NULL WHERE owner_id=p_owner;
 END IF;
 IF p_action='request' THEN
  UPDATE public.prior_automation SET next_run_at=least(next_run_at,greatest(now(),coalesce(last_attempt_at,'-infinity')+interval '60 seconds')) WHERE owner_id=p_owner AND household_id=h AND enabled AND issue IS NULL;
  RETURN '{}'::jsonb;
 END IF;
 IF p_action IN ('reauth','auth_failed','rotate') THEN
  IF c.revision::text IS DISTINCT FROM p_data->>'revision' OR c.household_id IS DISTINCT FROM h THEN RAISE EXCEPTION 'PRIOR_CONNECTION_CHANGED'; END IF;
  IF p_action='reauth' THEN
   IF c.credential_secret_id IS NULL OR c.auth_blocked OR c.last_reauth_at>now()-interval '10 minutes' THEN RETURN '{}'::jsonb; END IF;
   -- Only an already-held owner/login lease can obtain credentials for one renewal attempt.
   IF NOT EXISTS(SELECT 1 FROM finance_private.prior_connection_attempts WHERE owner_id=p_owner AND attempt_id=(p_data->>'attempt')::uuid AND lease_until>now() AND scope='owner:'||p_owner::text) THEN RAISE EXCEPTION 'PRIOR_CONNECTION_CHANGED'; END IF;
   UPDATE finance_private.prior_connections SET last_reauth_at=now() WHERE owner_id=p_owner;
   SELECT decrypted_secret::jsonb INTO credentials FROM vault.decrypted_secrets WHERE id=c.credential_secret_id;
   RETURN jsonb_build_object('credentials',credentials);
  ELSIF p_action='auth_failed' THEN
   UPDATE finance_private.prior_connections SET auth_blocked=true WHERE owner_id=p_owner;
   RETURN '{}'::jsonb;
  END IF;
  action:='save';
 ELSIF p_action='save_auto' THEN
  credentials:=p_data->'credentials';
  IF jsonb_typeof(credentials) IS DISTINCT FROM 'object' OR EXISTS(SELECT 1 FROM jsonb_object_keys(credentials) k WHERE k NOT IN ('login','password'))
   OR coalesce(length(credentials->>'login'),0) NOT BETWEEN 1 AND 128 OR coalesce(length(credentials->>'password'),0) NOT BETWEEN 1 AND 16
   OR jsonb_typeof(credentials->'login') IS DISTINCT FROM 'string' OR jsonb_typeof(credentials->'password') IS DISTINCT FROM 'string'
   OR credentials->>'login' ~ '[[:cntrl:]]' OR credentials->>'password' ~ '[[:cntrl:]]' THEN RAISE EXCEPTION 'PRIOR_CONNECTION_FORMAT'; END IF;
  action:='save';
 END IF;
 result:=finance_private.prior_connection_state_v1(p_owner,action,p_data-'credentials');
 IF p_action='save_auto' THEN
  secret:=vault.create_secret(credentials::text,NULL,'FinApp Priorbank automatic login');
  UPDATE finance_private.prior_connections SET credential_secret_id=secret,auth_blocked=false,last_reauth_at=NULL WHERE owner_id=p_owner;
 ELSIF p_action IN ('save','disconnect') THEN
  UPDATE finance_private.prior_connections SET credential_secret_id=NULL,auth_blocked=false,last_reauth_at=NULL WHERE owner_id=p_owner;
 ELSIF p_action='expire' AND c.credential_secret_id IS NOT NULL THEN
  UPDATE finance_private.prior_connections SET login_key=c.login_key,preview=c.preview WHERE owner_id=p_owner;
  IF NOT c.auth_blocked THEN UPDATE public.prior_automation SET issue='network',next_run_at=now()+interval '15 minutes' WHERE owner_id=p_owner AND household_id=h AND enabled; END IF;
 END IF;
 SELECT * INTO c FROM finance_private.prior_connections WHERE owner_id=p_owner;
 -- These fields are service-only. Legacy public envelopes still use an explicit whitelist.
 RETURN result||jsonb_build_object('autoReconnect',c.credential_secret_id IS NOT NULL AND NOT c.auth_blocked,
   'liveEnabled',coalesce((SELECT enabled AND live_enabled FROM public.prior_automation WHERE owner_id=p_owner AND household_id=h),false),
   'liveRequested',coalesce((SELECT enabled AND live_requested FROM public.prior_automation WHERE owner_id=p_owner AND household_id=h),false),
   'liveReady',coalesce((SELECT live_probe->>'valid'='true' FROM public.prior_automation WHERE owner_id=p_owner AND household_id=h),false),
   'automationRevision',(SELECT revision FROM public.prior_automation WHERE owner_id=p_owner AND household_id=h));
END $$;
REVOKE ALL ON FUNCTION public.prior_connection_state(UUID,TEXT,JSONB) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.prior_connection_state(UUID,TEXT,JSONB) TO service_role;

-- Readiness is explicit; existing enabled users are migrated only after a successful shadow probe.
CREATE OR REPLACE FUNCTION public.set_prior_live(p_enabled BOOLEAN) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE h UUID;
BEGIN
 h:=public.finance_household_lock();
 PERFORM pg_advisory_xact_lock(hashtextextended('prior-connection:'||auth.uid()::text,0));
 IF p_enabled IS NULL OR NOT EXISTS(SELECT 1 FROM public.prior_automation WHERE owner_id=auth.uid() AND household_id=h AND enabled) THEN RAISE EXCEPTION 'PRIOR_AUTO_SESSION'; END IF;
 UPDATE public.prior_automation SET live_requested=p_enabled,live_enabled=p_enabled AND coalesce(live_probe->>'valid'='true',false),revision=gen_random_uuid(),next_run_at=now(),issue=NULL WHERE owner_id=auth.uid() AND household_id=h;
END $$;
REVOKE ALL ON FUNCTION public.set_prior_live(BOOLEAN) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.set_prior_live(BOOLEAN) TO authenticated;

CREATE OR REPLACE FUNCTION public.request_prior_sync() RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE h UUID;
BEGIN
 h:=public.finance_household_lock();
 UPDATE public.prior_automation SET next_run_at=least(next_run_at,greatest(now(),coalesce(last_attempt_at,'-infinity')+interval '60 seconds'))
 WHERE owner_id=auth.uid() AND household_id=h AND enabled AND issue IS NULL;
END $$;
REVOKE ALL ON FUNCTION public.request_prior_sync() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.request_prior_sync() TO authenticated;

CREATE OR REPLACE FUNCTION finance_private.prior_event_deleted() RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 UPDATE public.prior_bank_events SET suppressed=true WHERE transaction_id=OLD.id AND household_id=OLD.household_id;
 RETURN OLD;
END $$;
REVOKE ALL ON FUNCTION finance_private.prior_event_deleted() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS prior_event_deleted ON public.transactions;
CREATE TRIGGER prior_event_deleted BEFORE DELETE ON public.transactions FOR EACH ROW EXECUTE FUNCTION finance_private.prior_event_deleted();

-- Only the trusted reconciler may give an explicitly cancelled event a zero ledger effect.
DO $$ DECLARE body TEXT; needle TEXT:='IF NEW.amount <= 0 OR NEW.amount::text IN (''NaN'', ''Infinity'', ''-Infinity'') THEN RAISE EXCEPTION ''Transaction amount must be finite and positive''; END IF;'; BEGIN
 body:=pg_get_functiondef('public.guard_finance_write()'::regprocedure);
 IF position(needle IN body)>0 THEN
  body:=replace(body,needle,'IF (NEW.amount <= 0 AND NOT (v_privileged AND NEW.amount=0 AND EXISTS(SELECT 1 FROM public.prior_bank_events e WHERE e.transaction_id=NEW.id AND e.household_id=NEW.household_id AND e.state=''cancelled''))) OR NEW.amount::text IN (''NaN'',''Infinity'',''-Infinity'') THEN RAISE EXCEPTION ''Transaction amount must be finite and positive''; END IF;');
  EXECUTE body;
 ELSIF position('prior_bank_events' IN body)=0 THEN RAISE EXCEPTION 'PRIOR_GUARD_CHANGED'; END IF;
END $$;

CREATE OR REPLACE FUNCTION finance_private.prior_live_receipt(h UUID,p_owner UUID,source TEXT,r JSONB) RETURNS VOID LANGUAGE plpgsql SET search_path='' AS $$
DECLARE receipt TEXT:=r->>'legacyKey'; warning TEXT;
BEGIN
 IF r->>'source'<>'history' OR receipt IS NULL THEN RETURN; END IF;
 warning:=encode(sha256(convert_to(jsonb_build_array(r->'legacy'->>'description',(r->'legacy'->>'accountAmount')::numeric)::text,'UTF8')),'hex');
 INSERT INTO public.prior_import_days(household_id,owner_id,source_key,day,signature,imported_keys,warning_keys)
  VALUES(h,p_owner,source,(r->>'day')::date,repeat('0',64),ARRAY[receipt],ARRAY[warning])
  ON CONFLICT(household_id,source_key,day) DO UPDATE SET imported_keys=CASE WHEN receipt=ANY(public.prior_import_days.imported_keys) THEN public.prior_import_days.imported_keys ELSE array_append(public.prior_import_days.imported_keys,receipt) END,
   warning_keys=CASE WHEN warning=ANY(public.prior_import_days.warning_keys) THEN public.prior_import_days.warning_keys ELSE array_append(public.prior_import_days.warning_keys,warning) END;
END $$;
REVOKE ALL ON FUNCTION finance_private.prior_live_receipt(UUID,UUID,TEXT,JSONB) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.complete_prior_live_job(p_owner UUID,p_revision UUID,p_connection_revision UUID,p_snapshot JSONB,p_shadow BOOLEAN DEFAULT false)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET statement_timeout='20s' AS $$
#variable_conflict use_variable
DECLARE a public.prior_automation; c finance_private.prior_connections; h UUID; r JSONB; rows JSONB; e public.prior_bank_events;
 t public.transactions; amount NUMERIC; effect NUMERIC; reason TEXT; phase TEXT; old_phase TEXT;
 n INT:=0; changed INT:=0; candidates INT; matched UUID[]:='{}'; source_kind TEXT:=''; entry UUID;
 legacy_key TEXT; day_signature TEXT; day_row RECORD; old_amount NUMERIC; reversal_description TEXT;
BEGIN
 SELECT household_id INTO h FROM public.profiles WHERE id=p_owner;
 IF h IS NULL THEN RETURN NULL; END IF;
 PERFORM 1 FROM public.households WHERE id=h FOR UPDATE;
 PERFORM pg_advisory_xact_lock(hashtextextended('prior-connection:'||p_owner::text,0));
 SELECT * INTO a FROM public.prior_automation WHERE owner_id=p_owner AND household_id=h FOR UPDATE;
 SELECT * INTO c FROM finance_private.prior_connections WHERE owner_id=p_owner AND household_id=h;
 IF a.owner_id IS NULL OR NOT a.enabled OR a.revision IS DISTINCT FROM p_revision OR c.revision IS DISTINCT FROM p_connection_revision OR c.secret_id IS NULL THEN RETURN NULL; END IF;
 IF jsonb_typeof(p_snapshot) IS DISTINCT FROM 'object' OR octet_length(p_snapshot::text)>12000000 OR p_snapshot->'version' IS DISTINCT FROM '2'::jsonb
  OR p_snapshot->>'sourceKey' IS DISTINCT FROM a.source_key OR jsonb_typeof(p_snapshot->'records') IS DISTINCT FROM 'array' OR jsonb_array_length(p_snapshot->'records')>2000
  OR (p_snapshot->>'fetchedAt')::timestamptz NOT BETWEEN now()-interval '5 minutes' AND now()+interval '1 minute'
  OR (p_snapshot->>'to')::date<>(now() AT TIME ZONE 'Europe/Minsk')::date OR (p_snapshot->>'to')::date-(p_snapshot->>'from')::date NOT BETWEEN 0 AND 30 THEN RAISE EXCEPTION 'PRIOR_LIVE_INPUT'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.accounts WHERE id=a.account_id AND household_id=h AND kind='bank' AND currency='BYN' AND NOT is_archived) THEN RAISE EXCEPTION 'PRIOR_LIVE_ACCOUNT'; END IF;
 IF NOT p_shadow AND a.last_snapshot_at>(p_snapshot->>'fetchedAt')::timestamptz THEN RETURN jsonb_build_object('imported',0,'stale',true); END IF;
 FOR r IN SELECT value FROM jsonb_array_elements(p_snapshot->'records') LOOP
  IF coalesce(r->>'key','') !~ '^[a-f0-9]{64}:[1-9][0-9]{0,3}$' OR coalesce(r->>'matchKey','') !~ '^[a-f0-9]{64}$'
   OR coalesce(r->>'amount','') !~ '^-?(0|[1-9][0-9]{0,9})\.[0-9]{2}$' OR coalesce(r->>'day','') !~ '^\d{4}-\d{2}-\d{2}$'
   OR coalesce(r->>'description','')='' OR length(r->>'description')>4000 OR coalesce(r->>'originalCurrency','') !~ '^[A-Z]{3}$'
   OR coalesce(r->>'state','') NOT IN ('provisional','posted','cancelled','needs_review') OR coalesce(r->>'source','') NOT IN ('history','additional')
   OR coalesce(r->>'category','') !~ '^[a-z][a-z0-9-]{0,63}$' OR jsonb_typeof(r->'preciseTime') IS DISTINCT FROM 'boolean'
   OR jsonb_typeof(r->'transfer') IS DISTINCT FROM 'boolean' OR jsonb_typeof(r->'legacy') IS DISTINCT FROM 'object'
   OR (r->>'occurredAt')::timestamptz IS NULL OR ((r->>'occurredAt')::timestamptz AT TIME ZONE 'Europe/Minsk')::date<>(r->>'day')::date
   OR (r->'originalAmount'<>'null'::jsonb AND coalesce(r->>'originalAmount','') !~ '^-?(0|[1-9][0-9]{0,9})\.[0-9]{2}$') THEN RAISE EXCEPTION 'PRIOR_LIVE_ROW'; END IF;
  IF r->>'state'<>'cancelled' AND ((r->>'source'='history' AND (r->>'amount')::numeric IS DISTINCT FROM (r->'legacy'->>'accountAmount')::numeric)
   OR (r->>'source'='additional' AND (r->>'amount')::numeric IS DISTINCT FROM -(r->'legacy'->>'operationAmount')::numeric)) THEN RAISE EXCEPTION 'PRIOR_LIVE_SIGN'; END IF;
 END LOOP;
 -- Legacy receipt hashes stay byte-compatible with the SQL NUMERIC canonical representation.
 WITH canonical AS (
  SELECT value AS row,ordinality AS ord,CASE WHEN value->>'source'='history' THEN jsonb_build_array(value->'legacy'->>'date',value->'legacy'->>'description',
   (value->'legacy'->>'accountAmount')::numeric,(value->'legacy'->>'operationAmount')::numeric,value->'legacy'->>'operationCurrency',(value->'legacy'->>'fee')::numeric) END AS canon
  FROM jsonb_array_elements(p_snapshot->'records') WITH ORDINALITY
 ), keyed AS (
  SELECT *,encode(sha256(convert_to(canon::text,'UTF8')),'hex')||':'||row_number() OVER(PARTITION BY canon ORDER BY ord) AS receipt FROM canonical
 ) SELECT coalesce(jsonb_agg(row||jsonb_build_object('legacyKey',receipt,'canonical',canon) ORDER BY CASE WHEN row->>'source'='history' THEN 0 ELSE 1 END,ord),'[]') INTO rows FROM keyed;
 -- Shadow matching runs against actual household receipts and manual rows without creating events or money.
 UPDATE public.prior_automation SET live_probe=jsonb_build_object('valid',true,'at',now(),'records',jsonb_array_length(rows),
  'additional',(SELECT count(*) FROM jsonb_array_elements(rows) v WHERE v->>'source'='additional'),
  'timed',(SELECT count(*) FROM jsonb_array_elements(rows) v WHERE v->>'preciseTime'='true'),
  'manualMatches',(SELECT count(*) FROM jsonb_array_elements(rows) v WHERE EXISTS(SELECT 1 FROM public.transactions tx WHERE tx.household_id=h AND tx.account_id=a.account_id AND tx.kind='cashflow'
   AND tx.import_origin IS DISTINCT FROM 'prior-auto' AND tx.date=(v->>'day')::date AND tx.amount=abs((v->>'amount')::numeric) AND tx.type=CASE WHEN (v->>'amount')::numeric<0 THEN 'expense' ELSE 'income' END)),
  'receiptMatches',(SELECT count(*) FROM jsonb_array_elements(rows) v WHERE v->>'source'='history' AND EXISTS(SELECT 1 FROM public.prior_import_days d WHERE d.household_id=h AND d.source_key=a.source_key AND v->>'legacyKey'=ANY(d.imported_keys))),
  'overlapPairs',(SELECT coalesce(sum(least(posted,early)),0) FROM (SELECT count(*) FILTER(WHERE v->>'source'='history') posted,count(*) FILTER(WHERE v->>'source'='additional') early FROM jsonb_array_elements(rows) v GROUP BY v->>'matchKey',v->>'amount') pairs)) WHERE owner_id=p_owner;
 IF p_shadow OR NOT a.live_enabled THEN
  IF a.live_requested THEN UPDATE public.prior_automation SET live_enabled=true,revision=gen_random_uuid(),next_run_at=now() WHERE owner_id=p_owner AND household_id=h AND enabled; END IF;
  RETURN jsonb_build_object('imported',0,'shadow',true);
 END IF;
 IF coalesce((a.last_checked_at AT TIME ZONE 'Europe/Minsk')::date,a.started_on)<(now() AT TIME ZONE 'Europe/Minsk')::date-30 THEN RAISE EXCEPTION 'PRIOR_LIVE_GAP'; END IF;
 FOR r IN SELECT value FROM jsonb_array_elements(rows) LOOP
  IF (r->>'day')::date NOT BETWEEN greatest(a.started_on,(p_snapshot->>'from')::date) AND (p_snapshot->>'to')::date THEN CONTINUE; END IF;
  IF source_kind<>r->>'source' THEN matched:='{}';source_kind:=r->>'source'; END IF;
  amount:=(r->>'amount')::numeric;phase:=r->>'state';reason:=NULL;legacy_key:=r->>'legacyKey';entry:=NULL;
  SELECT * INTO e FROM public.prior_bank_events WHERE owner_id=p_owner AND household_id=h AND source_key=a.source_key AND aliases @> ARRAY[r->>'key'] LIMIT 1 FOR UPDATE;
  -- A bank-labelled full reversal may cancel one uniquely identified purchase. Multiple
  -- matching purchases remain for review; an ordinary credit/refund is never guessed.
  IF e.id IS NULL AND r->>'source'='history' AND amount>0 AND r->>'description' ~* '^Reversal[.]\s+Retail\s' THEN
   reversal_description:=lower(regexp_replace(btrim(regexp_replace(r->>'description','^Reversal[.]\s+','','i')),'\s+',' ','g'));
   SELECT count(*) INTO candidates FROM public.prior_bank_events old WHERE old.owner_id=p_owner AND old.household_id=h AND old.source_key=a.source_key
    AND old.bank_amount=-amount AND old.original_currency=r->>'originalCurrency' AND old.state IN ('provisional','posted') AND NOT old.suppressed
    AND lower(regexp_replace(btrim(old.description),'\s+',' ','g'))=reversal_description AND (r->>'day')::date-old.day BETWEEN 0 AND 30;
   IF candidates=1 THEN
    SELECT * INTO e FROM public.prior_bank_events old WHERE old.owner_id=p_owner AND old.household_id=h AND old.source_key=a.source_key
     AND old.bank_amount=-amount AND old.original_currency=r->>'originalCurrency' AND old.state IN ('provisional','posted') AND NOT old.suppressed
     AND lower(regexp_replace(btrim(old.description),'\s+',' ','g'))=reversal_description AND (r->>'day')::date-old.day BETWEEN 0 AND 30 LIMIT 1 FOR UPDATE;
    amount:=e.bank_amount;phase:='cancelled';
   ELSIF candidates>1 THEN reason:='ambiguous'; END IF;
  END IF;
  IF e.id IS NULL THEN
   -- Exact amounts pair identical occurrences one-to-one, including overlap of the two lists.
   SELECT * INTO e FROM public.prior_bank_events WHERE owner_id=p_owner AND household_id=h AND source_key=a.source_key AND match_key=r->>'matchKey'
    AND bank_amount=amount AND NOT(id=ANY(matched)) AND state<>'cancelled' ORDER BY created_at,id LIMIT 1 FOR UPDATE;
   IF e.id IS NULL THEN
    SELECT count(*) INTO candidates FROM public.prior_bank_events WHERE owner_id=p_owner AND household_id=h AND source_key=a.source_key AND match_key=r->>'matchKey' AND NOT(id=ANY(matched)) AND (state IN ('provisional','posted') OR suppressed);
    IF candidates=1 AND r->>'preciseTime'='true' THEN
     SELECT * INTO e FROM public.prior_bank_events WHERE owner_id=p_owner AND household_id=h AND source_key=a.source_key AND match_key=r->>'matchKey' AND NOT(id=ANY(matched)) AND (state IN ('provisional','posted') OR suppressed) LIMIT 1 FOR UPDATE;
    ELSIF candidates>0 THEN reason:='ambiguous'; END IF;
   END IF;
  END IF;
  IF e.id IS NOT NULL AND ((r->>'source'='additional' AND e.state='posted') OR(e.state='cancelled' AND phase<>'cancelled')) THEN
   UPDATE public.prior_bank_events SET aliases=CASE WHEN r->>'key'=ANY(aliases) THEN aliases ELSE array_append(aliases,r->>'key') END,last_seen_at=now() WHERE id=e.id;
   IF r->>'source'='history' THEN PERFORM finance_private.prior_live_receipt(h,p_owner,a.source_key,r); END IF;
   matched:=array_append(matched,e.id);CONTINUE;
  END IF;
  IF e.id IS NULL THEN
   IF phase='cancelled' THEN reason:='ambiguous'; END IF;
   IF r->>'transfer'='true' OR r->>'category'='transfer' THEN reason:='transfer'; END IF;
   IF phase='needs_review' THEN reason:=coalesce(reason,'format'); END IF;
   IF reason IS NULL AND EXISTS(SELECT 1 FROM public.prior_bank_events old WHERE old.owner_id=p_owner AND old.household_id=h AND old.source_key=a.source_key
    AND old.state='provisional' AND NOT old.suppressed AND old.bank_amount=amount AND abs(old.day-(r->>'day')::date)<=3
    AND NOT(old.match_key=r->>'matchKey' AND old.id=ANY(matched))
    AND (NOT old.precise_time OR r->>'preciseTime'='false' OR to_char(old.occurred_at AT TIME ZONE 'Europe/Minsk','HH24:MI:SS')=to_char((r->>'occurredAt')::timestamptz AT TIME ZONE 'Europe/Minsk','HH24:MI:SS'))) THEN reason:='ambiguous'; END IF;
   IF reason IS NULL AND EXISTS(SELECT 1 FROM public.prior_bank_events old WHERE old.owner_id=p_owner AND old.household_id=h AND old.source_key=a.source_key
    AND old.precise_time AND r->>'preciseTime'='true' AND old.occurred_at=(r->>'occurredAt')::timestamptz AND old.match_key<>r->>'matchKey'
    AND sign(old.bank_amount)=sign(amount) AND old.original_currency=r->>'originalCurrency') THEN reason:='ambiguous'; END IF;
   IF reason IS NULL AND EXISTS(SELECT 1 FROM public.transactions tx WHERE tx.household_id=h AND tx.account_id=a.account_id AND tx.kind='cashflow'
    AND tx.date=(r->>'day')::date AND tx.amount=abs(amount) AND tx.type=CASE WHEN amount<0 THEN 'expense' ELSE 'income' END
    AND NOT EXISTS(SELECT 1 FROM public.prior_bank_events old WHERE old.transaction_id=tx.id)) THEN reason:='similar'; END IF;
   INSERT INTO public.prior_bank_events(owner_id,household_id,account_id,source_key,aliases,match_key,state,bank_amount,original_amount,original_currency,day,occurred_at,precise_time,description,reason,observed_state,suggested_category)
    VALUES(p_owner,h,a.account_id,a.source_key,ARRAY[r->>'key'],r->>'matchKey',CASE WHEN reason IS NULL THEN phase ELSE 'needs_review' END,amount,(r->>'originalAmount')::numeric,r->>'originalCurrency',(r->>'day')::date,(r->>'occurredAt')::timestamptz,(r->>'preciseTime')::boolean,r->>'description',reason,phase,r->>'category') RETURNING * INTO e;
   IF r->>'source'='history' AND EXISTS(SELECT 1 FROM public.prior_import_days d WHERE d.household_id=h AND d.source_key=a.source_key AND d.day=(r->>'day')::date AND legacy_key=ANY(d.imported_keys)) THEN
    -- Preserve old receipts, including a user's deliberate deletion; never backfill old money.
    UPDATE public.prior_bank_events SET suppressed=true,state='posted',reason='legacy_receipt' WHERE id=e.id RETURNING * INTO e;
    -- Link a receipt to its unique, unchanged automatic row; a deleted, manually entered
    -- or ambiguous row remains a tombstone. This prevents an old row shadowing a new purchase.
    SELECT count(*) INTO candidates FROM public.transactions tx WHERE tx.household_id=h AND tx.account_id=a.account_id AND tx.kind='cashflow' AND tx.import_origin='prior-auto'
     AND tx.amount=abs(amount) AND tx.type=CASE WHEN amount<0 THEN 'expense' ELSE 'income' END AND tx.date=(r->>'day')::date AND tx.comment=r->>'description'
     AND NOT EXISTS(SELECT 1 FROM public.prior_bank_events mapped WHERE mapped.transaction_id=tx.id);
    IF candidates=1 THEN
     SELECT tx.id INTO entry FROM public.transactions tx WHERE tx.household_id=h AND tx.account_id=a.account_id AND tx.kind='cashflow' AND tx.import_origin='prior-auto'
      AND tx.amount=abs(amount) AND tx.type=CASE WHEN amount<0 THEN 'expense' ELSE 'income' END AND tx.date=(r->>'day')::date AND tx.comment=r->>'description'
      AND NOT EXISTS(SELECT 1 FROM public.prior_bank_events mapped WHERE mapped.transaction_id=tx.id) LIMIT 1 FOR UPDATE;
     UPDATE public.prior_bank_events SET transaction_id=entry,applied_amount=amount,suppressed=false,reason=NULL WHERE id=e.id RETURNING * INTO e;
    END IF;
   END IF;
  END IF;
  matched:=array_append(matched,e.id);old_phase:=e.state;old_amount:=e.bank_amount;
  IF e.suppressed THEN
   UPDATE public.prior_bank_events SET aliases=CASE WHEN r->>'key'=ANY(aliases) THEN aliases ELSE array_append(aliases,r->>'key') END,last_seen_at=now() WHERE id=e.id;
   IF r->>'source'='history' THEN PERFORM finance_private.prior_live_receipt(h,p_owner,a.source_key,r); END IF;
   CONTINUE;
  END IF;
  IF e.state='needs_review' THEN reason:=e.reason; END IF;
  IF phase='needs_review' THEN reason:=coalesce(reason,'format'); END IF;
  effect:=CASE WHEN phase='cancelled' THEN 0 ELSE amount END;
  IF e.transaction_id IS NOT NULL THEN
   SELECT * INTO t FROM public.transactions WHERE id=e.transaction_id AND household_id=h FOR UPDATE;
   IF t.id IS NULL THEN
    UPDATE public.prior_bank_events SET suppressed=true,transaction_id=NULL WHERE id=e.id;CONTINUE;
   END IF;
   IF t.account_id IS DISTINCT FROM a.account_id OR t.kind<>'cashflow' OR t.import_origin IS DISTINCT FROM 'prior-auto'
    OR t.amount IS DISTINCT FROM abs(e.applied_amount) OR t.type IS DISTINCT FROM (CASE WHEN e.applied_amount<0 OR(e.applied_amount=0 AND e.bank_amount<0) THEN 'expense' ELSE 'income' END) OR t.date IS DISTINCT FROM e.day THEN reason:='edited'; END IF;
  END IF;
  IF reason IS NULL THEN
   -- Set state before zeroing the projection, so the finance trigger can verify cancellation.
   UPDATE public.prior_bank_events SET state=phase WHERE id=e.id;
   IF e.transaction_id IS NULL AND effect<>0 THEN
    INSERT INTO public.transactions(household_id,added_by,type,amount,category_id,comment,date,kind,account_id,import_origin)
     VALUES(h,p_owner,CASE WHEN effect<0 THEN 'expense' ELSE 'income' END,abs(effect),r->>'category',r->>'description',(r->>'day')::date,'cashflow',a.account_id,'prior-auto') RETURNING id INTO entry;
    n:=n+1;
   ELSIF e.transaction_id IS NOT NULL THEN
    entry:=e.transaction_id;
    UPDATE public.transactions SET amount=abs(effect),type=CASE WHEN effect=0 THEN type WHEN effect<0 THEN 'expense' ELSE 'income' END,date=CASE WHEN phase='cancelled' THEN e.day ELSE (r->>'day')::date END WHERE id=entry;
   END IF;
   IF e.applied_amount IS DISTINCT FROM effect OR old_phase IS DISTINCT FROM phase THEN changed:=changed+1; END IF;
  END IF;
  UPDATE public.prior_bank_events SET aliases=CASE WHEN r->>'key'=ANY(aliases) THEN aliases ELSE array_append(aliases,r->>'key') END,
   state=CASE WHEN reason IS NULL THEN phase ELSE 'needs_review' END,observed_state=phase,bank_amount=amount,
   applied_amount=CASE WHEN reason IS NULL THEN effect ELSE applied_amount END,transaction_id=coalesce(entry,transaction_id),
   original_amount=CASE WHEN phase='cancelled' THEN original_amount ELSE (r->>'originalAmount')::numeric END,original_currency=r->>'originalCurrency',reason=reason,
   day=CASE WHEN reason IS NULL AND phase<>'cancelled' THEN (r->>'day')::date ELSE day END,last_seen_at=now(),
   history=CASE WHEN old_amount IS DISTINCT FROM amount OR old_phase IS DISTINCT FROM phase THEN history||jsonb_build_array(jsonb_build_object('at',now(),'fromState',old_phase,'toState',phase,'oldAmount',old_amount::text,'amount',amount::text,'reason',reason,'observation',r->'legacy')) ELSE history END
   WHERE id=e.id RETURNING * INTO e;
  -- The old reviewed import must also see the settled alias as already accounted for.
  IF r->>'source'='history' AND (e.transaction_id IS NOT NULL OR e.suppressed) AND amount<>0 THEN
   PERFORM finance_private.prior_live_receipt(h,p_owner,a.source_key,r);
  END IF;
 END LOOP;
 FOR day_row IN SELECT d::date AS day FROM generate_series((p_snapshot->>'from')::timestamp,(p_snapshot->>'to')::timestamp,interval '1 day') d LOOP
  SELECT encode(sha256(convert_to(coalesce(string_agg((v->'canonical')::text,E'\n' ORDER BY (v->'canonical')::text),''),'UTF8')),'hex') INTO day_signature FROM jsonb_array_elements(rows) v WHERE v->>'source'='history' AND v->>'day'=day_row.day::text;
  UPDATE public.prior_import_days d SET signature=day_signature WHERE d.household_id=h AND d.source_key=a.source_key AND d.day=day_row.day;
 END LOOP;
 UPDATE public.prior_automation SET last_checked_at=now(),last_snapshot_at=(p_snapshot->>'fetchedAt')::timestamptz,next_run_at=date_trunc('minute',now())+interval '1 minute',issue=NULL,imported_count=imported_count+n,
  additional_count=(SELECT count(*) FROM public.prior_bank_events WHERE owner_id=p_owner AND household_id=h AND state='provisional' AND NOT suppressed) WHERE owner_id=p_owner;
 RETURN jsonb_build_object('imported',n,'updated',changed,'issue',NULL);
END $$;
REVOKE ALL ON FUNCTION public.complete_prior_live_job(UUID,UUID,UUID,JSONB,BOOLEAN) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.complete_prior_live_job(UUID,UUID,UUID,JSONB,BOOLEAN) TO service_role;

-- Preserve the legacy entrypoint; an old worker may not race a v2 financial commit.
DO $$ BEGIN
 IF to_regprocedure('finance_private.complete_prior_auto_job_v1(uuid,uuid,uuid,jsonb,jsonb,text)') IS NULL THEN
  ALTER FUNCTION public.complete_prior_auto_job(UUID,UUID,UUID,JSONB,JSONB,TEXT) SET SCHEMA finance_private;
  ALTER FUNCTION finance_private.complete_prior_auto_job(UUID,UUID,UUID,JSONB,JSONB,TEXT) RENAME TO complete_prior_auto_job_v1;
 END IF;
END $$;
REVOKE ALL ON FUNCTION finance_private.complete_prior_auto_job_v1(UUID,UUID,UUID,JSONB,JSONB,TEXT) FROM PUBLIC,anon,authenticated,service_role;
CREATE OR REPLACE FUNCTION public.complete_prior_auto_job(p_owner UUID,p_revision UUID,p_connection_revision UUID,p_snapshot JSONB DEFAULT NULL,p_categories JSONB DEFAULT '[]',p_issue TEXT DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE result JSONB;
BEGIN
 IF p_issue='gap' THEN
  UPDATE public.prior_automation a SET issue='gap',next_run_at='infinity'
   FROM public.profiles p,finance_private.prior_connections c
   WHERE a.owner_id=p_owner AND a.enabled AND a.revision=p_revision AND p.id=a.owner_id AND p.household_id=a.household_id
    AND c.owner_id=a.owner_id AND c.household_id=a.household_id AND c.revision=p_connection_revision;
  RETURN jsonb_build_object('imported',0);
 END IF;
 IF p_issue IS NULL AND EXISTS(SELECT 1 FROM public.prior_automation WHERE owner_id=p_owner AND live_enabled) THEN RETURN jsonb_build_object('imported',0); END IF;
 result:=finance_private.complete_prior_auto_job_v1(p_owner,p_revision,p_connection_revision,p_snapshot,p_categories,p_issue);
 IF result IS NOT NULL AND (p_issue='busy' OR (p_issue IS NULL AND result->>'issue' IS NULL)) THEN
  UPDATE public.prior_automation SET next_run_at=date_trunc('minute',now())+interval '1 minute' WHERE owner_id=p_owner AND revision=p_revision AND enabled;
 END IF;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.complete_prior_auto_job(UUID,UUID,UUID,JSONB,JSONB,TEXT) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.complete_prior_auto_job(UUID,UUID,UUID,JSONB,JSONB,TEXT) TO service_role;

CREATE OR REPLACE FUNCTION public.claim_prior_auto_job(p_ticket TEXT) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET statement_timeout='8s' AS $$
DECLARE owners JSONB;
BEGIN
 IF coalesce(p_ticket,'') !~ '^[a-f0-9]{64}$' THEN RETURN NULL; END IF;
 DELETE FROM finance_private.prior_auto_tickets WHERE token_hash=encode(sha256(convert_to(p_ticket,'UTF8')),'hex') AND expires_at>now();
 IF NOT FOUND THEN RETURN NULL; END IF;
 WITH due AS (
  SELECT a.owner_id FROM public.prior_automation a JOIN public.profiles p ON p.id=a.owner_id AND p.household_id=a.household_id
  JOIN finance_private.prior_connections c ON c.owner_id=a.owner_id AND c.household_id=a.household_id
  WHERE a.enabled AND a.next_run_at<=now() AND (c.secret_id IS NOT NULL OR (c.credential_secret_id IS NOT NULL AND NOT c.auth_blocked))
  ORDER BY a.next_run_at LIMIT 2 FOR UPDATE OF a SKIP LOCKED
 ), claimed AS (
  UPDATE public.prior_automation a SET last_attempt_at=now(),next_run_at=now()+interval '5 minutes' FROM due WHERE a.owner_id=due.owner_id RETURNING a.owner_id,a.revision,a.source_key,a.last_checked_at,a.started_on
 ) SELECT coalesce(jsonb_agg(to_jsonb(claimed)),'[]') INTO owners FROM claimed;
 RETURN owners;
END $$;
REVOKE ALL ON FUNCTION public.claim_prior_auto_job(TEXT) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_prior_auto_job(TEXT) TO service_role;

CREATE OR REPLACE FUNCTION finance_private.prior_profile_changed() RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF TG_OP='DELETE' OR OLD.household_id IS DISTINCT FROM NEW.household_id THEN DELETE FROM finance_private.prior_connections WHERE owner_id=OLD.id; END IF;
 RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION finance_private.prior_profile_changed() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS prior_profile_changed ON public.profiles;
CREATE TRIGGER prior_profile_changed AFTER UPDATE OF household_id OR DELETE ON public.profiles FOR EACH ROW EXECUTE FUNCTION finance_private.prior_profile_changed();

CREATE OR REPLACE FUNCTION public.resolve_prior_event(p_event UUID,p_action TEXT,p_amount NUMERIC,p_state TEXT) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE h UUID; e public.prior_bank_events; effect NUMERIC; entry UUID;
BEGIN
 h:=public.finance_household_lock();
 PERFORM pg_advisory_xact_lock(hashtextextended('prior-connection:'||auth.uid()::text,0));
 SELECT * INTO e FROM public.prior_bank_events WHERE id=p_event AND owner_id=auth.uid() AND household_id=h FOR UPDATE;
 IF e.id IS NULL OR e.state<>'needs_review' OR e.suppressed OR e.bank_amount IS DISTINCT FROM p_amount OR e.observed_state IS DISTINCT FROM p_state THEN RAISE EXCEPTION 'PRIOR_REVIEW_CHANGED'; END IF;
 IF p_action='ignore' THEN
  UPDATE public.prior_bank_events SET suppressed=true,reason='kept_by_user' WHERE id=e.id;RETURN;
 END IF;
 IF p_action<>'apply' OR p_state NOT IN ('provisional','posted','cancelled') OR (p_state<>'cancelled' AND p_amount=0) THEN RAISE EXCEPTION 'PRIOR_REVIEW_INPUT'; END IF;
 effect:=CASE WHEN p_state='cancelled' THEN 0 ELSE p_amount END;
 UPDATE public.prior_bank_events SET state=p_state WHERE id=e.id;
 entry:=e.transaction_id;
 IF entry IS NOT NULL THEN
  UPDATE public.transactions SET amount=abs(effect),type=CASE WHEN effect=0 THEN type WHEN effect<0 THEN 'expense' ELSE 'income' END,date=e.day
   WHERE id=entry AND household_id=h AND account_id=e.account_id AND kind='cashflow';
  IF NOT FOUND THEN RAISE EXCEPTION 'PRIOR_REVIEW_CHANGED'; END IF;
 ELSIF effect<>0 THEN
  INSERT INTO public.transactions(household_id,added_by,type,amount,category_id,comment,date,kind,account_id,import_origin)
   VALUES(h,auth.uid(),CASE WHEN effect<0 THEN 'expense' ELSE 'income' END,abs(effect),e.suggested_category,e.description,e.day,'cashflow',e.account_id,'prior-auto') RETURNING id INTO entry;
 END IF;
 UPDATE public.prior_bank_events SET transaction_id=entry,applied_amount=effect,reason=NULL,
  history=history||jsonb_build_array(jsonb_build_object('at',now(),'fromState',e.state,'toState',p_state,'oldAmount',e.applied_amount::text,'amount',effect::text,'reason','owner_confirmed')) WHERE id=e.id;
END $$;
REVOKE ALL ON FUNCTION public.resolve_prior_event(UUID,TEXT,NUMERIC,TEXT) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.resolve_prior_event(UUID,TEXT,NUMERIC,TEXT) TO authenticated;

NOTIFY pgrst,'reload schema';
COMMIT;

-- 20. Merchant rules and bank-observed bills (2026-10-26)
-- Confirmed merchant preferences and bank-observed bills. No historical money/category rewrite.
BEGIN;
CREATE TABLE IF NOT EXISTS public.merchant_rules (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),household_id UUID NOT NULL REFERENCES public.households(id) ON DELETE CASCADE,
 merchant_key TEXT NOT NULL CHECK(length(merchant_key) BETWEEN 3 AND 250),transaction_type TEXT NOT NULL CHECK(transaction_type IN ('expense','income')),
 display_name TEXT NOT NULL CHECK(length(btrim(display_name)) BETWEEN 1 AND 80),category_id TEXT NOT NULL CHECK(category_id ~ '^[a-z][a-z0-9-]{0,63}$'),
 created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT now(),updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 UNIQUE(household_id,merchant_key,transaction_type)
);
CREATE INDEX IF NOT EXISTS merchant_rules_creator ON public.merchant_rules(created_by);
ALTER TABLE public.merchant_rules ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.merchant_rules FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.merchant_rules TO authenticated;
DO $$ DECLARE action TEXT;BEGIN
 FOREACH action IN ARRAY ARRAY['SELECT','INSERT','UPDATE','DELETE'] LOOP
  EXECUTE format('DROP POLICY IF EXISTS %I ON public.merchant_rules','merchant_rules_'||lower(action));
  EXECUTE format('CREATE POLICY %I ON public.merchant_rules FOR %s TO authenticated %s','merchant_rules_'||lower(action),action,
   CASE WHEN action='INSERT' THEN 'WITH CHECK(household_id=(SELECT public.get_my_household_id()))'
   WHEN action='UPDATE' THEN 'USING(household_id=(SELECT public.get_my_household_id())) WITH CHECK(household_id=(SELECT public.get_my_household_id()))'
   ELSE 'USING(household_id=(SELECT public.get_my_household_id()))' END);
 END LOOP;
 IF NOT EXISTS(SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='merchant_rules') THEN ALTER PUBLICATION supabase_realtime ADD TABLE public.merchant_rules; END IF;
END $$;

CREATE OR REPLACE FUNCTION finance_private.merchant_identity(description TEXT) RETURNS JSONB LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE normalized TEXT:=lower(normalize(coalesce(description,''),NFKC));row RECORD;key TEXT;
BEGIN
 FOR row IN SELECT * FROM (VALUES
 ('mak-by','Мак.by','mak[.]by|мак[.]by'),
 ('netflix','Netflix','netflix'),
 ('spotify','Spotify','spotify'),
 ('apple','Apple','apple[.]com/bill|apple[.]com'),
 ('yandex-plus','Яндекс Плюс','yandex[ .]*plus|яндекс[ .]*плюс'),
 ('euroopt','Евроопт','euroopt|евроопт|edostavka|е-доставка'),
 ('green','Green','green|грин'),
 ('santa','Санта','santa|санта'),
 ('sosedi','Соседи','sosedi|соседи'),
 ('hippo','Гиппо','gippo|hippo|гиппо'),
 ('wildberries','Wildberries','wildberries|вайлдберриз'),
 ('ozon','Ozon','ozon|озон'),
 ('a1','А1','a1|velcom'),
 ('mts','МТС','mts|мтс'),
 ('byfly','Byfly','byfly')
 ) AS brands(id,name,pattern) LOOP
  IF normalized ~ ('(^|[^[:alnum:]])('||row.pattern||')($|[^[:alnum:]])') THEN RETURN jsonb_build_object('key','brand:'||row.id,'name',row.name); END IF;
 END LOOP;
 key:=btrim(regexp_replace(normalized,'[^[:alnum:]]+',' ','g'));
 IF length(key) NOT BETWEEN 2 AND 240 OR key !~ '[[:alpha:]]' OR key ~ '^(покупка|оплата|платеж|платёж|расход|продукты|еда|кафе|такси|перевод|другое|импорт выписки|без комментария)$' THEN key:=''; ELSE key:='raw:'||key; END IF;
 RETURN jsonb_build_object('key',key,'name',btrim(coalesce(description,'')));
END $$;
REVOKE ALL ON FUNCTION finance_private.merchant_identity(TEXT) FROM PUBLIC,anon,authenticated;
ALTER TABLE public.prior_bank_events ADD COLUMN IF NOT EXISTS merchant_key TEXT;
ALTER TABLE public.prior_bank_events ADD COLUMN IF NOT EXISTS merchant_name TEXT;
ALTER TABLE public.prior_bank_events ADD COLUMN IF NOT EXISTS rule_category TEXT;
ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS recurring_month DATE CHECK(recurring_month=date_trunc('month',recurring_month)::date);
ALTER TABLE public.recurring_transactions ADD COLUMN IF NOT EXISTS match_mode TEXT NOT NULL DEFAULT 'scheduled' CHECK(match_mode IN ('scheduled','bank'));
ALTER TABLE public.recurring_transactions ADD COLUMN IF NOT EXISTS merchant_key TEXT;
ALTER TABLE public.recurring_transactions DROP CONSTRAINT IF EXISTS recurring_transactions_day_of_month_check;
ALTER TABLE public.recurring_transactions ADD CONSTRAINT recurring_transactions_day_of_month_check CHECK(day_of_month BETWEEN 1 AND CASE WHEN match_mode='bank' THEN 31 ELSE 28 END);
CREATE UNIQUE INDEX IF NOT EXISTS bank_bill_occurrence ON public.transactions(recurring_id,recurring_month) WHERE recurring_id IS NOT NULL AND recurring_month IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS bank_bill_merchant ON public.recurring_transactions(household_id,account_id,merchant_key) WHERE is_active AND match_mode='bank';
CREATE INDEX IF NOT EXISTS prior_bank_events_merchant ON public.prior_bank_events(household_id,merchant_key,day);

CREATE OR REPLACE FUNCTION finance_private.guard_bank_bill() RETURNS TRIGGER LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF current_user IN ('anon','authenticated') AND (NEW.match_mode='bank' OR NEW.merchant_key IS NOT NULL) THEN RAISE EXCEPTION 'Use bank bill confirmation'; END IF;
 IF NEW.match_mode='bank' AND (NEW.type<>'expense' OR coalesce(NEW.merchant_key,'')='' OR NEW.account_id IS NULL) THEN RAISE EXCEPTION 'Bank bill requires an expense, merchant and account'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION finance_private.guard_bank_bill() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS guard_bank_bill ON public.recurring_transactions;
CREATE TRIGGER guard_bank_bill BEFORE INSERT OR UPDATE ON public.recurring_transactions FOR EACH ROW EXECUTE FUNCTION finance_private.guard_bank_bill();

-- This helper links one actual bank charge; it never creates a payment or changes money.
CREATE OR REPLACE FUNCTION finance_private.link_bank_bill(tx UUID,key TEXT) RETURNS VOID LANGUAGE plpgsql SET search_path='' AS $$
DECLARE t public.transactions;r public.recurring_transactions;month DATE;due DATE;
BEGIN
 SELECT * INTO t FROM public.transactions WHERE id=tx;
 IF t.id IS NULL OR t.kind<>'cashflow' OR t.type<>'expense' OR t.amount<=0 OR t.recurring_id IS NOT NULL THEN RETURN; END IF;
 month:=date_trunc('month',t.date)::date;
 SELECT * INTO r FROM public.recurring_transactions WHERE household_id=t.household_id AND account_id=t.account_id AND merchant_key=key AND match_mode='bank' AND is_active;
 IF r.id IS NULL THEN RETURN; END IF;
 due:=month+least(r.day_of_month-1,extract(day FROM (month+interval '1 month'-interval '1 day'))::int-1);
 IF abs(t.date-due)>4 OR abs(t.amount-r.amount)>greatest(1,r.amount*0.20) OR EXISTS(SELECT 1 FROM public.transactions WHERE recurring_id=r.id AND recurring_month=month) THEN RETURN; END IF;
 UPDATE public.transactions SET recurring_id=r.id,recurring_month=month WHERE id=t.id;
END $$;
REVOKE ALL ON FUNCTION finance_private.link_bank_bill(UUID,TEXT) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION finance_private.enrich_bank_event() RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE identity JSONB;rule public.merchant_rules;t public.transactions;
BEGIN
 identity:=finance_private.merchant_identity(NEW.description);
 NEW.merchant_key:=nullif(identity->>'key','');NEW.merchant_name:=identity->>'name';
 IF NEW.transaction_id IS NOT NULL AND NOT NEW.suppressed THEN
  IF NEW.state='cancelled' THEN
   UPDATE public.transactions SET recurring_id=NULL,recurring_month=NULL WHERE id=NEW.transaction_id AND household_id=NEW.household_id AND recurring_month IS NOT NULL;
  ELSIF TG_OP='UPDATE' AND OLD.transaction_id IS DISTINCT FROM NEW.transaction_id THEN
   SELECT * INTO t FROM public.transactions WHERE id=NEW.transaction_id AND household_id=NEW.household_id AND account_id=NEW.account_id AND kind='cashflow' AND import_origin='prior-auto';
   IF t.id IS NOT NULL THEN
    -- Legacy adoption must not recategorize old journal rows.
    IF t.created_at>=NEW.created_at-interval '5 seconds' THEN
     SELECT * INTO rule FROM public.merchant_rules WHERE household_id=NEW.household_id AND merchant_key=NEW.merchant_key AND transaction_type=t.type;
     IF rule.id IS NOT NULL THEN
      UPDATE public.transactions SET category_id=rule.category_id WHERE id=t.id;
      NEW.rule_category:=rule.category_id;
     END IF;
    END IF;
   END IF;
  END IF;
  IF NEW.state<>'cancelled' THEN PERFORM finance_private.link_bank_bill(NEW.transaction_id,NEW.merchant_key);END IF;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION finance_private.enrich_bank_event() FROM PUBLIC,anon,authenticated;
-- Backfill metadata only, before enabling the trigger. Existing money/categories/notes stay intact.
UPDATE public.prior_bank_events SET merchant_key=nullif(finance_private.merchant_identity(description)->>'key',''),merchant_name=finance_private.merchant_identity(description)->>'name' WHERE merchant_key IS NULL;
DROP TRIGGER IF EXISTS enrich_bank_event ON public.prior_bank_events;
CREATE TRIGGER enrich_bank_event BEFORE INSERT OR UPDATE OF transaction_id,description,state ON public.prior_bank_events FOR EACH ROW EXECUTE FUNCTION finance_private.enrich_bank_event();

CREATE OR REPLACE FUNCTION public.save_transaction_with_rule(p_id UUID,p_type TEXT,p_amount NUMERIC,p_category_id TEXT,p_comment TEXT,p_added_by UUID,p_date DATE,p_account_id UUID,p_remember BOOLEAN DEFAULT false,p_merchant_name TEXT DEFAULT NULL)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE h UUID;e public.prior_bank_events;t public.transactions;key TEXT;
BEGIN
 h:=public.finance_household_lock();
 IF p_remember IS NULL THEN RAISE EXCEPTION 'Merchant preference required'; END IF;
 IF p_remember THEN
  SELECT * INTO e FROM public.prior_bank_events WHERE household_id=h AND transaction_id=p_id AND NOT suppressed AND state<>'cancelled' FOR UPDATE;
  SELECT * INTO t FROM public.transactions WHERE id=p_id AND household_id=h AND kind='cashflow' FOR UPDATE;
  key:=coalesce(e.merchant_key,finance_private.merchant_identity(t.comment)->>'key');
  IF t.id IS NULL OR NOT EXISTS(SELECT 1 FROM public.accounts WHERE id=t.account_id AND household_id=h AND kind='bank') OR coalesce(key,'')='' OR p_merchant_name IS NULL OR length(btrim(p_merchant_name)) NOT BETWEEN 1 AND 80 OR p_merchant_name ~ '[[:cntrl:]]'
   OR p_category_id !~ '^[a-z][a-z0-9-]{0,63}$' OR (p_type='income' AND p_category_id<>'salary' AND p_category_id !~ '^income-') OR (p_type='expense' AND (p_category_id='salary' OR p_category_id ~ '^income-')) THEN RAISE EXCEPTION 'Invalid merchant preference'; END IF;
 END IF;
 PERFORM public.update_finance_transaction(p_id,p_type,p_amount,p_category_id,p_comment,p_added_by,p_date,p_account_id);
 IF p_remember THEN
  INSERT INTO public.merchant_rules(household_id,merchant_key,transaction_type,display_name,category_id,created_by)
  VALUES(h,key,p_type,btrim(p_merchant_name),p_category_id,auth.uid())
  ON CONFLICT(household_id,merchant_key,transaction_type) DO UPDATE SET display_name=excluded.display_name,category_id=excluded.category_id,updated_at=now();
 END IF;
END $$;
REVOKE ALL ON FUNCTION public.save_transaction_with_rule(UUID,TEXT,NUMERIC,TEXT,TEXT,UUID,DATE,UUID,BOOLEAN,TEXT) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.save_transaction_with_rule(UUID,TEXT,NUMERIC,TEXT,TEXT,UUID,DATE,UUID,BOOLEAN,TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.delete_merchant_rule(p_id UUID) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE h UUID;BEGIN h:=public.finance_household_lock();DELETE FROM public.merchant_rules WHERE id=p_id AND household_id=h;END $$;
REVOKE ALL ON FUNCTION public.delete_merchant_rule(UUID) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.delete_merchant_rule(UUID) TO authenticated;

-- Evidence is re-read and checked under the household lock; the client cannot invent a subscription.
CREATE OR REPLACE FUNCTION public.confirm_bank_bill(p_evidence UUID[]) RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE h UUID;ids UUID[];rows JSONB;t public.transactions;key TEXT;account UUID;months INT[];days INT[];r UUID;row JSONB;
BEGIN
 h:=public.finance_household_lock();
 IF coalesce(cardinality(p_evidence),0) NOT BETWEEN 2 AND 6 OR array_position(p_evidence,NULL) IS NOT NULL THEN RAISE EXCEPTION 'Two to six monthly payments required'; END IF;
 SELECT array_agg(DISTINCT x) INTO ids FROM unnest(p_evidence) x;
 IF coalesce(cardinality(ids),0) NOT BETWEEN 2 AND 6 THEN RAISE EXCEPTION 'Two to six monthly payments required'; END IF;
 SELECT jsonb_agg(to_jsonb(tx)||jsonb_build_object('key',coalesce(e.merchant_key,finance_private.merchant_identity(tx.comment)->>'key')) ORDER BY tx.date DESC,tx.id) INTO rows
 FROM public.transactions tx LEFT JOIN public.prior_bank_events e ON e.transaction_id=tx.id AND e.household_id=tx.household_id
 WHERE tx.household_id=h AND tx.id=ANY(ids) AND tx.type='expense' AND tx.kind='cashflow' AND tx.amount>0 AND tx.date<=(now() AT TIME ZONE 'Europe/Minsk')::date AND coalesce(e.state,'posted')<>'cancelled'
 AND (tx.recurring_id IS NULL OR EXISTS(SELECT 1 FROM public.recurring_transactions r WHERE r.id=tx.recurring_id AND r.household_id=h AND r.match_mode='bank'));
 IF coalesce(jsonb_array_length(rows),0)<>cardinality(ids) THEN RAISE EXCEPTION 'Payment evidence changed'; END IF;
 key:=rows->0->>'key';account:=(rows->0->>'account_id')::uuid;
 IF coalesce(key,'')='' OR NOT EXISTS(SELECT 1 FROM public.accounts WHERE id=account AND household_id=h AND kind='bank' AND NOT is_archived) THEN RAISE EXCEPTION 'Bank account and merchant required'; END IF;
 FOR row IN SELECT value FROM jsonb_array_elements(rows) LOOP
  IF row->>'key'<>key OR (row->>'account_id')::uuid IS DISTINCT FROM account THEN RAISE EXCEPTION 'Payment evidence changed'; END IF;
  months:=array_append(months,extract(year FROM (row->>'date')::date)::int*12+extract(month FROM (row->>'date')::date)::int);
  days:=array_append(days,least(28,extract(day FROM (row->>'date')::date)::int));
 END LOOP;
 IF (rows->0->>'date')::date<(date_trunc('month',now() AT TIME ZONE 'Europe/Minsk')-interval '1 month')::date
  OR (SELECT max(x)-min(x) FROM unnest(months)x)<>cardinality(months)-1 OR (SELECT count(DISTINCT x) FROM unnest(months)x)<>cardinality(months)
  OR (SELECT max(x)-min(x) FROM unnest(days)x)>4 THEN RAISE EXCEPTION 'Monthly rhythm changed'; END IF;
 -- Reject cherry-picked evidence when another same-merchant payment exists in an evidence month.
 IF EXISTS(SELECT 1 FROM public.transactions tx LEFT JOIN public.prior_bank_events e ON e.transaction_id=tx.id WHERE tx.household_id=h AND tx.account_id=account AND tx.kind='cashflow' AND tx.type='expense' AND tx.amount>0
  AND tx.date>=date_trunc('month',(rows->-1->>'date')::date)::date AND tx.date<(date_trunc('month',(rows->0->>'date')::date)+interval '1 month')::date
  AND coalesce(e.merchant_key,finance_private.merchant_identity(tx.comment)->>'key')=key AND NOT(tx.id=ANY(ids))
  AND (extract(year FROM tx.date)::int*12+extract(month FROM tx.date)::int)=ANY(months)) THEN RAISE EXCEPTION 'Ambiguous monthly payments'; END IF;
 SELECT id INTO r FROM public.recurring_transactions WHERE household_id=h AND account_id=account AND merchant_key=key AND match_mode='bank' AND is_active;
 IF r IS NOT NULL THEN RETURN r; END IF;
 IF EXISTS(SELECT 1 FROM public.recurring_transactions WHERE household_id=h AND account_id=account AND is_active AND finance_private.merchant_identity(comment)->>'key'=key) THEN RAISE EXCEPTION 'Existing payment plan requires review'; END IF;
 SELECT * INTO t FROM public.transactions WHERE id=(rows->0->>'id')::uuid;
 INSERT INTO public.recurring_transactions(household_id,added_by,type,amount,category_id,comment,day_of_month,account_id,match_mode,merchant_key)
 VALUES(h,auth.uid(),'expense',t.amount,t.category_id,coalesce((SELECT display_name FROM public.merchant_rules WHERE household_id=h AND merchant_key=key AND transaction_type='expense'),finance_private.merchant_identity(t.comment)->>'name'),extract(day FROM t.date)::int,account,'bank',key) RETURNING id INTO r;
 -- Attach reviewed historical evidence as paid occurrences; no extra expense is created.
 FOREACH account IN ARRAY ids LOOP PERFORM finance_private.link_bank_bill(account,key); END LOOP;
 RETURN r;
END $$;
REVOKE ALL ON FUNCTION public.confirm_bank_bill(UUID[]) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.confirm_bank_bill(UUID[]) TO authenticated;

CREATE OR REPLACE FUNCTION public.apply_due_recurring(p_today DATE) RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE h UUID;r public.recurring_transactions;due DATE;account UUID;n INT:=0;inserted INT;
BEGIN
 h:=public.finance_household_lock();IF p_today IS NULL THEN RAISE EXCEPTION 'Date required';END IF;
 FOR r IN SELECT * FROM public.recurring_transactions WHERE household_id=h AND is_active AND match_mode='scheduled' ORDER BY id FOR UPDATE LOOP
  due:=make_date(extract(year FROM p_today)::int,extract(month FROM p_today)::int,r.day_of_month);
  IF due>p_today OR r.last_applied>=due THEN CONTINUE;END IF;
  account:=r.account_id;IF account IS NULL THEN SELECT id INTO account FROM public.accounts WHERE household_id=h AND NOT is_archived ORDER BY created_at,id LIMIT 1;END IF;
  IF account IS NULL OR NOT EXISTS(SELECT 1 FROM public.accounts WHERE id=account AND household_id=h AND NOT is_archived) THEN RAISE EXCEPTION 'Recurring transaction needs an active account';END IF;
  INSERT INTO public.transactions(household_id,type,amount,category_id,comment,added_by,date,account_id,kind,recurring_id)
  VALUES(h,r.type,r.amount,r.category_id,coalesce(r.comment,''),r.added_by,due,account,'cashflow',r.id) ON CONFLICT(recurring_id,date) WHERE recurring_id IS NOT NULL DO NOTHING;
  GET DIAGNOSTICS inserted=ROW_COUNT;n:=n+inserted;UPDATE public.recurring_transactions SET last_applied=due WHERE id=r.id;
 END LOOP;
 RETURN n;
END $$;
NOTIFY pgrst,'reload schema';
COMMIT;

-- 21. Month-end bank bills (2026-10-26)
-- Preserve the detected month-end rhythm instead of fixing February's 28/29th forever.
BEGIN;
DO $$ DECLARE body TEXT;needle TEXT:='extract(day FROM t.date)::int,account,''bank'',key)';replacement TEXT:=$replacement$
 CASE /* bank-bill-month-end-v1 */ WHEN NOT EXISTS(SELECT 1 FROM jsonb_array_elements(rows) evidence
  WHERE (evidence->>'date')::date<>(date_trunc('month',(evidence->>'date')::date)+interval '1 month'-interval '1 day')::date)
 THEN 31 ELSE extract(day FROM t.date)::int END,account,'bank',key)$replacement$;
BEGIN
 body:=pg_get_functiondef('public.confirm_bank_bill(uuid[])'::regprocedure);
 IF position(needle IN body)>0 THEN EXECUTE replace(body,needle,replacement);
 ELSIF position('bank-bill-month-end-v1' IN body)=0 THEN RAISE EXCEPTION 'Bank bill function changed';END IF;
END $$;
NOTIFY pgrst,'reload schema';
COMMIT;
