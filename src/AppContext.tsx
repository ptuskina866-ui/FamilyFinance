import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Account, AccountKind, Transaction, Category, FamilyMember, RecurringTransaction, SavingsGoal } from './types';
import { CATEGORIES } from './mockData';
import { useAuth } from './AuthContext';
import { supabase } from './supabaseClient';
import { accountBalances as calculateAccountBalances, cashflowTotals, reservedGoals, totalAccountBalance, isCashflow } from './lib/finance';
import { fromMinorUnits, localDateISO, toMinorUnits } from './lib/money';

export interface AppContextType {
  transactions: Transaction[]; categories: Category[]; members: FamilyMember[];
  accounts: Account[]; accountBalances: Record<string, number>;
  accountsReady: boolean; schemaReady: boolean; financeLoading: boolean; financeError: string | null;
  balance: number; availableBalance: number; reservedBalance: number;
  monthlyIncome: number; monthlyExpense: number; budgetLimit: number;
  recurringTransactions: RecurringTransaction[]; savingsGoals: SavingsGoal[];
  addTransaction: (tx: Omit<Transaction, 'id'>) => Promise<void>;
  updateTransaction: (id: string, tx: Omit<Transaction, 'id'>) => Promise<void>;
  addTransactionsBatch: (txs: Omit<Transaction, 'id'>[]) => Promise<void>;
  deleteTransaction: (id: string) => Promise<void>;
  initializeFinance: (legacyIds: string[]) => Promise<void>;
  createAccount: (data: { name: string; kind: AccountKind; openingBalance: number }) => Promise<void>;
  transferBetweenAccounts: (data: { fromAccountId: string; toAccountId: string; amount: number; date: string; comment: string }) => Promise<void>;
  setBudgetLimit: (limit: number) => void;
  getCategoryById: (id: string) => Category | undefined;
  getMemberById: (id: string) => FamilyMember | undefined;
  addRecurring: (data: Omit<RecurringTransaction, 'id' | 'household_id' | 'last_applied' | 'is_active' | 'created_at'>) => Promise<void>;
  deleteRecurring: (id: string) => Promise<void>;
  addGoal: (data: Pick<SavingsGoal, 'name' | 'target_amount' | 'emoji' | 'deadline'>) => Promise<void>;
  deleteGoal: (id: string) => Promise<void>;
  updateGoalAmount: (goalId: string, amount: number) => Promise<void>;
  withdrawGoalAmount: (goalId: string, amount: number) => Promise<void>;
}
export const AppContext = createContext<AppContextType | undefined>(undefined);
interface TransactionRow {
  id: string; type: Transaction['type']; amount: number | string;
  category_id: string; comment: string | null; added_by: string | null; date: string;
  kind?: Transaction['kind']; account_id?: string | null; target_account_id?: string | null;
  goal_id?: string | null; recurring_id?: string | null;
}
const money = (amount: number | string) => fromMinorUnits(toMinorUnits(amount));
export const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { profile, user } = useAuth();
  const householdId = profile?.id === user?.id ? profile?.household_id : undefined;
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [members, setMembers] = useState<FamilyMember[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [schemaReady, setSchemaReady] = useState(false);
  const [financeLoading, setFinanceLoading] = useState(true);
  const [financeError, setFinanceError] = useState<string | null>(null);
  const [budgetLimit, setBudgetLimitState] = useState(1500);
  const [recurringTransactions, setRecurringTransactions] = useState<RecurringTransaction[]>([]);
  const [savingsGoals, setSavingsGoals] = useState<SavingsGoal[]>([]);
  const loadVersion = useRef(0);
  const currentHousehold = useRef(householdId);
  currentHousehold.current = householdId;
  const refresh = useCallback(async () => {
    if (!householdId) return;
    const version = ++loadVersion.current;
    const fetchLedger = async () => {
      const rows: TransactionRow[] = [];
      // Hosted PostgREST caps each response. Load the complete ledger for balances.
      for (let offset = 0; ; offset += 500) {
        const result = await supabase.from('transactions').select('*').eq('household_id', householdId)
          .order('date', { ascending: false }).order('created_at', { ascending: false }).order('id')
          .range(offset, offset + 499);
        if (result.error) return { data: rows, error: result.error };
        const page = result.data as unknown as TransactionRow[];
        rows.push(...page);
        if (page.length < 500 || version !== loadVersion.current) return { data: rows, error: null };
      }
    };
    const [txResult, memberResult, accountResult, goalResult, recurringResult] = await Promise.all([
      fetchLedger(),
      supabase.from('profiles').select('id, name, avatar, color').eq('household_id', householdId),
      supabase.from('accounts').select('*').eq('household_id', householdId).order('created_at'),
      supabase.from('savings_goals').select('*').eq('household_id', householdId).order('created_at', { ascending: false }),
      supabase.from('recurring_transactions').select('*').eq('household_id', householdId).eq('is_active', true).order('created_at', { ascending: false })
    ]);
    if (version !== loadVersion.current || currentHousehold.current !== householdId) return;
    const missingSchema = accountResult.error && ['PGRST205', '42P01'].includes(accountResult.error.code);
    const failed = txResult.error || memberResult.error || goalResult.error || recurringResult.error || (!missingSchema && accountResult.error);
    setSchemaReady(!accountResult.error);
    if (failed) { setFinanceError('Не удалось обновить данные. ' + failed.message); setFinanceLoading(false); return; }
    try {
      // Normalize SQL names and exact NUMERIC values at the data boundary.
      const rows = txResult.data as unknown as TransactionRow[];
      setTransactions(rows.map(t => ({ id: t.id, type: t.type, amount: money(t.amount), categoryId: t.category_id,
        comment: t.comment || '', addedBy: t.added_by || '', date: t.date, kind: t.kind || 'cashflow',
        accountId: t.account_id, targetAccountId: t.target_account_id, goalId: t.goal_id, recurringId: t.recurring_id })));
      setMembers(memberResult.data as FamilyMember[]);
      setAccounts((accountResult.data || []).map(a => ({ ...a, opening_balance: money(a.opening_balance) })) as Account[]);
      setSavingsGoals((goalResult.data || []).map(g => ({ ...g, target_amount: money(g.target_amount), current_amount: money(g.current_amount ?? 0) })) as SavingsGoal[]);
      setRecurringTransactions((recurringResult.data || []).map(r => ({ ...r, amount: money(r.amount) })) as RecurringTransaction[]);
      setFinanceError(missingSchema ? 'Для новых счетов и накоплений требуется обновление базы приложения.' : null);
    } catch { setFinanceError('Не удалось прочитать денежные значения. Проверьте данные перед продолжением.'); }
    setFinanceLoading(false);
  }, [householdId]);
  useEffect(() => {
    ++loadVersion.current;
    setTransactions([]); setMembers([]); setAccounts([]); setSavingsGoals([]); setRecurringTransactions([]);
    setSchemaReady(false); setFinanceError(null); setFinanceLoading(!!householdId);
    if (!householdId) return;
    void refresh();
    const channel = supabase.channel(`finance-${householdId}`);
    for (const table of ['transactions', 'profiles', 'accounts', 'savings_goals', 'recurring_transactions']) {
      channel.on('postgres_changes', { event: '*', schema: 'public', table, filter: `household_id=eq.${householdId}` }, () => { void refresh(); });
    }
    channel.subscribe();
    return () => { ++loadVersion.current; void supabase.removeChannel(channel); };
  }, [householdId, refresh]);
  const accountsReady = accounts.length > 0;
  const requireHousehold = () => {
    if (!householdId || !profile) throw new Error('Дождитесь загрузки профиля.');
    return { householdId, profileId: profile.id };
  };
  const requireAccounts = () => {
    requireHousehold();
    if (!schemaReady) throw new Error('Сначала обновите базу приложения для счетов и накоплений.');
    if (!accountsReady) throw new Error('Сначала подключите счета на главной странице.');
  };
  const defaultAccountId = accounts.find(a => !a.is_archived)?.id;
  const runRpc = async (name: string, args: Record<string, unknown>) => {
    requireHousehold();
    const { error } = await supabase.rpc(name, args);
    if (error) throw new Error(error.message);
    await refresh();
  };
  const recurringSignature = recurringTransactions.map(r => `${r.id}:${r.last_applied}:${r.day_of_month}`).join('|');
  useEffect(() => {
    if (!householdId || !schemaReady || !accountsReady) return;
    let active = true;
    void supabase.rpc('apply_due_recurring', { p_today: localDateISO() }).then(async ({ error }) => {
      if (!active) return;
      if (error) setFinanceError('Не удалось применить регулярные операции. ' + error.message);
      else await refresh();
    });
    return () => { active = false; };
  }, [householdId, schemaReady, accountsReady, recurringSignature, refresh]);
  useEffect(() => {
    if (!householdId) return;
    const stored = localStorage.getItem(`ff_budget_limit:${householdId}`) || localStorage.getItem('ff_budget_limit');
    setBudgetLimitState(stored && Number.isFinite(Number(stored)) && Number(stored) > 0 ? Number(stored) : 1500);
  }, [householdId]);
  const transactionRecord = (tx: Omit<Transaction, 'id'>) => {
    const own = requireHousehold();
    if (!isCashflow(tx as Transaction)) throw new Error('Переводы и резервы изменяются отдельным действием.');
    if (toMinorUnits(tx.amount) <= 0) throw new Error('Укажите положительную сумму.');
    const record = { type: tx.type, amount: money(tx.amount), category_id: tx.categoryId, comment: tx.comment,
      added_by: tx.addedBy || own.profileId, household_id: own.householdId, date: tx.date };
    if (!schemaReady) return record;
    if (!accountsReady) throw new Error('Сначала подключите счета на главной странице.');
    const accountId = tx.accountId || defaultAccountId;
    if (!accounts.some(a => a.id === accountId && !a.is_archived)) throw new Error('Выберите доступный счет.');
    return { ...record, kind: 'cashflow', account_id: accountId };
  };
  const addTransaction = async (tx: Omit<Transaction, 'id'>) => {
    const { error } = await supabase.from('transactions').insert(transactionRecord(tx));
    if (error) throw new Error(error.message);
    await refresh();
  };
  const updateTransaction = async (id: string, tx: Omit<Transaction, 'id'>) => {
    if (!transactions.some(t => t.id === id && isCashflow(t))) throw new Error('Эту операцию нельзя редактировать как доход или расход.');
    requireAccounts();
    const record = transactionRecord(tx);
    await runRpc('update_finance_transaction', { p_id: id, p_type: record.type, p_amount: record.amount,
      p_category_id: record.category_id, p_comment: record.comment, p_added_by: record.added_by,
      p_date: record.date, p_account_id: tx.accountId || defaultAccountId });
  };
  const addTransactionsBatch = async (txs: Omit<Transaction, 'id'>[]) => {
    if (!txs.length) return;
    const { error } = await supabase.from('transactions').insert(txs.map(transactionRecord));
    if (error) throw new Error(error.message);
    await refresh();
  };
  const deleteTransaction = async (id: string) => {
    if (schemaReady && accountsReady) return runRpc('delete_finance_transaction', { p_id: id });
    const tx = transactions.find(t => t.id === id);
    if (tx?.comment.includes('[goal_id:')) throw new Error('Для изменения истории копилки сначала подключите счета.');
    const { error } = await supabase.from('transactions').delete().eq('id', id).eq('household_id', requireHousehold().householdId);
    if (error) throw new Error(error.message);
    await refresh();
  };
  const initializeFinance = async (legacyIds: string[]) => {
    if (!schemaReady) throw new Error('Сначала обновите базу приложения.');
    await runRpc('initialize_finance', { p_legacy_transaction_ids: legacyIds });
  };
  const createAccount = async (data: { name: string; kind: AccountKind; openingBalance: number }) => {
    requireAccounts();
    await runRpc('create_finance_account', { p_name: data.name.trim(), p_kind: data.kind, p_opening_balance: money(data.openingBalance) });
  };
  const transferBetweenAccounts = async (data: { fromAccountId: string; toAccountId: string; amount: number; date: string; comment: string }) => {
    requireAccounts();
    await runRpc('transfer_finance', { p_from: data.fromAccountId, p_to: data.toAccountId, p_amount: money(data.amount), p_date: data.date, p_comment: data.comment });
  };
  const addRecurring = async (data: Omit<RecurringTransaction, 'id' | 'household_id' | 'last_applied' | 'is_active' | 'created_at'>) => {
    requireAccounts();
    const { error } = await supabase.from('recurring_transactions').insert({ ...data, amount: money(data.amount), household_id: requireHousehold().householdId, is_active: true, account_id: defaultAccountId });
    if (error) throw new Error(error.message);
    await refresh();
  };
  const deleteRecurring = async (id: string) => {
    const { error } = await supabase.from('recurring_transactions').delete().eq('id', id).eq('household_id', requireHousehold().householdId);
    if (error) throw new Error(error.message);
    await refresh();
  };
  const addGoal = async (data: Pick<SavingsGoal, 'name' | 'target_amount' | 'emoji' | 'deadline'>) => {
    requireAccounts();
    const { error } = await supabase.from('savings_goals').insert({ ...data, target_amount: money(data.target_amount), household_id: requireHousehold().householdId, current_amount: 0, is_completed: false });
    if (error) throw new Error(error.message);
    await refresh();
  };
  const deleteGoal = async (id: string) => { requireAccounts(); await runRpc('archive_savings_goal', { p_goal_id: id, p_date: localDateISO() }); };
  const updateGoalAmount = async (goalId: string, amount: number) => {
    requireAccounts();
    if (toMinorUnits(amount) <= 0) throw new Error('Укажите положительную сумму.');
    await runRpc('change_goal_funds', { p_goal_id: goalId, p_amount: money(amount), p_date: localDateISO() });
  };
  const withdrawGoalAmount = async (goalId: string, amount: number) => {
    requireAccounts();
    if (toMinorUnits(amount) <= 0) throw new Error('Укажите положительную сумму.');
    await runRpc('change_goal_funds', { p_goal_id: goalId, p_amount: -money(amount), p_date: localDateISO() });
  };
  const setBudgetLimit = (limit: number) => {
    requireHousehold(); setBudgetLimitState(money(limit));
    localStorage.setItem(`ff_budget_limit:${householdId}`, String(limit));
  };
  const balances = calculateAccountBalances(accounts, transactions);
  const balance = accountsReady ? totalAccountBalance(accounts, transactions) : cashflowTotals(transactions).net;
  const reservedBalance = reservedGoals(savingsGoals);
  // Legacy deposits already reduce the balance until the reviewed migration is accepted.
  const availableBalance = accountsReady ? fromMinorUnits(toMinorUnits(balance) - toMinorUnits(reservedBalance)) : balance;
  const monthly = cashflowTotals(transactions.filter(t => t.date.startsWith(localDateISO().slice(0, 7))));
  return <AppContext.Provider value={{ transactions, categories: CATEGORIES, members, accounts, accountBalances: balances,
    accountsReady, schemaReady, financeLoading, financeError, balance, availableBalance, reservedBalance,
    monthlyIncome: monthly.income, monthlyExpense: monthly.expense, budgetLimit, recurringTransactions, savingsGoals,
    addTransaction, updateTransaction, addTransactionsBatch, deleteTransaction, initializeFinance, createAccount, transferBetweenAccounts,
    setBudgetLimit, getCategoryById: id => CATEGORIES.find(c => c.id === id), getMemberById: id => members.find(m => m.id === id),
    addRecurring, deleteRecurring, addGoal, deleteGoal, updateGoalAmount, withdrawGoalAmount }}>{children}</AppContext.Provider>;
};
export const useApp = () => {
  const context = useContext(AppContext);
  if (!context) throw new Error('useApp must be used within an AppProvider');
  return context;
};
