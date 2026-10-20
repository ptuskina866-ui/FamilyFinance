import { useRef,useState } from 'react';
import { useApp } from '../AppContext';
import { emergencyCoverage,emergencyTarget,essentialExpenseSuggestion } from '../lib/flexiblePlanning';
import { goalMonthlyNeeded } from '../lib/finance';
import { planningDateISO } from '../lib/planning';
import { parseMoneyInput } from '../lib/money';
import type { SavingsGoal } from '../types';
import { ChevronDown } from 'lucide-react';
const fmt=(n:number)=>n.toLocaleString('ru-RU',{minimumFractionDigits:2,maximumFractionDigits:2})+' Br';
const field='input-light w-full min-w-0';
const button='rounded-xl bg-slate-950 p-3 text-xs font-bold text-white disabled:opacity-40';
export function FundsPlanner(){
 const {savingsGoals,availableBalance,transactions,categories,flexiblePlanningReady,accountsReady,saveFund,updateGoalAmount,withdrawGoalAmount,deleteGoal}=useApp();
 const [form,setForm]=useState<'emergency'|'expense_fund'|null>(null),[id,setId]=useState<string|undefined>(),[name,setName]=useState(''),[target,setTarget]=useState(''),[deadline,setDeadline]=useState(''),[essential,setEssential]=useState(''),[months,setMonths]=useState(3),[selected,setSelected]=useState(['food','housing','utilities']);
 const [funding,setFunding]=useState<{id:string;release:boolean}|null>(null),[amount,setAmount]=useState(''),[archiving,setArchiving]=useState<string|null>(null),[error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false);
 const pending=useRef(false),enabled=flexiblePlanningReady&&accountsReady&&!busy;
 const funds=savingsGoals.filter(g=>!g.is_archived&&g.purpose&&g.purpose!=='goal');
 const expense=categories.filter(c=>c.id!=='salary'&&c.id!=='savings'&&!c.id.startsWith('income-')&&!c.id.startsWith('food-'));
 const suggestion=essentialExpenseSuggestion(transactions,selected);
 let proposed=0;try{proposed=form==='emergency'?emergencyTarget(parseMoneyInput(essential)??0,months):parseMoneyInput(target)??0;}catch{/* incomplete form */}
 const work=async(action:()=>Promise<void>,message:string)=>{if(pending.current)return;pending.current=true;setBusy(true);setError('');setNotice('');try{await action();setNotice(message);}catch(e){setError(e instanceof Error?e.message:'Не удалось сохранить фонд.');}finally{pending.current=false;setBusy(false);}};
 const edit=(purpose:'emergency'|'expense_fund',goal?:SavingsGoal)=>{setId(goal?.id);setForm(purpose);setName(goal?.name || (purpose==='emergency'?'Подушка безопасности':''));setTarget(goal?String(goal.target_amount):'');setDeadline(goal?.deadline || '');setEssential(goal?.essential_amount?String(goal.essential_amount):'');setMonths(goal?.reserve_months || 3);setSelected(goal?.essential_categories?.length?goal.essential_categories:['food','housing','utilities']);setError('');setFunding(null);};
 return <div className="flex flex-col gap-3">
  <div className="card accent-planning p-4 flex flex-col gap-3"><h2 className="text-sm font-black">Деньги на будущие расходы</h2><p className="text-xs text-slate-500">Свободно: <strong>{fmt(availableBalance)}</strong></p><p className="text-[11px] text-slate-500 leading-relaxed">Подушка защищает необходимые расходы. Фонды помогают заранее подготовиться к страховке, ремонту и другим платежам. Их деньги учитываются в общем резерве целей.</p><div className="grid grid-cols-2 gap-2"><button type="button" className={button} disabled={!enabled} onClick={()=>edit('emergency')}>+ Подушка</button><button type="button" className={button} disabled={!enabled} onClick={()=>edit('expense_fund')}>+ Фонд расходов</button></div>{!accountsReady&&<p className="text-xs text-amber-700">Сначала настройте счета на главной странице.</p>}</div>
  {form&&<form className="card p-4 flex flex-col gap-3" onSubmit={e=>{e.preventDefault();void work(async()=>{
   if(!name.trim()||proposed<=0)throw new Error('Введите название и положительную сумму.');
   if(form==='emergency'&&!selected.length)throw new Error('Выберите необходимые расходы.');
   if(form==='expense_fund'&&(!deadline||deadline<planningDateISO()))throw new Error('Укажите будущую дату платежа.');
   await saveFund({id,name:name.trim(),purpose:form,targetAmount:proposed,deadline:form==='emergency'?null:deadline,essentialAmount:form==='emergency'?parseMoneyInput(essential)??0:undefined,reserveMonths:form==='emergency'?months:undefined,essentialCategories:form==='emergency'?selected:[]});setForm(null);
  },id?'Фонд обновлён.':'Фонд создан. Деньги можно отложить отдельно.');}}>
   <h3 className="text-xs font-bold">{form==='emergency'?'План подушки':'План будущего платежа'}</h3>
   <label className="text-xs text-slate-500">Название<input aria-label="Название фонда" className={`${field} mt-1`} maxLength={80} value={name} disabled={busy} onChange={e=>setName(e.target.value)}/></label>
   {form==='emergency'?<>
    <details className="disclosure"><summary><span>Необходимые категории<span className="block bank-caption mt-1">Выбрано: {selected.length}</span></span><ChevronDown size={15}/></summary><div className="disclosure-body grid grid-cols-2 gap-2">{expense.map(c=><label key={c.id} className="flex gap-2 items-center min-h-[44px] text-[11px] text-slate-600"><input type="checkbox" checked={selected.includes(c.id)} disabled={busy} onChange={()=>setSelected(old=>old.includes(c.id)?old.filter(x=>x!==c.id):[...old,c.id])}/>{c.name}</label>)}</div></details>
    <label className="text-xs text-slate-500">Необходимые расходы в месяц, Br<input aria-label="Необходимые расходы в месяц" className={`${field} mt-1`} inputMode="decimal" value={essential} disabled={busy} onChange={e=>setEssential(e.target.value)}/></label>
    <button type="button" className="text-xs font-bold text-slate-700 py-2" disabled={busy||!suggestion.hasHistory} onClick={()=>{setEssential(String(suggestion.monthly));setNotice(`Среднее по выбранным категориям за ${suggestion.start.slice(0,7)} — ${suggestion.end.slice(0,7)}. Проверьте сумму: история может быть неполной.`);}}>Подсказать по истории за 3 месяца</button>
    <label className="text-xs text-slate-500">Сколько месяцев защитить<select aria-label="Месяцы подушки" className={`${field} mt-1`} value={months} disabled={busy} onChange={e=>setMonths(Number(e.target.value))}>{Array.from({length:12},(_,i)=><option key={i+1} value={i+1}>{i+1}</option>)}</select></label>
   </>:<><label className="text-xs text-slate-500">Сумма будущего платежа, Br<input aria-label="Целевая сумма фонда" className={`${field} mt-1`} inputMode="decimal" value={target} disabled={busy} onChange={e=>setTarget(e.target.value)}/></label><label className="text-xs text-slate-500">К какой дате<input aria-label="Срок фонда" type="date" min={planningDateISO()} className={`${field} mt-1`} value={deadline} disabled={busy} onChange={e=>setDeadline(e.target.value)}/></label></>}
   <p className="text-xs font-bold text-slate-700">Нужно подготовить: {fmt(proposed)}</p>{error&&<p role="alert" className="text-xs text-rose-700">{error}</p>}
   <div className="flex gap-2"><button className={`${button} flex-1`} disabled={busy}>Сохранить фонд</button><button type="button" className="text-xs p-3" disabled={busy} onClick={()=>setForm(null)}>Закрыть</button></div>
  </form>}
  {funds.map(g=>{const coverage=emergencyCoverage(g),needed=goalMonthlyNeeded(g);return <div key={g.id} className="card p-4 flex flex-col gap-3"><h3 className="text-sm font-black">{g.emoji} {g.name}</h3><p className="text-xs text-slate-500">Отложено <strong className="text-slate-900">{fmt(g.current_amount)}</strong> из {fmt(g.target_amount)}</p>
   {coverage!==null?<p className="text-xs font-bold text-slate-700">Защищено {coverage.toLocaleString('ru-RU')} из {g.reserve_months} мес. · база {fmt(g.essential_amount || 0)}/мес.</p>:<p className="text-xs text-slate-500">К {g.deadline} {needed!==null&&`· нужно ${fmt(needed)}/мес.`}</p>}
   <div className="flex flex-wrap gap-2"><button type="button" className={button} disabled={!enabled} onClick={()=>{setFunding({id:g.id,release:false});setAmount('');setError('');setForm(null);}}>Отложить</button><button type="button" className="text-xs p-2 font-bold text-slate-600" disabled={!enabled||g.current_amount<=0} onClick={()=>{setFunding({id:g.id,release:true});setAmount('');setError('');setForm(null);}}>Вернуть</button><button type="button" className="text-xs p-2 text-slate-500" disabled={!enabled} onClick={()=>edit(g.purpose==='emergency'?'emergency':'expense_fund',g)}>Изменить</button><button type="button" className="text-xs p-2 text-slate-500" disabled={!enabled} onClick={()=>{setArchiving(g.id);setError('');}}>В архив</button></div>
   {funding?.id===g.id&&<form className="flex flex-col gap-2" onSubmit={e=>{e.preventDefault();void work(async()=>{const value=parseMoneyInput(amount);if(value===null||value<=0)throw new Error('Укажите положительную сумму.');if(funding.release)await withdrawGoalAmount(g.id,value);else await updateGoalAmount(g.id,value);setFunding(null);},funding.release?'Деньги возвращены в свободный остаток.':'Деньги отложены в фонд.');}}><input aria-label="Взнос в фонд" className={field} inputMode="decimal" value={amount} disabled={busy} onChange={e=>setAmount(e.target.value)}/><button className={button} disabled={busy}>{funding.release?'Подтвердить возврат':'Подтвердить взнос'}</button>{error&&<p role="alert" className="text-xs text-rose-700">{error}</p>}</form>}
   {archiving===g.id&&<div className="text-xs text-slate-500"><p>Остаток {fmt(g.current_amount)} станет свободным. Фонд и история сохранятся в архиве.</p><div className="flex gap-3 mt-2"><button type="button" disabled={busy} onClick={()=>void work(async()=>{await deleteGoal(g.id);setArchiving(null);},'Фонд архивирован.')}>Подтвердить архив</button><button type="button" disabled={busy} onClick={()=>setArchiving(null)}>Назад</button></div>{error&&<p role="alert" className="text-xs text-rose-700">{error}</p>}</div>}
  </div>;})}
  {notice&&<p role="status" className="rounded-xl bg-slate-50 p-3 text-xs text-slate-800">{notice}</p>}
 </div>;
}
