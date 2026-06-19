import React from 'react';
import { useApp } from '../AppContext';
import { DynamicIcon } from '../components/CategoryGrid';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';
import { TrendingDown } from 'lucide-react';

const fmt = (n: number) => n.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' Br';

const AnalyticsScreen: React.FC = () => {
  const { transactions, categories, monthlyIncome, monthlyExpense } = useApp();

  const now  = new Date();
  const cm   = now.getMonth();
  const cy   = now.getFullYear();
  const mName = now.toLocaleString('ru-RU', { month: 'long', year: 'numeric' });

  const monthlyExpenses = transactions.filter(t => {
    const d = new Date(t.date);
    return t.type === 'expense' && d.getMonth() === cm && d.getFullYear() === cy;
  });

  const expenseCats = categories.filter(c => c.id !== 'salary' && c.id !== 'income-other');
  const chartData = expenseCats
    .map(cat => ({
      name: cat.name,
      value: monthlyExpenses.filter(t => t.categoryId === cat.id).reduce((s, t) => s + t.amount, 0),
      accentColor: cat.accentColor,
      category: cat
    }))
    .filter(d => d.value > 0)
    .sort((a, b) => b.value - a.value);

  const hasData = chartData.length > 0;
  const displayData = hasData ? chartData : [{ name: 'Нет расходов', value: 1, accentColor: '#E2E8F0', category: null }];

  const CustomTooltip = ({ active, payload }: any) => {
    if (!active || !payload?.length || !hasData) return null;
    const d = payload[0].payload;
    return (
      <div className="bg-white border border-slate-100 shadow-lg px-3 py-2 rounded-xl text-xs">
        <p className="font-semibold text-slate-700">{d.name}</p>
        <p className="font-bold mt-0.5" style={{ color: d.accentColor }}>{fmt(d.value)}</p>
      </div>
    );
  };

  const savingsRate = monthlyIncome > 0 ? Math.round(((monthlyIncome - monthlyExpense) / monthlyIncome) * 100) : 0;

  return (
    <div className="flex flex-col overflow-y-auto no-scrollbar pb-20 h-full bg-[#F0F4F8]">
      {/* Header */}
      <div className="px-5 pt-14 pb-5 bg-white border-b border-slate-100">
        <p className="text-xs text-slate-400 font-semibold uppercase tracking-wider mb-0.5">Статистика</p>
        <h1 className="text-2xl font-extrabold text-slate-800 capitalize">{mName}</h1>
      </div>

      <div className="px-4 pt-4 flex flex-col gap-4">

        {/* Summary cards row */}
        <div className="grid grid-cols-2 gap-3">
          <div className="card px-4 py-3 flex flex-col gap-1">
            <p className="text-xs text-slate-400 font-medium">Доходы</p>
            <p className="text-lg font-extrabold text-green-600">+{fmt(monthlyIncome)}</p>
          </div>
          <div className="card px-4 py-3 flex flex-col gap-1">
            <p className="text-xs text-slate-400 font-medium">Расходы</p>
            <p className="text-lg font-extrabold text-red-500">-{fmt(monthlyExpense)}</p>
          </div>
        </div>

        {/* Savings rate card */}
        <div className="card px-4 py-4 flex items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-green-50 flex items-center justify-center">
            <TrendingDown className="w-6 h-6 text-green-600" />
          </div>
          <div className="flex-1">
            <p className="text-xs text-slate-400 font-medium">Норма сбережений</p>
            <p className="text-xl font-extrabold" style={{ color: savingsRate >= 0 ? '#22C55E' : '#F43F5E' }}>
              {savingsRate}%
            </p>
          </div>
          <div className="w-16 h-2 bg-slate-100 rounded-full overflow-hidden">
            <div className="h-full rounded-full" style={{ width: `${Math.max(0, Math.min(100, savingsRate))}%`, background: savingsRate >= 0 ? '#22C55E' : '#F43F5E' }} />
          </div>
        </div>

        {/* Donut chart */}
        <div className="card p-5 flex flex-col items-center">
          <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-4 self-start">Структура расходов</p>

          <div className="w-full h-[200px] relative">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={displayData} cx="50%" cy="50%" innerRadius={60} outerRadius={85} paddingAngle={hasData ? 3 : 0} dataKey="value" stroke="none">
                  {displayData.map((entry, i) => <Cell key={i} fill={entry.accentColor} />)}
                </Pie>
                <Tooltip content={<CustomTooltip />} />
              </PieChart>
            </ResponsiveContainer>
            <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Итого</p>
              <p className="text-xl font-extrabold text-slate-800">{fmt(monthlyExpense)}</p>
            </div>
          </div>
        </div>

        {/* Category breakdown */}
        <div className="flex flex-col gap-2">
          <h2 className="text-sm font-bold text-slate-700 px-1">Разбивка по категориям</h2>
          {!hasData ? (
            <div className="card p-8 text-center">
              <p className="text-slate-400 text-sm">В этом месяце расходов пока нет</p>
            </div>
          ) : (
            chartData.map(item => {
              const cat = item.category;
              if (!cat) return null;
              const pct = monthlyExpense > 0 ? (item.value / monthlyExpense) * 100 : 0;
              return (
                <div key={cat.id} className="card px-4 py-3 flex flex-col gap-2">
                  <div className="flex justify-between items-center">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: `${cat.accentColor}15` }}>
                        <DynamicIcon name={cat.icon} className="w-4 h-4" style={{ color: cat.accentColor }} />
                      </div>
                      <div>
                        <p className="font-semibold text-sm text-slate-700">{cat.name}</p>
                        <p className="text-[11px] text-slate-400">{pct.toFixed(1)}% от расходов</p>
                      </div>
                    </div>
                    <p className="font-bold text-sm text-slate-800">{fmt(item.value)}</p>
                  </div>
                  <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                    <div className="h-full rounded-full transition-all duration-500" style={{ width: `${pct}%`, backgroundColor: cat.accentColor }} />
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};

export default AnalyticsScreen;
