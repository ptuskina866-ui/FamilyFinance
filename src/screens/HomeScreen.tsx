import React, { useState, useMemo, useRef } from 'react';
import { useApp } from '../AppContext';
import { useAuth } from '../AuthContext';
import { OverviewCards } from '../components/OverviewCards';
import { DynamicIcon } from '../components/CategoryGrid';
import { BankSyncModal } from '../components/BankSyncModal';
import { TransactionEditor } from '../components/TransactionEditor';
import { calculateSafeDaily, isCashflow } from '../lib/finance';
import { localDateISO } from '../lib/money';
import { planningDateISO, unassignedDailyTransactions, uncoveredRecurring } from '../lib/planning';
import { Transaction } from '../types';
import { Trash2, Pencil, Search, Eye, EyeOff } from 'lucide-react';

const fmt = (n: number) => n.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' Br';

const formatDateGroup = (iso: string) => {
  const d = new Date(iso);
  const now = new Date();
  
  // Format to YYYY-MM-DD for simple day comparison
  const dStr = iso;
  const nowStr = localDateISO(now);
  
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const yStr = localDateISO(yesterday);

  if (dStr === nowStr) return 'Сегодня';
  if (dStr === yStr) return 'Вчера';
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', ...(d.getFullYear() !== now.getFullYear() ? { year: 'numeric' as const } : {}) });
};

interface HomeScreenProps {
  onOpenStatement?: () => void;
  onNavigateTab?: (tab: 'home' | 'add' | 'analytics' | 'plans' | 'profile') => void;
}

