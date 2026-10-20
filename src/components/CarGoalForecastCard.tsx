import React, { useMemo } from 'react';
import { SavingsGoal, Transaction } from '../types';
import { Target, ChevronRight, Plus } from 'lucide-react';
import { goalForecast, goalMonthlyNeeded } from '../lib/finance';

interface CarGoalForecastCardProps {
  goals: SavingsGoal[];
  transactions: Transaction[];
  onSelectGoal?: (goal: SavingsGoal) => void;
  onQuickAddGoal?: () => void;
}

const fmt = (n: number) => n.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' Br';

// The export name is retained for existing callers; forecasts now support every goal.
export const CarGoalForecastCard: React.FC<CarGoalForecastCardProps> = ({ goals, transactions, onSelectGoal, onQuickAddGoal }) => {
  const goal = useMemo(() => goals.find(g => !g.is_archived && !g.is_completed && g.current_amount < g.target_amount), [goals]);

  if (!goal) {
    return (
      <div className="card p-5 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-10 h-10 rounded-2xl bg-slate-100 text-slate-700 flex items-center justify-center shrink-0"><Target className="w-5 h-5" /></div>
          <div>
            <h3 className="text-xs font-bold text-slate-800">План накопления</h3>
            <p className="text-[11px] text-slate-500">Задайте сумму и срок своей следующей цели</p>
          </div>
        </div>
        {onQuickAddGoal && <button type="button" onClick={onQuickAddGoal} className="px-3 py-2 rounded-xl bg-slate-900 text-white text-xs font-bold flex items-center gap-1 shrink-0 active:scale-95"><Plus className="w-3.5 h-3.5" />Создать</button>}
      </div>
    );
  }

  const forecast = goalForecast(goal, transactions);
  const monthlyNeeded = goalMonthlyNeeded(goal);
  const percent = Math.min(100, Math.max(0, goal.target_amount > 0 ? Math.round(goal.current_amount / goal.target_amount * 100) : 0));

  return (
    <div className="card p-5 flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <span className="w-10 h-10 rounded-2xl bg-slate-50 flex items-center justify-center text-2xl shrink-0">{goal.emoji}</span>
          <div className="min-w-0">
            <p className="text-[11px] font-bold text-slate-400 tracking-normal">План накопления</p>
            <h3 className="text-sm font-black text-slate-900 break-words">{goal.name}</h3>
          </div>
        </div>
        {onSelectGoal && <button type="button" onClick={() => onSelectGoal(goal)} aria-label={`Отложить на цель ${goal.name}`} className="w-9 h-9 bg-slate-100 rounded-full flex items-center justify-center shrink-0 text-slate-700"><ChevronRight className="w-4 h-4" /></button>}
      </div>
      <div className="flex flex-col gap-2">
        <p className="text-[11px] text-slate-500"><strong className="text-slate-800">{fmt(goal.current_amount)}</strong> из {fmt(goal.target_amount)} · {percent}%</p>
        <div className="h-1.5 w-full bg-slate-100 rounded-full overflow-hidden"><div className="h-full rounded-full bg-slate-900" style={{ width: `${percent}%` }} /></div>
      </div>
      {goal.deadline && <div className="rounded-2xl bg-slate-50 p-3 text-[11px] text-slate-600">
        <p>Срок: <strong>{new Date(`${goal.deadline}T12:00:00`).toLocaleDateString('ru-RU')}</strong></p>
        {monthlyNeeded !== null ? <p className="mt-1">Чтобы успеть: <strong className="text-slate-800">{fmt(monthlyNeeded)} в месяц</strong></p> : <p className="mt-1">Срок уже прошёл. Для нового плана создайте цель с будущей датой.</p>}
      </div>}
      {forecast ? <div className="text-[11px] text-slate-500 leading-relaxed">
        <p>По истории этой цели: <strong className="text-slate-800">{fmt(forecast.monthlyContribution)} в месяц</strong>.</p>
        <p>При таком темпе: <strong className="text-slate-800">{new Date(`${forecast.date}T12:00:00`).toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' })}</strong>. Это оценка, будущие пополнения могут её изменить.</p>
      </div> : <p className="text-[11px] text-slate-500 leading-relaxed">Для прогноза нужны пополнения этой цели. Пока ориентируйтесь на сумму и выбранный срок.</p>}
    </div>
  );
};
