import { useEffect, useRef, useState } from 'react';
import { Landmark, RefreshCw } from 'lucide-react';
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
        setConnection(state); callbacks.current.onStart(); callbacks.current.onConnected(card,state.accountId ?? undefined);
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
  const control = 'mt-2 block w-full min-w-0 rounded-2xl bg-white/80 border border-white p-3 text-base text-slate-800';
  const button = 'w-full flex items-center justify-center gap-2 bg-slate-950 text-white rounded-2xl p-4 text-xs font-bold disabled:opacity-40';
  return <div className="space-y-3">
    <p className="text-xs text-slate-600 leading-relaxed">При открытии загружаем последние 10 завершённых дней. Сегодняшние операции пока не включаем. Добавляйте только выбранные записи.</p>
    {connection?.connected && <div className="space-y-2 text-xs"><p className="font-bold text-emerald-800">Приорбанк подключён</p>{connection.lastSyncedAt && <p className="text-slate-500">Получено: {new Date(connection.lastSyncedAt).toLocaleString('ru-RU')}</p>}<button type="button" className={button} disabled={disabled || loading} onClick={() => void run('sync')}><RefreshCw size={16} />Обновить операции</button><button type="button" disabled={disabled || loading} onClick={() => setDisconnecting(value => !value)} className="py-2 text-slate-500 underline">Отключить банк</button>{disconnecting && <div className="rounded-2xl bg-white/70 p-3 space-y-3"><p>Удалить сохранённую банковскую сессию? Операции в журнале останутся.</p><button type="button" className={button} disabled={disabled || loading} onClick={() => void run('disconnect')}>Удалить подключение</button></div>}</div>}
    {!connection?.connected && !open && <button type="button" disabled={disabled || loading} onClick={() => {setOpen(true); setError('');}} className={button}><Landmark size={18} />Подключить Приорбанк</button>}
    {(open || connection?.connected) && <details className="text-xs text-slate-500" onToggle={e => setCustom(e.currentTarget.open)}><summary className="py-2 cursor-pointer">Другой период</summary><div className="grid gap-2 sm:grid-cols-2"><label className="min-w-0">С даты<input type="date" value={from} max={to} disabled={disabled || loading} className={control} onChange={e => setFrom(e.target.value)} /></label><label className="min-w-0">По дату<input type="date" value={to} min={from} max={defaultTo} disabled={disabled || loading} className={control} onChange={e => setTo(e.target.value)} /></label></div><p className="mt-2">До 31 завершённого дня за одну загрузку.</p></details>}
    {open && <form onSubmit={event => {event.preventDefault(); if (consent) void run('connect');}} className="space-y-3" autoComplete="off">
      <p className="text-xs text-slate-600 leading-relaxed">Логин и пароль передаются на сервер FinApp для входа в банк. Сохраняем только зашифрованную банковскую сессию. Пароль не сохраняется. Если банк завершит сессию, понадобится войти снова.</p>
      <label className="block text-xs font-bold">Логин Prior Online<input ref={login} name="prior-login" autoComplete="off" autoCapitalize="none" spellCheck={false} maxLength={128} required disabled={disabled || loading} className={control} /></label>
      <label className="block text-xs font-bold">Пароль интернет-банка<input ref={password} name="prior-password" type="password" autoComplete="off" required disabled={disabled || loading} className={control} /></label>
      <p className="text-[11px] text-slate-500">Нужен пароль Prior Online, не ПИН приложения. Пароли длиннее 16 символов и дополнительное банковское подтверждение пока не поддерживаются. Менять пароль ради подключения не нужно.</p>
      <label className="flex gap-3 text-xs leading-relaxed"><input type="checkbox" checked={consent} disabled={disabled || loading} className="w-5 h-5 shrink-0" onChange={e => setConsent(e.target.checked)} />Разрешаю вход и сохранение защищённой банковской сессии. Пароль не сохраняется.</label>
      <button type="submit" disabled={disabled || loading || !consent} className={button}>Подключить и получить операции</button>
    </form>}
    {loading && <p role="status" className="text-xs text-slate-600">{message || 'Обновляем подключение…'}</p>}
    {loading && <button type="button" onClick={() => {++version.current; controller.current?.abort(); controller.current = null; setLoading(false); callbacks.current.onBusy(false); setMessage('Ожидание отменено. Откройте раздел заново, чтобы проверить состояние подключения.');}} className="w-full bg-white/80 rounded-2xl p-3 text-xs font-bold">Отменить ожидание</button>}
    {!loading && message && <p role="status" className="text-xs text-emerald-800 leading-relaxed">{message}</p>}
    {error && <p role="alert" className="text-xs text-rose-700 leading-relaxed">{error}</p>}
    {cards.length > 1 && <div className="space-y-3"><label className="block text-xs font-bold">Карта для проверки<select aria-label="Карта Приорбанка" value={cardIndex} disabled={disabled || loading} className={control} onChange={e => setCardIndex(e.target.value)}><option value="">Выберите карту</option>{cards.map((card, index) => <option key={index} value={index}>{card.card.title} · {card.card.maskedNumber} · {card.card.currency}</option>)}</select></label><button type="button" disabled={!cardIndex || disabled || loading} onClick={() => void run('select')} className={button}>Запомнить карту и показать операции</button></div>}
  </div>;
}
