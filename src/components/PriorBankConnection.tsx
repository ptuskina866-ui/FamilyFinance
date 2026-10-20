import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Landmark, RefreshCw, ShieldCheck } from 'lucide-react';
import type { PriorBankConnectionStatus, PriorConnectionResult, PriorImportSnapshot } from '../types';
import { planningDateISO } from '../lib/planning';
import { connectPriorBank, syncPriorBank, priorBankStatus, PriorBankError } from '../services/priorBankService';

interface Props { disabled: boolean; onStart: () => void; onBusy: (busy: boolean) => void; onConnected: (snapshot: PriorImportSnapshot, accountId?: string) => void; }
export function PriorBankConnection({disabled, onStart, onBusy, onConnected}: Props) {
  const [open, setOpen] = useState(false), [loading, setLoading] = useState(false), [consent, setConsent] = useState(false);
  const [error, setError] = useState(''), [message, setMessage] = useState('Проверяем подключение…');
  const [connection, setConnection] = useState<PriorBankConnectionStatus | null>(null), [disconnecting, setDisconnecting] = useState(false);
  const [cards, setCards] = useState<PriorImportSnapshot[]>([]), [cardIndex, setCardIndex] = useState('');
  const login = useRef<HTMLInputElement>(null), password = useRef<HTMLInputElement>(null);
  const cardPicker = useRef<HTMLDetailsElement>(null);
  const controller = useRef<AbortController | null>(null), version = useRef(0);
  // Parent updates must not restart the opening request.
  const callbacks = useRef({onStart, onBusy, onConnected}); callbacks.current = {onStart, onBusy, onConnected};
  const today = planningDateISO(), end = new Date(today + 'T00:00:00Z'); end.setUTCDate(end.getUTCDate() - 1);
  const defaultTo = end.toISOString().slice(0,10); end.setUTCDate(end.getUTCDate() - 9);
  const [from, setFrom] = useState(end.toISOString().slice(0,10)), [to, setTo] = useState(defaultTo), [custom, setCustom] = useState(false);
  const accept = (value: PriorConnectionResult) => {
    const state = value.connection ?? null; setConnection(state); setCards(value.cards); setOpen(false); setConsent(false);
    const preferred = value.cards.findIndex(card => card.card.sourceKey === state?.selectedSourceKey);
    const index = preferred >= 0 ? preferred : value.cards.length === 1 ? 0 : -1;
    setCardIndex(index < 0 ? '' : String(index));
    setMessage(value.cards.length ? 'История получена. Выберите операции для добавления.' : 'Банк не вернул доступных карт.');
    if (index >= 0) callbacks.current.onConnected(value.cards[index], preferred >= 0 ? state?.accountId ?? undefined : undefined);
  };
  const run = async (action: 'open' | 'connect' | 'sync' | 'select' | 'disconnect') => {
    if (controller.current || disabled) return;
    const request = new AbortController(), current = ++version.current; controller.current = request;
    setLoading(true); setError(''); callbacks.current.onBusy(true);
    if (action !== 'select') {callbacks.current.onStart(); setCards([]);}
    const input = action === 'connect' ? {login: login.current?.value ?? '',password: password.current?.value ?? '',from,to} : null;
    if (password.current) password.current.value = '';
    try {
      if (action === 'disconnect') {
        const state = await priorBankStatus('disconnect',request.signal);
        if (version.current !== current) return;
        setConnection(state); setDisconnecting(false); setMessage('Подключение удалено. Для получения новых данных потребуется вход.');
      } else if (action === 'select') {
        const card = cards[Number(cardIndex)]; if (!card) return;
        const state = await priorBankStatus('select',request.signal,card.card.sourceKey);
        if (version.current !== current) return;
        setConnection(state); cardPicker.current?.removeAttribute('open'); callbacks.current.onStart(); callbacks.current.onConnected(card,state.accountId ?? undefined);
      } else {
        if (action === 'open') {
          const state = await priorBankStatus('status',request.signal);
          if (version.current !== current) return;
          setConnection(state);
          if (!state.connected) {setMessage(state.reauthRequired ? 'Банк завершил сессию. Войдите заново.' : 'Подключите банк один раз, затем история будет открываться автоматически.'); return;}
        }
        setMessage('Получаем историю банка…');
        const value = input ? await connectPriorBank(input,request.signal) : await syncPriorBank(request.signal, action === 'sync' && custom ? {from,to} : undefined);
        if (version.current === current) accept(value);
      }
    } catch (e) {
      if (version.current === current) {
        setMessage(''); setError(e instanceof Error ? e.message : 'Подключение не завершено.');
        if (e instanceof PriorBankError && e.code === 'SESSION_EXPIRED') {setConnection(null); setOpen(true);}
      }
    } finally {
      if (input) {input.password = ''; input.login = '';}
      if (version.current === current) {controller.current = null; setLoading(false); callbacks.current.onBusy(false);}
    }
  };
  useEffect(() => {
    void run('open');
    return () => {++version.current; controller.current?.abort(); controller.current = null; if (password.current) password.current.value = '';};
  }, []);
  useEffect(() => {
    // An unknown card needs a choice; selecting an option must leave its confirm action visible.
    if (cards.length > 1 && cardIndex === '') cardPicker.current?.setAttribute('open', '');
  }, [cards, cardIndex]);
  const control = 'mt-2 input-light w-full min-w-0';
  const disabledControls = disabled || loading;
  const cardSelection = cards.length > 1 && <details ref={cardPicker} className="disclosure"><summary>Выбор карты<ChevronDown size={15}/></summary><div className="disclosure-body space-y-3"><label className="block text-xs font-semibold">Карта для проверки<select aria-label="Карта Приорбанка" value={cardIndex} disabled={disabledControls} className={control} onChange={e => setCardIndex(e.target.value)}><option value="">Выберите карту</option>{cards.map((card, index) => <option key={index} value={index}>{card.card.title} · {card.card.maskedNumber} · {card.card.currency}</option>)}</select></label><button type="button" disabled={!cardIndex || disabledControls} onClick={() => void run('select')} className="auth-button">Запомнить карту и показать операции</button></div></details>;
  return <div className="space-y-3" aria-busy={loading}>
    <div className="flex items-center gap-3">
      <span className="bank-mark"><Landmark size={23} strokeWidth={1.6}/></span>
      <div className="flex-1 min-w-0"><h2 className="section-title">Приорбанк</h2><p className="text-xs text-slate-500 mt-1">{connection?.connected ? (custom?'Подключён · выбранный период':'Подключён · 10 дней') : open ? 'Вход в Prior Online' : 'Операции без ручного ввода'}</p></div>
      {connection?.connected && <button type="button" className="icon-button" aria-label="Обновить операции" disabled={disabledControls} onClick={()=>void run('sync')}><RefreshCw size={18} className={loading?'animate-spin':''}/></button>}
    </div>
    {!connection?.connected && !open && <>
      <p className="bank-copy">Войдите один раз. При следующем открытии FinApp получит операции, пока действует сессия банка.</p>
      <button type="button" disabled={disabledControls} onClick={() => {setOpen(true); setError('');}} className="auth-button">Подключить Приорбанк</button>
      <p className="bank-caption">Вы сами выбираете, что добавить в журнал.</p>
    </>}
    {error && <p role="alert" className="bank-notice text-rose-700">{error}</p>}
    {open && <form onSubmit={event => {event.preventDefault(); if (consent) void run('connect');}} className="space-y-4" autoComplete="off">
      <label className="block text-xs font-semibold">Логин Prior Online<input ref={login} name="prior-login" autoComplete="off" autoCapitalize="none" spellCheck={false} maxLength={128} required disabled={disabledControls} className={control}/></label>
      <label className="block text-xs font-semibold">Пароль интернет-банка<input ref={password} name="prior-password" type="password" autoComplete="off" required disabled={disabledControls} className={control}/><span className="block bank-caption mt-2">Пароль от Prior Online, не ПИН приложения.</span></label>
      <div className="bank-security"><ShieldCheck size={17} className="shrink-0"/><p>Вход выполняется через сервер FinApp. Пароль не сохраняется; банковская сессия хранится зашифрованной.</p></div>
      <label className="flex items-start gap-3 text-xs leading-relaxed py-1"><input type="checkbox" checked={consent} disabled={disabledControls} className="w-5 h-5 shrink-0 mt-0.5" onChange={e => setConsent(e.target.checked)}/>Разрешаю вход и сохранение защищённой банковской сессии. Пароль не сохраняется.</label>
      <button type="submit" disabled={disabledControls || !consent} className="auth-button">Подключить и получить операции</button>
      <button type="button" disabled={loading} className="text-action w-full" onClick={() => {if(password.current) password.current.value='';setOpen(false);setConsent(false);}}>Отмена</button>
    </form>}
    {(open || connection?.connected) && <details className="disclosure bank-settings">
      <summary>{connection?.connected ? 'Настройки подключения' : 'Период и помощь'}<ChevronDown size={15}/></summary>
      <div className="disclosure-body space-y-3">
        {connection?.lastSyncedAt && <p className="bank-caption">Обновлено {new Date(connection.lastSyncedAt).toLocaleString('ru-RU')}</p>}
        {connection?.selectedSourceKey && cardSelection}
        <details onToggle={e => setCustom(e.currentTarget.open)}>
          <summary className="text-action cursor-pointer">Другой период</summary>
          <div className="grid gap-3"><label className="text-xs min-w-0">С даты<input type="date" value={from} max={to} disabled={disabledControls} className={control} onChange={e => setFrom(e.target.value)}/></label><label className="text-xs min-w-0">По дату<input type="date" value={to} min={from} max={defaultTo} disabled={disabledControls} className={control} onChange={e => setTo(e.target.value)}/></label></div>
        </details>
        <p className="bank-caption">По умолчанию — 10 завершённых дней, без сегодняшних операций. Можно выбрать до 31 дня за одну загрузку. {connection?.connected && 'После выбора нажмите «Обновить операции».'}</p>
        <p className="bank-caption">Банк может завершить сессию — тогда понадобится повторный вход. Пароли длиннее 16 символов и дополнительное банковское подтверждение пока не поддерживаются. Менять пароль ради подключения не нужно.</p>
        {connection?.connected && <><button type="button" disabled={disabledControls} onClick={() => setDisconnecting(value => !value)} className="text-action text-rose-700">Отключить банк</button>{disconnecting && <div className="bank-notice space-y-3"><p>Удалить сохранённую банковскую сессию? Операции в журнале останутся.</p><button type="button" className="auth-button" disabled={disabledControls} onClick={() => void run('disconnect')}>Удалить подключение</button></div>}</>}
      </div>
    </details>}
    {loading && <p role="status" className="bank-caption">{message || 'Обновляем подключение…'}</p>}
    {loading && <button type="button" onClick={() => {++version.current; controller.current?.abort(); controller.current = null; setLoading(false); callbacks.current.onBusy(false); setMessage('Ожидание отменено. Откройте раздел заново, чтобы проверить состояние подключения.');}} className="text-action w-full">Отменить ожидание</button>}
    {!loading && message && !cards.length && (connection?.connected || error || message.startsWith('Подключение удалено') || message.startsWith('Ожидание отменено') || connection?.reauthRequired) && <p role="status" className="bank-caption">{message}</p>}
    {!connection?.selectedSourceKey && cardSelection}
  </div>;
}
