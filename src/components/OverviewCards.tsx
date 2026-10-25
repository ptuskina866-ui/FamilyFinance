import { useRef } from 'react';
import { ArrowDownLeft, ArrowUpRight, ArrowRightLeft, ChevronDown, ChevronRight, Landmark, Plus, Target } from 'lucide-react';
import { useApp } from '../AppContext';
import type { calculateSafeDaily } from '../lib/finance';
import type { SavingsGoal } from '../types';
import { localDateISO } from '../lib/money';
import { AccountsPanel, type AccountsPanelHandle } from './AccountsPanel';
import { PayDreamFirstBanner } from './PayDreamFirstBanner';
import { RecurringInsights } from './RecurringInsights';

const fmt = (n:number) => n.toLocaleString('ru-RU',{minimumFractionDigits:2,maximumFractionDigits:2})+' Br';
interface Props {
  hideAmounts:boolean; daily:ReturnType<typeof calculateSafeDaily>; goal?:SavingsGoal;
  onBank:()=>void; onPlans:()=>void; onReview:(ids:string[])=>void;
}
export function OverviewCards({hideAmounts,daily,goal,onBank,onPlans,onReview}:Props) {
  const {balance,availableBalance,reservedBalance,budgetReservedBalance,accountsReady,monthlyIncome,monthlyExpense,transactions,savingsGoals,accounts,schemaReady,financeLoading}=useApp();
  const accountsRef=useRef<AccountsPanelHandle>(null);
  const money=(amount:number) => hideAmounts ? '••••' : fmt(amount);
  const progress=goal && goal.target_amount>0 ? Math.min(100,goal.current_amount/goal.target_amount*100) : 0;
  const monthLabel=new Date(localDateISO()+'T12:00:00Z').toLocaleString('ru-RU',{month:'long',timeZone:'Europe/Minsk'});
  return <>
    <section className="balance-hero" aria-label="Обзор баланса">
      <p className="balance-label">Общий баланс</p>
      <div className="flex flex-wrap items-baseline justify-center gap-2 mt-3"><p className="balance-value min-w-0">{hideAmounts?'••••••':balance.toLocaleString('ru-RU',{minimumFractionDigits:2,maximumFractionDigits:2})}</p><span className="text-xs text-slate-500">BYN</span></div>
      {accountsReady && <dl className="balance-breakdown">
        <div className="min-w-0"><dt>Свободно</dt><dd className="money">{money(availableBalance)}</dd></div>
        <div className="min-w-0"><dt>В целях</dt><dd className="money">{money(reservedBalance)}</dd></div>
        {budgetReservedBalance>0 && <div className="min-w-0 col-span-2"><dt>В бюджетах</dt><dd className="money">{money(budgetReservedBalance)}</dd></div>}
      </dl>}
      {!hideAmounts&&availableBalance<0&&<p role="status" className="bank-caption text-amber-800 mt-3">Не хватает {fmt(Math.abs(availableBalance))} свободных средств. Резервы в целях и бюджетах сохранены; их можно пересмотреть в планах.</p>}
    </section>
    <div className="quick-actions" aria-label="Быстрые действия">
      <button type="button" onClick={onPlans} className="quick-action"><span className="quick-action-icon"><Target size={21} strokeWidth={1.6}/></span><span>Накопления</span></button>
      <button type="button" onClick={onBank} className="quick-action is-primary" aria-label="Банки и операции"><span className="quick-action-icon"><Landmark size={21} strokeWidth={1.6}/></span><span>Банки</span></button>
      <button type="button" onClick={()=>accountsRef.current?.openTransfer()} disabled={!accountsReady || financeLoading || !schemaReady || accounts.filter(account=>!account.is_archived).length<2} className="quick-action" aria-label="Записать перевод между счетами"><span className="quick-action-icon"><ArrowRightLeft size={21} strokeWidth={1.6}/></span><span>Перевод</span></button>
    </div>
    <section className="daily-card" aria-labelledby="today-heading">
      <h2 id="today-heading" className="text-[11px] text-slate-500">Можно потратить сегодня</h2>
      <div className="flex flex-wrap items-baseline justify-between gap-2 mt-1"><p className="daily-amount money">{money(daily.remaining)}</p><span className="text-[11px] text-slate-500">потрачено {money(daily.spentToday)}</span></div>
      {!hideAmounts && <div aria-hidden="true" className="daily-meter"><div className={`h-full rounded-full ${daily.isOver?'bg-rose-600':'bg-[#476ba7]'}`} style={{width:`${daily.limit>0?Math.min(100,daily.spentToday/daily.limit*100):daily.spentToday>0?100:0}%`}}/></div>}
      <details className="daily-explanation"><summary className={daily.isOver?'daily-over':''}>{daily.isOver?'Расходы выше ориентира':'Как рассчитано'}<ChevronDown size={13}/></summary><p>Это ориентир на {daily.daysLeft} дн. до конца месяца, после резервов на цели, бюджеты и предстоящие платежи. Сумма уменьшается на сегодняшние расходы.</p></details>
    </section>
    <AccountsPanel ref={accountsRef} hideBalances={hideAmounts}/>
    <section aria-label="Доходы и расходы за месяц" className="monthly-strip">
      <div className="min-w-0 monthly-income"><p className="flex items-center gap-1.5 text-[11px] text-slate-500 mb-1.5"><ArrowDownLeft size={14}/>Доходы · {monthLabel}</p><p className="money text-[15px] font-bold text-slate-800">{money(monthlyIncome)}</p></div>
      <div className="min-w-0 monthly-expense"><p className="flex items-center gap-1.5 text-[11px] text-slate-500 mb-1.5"><ArrowUpRight size={14}/>Расходы за месяц</p><p className="money text-[15px] font-bold text-slate-800">{money(monthlyExpense)}</p></div>
    </section>
    <details className="overview-disclosure">
      <summary><span className="flex items-center gap-3 min-w-0"><Target size={20} strokeWidth={1.6}/><span><span className="block text-sm font-semibold">Планы и подсказки</span><span className="block text-xs text-slate-500 mt-1">Накопления и регулярные расходы</span></span></span><ChevronDown size={17}/></summary>
      <div className="overview-extra space-y-4">
    <section className="space-y-2" aria-labelledby="savings-heading"><div className="section-heading"><h2 id="savings-heading" className="section-title">Ближе к цели</h2><button type="button" onClick={onPlans} className="text-action">Все планы<ChevronRight size={14}/></button></div>
      {goal ? <button type="button" onClick={onPlans} className="card accent-savings goal-preview"><span className="goal-ring" style={{background:`conic-gradient(#796299 ${progress}%,#eff0f3 0)`}}><span>{goal.emoji||'🎯'}</span></span><span className="flex-1 min-w-0"><span className="block text-sm font-bold truncate">{goal.name}</span><span className="block money text-xs text-slate-500 mt-1">{money(goal.current_amount)}<span className="block text-[11px] mt-1">{hideAmounts?'Цель скрыта':`из ${fmt(goal.target_amount)}`}</span></span></span><ChevronRight size={18} className="text-slate-400 shrink-0"/></button>
      : <button type="button" onClick={onPlans} className="card accent-savings goal-preview"><span className="icon-button"><Plus size={20}/></span><span className="flex-1 text-sm font-bold">Создать первую цель<span className="block text-xs text-slate-500 font-normal mt-1">У каждой мечты будет свой план.</span></span><ChevronRight size={18}/></button>}
    </section>
    <PayDreamFirstBanner transactions={transactions} goals={savingsGoals} availableBalance={availableBalance} hideAmounts={hideAmounts} onOpenPlans={onPlans}/>
    <RecurringInsights hideAmounts={hideAmounts} onOpenStatement={onBank} onReviewTransactions={onReview}/>
      </div>
    </details>
  </>;
}
