import React, { useState } from 'react';
import { useApp } from '../AppContext';
import { useAuth } from '../AuthContext';
import { DynamicIcon } from '../components/CategoryGrid';
import { Trash2, Check, TrendingUp, TrendingDown } from 'lucide-react';

const fmt = (n: number) => n.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' Br';

const fmtDate = (iso: string) => {
  const d = new Date(iso);
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
};

const HomeScreen: React.FC = () => {
  const { transactions, balance, monthlyIncome, monthlyExpense, budgetLimit, deleteTransaction, getCategoryById, getMemberById } = useApp();
  const { profile, household } = useAuth();
  const [confirmId, setConfirmId] = useState<string | null>(null);

  const recentTx = transactions.slice(0, 20);
  const budgetPercent = Math.min(100, Math.round((monthlyExpense / budgetLimit) * 100));
  const budgetOk = monthlyExpense <= budgetLimit;

  return (
    <div className="flex flex-col gap-0 overflow-y-auto no-scrollbar pb-20 h-full">

      {/* ── Header gradient strip ── */}
      <div
        className="px-5 pt-14 pb-6 flex flex-col gap-1 relative overflow-hidden shrink-0"
        style={{ background: 'linear-gradient(145deg, #16A34A 0%, #22C55E 60%, #4ADE80 100%)' }}
      >
        {/* decorative circle */}
        <div className="absolute -top-10 -right-10 w-44 h-44 rounded-full bg-white/10 pointer-events-none" />
        <div className="absolute top-16 -right-4 w-24 h-24 rounded-full bg-white/8 pointer-events-none" />

        <div className="flex justify-between items-start relative z-10">
          <div>
            <p className="text-green-100 text-xs font-medium mb-0.5">
              {household?.name || 'Семейный бюджет'}
            </p>
            <p className="text-white/80 text-xs">
              Привет, {profile?.name?.split(' ')[0] || 'пользователь'} 👋
            </p>
          </div>
          <div
            className="w-9 h-9 rounded-full bg-white/20 flex items-center justify-center text-lg"
            title={profile?.name}
          >
            {profile?.avatar || '👤'}
          </div>
        </div>

        {/* Balance */}
        <div className="mt-4 relative z-10">
          <p className="text-green-100 text-xs font-semibold uppercase tracking-wider mb-1">Общий баланс</p>
          <p className={`text-4xl font-extrabold tracking-tight ${balance < 0 ? 'text-red-200' : 'text-white'}`}>
            {fmt(balance)}
          </p>
        </div>

        {/* Income / Expense chips */}
        <div className="flex gap-3 mt-4 relative z-10">
          <div className="flex items-center gap-2 bg-white/15 backdrop-blur-sm rounded-2xl px-3 py-2 flex-1">
            <div className="w-7 h-7 rounded-xl bg-white/20 flex items-center justify-center">
              <TrendingUp className="w-4 h-4 text-white" />
            </div>
            <div>
              <p className="text-[10px] text-green-100 font-medium">Доходы</p>
              <p className="text-sm font-bold text-white">+{fmt(monthlyIncome)}</p>
            </div>
          </div>
          <div className="flex items-center gap-2 bg-white/15 backdrop-blur-sm rounded-2xl px-3 py-2 flex-1">
            <div className="w-7 h-7 rounded-xl bg-white/20 flex items-center justify-center">
              <TrendingDown className="w-4 h-4 text-white" />
            </div>
            <div>
              <p className="text-[10px] text-green-100 font-medium">Расходы</p>
              <p className="text-sm font-bold text-white">-{fmt(monthlyExpense)}</p>
            </div>
          </div>
        </div>
      </div>

      {/* ── Budget progress bar ── */}
      <div className="mx-4 mt-4 bg-white rounded-2xl px-4 py-3 shadow-sm border border-slate-100 flex flex-col gap-2">
        <div className="flex justify-between items-center">
          <span className="text-xs font-semibold text-slate-600">Лимит расходов</span>
          <span className={`text-xs font-bold ${budgetOk ? 'text-green-600' : 'text-red-500'}`}>
            {budgetPercent}% · {fmt(budgetLimit)}
          </span>
        </div>
        <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-700"
            style={{
              width: `${budgetPercent}%`,
              background: budgetOk ? '#22C55E' : '#F43F5E',
            }}
          />
        </div>
        {!budgetOk && (
          <p className="text-[11px] text-red-500 font-medium">⚠️ Лимит расходов превышен!</p>
        )}
      </div>

      {/* ── Transactions List ── */}
      <div className="px-4 pt-5 flex flex-col gap-3">
        <div className="flex justify-between items-center">
          <h2 className="text-base font-bold text-slate-800">Операции</h2>
          <span className="text-xs text-slate-400 font-medium">Последние {Math.min(recentTx.length, 20)}</span>
        </div>

        {recentTx.length === 0 ? (
          <div className="card p-10 text-center flex flex-col items-center gap-2">
            <span className="text-3xl">📭</span>
            <p className="text-slate-400 text-sm">Операций пока нет.<br />Нажмите «+» чтобы добавить первую.</p>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {recentTx.map((tx) => {
              const cat = getCategoryById(tx.categoryId);
              const member = getMemberById(tx.addedBy);
              const isExp = tx.type === 'expense';

              return (
                <div
                  key={tx.id}
                  className="card px-4 py-3 flex items-center gap-3 group active:scale-[0.99] transition-transform"
                >
                  {/* Category icon */}
                  <div
                    className="w-11 h-11 rounded-2xl flex items-center justify-center shrink-0"
                    style={{ backgroundColor: `${cat?.accentColor}18` }}
                  >
                    <DynamicIcon
                      name={cat?.icon || 'HelpCircle'}
                      className="w-5 h-5"
                      style={{ color: cat?.accentColor || '#94A3B8' }}
                    />
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-slate-800 text-sm truncate">{cat?.name || 'Другое'}</p>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      {member && (
                        <span
                          className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full"
                          style={{ backgroundColor: `${member.color}18`, color: member.color }}
                        >
                          {member.avatar} {member.name}
                        </span>
                      )}
                      <span className="text-[10px] text-slate-400">{fmtDate(tx.date)}</span>
                    </div>
                    {tx.comment && (
                      <p className="text-[11px] text-slate-400 truncate mt-0.5">{tx.comment}</p>
                    )}
                  </div>

                  {/* Amount + delete */}
                  <div className="flex items-center gap-2 shrink-0">
                    <span className={`font-bold text-sm ${isExp ? 'text-red-500' : 'text-green-600'}`}>
                      {isExp ? '-' : '+'}{fmt(tx.amount)}
                    </span>

                    {confirmId === tx.id ? (
                      <div className="flex gap-1">
                        <button
                          onClick={() => { deleteTransaction(tx.id); setConfirmId(null); }}
                          className="h-8 px-2.5 rounded-xl bg-red-500 text-white text-[11px] font-bold flex items-center gap-1 active:scale-90 transition-all"
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
                        className="w-8 h-8 rounded-xl bg-slate-50 hover:bg-red-50 border border-slate-100 hover:border-red-200 flex items-center justify-center text-slate-400 hover:text-red-500 active:scale-90 transition-all"
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
  );
};

export default HomeScreen;
