import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import test from 'node:test';
const require = createRequire(import.meta.url);
const { parsePriorImportFile, priorBlockedReason, priorPossibleDuplicates, priorImportError } = require(join(process.env.FINAPP_TEST_OUTPUT, 'lib/priorImport.js'));
const today = '2026-10-19';
const row = (extra = {}) => ({ date:'2026-10-18T12:00:00+03:00', description:'Shop', accountAmount:'-12.34', operationAmount:'-4.99', operationCurrency:'EUR', fee:'0.10', source:'history', ...extra });
const packet = (rows = [row()]) => ({ format:'finapp-prior', version:1, from:'2026-10-13', to:today, fetchedAt:`${today}T12:00:00Z`, card:{ sourceKey:'a'.repeat(64), title:'Test', maskedNumber:'•••• 1234', currency:'BYN', records:rows } });
test('Prior snapshot preserves signed account amount, original foreign amount, fee and repeated real rows', () => {
  const value = packet([row(),row(),row({source:'additional',accountAmount:null})]);
  assert.deepEqual(parsePriorImportFile(JSON.stringify(value),today),value);
  assert.equal(priorBlockedReason(value,value.card.records[0],today),null);
});
test('Prior snapshot rejects secrets, malformed money, shape, oversized and impossible dates without rounding', () => {
  const changes = [s=>{s.login='secret';},s=>{s.card.password='secret';},s=>{s.card.records[0].session='secret';},s=>{s.card.records[0].accountAmount='1.001';},s=>{s.card.records[0].accountAmount=12.34;},s=>{s.card.records[0].date='2026-02-30';},s=>{s.from='2026-01-01';},s=>{s.card.sourceKey='bad';},s=>{s.card.records[0].accountAmount=null;},s=>{s.card.records[0].operationCurrency='?';},s=>{s.card.records[0].fee='10000000000.00';}];
  for (const change of changes) {const value=packet();change(value);assert.throws(()=>parsePriorImportFile(JSON.stringify(value),today));}
  assert.throws(()=>parsePriorImportFile('x'.repeat(8_000_001),today));
});
test('Prior import blocks current day, extra list, outside period, zero and foreign accounts', () => {
  const value=packet();
  for(const change of [{source:'additional'},{date:today},{date:'2026-10-01'},{accountAmount:'0.00'}]) assert.ok(priorBlockedReason(value,row(change),today));
  value.card.currency='EUR';assert.ok(priorBlockedReason(value,row(),today));
  value.card.currency='BYN';value.fetchedAt='2026-10-18T12:00:00Z';assert.ok(priorBlockedReason(value,row(),today));
});
test('possible duplicate warnings retain same-day same-amount purchases and use the selected account', () => {
  const value=packet([row(),row({description:'Another shop'}),row({accountAmount:'50.00'})]);
  const tx={id:'tx',kind:'cashflow',type:'income',amount:50,date:'2026-10-18',accountId:'a',categoryId:'other',addedBy:'member',comment:''};
  assert.deepEqual([...priorPossibleDuplicates(value,[tx],'a')].sort(),[0,1,2]);
  assert.deepEqual([...priorPossibleDuplicates(value,[tx],'b')].sort(),[0,1]);
  assert.deepEqual([...priorPossibleDuplicates(value,[{...tx,kind:'transfer'}],'a')].sort(),[0,1]);
});
test('Prior server failures explain changed history, bindings and recoverable retry without raw backend details', () => {
  for(const code of ['PRIOR_DAY_CHANGED','PRIOR_SOURCE_BOUND','PRIOR_ACCOUNT_BOUND','PRIOR_CONFIRM_EXISTING','PGRST202','PRIOR_FORMAT','private backend message']) {
    const output=priorImportError(code);assert.ok(output.length>30);assert.equal(output.includes(code),false);
  }
});
