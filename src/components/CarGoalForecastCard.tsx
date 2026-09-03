import React, { useMemo, useState } from 'react';
import { SavingsGoal, Transaction } from '../types';
import { Car, Sparkles, ChevronRight, Plus } from 'lucide-react';

interface CarGoalForecastCardProps {
  goals: SavingsGoal[];
  transactions: Transaction[];
  onSelectGoal?: (goal: SavingsGoal) => void;
  onQuickAddGoal?: () => void;
}

const fmt = (n: number) => n.toLocaleString('ru-RU', { maximumFractionDigits: 0 }) + ' Br';

export const CarGoalForecastCard: React.FC<CarGoalForecastCardProps> = ({
  goals,
  transactions,
  onSelectGoal,
  onQuickAddGoal,
}) => {
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

  const [extraMonthly, setExtraMonthly] = useState<number>(200);
  const [includeBuffer, setIncludeBuffer] = useState<boolean>(true);

  // Средний темп чистых сбережений
  const avgMonthlySavings = useMemo(() => {
    if (!transactions || transactions.length === 0) return 850;
    const monthMap = new Map<string, { income: number; expense: number }>();
    for (const tx of transactions) {
      const ym = tx.date.slice(0, 7);
      if (!monthMap.has(ym)) monthMap.set(ym, { income: 0, expense: 0 });
      const entry = monthMap.get(ym)!;
      if (tx.type === 'income') entry.income += tx.amount;
      else entry.expense += tx.amount;
    }

    const deltas: number[] = [];
    for (const [, val] of monthMap.entries()) {
      const net = val.income - val.expense;
      if (net > 0) deltas.push(net);
    }
    if (deltas.length === 0) return 850;
    return Math.max(300, Math.round(deltas.reduce((a, b) => a + b, 0) / deltas.length));
  }, [transactions]);

  if (!carGoal) {
    return (
      <div className="card p-5 flex items-center justify-between gap-3 bg-white border border-slate-100">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-slate-100 text-slate-700 flex items-center justify-center shrink-0">
            <Car className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-xs font-bold text-slate-800">Цель: Автомобиль</h3>
            <p className="text-[11px] text-slate-400">Поставьте цель для расчета срока покупки</p>
          </div>
        </div>
        {onQuickAddGoal && (
          <button
            type="button"
            onClick={onQuickAddGoal}
            className="px-3 py-1.5 rounded-xl bg-slate-900 text-white text-xs font-bold flex items-center gap-1 active:scale-95 transition-all shadow-sm"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Создать</span>
          </button>
        )}
      </div>
    );
  }

  const targetAmount = carGoal.target_amount + (includeBuffer ? 1500 : 0);
  const currentAmount = carGoal.current_amount;
  const remaining = Math.max(0, targetAmount - currentAmount);
  const percent = Math.min(100, Math.round((currentAmount / targetAmount) * 100));

  const baseMonths = Math.ceil(remaining / Math.max(100, avgMonthlySavings));
  const acceleratedMonths = Math.ceil(remaining / Math.max(100, avgMonthlySavings + extraMonthly));
  const monthsSaved = Math.max(0, baseMonths - acceleratedMonths);

  const calcDate = (m: number) => {
    const d = new Date();
    d.setMonth(d.getMonth() + m);
    return d.toLocaleString('ru-RU', { month: 'short', year: 'numeric' });
  };

  const targetDateStr = calcDate(acceleratedMonths);

  return (
    <div className="card p-5 flex flex-col gap-4 bg-white border border-slate-100/90 shadow-sm">
      {/* ── Top Glanceable Bar ── */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-2xl bg-slate-900 text-white flex items-center justify-center shrink-0 shadow-sm">
            <Car className="w-4 h-4" />
          </div>
          <div>
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-black text-slate-900">{carGoal.name}</span>
              <span className="text-[10px] font-bold text-slate-400">· {percent}%</span>
            </div>
            <span className="text-[11px] text-slate-500 font-medium">
              {fmt(currentAmount)} из {fmt(targetAmount)}
            </span>
          </div>
        </div>

        {/* Big Apple-style Date Metric */}
        <div 
          onClick={() => onSelectGoal && onSelectGoal(carGoal)}
          className="flex items-center gap-1 text-right cursor-pointer group"
        >
          <div className="flex flex-col items-end">
            <span className="text-xs font-black text-slate-900 capitalize tracking-tight">
              {targetDateStr}
            </span>
            <span className="text-[9px] font-bold text-slate-400 uppercase">
              {acceleratedMonths} {acceleratedMonths === 1 ? 'месяц' : acceleratedMonths < 5 ? 'месяца' : 'месяцев'}
            </span>
          </div>
          <ChevronRight className="w-4 h-4 text-slate-300 group-hover:text-slate-600 transition-colors" />
        </div>
      </div>

      {/* ── Apple Slim Progress Bar ── */}
      <div className="h-1.5 w-full bg-slate-100 rounded-full overflow-hidden">
        <div
          className="h-full rounded-full bg-slate-900 transition-all duration-500"
          style={{ width: `${percent}%` }}
        />
      </div>

      {/* ── Apple Segmented Accelerator ── */}
      <div className="flex flex-col gap-2 pt-1 border-t border-slate-50">
        <div className="flex items-center justify-between text-[11px]">
          <span className="text-slate-400 font-medium">Откладывать дополнительно:</span>
          {monthsSaved > 0 ? (
            <span className="font-extrabold text-emerald-600 flex items-center gap-1">
              <Sparkles className="w-3 h-3" /> на {monthsSaved} мес. быстрее
            </span>
          ) : (
            <span className="font-bold text-slate-500">Базовый темп</span>
          )}
        </div>

        {/* Minimal Segmented Pills */}
        <div className="p-1 bg-slate-100/70 rounded-xl flex gap-1">
          {[0, 100, 200, 350].map(val => (
            <button
              key={val}
              type="button"
              onClick={() => setExtraMonthly(val)}
              className={`flex-1 py-1.5 text-[11px] font-bold rounded-lg transition-all ${
                extraMonthly === val
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              {val === 0 ? '0' : `+${val}`}
            </button>
          ))}
        </div>

        {/* Minimal buffer toggle */}
        <div className="flex items-center justify-between pt-1">
          <span className="text-[11px] text-slate-400 font-medium">Буфер на выезд (+1 500 Br: ТО, резина, ГАИ)</span>
          <button
            type="button"
            onClick={() => setIncludeBuffer(!includeBuffer)}
            className={`w-8 h-4 rounded-full transition-colors relative ${includeBuffer ? 'bg-slate-900' : 'bg-slate-200'}`}
          >
            <div className={`w-3 h-3 rounded-full bg-white transition-transform absolute top-0.5 ${includeBuffer ? 'right-0.5' : 'left-0.5'}`} />
          </button>
        </div>
      </div>
    </div>
  );
};
