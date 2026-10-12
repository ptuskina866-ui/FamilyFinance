import React, { useMemo } from 'react';
import { Transaction } from '../types';
import { Fuel, Coffee, ArrowUpRight } from 'lucide-react';
import { isCashflow } from '../lib/finance';
import { sumMoney, localDateISO } from '../lib/money';

interface MoneyLeaksCardProps {
  transactions: Transaction[];
}

const fmt = (n: number) => n.toLocaleString('ru-RU', { maximumFractionDigits: 0 }) + ' Br';

export const MoneyLeaksCard: React.FC<MoneyLeaksCardProps> = ({ transactions }) => {
  const analysis = useMemo(() => {
    const month = localDateISO().slice(0, 7);
    const monthExpenses = transactions.filter(t => isCashflow(t) && t.type === 'expense' && t.date.startsWith(month));

    let taxiSum = 0;
    let cafesSum = 0;

    for (const t of monthExpenses) {
      if (t.categoryId === 'transport') taxiSum = sumMoney([taxiSum, t.amount]);
      else if (t.categoryId === 'cafes') cafesSum = sumMoney([cafesSum, t.amount]);
    }

    const totalLeaks = sumMoney([taxiSum, cafesSum]);

    return {
      taxiSum,
      cafesSum,
      totalLeaks,
    };
  }, [transactions]);

  if (analysis.totalLeaks === 0) return null;

  return (
    <div className="card p-4 flex flex-col gap-3 bg-white border border-slate-100/90 shadow-sm">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
          Расходы для проверки
        </span>
        <span className="text-[11px] font-extrabold text-emerald-600 flex items-center gap-0.5">
          <ArrowUpRight className="w-3.5 h-3.5" /> {fmt(analysis.totalLeaks)} за текущий месяц
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
            Транспорт
          </span>
        </div>

        {/* Cafes */}
        <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-100 flex flex-col gap-0.5">
          <div className="flex items-center justify-between text-slate-400">
            <Coffee className="w-3.5 h-3.5 text-yellow-600" />
            <span className="text-[10px] font-bold">{fmt(analysis.cafesSum)}</span>
          </div>
          <span className="text-xs font-black text-slate-800">
            Кафе
          </span>
        </div>
      </div>
    </div>
  );
};
