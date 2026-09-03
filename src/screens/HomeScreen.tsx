import React, { useState } from 'react';
import { useApp } from '../AppContext';
import { useAuth } from '../AuthContext';
import { DynamicIcon } from '../components/CategoryGrid';
import { BankSyncModal } from '../components/BankSyncModal';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { SafeToSpendCard } from '../components/SafeToSpendCard';
import { PayDreamFirstBanner } from '../components/PayDreamFirstBanner';
import { Trash2, Check, Search, Landmark } from 'lucide-react';

const fmt = (n: number) => n.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' Br';

const fmtDate = (iso: string) => {
  const d = new Date(iso);
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
};

interface HomeScreenProps {
  onOpenStatement?: () => void;
}

const HomeScreen: React.FC<HomeScreenProps> = ({ onOpenStatement }) => {
  const { 
    transactions, 
    balance, 
    monthlyIncome, 
    monthlyExpense, 
    deleteTransaction, 
    getCategoryById, 
    getMemberById,
    savingsGoals,
    updateGoalAmount 
  } = useApp();
  const { profile } = useAuth();
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [bankSyncOpen, setBankSyncOpen] = useState(false);

  const [searchQuery, setSearchQuery] = useState('');
  const [filterType, setFilterType] = useState<'all' | 'expense' | 'income'>('all');

  const filteredTx = transactions.filter(tx => {
    const matchesType = filterType === 'all' || tx.type === filterType;
    const categoryName = getCategoryById(tx.categoryId)?.name || '';
    const matchesSearch = 
      tx.comment.toLowerCase().includes(searchQuery.toLowerCase()) ||
      categoryName.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesType && matchesSearch;
  });

  return (
    <div className="flex flex-col overflow-y-auto no-scrollbar h-full bg-[#F8FAFC]">
      {/* ── Apple Header ── */}
      <div className="px-5 pt-7 pb-2.5 safe-header flex justify-between items-center bg-white/90 backdrop-blur-md border-b border-slate-100/80 sticky top-0 z-30">
        <button
          type="button"
          onClick={onOpenStatement || (() => setBankSyncOpen(true))}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold transition-all active:scale-95"
        >
          <Landmark size={14} />
          <span>Выписка</span>
        </button>

        <h1 className="text-sm font-black text-slate-900 tracking-tight">Семейный Бюджет</h1>

        <div className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center text-sm font-bold">
          {profile?.avatar || '👤'}
        </div>
      </div>

      {/* ── Scrollable Body ── */}
      <div className="px-5 pt-4 pb-8 flex flex-col gap-4">

        {/* ── Apple Unified Hero Card ── */}
        <div className="card p-5 bg-white border border-slate-100/90 shadow-sm flex flex-col gap-4">
          <div className="flex justify-between items-start">
            <div className="flex flex-col gap-0.5">
              <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Доступный баланс</span>
              <span className={`text-3xl font-black tracking-tight leading-none ${balance < 0 ? 'text-rose-500' : 'text-slate-900'}`}>
                {fmt(balance)}
              </span>
            </div>

            <div className="flex items-center gap-2 pt-1 text-right">
              <span className="text-xs font-black text-emerald-600">+{fmt(monthlyIncome)}</span>
              <span className="text-slate-300 font-bold">·</span>
              <span className="text-xs font-black text-slate-600">-{fmt(monthlyExpense)}</span>
            </div>
          </div>

          {/* Integrated Safe-to-Spend Daily Limit */}
          <SafeToSpendCard
            balance={balance}
            transactions={transactions}
          />
        </div>

        {/* ── Pay Dream First Banner (Only when fresh income is detected) ── */}
        <PayDreamFirstBanner
          transactions={transactions}
          goals={savingsGoals}
          onDepositToGoal={async (goalId, amount) => {
            await updateGoalAmount(goalId, amount);
          }}
        />

        {/* ── Search & Filter Controls ── */}
        <div className="flex flex-col gap-3">
          <div className="relative">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Поиск транзакций..."
              className="input-light pl-10 pr-8"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 text-xs font-bold"
              >
                ✕
              </button>
            )}
          </div>

          <div className="flex gap-2">
            {(['all', 'expense', 'income'] as const).map(type => {
              const label = type === 'all' ? 'Все' : type === 'expense' ? 'Расходы' : 'Доходы';
              const isActive = filterType === type;
              return (
                <button
                  key={type}
                  onClick={() => setFilterType(type)}
                  className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all active:scale-95 border ${
                    isActive
                      ? 'bg-[#0F172A] border-[#0F172A] text-white shadow-sm shadow-slate-900/10'
                      : 'bg-white border-slate-100 text-slate-400 hover:text-slate-600'
                  }`}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>

        {/* ── Transactions List ── */}
        <div className="flex flex-col gap-3.5">
          <div className="flex justify-between items-center">
            <h2 className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">История операций</h2>
            <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Найдено: {filteredTx.length}</span>
          </div>

          {transactions.length === 0 ? (
            <div className="card p-10 text-center flex flex-col items-center gap-2.5">
              <span className="text-3xl">📭</span>
              <p className="text-slate-400 text-xs font-semibold">Операций пока нет.<br />Нажмите «+» чтобы добавить первую.</p>
            </div>
          ) : filteredTx.length === 0 ? (
            <div className="card p-10 text-center flex flex-col items-center gap-2.5">
              <span className="text-3xl">🔍</span>
              <p className="text-slate-400 text-xs font-semibold">Ничего не найдено.<br />Попробуйте изменить запрос поиска.</p>
            </div>
          ) : (
            <div className="flex flex-col gap-2.5">
              {filteredTx.map((tx) => {
                const cat = getCategoryById(tx.categoryId);
                const member = getMemberById(tx.addedBy);
                const isExp = tx.type === 'expense';

                return (
                  <div
                    key={tx.id}
                    className="card px-4 py-3.5 flex items-center gap-3.5 group active:scale-[0.99] transition-all duration-200"
                  >
                    {/* Circle icon matching mockup categories background */}
                    <div className="w-11 h-11 rounded-full bg-[#FAF2EA] flex items-center justify-center shrink-0 shadow-sm transition-transform duration-300 group-hover:scale-105">
                      <DynamicIcon
                        name={cat?.icon || 'HelpCircle'}
                        className="w-5 h-5"
                        style={{ color: '#5C4033' }}
                      />
                    </div>

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <p className="font-bold text-slate-800 text-sm truncate tracking-tight">{cat?.name || 'Другое'}</p>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        {member && (
                          <span
                            className="text-[9px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider"
                            style={{ backgroundColor: `${member.color}12`, color: member.color }}
                          >
                            {member.avatar} {member.name}
                          </span>
                        )}
                        <span className="text-[10px] text-slate-400 font-medium">{fmtDate(tx.date)}</span>
                      </div>
                      {tx.comment && (
                        <p className="text-[11px] text-slate-500 truncate mt-0.5 font-normal">
                          {tx.comment.replace(/\s*\[goal_id:[^\]]+\]/g, '')}
                        </p>
                      )}
                    </div>

                    {/* Amount + delete */}
                    <div className="flex items-center gap-2 shrink-0">
                      <span className={`font-extrabold text-sm tracking-tight ${isExp ? 'text-rose-500' : 'text-emerald-600'}`}>
                        {isExp ? '-' : '+'}{fmt(tx.amount)}
                      </span>

                      {confirmId === tx.id ? (
                        <div className="flex gap-1">
                          <button
                            onClick={() => { deleteTransaction(tx.id); setConfirmId(null); }}
                            className="h-8 px-2.5 rounded-xl bg-rose-500 text-white text-[11px] font-bold flex items-center gap-1 active:scale-90 transition-all shadow-sm"
                          >
                            <Check className="w-3 h-3" />Удалить
                          </button>
                          <button
                            onClick={() => setConfirmId(null)}
                            className="w-8 h-8 rounded-xl bg-slate-100 text-slate-500 text-sm font-bold flex items-center justify-center active:scale-90"
                          >✕</button>
                        </div>
                      ) : (
                        <button
                          onClick={() => setConfirmId(tx.id)}
                          className="w-8 h-8 rounded-xl bg-slate-50 hover:bg-rose-50 border border-slate-100/50 hover:border-rose-100 flex items-center justify-center text-slate-400 hover:text-rose-500 active:scale-90 transition-all"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

      </div>

      {/* ── Bank Sync Modal ── */}
      <ErrorBoundary fallbackTitle="Ошибка в окне синхронизации банка" onReset={() => setBankSyncOpen(false)}>
        <BankSyncModal 
          isOpen={bankSyncOpen} 
          onClose={() => setBankSyncOpen(false)} 
        />
      </ErrorBoundary>
    </div>
  );
};

export default HomeScreen;
