import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { createAuthLoadGuard } = require(join(process.env.FINAPP_TEST_OUTPUT, 'lib/authLoadGuard.js'));
const deferred = () => {
  let resolve;
  const promise = new Promise(complete => { resolve = complete; });
  return { promise, resolve };
};

test('late A profile cannot replace B after sign-out and another sign-in', async () => {
  const guard = createAuthLoadGuard();
  const response = deferred();
  const a = guard.begin('A');
  const writes = [];
  const pending = (async () => {
    const profile = await response.promise;
    if (guard.isCurrent(a)) writes.push(profile);
  })();
  guard.begin(null);
  const b = guard.begin('B');
  if (guard.isCurrent(b)) writes.push({ id: 'B' });
  response.resolve({ id: 'A' });
  await pending;
  assert.deepEqual(writes, [{ id: 'B' }]);
});

test('late initial getSession cannot overwrite a newer auth event', () => {
  const guard = createAuthLoadGuard();
  const initialSession = guard.snapshot();
  const current = guard.begin('B');
  assert.equal(guard.isCurrent(initialSession), false);
  assert.equal(guard.isCurrent(current), true);
});

test('newer same-user refresh invalidates a late household response', async () => {
  const guard = createAuthLoadGuard();
  const old = guard.begin('A');
  const response = deferred();
  const writes = [];
  const pending = (async () => {
    const household = await response.promise;
    if (guard.isCurrent(old)) writes.push(household);
  })();
  const current = guard.begin('A');
  writes.push({ id: 'new-household' });
  response.resolve({ id: 'old-household' });
  await pending;
  assert.equal(guard.isCurrent(current), true);
  assert.deepEqual(writes, [{ id: 'new-household' }]);
});

test('sign-out rejects outstanding profile updates and old loading timeouts', () => {
  const guard = createAuthLoadGuard();
  const pending = guard.begin('A');
  const signedOut = guard.begin(null);
  assert.equal(guard.isCurrent(pending), false);
  assert.equal(guard.isCurrent(signedOut), true);
  assert.equal(guard.userId, null);
});

test('cleanup and StrictMode reactivation never revive an old request', () => {
  const guard = createAuthLoadGuard();
  const pending = guard.begin('A');
  guard.invalidate();
  assert.equal(guard.isCurrent(pending), false);
  guard.activate();
  assert.equal(guard.isCurrent(pending), false);
  assert.equal(guard.isCurrent(guard.snapshot()), true);
});
