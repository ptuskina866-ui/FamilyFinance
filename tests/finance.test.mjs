import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import test from 'node:test';

const require = createRequire(import.meta.url);
const money = require(join(process.env.FINAPP_TEST_OUTPUT, 'lib/money.js'));
const finance = require(join(process.env.FINAPP_TEST_OUTPUT, 'lib/finance.js'));
const { toMinorUnits, fromMinorUnits, parseMoneyInput, sumMoney, localDateISO } = money;
const { accountBalances, cashflowTotals, totalAccountBalance, reservedGoals, availableBalance, calculateSafeDaily, goalMonthlyNeeded, goalForecast, legacyMigrationCandidates, isCashflow } = finance;

const account = (id, opening_balance = 0) => ({ id, household_id: 'family', name: id, kind: 'bank', currency: 'BYN', opening_balance, is_archived: false, created_at: '2026-01-01' });
const tx = (overrides = {}) => ({ id: 'tx', type: 'expense', amount: 10, categoryId: 'food', date: '2026-10-12', comment: '', addedBy: 'member', ...overrides });
const goal = (overrides = {}) => ({ id: 'goal', household_id: 'family', name: 'Отпуск', target_amount: 1000, current_amount: 200, emoji: '🏖️', deadline: '2027-02-12', is_completed: false, created_at: '2026-08-01', ...overrides });
const recurring = (overrides = {}) => ({ id: 'rent', household_id: 'family', added_by: 'member', type: 'expense', amount: 100, category_id: 'home', comment: '', day_of_month: 20, last_applied: null, is_active: true, created_at: '2026-01-01', ...overrides });

test('money sums decimals in cents without missing the goal threshold', () => {
  assert.equal(toMinorUnits(0.1) + toMinorUnits(0.7), 80);
  assert.equal(sumMoney([0.1, 0.7]), 0.8);
  assert.equal(sumMoney([1.11, -0.11]), 1);
  assert.equal(toMinorUnits('9999999999.99'), 999999999999);
  assert.equal(fromMinorUnits(-1), -0.01);
});

test('money rejects silent rounding, nonfinite values and oversized values', () => {
  for (const value of ['1.001', 0.1 + 0.7, Infinity, NaN, '1e2', '10000000000']) assert.throws(() => toMinorUnits(value), RangeError);
  assert.throws(() => fromMinorUnits(1.1), RangeError);
  assert.throws(() => sumMoney(['9999999999.99', 0.01]), RangeError);
});

test('money input accepts Russian decimal/grouping and rejects malformed input', () => {
  assert.equal(parseMoneyInput('1 234,56'), 1234.56);
  assert.equal(parseMoneyInput('1\u00a0234,56'), 1234.56);
  assert.equal(parseMoneyInput('-0,10'), -0.1);
  for (const value of ['', '1 2', '1,001', '1.2.3', 'Infinity', '1e2']) assert.equal(parseMoneyInput(value), null);
});

test('local financial date stays on the Minsk day around UTC midnight', () => {
  assert.equal(localDateISO(new Date('2026-10-11T22:30:00Z')), '2026-10-12');
  assert.equal(localDateISO(new Date('2026-10-12T20:59:59Z')), '2026-10-12');
});

test('a single transfer moves money between accounts and preserves capital', () => {
  const accounts = [account('bank', 100.1), account('cash', 0.7)];
  const transactions = [tx({ kind: 'transfer', accountId: 'bank', targetAccountId: 'cash', amount: 30.8 })];
  assert.deepEqual(accountBalances(accounts, transactions), { bank: 69.3, cash: 31.5 });
  assert.equal(totalAccountBalance(accounts, transactions), 100.8);
  assert.deepEqual(cashflowTotals(transactions), { income: 0, expense: 0, net: 0 });
});

test('reserves preserve account capital and are deducted exactly once from available', () => {
  const accounts = [account('bank', 100)];
  const transactions = [tx({ kind: 'goal_deposit', goalId: 'goal', accountId: 'bank', amount: 30 })];
  const goals = [goal({ current_amount: 30 }), goal({ id: 'done', current_amount: 10, is_completed: true }), goal({ id: 'archived', current_amount: 15, is_archived: true })];
  assert.equal(totalAccountBalance(accounts, transactions), 100);
  assert.equal(reservedGoals(goals), 40);
  assert.equal(availableBalance(accounts, transactions, goals), 60);
  assert.deepEqual(cashflowTotals(transactions), { income: 0, expense: 0, net: 0 });
});

test('unassigned legacy operations remain cashflow and do not fabricate an account', () => {
  const transactions = [tx({ type: 'income', amount: 100 }), tx({ amount: 25 })];
  assert.equal(isCashflow(transactions[0]), true);
  assert.deepEqual(cashflowTotals(transactions), { income: 100, expense: 25, net: 75 });
  assert.deepEqual(accountBalances([], transactions), {});
  assert.equal(totalAccountBalance([account('bank', 50)], transactions), 50);
});

test('safe daily has no fictitious minimum for zero or negative funds', () => {
  for (const balance of [0, -100]) {
    const result = calculateSafeDaily(balance, [], [], '2026-10-12');
    assert.equal(result.limit, 0);
    assert.equal(result.remaining, 0);
  }
});

