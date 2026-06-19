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
-- пользователя в Supabase Auth и копирует метаданные профиля (имя, аватар, роль, 
-- цвет, household_id) из auth.users в таблицу profiles с правами администратора.
-- Это решает проблему RLS-ограничений в случае, если включено подтверждение email.

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, name, avatar, role, color, household_id)
  VALUES (
    new.id,
    COALESCE(new.raw_user_meta_data->>'name', 'Участник'),
    COALESCE(new.raw_user_meta_data->>'avatar', '👤'),
    COALESCE(new.raw_user_meta_data->>'role', 'Участник'),
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
-- 9. Таблица регулярных платежей
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

-- 10. Таблица целей накоплений
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
