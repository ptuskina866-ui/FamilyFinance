import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import { validateInput, moneyText, minskToday, PreviewError } from '../tools/prior-local/model.ts';
import { makePreview } from '../tools/prior-local/preview.ts';
import { fetchPreview } from '../tools/prior-local/bank.ts';
import { startLocalPreview } from '../tools/prior-local/server.ts';

const range = { from: minskToday(), to: minskToday() };
const input = () => ({ ...range, login: 'example-user', password: 'Example123!' });
const row = (extra = {}) => ({ transDate: `${range.to}T12:00:00+03:00`, transDetails: 'Shop', accountAmount: '-12.34', amount: '-4.99', transCurrIso: 'EUR', feeAmount: '0.00', ...extra });
function fixtures(rows = [row()]) {
  return {
    cards: [{ clientObject: { id: 1, currIso: 'BYN', cardMaskedNumber: '1234********5678', defaultSynonym: 'Основная', iban: 'PRIVATE_IBAN' }, balance: { available: '9999999999.99' } }],
    details: [{ id: 1, contract: { creditLimit: '1000.00', addrLineA: 'PRIVATE_ADDRESS', account: { transCardList: [{ transactionList: rows }] }, abortedContractList: [{ abortedTransactionList: [row({ accountAmount: null, amount: '30.00' })] }] } }],
  };
}
const json = body => new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });
function fakeBank({ salt = 'challenge', login = { access_token: 'BANK_SECRET_SESSION', userSession: 'BANK_SECRET_CONTEXT' }, rejectAt = '', rejectResponse = null, fixture = fixtures() } = {}) {
  const calls = [];
  const fetcher = async (url, options) => {
    const path = new URL(url).pathname.replace('/api3/api', '');
    calls.push({ path, ...options });
    if (path === rejectAt) return rejectResponse;
    if (path === '/Authorization/MobileToken') return json({ token_type: 'bearer', access_token: 'BANK_SECRET_INITIAL', client_secret: 'BANK_SECRET_CLIENT' });
    if (path === '/Authorization/GetSalt') return json({ success: true, result: salt === undefined ? {} : { salt } });
    if (path === '/Authorization/Login') return json({ success: true, result: login });
    if (path === '/Cards') return json({ result: fixture.cards });
    if (path === '/Cards/CardDesc') return json({ result: fixture.details });
    throw Error('Unexpected endpoint');
  };
  return { fetcher, calls };
}

test('local input is validated before a bank request, with no password truncation or date substitution', () => {
  assert.equal(validateInput({ ...input(), login: ' example-user ' }).login, 'example-user');
  assert.throws(() => validateInput({ ...input(), password: 'a'.repeat(17) }), { code: 'PASSWORD_UNSUPPORTED' });
  for (const change of [{ from: 'invalid' }, { from: '2026-02-30' }, { from: '2020-01-01' }, { to: '2099-01-01' }, { login: '' }, { password: '' }]) assert.throws(() => validateInput({ ...input(), ...change }));
  for (const value of ['1.001', NaN, Infinity, {}, '1e3']) assert.throws(() => moneyText(value));
  assert.equal(moneyText('-0.01'), '-0.01'); assert.equal(moneyText('9999999999.99'), '9999999999.99');
});

test('preview preserves account and foreign amounts, credit limit and unconfirmed rows separately', () => {
  const data = fixtures(); const result = makePreview(data.cards, data.details, input());
  const card = result.cards[0], history = card.records.find(record => record.source === 'history');
  assert.equal(card.available, '9999999999.99'); assert.equal(card.creditLimit, '1000.00');
  assert.equal(history.accountAmount, '-12.34'); assert.equal(history.operationAmount, '-4.99'); assert.equal(history.operationCurrency, 'EUR');
  assert.equal(card.records.find(record => record.source === 'additional').operationAmount, '30.00');
  assert.equal(card.maskedNumber, '•••• 5678');
  const serialized = JSON.stringify(result);
  for (const secret of ['PRIVATE_IBAN', 'PRIVATE_ADDRESS', 'example-user', 'Example123!', 'password', 'login']) assert.equal(serialized.includes(secret), false);
});

test('possible duplicates and out-of-period rows are marked, never silently removed or rounded', () => {
  const data = fixtures([row(), row(), row({ transDate: '2020-01-01' })]);
  const result = makePreview(data.cards, data.details, range).cards[0].records;
  assert.equal(result.length, 4); assert.equal(result.filter(record => record.possibleDuplicate).length, 2);
  assert.equal(result.filter(record => record.outsidePeriod).length, 1);
  data.details[0].contract.account.transCardList[0].transactionList[0].accountAmount = '0.001';
  assert.throws(() => makePreview(data.cards, data.details, range), { code: 'AMOUNT_INVALID' });
});

