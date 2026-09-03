import React, { useState, useMemo } from 'react';
import { Transaction, SavingsGoal } from '../types';
import { PiggyBank, X, CheckCircle2, ArrowRight } from 'lucide-react';

interface PayDreamFirstBannerProps {
  transactions: Transaction[];
  goals: SavingsGoal[];
  onDepositToGoal: (goalId: string, amount: number) => Promise<void> | void;
}

const fmt = (n: number) => n.toLocaleString('ru-RU', { maximumFractionDigits: 0 }) + ' Br';

export const PayDreamFirstBanner: React.FC<PayDreamFirstBannerProps> = ({
  transactions,
  goals,
  onDepositToGoal,
}) => {
  const [isDismissed, setIsDismissed] = useState(false);
  const [isDeposited, setIsDeposited] = useState(false);
  const [loading, setLoading] = useState(false);

  // Ищем цель на авто
  const carGoal = useMemo(() => {
    return (
      goals.find(
        g =>
          g.name.toLowerCase().includes('машин') ||
          g.name.toLowerCase().includes('авто') ||
          g.name.toLowerCase().includes('car') ||
          g.emoji === '🚗' ||
          g.emoji === '🏎️' ||
          g.emoji === '🚙'
      ) || goals[0]
    );
  }, [goals]);

  // Находим самый крупный доход за текущий месяц (или последний доход)
  const recentIncome = useMemo(() => {
    if (!transactions || transactions.length === 0) return null;
    const incomes = transactions
      .filter(t => t.type === 'income' && t.amount >= 100)
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    return incomes.length > 0 ? incomes[0] : null;
  }, [transactions]);

  if (isDismissed || !carGoal || !recentIncome) return null;

  // Рекомендуемый взнос: 20% от дохода
  const recommendedAmount = Math.max(50, Math.round(recentIncome.amount * 0.2));

  const handleDeposit = async () => {
    setLoading(true);
    try {
      await onDepositToGoal(carGoal.id, recommendedAmount);
      setIsDeposited(true);
      setTimeout(() => {
        setIsDismissed(true);
      }, 2500);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  if (isDeposited) {
    return (
      <div className="card p-4 border border-emerald-200 bg-emerald-50/70 shadow-sm flex items-center justify-between gap-3 animate-in fade-in duration-300">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-emerald-600 text-white flex items-center justify-center">
            <CheckCircle2 className="w-5 h-5" />
          </div>
          <div className="flex flex-col">
            <span className="text-xs font-black text-emerald-900">Отлично! +{fmt(recommendedAmount)} в копилку авто</span>
            <span className="text-[11px] text-emerald-700 font-medium">Вы приблизили день покупки своей машины! 🚗💨</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="card p-4 border border-indigo-200/80 bg-gradient-to-r from-indigo-50/70 via-white to-slate-50 shadow-sm flex flex-col gap-3 relative overflow-hidden">
      {/* Close button */}
      <button
        type="button"
        onClick={() => setIsDismissed(true)}
        className="absolute top-3 right-3 text-slate-400 hover:text-slate-600 w-6 h-6 flex items-center justify-center rounded-lg hover:bg-slate-100 transition-colors"
      >
        <X className="w-3.5 h-3.5" />
      </button>

      {/* Header */}
      <div className="flex items-center gap-2.5 pr-6">
        <div className="w-9 h-9 rounded-2xl bg-indigo-600 text-white flex items-center justify-center shrink-0 shadow-md shadow-indigo-600/20">
          <PiggyBank className="w-4 h-4" />
        </div>
        <div className="flex flex-col">
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-black text-slate-800 tracking-tight">Заплати сначала мечте!</span>
            <span className="text-[9px] px-1.5 py-0.2 rounded-md bg-indigo-100 text-indigo-700 font-bold uppercase tracking-wider">
              Правило 20%
            </span>
          </div>
          <span className="text-[11px] text-slate-500 font-medium">
            Поступил доход {fmt(recentIncome.amount)} · Отложите долю в «{carGoal.name}»
          </span>
        </div>
      </div>

      {/* Action CTA */}
      <div className="flex items-center justify-between gap-3 pt-0.5">
        <div className="flex flex-col">
          <span className="text-xs font-bold text-slate-400">Рекомендуемый взнос:</span>
          <span className="text-base font-black text-indigo-950 leading-tight">
            {fmt(recommendedAmount)}
          </span>
        </div>

        <button
          type="button"
          onClick={handleDeposit}
          disabled={loading}
          className="px-4 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-black transition-all active:scale-95 flex items-center gap-1.5 shadow-md shadow-slate-900/10 disabled:opacity-50"
        >
          <span>Отложить в 1 клик</span>
          <ArrowRight className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
};
