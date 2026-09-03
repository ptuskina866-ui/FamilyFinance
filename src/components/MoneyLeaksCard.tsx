import React, { useMemo } from 'react';
import { Transaction } from '../types';
import { Fuel, Car, Coffee, Sparkles } from 'lucide-react';

interface MoneyLeaksCardProps {
  transactions: Transaction[];
}

const fmt = (n: number) => n.toLocaleString('ru-RU', { maximumFractionDigits: 0 }) + ' Br';

export const MoneyLeaksCard: React.FC<MoneyLeaksCardProps> = ({ transactions }) => {
  const analysis = useMemo(() => {
    const now = new Date();
    const cm = now.getMonth();
    const cy = now.getFullYear();

    // Фильтруем расходы за текущий месяц (или все расходы если мало данных)
    let monthExpenses = transactions.filter(t => {
      const d = new Date(t.date);
      return t.type === 'expense' && d.getMonth() === cm && d.getFullYear() === cy;
    });

    if (monthExpenses.length < 5) {
      monthExpenses = transactions.filter(t => t.type === 'expense');
    }

    // Подсчет по категориям утечек
    let taxiSum = 0;
    let cafesSum = 0;
    let marketSum = 0;

    for (const t of monthExpenses) {
      if (t.categoryId === 'transport') {
        taxiSum += t.amount;
      } else if (t.categoryId === 'cafes') {
        cafesSum += t.amount;
      } else if (t.categoryId === 'marketplaces') {
        marketSum += t.amount;
      }
    }

    const totalLeaks = taxiSum + cafesSum + marketSum;

    // Расчет в автомобильных эквивалентах
    // Стоимость 1 полного бака (50 л бензина АИ-95 ~ 2.44 Br/л = ~120 Br или ~60 Br на полбака)
    const fuelTanks = Math.max(1, (taxiSum / 60)).toFixed(1);
    
    // Стоимость комплекта новых шин (~800 Br)
    const tiresPercent = Math.min(100, Math.round((cafesSum / 800) * 100));

    // Потенциал экономии: если сократить утечки на 40%
    const monthlySavingPotential = Math.round(totalLeaks * 0.4);
    const yearlySavingPotential = monthlySavingPotential * 12;

    return {
      taxiSum,
      cafesSum,
      marketSum,
      totalLeaks,
      fuelTanks,
      tiresPercent,
      monthlySavingPotential,
      yearlySavingPotential,
    };
  }, [transactions]);

  if (analysis.totalLeaks === 0) return null;

  return (
    <div className="card p-5 border border-slate-200/80 bg-gradient-to-br from-white via-slate-50/50 to-amber-50/20 shadow-sm flex flex-col gap-4">
      {/* ── Header ── */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="w-10 h-10 rounded-2xl bg-amber-500/10 text-amber-600 flex items-center justify-center shrink-0">
            <Car className="w-5 h-5" />
          </div>
          <div className="flex flex-col">
            <h3 className="text-xs font-black text-slate-800 uppercase tracking-wider">Детектор утечек в пользу авто</h3>
            <span className="text-[11px] text-slate-400 font-medium">Конвертация импульсивных трат в эквиваленты машины</span>
          </div>
        </div>
      </div>

      {/* ── Auto Equivalents Cards ── */}
      <div className="grid grid-cols-2 gap-2.5">
        {/* Fuel Card */}
        <div className="p-3 rounded-2xl bg-slate-50 border border-slate-200/60 flex flex-col gap-1.5">
          <div className="flex items-center justify-between">
            <Fuel className="w-4 h-4 text-amber-600" />
            <span className="text-[10px] font-bold text-slate-400">Такси: {fmt(analysis.taxiSum)}</span>
          </div>
          <span className="text-lg font-black text-slate-800 tracking-tight leading-none">
            {analysis.fuelTanks} бака
          </span>
          <span className="text-[10px] text-slate-500 font-medium">
            бензина для вашей будущей машины
          </span>
        </div>

        {/* Cafes / Tires Card */}
        <div className="p-3 rounded-2xl bg-slate-50 border border-slate-200/60 flex flex-col gap-1.5">
          <div className="flex items-center justify-between">
            <Coffee className="w-4 h-4 text-yellow-600" />
            <span className="text-[10px] font-bold text-slate-400">Кафе: {fmt(analysis.cafesSum)}</span>
          </div>
          <span className="text-lg font-black text-slate-800 tracking-tight leading-none">
            {analysis.tiresPercent}%
          </span>
          <span className="text-[10px] text-slate-500 font-medium">
            от стоимости комплекта зимних шин
          </span>
        </div>
      </div>

      {/* ── Potential Acceleration Box ── */}
      <div className="p-3.5 rounded-2xl bg-gradient-to-r from-slate-900 to-indigo-950 text-white flex flex-col gap-2 shadow-sm">
        <div className="flex items-center gap-1.5 text-amber-300">
          <Sparkles className="w-3.5 h-3.5" />
          <span className="text-[10px] font-bold uppercase tracking-wider">Потенциал ускорения цели</span>
        </div>
        <div className="flex items-baseline justify-between">
          <div className="flex flex-col">
            <span className="text-xl font-black text-white tracking-tight">
              +{fmt(analysis.yearlySavingPotential)} / год
            </span>
            <span className="text-[10px] text-slate-300 font-medium">
              если оптимизировать кофе, такси и доставки всего на 40%
            </span>
          </div>
          <span className="text-xs font-black text-emerald-400 bg-emerald-950/80 px-2 py-1 rounded-xl border border-emerald-500/20">
            ⚡ +{fmt(analysis.monthlySavingPotential)}/мес в авто
          </span>
        </div>
      </div>

      {/* ── Quick Smart Tips ── */}
      <div className="flex flex-col gap-1.5 pt-0.5">
        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Быстрые привычки для авто</span>
        <div className="flex flex-col gap-1 text-[11px] text-slate-600">
          <div className="flex items-center gap-2 p-2 rounded-xl bg-slate-50/70 border border-slate-100">
            <span>🚇</span>
            <span>2 поездки на метро вместо такси в неделю = <strong>+70 Br/мес</strong> в копилку</span>
          </div>
          <div className="flex items-center gap-2 p-2 rounded-xl bg-slate-50/70 border border-slate-100">
            <span>🍳</span>
            <span>1 домашний ужин вместо доставки в выходные = <strong>+120 Br/мес</strong> в цель</span>
          </div>
        </div>
      </div>
    </div>
  );
};
