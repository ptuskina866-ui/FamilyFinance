import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Landmark, LockKeyhole, RefreshCw, ShieldCheck, X } from 'lucide-react';
import type { PriorBankConnectionStatus, PriorConnectionResult, PriorImportSnapshot } from '../types';
import { planningDateISO } from '../lib/planning';
import { connectPriorBank, syncPriorBank, viewPriorBank, priorBankStatus, PriorBankError } from '../services/priorBankService';

interface Props { disabled: boolean; pausePreview?:boolean;onLiveMode?:(enabled:boolean)=>void; onStart: () => void; onBusy: (busy: boolean) => void; onConnected: (snapshot: PriorImportSnapshot, accountId?: string) => void; }
export function PriorBankConnection({disabled,pausePreview,onLiveMode, onStart, onBusy, onConnected}: Props) {
  const [open, setOpen] = useState(false), [loading, setLoading] = useState(false), [consent, setConsent] = useState(false);
  const [error, setError] = useState(''), [message, setMessage] = useState('Проверяем подключение…');
  const [notice,setNotice]=useState('');
  const [live,setLive]=useState<PriorConnectionResult['live']>(),[rememberLogin,setRememberLogin]=useState(false);
  const [connection, setConnection] = useState<PriorBankConnectionStatus | null>(null), [disconnecting, setDisconnecting] = useState(false);
  const [cards, setCards] = useState<PriorImportSnapshot[]>([]), [cardIndex, setCardIndex] = useState('');
  const login = useRef<HTMLInputElement>(null), password = useRef<HTMLInputElement>(null);
  const cardPicker = useRef<HTMLDetailsElement>(null);
  const controller = useRef<AbortController | null>(null), version = useRef(0);
  const acceptedStamp=useRef('');
  // Parent updates must not restart the opening request.
  const callbacks = useRef({onStart, onBusy, onConnected,onLiveMode,disabled,pausePreview}); callbacks.current = {onStart, onBusy, onConnected,onLiveMode,disabled,pausePreview};
  const today = planningDateISO(), end = new Date(today + 'T00:00:00Z'); end.setUTCDate(end.getUTCDate() - 1);
  const defaultTo = end.toISOString().slice(0,10); end.setUTCDate(end.getUTCDate() - 9);
  const [from, setFrom] = useState(end.toISOString().slice(0,10)), [to, setTo] = useState(defaultTo), [custom, setCustom] = useState(false);
  const accept = (value: PriorConnectionResult) => {
    const state = value.connection ?? null; setConnection(state);setLive(value.live); setCards(value.cards); setOpen(false); setConsent(false);setRememberLogin(false);
    callbacks.current.onLiveMode?.(value.live?.enabled===true);
    const preferred = value.cards.findIndex(card => card.card.sourceKey === state?.selectedSourceKey);
    const index = preferred >= 0 ? preferred : value.cards.length === 1 ? 0 : -1;
    setCardIndex(index < 0 ? '' : String(index));
    setMessage(value.cards.length ? 'История получена. Выберите операции для добавления.' : 'Банк не вернул доступных карт.');
    setNotice(value.syncState==='updating'?(value.live?.enabled?'Проверка запрошена. Свежие операции появятся в журнале после обновления.':'Банк уже обновляется. Показываем последнюю сохранённую историю.'):value.syncState==='saved'?'Показываем сохранённую историю. Проверка банка выполняется отдельно; повторный вход не нужен.':'');
    if(index>=0){
      const card=value.cards[index],stamp=JSON.stringify([card.card.sourceKey,card.fetchedAt,card.from,card.to,state?.accountId]);
      if(stamp!==acceptedStamp.current){acceptedStamp.current=stamp;callbacks.current.onConnected(card,preferred>=0?state?.accountId??undefined:undefined);}
    }
  };
  const run = async (action: 'open' | 'peek' | 'connect' | 'sync' | 'select' | 'disconnect') => {
    if (controller.current || callbacks.current.disabled) return;
    const quiet=action==='peek';
    if(quiet&&(callbacks.current.pausePreview||cardPicker.current?.open))return;
    const request = new AbortController(), current = ++version.current; controller.current = request;
    if(!quiet){setLoading(true); setError('');setNotice(''); callbacks.current.onBusy(true);}
    if (['open','connect','disconnect'].includes(action)) {acceptedStamp.current='';callbacks.current.onStart(); setCards([]);}
    const input = action === 'connect' ? {login: login.current?.value ?? '',password: password.current?.value ?? '',from,to,autoReconnect:rememberLogin} : null;
    if (password.current) password.current.value = '';
    try {
      if (action === 'disconnect') {
        const state = await priorBankStatus('disconnect',request.signal);
        if (version.current !== current) return;
        setConnection(state);setLive(undefined);callbacks.current.onLiveMode?.(false); setDisconnecting(false); setMessage('Подключение удалено. Для получения новых данных потребуется вход.');
      } else if (action === 'select') {
        const card = cards[Number(cardIndex)]; if (!card) return;
        const state = await priorBankStatus('select',request.signal,card.card.sourceKey);
        if (version.current !== current) return;
        setConnection(state);acceptedStamp.current=JSON.stringify([card.card.sourceKey,card.fetchedAt,card.from,card.to,state.accountId]); cardPicker.current?.removeAttribute('open'); callbacks.current.onStart(); callbacks.current.onConnected(card,state.accountId ?? undefined);
      } else {
        if (action === 'open'||action==='peek') {
          const value=await viewPriorBank(request.signal),state=value.connection;
          if (version.current !== current) return;
          if(quiet&&(callbacks.current.disabled||callbacks.current.pausePreview||cardPicker.current?.open))return;
          setConnection(state??null);setLive(value.live);callbacks.current.onLiveMode?.(value.live?.enabled===true);
          if (!state?.connected&&!value.live?.autoReconnect) {
            if(quiet){acceptedStamp.current='';setCards([]);callbacks.current.onStart();}
            setNotice('');setMessage(state?.reauthRequired ? 'Банк завершил сессию. Войдите заново.' : 'Подключите банк один раз, затем история будет открываться автоматически.');return;
          }
          if(quiet){
            const index=value.cards.findIndex(card=>card.card.sourceKey===state?.selectedSourceKey),card=value.cards[index>=0?index:0];
            if(card&&JSON.stringify([card.card.sourceKey,card.fetchedAt,card.from,card.to,state?.accountId])===acceptedStamp.current)return;
          }
          accept(value);return;
        }
        setMessage('Получаем историю банка…');
        const value = input ? await connectPriorBank(input,request.signal) : await syncPriorBank(request.signal, action === 'sync' && custom ? {from,to} : undefined);
        if (version.current === current) accept(value);
      }
    } catch (e) {
      if (version.current === current) {
        if(quiet)return;
        setMessage('');
        if(e instanceof PriorBankError&&e.code==='COOLDOWN'){setNotice('Банк уже обновляется. История и выбранные операции сохранены.');setError('');}
        else setError(e instanceof Error ? e.message : 'Подключение не завершено.');
        if (e instanceof PriorBankError && e.code === 'SESSION_EXPIRED') {acceptedStamp.current='';callbacks.current.onStart();setCards([]);setConnection(null); setOpen(true);}
      }
    } finally {
      if (input) {input.password = ''; input.login = '';}
      if (version.current === current) {controller.current = null;if(!quiet){setLoading(false);callbacks.current.onBusy(false);}}
    }
  };
  useEffect(() => {
    void run('open');
    return () => {++version.current; controller.current?.abort(); controller.current = null; if (password.current) password.current.value = '';};
  }, []);
  useEffect(()=>{
    if(!connection?.connected||custom||open)return;
    const timer=window.setInterval(()=>{if(document.visibilityState==='visible')void run('peek');},30_000);
    return()=>window.clearInterval(timer);
  },[connection?.connected,custom,open]);
  useEffect(() => {
    // An unknown card needs a choice; selecting an option must leave its confirm action visible.
    if (cards.length > 1 && cardIndex === '') cardPicker.current?.setAttribute('open', '');
  }, [cards, cardIndex]);
  useEffect(() => { if (open) login.current?.focus({preventScroll:true}); }, [open]);
  const cancelLogin = () => { if (password.current) password.current.value=''; setOpen(false); setConsent(false);setRememberLogin(false); };
  const control = 'mt-2 input-light w-full min-w-0';
  const disabledControls = disabled || loading;
  const connected=!!connection?.connected||!!live?.autoReconnect;
  const cardSelection = cards.length > 1 && <details ref={cardPicker} className="disclosure"><summary>Выбор карты<ChevronDown size={15}/></summary><div className="disclosure-body space-y-3"><label className="block text-xs font-semibold">Карта для проверки<select aria-label="Карта Приорбанка" value={cardIndex} disabled={disabledControls} className={control} onChange={e => setCardIndex(e.target.value)}><option value="">Выберите карту</option>{cards.map((card, index) => <option key={index} value={index}>{card.card.title} · {card.card.maskedNumber} · {card.card.currency}</option>)}</select></label><button type="button" disabled={!cardIndex || disabledControls} onClick={() => void run('select')} className="auth-button">Запомнить карту и показать операции</button></div></details>;
  return <div className={`bank-connection space-y-4 ${!open && !connected?'bank-connection--intro':''}`} aria-busy={loading}>
    {!open && !connected && <div className="bank-hero"><span className="bank-mark"><Landmark size={29} strokeWidth={1.4}/></span><h2>Меньше ввода.<br/>Больше ясности.</h2><p className="bank-copy">Свежие операции — в вашем журнале.<br/>Без подтверждения каждой оплаты.</p></div>}
    <div className={`flex items-center gap-3 ${!open && !connected?'bank-choice':''}`}>
      <span className="bank-mark"><Landmark size={23} strokeWidth={1.6}/></span>
      <div className="flex-1 min-w-0"><h2 className="section-title">Приорбанк</h2><p className="text-xs text-slate-500 mt-1">{connected ? (custom?'Подключён · выбранный период':'Подключён') : 'Вход через Prior Online'}</p></div>
      {connected && <button type="button" className="icon-button" aria-label="Обновить операции" disabled={disabledControls} onClick={()=>void run('sync')}><RefreshCw size={18} className={loading?'animate-spin':''}/></button>}
      {open && !connection?.connected && <button type="button" disabled={loading} onClick={cancelLogin} className="icon-button" aria-label="Закрыть вход в банк"><X size={18}/></button>}
    </div>
    {!connected && !open && <>
      <button type="button" disabled={disabledControls} onClick={() => {setOpen(true); setError('');}} className="auth-button">Подключить Приорбанк</button>
      <p className="bank-caption flex items-center justify-center gap-1.5"><LockKeyhole size={12}/>Сохранение данных — только с разрешения</p>
    </>}
    {error && <p role="alert" className="bank-notice text-rose-700">{error}</p>}
    {notice&&<p role="status" className="bank-caption">{notice}</p>}
    {open && <form onSubmit={event => {event.preventDefault(); if (consent) void run('connect');}} className="space-y-4" autoComplete="off">
      <p className="bank-login-intro">Подключите один раз.<br/><span className="text-slate-500">Дальше — автоматическое обновление.</span></p>
      <label className="block text-xs font-semibold">Логин Prior Online<input ref={login} name="prior-login" autoComplete="off" autoCapitalize="none" spellCheck={false} maxLength={128} required disabled={disabledControls} className={control}/></label>
      <label className="block text-xs font-semibold">Пароль интернет-банка<input ref={password} name="prior-password" type="password" autoComplete="off" required disabled={disabledControls} className={control}/><span className="block bank-caption mt-2">Пароль от Prior Online, не ПИН приложения.</span></label>
      <div className="bank-security"><ShieldCheck size={17} className="shrink-0"/><p>Вход выполняется через сервер FinApp. Сессия хранится зашифрованной. Пароль сохраняется только для выбранного ниже автоподключения.</p></div>
      <label className="flex items-start gap-3 text-xs leading-relaxed py-1"><input type="checkbox" checked={consent} disabled={disabledControls} className="w-5 h-5 shrink-0 mt-0.5" onChange={e => setConsent(e.target.checked)}/>Разрешаю вход и сохранение защищённой банковской сессии.</label>
      <label className="flex items-start gap-3 text-xs leading-relaxed py-1"><input type="checkbox" checked={rememberLogin} disabled={disabledControls} className="w-5 h-5 shrink-0 mt-0.5" onChange={e=>setRememberLogin(e.target.checked)}/>Автоматически восстанавливать подключение. Разрешаю хранить логин и пароль зашифрованными на сервере FinApp. Отключение банка удалит их.</label>
      <button type="submit" disabled={disabledControls || !consent} className="auth-button">Подключить и получить операции</button>
      <button type="button" disabled={loading} className="text-action w-full" onClick={cancelLogin}>Отмена</button>
    </form>}
    {connected&&!open&&<p className="bank-caption">{live?.autoReconnect?'Автоподключение включено. Обычное завершение сессии не требует повторного ввода.':<>Для обновления без повторного ввода <button type="button" className="text-action" onClick={()=>{setOpen(true);setRememberLogin(true);}}>включите автоподключение</button>.</>}</p>}
    {(open || connected) && <details className="disclosure bank-settings">
      <summary>{connection?.connected ? 'Настройки подключения' : 'Период и помощь'}<ChevronDown size={15}/></summary>
      <div className="disclosure-body space-y-3">
        {connection?.lastSyncedAt && <p className="bank-caption">Обновлено {new Date(connection.lastSyncedAt).toLocaleString('ru-RU')}</p>}
        {connection?.selectedSourceKey && cardSelection}
        <details onToggle={e => setCustom(e.currentTarget.open)}>
          <summary className="text-action cursor-pointer">Другой период</summary>
          <div className="grid gap-3"><label className="text-xs min-w-0">С даты<input type="date" value={from} max={to} disabled={disabledControls} className={control} onChange={e => setFrom(e.target.value)}/></label><label className="text-xs min-w-0">По дату<input type="date" value={to} min={from} max={defaultTo} disabled={disabledControls} className={control} onChange={e => setTo(e.target.value)}/></label></div>
        </details>
        <p className="bank-caption">По умолчанию — 10 завершённых дней, без сегодняшних операций. Можно выбрать до 31 дня за одну загрузку. {connection?.connected && 'После выбора нажмите «Обновить операции».'}</p>
        <p className="bank-caption">{live?.autoReconnect?'Сессию восстанавливаем автоматически. Код банка, изменённый пароль или блокировка могут потребовать вашего участия.':'Без автоподключения после завершения сессии потребуется вход.'} Пароли длиннее 16 символов и дополнительное банковское подтверждение пока не поддерживаются.</p>
        {connection?.connected && <><button type="button" disabled={disabledControls} onClick={() => setDisconnecting(value => !value)} className="text-action text-rose-700">Отключить банк</button>{disconnecting && <div className="bank-notice space-y-3"><p>Удалить сохранённую банковскую сессию? Операции в журнале останутся.</p><button type="button" className="auth-button" disabled={disabledControls} onClick={() => void run('disconnect')}>Удалить подключение</button></div>}</>}
      </div>
    </details>}
    {loading && <p role="status" className="bank-caption">{message || 'Обновляем подключение…'}</p>}
    {loading && <button type="button" onClick={() => {++version.current; controller.current?.abort(); controller.current = null; setLoading(false); callbacks.current.onBusy(false); setNotice('Ожидание отменено.');setMessage('');}} className="text-action w-full">Отменить ожидание</button>}
    {!loading && message && !cards.length && (connection?.connected || error || message.startsWith('Подключение удалено') || message.startsWith('Ожидание отменено') || connection?.reauthRequired) && <p role="status" className="bank-caption">{message}</p>}
    {!connection?.selectedSourceKey && cardSelection}
  </div>;
}
