import React, { useState, useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { Transaction } from '../types';
import { useApp } from '../AppContext';
import { parseMoneyInput } from '../lib/money';

export const TransactionEditor: React.FC<{ transaction: Transaction; onClose: () => void }> = ({ transaction, onClose }) => {
  const { accounts, categories, members, updateTransaction } = useApp();
  const [amount, setAmount] = useState(transaction.amount.toFixed(2));
  const [categoryId, setCategoryId] = useState(transaction.categoryId);
  const [accountId, setAccountId] = useState(transaction.accountId || accounts.find(a => !a.is_archived)?.id || '');
  const [date, setDate] = useState(transaction.date);
  const [comment, setComment] = useState(transaction.comment);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dialog = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !saving) onClose();
      if (event.key !== 'Tab') return;
      const elements = dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled)');
      if (!elements?.length) return;
      const first = elements[0]; const last = elements[elements.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('keydown', onKey); previous?.focus(); };
  }, [saving, onClose]);
  const availableCategories = categories.filter(c => transaction.type === 'income' ? c.id === 'salary' || c.id.startsWith('income-') : c.id !== 'salary' && !c.id.startsWith('income-'));
  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    const value = parseMoneyInput(amount);
    if (saving || value === null || value <= 0) { setError('Укажите положительную сумму с точностью до копейки.'); return; }
    setSaving(true); setError(null);
    try { await updateTransaction(transaction.id, { ...transaction, amount: value, categoryId, accountId: accountId || null, date, comment: comment.trim() }); onClose(); }
    catch (err) { setError(err instanceof Error ? err.message : 'Не удалось сохранить изменения.'); }
    finally { setSaving(false); }
  };
  const inputClass = 'w-full min-w-0 p-3 rounded-xl bg-slate-50 border border-slate-200 text-sm text-slate-800';
  return <div className="fixed inset-0 z-[100] bg-slate-900/40 backdrop-blur-sm flex items-end sm:items-center justify-center p-3" onClick={() => { if (!saving) onClose(); }}>
    <div ref={dialog} role="dialog" aria-modal="true" aria-labelledby="transaction-edit-title" className="bg-white rounded-3xl p-5 w-full max-w-sm max-h-[90dvh] overflow-y-auto pb-[max(20px,env(safe-area-inset-bottom))]" onClick={e => e.stopPropagation()}>
      <div className="flex items-center justify-between mb-4"><h2 id="transaction-edit-title" className="font-black text-sm">Редактировать операцию</h2><button type="button" aria-label="Закрыть редактирование" disabled={saving} onClick={onClose} className="p-2"><X className="w-4 h-4" /></button></div>
      <form onSubmit={save} className="flex flex-col gap-3">
        <p className="text-xs text-slate-500">{transaction.type === 'income' ? 'Доход' : 'Расход'} · {members.find(m => m.id === transaction.addedBy)?.name || 'Участник семьи'}</p>
        <label className="text-xs font-bold">Сумма, Br<input aria-label="Сумма операции" autoFocus inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} className={inputClass} /></label>
        <label className="text-xs font-bold">Категория<select value={categoryId} onChange={e => setCategoryId(e.target.value)} className={inputClass}>{!availableCategories.some(c => c.id === categoryId) && <option value={categoryId}>{categoryId}</option>}{availableCategories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
        {accounts.length > 0 && <label className="text-xs font-bold">Счет<select aria-label="Счет редактируемой операции" value={accountId} onChange={e => setAccountId(e.target.value)} className={inputClass}>{accounts.filter(a => !a.is_archived || a.id === accountId).map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>}
        <label className="text-xs font-bold">Дата<input type="date" required disabled={!!transaction.recurringId} value={date} onChange={e => setDate(e.target.value)} className={inputClass} /></label>
        {transaction.recurringId && <p className="text-xs text-slate-500">Дата связана с регулярным платежом. Остальные поля можно изменить.</p>}
        <label className="text-xs font-bold">Комментарий<input value={comment} onChange={e => setComment(e.target.value)} className={inputClass} /></label>
        {error && <p role="alert" className="text-xs text-rose-600">{error}</p>}
        <button type="submit" disabled={saving} className="rounded-full bg-slate-950 text-white font-bold py-3 text-sm disabled:opacity-50">{saving ? 'Сохраняем…' : 'Сохранить изменения'}</button>
      </form>
    </div>
  </div>;
};
