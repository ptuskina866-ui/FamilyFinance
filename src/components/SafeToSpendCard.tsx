import React, { useMemo } from 'react';
import { Transaction } from '../types';

interface SafeToSpendCardProps {
  balance: number;
  transactions: Transaction[];
}

const fmt = (n: number) => n.toLocaleString('ru-RU', { maximumFractionDigits: 0 }) + ' Br';

export const SafeToSpendCard: React.FC<SafeToSpendCardProps> = ({
  balance,
  transactions,
}) => {
  const calculation = useMemo(() => {
    const now = new Date();
    const todayISO = now.toISOString().split('T')[0];
    const year = now.getFullYear();
    const month = now.getMonth();
    const totalDaysInMonth = new Date(year, month + 1, 0).getDate();
    const dayOfMonth = now.getDate();
    const daysRemaining = Math.max(1, totalDaysInMonth - dayOfMonth + 1);

    const spentToday = transactions
      .filter(t => t.date === todayISO && t.type === 'expense')
      .reduce((sum, t) => sum + t.amount, 0);

    const goalReserve = Math.max(0, balance * 0.2);
    const freePool = Math.max(0, balance - goalReserve);
    const dailyLimit = Math.max(25, Math.round(freePool / daysRemaining));
    const remainingToday = Math.max(0, dailyLimit - spentToday);
    const spentPercent = Math.min(100, Math.round((spentToday / dailyLimit) * 100));
    const isOver = spentToday > dailyLimit;

    return {
      dailyLimit,
      spentToday,
      remainingToday,
      spentPercent,
      isOver,
      daysRemaining,
    };
  }, [balance, transactions]);

  return (
    <div className="card p-4 flex flex-col gap-2.5 bg-white border border-slate-100/90 shadow-sm">
      <div className="flex justify-between items-baseline">
        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
          Бюджет на сегодня
        </span>
        <span className={`text-[10px] font-bold ${calculation.isOver ? 'text-rose-500' : 'text-slate-400'}`}>
          {calculation.isOver ? 'Превышен' : `${calculation.daysRemaining} дн. до конца месяца`}
        </span>
      </div>

      <div className="flex items-baseline justify-between">
        <div className="flex items-baseline gap-1.5">
          <span className="text-2xl font-black text-slate-900 tracking-tight leading-none">
            {fmt(calculation.remainingToday)}
          </span>
          <span className="text-xs text-slate-400 font-medium">
            из {fmt(calculation.dailyLimit)}
          </span>
        </div>

        <span className="text-xs font-bold text-slate-500">
          -{fmt(calculation.spentToday)}
        </span>
      </div>

      {/* Slim Apple-style Progress Bar */}
      <div className="h-1.5 w-full bg-slate-100 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-500 ${
            calculation.isOver ? 'bg-rose-500' : 'bg-slate-900'
          }`}
          style={{ width: `${calculation.spentPercent}%` }}
        />
      </div>
    </div>
  );
};
