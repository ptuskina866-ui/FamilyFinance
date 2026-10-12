import { useEffect, useRef, useState } from 'react';
import { AppContent } from '../App';
import { AppContext, type AppContextType } from '../AppContext';
import { AuthContext, type AuthContextType } from '../AuthContext';
import { CATEGORIES } from '../mockData';
import type { Account, FamilyMember, RecurringTransaction, SavingsGoal, Transaction } from '../types';
import { accountBalances, cashflowTotals, isCashflow, reservedGoals, totalAccountBalance } from '../lib/finance';
import { fromMinorUnits, localDateISO, toMinorUnits } from '../lib/money';

const STORAGE_KEY = 'ff_demo_v1';
const HOUSEHOLD_ID = '00000000-0000-4000-8000-000000000001';
const MEMBER_ID = '00000000-0000-4000-8000-000000000002';
const CREATED_AT = '2026-01-01T00:00:00Z';
const MEMBERS: FamilyMember[] = [
  { id: MEMBER_ID, name: 'Алексей', avatar: '👨', color: '#3b82f6' },
  { id: '00000000-0000-4000-8000-000000000003', name: 'Мария', avatar: '👩', color: '#ec4899' },
];
const DEMO_AUTH: AuthContextType = {
  session: null,
  user: { id: MEMBER_ID, aud: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: CREATED_AT },
  profile: { ...MEMBERS[0], household_id: HOUSEHOLD_ID, updated_at: CREATED_AT },
  household: { id: HOUSEHOLD_ID, name: 'Демо-семья', created_at: CREATED_AT },
  loading: false,
  signIn: async () => { throw new Error('Вход недоступен в демо.'); },
  signUp: async () => { throw new Error('Регистрация недоступна в демо.'); },
  signOut: async () => { window.alert('Вы в демо. Реальная учетная запись не используется.'); },
  refreshProfile: async () => {},
  createHouseholdInvite: async () => { throw new Error('Демо не создает приглашения в настоящую семью.'); },
};

interface DemoData {
  version: 1;
  accounts: Account[];
  transactions: Transaction[];
  goals: SavingsGoal[];
  recurring: RecurringTransaction[];
  budgetLimit: number;
}

const normalizeMoney = (amount: number) => fromMinorUnits(toMinorUnits(amount));
const positiveMoney = (amount: number) => {
  const cents = toMinorUnits(amount);
  if (cents <= 0) throw new Error('Укажите положительную сумму с точностью до копейки.');
  return fromMinorUnits(cents);
};
const newId = () => crypto.randomUUID();

function validateDate(date: string): void {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) throw new Error('Укажите корректную дату.');
  const value = new Date(`${date}T12:00:00`);
  if (!Number.isFinite(value.getTime()) || localDateISO(value) !== date) throw new Error('Укажите корректную дату.');
}

function shiftedDate(today: string, days: number): string {
  const date = new Date(`${today}T12:00:00`);
  date.setDate(date.getDate() + days);
  return localDateISO(date);
}

function monthDate(today: string, months: number, day = 1): string {
  const date = new Date(`${today}T12:00:00`);
  date.setDate(1);
  date.setMonth(date.getMonth() + months);
  date.setDate(Math.min(day, new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate()));
  return localDateISO(date);
}