test('safe daily reserves future bills and ignores inactive bills and future income', () => {
  const result = calculateSafeDaily(200, [], [recurring(), recurring({ id: 'inactive', is_active: false, amount: 900 }), recurring({ id: 'salary', type: 'income', amount: 1000 })], '2026-10-12');
  assert.equal(result.upcomingObligations, 100);
  assert.equal(result.daysLeft, 20);
  assert.equal(result.limit, 5);
});

test('safe daily does not count a posted obligation or today consumption twice', () => {
  const transactions = [tx({ amount: 10 })];
  const result = calculateSafeDaily(190, transactions, [recurring({ last_applied: '2026-10-20' })], '2026-10-12');
  assert.equal(result.upcomingObligations, 0);
  assert.equal(result.limit, 10);
  assert.equal(result.remaining, 0);
  const linked = calculateSafeDaily(200, [tx({ recurringId: 'rent', date: '2026-10-20', amount: 100 })], [recurring()], '2026-10-12');
  assert.equal(linked.upcomingObligations, 0);
});

test('a goal reserve is not daily consumption, and current-month overdue bills are not invented', () => {
  const result = calculateSafeDaily(100, [tx({ kind: 'goal_deposit', amount: 30 })], [recurring({ day_of_month: 1 })], '2026-10-12');
  assert.equal(result.spentToday, 0);
  assert.equal(result.upcomingObligations, 0);
  assert.equal(result.limit, 5);
});

test('goal monthly need handles no deadline, overdue deadlines and exact cents', () => {
  assert.equal(goalMonthlyNeeded(goal(), '2026-10-12'), 200);
  assert.equal(goalMonthlyNeeded(goal({ deadline: null }), '2026-10-12'), null);
  assert.equal(goalMonthlyNeeded(goal({ deadline: '2026-10-11' }), '2026-10-12'), null);
  assert.equal(goalMonthlyNeeded(goal({ deadline: '2026-10-12', target_amount: 0.8, current_amount: 0.1 }), '2026-10-12'), 0.7);
  assert.equal(goalMonthlyNeeded(goal({ current_amount: 1000 }), '2026-10-12'), 0);
});

test('goal forecast requires actual allocations instead of ordinary positive cashflow', () => {
  assert.equal(goalForecast(goal(), [tx({ type: 'income', amount: 5000 })], '2026-10-12'), null);
  assert.equal(goalForecast(goal(), [], '2026-10-12'), null);
});

test('goal forecast includes zero months and releases, excludes other goals/future contributions', () => {
  const transactions = [
    tx({ kind: 'goal_deposit', goalId: 'goal', date: '2026-08-10', amount: 600 }),
    tx({ kind: 'goal_release', goalId: 'goal', date: '2026-09-10', amount: 300 }),
    tx({ kind: 'goal_deposit', goalId: 'other', date: '2026-10-10', amount: 5000 }),
    tx({ kind: 'goal_deposit', goalId: 'goal', date: '2026-10-20', amount: 5000 }),
  ];
  assert.deepEqual(goalForecast(goal(), transactions, '2026-10-12'), { monthlyContribution: 100, months: 8, date: '2027-06-12' });
  assert.equal(goalForecast(goal({ is_archived: true }), transactions, '2026-10-12'), null);
});

test('forecast does not fabricate a positive contribution when releases cancel deposits', () => {
  const transactions = [tx({ kind: 'goal_deposit', goalId: 'goal', amount: 100 }), tx({ kind: 'goal_release', goalId: 'goal', amount: 100 })];
  assert.equal(goalForecast(goal(), transactions, '2026-10-12'), null);
});

test('forecast clamps the day when projecting into a shorter month', () => {
  const item = goal({ target_amount: 20, current_amount: 10, created_at: '2026-01-01' });
  const transactions = [tx({ kind: 'goal_deposit', goalId: 'goal', date: '2026-01-31', amount: 10 })];
  assert.equal(goalForecast(item, transactions, '2026-01-31').date, '2026-02-28');
});

test('forecast observation starts in the Minsk creation month around UTC month-end', () => {
  const item = goal({ target_amount: 300, current_amount: 100, created_at: '2026-10-31T22:30:00Z' });
  const transactions = [tx({ kind: 'goal_deposit', goalId: 'goal', date: '2026-11-01', amount: 100 })];
  assert.deepEqual(goalForecast(item, transactions, '2026-11-12'), { monthlyContribution: 100, months: 2, date: '2027-01-12' });
});

test('legacy migration only suggests recognizable goal records and never modifies them', () => {
  const transactions = [
    tx({ id: 'deposit', categoryId: 'savings', comment: 'Пополнение копилки: 🏖️ Отпуск [goal_id:12345678-1234-1234-1234-123456789abc]' }),
    tx({ id: 'release', type: 'income', categoryId: 'savings', comment: 'Закрытие копилки: 🏖️ Отпуск' }),
    tx({ id: 'manual', categoryId: 'savings', comment: 'Отложил на отпуск' }),
    tx({ id: 'wrong-category', comment: 'Закрытие копилки: 🏖️ Отпуск' }),
    tx({ id: 'already-migrated', kind: 'goal_release', type: 'income', categoryId: 'savings', comment: 'Закрытие копилки: 🏖️ Отпуск' }),
    tx({ id: 'invalid-id', categoryId: 'savings', comment: 'Пополнение копилки: 🏖️ Отпуск [goal_id:not-a-uuid]' }),
  ];
  const before = JSON.stringify(transactions);
  assert.deepEqual(legacyMigrationCandidates(transactions).map(item => item.id), ['deposit', 'release']);
  assert.equal(JSON.stringify(transactions), before);
});
