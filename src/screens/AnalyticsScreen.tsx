import { ScreenHeader } from '../components/ScreenHeader';
import React, { useState } from 'react';
import { useApp } from '../AppContext';
import { DynamicIcon } from '../components/CategoryGrid';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { Calendar, ChevronLeft, ChevronRight, ArrowUpRight, ArrowDownRight } from 'lucide-react';
import { MoneyLeaksCard } from '../components/MoneyLeaksCard';
import { isCashflow } from '../lib/finance';
import { sumMoney } from '../lib/money';

const fmt = (n: number) => n.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' Br';

const AnalyticsScreen: React.FC = () => {
  const { transactions, categories } = useApp();

  const [activeTab, setActiveTab] = useState<'expense' | 'income'>('expense');
  const [currentDate, setCurrentDate] = useState(new Date());

  const cm = currentDate.getMonth();
  const cy = currentDate.getFullYear();
  const mName = currentDate.toLocaleString('ru-RU', { month: 'long', year: 'numeric' });

  // Calculate dynamic totals for the selected month
  const selectedMonthExpensesList = transactions.filter(t => {
    const d = new Date(t.date);
    return isCashflow(t) && t.type === 'expense' && d.getMonth() === cm && d.getFullYear() === cy;
  });
  const selectedMonthIncomesList = transactions.filter(t => {
    const d = new Date(t.date);
    return isCashflow(t) && t.type === 'income' && d.getMonth() === cm && d.getFullYear() === cy;
  });

  const selectedMonthExpenseTotal = sumMoney(selectedMonthExpensesList.map(t => t.amount));
  const selectedMonthIncomeTotal = sumMoney(selectedMonthIncomesList.map(t => t.amount));

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
        return isCashflow(t) && t.type === activeTab && d.getMonth() === cm && d.getFullYear() === cy;
      })
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    for (let day = 1; day <= daysInMonth; day++) {
      const dateStr = `${cy}-${String(cm + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      
      const dailySum = sumMoney(currentMonthTx.filter(t => t.date === dateStr).map(t => t.amount));
        
      cumulative = sumMoney([cumulative, dailySum]);
      
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
      : !c.id.startsWith('income-') && c.id !== 'salary'
  );

  const selectedMonthTxList = activeTab === 'income' ? selectedMonthIncomesList : selectedMonthExpensesList;

  const breakdownData = tabCategories
    .map(cat => ({
      name: cat.name,
      value: sumMoney(selectedMonthTxList.filter(t => t.categoryId === cat.id).map(t => t.amount)),
      accentColor: cat.accentColor,
      category: cat
    }))
    .filter(d => d.value > 0)
    .sort((a, b) => b.value - a.value);
  const unmapped = sumMoney(selectedMonthTxList.filter(t => !tabCategories.some(c => c.id === t.categoryId)).map(t => t.amount));
  if (unmapped > 0) {
    const category = { id: 'unmapped', name: 'Без категории', icon: 'HelpCircle', color: 'text-slate-400', bgColor: 'bg-slate-50', borderColor: 'border-slate-100', accentColor: '#64748b' };
    breakdownData.push({ name: category.name, value: unmapped, accentColor: category.accentColor, category });
    breakdownData.sort((a, b) => b.value - a.value);
  }

  const CustomTooltip = ({ active, payload }: any) => {
    if (!active || !payload?.length) return null;
    const data = payload[0].payload;
    return (
      <div className="bg-white border border-slate-100 shadow-md px-3 py-1.5 rounded-xl text-[11px] font-bold text-slate-700">
        День {data.day}: {fmt(data.amount)}
      </div>
    );
  };

  return (
    <div className="flex flex-col overflow-y-auto no-scrollbar h-full select-none">
      {/* ── Header ── */}
      <ScreenHeader title="Аналитика" eyebrow="Движение денег"/>

      {/* ── Scrollable Body ── */}
      <div className="screen-body flex flex-col gap-5">

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
              activeTab === 'income' ? 'bg-slate-900 text-white shadow-sm' : 'text-slate-500 hover:text-slate-900'
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
                aria-label="Предыдущий месяц"
                className="icon-button"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button
                onClick={handleNextMonth}
                aria-label="Следующий месяц"
                className="icon-button"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Amount and Subtitle */}
          <div className="flex flex-col gap-0.5">
            <span className="text-[11px] text-slate-400 font-bold tracking-normal">
              {activeTab === 'expense' ? 'Всего расходов' : 'Всего доходов'}
            </span>
            <p className="money text-[32px] font-bold tracking-tight text-slate-950 leading-tight">
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
                      <stop offset="5%" stopColor={activeTab === 'expense' ? '#555861' : '#059669'} stopOpacity={0.18} />
                      <stop offset="95%" stopColor={activeTab === 'expense' ? '#555861' : '#059669'} stopOpacity={0.0} />
                    </linearGradient>
                  </defs>
                  <XAxis
                    dataKey="day"
                    tickLine={false}
                    axisLine={false}
                    tick={{ fontSize: 9, fontWeight: 500, fill: '#707278' }}
                    dy={8}
                  />
                  <YAxis
                    tickLine={false}
                    axisLine={false}
                    tick={{ fontSize: 9, fontWeight: 500, fill: '#707278' }}
                  />
                  <Tooltip content={<CustomTooltip />} cursor={{ stroke: '#F1F5F9', strokeWidth: 1 }} />
                  <Area
                    type="monotone"
                    isAnimationActive={false}
                    dataKey="amount"
                    stroke={activeTab === 'expense' ? '#555861' : '#059669'}
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
            <span className="text-[11px] font-bold text-slate-400">
              {breakdownData.length} {breakdownData.length === 1 ? 'категория' : 'категорий'}
            </span>
          </div>

          {breakdownData.length === 0 ? (
            <div className="py-6 text-center">
              <p className="text-slate-400 text-xs font-semibold">Операций пока нет</p>
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              {breakdownData.map(item => {
                const cat = item.category;
                if (!cat) return null;
                return (
                  <div key={cat.id} className="flex items-center gap-3">
                    <span className="transaction-icon"><DynamicIcon name={cat.icon} className="w-[18px] h-[18px]"/></span>
                    <div className="flex-1 min-w-0"><div className="flex justify-between gap-3 text-xs mb-2"><span className="font-medium text-slate-700 break-words">{cat.name}</span><span className="money font-bold text-slate-950 text-right">{fmt(item.value)}</span></div>
                      <div className="h-1 rounded-full bg-slate-100 overflow-hidden" aria-hidden="true"><div className="h-full rounded-full bg-[#8b8e96]" style={{width:`${totalAmountForTab>0?Math.min(100,item.value/totalAmountForTab*100):0}%`}}/></div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* ── Summary Comparison Cards ── */}
        <div className="flex flex-col gap-3 mt-4 pb-4">
          <h2 className="text-[11px] text-slate-400 font-bold tracking-normal">Сводка за месяц</h2>
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
