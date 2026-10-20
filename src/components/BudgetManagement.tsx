import { useRef, useState } from 'react';
import { useApp } from '../AppContext';
import { planningDateISO } from '../lib/planning';
import { previousBudgetReview,previousPlanningMonth,transferBudgetPreview } from '../lib/flexiblePlanning';
import { parseMoneyInput,sumMoney } from '../lib/money';
import type { BudgetRolloverMode } from '../types';
const fmt=(n:number)=>n.toLocaleString('ru-RU',{minimumFractionDigits:2,maximumFractionDigits:2})+' Br';
const field='input-light w-full min-w-0';
const button='rounded-xl bg-slate-950 p-3 text-xs font-bold text-white disabled:opacity-40';
export function BudgetManagement(){
 const {categoryBudgets,transactions,categories,savingsGoals,budgetRollovers,flexiblePlanningReady,accountsReady,transferCategoryBudget,reviewBudgetMonth}=useApp();
 const [open,setOpen]=useState(false),[from,setFrom]=useState('food'),[to,setTo]=useState('other'),[amount,setAmount]=useState('');
 const [mode,setMode]=useState<BudgetRolloverMode>('carry'),[goalId,setGoalId]=useState(''),[error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false);
 const [errorScope,setErrorScope]=useState<'transfer'|'review'>('transfer');
 const pending=useRef(false),month=`${planningDateISO().slice(0,7)}-01`,previous=previousPlanningMonth();
 const expense=categories.filter(c=>c.id!=='salary'&&c.id!=='savings'&&!c.id.startsWith('income-'));
 const prior=categoryBudgets.filter(b=>b.month===previous),current=categoryBudgets.filter(b=>b.month===month&&b.allocated_amount>0);
 const reviewed=budgetRollovers.find(r=>r.source_month===previous),preview=previousBudgetReview(categoryBudgets,transactions,mode);
 const total=sumMoney(preview.map(i=>i.amount));
 const goals=savingsGoals.filter(g=>!g.is_archived);
 const work=async(action:()=>Promise<void>,message:string,scope:'transfer'|'review'='transfer')=>{if(pending.current)return;pending.current=true;setBusy(true);setErrorScope(scope);setError('');setNotice('');try{await action();setNotice(message);}catch(e){setError(e instanceof Error?e.message:'Не удалось изменить бюджет.');}finally{pending.current=false;setBusy(false);}};
 return <>
  <div className="card p-4 flex flex-col gap-3"><button type="button" className="text-xs font-bold text-slate-700 py-2" disabled={!flexiblePlanningReady || !accountsReady || busy || !current.length} onClick={()=>{setOpen(!open);const source=current[0]?.category_id || 'food';setFrom(source);if(to===source)setTo(expense.find(c=>c.id!==source)?.id || 'other');setError('');}}>Перенести деньги между категориями</button>
   {open&&<form className="flex flex-col gap-3" onSubmit={e=>{e.preventDefault();void work(async()=>{const value=parseMoneyInput(amount);if(value===null)throw new Error('Укажите сумму с точностью до копейки.');transferBudgetPreview(categoryBudgets,transactions,from,to,value,month);await transferCategoryBudget(from,to,value);setOpen(false);setAmount('');},'Деньги перенесены. Свободный и общий остатки не изменились.');}}>
    <label className="text-xs text-slate-500">Из категории<select aria-label="Перенос из категории" className={`${field} mt-1`} value={from} disabled={busy} onChange={e=>{setFrom(e.target.value);if(to===e.target.value)setTo(expense.find(c=>c.id!==e.target.value)?.id || 'other');}}>{current.map(b=><option key={b.id} value={b.category_id}>{categories.find(c=>c.id===b.category_id)?.name || b.category_id}</option>)}</select></label>
    <label className="text-xs text-slate-500">В категорию<select aria-label="Перенос в категорию" className={`${field} mt-1`} value={to} disabled={busy} onChange={e=>setTo(e.target.value)}>{expense.filter(c=>c.id!==from).map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
    <input aria-label="Сумма переноса бюджета" className={field} inputMode="decimal" placeholder="Сумма, Br" value={amount} disabled={busy} onChange={e=>setAmount(e.target.value)}/>
    <p className="text-[11px] text-slate-500">Переносится только непотраченный остаток. Если выбранная категория уже превышена, новая сумма станет доступной сверх её прошлых расходов.</p>
    <button className={button} disabled={busy}>Подтвердить перенос</button>
   </form>}
   {error&&errorScope==='transfer'&&<p role="alert" className="text-xs text-rose-700">{error}</p>}
  </div>
  {!!prior.length&&<div className="card p-4 flex flex-col gap-3"><h2 className="text-sm font-black">Завершить прошлый месяц</h2>
   <p className="text-[11px] text-slate-500">{new Date(`${previous}T12:00:00`).toLocaleDateString('ru-RU',{month:'long',year:'numeric'})} · резервы уже стали свободными. Выберите, как использовать деньги сейчас; расходы прошлого месяца сохранятся.</p>
   {reviewed?<p className="text-xs text-slate-700">Решение сохранено: {({repeat:'повторить план',carry:'перенести остатки',goal:'направить в цель',release:'оставить свободными'})[reviewed.mode]}.</p>:<>
    <select aria-label="Решение по прошлому месяцу" className={field} value={mode} disabled={busy} onChange={e=>{setMode(e.target.value as BudgetRolloverMode);setError('');}}><option value="carry">Перенести остатки в категории</option><option value="repeat" disabled={!!current.length}>Повторить прошлый план</option><option value="goal">Отложить остатки в цель</option><option value="release">Оставить деньги свободными</option></select>
    {mode==='goal'&&<select aria-label="Цель для остатков" className={field} value={goalId || goals[0]?.id || ''} disabled={busy} onChange={e=>setGoalId(e.target.value)}>{goals.map(g=><option key={g.id} value={g.id}>{g.emoji} {g.name}</option>)}</select>}
    <div className="rounded-xl bg-slate-50 p-3 text-xs flex flex-col gap-1">{preview.map(i=><p key={i.targetId}>{categories.find(c=>c.id===i.targetId)?.name || i.targetId}: <strong>{fmt(i.amount)}</strong></p>)}<p className="font-bold mt-1">{mode==='repeat'?'План месяца':'Остатки'}: {fmt(total)}</p></div>
    <button type="button" className={button} disabled={busy || !flexiblePlanningReady || !accountsReady || !preview.length || (mode==='goal'&&!goals.length)} onClick={()=>void work(()=>reviewBudgetMonth(mode,mode==='goal'?(goalId || goals[0]?.id || null):null,preview),'Решение по прошлому месяцу сохранено.','review')}>Подтвердить решение</button>
    {error&&errorScope==='review'&&<p role="alert" className="text-xs text-rose-700">{error}</p>}
   </>}
  </div>}
  {notice&&<p role="status" className="rounded-xl bg-slate-50 p-3 text-xs text-slate-800">{notice}</p>}
 </>;
}
