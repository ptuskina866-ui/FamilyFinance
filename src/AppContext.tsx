import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Account, AccountKind, Transaction, Category, FamilyMember, RecurringTransaction, SavingsGoal, CategoryBudget, IncomeAllocation, IncomeDistribution, IncomeTemplate, IncomeTemplateItem, BudgetRollover, BudgetRolloverMode, DistributionRevision, FundInput } from './types';
import { CATEGORIES } from './mockData';
import { useAuth } from './AuthContext';
import { supabase } from './supabaseClient';
import { accountBalances as calculateAccountBalances, cashflowTotals, reservedGoals, totalAccountBalance, isCashflow } from './lib/finance';
import { fromMinorUnits, localDateISO, toMinorUnits } from './lib/money';
import { allocationTotal, budgetReserved, planningDateISO, planningErrorMessage } from './lib/planning';
import { previousPlanningMonth, resolveIncomeTemplate } from './lib/flexiblePlanning';
import type { PriorImportSnapshot, PriorImportSelection, PriorImportCheck, PriorImportResult } from './types';
import { priorImportError } from './lib/priorImport';

export interface AppContextType {
  transactions: Transaction[]; categories: Category[]; members: FamilyMember[];
  accounts: Account[]; accountBalances: Record<string, number>;
  accountsReady: boolean; schemaReady: boolean; financeLoading: boolean; financeError: string | null;
  balance: number; availableBalance: number; reservedBalance: number;
  monthlyIncome: number; monthlyExpense: number; budgetLimit: number;
  recurringTransactions: RecurringTransaction[]; savingsGoals: SavingsGoal[];
  categoryBudgets: CategoryBudget[]; incomeDistributions: IncomeDistribution[]; planningReady: boolean; budgetReservedBalance: number;
  setCategoryBudget: (categoryId: string, amount: number) => Promise<void>;
  distributeIncome: (incomeId: string, items: IncomeAllocation[]) => Promise<void>;
  flexiblePlanningReady: boolean; incomeTemplates: IncomeTemplate[]; budgetRollovers: BudgetRollover[]; distributionRevisions: DistributionRevision[];
  transferCategoryBudget: (from: string, to: string, amount: number) => Promise<void>;
  changeIncomeDistribution: (id: string, items: IncomeAllocation[] | null, revision: number, refund: IncomeAllocation[]) => Promise<void>;
  saveIncomeTemplate: (id: string | null, name: string, items: IncomeTemplateItem[]) => Promise<void>;
  archiveIncomeTemplate: (id: string) => Promise<void>;
  reviewBudgetMonth: (mode: BudgetRolloverMode, goalId: string | null, preview: IncomeAllocation[]) => Promise<void>;
  saveFund: (data: FundInput) => Promise<void>;
  addTransaction: (tx: Omit<Transaction, 'id'>) => Promise<void>;
  updateTransaction: (id: string, tx: Omit<Transaction, 'id'>) => Promise<void>;
  addTransactionsBatch: (txs: Omit<Transaction, 'id'>[]) => Promise<void>;
  previewPriorImport: (accountId: string, snapshot: PriorImportSnapshot) => Promise<PriorImportCheck>;
  importPriorOperations: (accountId: string, snapshot: PriorImportSnapshot, items: PriorImportSelection[]) => Promise<PriorImportResult>;
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
  goal_id?: string | null; recurring_id?: string | null; income_distribution_id?: string | null;
  import_origin?: Transaction['importOrigin'];
}
type BudgetRow = Omit<CategoryBudget, 'allocated_amount'> & { allocated_amount: number | string };
type DistributionRow = Omit<IncomeDistribution, 'total_amount' | 'items'> & { total_amount: number | string; items: (Omit<IncomeAllocation,'amount'> & {amount:number | string})[] };
type TemplateRow = Omit<IncomeTemplate, 'items'> & {items:(Omit<IncomeTemplateItem,'value'> & {value:number | string})[]};
type RolloverRow = Omit<BudgetRollover,'amount'> & {amount:number | string};
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
  const [categoryBudgets, setCategoryBudgets] = useState<CategoryBudget[]>([]);
  const [incomeDistributions, setIncomeDistributions] = useState<IncomeDistribution[]>([]);
  const [planningReady, setPlanningReady] = useState(false);
  const [flexiblePlanningReady,setFlexiblePlanningReady] = useState(false);
  const [incomeTemplates,setIncomeTemplates] = useState<IncomeTemplate[]>([]);
  const [budgetRollovers,setBudgetRollovers] = useState<BudgetRollover[]>([]);
  const [distributionRevisions,setDistributionRevisions] = useState<DistributionRevision[]>([]);
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
    const fetchPlanning = async <T,>(table: 'category_budgets' | 'income_distributions' | 'income_templates' | 'budget_rollovers' | 'income_distribution_revisions') => {
      const rows: T[] = [];
      for (let offset = 0; ; offset += 500) {
        let request = supabase.from(table).select('*').eq('household_id', householdId);
        if (table === 'category_budgets') request = request.gte('month',previousPlanningMonth());
        if (table === 'income_distributions') request = request.eq('month',`${planningDateISO().slice(0,7)}-01`);
        if (table === 'income_templates') request = request.eq('is_archived',false);
        const result = await request.order('created_at').order('id').range(offset,offset+499);
        if (result.error) return {data:rows,error:result.error};
        rows.push(...result.data as unknown as T[]);
        if (result.data.length < 500 || version !== loadVersion.current) return {data:rows,error:null};
      }
    };
    const [txResult, memberResult, accountResult, goalResult, recurringResult, budgetResult, distributionResult,templateResult,rolloverResult,revisionResult] = await Promise.all([
      fetchLedger(),
      supabase.from('profiles').select('id, name, avatar, color').eq('household_id', householdId),
      supabase.from('accounts').select('*').eq('household_id', householdId).order('created_at'),
      supabase.from('savings_goals').select('*').eq('household_id', householdId).order('created_at', { ascending: false }),
      supabase.from('recurring_transactions').select('*').eq('household_id', householdId).eq('is_active', true).order('created_at', { ascending: false }),
      fetchPlanning<BudgetRow>('category_budgets'),
      fetchPlanning<DistributionRow>('income_distributions'),
      fetchPlanning<TemplateRow>('income_templates'),fetchPlanning<RolloverRow>('budget_rollovers'),fetchPlanning<DistributionRevision>('income_distribution_revisions')
    ]);
    if (version !== loadVersion.current || currentHousehold.current !== householdId) return;
    const missingSchema = accountResult.error && ['PGRST205', '42P01'].includes(accountResult.error.code);
    const planningMissing = [budgetResult.error, distributionResult.error].some(error => error && ['PGRST205', '42P01'].includes(error.code));
    const flexErrors=[templateResult.error,rolloverResult.error,revisionResult.error];
    const flexMissing=flexErrors.some(error=>error && ['PGRST205','42P01'].includes(error.code));
    const failed = txResult.error || memberResult.error || goalResult.error || recurringResult.error || (!missingSchema && accountResult.error)
      || (!planningMissing && (budgetResult.error || distributionResult.error)) || (!flexMissing && flexErrors.find(Boolean));
    setFlexiblePlanningReady(flexErrors.every(error=>!error));
    setPlanningReady(!budgetResult.error && !distributionResult.error);
    setSchemaReady(!accountResult.error);
    if (failed) { setFinanceError('Не удалось обновить данные. ' + failed.message); setFinanceLoading(false); return; }
    try {
      // Normalize SQL names and exact NUMERIC values at the data boundary.
      const rows = txResult.data as unknown as TransactionRow[];
      setTransactions(rows.map(t => ({ id: t.id, type: t.type, amount: money(t.amount), categoryId: t.category_id,
        comment: t.comment || '', addedBy: t.added_by || '', date: t.date, kind: t.kind || 'cashflow',
        accountId: t.account_id, targetAccountId: t.target_account_id, goalId: t.goal_id, recurringId: t.recurring_id, incomeDistributionId: t.income_distribution_id, importOrigin: t.import_origin })));
      setMembers(memberResult.data as FamilyMember[]);
      setAccounts((accountResult.data || []).map(a => ({ ...a, opening_balance: money(a.opening_balance) })) as Account[]);
      setSavingsGoals((goalResult.data || []).map(g => ({ ...g, target_amount: money(g.target_amount), current_amount: money(g.current_amount ?? 0), essential_amount:g.essential_amount == null ? null : money(g.essential_amount) })) as SavingsGoal[]);
      setRecurringTransactions((recurringResult.data || []).map(r => ({ ...r, amount: money(r.amount) })) as RecurringTransaction[]);
      setCategoryBudgets((budgetResult.data || []).map(b => ({ ...b, allocated_amount: money(b.allocated_amount) })) as CategoryBudget[]);
      setIncomeDistributions((distributionResult.data || []).map(d => ({ ...d, total_amount: money(d.total_amount), items: d.items.map(i => ({ ...i, amount: money(i.amount) })) })));
      setIncomeTemplates((templateResult.data || []).map(t=>({...t,items:t.items.map(i=>({...i,value:money(i.value)}))})));
      setBudgetRollovers((rolloverResult.data || []).map(r=>({...r,amount:money(r.amount)})));
      setDistributionRevisions(revisionResult.data || []);
      setFinanceError(missingSchema ? 'Для новых счетов и накоплений требуется обновление базы приложения.' : null);
    } catch { setFinanceError('Не удалось прочитать денежные значения. Проверьте данные перед продолжением.'); }
    setFinanceLoading(false);
  }, [householdId]);
  useEffect(() => {
    ++loadVersion.current;
    setTransactions([]); setMembers([]); setAccounts([]); setSavingsGoals([]); setRecurringTransactions([]);
    setCategoryBudgets([]); setIncomeDistributions([]); setPlanningReady(false);
    setIncomeTemplates([]);setBudgetRollovers([]);setDistributionRevisions([]);setFlexiblePlanningReady(false);
    setSchemaReady(false); setFinanceError(null); setFinanceLoading(!!householdId);
    if (!householdId) return;
    void refresh();
    const channel = supabase.channel(`finance-${householdId}`);
    for (const table of ['transactions', 'profiles', 'accounts', 'savings_goals', 'recurring_transactions', 'category_budgets', 'income_distributions','income_templates','budget_rollovers','income_distribution_revisions']) {
      channel.on('postgres_changes', { event: '*', schema: 'public', table, filter: `household_id=eq.${householdId}` }, () => { void refresh(); });
    }
    channel.subscribe();
    const onReturn = () => { if(document.visibilityState==='visible') void refresh(); };
    document.addEventListener('visibilitychange',onReturn);
    window.addEventListener('online',onReturn);
    let loadedDay = planningDateISO();
    const clock = window.setInterval(() => {
      const day = planningDateISO();
      if (day !== loadedDay) {loadedDay = day; void refresh();}
    },60_000);
    return () => { window.clearInterval(clock); document.removeEventListener('visibilitychange',onReturn); window.removeEventListener('online',onReturn); ++loadVersion.current; void supabase.removeChannel(channel); };
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
    if (error) throw new Error(planningErrorMessage(error.message));
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
  const previewPriorImport = async (accountId: string, snapshot: PriorImportSnapshot): Promise<PriorImportCheck> => {
    requireAccounts();
    const { data, error } = await supabase.rpc('preview_prior_import', { p_account_id: accountId, p_snapshot: snapshot });
    if (error) throw new Error(priorImportError(`${error.code} ${error.message}`));
    return data as PriorImportCheck;
  };
  const importPriorOperations = async (accountId: string, snapshot: PriorImportSnapshot, items: PriorImportSelection[]): Promise<PriorImportResult> => {
    requireAccounts();
    const { data, error } = await supabase.rpc('import_prior_operations', { p_account_id: accountId, p_snapshot: snapshot, p_items: items });
    if (error) throw new Error(priorImportError(`${error.code} ${error.message}`));
    // Keep the result even if a subsequent ledger refresh fails: retry is idempotent.
    await refresh();
    return data as PriorImportResult;
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
  const budgetReservedBalance = budgetReserved(categoryBudgets, transactions);
  const setCategoryBudget = async (categoryId: string, amount: number) => {
    requireAccounts();
    if (!planningReady) throw new Error('Бюджеты появятся после обновления приложения.');
    await runRpc('set_category_budget', { p_category_id: categoryId, p_amount: money(amount), p_month: `${planningDateISO().slice(0,7)}-01` });
  };
  const distributeIncome = async (incomeId: string, items: IncomeAllocation[]) => {
    requireAccounts();
    if (!planningReady) throw new Error('Распределение появится после обновления приложения.');
    allocationTotal(items);
    await runRpc('distribute_income', { p_income_id: incomeId, p_items: items, p_month: `${planningDateISO().slice(0,7)}-01` });
  };
  const requireFlexiblePlanning = () => {requireAccounts();if (!flexiblePlanningReady) throw new Error('Новые инструменты появятся после обновления приложения.');};
  const transferCategoryBudget = async (from:string,to:string,amount:number) => {
    requireFlexiblePlanning();await runRpc('transfer_category_budget',{p_from:from,p_to:to,p_amount:money(amount),p_month:`${planningDateISO().slice(0,7)}-01`});
  };
  const changeIncomeDistribution = async (id:string,items:IncomeAllocation[] | null,revision:number,refund:IncomeAllocation[]) => {
    requireFlexiblePlanning();if(items) allocationTotal(items);
    await runRpc('change_income_distribution',{p_id:id,p_items:items,p_expected_revision:revision,p_refund_preview:refund});
  };
  const saveIncomeTemplate = async (id:string | null,name:string,items:IncomeTemplateItem[]) => {
    requireFlexiblePlanning();resolveIncomeTemplate(items,1,1);await runRpc('save_income_template',{p_id:id,p_name:name,p_items:items});
  };
  const archiveIncomeTemplate = async (id:string) => {requireFlexiblePlanning();await runRpc('archive_income_template',{p_id:id});};
  const reviewBudgetMonth = async (mode:BudgetRolloverMode,goalId:string | null,preview:IncomeAllocation[]) => {
    requireFlexiblePlanning();await runRpc('review_budget_month',{p_mode:mode,p_goal_id:goalId,p_preview:preview});
  };
  const saveFund = async (data:FundInput) => {
    requireFlexiblePlanning();await runRpc('save_finance_fund',{p_id:data.id || null,p_name:data.name,p_purpose:data.purpose,p_target:money(data.targetAmount),p_deadline:data.deadline,p_essential:data.essentialAmount == null ? null : money(data.essentialAmount),p_months:data.reserveMonths ?? null,p_categories:data.essentialCategories || []});
  };
  // Legacy deposits already reduce the balance until the reviewed migration is accepted.
  const availableBalance = accountsReady ? fromMinorUnits(toMinorUnits(balance) - toMinorUnits(reservedBalance) - toMinorUnits(budgetReservedBalance)) : balance;
  const monthly = cashflowTotals(transactions.filter(t => t.date.startsWith(localDateISO().slice(0, 7))));
  return <AppContext.Provider value={{ transactions, categories: CATEGORIES, members, accounts, accountBalances: balances,
    accountsReady, schemaReady, financeLoading, financeError, balance, availableBalance, reservedBalance,
    monthlyIncome: monthly.income, monthlyExpense: monthly.expense, budgetLimit, recurringTransactions, savingsGoals,
    categoryBudgets, incomeDistributions, planningReady, budgetReservedBalance, setCategoryBudget, distributeIncome,
    flexiblePlanningReady,incomeTemplates,budgetRollovers,distributionRevisions,transferCategoryBudget,changeIncomeDistribution,saveIncomeTemplate,archiveIncomeTemplate,reviewBudgetMonth,saveFund,
    addTransaction, updateTransaction, addTransactionsBatch, previewPriorImport, importPriorOperations, deleteTransaction, initializeFinance, createAccount, transferBetweenAccounts,
    setBudgetLimit, getCategoryById: id => CATEGORIES.find(c => c.id === id), getMemberById: id => members.find(m => m.id === id),
    addRecurring, deleteRecurring, addGoal, deleteGoal, updateGoalAmount, withdrawGoalAmount }}>{children}</AppContext.Provider>;
};
export const useApp = () => {
  const context = useContext(AppContext);
  if (!context) throw new Error('useApp must be used within an AppProvider');
  return context;
};
