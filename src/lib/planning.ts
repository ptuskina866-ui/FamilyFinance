import type { CategoryBudget, IncomeAllocation, RecurringTransaction, Transaction } from '../types';
import { isCashflow } from './finance';
import { fromMinorUnits, localDateISO, sumMoney, toMinorUnits } from './money';

/** Shared BYN planning uses one household calendar even when members travel. */
export function planningDateISO(date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Minsk', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  const part = (type: string) => parts.find(p => p.type === type)?.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}

export function budgetProgress(budget: CategoryBudget, transactions: readonly Transaction[]) {
  const spent = sumMoney(transactions.filter(t => isCashflow(t) && t.type === 'expense' && matchesBudgetCategory(budget.category_id,t.categoryId) && t.date.startsWith(budget.month.slice(0, 7))).map(t => t.amount));
  const delta = toMinorUnits(budget.allocated_amount) - toMinorUnits(spent);
  return { spent, remaining: fromMinorUnits(Math.max(0, delta)), overspent: fromMinorUnits(Math.max(0, -delta)) };
}

export function matchesBudgetCategory(budgetCategory: string, transactionCategory: string) {
  return budgetCategory === transactionCategory || (budgetCategory === 'food' && transactionCategory.startsWith('food-'));
}

export function validateBudgetScopes(budgets: readonly CategoryBudget[], categoryId: string, amount: number, month: string) {
  if (amount <= 0) return;
  if (budgets.some(b => b.month === month && b.allocated_amount > 0 && b.category_id !== categoryId && (matchesBudgetCategory(b.category_id,categoryId) || matchesBudgetCategory(categoryId,b.category_id)))) throw new Error('Общий бюджет еды и бюджет отдельного магазина пересекаются. Сначала освободите один из них.');
}

export function budgetReserved(budgets: readonly CategoryBudget[], transactions: readonly Transaction[], today = planningDateISO()) {
  return sumMoney(budgets.filter(b => b.month.slice(0, 7) === today.slice(0, 7)).map(b => budgetProgress(b, transactions).remaining));
}

/** A bill already funded by an envelope must not reserve the same money twice. */
export function uncoveredRecurring(recurring: readonly RecurringTransaction[], budgets: readonly CategoryBudget[], transactions: readonly Transaction[], today = planningDateISO()) {
  const funds = new Map(budgets.filter(b => b.month.slice(0, 7) === today.slice(0, 7)).map(b => [b.category_id, toMinorUnits(budgetProgress(b, transactions).remaining)]));
  return [...recurring].sort((a, b) => a.day_of_month - b.day_of_month || a.id.localeCompare(b.id)).map(item => {
    if (!item.is_active || item.type !== 'expense') return item;
    const due = `${today.slice(0, 7)}-${String(item.day_of_month).padStart(2, '0')}`;
    if (due < today || (item.last_applied && item.last_applied >= due) || transactions.some(t => t.recurringId === item.id && t.date === due)) return item;
    const key = funds.has(item.category_id) ? item.category_id : item.category_id.startsWith('food-') && funds.has('food') ? 'food' : item.category_id;
    const funded = funds.get(key) || 0;
    const use = Math.min(funded, toMinorUnits(item.amount));
    funds.set(key, funded - use);
    return { ...item, amount: fromMinorUnits(toMinorUnits(item.amount) - use) };
  });
}

/** For the free daily estimate only: purchases funded by a category do not consume the free pool. */
export function unassignedDailyTransactions(transactions: readonly Transaction[], budgets: readonly CategoryBudget[], today = planningDateISO()): Transaction[] {
  const funds = new Map(budgets.filter(b => b.month.slice(0,7) === today.slice(0,7)).map(b => {
    const spentBeforeToday = sumMoney(transactions.filter(t => isCashflow(t) && t.type === 'expense' && t.date >= b.month && t.date < today && matchesBudgetCategory(b.category_id,t.categoryId)).map(t => t.amount));
    return [b.category_id,Math.max(0,toMinorUnits(b.allocated_amount)-toMinorUnits(spentBeforeToday))];
  }));
  const amounts = new Map<string,number>();
  for (const tx of [...transactions].sort((a,b) => a.id.localeCompare(b.id))) {
    if (!isCashflow(tx) || tx.type !== 'expense' || tx.date !== today) continue;
    const key = funds.has(tx.categoryId) ? tx.categoryId : tx.categoryId.startsWith('food-') && funds.has('food') ? 'food' : tx.categoryId;
    const funded = funds.get(key) || 0;
    const used = Math.min(funded,toMinorUnits(tx.amount));
    funds.set(key,funded-used);
    amounts.set(tx.id,fromMinorUnits(toMinorUnits(tx.amount)-used));
  }
  return transactions.map(t => amounts.has(t.id) ? {...t,amount:amounts.get(t.id)!} : t);
}

export function allocationTotal(items: readonly IncomeAllocation[]): number {
  if (!items.length || items.length > 32) throw new Error('Добавьте от 1 до 32 назначений.');
  const seen = new Set<string>();
  for (const item of items) {
    if (!['goal', 'budget'].includes(item.targetType) || !item.targetId || item.targetId !== item.targetId.trim() || toMinorUnits(item.amount) <= 0) throw new Error('Укажите положительную сумму и назначение для каждой строки.');
    const key = `${item.targetType}:${item.targetId}`;
    if (seen.has(key)) throw new Error('Одна цель или категория не может повторяться в распределении.');
    seen.add(key);
  }
  return sumMoney(items.map(item => item.amount));
}

export function planningErrorMessage(message: string): string {
  const messages: [RegExp,string][] = [
    [/Insufficient (unassigned|unreserved) funds|Allocation exceeds income or unassigned funds/, 'Недостаточно свободных денег. Уменьшите сумму или освободите часть резерва.'],
    [/Food budgets overlap/, 'Общий бюджет еды и бюджет отдельного магазина пересекаются. Сначала освободите один из них.'],
    [/Income already distributed/, 'Этот доход уже распределён. Обновите данные перед следующим действием.'],
    [/posted income from this month/, 'Выберите уже полученный доход за текущий месяц.'],
    [/Only the current month can be funded/, 'Месяц изменился. Обновите приложение и проверьте план.'],
    [/Distributed income history cannot be deleted/, 'Распределённый доход нельзя удалить: к нему привязан план расходов и накоплений.'],
    [/Distributed income must preserve/, 'У распределённого дохода нельзя менять дату, тип или уменьшать сумму ниже выделенной.'],
    [/Release goal reservations or budgets/, 'Сначала освободите часть денег из целей или бюджетов.'],
  ];
  return messages.find(([pattern]) => pattern.test(message))?.[1] || message;
}

export interface CashflowEvent { id: string; date: string; type: 'income' | 'expense'; amount: number; comment: string; projectedBalance: number }

/** Future income is shown as a scenario and never added to currently available funds. */
export function cashflowCalendar(capital: number, recurring: readonly RecurringTransaction[], transactions: readonly Transaction[], today = localDateISO(), days = 35): CashflowEvent[] {
  const end = new Date(`${today}T12:00:00`); end.setDate(end.getDate() + days);
  const endISO = localDateISO(end);
  const month = new Date(`${today.slice(0, 7)}-01T12:00:00`);
  const events: Omit<CashflowEvent, 'projectedBalance'>[] = [];
  while (localDateISO(month) <= endISO) {
    for (const item of recurring) {
      if (!item.is_active) continue;
      const due = `${localDateISO(month).slice(0, 7)}-${String(item.day_of_month).padStart(2, '0')}`;
      if (due < today || due > endISO || (item.last_applied && item.last_applied >= due) || transactions.some(t => t.recurringId === item.id && t.date === due)) continue;
      events.push({ id: `${item.id}:${due}`, date: due, type: item.type, amount: item.amount, comment: item.comment || (item.type === 'income' ? 'Плановый доход' : 'Плановый платеж') });
    }
    month.setMonth(month.getMonth() + 1);
  }
  // Show expenses first on the same day: avoid optimistic same-day availability.
  events.sort((a, b) => a.date.localeCompare(b.date) || (a.type === b.type ? a.id.localeCompare(b.id) : a.type === 'expense' ? -1 : 1));
  let cents = toMinorUnits(capital);
  return events.map(event => { cents += (event.type === 'income' ? 1 : -1) * toMinorUnits(event.amount); return { ...event, projectedBalance: fromMinorUnits(cents) }; });
}
