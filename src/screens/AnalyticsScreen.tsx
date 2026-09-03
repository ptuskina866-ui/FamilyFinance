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
    <div className="flex flex-col overflow-y-auto no-scrollbar h-full select-none">
      {/* ── Header ── */}
      <div 
        className="px-5 pb-3 safe-header flex justify-between items-center bg-[#E5F3E8]/95 backdrop-blur-md sticky top-0 z-30"
        style={{ paddingTop: 'max(28px, calc(env(safe-area-inset-top, 0px) + 16px))' }}
      >
        <div className="w-9 h-9" /> {/* Spacer */}
        <h1 className="text-sm font-black text-slate-900 tracking-tight">Аналитика</h1>
        <div className="w-9 h-9 rounded-full bg-white border border-white/80 shadow-sm flex items-center justify-center text-base active:scale-95 transition-transform">
          {profile?.avatar || '👤'}
        </div>
      </div>

      {/* ── Scrollable Body ── */}
      <div className="px-5 pt-3 pb-36 flex flex-col gap-5">

        {/* ── Tab Switcher ── */}
        <div className="p-1 bg-white/80 border border-white/80 rounded-2xl flex shadow-sm">
          <button
            onClick={() => setActiveTab('expense')}
            className={`flex-1 py-2.5 text-xs font-black rounded-xl transition-all duration-200 ${
              activeTab === 'expense' ? 'bg-slate-950 text-white shadow-sm' : 'text-slate-500 hover:text-slate-900'
            }`}
          >
            Расходы
          </button>
          <button
            onClick={() => setActiveTab('income')}
            className={`flex-1 py-2.5 text-xs font-black rounded-xl transition-all duration-200 ${
              activeTab === 'income' ? 'bg-emerald-600 text-white shadow-sm' : 'text-slate-500 hover:text-slate-900'
            }`}
          >
            Доходы
          </button>
        </div>

        {/* ── Main Chart Card ── */}
        <div className="card p-5 bg-white border border-white/80 shadow-[0_4px_20px_rgba(0,30,10,0.03)] rounded-[28px] flex flex-col gap-4">
          {/* Month Navigation Bar */}
          <div className="flex justify-between items-center pb-2 border-b border-slate-100">
            <div className="flex items-center gap-2">
              <Calendar className="w-4 h-4 text-slate-400" />
              <span className="text-xs font-black text-slate-800 capitalize tracking-tight">{mName}</span>
            </div>
            <div className="flex gap-1">
              <button
                onClick={handlePrevMonth}
                className="w-7 h-7 rounded-full bg-slate-100 hover:bg-slate-200 flex items-center justify-center text-slate-700 active:scale-90 transition-transform"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button
                onClick={handleNextMonth}
                className="w-7 h-7 rounded-full bg-slate-100 hover:bg-slate-200 flex items-center justify-center text-slate-700 active:scale-90 transition-transform"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Amount and Subtitle */}
          <div className="flex flex-col gap-0.5">
            <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">
              {activeTab === 'expense' ? 'Всего расходов' : 'Всего доходов'}
            </span>
            <p className="text-[34px] font-black tracking-tight text-slate-950 leading-none">
              {fmt(totalAmountForTab)}
            </p>
          </div>

          {/* Chart */}
          <div className="w-full h-[190px] -mx-2 pr-3 pt-2 relative">
            {totalAmountForTab === 0 ? (
              <div className="w-full h-full flex flex-col items-center justify-center bg-slate-50/50 rounded-2xl border border-dashed border-slate-200 gap-1.5">
                <span className="text-xl">📈</span>
                <p className="text-[11px] text-slate-400 font-medium">Нет операций за этот период</p>
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={getChartDataPoints()} margin={{ top: 10, right: 0, left: -25, bottom: 0 }}>
                  <defs>
                    <linearGradient id="chartGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={activeTab === 'expense' ? '#0F172A' : '#059669'} stopOpacity={0.15} />
                      <stop offset="95%" stopColor={activeTab === 'expense' ? '#0F172A' : '#059669'} stopOpacity={0.0} />
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
                    stroke={activeTab === 'expense' ? '#0F172A' : '#059669'}
                    strokeWidth={2.5}
                    fillOpacity={1}
                    fill="url(#chartGradient)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        {/* ── Auto Goal Money Leaks Detector ── */}
        {activeTab === 'expense' && (
          <MoneyLeaksCard transactions={transactions} />
        )}

        {/* ── Categories Breakdown ── */}
        <div className="card p-5 bg-white border border-white/80 shadow-[0_4px_20px_rgba(0,30,10,0.03)] rounded-[28px] flex flex-col gap-4">
          <div className="flex justify-between items-center">
            <h2 className="text-xs font-black text-slate-900 tracking-tight">Разделение по категориям</h2>
            <span className="text-[10px] font-bold text-slate-400">
              {breakdownData.length} {breakdownData.length === 1 ? 'категория' : 'категорий'}
            </span>
          </div>

          {breakdownData.length === 0 ? (
            <div className="py-6 text-center">
              <p className="text-slate-400 text-xs font-semibold">Операций пока нет</p>
            </div>
          ) : (
            <div className="grid grid-cols-4 gap-y-4 gap-x-2">
              {breakdownData.map(item => {
                const cat = item.category;
                if (!cat) return null;
                return (
                  <div key={cat.id} className="flex flex-col items-center gap-1.5 text-center group active:scale-95 transition-transform">
                    {/* Circle icon - Solid Neo-Fintech Dark Circle */}
                    <div className="w-12 h-12 rounded-full bg-slate-950 text-white flex items-center justify-center shadow-sm group-hover:scale-105 transition-transform">
                      <DynamicIcon
                        name={cat.icon}
                        className="w-5 h-5 text-white"
                      />
                    </div>
                    {/* Details */}
                    <div className="flex flex-col min-w-0 w-full">
                      <span className="text-[10px] font-bold text-slate-700 truncate px-0.5">{cat.name}</span>
                      <span className="text-[11px] font-black text-slate-950 mt-0.5">{fmt(item.value)}</span>
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