function fixtures(): DemoData {
  const today = localDateISO();
  const oldDate = monthDate(today, -2);
  const accounts: Account[] = [
    { id: 'demo-main', name: 'Основная карта', kind: 'bank', opening_balance: 1000 },
    { id: 'demo-cash', name: 'Наличные', kind: 'cash', opening_balance: 100 },
    { id: 'demo-savings', name: 'Накопительный счет', kind: 'savings', opening_balance: 2000 },
  ].map(account => ({ ...account, household_id: HOUSEHOLD_ID, currency: 'BYN', is_archived: false, created_at: CREATED_AT }) as Account);
  const goals: SavingsGoal[] = [
    { id: 'demo-holiday', name: 'Отпуск', target_amount: 3000, current_amount: 900, emoji: '🏖️', deadline: monthDate(today, 6, 12) },
    { id: 'demo-emergency', name: 'Подушка безопасности', target_amount: 5000, current_amount: 800, emoji: '🛟', deadline: null },
  ].map(goal => ({ ...goal, household_id: HOUSEHOLD_ID, is_completed: false, is_archived: false, created_at: `${oldDate}T12:00:00` }));
  const transaction = (id: string, type: Transaction['type'], amount: number, categoryId: string, date: string, comment: string): Transaction => ({ id, type, amount, categoryId, date, comment, addedBy: MEMBER_ID, accountId: 'demo-main', kind: 'cashflow' });
  const transactions: Transaction[] = [
    transaction('demo-salary', 'income', 2000, 'salary', shiftedDate(today, -10), 'Зарплата'),
    transaction('demo-rent', 'expense', 1490, 'housing', shiftedDate(today, -9), 'Аренда и обязательные расходы'),
    transaction('demo-food', 'expense', 80, 'food-hippo', today, 'Продукты на неделю'),
    transaction('demo-house', 'expense', 110, 'household', shiftedDate(today, -4), 'Покупки для дома'),
    transaction('demo-other', 'expense', 320, 'other', shiftedDate(today, -3), 'Плановые расходы'),
    { ...transaction('demo-transfer', 'expense', 150, 'savings', shiftedDate(today, -2), 'Наличные на повседневные расходы'), kind: 'transfer', targetAccountId: 'demo-cash' },
  ];
  for (let index = 0; index < 3; index++) {
    for (const [goalId, amount, name] of [['demo-holiday', 300, 'Отпуск'], ['demo-emergency', index === 2 ? 400 : 200, 'Подушка безопасности']] as const) {
      transactions.push({ id: `${goalId}-deposit-${index}`, type: 'expense', amount, categoryId: 'savings', date: monthDate(today, index - 2, index === 2 ? Math.min(2, Number(today.slice(8))) : 2), comment: `Резервирование: ${name}`, addedBy: MEMBER_ID, kind: 'goal_deposit', goalId });
    }
  }
  return { version: 1, accounts, goals, transactions, budgetLimit: 2200, recurring: [
    { id: 'demo-bill', household_id: HOUSEHOLD_ID, added_by: MEMBER_ID, type: 'expense', amount: 450, category_id: 'utilities', comment: 'Коммунальные и связь', day_of_month: 20, last_applied: monthDate(today, -1, 20), is_active: true, created_at: CREATED_AT },
  ] };
}

function assertData(data: DemoData): void {
  if (data.version !== 1 || !Array.isArray(data.accounts) || data.accounts.length === 0 || !Array.isArray(data.transactions) || !Array.isArray(data.goals) || !Array.isArray(data.recurring)) throw new Error('Некорректные демо-данные.');
  positiveMoney(data.budgetLimit);
  const ids = new Set<string>();
  for (const account of data.accounts) {
    if (!account.id || ids.has(account.id) || account.household_id !== HOUSEHOLD_ID || !account.name?.trim() || !['bank', 'cash', 'savings'].includes(account.kind) || account.currency !== 'BYN' || toMinorUnits(account.opening_balance) < 0) throw new Error('Некорректный демо-счет.');
    ids.add(account.id);
  }
  const transactionIds = new Set<string>();
  for (const tx of data.transactions) {
    if (!tx.id || transactionIds.has(tx.id) || !['income', 'expense'].includes(tx.type) || !['cashflow', 'transfer', 'goal_deposit', 'goal_release'].includes(tx.kind || 'cashflow') || typeof tx.comment !== 'string') throw new Error('Некорректная демо-операция.');
    positiveMoney(tx.amount); validateDate(tx.date);
    if ((isCashflow(tx) || tx.kind === 'transfer') && (!tx.accountId || !ids.has(tx.accountId))) throw new Error('Счет операции не найден.');
    if (tx.kind === 'transfer' && (!tx.targetAccountId || !ids.has(tx.targetAccountId) || tx.targetAccountId === tx.accountId)) throw new Error('Некорректный демо-перевод.');
    transactionIds.add(tx.id);
  }
  const goalIds = new Set<string>();
  for (const goal of data.goals) {
    if (!goal.id || goalIds.has(goal.id) || goal.household_id !== HOUSEHOLD_ID || !goal.name?.trim() || toMinorUnits(goal.current_amount) < 0) throw new Error('Некорректная демо-цель.');
    positiveMoney(goal.target_amount);
    if (goal.deadline) validateDate(goal.deadline);
    const ledger = data.transactions.filter(tx => tx.goalId === goal.id && (tx.kind === 'goal_deposit' || tx.kind === 'goal_release'));
    const ledgerCents = ledger.reduce((total, tx) => total + (tx.kind === 'goal_deposit' ? 1 : -1) * toMinorUnits(tx.amount), 0);
    if (ledgerCents !== toMinorUnits(goal.current_amount) || (goal.is_archived && ledgerCents !== 0)) throw new Error('Сумма цели не совпадает с историей.');
    goalIds.add(goal.id);
  }
  for (const tx of data.transactions) {
    if ((tx.kind === 'goal_deposit' || tx.kind === 'goal_release') && (!tx.goalId || !goalIds.has(tx.goalId))) throw new Error('Цель операции не найдена.');
  }
  const recurringIds = new Set<string>();
  for (const item of data.recurring) {
    if (!item.id || recurringIds.has(item.id) || item.household_id !== HOUSEHOLD_ID || !Number.isInteger(item.day_of_month) || item.day_of_month < 1 || item.day_of_month > 28 || !['income', 'expense'].includes(item.type)) throw new Error('Некорректная регулярная демо-операция.');
    positiveMoney(item.amount);
    if (item.last_applied) validateDate(item.last_applied);
    recurringIds.add(item.id);
  }
  totalAccountBalance(data.accounts, data.transactions); reservedGoals(data.goals);
}