const HomeScreen: React.FC<HomeScreenProps> = ({ onOpenStatement, onNavigateTab }) => {
  const { 
    transactions, 
    deleteTransaction, 
    getCategoryById, 
    getMemberById,
    savingsGoals,
    availableBalance, categoryBudgets, accounts, recurringTransactions, accountsReady
  } = useApp();
  const { profile } = useAuth();

  const [bankSyncOpen, setBankSyncOpen] = useState(false);
  const [hideBalance, setHideBalance] = useState(false);
  const [filterType, setFilterType] = useState<'all' | 'expense' | 'income'>('all');
  const [search, setSearch] = useState('');
  const [accountFilter, setAccountFilter] = useState('');
  const [editing, setEditing] = useState<Transaction | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [operationError, setOperationError] = useState<string | null>(null);
  const [insightTransactionIds, setInsightTransactionIds] = useState<string[] | null>(null);
  const journalRef = useRef<HTMLDivElement>(null);
  const screenRef = useRef<HTMLDivElement>(null);
  const scrollToJournal = () => {
    const screen=screenRef.current,journal=journalRef.current;
    if (!screen || !journal) return;
    const header=screen.querySelector('header')?.getBoundingClientRect().height ?? 0;
    screen.scrollTo({top:screen.scrollTop+journal.getBoundingClientRect().top-screen.getBoundingClientRect().top-header-12,behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});
  };

  // Daily budget calculation
  const safeDaily = useMemo(() => {
    const today = planningDateISO();
    return calculateSafeDaily(availableBalance, unassignedDailyTransactions(transactions, categoryBudgets, today), uncoveredRecurring(recurringTransactions, categoryBudgets, transactions, today), today);
  }, [availableBalance, transactions, recurringTransactions, categoryBudgets]);

  // Car goal quick glance
  const carGoal = useMemo(() => {
    return savingsGoals.filter(g => !g.is_archived).find(
      g => g.name.toLowerCase().includes('машин') || g.name.toLowerCase().includes('авто') || g.emoji === '🚗'
    ) || savingsGoals.find(g => !g.is_archived);
  }, [savingsGoals]);

  // Grouped transactions by Date
  const groupedTransactions = useMemo(() => {
    const filtered = transactions.filter(tx => {
      const query = search.trim().toLocaleLowerCase('ru-RU');
      return (!insightTransactionIds || insightTransactionIds.includes(tx.id)) &&
        (filterType === 'all' || (isCashflow(tx) && tx.type === filterType)) &&
        (!accountFilter || tx.accountId === accountFilter || tx.targetAccountId === accountFilter) &&
        (!query || `${tx.comment} ${getCategoryById(tx.categoryId)?.name || ''} ${tx.amount}`.toLocaleLowerCase('ru-RU').includes(query));
    });

    const groups: { dateLabel: string; items: typeof transactions }[] = [];
    const dateMap = new Map<string, typeof transactions>();

    for (const tx of filtered) {
      const label = formatDateGroup(tx.date);
      if (!dateMap.has(label)) {
        dateMap.set(label, []);
        groups.push({ dateLabel: label, items: dateMap.get(label)! });
      }
      dateMap.get(label)!.push(tx);
    }

    return groups;
  }, [transactions, filterType, search, accountFilter, getCategoryById, insightTransactionIds]);

  const handleDelete = async (tx: Transaction) => {
    if (!window.confirm('Удалить операцию? Остатки и связанный резерв будут пересчитаны.')) return;
    setDeletingId(tx.id); setOperationError(null);
    try { await deleteTransaction(tx.id); }
    catch (error) { setOperationError(error instanceof Error ? error.message : 'Не удалось удалить операцию.'); }
    finally { setDeletingId(null); }
  };

  return (
    <div ref={screenRef} className="flex flex-col overflow-y-auto no-scrollbar h-full">
      <header className="screen-header home-header">
        <button type="button" aria-label="Открыть профиль" onClick={() => onNavigateTab?.('profile')} className="icon-button home-avatar">{profile?.avatar||'👤'}</button>
        <h1 className="brand-name">FinApp</h1>
        <button type="button" onClick={() => setHideBalance(value=>!value)} aria-label={hideBalance?'Показать суммы':'Скрыть суммы'} aria-pressed={hideBalance} className="icon-button">{hideBalance?<EyeOff size={18} strokeWidth={1.6}/>:<Eye size={18} strokeWidth={1.6}/>}</button>
      </header>
      <div className="screen-body flex flex-col gap-5">
        <OverviewCards hideAmounts={hideBalance} daily={safeDaily} goal={carGoal} onBank={onOpenStatement||(()=>setBankSyncOpen(true))} onPlans={()=>onNavigateTab?.('plans')} onReview={ids=>{setInsightTransactionIds(ids);setSearch('');setFilterType('all');setAccountFilter('');scrollToJournal();}}/>

        {/* ── Latest Transactions Section ── */}
        <section ref={journalRef} className="journal flex flex-col gap-3 pt-1" aria-labelledby="journal-heading">
          <div className="section-heading"><h2 id="journal-heading" className="section-title">Операции</h2><span className="text-[11px] text-slate-500">История денег</span></div>
          {operationError && <p role="alert" className="text-xs text-rose-600">{operationError}</p>}
          {insightTransactionIds && <div className="card p-3 text-xs text-slate-600 flex items-center justify-between gap-2"><span>Операции из подсказки</span><button type="button" onClick={() => setInsightTransactionIds(null)} className="min-h-[40px] font-bold text-emerald-800">Показать все</button></div>}
          <label className="card px-4 py-3 flex items-center gap-2">
            <Search className="w-4 h-4 text-slate-400" />
            <input aria-label="Поиск операций" value={search} onChange={e => setSearch(e.target.value)} placeholder="Поиск по названию или сумме" className="w-full min-w-0 bg-transparent text-sm outline-none" />
          </label>
          {accountsReady && <select aria-label="Фильтр по счету" value={accountFilter} onChange={e => setAccountFilter(e.target.value)} className="card p-3 text-xs">
            <option value="">Все счета</option>{accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>}
          <div className="segmented" aria-label="Тип операций">
              {(['all', 'expense', 'income'] as const).map(type => (
                <button
                  key={type}
                  type="button"
                  onClick={() => setFilterType(type)}
                  aria-pressed={filterType === type}
                >
                  {type === 'all' ? 'Все' : type === 'expense' ? 'Расходы' : 'Доходы'}
                </button>
              ))}
          </div>

          {/* Transactions Grouped by Date (like reference left screen) */}
          {groupedTransactions.length === 0 ? (
            <div className="card p-8 text-center">
              <p className="text-xs font-semibold text-slate-400">Операций не найдено</p>
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              {groupedTransactions.map(group => (
                <div key={group.dateLabel} className="flex flex-col gap-2">
                  <span className="text-[11px] font-extrabold text-slate-500 px-1">
                    {group.dateLabel}
                  </span>

                  <div className="card transaction-list">
                    {group.items.map(tx => {
                      const cat = getCategoryById(tx.categoryId);
                      const isIncome = tx.type === 'income';
                      const cashflow = isCashflow(tx);
                      const label = tx.kind === 'transfer' ? 'Перевод между счетами' : tx.kind === 'goal_deposit' ? 'Резерв в цель' : tx.kind === 'goal_release' ? 'Возврат из цели' : cat?.name || 'Без категории';
                      const member = getMemberById(tx.addedBy);

                      return (
                        <div
                          key={tx.id}
                          className="transaction-row"
                        >
                          <div className="transaction-icon"><DynamicIcon name={cat?.icon || 'ShoppingCart'} className="w-[18px] h-[18px]"/></div>
                          <div className="min-w-0">
                            <div className="transaction-main">
                              <span className="transaction-name min-w-0 text-slate-900">
                                {(tx.comment || label).replace(/\s*\[goal_id:[^\]]+\]/g, '')}
                              </span>
                            <span className={`transaction-amount money ${cashflow && isIncome ? 'text-emerald-700' : 'text-slate-900'}`}>
                              {hideBalance ? '••••' : `${cashflow ? (isIncome ? '+' : '−') : '↔ '}${fmt(tx.amount)}`}
                            </span>
                            </div>
                            <div className="transaction-meta"><span className="text-[11px] text-slate-500 min-w-0">{label}{member ? ` · ${member.name}` : ''}</span><div className="transaction-tools">
                            {cashflow && accountsReady && <button type="button" aria-label="Редактировать операцию" onClick={() => setEditing(tx)}><Pencil className="w-3.5 h-3.5" /></button>}
                            <button
                              type="button"
                              aria-label="Удалить операцию"
                              disabled={deletingId !== null}
                              onClick={() => { void handleDelete(tx); }}
                              className="hover:bg-rose-50 hover:text-rose-700 disabled:opacity-40"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                            </div></div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

      </div>

      {/* Bank Sync Modal fallback */}
      <BankSyncModal isOpen={bankSyncOpen} onClose={() => setBankSyncOpen(false)} />
      {editing && <TransactionEditor transaction={editing} onClose={() => setEditing(null)} />}
    </div>
  );
};

export default HomeScreen;
