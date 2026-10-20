import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

test('unconfigured bank endpoint handles preflight and fails closed without reading credentials', async () => {
  let handler;
  const source = readFileSync(new URL('../supabase/functions/alfa-sync/index.ts', import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText;
  vm.runInNewContext(compiled, { Deno: { serve: value => { handler = value; } }, Response });
  assert.equal(handler(new Request('https://example.test', { method: 'OPTIONS' })).status, 200);
  const request = { method: 'POST', json: () => { throw Error('Credentials must not be read.'); } };
  const response = handler(request);
  assert.equal(response.status, 503); assert.equal(response.headers.get('Cache-Control'), 'no-store');
  const body = await response.json();
  assert.equal(body.success, false); assert.equal(body.code, 'ALFA_CONNECTION_NOT_CONFIGURED');
  assert.equal(body.transactions, undefined); assert.equal(body.sessionToken, undefined);
  assert.equal(handler(new Request('https://example.test')).status, 405);
});

test('bank client never fabricates login success, accounts or transactions', async () => {
  const source = readFileSync(new URL('../src/services/alfaBankService.ts', import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS } }).outputText;
  const require = createRequire(import.meta.url), exports = {};
  vm.runInNewContext(compiled, { exports, require: name => {
    if (name === '../lib/bankConnection') return require(join(process.env.FINAPP_TEST_OUTPUT, 'lib/bankConnection.js'));
    if (name === '../lib/categories') return require(join(process.env.FINAPP_TEST_OUTPUT, 'lib/categories.js'));
    if (name.endsWith('?url')) return '/pdf-worker';
    throw Error(`Unexpected bank dependency: ${name}`);
  } });
  const client = exports.AlfaBankService;
  for (const result of [await client.requestLogin('+375291234567'), await client.verifyOtp('123456', '+375291234567', 'challenge')]) {
    assert.equal(result.success, false); assert.match(result.error, /импорт выписки/);
    assert.equal(result.transactions, undefined); assert.equal(result.account, undefined); assert.equal(result.sessionToken, undefined);
  }
});