function applyDueRecurring(data: DemoData): DemoData {
  const today = localDateISO();
  const transactions = [...data.transactions];
  const recurring = data.recurring.map(item => {
    const due = `${today.slice(0, 7)}-${String(item.day_of_month).padStart(2, '0')}`;
    if (!item.is_active || due > today || (item.last_applied && item.last_applied >= due)) return item;
    if (!transactions.some(tx => tx.recurringId === item.id && tx.date === due)) {
      transactions.push({ id: newId(), kind: 'cashflow', type: item.type, amount: item.amount, categoryId: item.category_id, comment: item.comment, date: due, addedBy: item.added_by || MEMBER_ID, accountId: data.accounts.find(account => !account.is_archived)?.id, recurringId: item.id });
    }
    return { ...item, last_applied: due };
  });
  return { ...data, transactions, recurring };
}

function loadDemo(): DemoData {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    // assertData checks the complete monetary/relationship boundary before use.
    const data = stored ? JSON.parse(stored) as DemoData : fixtures();
    assertData(data);
    const next = applyDueRecurring(data);
    assertData(next);
    return next;
  } catch { return fixtures(); }
}

export default function DemoApp() {
  const [data, setData] = useState(loadDemo);
  const current = useRef(data);
  const [resetVersion, setResetVersion] = useState(0);
  const [storageError, setStorageError] = useState<string | null>(null);
  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(current.current)); }
    catch { setStorageError('Браузер не разрешает сохранять демо на этом устройстве.'); }
  }, []);

  const commit = (next: DemoData) => {
    assertData(next);
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); }
    catch { throw new Error('Не удалось сохранить демо на этом устройстве.'); }
    // Synchronous ref prevents async handlers using an obsolete render snapshot.
    current.current = next;
    setData(next); setStorageError(null);
  };
  const normalizeTransaction = (input: Omit<Transaction, 'id'>, state: DemoData): Omit<Transaction, 'id'> => {
    if (!isCashflow(input as Transaction)) throw new Error('Используйте отдельное действие для перевода или цели.');
    const accountId = input.accountId || state.accounts.find(account => !account.is_archived)?.id;
    if (!state.accounts.some(account => account.id === accountId && !account.is_archived)) throw new Error('Выберите доступный счет.');
    validateDate(input.date);
    return { ...input, kind: 'cashflow', amount: positiveMoney(input.amount), accountId, targetAccountId: null, goalId: null, addedBy: input.addedBy || MEMBER_ID };
  };
  const changeGoal = (goalId: string, amount: number, release: boolean) => {
    const state = current.current;
    const goal = state.goals.find(item => item.id === goalId && !item.is_archived);
    if (!goal) throw new Error('Активная цель не найдена.');
    const cents = toMinorUnits(positiveMoney(amount));
    if (release && toMinorUnits(goal.current_amount) < cents) throw new Error('Нельзя вернуть больше, чем накоплено.');
    const free = toMinorUnits(totalAccountBalance(state.accounts, state.transactions)) - toMinorUnits(reservedGoals(state.goals));
    if (!release && free < cents) throw new Error('Недостаточно свободных денег.');
    const nextAmount = fromMinorUnits(toMinorUnits(goal.current_amount) + (release ? -cents : cents));
    const transaction: Transaction = { id: newId(), kind: release ? 'goal_release' : 'goal_deposit', type: release ? 'income' : 'expense', amount: fromMinorUnits(cents), categoryId: 'savings', goalId, date: localDateISO(), comment: `${release ? 'Возврат из цели' : 'Резервирование'}: ${goal.name}`, addedBy: MEMBER_ID };
    commit({ ...state, goals: state.goals.map(item => item.id === goalId ? { ...item, current_amount: nextAmount, is_completed: toMinorUnits(nextAmount) >= toMinorUnits(item.target_amount) } : item), transactions: [...state.transactions, transaction] });
  };

  const balance = totalAccountBalance(data.accounts, data.transactions);
  const reservedBalance = reservedGoals(data.goals);
  const monthly = cashflowTotals(data.transactions.filter(tx => tx.date.startsWith(localDateISO().slice(0, 7))));
  const context: AppContextType = {
    transactions: [...data.transactions].sort((a, b) => b.date.localeCompare(a.date)), categories: CATEGORIES, members: MEMBERS,
    accounts: data.accounts, accountBalances: accountBalances(data.accounts, data.transactions), accountsReady: true, schemaReady: true,
    financeLoading: false, financeError: storageError, balance, reservedBalance,
    availableBalance: fromMinorUnits(toMinorUnits(balance) - toMinorUnits(reservedBalance)), monthlyIncome: monthly.income, monthlyExpense: monthly.expense,
    budgetLimit: data.budgetLimit, recurringTransactions: data.recurring, savingsGoals: data.goals,
    getCategoryById: id => CATEGORIES.find(category => category.id === id), getMemberById: id => MEMBERS.find(member => member.id === id),
    addTransaction: async input => { const state = current.current; commit({ ...state, transactions: [...state.transactions, { ...normalizeTransaction(input, state), id: newId() }] }); },
    updateTransaction: async (id, input) => {
      const state = current.current;
      const existing = state.transactions.find(tx => tx.id === id);
      if (!existing || !isCashflow(existing)) throw new Error('Эту операцию нельзя изменить как доход или расход.');
      if (existing.recurringId && input.date !== existing.date) throw new Error('Дата регулярной операции не меняется. Можно исправить сумму или другие детали.');
      const update = normalizeTransaction(input, state);
      const capital = toMinorUnits(totalAccountBalance(state.accounts, state.transactions));
      const nextCapital = capital - (existing.type === 'income' ? 1 : -1) * toMinorUnits(existing.amount)
        + (update.type === 'income' ? 1 : -1) * toMinorUnits(update.amount);
      if (nextCapital < toMinorUnits(reservedGoals(state.goals)) && nextCapital < capital) throw new Error('Сначала освободите деньги из целей, чтобы уменьшить общий остаток.');
      commit({ ...state, transactions: state.transactions.map(tx => tx.id === id ? { ...tx, ...update, id, recurringId: existing.recurringId } : tx) });
    },
    addTransactionsBatch: async inputs => {
      const state = current.current;
      commit({ ...state, transactions: [...state.transactions, ...inputs.map(input => ({ ...normalizeTransaction(input, state), id: newId() }))] });
    },
    deleteTransaction: async id => {
      const state = current.current;
      const tx = state.transactions.find(item => item.id === id);
      if (!tx) throw new Error('Операция не найдена.');
      let goals = state.goals;
      if (tx.kind === 'goal_deposit' || tx.kind === 'goal_release') {
        const goal = state.goals.find(item => item.id === tx.goalId && !item.is_archived);
        if (!goal) throw new Error('Нельзя отменить движение архивной цели.');
        const amount = toMinorUnits(goal.current_amount) + (tx.kind === 'goal_deposit' ? -1 : 1) * toMinorUnits(tx.amount);
        if (amount < 0) throw new Error('Деньги из этого взноса уже возвращены.');
        const free = toMinorUnits(totalAccountBalance(state.accounts, state.transactions)) - toMinorUnits(reservedGoals(state.goals));
        if (tx.kind === 'goal_release' && free < toMinorUnits(tx.amount)) throw new Error('Недостаточно свободных денег для восстановления резерва.');
        goals = state.goals.map(item => item.id === goal.id ? { ...item, current_amount: fromMinorUnits(amount), is_completed: amount >= toMinorUnits(item.target_amount) } : item);
      } else if (tx.kind === 'transfer') {
        const target = accountBalances(state.accounts, state.transactions)[tx.targetAccountId || ''] ?? 0;
        if (toMinorUnits(target) < toMinorUnits(tx.amount)) throw new Error('Переведенные деньги уже потрачены.');
      } else if (tx.type === 'income') {
        const reserved = toMinorUnits(reservedGoals(goals));
        if (reserved > 0 && toMinorUnits(totalAccountBalance(state.accounts, state.transactions)) - toMinorUnits(tx.amount) < reserved) throw new Error('Сначала освободите деньги из целей.');
      }
      commit({ ...state, goals, transactions: state.transactions.filter(item => item.id !== id) });
    },
    initializeFinance: async () => {},
    createAccount: async input => {
      const state = current.current;
      const opening = normalizeMoney(input.openingBalance);
      if (!input.name.trim() || opening < 0) throw new Error('Введите название и неотрицательный начальный остаток.');
      commit({ ...state, accounts: [...state.accounts, { id: newId(), household_id: HOUSEHOLD_ID, name: input.name.trim(), kind: input.kind, currency: 'BYN', opening_balance: opening, is_archived: false, created_at: new Date().toISOString() }] });
    },
    transferBetweenAccounts: async input => {
      const state = current.current;
      const amount = positiveMoney(input.amount);
      if (input.fromAccountId === input.toAccountId || ![input.fromAccountId, input.toAccountId].every(id => state.accounts.some(account => account.id === id && !account.is_archived))) throw new Error('Выберите два разных доступных счета.');
      validateDate(input.date);
      if (toMinorUnits(accountBalances(state.accounts, state.transactions)[input.fromAccountId]) < toMinorUnits(amount)) throw new Error('Недостаточно денег на счете отправителя.');
      commit({ ...state, transactions: [...state.transactions, { id: newId(), kind: 'transfer', type: 'expense', amount, categoryId: 'savings', date: input.date, comment: input.comment, addedBy: MEMBER_ID, accountId: input.fromAccountId, targetAccountId: input.toAccountId }] });
    },
    setBudgetLimit: limit => { commit({ ...current.current, budgetLimit: positiveMoney(limit) }); },
    addRecurring: async input => {
      const state = current.current;
      commit(applyDueRecurring({ ...state, recurring: [...state.recurring, { ...input, amount: positiveMoney(input.amount), id: newId(), household_id: HOUSEHOLD_ID, last_applied: null, is_active: true, created_at: new Date().toISOString() }] }));
    },
    deleteRecurring: async id => { commit({ ...current.current, recurring: current.current.recurring.filter(item => item.id !== id) }); },
    addGoal: async input => {
      if (!input.name.trim()) throw new Error('Введите название цели.');
      if (input.deadline) validateDate(input.deadline);
      const state = current.current;
      commit({ ...state, goals: [...state.goals, { ...input, name: input.name.trim(), target_amount: positiveMoney(input.target_amount), current_amount: 0, id: newId(), household_id: HOUSEHOLD_ID, is_completed: false, is_archived: false, created_at: new Date().toISOString() }] });
    },
    deleteGoal: async id => {
      const state = current.current;
      const goal = state.goals.find(item => item.id === id);
      if (!goal || goal.is_archived) return;
      const release: Transaction[] = goal.current_amount > 0 ? [{ id: newId(), kind: 'goal_release', type: 'income', amount: goal.current_amount, categoryId: 'savings', date: localDateISO(), comment: `Архивирование цели: ${goal.name}`, addedBy: MEMBER_ID, goalId: id }] : [];
      commit({ ...state, goals: state.goals.map(item => item.id === id ? { ...item, is_archived: true, current_amount: 0, is_completed: false } : item), transactions: [...state.transactions, ...release] });
    },
    updateGoalAmount: async (id, amount) => { changeGoal(id, amount, false); },
    withdrawGoalAmount: async (id, amount) => { changeGoal(id, amount, true); },
  };
  const notice = <div className="shrink-0 flex items-center justify-between gap-2 bg-slate-950 px-3 py-1.5 text-white" style={{ paddingTop: 'max(6px, env(safe-area-inset-top, 0px))' }}>
    <p className="text-[9px] font-semibold leading-tight">Демо · данные только на этом устройстве</p>
    <button type="button" className="shrink-0 rounded-full border border-white/25 px-2 py-1 text-[9px] font-bold" onClick={() => { commit(applyDueRecurring(fixtures())); setResetVersion(version => version + 1); }}>Сбросить демо</button>
  </div>;
  return <AuthContext.Provider value={DEMO_AUTH}><AppContext.Provider value={context}><AppContent key={resetVersion} notice={notice} /></AppContext.Provider></AuthContext.Provider>;
}
