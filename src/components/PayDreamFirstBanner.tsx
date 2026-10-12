import React, { useMemo, useState } from 'react';
import { Transaction, SavingsGoal } from '../types';
import { PiggyBank, X } from 'lucide-react';
import { isCashflow } from '../lib/finance';
import { toMinorUnits, fromMinorUnits } from '../lib/money';

interface PayDreamFirstBannerProps {
  transactions: Transaction[];
  goals: SavingsGoal[];
  availableBalance: number;
  onOpenPlans?: () => void;
}

const fmt = (n: number) => n.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' Br';

export const PayDreamFirstBanner: React.FC<PayDreamFirstBannerProps> = ({ transactions, goals, availableBalance, onOpenPlans }) => {
  const [dismissedIncomeId, setDismissedIncomeId] = useState<string | null>(null);
  const goal = goals.find(g => !g.is_archived && !g.is_completed && g.current_amount < g.target_amount);
  const recentIncome = useMemo(() => {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 7);
    cutoff.setHours(0, 0, 0, 0);
    const end = new Date();
    end.setHours(23, 59, 59, 999);
    return transactions.filter(t => t.type === 'income' && isCashflow(t) && t.amount > 0 && new Date(`${t.date}T12:00:00`) >= cutoff && new Date(`${t.date}T12:00:00`) <= end)
      .sort((a, b) => b.date.localeCompare(a.date))[0];
  }, [transactions]);

  if (!goal || !recentIncome || recentIncome.id === dismissedIncomeId || availableBalance <= 0) return null;
  const recommendedAmount = fromMinorUnits(Math.min(Math.floor(toMinorUnits(recentIncome.amount) / 5), toMinorUnits(availableBalance), Math.max(0, toMinorUnits(goal.target_amount) - toMinorUnits(goal.current_amount))));
  if (recommendedAmount <= 0) return null;

  return (
    <div className="card-dark-glass p-4 text-white flex flex-col gap-3">
      <div className="flex items-start gap-2.5">
        <PiggyBank className="w-5 h-5 text-emerald-200 shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <p className="text-xs font-bold">Сначала — ваша цель</p>
          <p className="text-[11px] text-slate-300 leading-relaxed mt-1">Недавно поступило {fmt(recentIncome.amount)}. Можно запланировать до {fmt(recommendedAmount)} в «{goal.name}».</p>
        </div>
        <button type="button" onClick={() => setDismissedIncomeId(recentIncome.id)} aria-label="Скрыть предложение накопления" className="w-8 h-8 rounded-full flex items-center justify-center text-slate-300 shrink-0"><X className="w-4 h-4" /></button>
      </div>
      {onOpenPlans && <button type="button" onClick={onOpenPlans} className="self-start ml-7 px-3 py-2 rounded-xl bg-white text-slate-900 text-xs font-black active:scale-95">Посмотреть план</button>}
    </div>
  );
};
