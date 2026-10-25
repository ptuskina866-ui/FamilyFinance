import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { useAuth } from '../AuthContext';
import { supabase } from '../supabaseClient';
import type { PriorBankEvent } from '../types';
import { fromMinorUnits,toMinorUnits } from '../lib/money';

export function PriorLiveReviews(){
 const {user,profile}=useAuth();const [rows,setRows]=useState<PriorBankEvent[]>([]),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const version=useRef(0),requestVersion=useRef(0),pending=useRef(false);
 const load=useCallback(async()=>{
  if(!user?.id||!profile?.household_id)return;
  const current=version.current,request=++requestVersion.current;
  const r=await supabase.from('prior_bank_events').select('id,transaction_id,state,bank_amount,applied_amount,original_amount,original_currency,description,day,reason,suppressed,observed_state,history')
   .eq('owner_id',user.id).eq('household_id',profile.household_id).eq('state','needs_review').eq('suppressed',false).order('day',{ascending:false}).limit(100);
  if(current!==version.current||request!==requestVersion.current)return;
  if(r.error)setError('Не удалось получить записи для сверки.');else{setRows((r.data??[]) as PriorBankEvent[]);setError('');}
 },[user?.id,profile?.household_id]);
 useEffect(()=>{
  ++version.current;setRows([]);setBusy(false);pending.current=false;setError('');void load();
  if(!user?.id||!profile?.household_id)return;
  const channel=supabase.channel('prior-review-'+user.id).on('postgres_changes',{event:'*',schema:'public',table:'prior_bank_events',filter:'owner_id=eq.'+user.id},()=>void load()).subscribe();
  return()=>{++version.current;void supabase.removeChannel(channel);};
 },[load,user?.id,profile?.household_id]);
 const resolve=async(row:PriorBankEvent,action:'ignore'|'apply')=>{
  if(pending.current)return;pending.current=true;setBusy(true);const current=version.current;
  try{
   const r=await supabase.rpc('resolve_prior_event',{p_event:row.id,p_action:action,p_amount:row.bank_amount,p_state:row.observed_state});
   if(r.error)throw r.error;
   if(current===version.current)await load();
  }catch{if(current===version.current)setError('Запись могла обновиться. Проверьте актуальные данные и повторите действие.');}
  finally{if(current===version.current){pending.current=false;setBusy(false);}}
 };
 if(!rows.length&&!error)return null;
 return <details className="disclosure"><summary>Нужна сверка · {rows.length}{rows.length===100?'+':''}<ChevronDown size={15}/></summary><div className="disclosure-body space-y-4">
  <p className="bank-caption">Остальные операции учитываются сами. Здесь — неоднозначные совпадения и ручные изменения.</p>
  {error&&<p role="alert" className="bank-caption text-rose-700">{error}</p>}
  {rows.map(row=><article key={row.id} className="space-y-2 border-b border-slate-100 pb-3"><p className="text-xs font-semibold break-words">{row.description}</p>
   <p className="bank-caption">{row.day} · {fromMinorUnits(toMinorUnits(row.bank_amount)).toLocaleString('ru-RU',{minimumFractionDigits:2})} BYN</p>
   <p className="bank-caption">{row.transaction_id?'В журнале сохранена прежняя сумма.':row.reason==='transfer'?'Возможный перевод между своими счетами.':row.reason==='format'?'Недостаточно проверенных данных для добавления.':'Похожа на уже учтённую операцию. Повтор автоматически не создан.'}</p>
   {row.reason!=='format'&&row.reason!=='transfer'&&<details><summary className="text-action cursor-pointer">{row.transaction_id?'Применить сумму банка':'Добавить как отдельную операцию'}</summary><div className="mt-2 space-y-2"><p className="bank-caption">Проверьте журнал. Это действие изменит баланс и не объединяет запись с ручной операцией.</p><button type="button" className="auth-button" disabled={busy} onClick={()=>void resolve(row,'apply')}>Подтвердить изменение баланса</button></div></details>}
   <button type="button" className="text-action" disabled={busy} onClick={()=>void resolve(row,'ignore')}>{row.transaction_id?'Оставить мою запись':'Уже учтено · не добавлять'}</button>
  </article>)}
 </div></details>;
}
