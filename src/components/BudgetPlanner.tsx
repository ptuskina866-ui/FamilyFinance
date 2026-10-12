import { useRef, useState } from 'react';
import { Plus, Pencil, X, Wallet, CalendarDays } from 'lucide-react';
import { useApp } from '../AppContext';
import { isCashflow } from '../lib/finance';
import { allocationTotal, budgetProgress, cashflowCalendar, planningDateISO } from '../lib/planning';
import { fromMinorUnits, parseMoneyInput, toMinorUnits } from '../lib/money';
import type { IncomeAllocation } from '../types';

const fmt = (n: number) => n.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' Br';
const field = 'w-full min-w-0 rounded-xl border border-slate-200 bg-white/80 p-3 text-sm text-slate-900';
const action = 'rounded-xl bg-slate-950 px-4 py-3 text-xs font-bold text-white disabled:opacity-40';
interface AllocationDraft { key: number; target: string; amount: string }

export function BudgetPlanner() {
  const { categoryBudgets, incomeDistributions, transactions, savingsGoals, recurringTransactions, categories,
    availableBalance, budgetReservedBalance, balance, accountsReady, planningReady, financeLoading, setCategoryBudget, distributeIncome } = useApp();
  const today = planningDateISO();
  const month = `${today.slice(0, 7)}-01`;
  const budgets = categoryBudgets.filter(b => b.month === month);
  const expenseCategories = categories.filter(c => c.id !== 'savings' && c.id !== 'salary' && !c.id.startsWith('income-'));
  const eligibleIncome = transactions.filter(t => isCashflow(t) && t.type === 'income' && t.date.startsWith(today.slice(0,7)) && t.date <= today
    && !incomeDistributions.some(d => d.income_transaction_id === t.id));
  const goals = savingsGoals.filter(g => !g.is_archived);
  const events = cashflowCalendar(balance, recurringTransactions, transactions, today);
  const enabled = planningReady && accountsReady && !financeLoading;
  const [editing, setEditing] = useState(false);
  const [category, setCategory] = useState('food');
  const [budgetAmount, setBudgetAmount] = useState('');
  const [incomeId, setIncomeId] = useState('');
  const [drafts, setDrafts] = useState<AllocationDraft[]>([{ key: 0, target: 'budget:food', amount: '' }]);
  const nextKey = useRef(1);
  const pending = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [errorAction, setErrorAction] = useState<'budget' | 'income'>('budget');
  const [notice, setNotice] = useState('');
  const source = eligibleIncome.find(t => t.id === incomeId) || eligibleIncome[0];
  const items: IncomeAllocation[] = drafts.map(d => ({ targetType: d.target.startsWith('goal:') ? 'goal' : 'budget', targetId: d.target.slice(d.target.indexOf(':')+1), amount: parseMoneyInput(d.amount) ?? 0 }));
  let total = 0;
  let validAllocation = false;
  try { total = allocationTotal(items); validAllocation = !!source && total <= source.amount && total <= availableBalance; } catch { /* Incomplete draft; validated on submission. */ }
  const perform = async (work: () => Promise<void>, success: string, scope: 'budget' | 'income') => {
    if (pending.current) return;
    pending.current = true; setBusy(true); setError(''); setNotice(''); setErrorAction(scope);
    try { await work(); setNotice(success); }
    catch (e) { setError(e instanceof Error ? e.message : 'Не удалось сохранить. Попробуйте ещё раз.'); }
    finally { pending.current = false; setBusy(false); }
  };
  const openBudget = (id = 'food', amount = '') => { setCategory(id); setBudgetAmount(amount); setError(''); setEditing(true); };
  return <div className="flex flex-col gap-3">
    <div className="card p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2"><h2 className="text-sm font-black text-slate-900">Бюджет месяца</h2><Wallet className="w-5 h-5 text-emerald-600" /></div>
      <p className="text-xs text-slate-500">{new Date(`${month}T12:00:00`).toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' })} · общий для семьи</p>
      <div className="grid grid-cols-2 gap-3"><div><p className="text-[10px] text-slate-500">Свободно</p><strong className={`text-lg ${availableBalance < 0 ? 'text-rose-600' : 'text-slate-900'}`}>{fmt(availableBalance)}</strong></div><div><p className="text-[10px] text-slate-500">Осталось в категориях</p><strong className="text-lg text-emerald-700">{fmt(budgetReservedBalance)}</strong></div></div>
      <p className="text-[11px] leading-relaxed text-slate-500">Назначьте деньги на еду, жильё и другие расходы. Покупки уменьшают остаток своей категории; накопления остаются отдельным резервом. В начале месяца бюджеты начинаются заново.</p>
      {!planningReady && <p className="text-xs text-amber-700">Бюджеты появятся после обновления приложения.</p>}
      {!accountsReady && <p className="text-xs text-amber-700">Сначала настройте счета на главной странице.</p>}
      <button type="button" className={`${action} flex items-center justify-center gap-2`} disabled={!enabled || busy} onClick={() => openBudget()}><Plus className="w-4 h-4" />Добавить категорию</button>
    </div>
    {editing && <form className="card p-4 flex flex-col gap-3" onSubmit={e => {
      e.preventDefault(); const amount = parseMoneyInput(budgetAmount);
      if (amount === null || amount < 0) { setErrorAction('budget'); setError('Укажите сумму от нуля с точностью до копейки.'); return; }
      void perform(async () => { await setCategoryBudget(category, amount); setEditing(false); }, 'Бюджет сохранён.', 'budget');
    }}>
      <div className="flex items-center justify-between"><h3 className="text-xs font-bold">План категории на месяц</h3><button type="button" aria-label="Закрыть план категории" disabled={busy} onClick={() => setEditing(false)}><X className="w-5 h-5" /></button></div>
      <label className="text-xs text-slate-500">Категория<select className={`${field} mt-1`} aria-label="Категория бюджета" value={category} disabled={busy} onChange={e => { setCategory(e.target.value); setBudgetAmount(String(budgets.find(b => b.category_id === e.target.value)?.allocated_amount ?? '')); }}>
        {expenseCategories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
      </select></label>
      <label className="text-xs text-slate-500">Всего на месяц, Br<input aria-label="Сумма бюджета" className={`${field} mt-1`} inputMode="decimal" placeholder="Например, 500" value={budgetAmount} disabled={busy} onChange={e => setBudgetAmount(e.target.value)} /></label>
      <p className="text-[11px] text-slate-500">Сумма включает уже потраченное в этом месяце. Укажите 0, чтобы освободить остаток. Общая «Еда» включает все продуктовые магазины.</p>
      {error && errorAction === 'budget' && <p role="alert" className="text-xs text-rose-700 break-words">{error}</p>}
      <button className={action} disabled={busy || !enabled}>{busy ? 'Сохраняем…' : 'Сохранить бюджет'}</button>
    </form>}
    {budgets.filter(b => b.allocated_amount > 0).map(b => {
      const progress = budgetProgress(b, transactions);
      const percent = Math.min(100, Math.round(toMinorUnits(progress.spent) / Math.max(1,toMinorUnits(b.allocated_amount))*100));
      return <div key={b.id} className="card p-4 flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2"><h3 className="text-xs font-bold text-slate-900">{categories.find(c => c.id === b.category_id)?.name || b.category_id}</h3><button type="button" aria-label={`Изменить бюджет ${categories.find(c => c.id === b.category_id)?.name || b.category_id}`} disabled={busy} onClick={() => openBudget(b.category_id, String(b.allocated_amount))} className="p-2"><Pencil className="w-4 h-4 text-slate-500" /></button></div>
        <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden"><div className={`h-full rounded-full ${progress.overspent ? 'bg-rose-500' : 'bg-emerald-500'}`} style={{ width: `${percent}%` }} /></div>
        <div className="flex justify-between gap-2 text-[11px] text-slate-500"><span>Потрачено {fmt(progress.spent)}</span><span>из {fmt(b.allocated_amount)}</span></div>
        <p className={`text-xs font-bold ${progress.overspent ? 'text-rose-600' : 'text-emerald-700'}`}>{progress.overspent ? `Превышение ${fmt(progress.overspent)}` : `Осталось ${fmt(progress.remaining)}`}</p>
      </div>;
    })}
    <form className="card p-4 flex flex-col gap-3" onSubmit={e => { e.preventDefault(); if (!source) return; void perform(async () => {
      allocationTotal(items); if (!validAllocation) throw new Error('Распределение превышает доход или свободный остаток.');
      await distributeIncome(source.id, items); setIncomeId(''); setDrafts([{ key: nextKey.current++, target: 'budget:food', amount: '' }]);
    }, 'Доход распределён. Общий остаток на счетах не изменился.', 'income'); }}>
      <h2 className="text-sm font-black text-slate-900">Дайте доходу назначение</h2>
      <p className="text-[11px] leading-relaxed text-slate-500">Распределите уже полученный доход между расходами и целями. Подтвердите план целиком: каждый доход распределяется один раз, оставшиеся деньги будут свободными.</p>
      {source ? <>
        <select aria-label="Доход для распределения" className={field} value={source.id} disabled={busy} onChange={e => setIncomeId(e.target.value)}>{eligibleIncome.map(t => <option key={t.id} value={t.id}>{t.date.slice(8)} · {t.comment || 'Доход'} · {fmt(t.amount)}</option>)}</select>
        {drafts.map((d,index) => <div key={d.key} className="rounded-xl bg-slate-50/80 p-3 flex flex-col gap-2">
          <div className="flex items-center justify-between"><span className="text-[10px] font-bold text-slate-500">Назначение {index+1}</span>{drafts.length > 1 && <button type="button" aria-label={`Удалить назначение ${index+1}`} disabled={busy} onClick={() => setDrafts(rows => rows.filter(r => r.key !== d.key))}><X className="w-4 h-4" /></button>}</div>
          <select aria-label={`Назначение ${index+1}`} className={field} value={d.target} disabled={busy} onChange={e => setDrafts(rows => rows.map(r => r.key === d.key ? { ...r, target: e.target.value } : r))}>
            <optgroup label="Бюджеты расходов">{expenseCategories.map(c => <option key={c.id} value={`budget:${c.id}`}>{c.name}</option>)}</optgroup>
            <optgroup label="Накопления">{goals.map(g => <option key={g.id} value={`goal:${g.id}`}>{g.emoji} {g.name}</option>)}</optgroup>
          </select>
          <input aria-label={`Сумма назначения ${index+1}`} className={field} inputMode="decimal" placeholder="Сумма, Br" value={d.amount} disabled={busy} onChange={e => setDrafts(rows => rows.map(r => r.key === d.key ? { ...r, amount: e.target.value } : r))} />
        </div>)}
        <button type="button" disabled={busy || drafts.length >= 32} className="text-xs font-bold text-emerald-700 py-2" onClick={() => setDrafts(rows => [...rows, {key:nextKey.current++,target:'budget:utilities',amount:''}])}>+ Ещё назначение</button>
        <div className="rounded-xl bg-emerald-50 p-3 text-xs flex flex-col gap-1"><span>Распределяем: <strong>{fmt(total)}</strong></span><span>Свободно после: <strong>{fmt(fromMinorUnits(toMinorUnits(availableBalance)-toMinorUnits(total)))}</strong></span><span>Из дохода останется: <strong>{fmt(fromMinorUnits(toMinorUnits(source.amount)-toMinorUnits(total)))}</strong></span></div>
        <button className={action} disabled={!enabled || busy || !validAllocation}>{busy ? 'Распределяем…' : 'Подтвердить распределение'}</button>
      </> : <p className="text-xs text-slate-500">Добавьте полученный доход за текущий месяц. Будущие доходы можно посмотреть в календаре ниже.</p>}
      {!!incomeDistributions.length && <div className="border-t border-slate-100 pt-3 flex flex-col gap-2">{incomeDistributions.map(d => <p key={d.id} className="text-[11px] text-slate-500">✓ {transactions.find(t => t.id === d.income_transaction_id)?.comment || 'Доход'}: распределено {fmt(d.total_amount)}</p>)}</div>}
      {error && errorAction === 'income' && <p role="alert" className="text-xs text-rose-700 break-words">{error}</p>}
    </form>
    {notice && <p role="status" className="rounded-xl bg-emerald-50 p-3 text-xs text-emerald-800">{notice}</p>}
    <div className="card p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between"><h2 className="text-sm font-black text-slate-900">Ближайшие 35 дней</h2><CalendarDays className="w-5 h-5 text-slate-500" /></div>
      <p className="text-[11px] text-slate-500 leading-relaxed">Сценарий по регулярным платежам. Остаток ниже — общий на счетах, с учётом только этих событий. Будущие доходы не увеличивают свободные деньги сегодня.</p>
      {events.length ? events.map(event => <div key={event.id} className="flex justify-between gap-3 border-t border-slate-100 pt-2 text-xs"><div className="min-w-0"><p className="text-[10px] text-slate-400">{new Date(`${event.date}T12:00:00`).toLocaleDateString('ru-RU',{day:'numeric',month:'short'})}</p><p className="font-bold text-slate-700 break-words">{event.comment}</p></div><div className="text-right shrink-0"><p className={event.type === 'income' ? 'text-emerald-700' : 'text-slate-900'}>{event.type === 'income' ? '+' : '−'}{fmt(event.amount)}</p><p className={`text-[10px] ${event.projectedBalance < 0 ? 'text-rose-600' : 'text-slate-400'}`}>Остаток {fmt(event.projectedBalance)}</p></div></div>) : <p className="text-xs text-slate-500">Создайте регулярный платёж или доход во вкладке «Платежи».</p>}
    </div>
  </div>;
}