test('missing card details, malformed dates, unknown shapes and ambiguous card IDs fail visibly', () => {
  const data = fixtures();
  assert.throws(() => makePreview(data.cards, [], range), { code: 'FORMAT_CHANGED' });
  assert.throws(() => makePreview([...data.cards, ...data.cards], data.details, range), { code: 'FORMAT_CHANGED' });
  assert.throws(() => makePreview(data.cards, {}, range), { code: 'FORMAT_CHANGED' });
  assert.throws(() => makePreview(data.cards, fixtures([row({ transDate: 'not-a-date' })]).details, range));
  assert.throws(() => makePreview(data.cards, fixtures([row({ accountAmount: null })]).details, range), { code: 'AMOUNT_INVALID' });
  const missingHistory = fixtures(); missingHistory.details[0].contract.account = {};
  assert.throws(() => makePreview(data.cards, missingHistory.details, range), { code: 'FORMAT_CHANGED' });
});

test('bank requests use only the five observed read/auth endpoints, no redirects or plaintext password', async () => {
  const bank = fakeBank(), credentials = input();
  const result = await fetchPreview(credentials, new AbortController().signal, bank.fetcher);
  assert.deepEqual(bank.calls.map(call => call.path), ['/Authorization/MobileToken', '/Authorization/GetSalt', '/Authorization/Login', '/Cards', '/Cards/CardDesc']);
  assert.ok(bank.calls.every(call => call.redirect === 'error'));
  const wireLogin = JSON.parse(bank.calls[2].body);
  const first = createHash('sha512').update(credentials.password).digest('hex');
  assert.equal(wireLogin.password, createHash('sha512').update(first + 'challenge').digest('hex'));
  assert.equal(wireLogin.password2, Buffer.concat([createHash('sha512').update(credentials.password + 'challenge').digest(), Buffer.from('challenge')]).toString('base64'));
  assert.equal(JSON.stringify(bank.calls).includes(credentials.password), false);
  assert.equal(JSON.stringify(result).includes('BANK_SECRET_'), false);
  assert.equal(credentials.password, 'Example123!');
  const query = JSON.parse(bank.calls[4].body);
  assert.equal(query.dateFrom, range.from); assert.equal(query.dateToSpecified, true);
});

test('empty salt is supported, but invalid salt and extra confirmation never fabricate a session', async () => {
  const empty = fakeBank({ salt: '' });
  await fetchPreview(input(), new AbortController().signal, empty.fetcher);
  assert.equal(JSON.parse(empty.calls[2].body).password, createHash('sha512').update(input().password).digest('hex'));
  const invalid = fakeBank({ salt: 123 });
  await assert.rejects(fetchPreview(input(), new AbortController().signal, invalid.fetcher), { code: 'FORMAT_CHANGED' });
  assert.equal(invalid.calls.length, 2);
  const mfa = fakeBank({ login: { otpRequired: true } });
  await assert.rejects(fetchPreview(input(), new AbortController().signal, mfa.fetcher), { code: 'ADDITIONAL_CONFIRMATION' });
  assert.equal(mfa.calls.length, 3);
});

test('wrong credentials and denied sessions stop immediately without retry or upstream error leakage', async () => {
  const bank = fakeBank({ rejectAt: '/Authorization/Login', rejectResponse: json({ success: false, errorMessage: 'Неверный логин или пароль PRIVATE_SECRET' }) });
  await assert.rejects(fetchPreview(input(), new AbortController().signal, bank.fetcher), error => error.code === 'LOGIN_REJECTED' && !error.message.includes('PRIVATE_SECRET'));
  assert.equal(bank.calls.length, 3);
  const denied = fakeBank({ rejectAt: '/Cards', rejectResponse: new Response('PRIVATE_ERROR', { status: 403 }) });
  await assert.rejects(fetchPreview(input(), new AbortController().signal, denied.fetcher), { code: 'ACCESS_DENIED' });
  assert.equal(denied.calls.length, 4);
});

test('network errors, non-JSON responses and oversized payloads stop without exposing response bodies', async () => {
  await assert.rejects(fetchPreview(input(), new AbortController().signal, async () => { throw Error('PRIVATE_ERROR'); }), error => error.code === 'NETWORK_ERROR' && !error.message.includes('PRIVATE_ERROR'));
  for (const response of [new Response('<html>PRIVATE</html>'), new Response('x'.repeat(10_000_001), { headers: { 'Content-Type': 'application/json' } })]) {
    const bank = fakeBank({ rejectAt: '/Authorization/MobileToken', rejectResponse: response });
    await assert.rejects(fetchPreview(input(), new AbortController().signal, bank.fetcher));
    assert.equal(bank.calls.length, 1);
  }
});

