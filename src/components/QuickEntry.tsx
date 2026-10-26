import { useEffect, useRef, useState } from 'react';
import { ArrowRight, Mic, Square, Wand2 } from 'lucide-react';
import { useApp } from '../AppContext';
import { useAuth } from '../AuthContext';
import { parseQuickEntry, type QuickEntryDraft } from '../lib/quickEntry';
import { parseMoneyInput } from '../lib/money';
import { isIncomeCategory } from '../lib/categories';

// The browser handles audio through its own recognition service. FinApp does
// not record, upload or store audio. Safari exposes the prefixed constructor.
interface Recognition {
  lang:string;continuous:boolean;interimResults:boolean;
  onresult:((event:{results:ArrayLike<ArrayLike<{transcript:string}>>})=>void)|null;
  onerror:((event:{error:string})=>void)|null;onend:(()=>void)|null;
  start:()=>void;stop:()=>void;abort:()=>void;
}
type SpeechWindow=Window&{SpeechRecognition?:new()=>Recognition;webkitSpeechRecognition?:new()=>Recognition};
export function QuickEntry({onSaved}:{onSaved:()=>void}) {
  const {accounts,categories,addTransaction,transferBetweenAccounts,financeLoading,accountsReady}=useApp();
  const {profile}=useAuth();
  const [phrase,setPhrase]=useState(''),[draft,setDraft]=useState<QuickEntryDraft|null>(null);
  const [amount,setAmount]=useState(''),[error,setError]=useState(''),[listening,setListening]=useState(false),[saving,setSaving]=useState(false),[editing,setEditing]=useState(false);
  const busy=useRef(false),recognition=useRef<Recognition|null>(null),mounted=useRef(true);
  const timer=useRef<ReturnType<typeof setTimeout>|null>(null);
  const Speech=(window as SpeechWindow).SpeechRecognition||(window as SpeechWindow).webkitSpeechRecognition;
  const active=accounts.filter(a=>!a.is_archived);
  const cancelSpeech=()=>{if(timer.current)clearTimeout(timer.current);timer.current=null;const r=recognition.current;recognition.current=null;if(r){r.onresult=null;r.onerror=null;r.onend=null;try{r.abort();}catch{/* Browser service may already be unavailable. */}}if(mounted.current)setListening(false);};
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;cancelSpeech();};},[]);
  useEffect(()=>{const hide=()=>{if(document.hidden)cancelSpeech();};document.addEventListener('visibilitychange',hide);return()=>document.removeEventListener('visibilitychange',hide);},[]);
  const analyze=(value=phrase)=>{const result=parseQuickEntry(value,accounts,categories);setDraft(result);setAmount(result.amount==null?'':result.amount.toFixed(2));setError('');setEditing(false);};
  const dictate=()=>{
    if(listening){try{recognition.current?.stop();}catch{cancelSpeech();}return;}
    if(!Speech)return;
    let r:Recognition;
    try{r=new Speech();}catch{setError('Голосовой ввод недоступен. Используйте диктовку клавиатуры.');return;}
    r.lang='ru-RU';r.continuous=false;r.interimResults=false;
    r.onresult=e=>{if(!mounted.current||recognition.current!==r)return;const text=Array.from(e.results).map(result=>result[0]?.transcript||'').join(' ').trim();if(text){setPhrase(text);analyze(text);}};
    r.onerror=e=>{if(!mounted.current||recognition.current!==r)return;setError(e.error==='not-allowed'||e.error==='service-not-allowed'?'Микрофон недоступен. Разрешите доступ в браузере или используйте диктовку клавиатуры.':e.error==='no-speech'?'Не услышали фразу. Попробуйте ещё раз или напишите её.':e.error==='aborted'?'':'Не удалось распознать речь. Можно написать фразу или использовать диктовку клавиатуры.');cancelSpeech();};
    r.onend=()=>{if(mounted.current&&recognition.current===r){if(timer.current)clearTimeout(timer.current);timer.current=null;recognition.current=null;setListening(false);}};
    recognition.current=r;setError('');setListening(true);
    try{r.start();timer.current=setTimeout(()=>{cancelSpeech();if(mounted.current)setError('Диктовка остановлена. Можно повторить или написать фразу.');},25000);}catch{cancelSpeech();setError('Голосовой ввод недоступен. Используйте диктовку клавиатуры.');}
  };
  const save=async()=>{
    if(busy.current||!draft||draft.issues.length)return;
    const value=parseMoneyInput(amount),source=active.find(a=>a.id===draft.accountId),target=active.find(a=>a.id===draft.targetAccountId);
    if(!value||value<=0||!source||!draft.date||draft.kind==='transfer'&&(!target||target.id===source.id)||draft.kind==='cashflow'&&!categories.some(c=>c.id===draft.categoryId&&isIncomeCategory(c.id)===(draft.type==='income')))return;
    busy.current=true;setSaving(true);setError('');
    try {
      if(draft.kind==='transfer')await transferBetweenAccounts({fromAccountId:source.id,toAccountId:target!.id,amount:value,date:draft.date,comment:draft.comment});
      else await addTransaction({type:draft.type,amount:value,categoryId:draft.categoryId,accountId:source.id,date:draft.date,comment:draft.comment,addedBy:profile?.id||''});
      if(mounted.current){setDraft(null);setPhrase('');onSaved();}
    }catch(e){if(mounted.current)setError(`${e instanceof Error?e.message:'Не удалось сохранить.'} Проверьте журнал перед повторной попыткой.`);}
    finally{busy.current=false;if(mounted.current)setSaving(false);}
  };
  const valid=draft&&!draft.issues.length&&Number(parseMoneyInput(amount))>0&&!!draft.accountId&&!!draft.date&&(draft.kind==='transfer'?!!draft.targetAccountId&&draft.accountId!==draft.targetAccountId:!!draft.categoryId);
  const patch=(change:Partial<QuickEntryDraft>)=>setDraft(d=>d?{...d,...change}:d);
  const missing=draft&&(!draft.accountId||(draft.kind==='transfer'?!draft.targetAccountId:!draft.categoryId));
  return <section className="card p-4 flex flex-col gap-3 border-blue-100 bg-blue-50/40" aria-label="Операция одной фразой">
    <div className="flex gap-2 items-center"><Wand2 size={17} className="text-blue-700 shrink-0"/><h2 className="text-sm font-bold">Одной фразой</h2></div>
    <div className="flex gap-2 items-start">
      <textarea aria-label="Фраза для новой операции" value={phrase} onChange={e=>{setPhrase(e.target.value);setDraft(null);setError('');}} disabled={saving||listening} maxLength={400} rows={2} placeholder="Кофе 5,50 наличными" className="input-light flex-1 min-w-0 resize-none text-sm"/>
      {Speech&&<button type="button" onClick={dictate} disabled={saving} aria-label={listening?'Остановить диктовку':'Надиктовать операцию'} aria-pressed={listening} className={`icon-button shrink-0 ${listening?'text-rose-700 bg-rose-50':''}`}>{listening?<Square size={18}/>:<Mic size={18}/>}</button>}
    </div>
    <p className="text-[11px] text-slate-500 leading-relaxed">{listening?'Слушаем… Назовите одну операцию.':Speech?'Можно написать или надиктовать. Голос распознаёт сервис браузера.':'Можно написать или надиктовать через микрофон клавиатуры.'}</p>
    {!draft&&<button type="button" disabled={!phrase.trim()||saving||listening||financeLoading||!accountsReady} onClick={()=>analyze()} className="self-start rounded-xl bg-blue-700 px-4 py-2.5 text-xs font-bold text-white disabled:opacity-40 flex items-center gap-2">Разобрать фразу<ArrowRight size={15}/></button>}
    {draft&&<div className="flex flex-col gap-3 border-t border-blue-100 pt-3" aria-label="Проверка операции">
      {draft.issues.map(issue=><p role="alert" key={issue} className="text-xs text-amber-800">{issue}</p>)}
      {!draft.issues.length&&<>
        <p className="text-xs font-bold text-slate-600">Проверьте перед добавлением</p>
        <div className="rounded-2xl bg-white p-3 flex flex-col gap-1.5" aria-label="Итог распознавания">
          <strong className="text-xl tracking-tight">{draft.kind==='transfer'?'↔':draft.type==='income'?'+':'−'} {parseMoneyInput(amount)?.toLocaleString('ru-RU',{minimumFractionDigits:2,maximumFractionDigits:2})||'—'} BYN</strong>
          <span className="text-xs text-slate-600">{draft.kind==='transfer'?'Перевод':categories.find(c=>c.id===draft.categoryId)?.name||'Выберите категорию'} · {active.find(a=>a.id===draft.accountId)?.name||'Выберите счёт'}{draft.kind==='transfer'?` → ${active.find(a=>a.id===draft.targetAccountId)?.name||'куда?'}`:''}</span>
          <span className="text-[11px] text-slate-500">{draft.date.split('-').reverse().join('.')}</span>
        </div>
        <button type="button" disabled={saving} aria-expanded={editing||!!missing} onClick={()=>setEditing(v=>!v)} className="self-start text-xs font-semibold text-blue-800 py-1">{editing?'Свернуть детали':'Изменить детали'}</button>
        <div hidden={!editing&&!missing} className="space-y-3">
        <label className="text-xs text-slate-500">Операция<select aria-label="Вид распознанной операции" value={draft.kind==='transfer'?'transfer':draft.type} disabled={saving} onChange={e=>{const v=e.target.value;patch(v==='transfer'?{kind:'transfer',categoryId:''}:{kind:'cashflow',type:v as 'income'|'expense',categoryId:'',targetAccountId:''});}} className="input-light w-full mt-1"><option value="expense">Расход</option><option value="income">Доход</option><option value="transfer">Перевод между счетами</option></select></label>
        <div className="grid grid-cols-2 gap-2">
          <label className="text-xs text-slate-500 min-w-0">Сумма, BYN<input aria-label="Распознанная сумма" value={amount} disabled={saving} onChange={e=>setAmount(e.target.value)} inputMode="decimal" className="input-light w-full mt-1"/></label>
          <label className="text-xs text-slate-500 min-w-0">Дата<input aria-label="Дата распознанной операции" type="date" value={draft.date} disabled={saving} onChange={e=>patch({date:e.target.value})} className="input-light w-full min-w-0 mt-1"/></label>
        </div>
        <label className="text-xs text-slate-500">{draft.kind==='transfer'?'Откуда':'Счёт'}<select aria-label="Счёт распознанной операции" value={draft.accountId} disabled={saving} onChange={e=>patch({accountId:e.target.value})} className="input-light w-full mt-1"><option value="">Выберите счёт</option>{active.map(a=><option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
        {draft.kind==='transfer'?<label className="text-xs text-slate-500">Куда<select aria-label="Куда перевести по фразе" value={draft.targetAccountId} disabled={saving} onChange={e=>patch({targetAccountId:e.target.value})} className="input-light w-full mt-1"><option value="">Выберите счёт</option>{active.filter(a=>a.id!==draft.accountId).map(a=><option key={a.id} value={a.id}>{a.name}</option>)}</select></label>:<label className="text-xs text-slate-500">Категория<select aria-label="Категория распознанной операции" value={draft.categoryId} disabled={saving} onChange={e=>patch({categoryId:e.target.value})} className="input-light w-full mt-1"><option value="">Выберите категорию</option>{categories.filter(c=>isIncomeCategory(c.id)===(draft.type==='income')).map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>}
        <label className="text-xs text-slate-500">Заметка<input aria-label="Заметка распознанной операции" value={draft.comment} disabled={saving} onChange={e=>patch({comment:e.target.value})} maxLength={400} className="input-light w-full mt-1"/></label>
        </div>
        {draft.kind==='transfer'?<p className="text-[11px] text-slate-500">Это запись уже выполненного перевода. Доходы и расходы не увеличатся.</p>:active.find(a=>a.id===draft.accountId)?.kind==='bank'&&<p className="text-[11px] text-amber-800">Проверьте журнал: операция подключённой карты могла уже прийти из банка.</p>}
        <button type="button" onClick={save} disabled={!valid||saving||financeLoading||listening} className="rounded-xl bg-slate-950 text-white py-3 text-sm font-bold disabled:opacity-40">{saving?'Добавляем…':draft.kind==='transfer'?'Записать перевод':'Добавить операцию'}</button>
      </>}
    </div>}
    {error&&<p role="alert" className="text-xs text-rose-700">{error}</p>}
  </section>;
}
