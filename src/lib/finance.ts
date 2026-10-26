import type { Account, RecurringTransaction, SavingsGoal, Transaction } from '../types';
import { fromMinorUnits, localDateISO, sumMoney, toMinorUnits } from './money';

interface CalendarDate {
  year: number;
  month: number;
  day: number;
}

function calendarDate(iso: string): CalendarDate {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) throw new RangeError('Некорректная календарная дата.');
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const check = new Date(Date.UTC(year, month - 1, day));
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) {
    throw new RangeError('Некорректная календарная дата.');
  }
  return { year, month, day };
}

function monthNumber(date: CalendarDate): number {
  return date.year * 12 + date.month - 1;
}

function monthISO(month: number, day = 1): string {
  const year = Math.floor(month / 12);
  const monthOfYear = month % 12 + 1;
  const lastDay = new Date(Date.UTC(year, monthOfYear, 0)).getUTCDate();
  return `${year}-${String(monthOfYear).padStart(2, '0')}-${String(Math.min(day, lastDay)).padStart(2, '0')}`;
}

export function isCashflow(tx: Transaction): boolean {
  return tx.kind == null || tx.kind === 'cashflow';
}

export function recurringDueDate(month:string,day:number):string {
 const d=calendarDate(month.slice(0,7)+'-01');return monthISO(monthNumber(d),day);
}
export function recurringPaid(item:RecurringTransaction,transactions:readonly Transaction[],due:string):boolean {
 if(item.match_mode!=='bank')return !!(item.last_applied&&item.last_applied>=due)||transactions.some(tx=>isCashflow(tx)&&tx.recurringId===item.id&&tx.date===due);
 return transactions.some(tx=>isCashflow(tx)&&tx.recurringId===item.id&&tx.recurringMonth===due.slice(0,7)+'-01'&&tx.amount>0&&tx.bankEvent?.state!=='cancelled');
}

export function cashflowTotals(transactions: readonly Transaction[]): { income: number; expense: number; net: number } {
  let income = 0;
  let expense = 0;
  for (const tx of transactions) {
    if (!isCashflow(tx)) continue;
    const cents = toMinorUnits(tx.amount);
    if (tx.type === 'income') income += cents;
    else expense += cents;
  }
  return { income: fromMinorUnits(income), expense: fromMinorUnits(expense), net: fromMinorUnits(income - expense) };
}

/** Unknown/unassigned account transactions remain outside account balances. */
export function accountBalances(accounts: readonly Account[], transactions: readonly Transaction[]): Record<string, number> {
  const cents = new Map(accounts.map(account => [account.id, toMinorUnits(account.opening_balance)]));
  for (const tx of transactions) {
    const amount = toMinorUnits(tx.amount);
    if (tx.kind === 'transfer') {
      if (tx.accountId && cents.has(tx.accountId)) cents.set(tx.accountId, cents.get(tx.accountId)! - amount);
      if (tx.targetAccountId && cents.has(tx.targetAccountId)) cents.set(tx.targetAccountId, cents.get(tx.targetAccountId)! + amount);
    } else if (isCashflow(tx) && tx.accountId && cents.has(tx.accountId)) {
      cents.set(tx.accountId, cents.get(tx.accountId)! + (tx.type === 'income' ? amount : -amount));
    }
  }
  return Object.fromEntries([...cents].map(([id, amount]) => [id, fromMinorUnits(amount)]));
}

export function totalAccountBalance(accounts: readonly Account[], transactions: readonly Transaction[]): number {
  return sumMoney(Object.values(accountBalances(accounts, transactions)));
}

export function reservedGoals(goals: readonly SavingsGoal[]): number {
  // Completion does not release a reserve; funds are released by an explicit action.
  return sumMoney(goals.filter(goal => !goal.is_archived).map(goal => goal.current_amount));
}

export function availableBalance(accounts: readonly Account[], transactions: readonly Transaction[], goals: readonly SavingsGoal[]): number {
  return fromMinorUnits(toMinorUnits(totalAccountBalance(accounts, transactions)) - toMinorUnits(reservedGoals(goals)));
}

export interface SafeDailyCalculation {
  limit: number;
  spentToday: number;
  remaining: number;
  daysLeft: number;
  isOver: boolean;
  upcomingObligations: number;
}

