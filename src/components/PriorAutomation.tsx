import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronDown, RefreshCw, Zap } from 'lucide-react';
import { useAuth } from '../AuthContext';
import { supabase } from '../supabaseClient';
import type { PriorAutomationReview, PriorAutomationState } from '../types';
import { priorImportError } from '../lib/priorImport';
import { toMinorUnits } from '../lib/money';

const issues: Record<NonNullable<PriorAutomationState['issue']>,string> = {
  network:'Не удалось завершить обновление. Сохранённые операции доступны; проверим ещё раз позже.', bank_limit:'Банк попросил снизить частоту запросов. Следующая проверка будет позже.',
  reauth:'Банк завершил сессию. Войдите в Приорбанк заново.', history_changed:'Банк изменил уже учтённую историю. Автоматическое добавление приостановлено для сверки.',
  gap:'Долгий перерыв в обновлениях. Сначала сверьте пропущенный период.',account:'Связанный счёт или карта недоступны. Проверьте подключение.',format:'Не удалось проверить данные банка. Автоматическое добавление приостановлено.',
};
interface Props { accountId?: string; sourceKey?: string; linked?: boolean; disabled?: boolean; compact?: boolean; onOpenBank?:()=>void; }
export function PriorAutomation({accountId,sourceKey,linked,disabled,compact,onOpenBank}:Props) {
  const {user,profile}=useAuth();
  const [state,setState]=useState<PriorAutomationState|null>(null),[reviews,setReviews]=useState<PriorAutomationReview[]>([]);
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[confirm,setConfirm]=useState(false);
  const version=useRef(0),loadVersion=useRef(0),pending=useRef(false);
  const demo=import.meta.env.DEV&&new URLSearchParams(window.location.search).get('demo')==='1';
  const load=useCallback(async()=>{
    if(!user?.id||!profile?.household_id||demo)return;
    const current=version.current,request=++loadVersion.current;
    const [a,r]=await Promise.all([
      supabase.from('prior_automation').select('owner_id,household_id,account_id,source_key,enabled,started_on,last_checked_at,issue,imported_count,additional_count').eq('owner_id',user.id).eq('household_id',profile.household_id).maybeSingle(),
      supabase.from('prior_automation_reviews').select('event_key,day,description,amount,reason').eq('owner_id',user.id).eq('household_id',profile.household_id).eq('ignored',false).order('day',{ascending:false}).limit(100),
    ]);
    if(current!==version.current||request!==loadVersion.current)return;
    if(a.error||r.error){setError('Не удалось получить состояние автоматического учёта.');return;}
    setError('');setState(a.data as PriorAutomationState|null);setReviews((r.data??[]) as PriorAutomationReview[]);
  },[user?.id,profile?.household_id,demo]);
  useEffect(()=>{
    ++version.current;pending.current=false;setBusy(false);setState(null);setReviews([]);setConfirm(false);setError('');void load();
    if(demo||!user?.id||!profile?.household_id)return;
    const channel=supabase.channel('prior-auto-'+user.id);
    for(const table of ['prior_automation','prior_automation_reviews'])channel.on('postgres_changes',{event:'*',schema:'public',table,filter:'owner_id=eq.'+user.id},()=>void load());
    channel.subscribe();
    const visible=()=>{if(document.visibilityState==='visible')void load();};
    document.addEventListener('visibilitychange',visible);
    const timer=window.setInterval(visible,60_000);
    return()=>{++version.current;window.clearInterval(timer);document.removeEventListener('visibilitychange',visible);void supabase.removeChannel(channel);};
  },[load,user?.id,profile?.household_id,demo]);
  const change=async(enabled:boolean)=>{
    if(pending.current||disabled||demo)return;
    pending.current=true;++loadVersion.current;setBusy(true);setError('');const current=version.current;
    try {
      const {error}=await supabase.rpc('set_prior_automation',{p_enabled:enabled,p_account_id:accountId??state?.account_id??null,p_source_key:sourceKey??state?.source_key??null});
      if(error)throw new Error(error.message.includes('PRIOR_AUTO_SESSION')?'Сначала войдите в Приорбанк.':priorImportError(error.message));
      if(current===version.current){setConfirm(false);await load();}
    }catch(e){if(current===version.current)setError(e instanceof Error?e.message:'Не удалось изменить режим.');}
    finally{if(current===version.current){pending.current=false;setBusy(false);}}
  };
  const ignore=async(key:string)=>{
    if(pending.current)return;pending.current=true;++loadVersion.current;setBusy(true);const current=version.current;
    try {
      const {error}=await supabase.rpc('ignore_prior_automation_review',{p_event_key:key});
      if(error)throw error;
      if(current===version.current)await load();
    }catch{if(current===version.current)setError('Не удалось скрыть запись.');}
    finally{if(current===version.current){pending.current=false;setBusy(false);}}
  };
  if(demo)return null;
  if(compact){
    if(!state?.enabled)return null;
    return <button type="button" onClick={onOpenBank} className="prior-auto-summary" aria-label="Открыть автоматический учёт Приорбанка"><Zap size={16}/><span className="min-w-0"><strong>Приорбанк · автоматически</strong><span>{state.issue?issues[state.issue]:reviews.length?`Для сверки: ${reviews.length}. Остальные операции добавляются сами.`:state.last_checked_at?`Проверено ${new Date(state.last_checked_at).toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'})}`:'Ожидаем первую фоновую проверку'}</span></span><ChevronDown size={15} className="shrink-0"/></button>;
  }
  return <section className="prior-auto-card space-y-3" aria-label="Автоматический учёт Приорбанка">
    <div className="flex items-center gap-3"><span className="bank-mark"><Zap size={20}/></span><div className="flex-1 min-w-0"><h3 className="text-sm font-semibold">Автоматический учёт</h3><p className="bank-caption mt-1">{state?.enabled?'Новые операции появляются в журнале на главной':'Новые операции будут добавляться сами'}</p></div><button type="button" role="switch" aria-checked={!!state?.enabled} aria-label="Автоматический учёт" className="prior-auto-switch" disabled={busy||disabled||(!state?.enabled&&(!accountId||!sourceKey))} onClick={()=>{if(state?.enabled)void change(false);else setConfirm(true);}}><span/></button></div>
    {error&&<p role="alert" className="bank-notice text-rose-700">{error}</p>}
    {!state?.enabled&&!confirm&&<p className="bank-caption">{!accountId?'Выберите карту и счёт ниже. Затем включите этот режим один раз.':'С сегодняшнего дня, включая уже прошедшие операции за сегодня. Старую историю можно добавить отдельно.'}</p>}
    {confirm&&<div className="space-y-3"><p className="bank-caption">Расходы и поступления за сегодня и дальше будут сохраняться автоматически. Категории можно исправить в журнале. Похожие записи и явные переводы между своими счетами останутся для сверки.</p>{!linked&&<p className="bank-notice text-amber-800">Начальный остаток выбранного счёта должен соответствовать началу сегодняшнего дня. Не указывайте текущий остаток банка: сегодняшние операции будут учтены отдельно.</p>}<button type="button" className="auth-button" disabled={busy||disabled} onClick={()=>void change(true)}>{busy?'Включаем…':'Включить автоматическое добавление'}</button><button type="button" className="text-action" disabled={busy} onClick={()=>setConfirm(false)}>Отмена</button></div>}
    {state?.enabled&&<><p role="status" className="bank-caption">{state.issue?issues[state.issue]:state.last_checked_at?`Последняя успешная проверка: ${new Date(state.last_checked_at).toLocaleString('ru-RU')}`:'Первая проверка начнётся в ближайшие две минуты.'}</p><p className="bank-caption">Проверяем каждые 2 минуты, даже при закрытом приложении. Скорость появления зависит от банка. Добавлено автоматически: {state.imported_count}.</p>{state.additional_count>0&&<p className="bank-caption">Дополнительных записей банка: {state.additional_count}. Их статус пока не подтверждён, в баланс они не включены.</p>}{state.issue&&state.issue!=='reauth'&&<button type="button" className="text-action flex items-center gap-2" disabled={busy||disabled} onClick={()=>void change(true)}><RefreshCw size={14}/>Повторить после проверки подключения</button>}</>}
    {reviews.length>0&&<details className="disclosure"><summary>Для сверки · {reviews.length}{reviews.length===100?'+':''}<ChevronDown size={15}/></summary><div className="disclosure-body space-y-3"><p className="bank-caption">Эти записи не меняют баланс. Покупку можно добавить через обычную проверку операций; свой перевод — через перевод между счетами.</p>{reviews.map(row=>{const cents=toMinorUnits(row.amount);return <article key={row.event_key} className="space-y-2 border-b border-slate-100 pb-3"><p className="text-xs font-semibold break-words">{row.description}</p><p className="bank-caption">{row.day} · {cents<0?'−':'+'}{(Math.abs(cents)/100).toFixed(2)} BYN · {row.reason==='transfer'?'Возможный свой перевод':'Похожа на уже учтённую'}</p><button type="button" className="text-action" disabled={busy} onClick={()=>void ignore(row.event_key)}>Не добавлять эту запись</button></article>;})}</div></details>}
  </section>;
}
