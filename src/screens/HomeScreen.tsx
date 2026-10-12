import React, { useState, useMemo } from 'react';
import { useApp } from '../AppContext';
import { useAuth } from '../AuthContext';
import { DynamicIcon } from '../components/CategoryGrid';
import { BankSyncModal } from '../components/BankSyncModal';
import { PayDreamFirstBanner } from '../components/PayDreamFirstBanner';
import { AccountsPanel } from '../components/AccountsPanel';
import { TransactionEditor } from '../components/TransactionEditor';
import { calculateSafeDaily, isCashflow } from '../lib/finance';
import { localDateISO } from '../lib/money';
import { Transaction } from '../types';
import { 
  Trash2, 
  Landmark, 
  Eye, 
  EyeOff, 
  Pencil, Search,
  TrendingUp, 
  Target, 
  ShieldCheck, 
  Plus 
} from 'lucide-react';

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
    balance, 
    monthlyIncome, 
    monthlyExpense, 
    deleteTransaction, 
    getCategoryById, 
    getMemberById,
    savingsGoals,
    availableBalance, reservedBalance, accounts, recurringTransactions, accountsReady
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

  // Daily budget calculation
  const safeDaily = useMemo(() => {
    return calculateSafeDaily(availableBalance, transactions, recurringTransactions, localDateISO());
  }, [availableBalance, transactions, recurringTransactions]);

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
      return (filterType === 'all' || (isCashflow(tx) && tx.type === filterType)) &&
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
  }, [transactions, filterType, search, accountFilter, getCategoryById]);

  const handleDelete = async (tx: Transaction) => {
    if (!window.confirm('Удалить операцию? Остатки и связанный резерв будут пересчитаны.')) return;
    setDeletingId(tx.id); setOperationError(null);
    try { await deleteTransaction(tx.id); }
    catch (error) { setOperationError(error instanceof Error ? error.message : 'Не удалось удалить операцию.'); }
    finally { setDeletingId(null); }
  };

  return (
    <div className="flex flex-col overflow-y-auto no-scrollbar h-full select-none">
      {/* ── Top Bar (Hi, User!) ── */}
      <div 
        className="px-5 pb-3 safe-header flex justify-between items-center sticky top-0 z-30 bg-[#E5F3E8]/95 backdrop-blur-md"
        style={{ paddingTop: 'max(28px, calc(env(safe-area-inset-top, 0px) + 16px))' }}
      >
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-white border border-white/80 shadow-sm flex items-center justify-center text-lg active:scale-95 transition-transform">
            {profile?.avatar || '👤'}
          </div>
          <div className="flex flex-col">
            <span className="text-[11px] font-bold text-slate-500">Привет,</span>
            <span className="text-sm font-black text-slate-900 tracking-tight">
              {profile?.name || 'Семья'}!
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onOpenStatement || (() => setBankSyncOpen(true))}
            className="w-10 h-10 rounded-full bg-white border border-white/80 shadow-sm flex items-center justify-center text-slate-700 active:scale-90 transition-transform"
            title="Выписка из банка"
          >
            <Landmark className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* ── Scrollable Body ── */}
      <div className="px-5 pt-2 pb-36 flex flex-col gap-5">

        {/* ── Signature Citrus/Lime Hero Card ── */}
        <div className="card-lime p-6 flex flex-col justify-between gap-4 relative overflow-hidden transition-transform active:scale-[0.99]">
          {/* Top row */}
          <div className="flex justify-between items-center">
            <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-black/10 text-slate-900 text-xs font-black">
              <span>BYN</span>
              <span className="text-[10px] text-slate-700 font-bold">· Все счета</span>
            </div>

            <button
              type="button"
              onClick={() => setHideBalance(!hideBalance)}
              className="w-8 h-8 rounded-full bg-black/10 hover:bg-black/15 flex items-center justify-center text-slate-900 transition-colors"
            >
              {hideBalance ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
          {accountsReady && <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-800">
            <span>Свободно: <strong>{hideBalance ? '••••' : fmt(availableBalance)}</strong></span>
            <span>В целях: <strong>{hideBalance ? '••••' : fmt(reservedBalance)}</strong></span>
          </div>}

          {/* Balance Amount */}
          <div className="flex flex-col gap-0.5 my-1">
            <span className="text-[38px] font-black text-slate-950 tracking-tight leading-none">
              {hideBalance ? '••••••' : fmt(balance)}
            </span>
          </div>

          {/* Bottom income / expense row */}
          <div className="flex items-center justify-between pt-2 border-t border-black/10 text-xs font-black text-slate-900">
            <div className="flex items-center gap-1">
              <span className="text-emerald-800">+{fmt(monthlyIncome)}</span>
              <span className="text-black/30 font-bold">·</span>
              <span className="text-slate-800">-{fmt(monthlyExpense)}</span>
            </div>
            <span className="text-[10px] uppercase font-bold tracking-wider text-slate-700">
              За месяц
            </span>
          </div>
        </div>

        <AccountsPanel hideBalances={hideBalance} />

        {/* ── Quick Action Buttons (like Pay, Transfer, Receive in reference) ── */}
        <div className="flex justify-around items-center px-2">
          {/* 1. Bank Statement */}
          <button
            type="button"
            onClick={onOpenStatement || (() => setBankSyncOpen(true))}
            className="flex flex-col items-center gap-1.5 group active:scale-95 transition-transform"
          >
            <div className="w-12 h-12 rounded-full bg-white/80 backdrop-blur-xl border border-white/90 shadow-[0_4px_16px_rgba(0,30,10,0.04)] group-hover:shadow-md flex items-center justify-center text-slate-800 transition-all">
              <Landmark className="w-5 h-5" />
            </div>
            <span className="text-[11px] font-bold text-slate-700">Выписка</span>
          </button>

          {/* 2. Goal / Savings */}
          <button
            type="button"
            onClick={() => onNavigateTab && onNavigateTab('plans')}
            className="flex flex-col items-center gap-1.5 group active:scale-95 transition-transform"
          >
            <div className="w-12 h-12 rounded-full bg-white/80 backdrop-blur-xl border border-white/90 shadow-[0_4px_16px_rgba(0,30,10,0.04)] group-hover:shadow-md flex items-center justify-center text-slate-800 transition-all">
              <Target className="w-5 h-5" />
            </div>
            <span className="text-[11px] font-bold text-slate-700">Цели</span>
          </button>

          {/* 3. Analytics */}
          <button
            type="button"
            onClick={() => onNavigateTab && onNavigateTab('analytics')}
            className="flex flex-col items-center gap-1.5 group active:scale-95 transition-transform"
          >
            <div className="w-12 h-12 rounded-full bg-white/80 backdrop-blur-xl border border-white/90 shadow-[0_4px_16px_rgba(0,30,10,0.04)] group-hover:shadow-md flex items-center justify-center text-slate-800 transition-all">
              <TrendingUp className="w-5 h-5" />
            </div>
            <span className="text-[11px] font-bold text-slate-700">Аналитика</span>
          </button>
        </div>

        {/* ── Pay Dream First Banner (If income arrived) ── */}
        <PayDreamFirstBanner
          transactions={transactions}
          goals={savingsGoals}
          availableBalance={availableBalance}
          onOpenPlans={() => onNavigateTab?.('plans')}
        />

        {/* ── Horizontal Widgets (Currency/Goals like reference middle screen) ── */}
        <div className="flex flex-col gap-2.5">
          <div className="flex justify-between items-center px-1">
            <span className="text-xs font-black text-slate-800 tracking-tight">Цели и лимиты</span>
            <button
              type="button"
              onClick={() => onNavigateTab && onNavigateTab('plans')}
              className="text-[11px] font-bold text-slate-500 hover:text-slate-900"
            >
              Все
            </button>
          </div>

          <div className="flex gap-3 overflow-x-auto no-scrollbar pb-1 -mx-5 px-5">
            {/* Card 1: Safe-to-Spend Daily Limit - Frosted Glass */}
            <div className="card min-w-[155px] p-4 flex flex-col justify-between gap-3 shrink-0">
              <div className="flex items-center justify-between">
                <div className="w-7 h-7 rounded-xl bg-emerald-50 text-emerald-700 flex items-center justify-center">
                  <ShieldCheck className="w-4 h-4" />
                </div>
                <span className={`text-[9px] font-extrabold ${safeDaily.isOver ? 'text-rose-500' : 'text-slate-400'}`}>
                  {safeDaily.isOver ? 'Превышен' : `${safeDaily.daysLeft} дн.`}
                </span>
              </div>
              <div>
                <span className="text-[10px] font-bold text-slate-400 block">На сегодня · оценка</span>
                <span className="text-xl font-black text-slate-900 leading-tight">
                  {fmt(safeDaily.remaining)}
                </span>
                <span className="text-[9px] text-slate-500 block mt-1">После целей и ближайших платежей</span>
              </div>
            </div>

            {/* Card 2: Car Goal - Frosted Glass */}
            {carGoal && (
              <div 
                onClick={() => onNavigateTab && onNavigateTab('plans')}
                className="card min-w-[165px] p-4 flex flex-col justify-between gap-3 shrink-0 cursor-pointer active:scale-95 transition-transform"
              >
                <div className="flex items-center justify-between">
                  <span className="text-2xl filter drop-shadow-sm">{carGoal.emoji || '🚗'}</span>
                  <span className="text-[10px] font-bold text-slate-400">
                    {Math.min(100, Math.round((carGoal.current_amount / carGoal.target_amount) * 100))}%
                  </span>
                </div>
                <div>
                  <span className="text-[10px] font-bold text-slate-400 block truncate">{carGoal.name}</span>
                  <span className="text-xl font-black text-slate-900 leading-tight">
                    {fmt(carGoal.current_amount)}
                  </span>
                </div>
              </div>
            )}

            {/* Card 3: Add Goal Button - Dark Smoky Glass */}
            <div 
              onClick={() => onNavigateTab && onNavigateTab('plans')}
              className="card-dark-glass min-w-[125px] p-4 text-white flex flex-col justify-between gap-3 shrink-0 cursor-pointer active:scale-95 transition-transform"
            >
              <div className="w-7 h-7 rounded-full bg-white/10 flex items-center justify-center text-white">
                <Plus className="w-4 h-4" />
              </div>
              <div>
                <span className="text-[10px] text-slate-400 block font-bold">Копилка</span>
                <span className="text-xs font-black text-white leading-tight">
                  + Новая цель
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* ── Latest Transactions Section ── */}
        <div className="flex flex-col gap-3 pt-1">
          {operationError && <p role="alert" className="text-xs text-rose-600">{operationError}</p>}
          <label className="card px-3 py-2.5 flex items-center gap-2">
            <Search className="w-4 h-4 text-slate-400" />
            <input aria-label="Поиск операций" value={search} onChange={e => setSearch(e.target.value)} placeholder="Найти операцию" className="w-full min-w-0 bg-transparent text-xs outline-none" />
          </label>
          {accountsReady && <select aria-label="Фильтр по счету" value={accountFilter} onChange={e => setAccountFilter(e.target.value)} className="card p-3 text-xs">
            <option value="">Все счета</option>{accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>}
          <div className="flex justify-between items-center px-1">
            <span className="text-xs font-black text-slate-800 tracking-tight">Последние операции</span>
            
            {/* Filter Pills - Frosted Glass */}
            <div className="flex items-center gap-1 p-0.5 rounded-full bg-white/75 backdrop-blur-xl border border-white/90 shadow-sm">
              {(['all', 'expense', 'income'] as const).map(type => (
                <button
                  key={type}
                  type="button"
                  onClick={() => setFilterType(type)}
                  className={`px-2.5 py-1 rounded-full text-[10px] font-extrabold transition-all ${
                    filterType === type
                      ? 'bg-slate-950 text-white shadow-sm'
                      : 'text-slate-500 hover:text-slate-900'
                  }`}
                >
                  {type === 'all' ? 'Все' : type === 'expense' ? 'Расход' : 'Доход'}
                </button>
              ))}
            </div>
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

                  <div className="flex flex-col gap-2">
                    {group.items.map(tx => {
                      const cat = getCategoryById(tx.categoryId);
                      const isIncome = tx.type === 'income';
                      const cashflow = isCashflow(tx);
                      const label = tx.kind === 'transfer' ? 'Перевод между счетами' : tx.kind === 'goal_deposit' ? 'Резерв в цель' : tx.kind === 'goal_release' ? 'Возврат из цели' : cat?.name || 'Без категории';
                      const member = getMemberById(tx.addedBy);

                      return (
                        <div
                          key={tx.id}
                          className="card p-3.5 flex items-center justify-between active:scale-[0.99] transition-transform"
                        >
                          <div className="flex items-center gap-3 min-w-0">
                            {/* Round category avatar */}
                            <div className="w-11 h-11 rounded-full bg-slate-950 text-white flex items-center justify-center shrink-0 shadow-sm">
                              <DynamicIcon name={cat?.icon || 'ShoppingCart'} className="w-5 h-5 text-white" />
                            </div>

                            <div className="flex flex-col min-w-0">
                              <span className="text-xs font-black text-slate-900 truncate">
                                {(tx.comment || label).replace(/\s*\[goal_id:[^\]]+\]/g, '')}
                              </span>
                              <span className="text-[10px] font-bold text-slate-400">
                                {label} {member ? `· ${member.name}` : ''}
                              </span>
                            </div>
                          </div>

                          <div className="flex items-center gap-2 shrink-0">
                            <span className={`text-xs font-black ${isIncome ? 'text-emerald-600' : 'text-slate-900'}`}>
                              {cashflow ? (isIncome ? '+' : '-') : '↔ '}{fmt(tx.amount)}
                            </span>
                            {cashflow && accountsReady && <button type="button" aria-label="Редактировать операцию" onClick={() => setEditing(tx)} className="w-8 h-8 rounded-full text-slate-400 flex items-center justify-center"><Pencil className="w-3.5 h-3.5" /></button>}
                            <button
                              type="button"
                              aria-label="Удалить операцию"
                              disabled={deletingId !== null}
                              onClick={() => { void handleDelete(tx); }}
                              className="w-7 h-7 rounded-full hover:bg-rose-50 hover:text-rose-500 text-slate-300 flex items-center justify-center transition-colors"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

      </div>

      {/* Bank Sync Modal fallback */}
      <BankSyncModal isOpen={bankSyncOpen} onClose={() => setBankSyncOpen(false)} />
      {editing && <TransactionEditor transaction={editing} onClose={() => setEditing(null)} />}
    </div>
  );
};

export default HomeScreen;