async function setup(options = {}) {
  const local = await startLocalPreview({ port: 0, preview: async () => ({ ...range, cards: [], externalCards: 0, fetchedAt: 'test' }), ...options });
  const page = await fetch(`${local.origin}/`), html = await page.text();
  const token = html.match(/<script nonce="([A-Za-z0-9_-]{43})"/)[1];
  const headers = { Origin: local.origin, 'Content-Type': 'application/json', 'X-Finapp-Local': token };
  const post = (body = input(), overrides = {}) => fetch(`${local.origin}/api/preview`, { method: 'POST', headers: { ...headers, ...overrides }, body: JSON.stringify(body) });
  return { ...local, page, html, headers, post };
}

test('helper binds only loopback and serves a no-store CSP-restricted form with no third-party assets', async () => {
  const local = await setup();
  try {
    assert.equal(local.server.address().address, '127.0.0.1');
    assert.equal(local.page.headers.get('cache-control'), 'no-store');
    assert.match(local.page.headers.get('content-security-policy'), /connect-src 'self'/);
    assert.equal(local.page.headers.get('access-control-allow-origin'), null);
    assert.doesNotMatch(local.html, /src="https?:|href="https?:|localStorage|sessionStorage/);
    const response = await local.post(); assert.equal(response.status, 200);
  } finally { await local.close(); }
});

test('foreign origins, missing capability, wrong media types and DNS rebinding cannot reach bank', async () => {
  let calls = 0;
  const local = await setup({ preview: async () => { calls++; throw Error('must not be called'); } });
  try {
    for (const headers of [{ Origin: 'https://evil.example' }, { Origin: '' }, { 'X-Finapp-Local': '' }, { 'Content-Type': 'text/plain' }, { 'Sec-Fetch-Site': 'cross-site' }]) assert.equal((await local.post(input(), headers)).status, 403);
    const rebound = await new Promise((resolve, reject) => {
      const req = httpRequest(local.origin, { headers: { Host: 'evil.example' } }, response => { response.resume(); resolve(response.statusCode); }); req.on('error', reject); req.end();
    });
    assert.equal(rebound, 403); assert.equal(calls, 0);
  } finally { await local.close(); }
});

test('invalid input and oversized local body never start bank login', async () => {
  let calls = 0;
  const local = await setup({ preview: async () => { calls++; throw Error('must not be called'); } });
  try {
    assert.equal((await local.post({ ...input(), password: 'x'.repeat(17) })).status, 400);
    const large = await local.post({ ...input(), unused: 'x'.repeat(9000) });
    assert.equal(large.status, 413); assert.equal(calls, 0);
  } finally { await local.close(); }
});

test('concurrent and rapid repeated login attempts are stopped without automatic retry', async () => {
  let entered, release; let clock = 100_000, calls = 0;
  const started = new Promise(resolve => { entered = resolve; });
  const waiting = new Promise(resolve => { release = resolve; });
  const local = await setup({ now: () => clock, preview: async () => { calls++; entered(); await waiting; return { ...range, cards: [], externalCards: 0, fetchedAt: 'test' }; } });
  try {
    const first = local.post(); await started;
    assert.equal((await local.post()).status, 409);
    release(); assert.equal((await first).status, 200);
    assert.equal((await local.post()).status, 429); assert.equal(calls, 1);
    clock += 60_001; assert.equal((await local.post()).status, 200); assert.equal(calls, 2);
  } finally { release(); await local.close(); }
});

test('closing the browser request aborts the ongoing bank request', async () => {
  let entered, cancelled;
  const started = new Promise(resolve => { entered = resolve; });
  const aborted = new Promise(resolve => { cancelled = resolve; });
  const local = await setup({ preview: async (_input, signal) => { entered(); await new Promise((_resolve, reject) => signal.addEventListener('abort', () => { cancelled(); reject(new PreviewError('CANCELLED', 'Cancelled')); }, { once: true })); throw Error('Unreachable'); } });
  try {
    const controller = new AbortController();
    const pending = fetch(`${local.origin}/api/preview`, { method: 'POST', headers: local.headers, body: JSON.stringify(input()), signal: controller.signal }).catch(() => {});
    await started; controller.abort();
    await Promise.race([aborted, new Promise((_resolve, reject) => setTimeout(() => reject(Error('Abort not delivered')), 1000).unref())]);
    await pending;
  } finally { await local.close(); }
});
