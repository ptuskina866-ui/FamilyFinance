import { useEffect, useRef, useState } from 'react';
import { Landmark } from 'lucide-react';
import type { PriorImportSnapshot } from '../types';
import { planningDateISO } from '../lib/planning';
import { connectPriorBank } from '../services/priorBankService';

interface Props { disabled: boolean; onStart: () => void; onBusy: (busy: boolean) => void; onConnected: (snapshot: PriorImportSnapshot) => void; }
export function PriorBankConnection({disabled, onStart, onBusy, onConnected}: Props) {
  const [open, setOpen] = useState(false), [loading, setLoading] = useState(false), [consent, setConsent] = useState(false);
  const [error, setError] = useState(''), [status, setStatus] = useState('');
  const [cards, setCards] = useState<PriorImportSnapshot[]>([]), [cardIndex, setCardIndex] = useState('');
  const login = useRef<HTMLInputElement>(null), password = useRef<HTMLInputElement>(null);
  const controller = useRef<AbortController | null>(null), version = useRef(0);
  const today = planningDateISO(), start = new Date(today + 'T00:00:00Z'); start.setUTCDate(start.getUTCDate() - 6);
  const [from, setFrom] = useState(start.toISOString().slice(0, 10)), [to, setTo] = useState(today);
  useEffect(() => () => { ++version.current; controller.current?.abort(); if (password.current) password.current.value = ''; }, []);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); if (controller.current || disabled || !consent) return;
    const input = {login: login.current?.value ?? '', password: password.current?.value ?? '', from, to};
    if (password.current) password.current.value = '';
    const request = new AbortController(); controller.current = request;
    const current = ++version.current;
    onStart(); onBusy(true); setLoading(true); setCards([]); setError(''); setStatus('Подключаемся к банку и получаем историю…');
    try {
      const value = await connectPriorBank(input, request.signal);
      if (version.current !== current) return;
      setCards(value.cards); setCardIndex(value.cards.length === 1 ? '0' : '');
      setStatus(value.cards.length ? `Данные получены. Карт: ${value.cards.length}. Ничего не добавлено в журнал.` : 'Банк не вернул доступных карт.');
      if (value.cards.length === 1) onConnected(value.cards[0]);
      setOpen(false); setConsent(false);
    } catch (e) {
      if (version.current === current) {setStatus(''); setError(e instanceof Error ? e.message : 'Подключение не завершено.');}
    } finally {
      input.password = ''; input.login = '';
      if (version.current === current) {controller.current = null; setLoading(false); onBusy(false);}
    }
  };
  const control = 'mt-2 block w-full min-w-0 rounded-2xl bg-white/80 border border-white p-3 text-base text-slate-800';
  return <div className="space-y-3">
    <p className="text-xs text-slate-600 leading-relaxed">Получите карты и операции из Prior Online прямо здесь. Подключение работает через сервер FinApp — компьютер и отдельное окно не нужны.</p>
    {!open && <button type="button" disabled={disabled || loading} onClick={() => {setOpen(true); setError('');}} className="w-full flex items-center justify-center gap-2 bg-slate-950 text-white rounded-2xl p-4 text-xs font-bold disabled:opacity-40"><Landmark size={18} />{cards.length ? 'Получить данные заново' : 'Подключить Приорбанк'}</button>}
    {open && <form onSubmit={event => void submit(event)} className="space-y-3" autoComplete="off">
      <p className="text-xs text-slate-600 leading-relaxed">Логин и пароль передаются по защищённому соединению на сервер FinApp для одного входа в банк. Пароль и банковская сессия не сохраняются в базе. Фоновое обновление пока не включено; для нового получения понадобится повторный вход.</p>
      <label className="block text-xs font-bold">Логин Prior Online<input ref={login} name="prior-login" autoComplete="off" autoCapitalize="none" spellCheck={false} maxLength={128} required disabled={disabled || loading} className={control} /></label>
      <label className="block text-xs font-bold">Пароль интернет-банка<input ref={password} name="prior-password" type="password" autoComplete="off" required disabled={disabled || loading} className={control} /></label>
      <p className="text-[11px] text-slate-500">Нужен пароль Prior Online, не ПИН приложения. Пароли длиннее 16 символов пока не проверены — менять пароль ради подключения не нужно. Дополнительное банковское подтверждение пока не поддерживается.</p>
      <div className="grid gap-2 sm:grid-cols-2"><label className="min-w-0 text-xs font-bold">С даты<input type="date" value={from} max={to} required disabled={disabled || loading} className={control} onChange={e => setFrom(e.target.value)} /></label><label className="min-w-0 text-xs font-bold">По дату<input type="date" value={to} min={from} max={today} required disabled={disabled || loading} className={control} onChange={e => setTo(e.target.value)} /></label></div>
      <label className="flex gap-3 text-xs leading-relaxed"><input type="checkbox" checked={consent} disabled={disabled || loading} className="w-5 h-5 shrink-0" onChange={e => setConsent(e.target.checked)} />Разрешаю однократный вход в банк через сервер FinApp без сохранения пароля.</label>
      <button type="submit" disabled={disabled || loading || !consent} className="w-full bg-slate-950 text-white rounded-2xl p-4 text-xs font-bold disabled:opacity-40">{loading ? 'Получаем операции…' : 'Получить карты и операции'}</button>
    </form>}
    {loading && <button type="button" onClick={() => {++version.current; controller.current?.abort(); controller.current = null; setLoading(false); onBusy(false); setStatus('Ожидание отменено. Автоматического повтора нет.');}} className="w-full bg-white/80 rounded-2xl p-3 text-xs font-bold">Отменить ожидание</button>}
    {status && <p role="status" className="text-xs text-emerald-800 leading-relaxed">{status}</p>}
    {error && <p role="alert" className="text-xs text-rose-700 leading-relaxed">{error}</p>}
    {cards.length > 1 && <div className="space-y-3"><label className="block text-xs font-bold">Карта для проверки<select aria-label="Карта Приорбанка" value={cardIndex} disabled={disabled || loading} className={control} onChange={e => setCardIndex(e.target.value)}><option value="">Выберите карту</option>{cards.map((card, index) => <option key={index} value={index}>{card.card.title} · {card.card.maskedNumber} · {card.card.currency}</option>)}</select></label><button type="button" disabled={!cardIndex || disabled || loading} onClick={() => onConnected(cards[Number(cardIndex)])} className="w-full bg-slate-950 text-white rounded-2xl p-3 text-xs font-bold disabled:opacity-40">Показать операции выбранной карты</button></div>}
  </div>;
}
