import React, { useState } from 'react';
import { useApp } from '../AppContext';
import { useAuth } from '../AuthContext';
import { DynamicIcon } from '../components/CategoryGrid';
import { Trash2, Check, Search, ArrowUpRight, ArrowDownRight } from 'lucide-react';

const fmt = (n: number) => n.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' Br';

const fmtDate = (iso: string) => {
  const d = new Date(iso);
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
};

const HomeScreen: React.FC = () => {
  const { transactions, balance, monthlyIncome, monthlyExpense, budgetLimit, deleteTransaction, getCategoryById, getMemberById } = useApp();
  const { profile } = useAuth();
  const [confirmId, setConfirmId] = useState<string | null>(null);

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

  const budgetPercent = Math.min(100, Math.round((monthlyExpense / budgetLimit) * 100));
  const budgetOk = monthlyExpense <= budgetLimit;

  return (
    <div className="flex flex-col overflow-y-auto no-scrollbar pb-24 h-full bg-[#FFFFFF]">
      {/* ── Header ── */}
      <div className="px-5 pt-7 pb-2 safe-header flex justify-between items-center bg-white border-b border-slate-100/60 sticky top-0 z-30">
        <div className="w-9 h-9" /> {/* Spacer */}
        <h1 className="text-sm font-black text-slate-800 tracking-tight">Семейный Бюджет</h1>
        <div className="w-9 h-9 rounded-full bg-slate-50 border border-slate-100 flex items-center justify-center text-lg active:scale-95 transition-transform">
          {profile?.avatar || '👤'}
        </div>
      </div>

      {/* ── Scrollable Body ── */}
      <div className="px-5 pt-5 flex flex-col gap-6">

        {/* ── Balance ── */}
        <div className="flex flex-col gap-0.5">
          <p className={`text-[40px] font-black tracking-tight leading-none ${balance < 0 ? 'text-rose-500' : 'text-slate-800'}`}>
            {fmt(balance)}
          </p>
          <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider mt-1">Доступный баланс</p>
        </div>

        {/* ── Monthly Summary cards ── */}
        <div className="grid grid-cols-2 gap-3.5">
          {/* Income card */}
          <div className="card p-3.5 flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-full bg-emerald-50 flex items-center justify-center text-emerald-600">
                <ArrowUpRight className="w-4 h-4" />
              </div>
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Доходы</span>
            </div>
            <span className="text-sm font-black text-slate-800">+{fmt(monthlyIncome)}</span>
          </div>
          {/* Expense card */}
          <div className="card p-3.5 flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-full bg-rose-50 flex items-center justify-center text-rose-500">
                <ArrowDownRight className="w-4 h-4" />
              </div>
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Расходы</span>
            </div>
            <span className="text-sm font-black text-slate-800">-{fmt(monthlyExpense)}</span>
          </div>
        </div>

        {/* ── Budget progress bar ── */}
        <div className="card p-4 flex flex-col gap-2.5">
          <div className="flex justify-between items-center">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Лимит расходов</span>
            <span className={`text-xs font-extrabold ${budgetOk ? 'text-slate-800' : 'text-rose-500'}`}>
              {budgetPercent}% · {fmt(budgetLimit)}
            </span>
          </div>
          <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-700"
              style={{
                width: `${budgetPercent}%`,
                background: budgetOk ? '#0F172A' : '#F43F5E',
              }}
            />
          </div>
          {!budgetOk && (
            <p className="text-[10px] text-rose-500 font-semibold tracking-wide">⚠️ Лимит расходов превышен!</p>
          )}
        </div>

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
    </div>
  );
};

export default HomeScreen;