/** available already excludes goal reserves and includes posted transactions. */
export function calculateSafeDaily(
  available: number,
  transactions: readonly Transaction[],
  recurring: readonly RecurringTransaction[],
  today = localDateISO(),
): SafeDailyCalculation {
  const date = calendarDate(today);
  const daysLeft = new Date(Date.UTC(date.year, date.month, 0)).getUTCDate() - date.day + 1;
  let spentToday = 0;
  for (const tx of transactions) {
    if (isCashflow(tx) && tx.type === 'expense' && tx.date === today) spentToday += toMinorUnits(tx.amount);
  }
  let obligations = 0;
  for (const item of recurring) {
    if (!item.is_active || item.type !== 'expense') continue;
    const due = monthISO(monthNumber(date), item.day_of_month);
    if (due < today || recurringPaid(item,transactions,due)) continue;
    obligations += toMinorUnits(item.amount);
  }
  // Restore today's consumption before allocating its share, then deduct it once.
  // Current balance has already deducted that consumption.
  const poolAtStartOfDay = Math.max(0, toMinorUnits(available) + spentToday - obligations);
  const limit = Math.floor(poolAtStartOfDay / daysLeft);
  return {
    limit: fromMinorUnits(limit),
    spentToday: fromMinorUnits(spentToday),
    remaining: fromMinorUnits(Math.max(0, limit - spentToday)),
    daysLeft,
    isOver: spentToday > limit,
    upcomingObligations: fromMinorUnits(obligations),
  };
}

export function goalMonthlyNeeded(goal: SavingsGoal, today = localDateISO()): number | null {
  const remaining = Math.max(0, toMinorUnits(goal.target_amount) - toMinorUnits(goal.current_amount));
  if (remaining === 0) return 0;
  if (!goal.deadline) return null;
  const now = calendarDate(today);
  const deadline = calendarDate(goal.deadline);
  if (goal.deadline < today) return null;
  // Round an incomplete calendar month up; even a deadline today needs funding.
  const months = Math.max(1, monthNumber(deadline) - monthNumber(now) + (deadline.day > now.day ? 1 : 0));
  return fromMinorUnits(Math.ceil(remaining / months));
}

export interface GoalForecast {
  monthlyContribution: number;
  months: number;
  date: string;
}

function contributionHistory(goal: SavingsGoal, transactions: readonly Transaction[], today: string): { monthlyCents: number; observationMonths: number } {
  const nowMonth = monthNumber(calendarDate(today));
  const ledger = transactions.filter(tx => tx.goalId === goal.id && tx.date <= today && (tx.kind === 'goal_deposit' || tx.kind === 'goal_release'));
  if (ledger.length === 0) return { monthlyCents: 0, observationMonths: 0 };
  const createdAt = new Date(goal.created_at);
  const createdDate = Number.isFinite(createdAt.getTime()) ? localDateISO(createdAt) : '';
  const firstLedgerDate = ledger.reduce((earliest, tx) => tx.date < earliest ? tx.date : earliest, ledger[0].date);
  const beginning = /^\d{4}-\d{2}-\d{2}$/.test(createdDate) && createdDate <= firstLedgerDate ? createdDate : firstLedgerDate;
  const firstMonth = Math.max(nowMonth - 2, monthNumber(calendarDate(beginning)));
  const observationMonths = nowMonth - firstMonth + 1;
  const start = monthISO(firstMonth);
  let net = 0;
  for (const tx of ledger) {
    if (tx.date >= start) net += (tx.kind === 'goal_deposit' ? 1 : -1) * toMinorUnits(tx.amount);
  }
  return { monthlyCents: Math.max(0, Math.floor(net / observationMonths)), observationMonths };
}

/** A forecast exists only when the goal has a positive observed contribution rate. */
export function goalForecast(goal: SavingsGoal, transactions: readonly Transaction[], today = localDateISO()): GoalForecast | null {
  const now = calendarDate(today);
  if (goal.is_archived) return null;
  const remaining = Math.max(0, toMinorUnits(goal.target_amount) - toMinorUnits(goal.current_amount));
  const { monthlyCents } = contributionHistory(goal, transactions, today);
  if (monthlyCents <= 0) return null;
  const months = Math.ceil(remaining / monthlyCents);
  return { monthlyContribution: fromMinorUnits(monthlyCents), months, date: monthISO(monthNumber(now) + months, now.day) };
}

export function goalFundingPlan(goal: SavingsGoal, transactions: readonly Transaction[], today = localDateISO()) {
  const forecast = goalForecast(goal, transactions, today);
  const history = contributionHistory(goal, transactions, today);
  return {
    remaining: fromMinorUnits(Math.max(0, toMinorUnits(goal.target_amount) - toMinorUnits(goal.current_amount))),
    monthlyNeeded: goalMonthlyNeeded(goal, today),
    monthlyContribution: fromMinorUnits(history.monthlyCents),
    months: forecast?.months ?? null,
    date: forecast?.date ?? null,
    isOverdue: Boolean(goal.deadline && goal.deadline < today && toMinorUnits(goal.current_amount) < toMinorUnits(goal.target_amount)),
    observationMonths: history.observationMonths,
  };
}

/** Only suggest recognizable old goal records; the user must confirm migration. */
export function legacyMigrationCandidates(transactions: readonly Transaction[]): Transaction[] {
  const deposit = /^Пополнение копилки: .+ \[goal_id:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\]$/i;
  const release = /^Закрытие копилки: .+$/;
  return transactions.filter(tx => isCashflow(tx) && tx.categoryId === 'savings' && (
    (tx.type === 'expense' && deposit.test(tx.comment)) || (tx.type === 'income' && release.test(tx.comment))
  ));
}
