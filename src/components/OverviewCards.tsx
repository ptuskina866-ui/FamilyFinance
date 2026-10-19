import { ArrowDownLeft, ArrowUpRight, ChevronRight, Eye, EyeOff, Landmark, ListFilter, Plus, ShieldCheck, Target } from 'lucide-react';
import { useApp } from '../AppContext';
import type { calculateSafeDaily } from '../lib/finance';
import type { SavingsGoal } from '../types';
import { localDateISO } from '../lib/money';
import { AccountsPanel } from './AccountsPanel';
import { PayDreamFirstBanner } from './PayDreamFirstBanner';
import { RecurringInsights } from './RecurringInsights';

const fmt = (n:number) => n.toLocaleString('ru-RU',{minimumFractionDigits:2,maximumFractionDigits:2})+' Br';
interface Props {
  hideAmounts:boolean; onToggleAmounts:()=>void; daily:ReturnType<typeof calculateSafeDaily>; goal?:SavingsGoal;
  onBank:()=>void; onPlans:()=>void; onJournal:()=>void; onReview:(ids:string[])=>void;
}
export function OverviewCards({hideAmounts,onToggleAmounts,daily,goal,onBank,onPlans,onJournal,onReview}:Props) {
  const {balance,availableBalance,reservedBalance,budgetReservedBalance,accountsReady,monthlyIncome,monthlyExpense,transactions,savingsGoals}=useApp();
  const money=(amount:number) => hideAmounts ? '••••' : fmt(amount);
  const progress=goal && goal.target_amount>0 ? Math.min(100,goal.current_amount/goal.target_amount*100) : 0;
  const monthLabel=new Date(localDateISO()+'T12:00:00Z').toLocaleString('ru-RU',{month:'long',timeZone:'Europe/Minsk'});
  return <>
    <section className="balance-hero" aria-label="Обзор баланса">
      <div className="flex items-center justify-between gap-3"><span className="text-xs text-[#d5e4cf]">Общий баланс</span><button type="button" onClick={onToggleAmounts} aria-label={hideAmounts?'Показать суммы':'Скрыть суммы'} aria-pressed={hideAmounts} className="w-11 h-11 -mr-2 -mt-2 rounded-2xl flex items-center justify-center text-[#dce9d8] bg-white/5">{hideAmounts?<EyeOff size={18}/>:<Eye size={18}/>}</button></div>
      <div className="flex items-baseline gap-2 mt-3"><p className="balance-value min-w-0">{hideAmounts?'••••••':balance.toLocaleString('ru-RU',{minimumFractionDigits:2,maximumFractionDigits:2})}</p><span className="text-xs text-[#c4d7c5]">BYN</span></div>
      {accountsReady && <dl className="balance-breakdown">
        <div className="min-w-0"><dt>Свободно</dt><dd className="money text-[#e1efb9]">{money(availableBalance)}</dd></div>
        <div className="min-w-0"><dt>Отложено на цели</dt><dd className="money">{money(reservedBalance)}</dd></div>
        {budgetReservedBalance>0 && <div className="min-w-0 col-span-2"><dt>В бюджетах</dt><dd className="money">{money(budgetReservedBalance)}</dd></div>}
      </dl>}
    </section>
    <div className="quick-actions" aria-label="Быстрые действия">
      <button type="button" onClick={onBank} className="quick-action" aria-label="Банки и операции"><Landmark size={21} strokeWidth={1.7}/><span>Банки</span></button>
      <button type="button" onClick={onPlans} className="quick-action"><Target size={21} strokeWidth={1.7}/><span>Накопления</span></button>
      <button type="button" onClick={onJournal} className="quick-action"><ListFilter size={21} strokeWidth={1.7}/><span>Операции</span></button>
    </div>
    <section className="daily-card" aria-labelledby="today-heading">
      <div className="flex justify-between gap-3 items-center"><h2 id="today-heading" className="text-xs font-bold flex items-center gap-2 shrink-0 whitespace-nowrap"><ShieldCheck size={17}/>На сегодня</h2><span className="text-[10px] text-slate-500 text-right">Оценка · {daily.daysLeft} дн. до конца месяца</span></div>
      <div className="flex flex-wrap items-baseline justify-between gap-2"><p className="daily-amount money">{money(daily.remaining)}</p><span className="text-[11px] text-slate-500">потрачено {money(daily.spentToday)}</span></div>
      {!hideAmounts && <div aria-hidden="true" className="h-1 rounded-full bg-[#d6e0c9] overflow-hidden"><div className={`h-full rounded-full ${daily.isOver?'bg-rose-600':'bg-[#54724a]'}`} style={{width:`${daily.limit>0?Math.min(100,daily.spentToday/daily.limit*100):daily.spentToday>0?100:0}%`}}/></div>}
      <p className={`text-[10px] leading-relaxed ${daily.isOver?'text-rose-700':'text-slate-500'}`}>{daily.isOver?'Сегодняшние расходы выше расчётного ориентира.':'После резервов на цели, бюджеты и предстоящие платежи.'}</p>
    </section>
    <section aria-label="Доходы и расходы за месяц" className="monthly-strip">
      <div className="min-w-0"><p className="flex items-center gap-1.5 text-[10px] text-slate-500 mb-1.5"><ArrowDownLeft size={14}/>Доходы · {monthLabel}</p><p className="money text-[15px] font-bold text-slate-800">{money(monthlyIncome)}</p></div>
      <div className="min-w-0"><p className="flex items-center gap-1.5 text-[10px] text-slate-500 mb-1.5"><ArrowUpRight size={14}/>Расходы за месяц</p><p className="money text-[15px] font-bold text-slate-800">{money(monthlyExpense)}</p></div>
    </section>
    <AccountsPanel hideBalances={hideAmounts}/>
    <section className="space-y-2" aria-labelledby="savings-heading"><div className="section-heading"><h2 id="savings-heading" className="section-title">Ближе к цели</h2><button type="button" onClick={onPlans} className="text-action">Все планы<ChevronRight size={14}/></button></div>
      {goal ? <button type="button" onClick={onPlans} className="card goal-preview"><span className="goal-ring" style={{background:`conic-gradient(#51754e ${progress}%,#e7ede3 0)`}}><span>{goal.emoji||'🎯'}</span></span><span className="flex-1 min-w-0"><span className="block text-sm font-bold truncate">{goal.name}</span><span className="block money text-xs text-slate-500 mt-1">{money(goal.current_amount)}<span className="block text-[10px] mt-1">{hideAmounts?'Цель скрыта':`из ${fmt(goal.target_amount)}`}</span></span></span><ChevronRight size={18} className="text-slate-400 shrink-0"/></button>
      : <button type="button" onClick={onPlans} className="card goal-preview"><span className="icon-button"><Plus size={20}/></span><span className="flex-1 text-sm font-bold">Создать первую цель<span className="block text-xs text-slate-500 font-normal mt-1">У каждой мечты будет свой план.</span></span><ChevronRight size={18}/></button>}
    </section>
    <PayDreamFirstBanner transactions={transactions} goals={savingsGoals} availableBalance={availableBalance} hideAmounts={hideAmounts} onOpenPlans={onPlans}/>
    <RecurringInsights hideAmounts={hideAmounts} onOpenStatement={onBank} onReviewTransactions={onReview}/>
  </>;
}
