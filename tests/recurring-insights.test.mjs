import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import test from 'node:test';
const require = createRequire(import.meta.url);
const { discoverRecurringExpenses, recurringMerchantKey } = require(join(process.env.FINAPP_TEST_OUTPUT, 'lib/recurringInsights.js'));
const tx = (date, amount = 12.99, extra = {}) => ({ id: date, date, amount, comment: 'Music Service', accountId: 'card', type: 'expense', kind: 'cashflow', categoryId: 'subscriptions', addedBy: 'member', ...extra });
const history = (extra = {}) => ['2026-08-12', '2026-09-12', '2026-10-12'].map(date => tx(date, 12.99, extra));
const detect = (rows, recurring = [], today = '2026-10-16') => discoverRecurringExpenses(rows, recurring, today);

test('finds three monthly expenses with evidence, exact amounts and no input mutation', () => {
  const rows = history(); rows[2].amount = 13.09;
  const before = JSON.stringify(rows), result = detect(rows);
  assert.equal(result.length, 1); assert.equal(result[0].expectedDate, '2026-11-12');
  assert.equal(result[0].evidenceLevel, 'established');
  assert.equal(result[0].amountChange, 0.10); assert.equal(result[0].previousAmount, 12.99);
  assert.deepEqual(result[0].evidence.map(row => row.id), ['2026-10-12', '2026-09-12', '2026-08-12']);
  assert.equal(JSON.stringify(rows), before);
});
test('two adjacent months are explicitly preliminary; one month and frequent shopping are insufficient', () => {
  const result = detect(history().slice(1));
  assert.equal(result.length, 1); assert.equal(result[0].evidenceLevel, 'preliminary');
  assert.deepEqual(detect(history().slice(2)), []);
  assert.deepEqual(detect([tx('2026-07-12'), tx('2026-09-12')]), []);
  assert.deepEqual(detect([tx('2026-09-03'), tx('2026-10-12')]), []);
  assert.deepEqual(detect([...history(), tx('2026-09-20')]), []);
});
test('does not use income, transfers, savings movements, future or auto-posted rows as evidence', () => {
  for (const extra of [{ type: 'income' }, { kind: 'transfer' }, { kind: 'goal_deposit' }, { kind: 'goal_release' }, { recurringId: 'template' }]) {
    assert.deepEqual(detect(history(extra)), []);
  }
  assert.equal(detect([tx('2026-09-12'), tx('2026-10-12'), tx('2026-11-12')])[0].evidenceLevel, 'preliminary');
});
test('separates accounts, preserves branch numbers and normalizes punctuation only', () => {
  assert.equal(recurringMerchantKey('  MUSIC—SERVICE! '), 'music service');
  assert.notEqual(recurringMerchantKey('Связь 1'), recurringMerchantKey('Связь 2'));
  assert.equal(detect([...history(), ...history({ accountId: 'cash' }).map(row => ({ ...row, id: `cash-${row.id}` }))]).length, 2);
  const split = detect(history().map((row, i) => ({ ...row, accountId: i === 2 ? 'cash' : 'card' })));
  assert.equal(split.length, 1); assert.equal(split[0].accountId, 'card'); assert.equal(split[0].evidenceLevel, 'preliminary');
  for (const comment of ['', 'Еда', 'Оплата', '123456', 'Импорт выписки']) assert.deepEqual(detect(history({ comment })), []);
});
test('deduplicates repeated row IDs, but repeated payments with distinct IDs remain ambiguous', () => {
  assert.equal(detect([...history(), ...history()]).length, 1);
  assert.deepEqual(detect([...history(), tx('2026-09-12', 12.99, { id: 'another-payment' })]), []);
});
test('handles month ends, leap year and year boundary without skipping a billing month', () => {
  const end = [tx('2026-01-31'), tx('2026-02-28'), tx('2026-03-31')];
  assert.equal(detect(end, [], '2026-04-01')[0].expectedDate, '2026-04-30');
  assert.equal(detect([tx('2023-12-31'), tx('2024-01-31'), tx('2024-02-29')], [], '2024-03-01')[0].expectedDate, '2024-03-31');
  assert.equal(detect([tx('2026-10-12'), tx('2026-11-12'), tx('2026-12-12')], [], '2026-12-20')[0].expectedDate, '2027-01-12');
});
test('keeps a passed estimated date and drops stale patterns rather than inventing future payments', () => {
  const rows = [tx('2026-07-12'), tx('2026-08-12'), tx('2026-09-12')];
  assert.equal(detect(rows)[0].expectedDate, '2026-10-12');
  assert.deepEqual(detect(rows, [], '2026-11-01'), []);
});
test('marks an existing active template by merchant, never by category alone', () => {
  const template = { is_active: true, type: 'expense', comment: 'Music Service', account_id: 'card' };
  assert.equal(detect(history(), [template])[0].alreadyPlanned, true);
  assert.equal(detect(history(), [{ ...template, is_active: false }])[0].alreadyPlanned, false);
  assert.equal(detect(history(), [{ ...template, comment: 'Other Service' }])[0].alreadyPlanned, false);
  assert.equal(detect(history(), [{ ...template, account_id: 'other-card' }])[0].alreadyPlanned, false);
});
test('rejects invalid/unsupported money and dates without hiding valid patterns', () => {
  const bad = ['2026-08-32', 'bad', '2026-02-30'].map((date, i) => tx(date, 12.99, { id: `bad-${i}` }));
  for (const amount of [NaN, Infinity, -1, 0, 1.001]) assert.deepEqual(detect(history({ amount })), []);
  assert.equal(detect([...history(), ...bad]).length, 1);
  assert.throws(() => detect(history(), [], '2026-02-30'));
  const amounts = [9999999999.98, 9999999999.99, 9999999999.98];
  assert.equal(detect(history().map((row, i) => ({ ...row, amount: amounts[i] })))[0].amountChange, -0.01);
});
test('result is deterministic for ledger order and analysis has no future dependence', () => {
  assert.deepEqual(detect(history()), detect(history().reverse()));
  assert.deepEqual(detect([...history(), tx('2026-12-12')]), detect(history()));
});
