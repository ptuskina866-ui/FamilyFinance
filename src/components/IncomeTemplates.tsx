import { useRef, useState } from 'react';
import { useApp } from '../AppContext';
import type { IncomeAllocation, IncomeTemplate, IncomeTemplateItem } from '../types';
import { resolveIncomeTemplate } from '../lib/flexiblePlanning';
import { parseMoneyInput } from '../lib/money';

const field='input-light w-full min-w-0';
const button='rounded-xl bg-slate-950 p-3 text-xs font-bold text-white disabled:opacity-40';
type Draft={target:string;mode:IncomeTemplateItem['mode'];value:string};
export function IncomeTemplates({income,available,onApply}:{income:number | null;available:number;onApply:(items:IncomeAllocation[],shortfall:number)=>void}) {
 const {incomeTemplates,savingsGoals,categories,flexiblePlanningReady,accountsReady,saveIncomeTemplate,archiveIncomeTemplate}=useApp();
 const [editing,setEditing]=useState(false),[id,setId]=useState<string | null>(null),[name,setName]=useState('Зарплата');
 const [rows,setRows]=useState<Draft[]>([{target:'budget:food',mode:'fixed',value:''}]);
 const [error,setError]=useState(''),[busy,setBusy]=useState(false),[archiving,setArchiving]=useState<string | null>(null);
 const pending=useRef(false);
 const goals=savingsGoals.filter(g=>!g.is_archived);
 const expense=categories.filter(c=>c.id!=='salary'&&c.id!=='savings'&&!c.id.startsWith('income-'));
 const items=():IncomeTemplateItem[]=>rows.map(r=>({targetType:r.target.startsWith('goal:')?'goal':'budget',targetId:r.target.slice(r.target.indexOf(':')+1),mode:r.mode,value:parseMoneyInput(r.value) ?? 0}));
 const perform=async(work:()=>Promise<void>)=>{if(pending.current)return;pending.current=true;setBusy(true);setError('');try{await work();}catch(e){setError(e instanceof Error?e.message:'Не удалось сохранить шаблон.');}finally{pending.current=false;setBusy(false);}};
 const edit=(template?:IncomeTemplate)=>{setId(template?.id || null);setName(template?.name || 'Зарплата');setRows(template?.items.map(i=>({target:`${i.targetType}:${i.targetId}`,mode:i.mode,value:String(i.value)})) || [{target:'budget:food',mode:'fixed',value:''}]);setError('');setEditing(true);};
 const move=(index:number,delta:number)=>setRows(old=>{const next=[...old];[next[index],next[index+delta]]=[next[index+delta],next[index]];return next;});
 return <div className="card p-4 flex flex-col gap-3">
  <h2 className="text-sm font-black text-slate-900">Шаблоны зарплаты</h2>
  <p className="text-[11px] text-slate-500 leading-relaxed">Сначала финансируются верхние строки. Проценты считаются от полученного дохода; суммы ограничены свободными деньгами. Шаблон готовит план, который вы подтверждаете ниже.</p>
  {incomeTemplates.map(t=><div key={t.id} className="rounded-xl bg-slate-50 p-3 flex flex-col gap-2">
   <strong className="text-xs">{t.name}</strong><p className="text-[11px] text-slate-500">Назначений: {t.items.length}</p>
   <div className="flex flex-wrap gap-2"><button type="button" className={button} disabled={busy || income === null} onClick={()=>{setError('');try{
    if(t.items.some(i=>i.targetType==='goal'&&!goals.some(g=>g.id===i.targetId)))throw new Error('В шаблоне есть архивная цель. Измените её перед применением.');
    const result=resolveIncomeTemplate(t.items,income ?? 0,available);if(!result.allocations.length)throw new Error('По этому шаблону сейчас нет сумм для распределения.');onApply(result.allocations,result.shortfalls.length);
   }catch(e){setError(e instanceof Error?e.message:'Проверьте шаблон.');}}}>Использовать</button><button type="button" className="p-2 text-xs font-bold text-slate-600" disabled={busy} onClick={()=>edit(t)}>Изменить</button><button type="button" className="p-2 text-xs text-slate-500" disabled={busy} onClick={()=>setArchiving(t.id)}>В архив</button></div>
   {archiving===t.id&&<div className="text-xs text-slate-600"><p>Убрать этот шаблон из списка? Распределения сохранятся.</p><div className="flex gap-3 mt-2"><button type="button" disabled={busy} onClick={()=>void perform(async()=>{await archiveIncomeTemplate(t.id);setArchiving(null);})}>Подтвердить</button><button type="button" disabled={busy} onClick={()=>setArchiving(null)}>Назад</button></div></div>}
  </div>)}
  <button type="button" className="py-2 text-xs font-bold text-slate-700" disabled={!flexiblePlanningReady || !accountsReady || busy} onClick={()=>edit()}>+ Создать шаблон</button>
  {editing&&<form className="flex flex-col gap-3 border-t border-slate-100 pt-3" onSubmit={e=>{e.preventDefault();void perform(async()=>{const plan=items();resolveIncomeTemplate(plan,1,1);if(!name.trim())throw new Error('Введите название шаблона.');await saveIncomeTemplate(id,name.trim(),plan);setEditing(false);});}}>
   <label className="text-xs text-slate-500">Название<input aria-label="Название шаблона" className={`${field} mt-1`} value={name} disabled={busy} maxLength={80} onChange={e=>setName(e.target.value)}/></label>
   {rows.map((r,index)=><div key={index} className="rounded-xl bg-slate-50 p-3 flex flex-col gap-2">
    <div className="flex justify-between gap-2 text-[11px]"><strong>Приоритет {index+1}</strong><div className="flex gap-3"><button type="button" aria-label={`Поднять приоритет ${index+1}`} disabled={busy || index===0} onClick={()=>move(index,-1)}>↑</button><button type="button" aria-label={`Опустить приоритет ${index+1}`} disabled={busy || index===rows.length-1} onClick={()=>move(index,1)}>↓</button>{rows.length>1&&<button type="button" aria-label={`Удалить правило ${index+1}`} disabled={busy} onClick={()=>setRows(old=>old.filter((_,i)=>i!==index))}>×</button>}</div></div>
    <select aria-label={`Назначение шаблона ${index+1}`} className={field} value={r.target} disabled={busy} onChange={e=>setRows(old=>old.map((x,i)=>i===index?{...x,target:e.target.value}:x))}><optgroup label="Расходы">{expense.map(c=><option key={c.id} value={`budget:${c.id}`}>{c.name}</option>)}</optgroup><optgroup label="Цели и фонды">{goals.map(g=><option key={g.id} value={`goal:${g.id}`}>{g.emoji} {g.name}</option>)}</optgroup></select>
    <span className="text-[11px] text-slate-500">Сумма или процент дохода</span><div className="grid grid-cols-2 gap-2"><select aria-label={`Вид суммы шаблона ${index+1}`} className={field} value={r.mode} disabled={busy} onChange={e=>setRows(old=>old.map((x,i)=>i===index?{...x,mode:e.target.value as Draft['mode']}:x))}><option value="fixed">BYN</option><option value="percent">%</option></select><input aria-label={`Сумма шаблона ${index+1}`} className={field} inputMode="decimal" value={r.value} disabled={busy} placeholder={r.mode==='fixed'?'200':'10'} onChange={e=>setRows(old=>old.map((x,i)=>i===index?{...x,value:e.target.value}:x))}/></div>
   </div>)}
   <button type="button" disabled={busy || rows.length>=32} className="text-xs font-bold text-slate-700 py-2" onClick={()=>setRows(old=>[...old,{target:'budget:utilities',mode:'fixed',value:''}])}>+ Правило</button>
   <div className="flex gap-2"><button className={`${button} flex-1`} disabled={busy}>Сохранить шаблон</button><button type="button" className="text-xs p-3" disabled={busy} onClick={()=>setEditing(false)}>Закрыть</button></div>
  </form>}
  {error&&<p role="alert" className="text-xs text-rose-700 break-words">{error}</p>}
 </div>;
}
