import React, { useState, useMemo } from 'react';
import { Transaction, SavingsGoal } from '../types';
import { PiggyBank, X, Check } from 'lucide-react';

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

  const carGoal = useMemo(() => {
    return (
      goals.find(
        g =>
          g.name.toLowerCase().includes('машин') ||
          g.name.toLowerCase().includes('авто') ||
          g.name.toLowerCase().includes('car') ||
          g.emoji === '🚗'
      ) || goals[0]
    );
  }, [goals]);

  const recentIncome = useMemo(() => {
    if (!transactions || transactions.length === 0) return null;
    const incomes = transactions
      .filter(t => t.type === 'income' && t.amount >= 100)
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    return incomes.length > 0 ? incomes[0] : null;
  }, [transactions]);

  if (isDismissed || !carGoal || !recentIncome) return null;

  const recommendedAmount = Math.max(50, Math.round(recentIncome.amount * 0.2));

  const handleDeposit = async () => {
    setLoading(true);
    try {
      await onDepositToGoal(carGoal.id, recommendedAmount);
      setIsDeposited(true);
      setTimeout(() => setIsDismissed(true), 2000);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  if (isDeposited) {
    return (
      <div className="card p-3 bg-emerald-50 border border-emerald-100 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-xs font-bold text-emerald-800">
          <Check className="w-4 h-4 text-emerald-600" />
          <span>+{fmt(recommendedAmount)} переведено в «{carGoal.name}»</span>
        </div>
      </div>
    );
  }

  return (
    <div className="card p-3 bg-slate-900 text-white flex items-center justify-between gap-2 shadow-sm">
      <div className="flex items-center gap-2 min-w-0">
        <PiggyBank className="w-4 h-4 text-indigo-300 shrink-0" />
        <span className="text-xs font-semibold text-slate-200 truncate">
          Доход {fmt(recentIncome.amount)}: отложить 20% ({fmt(recommendedAmount)}) в авто?
        </span>
      </div>

      <div className="flex items-center gap-1.5 shrink-0">
        <button
          type="button"
          onClick={handleDeposit}
          disabled={loading}
          className="px-2.5 py-1 rounded-lg bg-white text-slate-900 text-xs font-black active:scale-95 transition-transform"
        >
          {loading ? '...' : 'Отложить'}
        </button>
        <button
          type="button"
          onClick={() => setIsDismissed(true)}
          className="w-6 h-6 rounded-lg hover:bg-slate-800 flex items-center justify-center text-slate-400 hover:text-white"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
};
