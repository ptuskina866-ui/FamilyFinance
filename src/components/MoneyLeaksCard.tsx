import React, { useMemo } from 'react';
import { Transaction } from '../types';
import { Fuel, Coffee, ArrowUpRight } from 'lucide-react';

interface MoneyLeaksCardProps {
  transactions: Transaction[];
}

const fmt = (n: number) => n.toLocaleString('ru-RU', { maximumFractionDigits: 0 }) + ' Br';

export const MoneyLeaksCard: React.FC<MoneyLeaksCardProps> = ({ transactions }) => {
  const analysis = useMemo(() => {
    const now = new Date();
    const cm = now.getMonth();
    const cy = now.getFullYear();

    let monthExpenses = transactions.filter(t => {
      const d = new Date(t.date);
      return t.type === 'expense' && d.getMonth() === cm && d.getFullYear() === cy;
    });

    if (monthExpenses.length < 5) {
      monthExpenses = transactions.filter(t => t.type === 'expense');
    }

    let taxiSum = 0;
    let cafesSum = 0;

    for (const t of monthExpenses) {
      if (t.categoryId === 'transport') taxiSum += t.amount;
      else if (t.categoryId === 'cafes') cafesSum += t.amount;
    }

    const totalLeaks = taxiSum + cafesSum;
    const fuelTanks = Math.max(1, Math.round(taxiSum / 60));
    const tiresPercent = Math.min(100, Math.round((cafesSum / 800) * 100));
    const monthlySavingPotential = Math.round(totalLeaks * 0.4);

    return {
      taxiSum,
      cafesSum,
      totalLeaks,
      fuelTanks,
      tiresPercent,
      monthlySavingPotential,
    };
  }, [transactions]);

  if (analysis.totalLeaks === 0) return null;

  return (
    <div className="card p-4 flex flex-col gap-3 bg-white border border-slate-100/90 shadow-sm">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
          Оптимизация в пользу авто
        </span>
        <span className="text-[11px] font-extrabold text-emerald-600 flex items-center gap-0.5">
          <ArrowUpRight className="w-3.5 h-3.5" /> +{fmt(analysis.monthlySavingPotential)}/мес
        </span>
      </div>

      <div className="grid grid-cols-2 gap-2">
        {/* Taxi */}
        <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-100 flex flex-col gap-0.5">
          <div className="flex items-center justify-between text-slate-400">
            <Fuel className="w-3.5 h-3.5 text-amber-600" />
            <span className="text-[10px] font-bold">{fmt(analysis.taxiSum)}</span>
          </div>
          <span className="text-xs font-black text-slate-800">
            {analysis.fuelTanks} {analysis.fuelTanks === 1 ? 'бак' : analysis.fuelTanks < 5 ? 'бака' : 'баков'} бензина
          </span>
        </div>

        {/* Cafes */}
        <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-100 flex flex-col gap-0.5">
          <div className="flex items-center justify-between text-slate-400">
            <Coffee className="w-3.5 h-3.5 text-yellow-600" />
            <span className="text-[10px] font-bold">{fmt(analysis.cafesSum)}</span>
          </div>
          <span className="text-xs font-black text-slate-800">
            {analysis.tiresPercent}% комплекта шин
          </span>
        </div>
      </div>
    </div>
  );
};
