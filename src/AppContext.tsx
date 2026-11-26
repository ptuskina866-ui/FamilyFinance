import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Account, AccountKind, Transaction, Category, FamilyMember, RecurringTransaction, SavingsGoal, CategoryBudget, IncomeAllocation, IncomeDistribution, IncomeTemplate, IncomeTemplateItem, BudgetRollover, BudgetRolloverMode, DistributionRevision, FundInput } from './types';
import { CATEGORIES } from './mockData';
import { useAuth } from './AuthContext';
import { supabase } from './supabaseClient';
import { accountBalances as calculateAccountBalances, cashflowTotals, reservedGoals, isCashflow } from './lib/finance';
import { fromMinorUnits, localDateISO, sumMoney, toMinorUnits } from './lib/money';
import { allocationTotal, budgetReserved, planningDateISO, planningErrorMessage } from './lib/planning';
import { previousPlanningMonth, resolveIncomeTemplate } from './lib/flexiblePlanning';
import type { PriorImportSnapshot, PriorImportSelection, PriorImportCheck, PriorImportResult, PriorBankEvent, MerchantRule } from './types';
import { priorImportError } from './lib/priorImport';
import { createFinanceRefresh } from './lib/financeRefresh';

export interface AppContextType {
  merchantRules:MerchantRule[];smartRulesReady:boolean;
  confirmBankBill:(evidence:string[])=>Promise<void>;
  deleteMerchantRule:(id:string)=>Promise<void>;
  transactions: Transaction[]; categories: Category[]; members: FamilyMember[];
  accounts: Account[]; accountBalances: Record<string, number>;
  accountsReady: boolean; schemaReady: boolean; financeLoading: boolean; financeError: string | null;
  journalAvailable?: boolean; plansAvailable?: boolean; plansError?: string | null; refreshFinance?: () => void;
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
  addTransaction: (tx: Omit<Transaction, 'id'>, requestId?: string) => Promise<void>;
  updateTransaction: (id: string, tx: Omit<Transaction, 'id'>,learning?:{remember:boolean;name:string}) => Promise<void>;
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
  recurring_month?:string|null;
}
type BudgetRow = Omit<CategoryBudget, 'allocated_amount'> & { allocated_amount: number | string };
type DistributionRow = Omit<IncomeDistribution, 'total_amount' | 'items'> & { total_amount: number | string; items: (Omit<IncomeAllocation,'amount'> & {amount:number | string})[] };
type TemplateRow = Omit<IncomeTemplate, 'items'> & {items:(Omit<IncomeTemplateItem,'value'> & {value:number | string})[]};
type RolloverRow = Omit<BudgetRollover,'amount'> & {amount:number | string};
const money = (amount: number | string) => fromMinorUnits(toMinorUnits(amount));
const financeGroups = ['journal', 'plans', 'bank', 'tools'] as const;
type FinanceGroup = typeof financeGroups[number];
const financeTables = {
  transactions: 'journal', profiles: 'journal', accounts: 'journal',
  savings_goals: 'plans', recurring_transactions: 'plans', category_budgets: 'plans', income_distributions: 'plans',
  prior_bank_events: 'bank', income_templates: 'tools', budget_rollovers: 'tools',
  income_distribution_revisions: 'tools', merchant_rules: 'tools',
} satisfies Record<string, FinanceGroup>;
const journalBankFields = 'id,transaction_id,state,bank_amount,applied_amount,original_amount,original_currency,description,day,reason,suppressed,observed_state,history,merchant_key,merchant_name,rule_category';
const categoriesById = new Map(CATEGORIES.map(category => [category.id, category]));
const getCategoryById = (id: string) => categoriesById.get(id);
const isMissingTable = (error: { code: string } | null) => !!error && ['PGRST205', '42P01'].includes(error.code);
const transactionFromRow = (t: TransactionRow): Transaction => ({
  id: t.id, type: t.type, amount: money(t.amount), categoryId: t.category_id,
  comment: t.comment ?? '', addedBy: t.added_by ?? '', date: t.date, kind: t.kind ?? 'cashflow',
  accountId: t.account_id, targetAccountId: t.target_account_id, goalId: t.goal_id,
  recurringId: t.recurring_id, recurringMonth: t.recurring_month, incomeDistributionId: t.income_distribution_id,
  importOrigin: t.import_origin,
});
const writeError = (status: number, error: { code: string; message: string }, safeRetry = false) => {
  if (!status || status >= 500 || error.code === '57014') {
    return new Error(safeRetry
      ? 'Сервер не подтвердил сохранение. Можно повторить сохранение этой операции.'
      : 'Сервер не подтвердил изменение. Проверьте журнал перед повторной попыткой.');
  }
  return new Error(planningErrorMessage(error.message));
};

