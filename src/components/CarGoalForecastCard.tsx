import React, { useState, useMemo } from 'react';
import { SavingsGoal, Transaction } from '../types';
import { Car, Sparkles, TrendingUp, Calendar, ShieldCheck, ChevronRight, PlusCircle, CheckCircle2 } from 'lucide-react';

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
  // Ищем цель на авто или берем первую активную
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

  // Симулятор: дополнительная сумма в месяц
  const [extraMonthly, setExtraMonthly] = useState<number>(150);
  // Буфер на первое ТО, страховку и резину (+1 500 Br)
  const [includeBuffer, setIncludeBuffer] = useState<boolean>(true);

  // Расчет среднего чистого дохода/сбережений за последние месяцы
  const avgMonthlySavings = useMemo(() => {
    if (!transactions || transactions.length === 0) return 850;

    // Группируем по месяцам (YYYY-MM)
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
    const avg = deltas.reduce((a, b) => a + b, 0) / deltas.length;
    return Math.max(300, Math.round(avg));
  }, [transactions]);

  if (!carGoal) {
    return (
      <div className="card p-5 border border-amber-200/60 bg-gradient-to-br from-amber-50/40 via-white to-orange-50/30 shadow-sm flex flex-col gap-3">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-2xl bg-amber-500/10 text-amber-600 flex items-center justify-center shrink-0">
            <Car className="w-6 h-6" />
          </div>
          <div className="flex flex-col">
            <h3 className="text-sm font-black text-slate-800 tracking-tight">Цель «Автомобиль» не создана</h3>
            <p className="text-[11px] text-slate-500">Поставьте цель, чтобы включить смарт-прогноз даты покупки и симулятор.</p>
          </div>
        </div>
        {onQuickAddGoal && (
          <button
            type="button"
            onClick={onQuickAddGoal}
            className="w-full py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold transition-all active:scale-95 flex items-center justify-center gap-2 shadow-sm"
          >
            <PlusCircle className="w-4 h-4" />
            <span>Создать цель «Машина» (30 000 Br)</span>
          </button>
        )}
      </div>
    );
  }

  const targetAmount = carGoal.target_amount + (includeBuffer ? 1500 : 0);
  const currentAmount = carGoal.current_amount;
  const remaining = Math.max(0, targetAmount - currentAmount);
  const percent = Math.min(100, Math.round((currentAmount / targetAmount) * 100));

  // Базовый расчет месяцев
  const baseRate = avgMonthlySavings;
  const baseMonths = Math.ceil(remaining / Math.max(100, baseRate));

  // Ускоренный расчет месяцев с учетом extraMonthly
  const acceleratedRate = baseRate + extraMonthly;
  const acceleratedMonths = Math.ceil(remaining / Math.max(100, acceleratedRate));
  const monthsSaved = Math.max(0, baseMonths - acceleratedMonths);

  // Вычисление даты покупки
  const calcDate = (months: number) => {
    const d = new Date();
    d.setMonth(d.getMonth() + months);
    return d.toLocaleString('ru-RU', { month: 'long', year: 'numeric' });
  };

  const targetDateStr = calcDate(acceleratedMonths);

  // Этапы прогресса
  const milestones = [
    { label: '25% · Первоначальный взнос', threshold: 25, reached: percent >= 25 },
    { label: '50% · Половина цели', threshold: 50, reached: percent >= 50 },
    { label: '75% · Финишная прямая', threshold: 75, reached: percent >= 75 },
    { label: '100% · Покупка авто без долгов', threshold: 100, reached: percent >= 100 },
  ];

  return (
    <div className="card p-5 border border-slate-200/80 bg-gradient-to-br from-white via-slate-50/40 to-indigo-50/20 shadow-sm flex flex-col gap-4">
      {/* ── Header ── */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-2xl bg-slate-900 text-white flex items-center justify-center shadow-md shadow-slate-900/10 shrink-0">
            <Car className="w-5 h-5" />
          </div>
          <div className="flex flex-col">
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-black text-slate-800 tracking-tight">{carGoal.name}</span>
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 font-extrabold">
                {percent}%
              </span>
            </div>
            <span className="text-[11px] text-slate-400 font-medium">
              Собрано {fmt(currentAmount)} из {fmt(targetAmount)}
            </span>
          </div>
        </div>

        {onSelectGoal && (
          <button
            type="button"
            onClick={() => onSelectGoal(carGoal)}
            className="w-8 h-8 rounded-xl bg-slate-100 hover:bg-slate-200 flex items-center justify-center text-slate-600 transition-colors"
            title="Открыть детали цели"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* ── Progress Bar with Milestones ── */}
      <div className="flex flex-col gap-1.5">
        <div className="h-2.5 w-full bg-slate-100 rounded-full overflow-hidden p-0.5 border border-slate-200/60">
          <div
            className="h-full rounded-full bg-gradient-to-r from-slate-900 to-indigo-600 transition-all duration-700"
            style={{ width: `${percent}%` }}
          />
        </div>
        <div className="flex justify-between items-center text-[10px] text-slate-400 font-semibold">
          <span>Осталось накопить: <strong className="text-slate-700">{fmt(remaining)}</strong></span>
          <span>Темп: ~{fmt(baseRate)}/мес</span>
        </div>
      </div>

      {/* ── Smart Forecast Badge ── */}
      <div className="p-3.5 rounded-2xl bg-gradient-to-r from-slate-900 to-slate-800 text-white flex flex-col gap-1.5 shadow-md shadow-slate-900/10">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5 text-indigo-300">
            <Sparkles className="w-3.5 h-3.5" />
            <span className="text-[10px] font-bold uppercase tracking-wider">Прогноз покупки</span>
          </div>
          <div className="flex items-center gap-1 text-[11px] text-slate-300 font-bold">
            <Calendar className="w-3.5 h-3.5 text-slate-400" />
            <span className="capitalize">{targetDateStr}</span>
          </div>
        </div>
        <div className="flex items-baseline justify-between pt-0.5">
          <span className="text-xl font-black text-white tracking-tight">
            Через {acceleratedMonths} {acceleratedMonths === 1 ? 'месяц' : acceleratedMonths < 5 ? 'месяца' : 'месяцев'}
          </span>
          {monthsSaved > 0 && (
            <span className="text-[11px] font-extrabold text-emerald-400 bg-emerald-950/60 px-2 py-0.5 rounded-lg border border-emerald-500/20">
              ⚡ на {monthsSaved} мес. быстрее!
            </span>
          )}
        </div>
      </div>

      {/* ── Interactive Acceleration Simulator ── */}
      <div className="flex flex-col gap-2.5 bg-white p-3.5 rounded-2xl border border-slate-100">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <TrendingUp className="w-3.5 h-3.5 text-indigo-600" />
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Симулятор ускорения</span>
          </div>
          <span className="text-xs font-black text-slate-800">+{extraMonthly} Br / мес</span>
        </div>

        {/* Quick acceleration chips */}
        <div className="grid grid-cols-4 gap-1.5">
          {[0, 100, 200, 350].map(val => (
            <button
              key={val}
              type="button"
              onClick={() => setExtraMonthly(val)}
              className={`py-1.5 rounded-xl text-[11px] font-extrabold transition-all border ${
                extraMonthly === val
                  ? 'bg-slate-900 text-white border-slate-900 shadow-sm'
                  : 'bg-slate-50 hover:bg-slate-100 text-slate-600 border-slate-200/70'
              }`}
            >
              {val === 0 ? 'Базовый' : `+${val} Br`}
            </button>
          ))}
        </div>

        {/* Buffer toggle: Maintenance + Insurance */}
        <label className="flex items-center justify-between gap-2 pt-1 cursor-pointer select-none">
          <div className="flex items-center gap-1.5">
            <ShieldCheck className="w-3.5 h-3.5 text-slate-400" />
            <span className="text-[11px] text-slate-600 font-medium">Буфер на выезд (ТО, страховка, резина +1 500 Br)</span>
          </div>
          <input
            type="checkbox"
            checked={includeBuffer}
            onChange={e => setIncludeBuffer(e.target.checked)}
            className="w-4 h-4 rounded text-slate-900 focus:ring-0 cursor-pointer accent-slate-900"
          />
        </label>
      </div>

      {/* ── Milestones Checklist ── */}
      <div className="flex flex-col gap-1.5 pt-1">
        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Этапы владения</span>
        <div className="grid grid-cols-1 gap-1.5">
          {milestones.map((m, idx) => (
            <div
              key={idx}
              className={`px-3 py-2 rounded-xl flex items-center justify-between text-xs transition-colors border ${
                m.reached 
                  ? 'bg-emerald-50/60 border-emerald-200/60 text-emerald-800' 
                  : 'bg-slate-50/50 border-slate-100 text-slate-500'
              }`}
            >
              <div className="flex items-center gap-2">
                <CheckCircle2 className={`w-4 h-4 shrink-0 ${m.reached ? 'text-emerald-600' : 'text-slate-300'}`} />
                <span className="font-medium text-[11px]">{m.label}</span>
              </div>
              <span className="text-[10px] font-bold">{m.threshold}%</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
