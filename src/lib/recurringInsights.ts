import type { RecurringExpenseInsight, RecurringTransaction, Transaction } from '../types';
import { isCashflow } from './finance';
import { fromMinorUnits, toMinorUnits } from './money';
import { planningDateISO } from './planning';
import { merchantIdentity,transactionMerchant } from './merchants';

const GENERIC_DESCRIPTIONS = /^(?:покупка|покупки|оплата|платеж|платёж|расход|расходы|продукты|еда|кафе|такси|перевод|другое|импорт выписки|без комментария)$/u;

/** Preserve merchant numbers/branches: aggressive fuzzy matching can merge unrelated bills. */
export function recurringMerchantKey(comment: string): string {
  const key = comment.normalize('NFKC').toLocaleLowerCase('ru-RU')
    .replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  return key.length >= 2 && /\p{L}/u.test(key) && !GENERIC_DESCRIPTIONS.test(key) ? key : '';
}

function dateParts(iso: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const [year, month, day] = iso.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return { month: year * 12 + month - 1, day, lastDay: new Date(Date.UTC(year, month, 0)).getUTCDate() };
}

function dateInMonth(monthIndex: number, day: number) {
  const year = Math.floor(monthIndex / 12), month = monthIndex % 12;
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(Math.min(day, lastDay)).padStart(2, '0')}`;
}

/** Read-only hypotheses. Never feeds reservations, recurring auto-posting or bank balances. */
export function discoverRecurringExpenses(
  transactions: readonly Transaction[], recurring: readonly RecurringTransaction[] = [], today = planningDateISO(),
): RecurringExpenseInsight[] {
  const now = dateParts(today);
  if (!now) throw new RangeError('Некорректная дата анализа.');
  const groups = new Map<string, Transaction[]>();
  const seen = new Set<string>();
  for (const tx of transactions) {
    const date = dateParts(tx.date), merchant = transactionMerchant(tx).key;
    // Auto-posted templates are not independent evidence of a real bank payment.
    if (!tx.id || seen.has(tx.id) || !date || tx.date > today || date.month < now.month - 11 || !merchant ||
        tx.type !== 'expense' || !isCashflow(tx) || tx.recurringId) continue;
    let cents: number;
    try { cents = toMinorUnits(tx.amount); } catch { continue; }
    if (cents <= 0) continue;
    seen.add(tx.id);
    const key = JSON.stringify([tx.accountId || null, merchant]);
    const group = groups.get(key) || [];
    group.push(tx); groups.set(key, group);
  }
  const insights: RecurringExpenseInsight[] = [];
  for (const [id, group] of groups) {
    const months = new Map<number, Transaction[]>();
    for (const tx of group) {
      const month = dateParts(tx.date)!.month;
      months.set(month, [...(months.get(month) || []), tx]);
    }
    const latestMonth = Math.max(...months.keys());
    if (latestMonth < now.month - 1) continue;
    const chain: Transaction[] = [];
    // One payment per month; shopping, repeated imports and split bills are ambiguous.
    for (let month = latestMonth; chain.length < 6; month--) {
      const rows = months.get(month);
      if (!rows || rows.length !== 1) break;
      chain.push(rows[0]);
    }
    if (chain.length < 2) continue;
    const days = chain.map(tx => Math.min(dateParts(tx.date)!.day, 28));
    if (Math.max(...days) - Math.min(...days) > 4) continue;
    const latest = chain[0], previous = chain[1];
    const monthEnd = chain.every(tx => { const d = dateParts(tx.date)!; return d.day === d.lastDay; });
    const expectedDate = dateInMonth(latestMonth + 1, monthEnd ? 31 : dateParts(latest.date)!.day);
    const merchantKey = transactionMerchant(latest).key;
    insights.push({
      id, merchantKey,merchant:transactionMerchant(latest).name, accountId: latest.accountId || null, categoryId: latest.categoryId,
      lastAmount: latest.amount, previousAmount: previous.amount,
      amountChange: fromMinorUnits(toMinorUnits(latest.amount) - toMinorUnits(previous.amount)), expectedDate,
      alreadyPlanned: recurring.some(item => item.is_active && item.type === 'expense' &&
        (item.account_id || null) === (latest.accountId || null) && (item.merchant_key||merchantIdentity(item.comment).key) === merchantKey),
      evidenceLevel: chain.length >= 3 ? 'established' : 'preliminary',
      evidence: chain.map(tx => ({ id: tx.id, date: tx.date, amount: tx.amount })),
    });
  }
  return insights.sort((a, b) => a.expectedDate.localeCompare(b.expectedDate) || a.id.localeCompare(b.id));
}
