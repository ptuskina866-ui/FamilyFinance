import React, { useMemo } from 'react';
import { Transaction, SavingsGoal } from '../types';
import { Shield, Sparkles, AlertCircle, CheckCircle2 } from 'lucide-react';

interface SafeToSpendCardProps {
  balance: number;
  transactions: Transaction[];
  savingsGoals: SavingsGoal[];
}

const fmt = (n: number) => n.toLocaleString('ru-RU', { maximumFractionDigits: 1 }) + ' Br';

export const SafeToSpendCard: React.FC<SafeToSpendCardProps> = ({
  balance,
  transactions,
  savingsGoals,
}) => {
  const calculation = useMemo(() => {
    const now = new Date();
    const todayISO = now.toISOString().split('T')[0];
    const year = now.getFullYear();
    const month = now.getMonth();
    const totalDaysInMonth = new Date(year, month + 1, 0).getDate();
    const dayOfMonth = now.getDate();
    const daysRemaining = Math.max(1, totalDaysInMonth - dayOfMonth + 1);

    // Расходы за сегодня
    const spentToday = transactions
      .filter(t => t.date === todayISO && t.type === 'expense')
      .reduce((sum, t) => sum + t.amount, 0);

    // Резерв на цели накоплений (например, 20% от доступного остатка)
    const goalReserve = Math.max(0, balance * 0.2);

    // Свободный остаток на жизнь до конца месяца
    const freePool = Math.max(0, balance - goalReserve);

    // Базовый дневной лимит
    const rawDailyLimit = freePool / daysRemaining;
    const dailyLimit = Math.max(25, Math.round(rawDailyLimit));

    const remainingToday = Math.max(0, dailyLimit - spentToday);
    const spentPercent = Math.min(100, Math.round((spentToday / dailyLimit) * 100));
    const isOver = spentToday > dailyLimit;
    const overAmount = isOver ? spentToday - dailyLimit : 0;

    return {
      dailyLimit,
      spentToday,
      remainingToday,
      spentPercent,
      isOver,
      overAmount,
      daysRemaining,
    };
  }, [balance, transactions, savingsGoals]);

  return (
    <div className="card p-4 border border-slate-200/80 bg-gradient-to-br from-white via-slate-50/50 to-emerald-50/20 shadow-sm flex flex-col gap-3">
      {/* ── Top Header ── */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-xl bg-emerald-500/10 text-emerald-700 flex items-center justify-center shrink-0">
            <Shield className="w-4 h-4" />
          </div>
          <div className="flex flex-col">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Безопасный бюджет на день</span>
            <span className="text-xs font-bold text-slate-700">Осталось {calculation.daysRemaining} дн. в месяце</span>
          </div>
        </div>

        <div className="flex items-center gap-1">
          {calculation.isOver ? (
            <span className="px-2 py-0.5 rounded-full text-[10px] font-black bg-rose-100 text-rose-700 flex items-center gap-1">
              <AlertCircle className="w-3 h-3" /> Превышен
            </span>
          ) : (
            <span className="px-2 py-0.5 rounded-full text-[10px] font-black bg-emerald-100 text-emerald-700 flex items-center gap-1">
              <CheckCircle2 className="w-3 h-3" /> В норме
            </span>
          )}
        </div>
      </div>

      {/* ── Main Amount ── */}
      <div className="flex items-baseline justify-between pt-0.5">
        <div className="flex flex-col">
          <span className="text-2xl font-black text-slate-900 tracking-tight leading-none">
            {fmt(calculation.remainingToday)}
          </span>
          <span className="text-[10px] text-slate-400 font-medium mt-1">
            {calculation.isOver 
              ? `Лимит ${fmt(calculation.dailyLimit)} превышен на ${fmt(calculation.overAmount)}`
              : `доступно потратить сегодня из лимита ${fmt(calculation.dailyLimit)}`
            }
          </span>
        </div>

        <div className="text-right">
          <span className="text-xs font-extrabold text-slate-600">
            {fmt(calculation.spentToday)}
          </span>
          <span className="block text-[9px] text-slate-400 font-semibold uppercase tracking-wider">
            потрачено сегодня
          </span>
        </div>
      </div>

      {/* ── Day Progress Bar ── */}
      <div className="flex flex-col gap-1">
        <div className="h-2 w-full bg-slate-100 rounded-full overflow-hidden p-0.5 border border-slate-200/50">
          <div
            className={`h-full rounded-full transition-all duration-500 ${
              calculation.isOver 
                ? 'bg-rose-500' 
                : calculation.spentPercent > 75 
                ? 'bg-amber-500' 
                : 'bg-emerald-500'
            }`}
            style={{ width: `${calculation.spentPercent}%` }}
          />
        </div>
      </div>

      {/* ── Motivation Footer ── */}
      <div className="flex items-center gap-1.5 pt-1 text-[11px] text-slate-500 font-medium border-t border-slate-100/80">
        <Sparkles className="w-3.5 h-3.5 text-amber-500 shrink-0" />
        <span>
          {calculation.isOver 
            ? 'Превышение лимита сегодня замедлит покупку авто. Завтра лучше сэкономить!'
            : 'Экономия дневного лимита сегодня автоматически ускоряет накопление на машину.'}
        </span>
      </div>
    </div>
  );
};
