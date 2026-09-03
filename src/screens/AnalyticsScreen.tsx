import React, { useState } from 'react';
import { useApp } from '../AppContext';
import { useAuth } from '../AuthContext';
import { DynamicIcon } from '../components/CategoryGrid';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { Calendar, ChevronLeft, ChevronRight, ArrowUpRight, ArrowDownRight } from 'lucide-react';
import { MoneyLeaksCard } from '../components/MoneyLeaksCard';

const fmt = (n: number) => n.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' Br';

const AnalyticsScreen: React.FC = () => {
  const { transactions, categories } = useApp();
  const { profile } = useAuth();

  const [activeTab, setActiveTab] = useState<'expense' | 'income'>('expense');
  const [currentDate, setCurrentDate] = useState(new Date());

  const cm = currentDate.getMonth();
  const cy = currentDate.getFullYear();
  const mName = currentDate.toLocaleString('ru-RU', { month: 'long', year: 'numeric' });

  // Calculate dynamic totals for the selected month
  const selectedMonthExpensesList = transactions.filter(t => {
    const d = new Date(t.date);
    return t.type === 'expense' && d.getMonth() === cm && d.getFullYear() === cy;
  });
  const selectedMonthIncomesList = transactions.filter(t => {
    const d = new Date(t.date);
    return t.type === 'income' && d.getMonth() === cm && d.getFullYear() === cy;
  });

  const selectedMonthExpenseTotal = selectedMonthExpensesList.reduce((s, t) => s + t.amount, 0);
  const selectedMonthIncomeTotal = selectedMonthIncomesList.reduce((s, t) => s + t.amount, 0);

  const totalAmountForTab = activeTab === 'income' ? selectedMonthIncomeTotal : selectedMonthExpenseTotal;

  // Month navigation handlers
  const handlePrevMonth = () => {
    setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1));
  };
  const handleNextMonth = () => {
    setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1));
  };

  // Generate cumulative data points for AreaChart
  const getChartDataPoints = () => {
    const daysInMonth = new Date(cy, cm + 1, 0).getDate();
    const points = [];
    let cumulative = 0;
    
    const currentMonthTx = transactions
      .filter(t => {
        const d = new Date(t.date);
        return t.type === activeTab && d.getMonth() === cm && d.getFullYear() === cy;
      })
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    for (let day = 1; day <= daysInMonth; day++) {
      const dateStr = `${cy}-${String(cm + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      
      const dailySum = currentMonthTx
        .filter(t => t.date === dateStr)
        .reduce((sum, t) => sum + t.amount, 0);
        
      cumulative += dailySum;
      
      points.push({
        day: day,
        dateLabel: `${day}`,
        amount: cumulative
      });
    }
    return points;
  };

  // Setup category breakdown
  const tabCategories = categories.filter(c =>
    activeTab === 'income'
      ? c.id === 'salary' || c.id.startsWith('income-')
      : !c.id.startsWith('income-') && c.id !== 'salary' && c.id !== 'food'
  );

  const selectedMonthTxList = activeTab === 'income' ? selectedMonthIncomesList : selectedMonthExpensesList;

  const breakdownData = tabCategories
    .map(cat => ({
      name: cat.name,
      value: selectedMonthTxList.filter(t => t.categoryId === cat.id).reduce((s, t) => s + t.amount, 0),
      accentColor: cat.accentColor,
      category: cat
    }))
    .filter(d => d.value > 0)
    .sort((a, b) => b.value - a.value);

  const CustomTooltip = ({ active, payload }: any) => {
    if (!active || !payload?.length) return null;
    const data = payload[0].payload;
    return (
      <div className="bg-white border border-slate-100 shadow-md px-3 py-1.5 rounded-xl text-[10px] font-bold text-slate-700">
        День {data.day}: {fmt(data.amount)}
      </div>
    );
  };

  return (
    <div className="flex flex-col overflow-y-auto no-scrollbar h-full bg-[#FFFFFF]">
      {/* ── Header ── */}
      <div className="px-5 pt-7 pb-2 safe-header flex justify-between items-center bg-white border-b border-slate-100/60 sticky top-0 z-30">
        <div className="w-9 h-9" /> {/* Spacer */}
        <h1 className="text-sm font-black text-slate-800 tracking-tight">Аналитика</h1>
        <div className="w-9 h-9 rounded-full bg-slate-50 border border-slate-100 flex items-center justify-center text-lg active:scale-95 transition-transform">
          {profile?.avatar || '👤'}
        </div>
      </div>

      {/* ── Scrollable Body ── */}
      <div className="px-5 pt-5 pb-8 flex flex-col gap-6">

        {/* ── Tab Switcher ── */}
        <div className="toggle-pill p-1 bg-slate-50 border border-slate-100 rounded-2xl flex">
          <button
            onClick={() => setActiveTab('expense')}
            className={`flex-1 py-2.5 text-xs font-bold rounded-xl transition-all duration-200 ${
              activeTab === 'expense' ? 'bg-[#0F172A] text-white shadow-sm' : 'text-slate-400'
            }`}
          >
            Расходы
          </button>
          <button
            onClick={() => setActiveTab('income')}
            className={`flex-1 py-2.5 text-xs font-bold rounded-xl transition-all duration-200 ${
              activeTab === 'income' ? 'bg-[#0F172A] text-white shadow-sm' : 'text-slate-400'
            }`}
          >
            Доходы
          </button>
        </div>

        {/* ── Amount and Subtitle ── */}
        <div className="flex flex-col gap-0.5 mt-2">
          <p className="text-[40px] font-black tracking-tight text-slate-800 leading-none">
            {fmt(totalAmountForTab)}
          </p>
          <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider mt-1">
            {activeTab === 'expense' ? 'Всего расходов' : 'Всего доходов'}
          </p>
        </div>

        {/* ── Month Navigation Bar ── */}
        <div className="flex justify-between items-center gap-3 bg-slate-50/50 border border-slate-100 rounded-2xl p-2.5">
          <div className="flex items-center gap-2 pl-1.5">
            <Calendar className="w-4 h-4 text-slate-400" />
            <span className="text-xs font-bold text-slate-700 capitalize">{mName}</span>
          </div>
          <div className="flex gap-1.5">
            <button
              onClick={handlePrevMonth}
              className="w-8 h-8 rounded-full bg-[#0F172A] hover:bg-[#1E293B] flex items-center justify-center text-white active:scale-90 transition-transform"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button
              onClick={handleNextMonth}
              className="w-8 h-8 rounded-full bg-[#0F172A] hover:bg-[#1E293B] flex items-center justify-center text-white active:scale-90 transition-transform"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* ── Chart ── */}
        <div className="w-full h-[220px] -mx-2 pr-4 relative">
          {totalAmountForTab === 0 ? (
            <div className="w-full h-full flex flex-col items-center justify-center bg-slate-50/30 rounded-2xl border border-dashed border-slate-200 gap-1.5">
              <span className="text-2xl">📈</span>
              <p className="text-[11px] text-slate-400 font-medium">Нет данных для графика за этот период</p>
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={getChartDataPoints()} margin={{ top: 10, right: 0, left: -25, bottom: 0 }}>
                <defs>
                  <linearGradient id="chartGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={activeTab === 'expense' ? '#FB923C' : '#34D399'} stopOpacity={0.18} />
                    <stop offset="95%" stopColor={activeTab === 'expense' ? '#FB923C' : '#34D399'} stopOpacity={0.0} />
                  </linearGradient>
                </defs>
                <XAxis
                  dataKey="day"
                  tickLine={false}
                  axisLine={false}
                  tick={{ fontSize: 9, fontWeight: 700, fill: '#94A3B8' }}
                  dy={8}
                />
                <YAxis
                  tickLine={false}
                  axisLine={false}
                  tick={{ fontSize: 9, fontWeight: 700, fill: '#94A3B8' }}
                />
                <Tooltip content={<CustomTooltip />} cursor={{ stroke: '#F1F5F9', strokeWidth: 1 }} />
                <Area
                  type="monotone"
                  dataKey="amount"
                  stroke={activeTab === 'expense' ? '#F97316' : '#10B981'}
                  strokeWidth={2.5}
                  fillOpacity={1}
                  fill="url(#chartGradient)"
                />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* ── Auto Goal Money Leaks Detector ── */}
        {activeTab === 'expense' && (
          <MoneyLeaksCard transactions={transactions} />
        )}

        {/* ── Categories Breakdown ── */}
        <div className="flex flex-col gap-3.5 mt-2">
          <h2 className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Разделение по категориям</h2>
          {breakdownData.length === 0 ? (
            <div className="card p-8 text-center bg-slate-50/20">
              <p className="text-slate-400 text-xs font-semibold">Операций пока нет</p>
            </div>
          ) : (
            <div className="grid grid-cols-4 gap-y-4 gap-x-2">
              {breakdownData.map(item => {
                const cat = item.category;
                if (!cat) return null;
                return (
                  <div key={cat.id} className="flex flex-col items-center gap-1.5 text-center">
                    {/* Circle icon */}
                    <div className="w-14 h-14 rounded-full bg-[#FAF2EA] hover:bg-[#F3E5D8] flex items-center justify-center active:scale-95 transition-all shadow-sm">
                      <DynamicIcon
                        name={cat.icon}
                        className="w-5 h-5 text-[#5C4033]"
                      />
                    </div>
                    {/* Details */}
                    <div className="flex flex-col min-w-0 w-full">
                      <span className="text-[10px] font-bold text-slate-700 truncate px-0.5">{cat.name}</span>
                      <span className="text-[10px] font-extrabold text-slate-800 mt-0.5">{fmt(item.value)}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* ── Summary Comparison Cards ── */}
        <div className="flex flex-col gap-3 mt-4 pb-4">
          <h2 className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Сводка за месяц</h2>
          <div className="flex flex-col gap-2.5">
            {/* Income Summary card */}
            <div className="card p-4 flex justify-between items-center">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-emerald-50 flex items-center justify-center text-emerald-600">
                  <ArrowUpRight className="w-4 h-4" />
                </div>
                <span className="text-xs font-bold text-slate-600">Доходы</span>
              </div>
              <span className="text-sm font-black text-slate-800">+{fmt(selectedMonthIncomeTotal)}</span>
            </div>
            {/* Expense Summary card */}
            <div className="card p-4 flex justify-between items-center">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-rose-50 flex items-center justify-center text-rose-500">
                  <ArrowDownRight className="w-4 h-4" />
                </div>
                <span className="text-xs font-bold text-slate-600">Расходы</span>
              </div>
              <span className="text-sm font-black text-slate-800">-{fmt(selectedMonthExpenseTotal)}</span>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
};

export default AnalyticsScreen;
