import { useMemo, useState } from 'react';
import { CalendarClock, ChevronDown, FileText, Sparkles } from 'lucide-react';
import { useApp } from '../AppContext';
import { isCashflow } from '../lib/finance';
import { planningDateISO } from '../lib/planning';
import { discoverRecurringExpenses } from '../lib/recurringInsights';

const dateLabel = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
const fullDate = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString('ru-RU');

interface Props {
  hideAmounts?: boolean;
  onOpenStatement?: () => void;
  onReviewTransactions?: (ids: string[]) => void;
}

export function RecurringInsights({ hideAmounts = false, onOpenStatement, onReviewTransactions }: Props) {
  const { transactions, recurringTransactions, accounts, financeLoading, financeError } = useApp();
  const [showAll, setShowAll] = useState(false);
  const today = planningDateISO();
  const insights = useMemo(() => discoverRecurringExpenses(transactions, recurringTransactions, today), [transactions, recurringTransactions, today]);
  const lastDate = useMemo(() => transactions.filter(tx => isCashflow(tx) && tx.date <= today).reduce((latest, tx) => tx.date > latest ? tx.date : latest, ''), [transactions, today]);
  const fmt = (value: number) => hideAmounts ? '••••' : `${value.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} Br`;

  if (financeLoading || financeError) return null;
  return <section className="card p-4 flex flex-col gap-3" aria-label="Найденные регулярные расходы">
    <div className="flex items-start gap-2.5">
      <div className="w-9 h-9 rounded-xl bg-emerald-50 text-emerald-700 flex items-center justify-center shrink-0"><Sparkles size={18} /></div>
      <div className="min-w-0">
        <h2 className="text-sm font-black text-slate-900">Замечены повторения</h2>
        <p className="text-[11px] text-slate-500 mt-0.5 leading-relaxed">{lastDate ? `По загруженной истории · последняя операция ${fullDate(lastDate)}` : 'Добавьте историю операций, чтобы увидеть подсказки.'}</p>
      </div>
    </div>
    {insights.length === 0 ? <p className="text-xs text-slate-500 leading-relaxed">Пока нет похожих ежемесячных платежей. Для первых подсказок нужны операции хотя бы за два месяца; для устойчивого ритма — за три.</p> : <>
      <p className="text-[11px] text-slate-500 leading-relaxed">Возможные ежемесячные расходы. Даты и суммы — оценка по истории; списания и резервы не создаются.</p>
      {(showAll ? insights : insights.slice(0, 3)).map(insight => <article key={insight.id} className="rounded-2xl border border-slate-100 bg-white/65 p-3 flex flex-col gap-2">
        <div className="flex justify-between items-start gap-2">
          <div className="min-w-0">
            <h3 className="text-xs font-extrabold text-slate-800 break-words">{insight.merchant}</h3>
            <p className="text-[10px] font-semibold text-emerald-700 mt-1">{insight.evidenceLevel === 'preliminary' ? 'Предварительно · 2 платежа' : `Ритм за ${insight.evidence.length} мес.`}</p>
            <p className="text-[10px] text-slate-500 mt-1 break-words">{accounts.find(account => account.id === insight.accountId)?.name || 'Счёт не указан'}{insight.alreadyPlanned ? ' · Есть в регулярных платежах' : ''}</p>
          </div>
          <span className="text-xs font-black text-slate-900 shrink-0">{fmt(insight.lastAmount)}</span>
        </div>
        <p className="text-[11px] text-slate-600 flex items-start gap-1.5"><CalendarClock size={13} className="shrink-0 mt-0.5" /><span>{insight.evidenceLevel === 'preliminary' ? 'Если повторится' : 'По ритму истории'}: {dateLabel(insight.expectedDate)}</span></p>
        {insight.expectedDate < today && <p className="text-[10px] text-amber-700">Расчётная дата уже прошла. Проверьте, загружены ли свежие операции.</p>}
        {insight.amountChange !== 0 && <p className="text-[11px] text-slate-600">Последний платёж на {fmt(Math.abs(insight.amountChange))} {insight.amountChange > 0 ? 'больше' : 'меньше'} предыдущего.</p>}
        <details className="text-[11px]">
          <summary className="font-bold text-emerald-800 cursor-pointer py-1">Почему появилась подсказка?</summary>
          <p className="text-slate-500 mt-2">{insight.evidenceLevel === 'preliminary' ? 'Два похожих платежа в соседних месяцах. Совпадение ещё может быть случайным.' : `Один расход в каждом из ${insight.evidence.length} месяцев подряд, примерно в одни даты. Это может быть подписка или другой регулярный платёж.`}</p>
          <ul className="mt-2 flex flex-col gap-1 text-slate-600">{insight.evidence.map(tx => <li key={tx.id} className="flex justify-between gap-2"><span>{fullDate(tx.date)}</span><span>{fmt(tx.amount)}</span></li>)}</ul>
          {onReviewTransactions && <button type="button" onClick={() => onReviewTransactions(insight.evidence.map(tx => tx.id))} className="mt-2 min-h-[40px] text-emerald-800 font-bold underline underline-offset-2">Показать эти операции в журнале</button>}
        </details>
      </article>)}
      {insights.length > 3 && <button type="button" onClick={() => setShowAll(!showAll)} className="min-h-[40px] flex items-center justify-center gap-1 text-xs font-bold text-slate-600">{showAll ? 'Свернуть' : `Все найденные: ${insights.length}`}<ChevronDown size={14} className={showAll ? 'rotate-180' : ''} /></button>}
    </>}
    {onOpenStatement && <button type="button" onClick={onOpenStatement} className="min-h-[40px] text-xs font-bold text-emerald-800 flex items-center justify-center gap-1.5 rounded-xl bg-emerald-50/80"><FileText size={14} />Обновить историю из выписки</button>}
  </section>;
}
