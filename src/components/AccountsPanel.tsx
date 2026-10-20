import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRightLeft, Check, CreditCard, PiggyBank, Plus, Wallet, X } from 'lucide-react';
import { useApp } from '../AppContext';
import { cashflowTotals, legacyMigrationCandidates, reservedGoals } from '../lib/finance';
import { localDateISO, parseMoneyInput, sumMoney } from '../lib/money';

const fmt = (amount: number) => amount.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' Br';
const kinds = { bank: 'Банковский счет', cash: 'Наличные', savings: 'Накопительный счет' };
type Modal = 'setup' | 'create' | 'transfer' | null;

export const AccountsPanel: React.FC<{ hideBalances?: boolean }> = ({ hideBalances = false }) => {
  const { accounts, accountBalances, accountsReady, schemaReady, financeLoading, financeError, transactions, savingsGoals, initializeFinance, createAccount, transferBetweenAccounts } = useApp();
  const activeAccounts = accounts.filter(account => !account.is_archived);
  const candidates = useMemo(() => legacyMigrationCandidates(transactions), [transactions]);
  const [modal, setModal] = useState<Modal>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [name, setName] = useState('');
  const [kind, setKind] = useState<'bank' | 'cash' | 'savings'>('bank');
  const [openingBalance, setOpeningBalance] = useState('0');
  const [fromAccountId, setFromAccountId] = useState('');
  const [toAccountId, setToAccountId] = useState('');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(localDateISO());
  const [comment, setComment] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const submitting = useRef(false);
  const triggerRef = useRef<HTMLElement | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  const close = () => {
    if (submitting.current) return;
    setModal(null);
    setError('');
    triggerRef.current?.focus();
  };

  useEffect(() => {
    if (!modal) return;
    dialogRef.current?.querySelector<HTMLElement>('input, select, button')?.focus();
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !submitting.current) {
        setModal(null);
        setError('');
        triggerRef.current?.focus();
      }
      if (event.key !== 'Tab') return;
      const elements = dialogRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled)');
      if (!elements?.length) return;
      const first = elements[0];
      const last = elements[elements.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [modal]);

  const open = (next: Modal) => {
    triggerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setError('');
    if (next === 'setup') setSelectedIds(new Set(candidates.map(tx => tx.id)));
    if (next === 'create') { setName(''); setKind('bank'); setOpeningBalance('0'); }
    if (next === 'transfer') { setFromAccountId(activeAccounts[0]?.id || ''); setToAccountId(activeAccounts[1]?.id || ''); setAmount(''); setDate(localDateISO()); setComment(''); }
    setModal(next);
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (submitting.current) return;
    setError('');
    const initial = parseMoneyInput(openingBalance);
    const value = parseMoneyInput(amount);
    if (modal === 'create' && (!name.trim() || initial === null)) { setError('Введите название и корректный остаток с точностью до копейки.'); return; }
    if (modal === 'transfer' && (value === null || value <= 0 || !date || !fromAccountId || !toAccountId || fromAccountId === toAccountId)) { setError('Выберите два разных счета, дату и положительную сумму с точностью до копейки.'); return; }
    submitting.current = true;
    setPending(true);
    try {
      if (modal === 'setup') await initializeFinance([...selectedIds]);
      else if (modal === 'create' && initial !== null) await createAccount({ name: name.trim(), kind, openingBalance: initial });
      else if (modal === 'transfer' && value !== null) await transferBetweenAccounts({ fromAccountId, toAccountId, amount: value, date, comment: comment.trim() });
      setModal(null);
      triggerRef.current?.focus();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Не удалось сохранить. Попробуйте ещё раз.');
    } finally {
      submitting.current = false;
      setPending(false);
    }
  };

  const selectedCandidates = candidates.filter(tx => selectedIds.has(tx.id));
  const projectedCapital = cashflowTotals(transactions.filter(tx => !selectedIds.has(tx.id))).net;
  const projectedReserved = reservedGoals(savingsGoals);
  const projectedAvailable = sumMoney([projectedCapital, -projectedReserved]);

  return (
    <section className="flex flex-col gap-3" aria-labelledby="accounts-heading">
      <div className="flex items-center justify-between gap-2 px-1">
        <h2 id="accounts-heading" className="section-title">Счета</h2>
        {accountsReady && <div className="flex gap-2">
          <button type="button" onClick={() => open('transfer')} disabled={financeLoading || !schemaReady || activeAccounts.length < 2} aria-label="Записать перевод между счетами" className="icon-button disabled:opacity-30"><ArrowRightLeft className="w-4 h-4" /></button>
          <button type="button" onClick={() => open('create')} disabled={financeLoading || !schemaReady} aria-label="Добавить счет" className="icon-button disabled:opacity-30"><Plus className="w-4 h-4" /></button>
        </div>}
      </div>
      {financeError && <p role="alert" className="rounded-2xl bg-rose-50 border border-rose-100 p-3 text-xs text-rose-700 break-words">{financeError}</p>}
      {financeLoading ? <div className="card p-4 text-xs text-slate-500" role="status">Загружаем счета…</div> : !accountsReady ? <div className="card p-4 flex flex-col gap-3">
        <p className="text-xs font-bold text-slate-800">Каждому рублю — своё место</p>
        <p className="text-[11px] text-slate-500 leading-relaxed">Учитывайте карты, наличные и накопительные счета. Переводы сохраняют общий баланс, а цели показывают, сколько уже отложено.</p>
        {!schemaReady ? <p className="text-[11px] text-slate-600">Для счетов требуется обновление приложения на сервере.</p> : <button type="button" onClick={() => open('setup')} className="self-start rounded-xl bg-slate-950 text-white px-4 py-2.5 text-xs font-bold">Настроить счета</button>}
      </div> : <div className="flex gap-3 overflow-x-auto no-scrollbar -mx-5 px-5 pb-1">
        {activeAccounts.map(account => {
          const Icon = account.kind === 'cash' ? Wallet : account.kind === 'savings' ? PiggyBank : CreditCard;
          return <div key={account.id} className="card p-4 min-w-[176px] max-w-[230px] flex flex-col gap-4 shrink-0">
            <div className="flex items-center gap-2"><Icon className="w-4 h-4 text-slate-500 shrink-0" /><span className="text-[11px] font-bold text-slate-700 truncate" title={account.name}>{account.name}</span></div>
            <div><p className="text-base font-black text-slate-900">{hideBalances ? '••••••' : fmt(accountBalances[account.id] ?? 0)}</p><p className="text-[10px] text-slate-400">{kinds[account.kind]}</p></div>
          </div>;
        })}
        {activeAccounts.length === 0 && <p className="card p-4 text-xs text-slate-500">Нет активных счетов. Добавьте новый счет.</p>}
      </div>}

      {modal && <div className="fixed inset-0 z-[100] flex items-end justify-center bg-slate-900/60 backdrop-blur-sm px-3 pt-4" onClick={close}>
        <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="account-dialog-heading" className="w-full max-w-[440px] max-h-[85dvh] overflow-y-auto bg-white rounded-t-[28px] p-5 pb-[max(24px,env(safe-area-inset-bottom))] shadow-2xl" onClick={event => event.stopPropagation()}>
          <div className="flex justify-between items-center gap-3 mb-4"><h3 id="account-dialog-heading" className="text-base font-bold text-slate-800">{modal === 'setup' ? 'Настройка счетов' : modal === 'create' ? 'Новый счет' : 'Перевод между счетами'}</h3><button type="button" onClick={close} disabled={pending} aria-label="Закрыть окно счетов" className="w-9 h-9 rounded-full bg-slate-50 flex items-center justify-center shrink-0 disabled:opacity-40"><X className="w-4 h-4" /></button></div>
          <form onSubmit={submit} className="flex flex-col gap-3.5">
            {modal === 'setup' && <>
              <p className="text-xs text-slate-600 leading-relaxed">Основной счет будет создан на основе существующих операций. Ваши суммы сохранятся.</p>
              <p className="text-[11px] text-slate-500 leading-relaxed">Отметьте записи, которые были откладыванием денег в копилку или возвратом из неё. Они станут резервами целей и перестанут считаться расходами или доходами. Остальные записи сохранят свой смысл.</p>
              {candidates.length > 0 ? <div className="flex flex-col gap-2">
                {candidates.map(tx => <label key={tx.id} className="flex items-start gap-3 rounded-2xl border border-slate-100 p-3 cursor-pointer">
                  <input type="checkbox" checked={selectedIds.has(tx.id)} disabled={pending} onChange={() => setSelectedIds(previous => { const next = new Set(previous); if (next.has(tx.id)) next.delete(tx.id); else next.add(tx.id); return next; })} className="mt-1 w-4 h-4 accent-slate-900 shrink-0" />
                  <span className="flex-1 min-w-0"><span className="block text-[11px] text-slate-700 break-words">{tx.comment.replace(/\s*\[goal_id:[^\]]+\]/g, '')}</span><span className="block text-[10px] text-slate-400 mt-1">{tx.date} · {tx.type === 'expense' ? 'В копилку' : 'Из копилки'} · {fmt(tx.amount)}</span></span>
                </label>)}
                <p className="text-[11px] text-slate-600">Выбрано {selectedCandidates.length}. В копилки: {fmt(sumMoney(selectedCandidates.filter(tx => tx.type === 'expense').map(tx => tx.amount)))}; возвраты: {fmt(sumMoney(selectedCandidates.filter(tx => tx.type === 'income').map(tx => tx.amount)))}.</p>
              </div> : <p className="text-[11px] text-slate-500">Записей для пересмотра не найдено.</p>}
              <div className="rounded-2xl bg-slate-50 p-3.5 flex flex-col gap-2.5 text-[11px]">
                <p className="font-bold text-slate-700">Баланс после настройки</p>
                <div className="flex justify-between items-center gap-3"><span className="text-slate-500">На счетах по истории</span><strong className="text-slate-800 text-right">{fmt(projectedCapital)}</strong></div>
                <div className="flex justify-between items-center gap-3"><span className="text-slate-500">Резервы существующих целей</span><strong className="text-slate-800 text-right">{fmt(projectedReserved)}</strong></div>
                <div className="flex justify-between items-center gap-3 pt-2 border-t border-slate-200"><span className="font-bold text-slate-600">Свободно</span><strong className={`text-right ${projectedAvailable < 0 ? 'text-rose-600' : 'text-emerald-700'}`}>{fmt(projectedAvailable)}</strong></div>
              </div>
              {projectedAvailable < 0 && <p className="rounded-2xl bg-amber-50 p-3 text-[11px] text-amber-800 leading-relaxed">Резервов больше, чем учтённых денег. Проверьте выбранные записи. Если история неполная, после настройки учтите недостающие счета с начальным остатком или освободите часть резервов.</p>}
              <p className="text-[11px] text-slate-500">Резерв на цель не перемещает деньги между счетами. Фактический перевод можно записать отдельно.</p>
            </>}
            {modal === 'create' && <>
              <label className="flex flex-col gap-1.5 text-[11px] text-slate-500 font-bold">Название<input value={name} onChange={event => setName(event.target.value)} maxLength={80} required disabled={pending} placeholder="Например: Зарплатная карта" className="input-light" /></label>
              <label className="flex flex-col gap-1.5 text-[11px] text-slate-500 font-bold">Тип счета<select value={kind} onChange={event => setKind(event.target.value as typeof kind)} disabled={pending} className="input-light">{Object.entries(kinds).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
              <label className="flex flex-col gap-1.5 text-[11px] text-slate-500 font-bold">Начальный остаток (Br)<input value={openingBalance} onChange={event => setOpeningBalance(event.target.value)} inputMode="decimal" required disabled={pending} placeholder="0,00" className="input-light" /></label>
              <p className="text-[11px] text-slate-500 leading-relaxed">Остаток до операций, которые вы внесёте на этот счет. Он не считается доходом.</p>
            </>}
            {modal === 'transfer' && <>
              <p className="text-xs text-slate-500 leading-relaxed">Запись для учёта денег. Чтобы перевести их, выполните перевод в банке.</p>
              <label className="flex flex-col gap-1.5 text-[11px] text-slate-500 font-bold">Откуда<select value={fromAccountId} onChange={event => setFromAccountId(event.target.value)} disabled={pending} className="input-light">{activeAccounts.map(account => <option key={account.id} value={account.id}>{account.name}</option>)}</select></label>
              <label className="flex flex-col gap-1.5 text-[11px] text-slate-500 font-bold">Куда<select value={toAccountId} onChange={event => setToAccountId(event.target.value)} disabled={pending} className="input-light">{activeAccounts.map(account => <option key={account.id} value={account.id} disabled={account.id === fromAccountId}>{account.name}</option>)}</select></label>
              <label className="flex flex-col gap-1.5 text-[11px] text-slate-500 font-bold">Сумма (Br)<input value={amount} onChange={event => setAmount(event.target.value)} inputMode="decimal" required disabled={pending} placeholder="0,00" className="input-light" /></label>
              <label className="flex flex-col gap-1.5 text-[11px] text-slate-500 font-bold">Дата<input type="date" value={date} onChange={event => setDate(event.target.value)} required disabled={pending} className="input-light" /></label>
              <label className="flex flex-col gap-1.5 text-[11px] text-slate-500 font-bold">Комментарий<input value={comment} onChange={event => setComment(event.target.value)} disabled={pending} className="input-light" placeholder="Например: Отложил на накопительный счет" /></label>
              <p className="text-[11px] text-slate-500 leading-relaxed">Остатки счетов изменятся на одну сумму. Общий баланс, доходы и расходы останутся прежними.</p>
            </>}
            {error && <p role="alert" className="rounded-2xl bg-rose-50 p-3 text-xs text-rose-700 break-words">{error}</p>}
            <button type="submit" disabled={pending || !schemaReady} className="w-full mt-1 py-3.5 rounded-2xl bg-slate-950 text-white font-bold text-xs active:scale-95 disabled:opacity-50 flex items-center justify-center gap-2"><Check className="w-4 h-4" />{pending ? 'Сохранение…' : modal === 'setup' ? 'Подтвердить и настроить' : modal === 'create' ? 'Добавить счет' : 'Записать перевод'}</button>
          </form>
        </div>
      </div>}
    </section>
  );
};