export const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { profile, user } = useAuth();
  const householdId = profile?.id === user?.id ? profile?.household_id ?? undefined : undefined;
  return <HouseholdFinance key={`${user?.id ?? ''}:${householdId ?? ''}`} householdId={householdId}>{children}</HouseholdFinance>;
};

const HouseholdFinance: React.FC<{ children: React.ReactNode; householdId?: string }> = ({ children, householdId }) => {
  const { profile } = useAuth();
  const [ledger, setLedger] = useState<Transaction[]>([]);
  const [merchantRules,setMerchantRules]=useState<MerchantRule[]>([]),[smartRulesReady,setSmartRulesReady]=useState(false);
  const [members, setMembers] = useState<FamilyMember[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [schemaReady, setSchemaReady] = useState(false);
  const [financeLoading, setFinanceLoading] = useState(!!householdId);
  const [journalAvailable, setJournalAvailable] = useState(false);
  const [financeError, setFinanceError] = useState<string | null>(null);
  const [plansAvailable, setPlansAvailable] = useState(false);
  const [plansError, setPlansError] = useState<string | null>(null);
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
  const refreshQueue = useRef<ReturnType<typeof createFinanceRefresh<FinanceGroup>> | null>(null);
  const ledgerRevision = useRef(0);
  const [bankEvents, setBankEvents] = useState<PriorBankEvent[]>([]);
  const [planningDay, setPlanningDay] = useState(planningDateISO);
  const refresh = useCallback(() => refreshQueue.current?.request(financeGroups), []);

  useEffect(() => {
    if (!householdId) return;
    const pageSize = 500;
    const fetchPages = async <T,>(table: Parameters<typeof supabase.from>[0], signal: AbortSignal) => {
      const rows: T[] = [];
      for (let offset = 0; !signal.aborted; offset += pageSize) {
        let query = supabase.from(table).select(table === 'prior_bank_events' ? journalBankFields : '*')
          .eq('household_id', householdId);
        if (table === 'category_budgets') query = query.gte('month', previousPlanningMonth());
        if (table === 'income_distributions') query = query.eq('month', `${planningDateISO().slice(0, 7)}-01`);
        if (table === 'income_templates') query = query.eq('is_archived', false);
        if (table === 'prior_bank_events') query = query.not('transaction_id', 'is', null);
        if (table === 'transactions') query = query.order('date', { ascending: false });
        const result = await query.order('created_at', { ascending: table !== 'transactions' })
          .order('id').range(offset, offset + pageSize - 1).abortSignal(signal).retry(false);
        if (result.error) return { data: rows, error: result.error };
        rows.push(...result.data as unknown as T[]);
        if (result.data.length < pageSize) break;
      }
      return { data: rows, error: null };
    };

    const load = async (group: FinanceGroup, signal: AbortSignal) => {
      try {
        if (group === 'journal') {
          const revision = ledgerRevision.current;
          const [ledger, people, accountList] = await Promise.all([
            fetchPages<TransactionRow>('transactions', signal),
            supabase.from('profiles').select('id, name, avatar, color').eq('household_id', householdId).abortSignal(signal).retry(false),
            supabase.from('accounts').select('*').eq('household_id', householdId).order('created_at').abortSignal(signal).retry(false),
          ]);
          if (signal.aborted || revision !== ledgerRevision.current) return;
          const legacy = isMissingTable(accountList.error);
          if (ledger.error || people.error || (accountList.error && !legacy)) throw new Error('journal read failed');
          const parsedLedger = ledger.data.map(transactionFromRow);
          const parsedAccounts = (accountList.data ?? []).map(a => ({ ...a, opening_balance: money(a.opening_balance) })) as Account[];
          setLedger(parsedLedger);
          setMembers(people.data as FamilyMember[]);
          setAccounts(parsedAccounts);
          setSchemaReady(!legacy);
          setJournalAvailable(true);
          setFinanceError(legacy ? 'Для счетов и накоплений требуется обновление базы приложения.' : null);
        } else if (group === 'plans') {
          const [goals, recurring, budgets, distributions] = await Promise.all([
            supabase.from('savings_goals').select('*').eq('household_id', householdId).order('created_at', { ascending: false }).abortSignal(signal).retry(false),
            supabase.from('recurring_transactions').select('*').eq('household_id', householdId).eq('is_active', true).order('created_at', { ascending: false }).abortSignal(signal).retry(false),
            fetchPages<BudgetRow>('category_budgets', signal),
            fetchPages<DistributionRow>('income_distributions', signal),
          ]);
          if (signal.aborted) return;
          if (goals.error || recurring.error || (budgets.error && !isMissingTable(budgets.error))) throw new Error('plans read failed');
          const parsedGoals = (goals.data ?? []).map(g => ({ ...g, target_amount: money(g.target_amount), current_amount: money(g.current_amount ?? 0), essential_amount: g.essential_amount == null ? null : money(g.essential_amount) })) as SavingsGoal[];
          const parsedRecurring = (recurring.data ?? []).map(r => ({ ...r, amount: money(r.amount) })) as RecurringTransaction[];
          setSavingsGoals(parsedGoals);
          setRecurringTransactions(parsedRecurring);
          if (!budgets.error) setCategoryBudgets(budgets.data.map(b => ({ ...b, allocated_amount: money(b.allocated_amount) })));
          if (!distributions.error) setIncomeDistributions(distributions.data.map(d => ({ ...d, total_amount: money(d.total_amount), items: d.items.map(i => ({ ...i, amount: money(i.amount) })) })));
          setPlanningReady(!budgets.error && !distributions.error);
          setPlansAvailable(true);
          setPlansError(distributions.error && !isMissingTable(distributions.error) ? 'Не удалось обновить распределения доходов.' : null);
        } else if (group === 'tools') {
          const [templates, rollovers, revisions, rules] = await Promise.all([
            fetchPages<TemplateRow>('income_templates', signal),
            fetchPages<RolloverRow>('budget_rollovers', signal),
            fetchPages<DistributionRevision>('income_distribution_revisions', signal),
            fetchPages<MerchantRule>('merchant_rules', signal),
          ]);
          if (signal.aborted) return;
          if (!templates.error) setIncomeTemplates(templates.data.map(t => ({ ...t, items: t.items.map(i => ({ ...i, value: money(i.value) })) })));
          if (!rollovers.error) setBudgetRollovers(rollovers.data.map(r => ({ ...r, amount: money(r.amount) })));
          if (!revisions.error) setDistributionRevisions(revisions.data);
          if (!rules.error) setMerchantRules(rules.data);
          setFlexiblePlanningReady(!templates.error && !rollovers.error && !revisions.error);
          setSmartRulesReady(!rules.error);
        } else {
          const result = await fetchPages<PriorBankEvent>('prior_bank_events', signal);
          if (!signal.aborted && !result.error) setBankEvents(result.data);
        }
      } catch {
        if (signal.aborted) return;
        if (group === 'journal') setFinanceError('Не удалось обновить журнал и счета. Повторите загрузку.');
        if (group === 'plans') setPlansError('Не удалось обновить бюджеты и накопления. Повторите загрузку.');
      } finally {
        if (group === 'journal' && !signal.aborted) setFinanceLoading(false);
      }
    };

    const queue = createFinanceRefresh(load);
    refreshQueue.current = queue;
    queue.request(['journal']);
    const channel = supabase.channel(`finance-${householdId}`);
    for (const [table, group] of Object.entries(financeTables)) {
      channel.on('postgres_changes', { event: '*', schema: 'public', table, filter: `household_id=eq.${householdId}` }, () => {
        queue.request([group]);
      });
    }
    // Give the first journal batch a head start before the optional reads.
    const secondary = window.setTimeout(() => queue.request(['plans', 'bank', 'tools']), 300);
    let subscribed = false;
    channel.subscribe(status => {
      if (status !== 'SUBSCRIBED') return;
      if (subscribed) refresh();
      subscribed = true;
    });
    let lastReturn = 0;
    const onReturn = () => {
      if (document.visibilityState !== 'visible' || Date.now() - lastReturn < 1_500) return;
      lastReturn = Date.now();
      setPlanningDay(planningDateISO());
      refresh();
    };
    document.addEventListener('visibilitychange', onReturn);
    window.addEventListener('online', onReturn);
    let loadedDay = planningDateISO();
    const clock = window.setInterval(() => {
      const day = planningDateISO();
      if (day !== loadedDay) {
        loadedDay = day;
        setPlanningDay(day);
        queue.request(['plans', 'tools']);
      }
    }, 60_000);
    return () => {
      queue.dispose();
      refreshQueue.current = null;
      window.clearTimeout(secondary);
      window.clearInterval(clock);
      document.removeEventListener('visibilitychange', onReturn);
      window.removeEventListener('online', onReturn);
      void supabase.removeChannel(channel);
    };
  }, [householdId, refresh]);

  const transactions = useMemo(() => {
    if (!bankEvents.length) return ledger;
    const events = new Map(bankEvents.map(e => [e.transaction_id, e]));
    return ledger.map(transaction => {
      const event = events.get(transaction.id);
      return event ? { ...transaction, bankEvent: event } : transaction;
    });
  }, [ledger, bankEvents]);
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
  const refreshJournal = () => {
    ledgerRevision.current += 1;
    refreshQueue.current?.request(['journal']);
  };
  const showConfirmedTransaction = (tx: Transaction) => {
    setLedger(previous => [tx, ...previous.filter(item => item.id !== tx.id)].sort((a, b) => b.date.localeCompare(a.date)));
    refreshJournal();
  };
  const runRpc = async (name: string, args: Record<string, unknown>) => {
    requireHousehold();
    const { data, error, status } = await supabase.rpc(name, args).retry(false);
    if (error) throw writeError(status, error);
    ledgerRevision.current += 1;
    refresh();
    return data;
  };
  const recurringSignature = recurringTransactions.filter(item => {
    const due = planningDay.slice(0, 8) + String(item.day_of_month).padStart(2, '0');
    return item.match_mode !== 'bank' && item.is_active && due <= planningDay && (!item.last_applied || item.last_applied < due);
  }).map(item => `${item.id}:${item.day_of_month}`).join('|');
  useEffect(() => {
    if (!householdId || !schemaReady || !accountsReady || !recurringSignature) return;
    const controller = new AbortController();
    void supabase.rpc('apply_due_recurring', { p_today: planningDay }).abortSignal(controller.signal).retry(false).then(({ data, error }) => {
      if (controller.signal.aborted) return;
      if (error) setPlansError('Не удалось применить регулярные операции.');
      else if (Number(data) > 0) refreshQueue.current?.request(['journal', 'plans']);
    });
    return () => controller.abort();
  }, [householdId, schemaReady, accountsReady, recurringSignature, planningDay]);
  useEffect(() => {
    if (!householdId) return;
    let stored: string | null = null;
    try { stored = localStorage.getItem(`ff_budget_limit:${householdId}`) || localStorage.getItem('ff_budget_limit'); } catch { /* Local preferences may be unavailable. */ }
    setBudgetLimitState(stored && Number.isFinite(Number(stored)) && Number(stored) > 0 ? Number(stored) : 1500);
  }, [householdId]);
  const transactionRecord = (tx: Omit<Transaction, 'id'>) => {
    const own = requireHousehold();
    if (!journalAvailable) throw new Error('Сначала загрузите журнал и счета.');
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
  const addTransaction = async (tx: Omit<Transaction, 'id'>, requestId: string = crypto.randomUUID()) => {
    const record = transactionRecord(tx);
    const result = await supabase.from('transactions').insert({ ...record, id: requestId }).select('*').single().retry(false);
    if (result.error?.code === '23505' || (result.error && [0, 502, 503, 504].includes(result.status))) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 4_000);
      const confirmed = await Promise.resolve(supabase.from('transactions').select('*').eq('household_id', record.household_id)
        .eq('id', requestId).abortSignal(controller.signal).maybeSingle().retry(false)).finally(() => clearTimeout(timeout));
      if (!confirmed.error && confirmed.data) {
        showConfirmedTransaction(transactionFromRow(confirmed.data as unknown as TransactionRow));
        return;
      }
      throw writeError(0, result.error, true);
    }
    if (result.error) throw writeError(result.status, result.error, true);
    showConfirmedTransaction(transactionFromRow(result.data as unknown as TransactionRow));
  };
  const updateTransaction = async (id: string, tx: Omit<Transaction, 'id'>,learning?:{remember:boolean;name:string}) => {
    if (!transactions.some(t => t.id === id && isCashflow(t))) throw new Error('Эту операцию нельзя редактировать как доход или расход.');
    requireAccounts();
    const record = transactionRecord(tx);
    await runRpc(learning?.remember?'save_transaction_with_rule':'update_finance_transaction', { p_id: id, p_type: record.type, p_amount: record.amount,
      p_category_id: record.category_id, p_comment: record.comment, p_added_by: record.added_by,
      p_date: record.date, p_account_id: tx.accountId || defaultAccountId,...(learning?.remember?{p_remember:true,p_merchant_name:learning.name}:{}) });
    setLedger(previous => previous.map(item => item.id === id ? { ...item, type: record.type, amount: record.amount,
      categoryId: record.category_id, comment: record.comment, date: record.date, addedBy: record.added_by, accountId: tx.accountId || defaultAccountId } : item));
  };
  const confirmBankBill=async(evidence:string[])=>runRpc('confirm_bank_bill',{p_evidence:evidence});
  const deleteMerchantRule=async(id:string)=>runRpc('delete_merchant_rule',{p_id:id});
  const addTransactionsBatch = async (txs: Omit<Transaction, 'id'>[]) => {
    if (!txs.length) return;
    const { error, status } = await supabase.from('transactions').insert(txs.map(transactionRecord)).retry(false);
    if (error) throw writeError(status, error);
    refreshJournal();
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
    refreshJournal();
    return data as PriorImportResult;
  };
  const deleteTransaction = async (id: string) => {
    if (schemaReady && accountsReady) {
      await runRpc('delete_finance_transaction', { p_id: id });
      setLedger(previous => previous.filter(item => item.id !== id));
      return;
    }
    const tx = transactions.find(t => t.id === id);
    if (tx?.comment.includes('[goal_id:')) throw new Error('Для изменения истории копилки сначала подключите счета.');
    const { error } = await supabase.from('transactions').delete().eq('id', id).eq('household_id', requireHousehold().householdId);
    if (error) throw new Error(error.message);
    setLedger(previous => previous.filter(item => item.id !== id));
    refreshJournal();
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
    const id = await runRpc('transfer_finance', { p_from: data.fromAccountId, p_to: data.toAccountId, p_amount: money(data.amount), p_date: data.date, p_comment: data.comment });
    if (typeof id === 'string') showConfirmedTransaction({
      id, type: 'expense', kind: 'transfer', amount: money(data.amount), categoryId: 'savings',
      date: data.date, comment: data.comment, addedBy: requireHousehold().profileId,
      accountId: data.fromAccountId, targetAccountId: data.toAccountId,
    });
  };
  const addRecurring = async (data: Omit<RecurringTransaction, 'id' | 'household_id' | 'last_applied' | 'is_active' | 'created_at'>) => {
    requireAccounts();
    const { error } = await supabase.from('recurring_transactions').insert({ ...data, amount: money(data.amount), household_id: requireHousehold().householdId, is_active: true, account_id: defaultAccountId });
    if (error) throw new Error(error.message);
    refreshQueue.current?.request(['plans']);
  };
  const deleteRecurring = async (id: string) => {
    const { error } = await supabase.from('recurring_transactions').delete().eq('id', id).eq('household_id', requireHousehold().householdId);
    if (error) throw new Error(error.message);
    refreshQueue.current?.request(['plans']);
  };
  const addGoal = async (data: Pick<SavingsGoal, 'name' | 'target_amount' | 'emoji' | 'deadline'>) => {
    requireAccounts();
    const { error } = await supabase.from('savings_goals').insert({ ...data, target_amount: money(data.target_amount), household_id: requireHousehold().householdId, current_amount: 0, is_completed: false });
    if (error) throw new Error(error.message);
    refreshQueue.current?.request(['plans']);
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
    try { localStorage.setItem(`ff_budget_limit:${householdId}`, String(limit)); } catch { /* The in-memory preference still applies. */ }
  };
  const balances = useMemo(() => calculateAccountBalances(accounts, ledger), [accounts, ledger]);
  const getMemberById = useMemo(() => {
    const membersById = new Map(members.map(member => [member.id, member]));
    return (id: string) => membersById.get(id);
  }, [members]);
  const balance = useMemo(() => accountsReady ? sumMoney(Object.values(balances)) : cashflowTotals(ledger).net, [accountsReady, balances, ledger]);
  const reservedBalance = useMemo(() => reservedGoals(savingsGoals), [savingsGoals]);
  const budgetReservedBalance = useMemo(() => budgetReserved(categoryBudgets, ledger, planningDay), [categoryBudgets, ledger, planningDay]);
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
  const monthly = useMemo(() => cashflowTotals(ledger.filter(t => t.date.startsWith(planningDay.slice(0, 7)))), [ledger, planningDay]);
  return <AppContext.Provider value={{ transactions, categories: CATEGORIES, members, accounts, accountBalances: balances,
    accountsReady, schemaReady, financeLoading, financeError, journalAvailable, plansAvailable, plansError, refreshFinance: refresh, balance, availableBalance, reservedBalance,
    monthlyIncome: monthly.income, monthlyExpense: monthly.expense, budgetLimit, recurringTransactions, savingsGoals,
    categoryBudgets, incomeDistributions, planningReady, budgetReservedBalance, setCategoryBudget, distributeIncome,
    flexiblePlanningReady,incomeTemplates,budgetRollovers,distributionRevisions,transferCategoryBudget,changeIncomeDistribution,saveIncomeTemplate,archiveIncomeTemplate,reviewBudgetMonth,saveFund,
    addTransaction, updateTransaction, addTransactionsBatch, previewPriorImport, importPriorOperations, deleteTransaction, initializeFinance, createAccount, transferBetweenAccounts,
    setBudgetLimit, getCategoryById, getMemberById,
    merchantRules,smartRulesReady,confirmBankBill,deleteMerchantRule,
    addRecurring, deleteRecurring, addGoal, deleteGoal, updateGoalAmount, withdrawGoalAmount }}>{children}</AppContext.Provider>;
};
export const useApp = () => {
  const context = useContext(AppContext);
  if (!context) throw new Error('useApp must be used within an AppProvider');
  return context;
};
