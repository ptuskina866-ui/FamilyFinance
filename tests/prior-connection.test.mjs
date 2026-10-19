import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import test from 'node:test';
const require=createRequire(import.meta.url);
const {priorConnectionUrl,readPriorBridgeMessage,PRIOR_LOCAL_ORIGIN}=require(join(process.env.FINAPP_TEST_OUTPUT,'lib/priorBridge.js'));
const {connectPriorLocal}=require(join(process.env.FINAPP_TEST_OUTPUT,'services/priorLocalService.js'));
const {parsePriorConnection,priorConnectionError}=require(join(process.env.FINAPP_TEST_OUTPUT,'lib/priorBankConnection.js'));
const origin='https://familyfinance.ptuskina866.workers.dev',token='a'.repeat(64);
const ready={type:'finapp-prior-ready',version:1,token};
const packet=()=>({format:'finapp-prior',version:1,from:'2026-10-13',to:'2026-10-18',fetchedAt:'2026-10-19T10:00:00Z',card:{sourceKey:'b'.repeat(64),title:'Card',maskedNumber:'•••• 1234',currency:'BYN',records:[{date:'2026-10-18',description:'Shop',accountAmount:'-12.34',operationAmount:'-4.99',operationCurrency:'EUR',fee:'0.10',source:'history'}]}});

test('connection URL restricts receivers to exact known origins and keeps the nonce out of the request',()=>{
  const url=new URL(priorConnectionUrl(origin,token));
  assert.equal(url.origin,PRIOR_LOCAL_ORIGIN);assert.equal(url.pathname,'/connect');assert.equal(url.search,'');
  assert.equal(new URLSearchParams(url.hash.slice(1)).get('token'),token);
  for(const value of ['https://evil.example',origin+'.evil.example',origin+'/',origin+'@evil.example','null','http://192.168.1.1:5173']) assert.throws(()=>priorConnectionUrl(value,token));
  assert.throws(()=>priorConnectionUrl(origin,'bad'));
});

test('bridge envelope rejects unknown fields, secrets, wrong versions/nonces and unbounded payloads',()=>{
  assert.deepEqual(readPriorBridgeMessage(ready,token),ready);
  for(const value of [null,[],{...ready,token:'b'.repeat(64)},{...ready,version:2},{...ready,password:'secret'},{...ready,type:'other'},{...ready,type:'finapp-prior-snapshot',snapshot:{}},{...ready,type:'finapp-prior-snapshot',snapshot:'x'.repeat(8_000_001)}]) assert.equal(readPriorBridgeMessage(value,token),null);
});

function harness(t,{blocked=false}={}){
  const listeners=new Set(),sent=[],errors=[],snapshots=[],timeouts=[],intervals=[];let url,closed=false,readyCount=0;
  const popup={get closed(){return closed;},close(){closed=true;},postMessage(data,target){sent.push({data,target});}};
  t.mock.method(globalThis,'setTimeout',(fn,delay)=>{timeouts.push({fn,delay});return timeouts.length;});t.mock.method(globalThis,'clearTimeout',()=>{});
  t.mock.method(globalThis,'setInterval',fn=>{intervals.push(fn);return intervals.length;});t.mock.method(globalThis,'clearInterval',()=>{});
  const old=globalThis.window;
  globalThis.window={location:{origin},addEventListener(_name,fn){listeners.add(fn);},removeEventListener(_name,fn){listeners.delete(fn);},open(value){url=new URL(value);return blocked?null:popup;}};
  t.after(()=>{if(old===undefined)delete globalThis.window;else globalThis.window=old;});
  const control=connectPriorLocal({onReady:()=>readyCount++,onSnapshot:value=>snapshots.push(value),onError:value=>errors.push(value)});
  const nonce=new URLSearchParams(url.hash.slice(1)).get('token');
  const emit=(data,extra={})=>{for(const fn of [...listeners])fn({origin:PRIOR_LOCAL_ORIGIN,source:popup,data:{...data,version:1,token:nonce},...extra});};
  return {control,popup,sent,errors,snapshots,emit,listeners,timeouts,intervals,get closed(){return closed;},get readyCount(){return readyCount;}};
}

test('only the opened helper can deliver reviewed data; one result is accepted and listeners are removed',t=>{
  const h=harness(t),data={type:'finapp-prior-snapshot',snapshot:JSON.stringify(packet())};
  h.emit(data);assert.equal(h.snapshots.length,0);
  h.emit({type:'finapp-prior-ready'},{origin:'https://evil.example'});
  h.emit({type:'finapp-prior-ready'},{source:{}});
  h.emit({...ready},{data:ready});assert.equal(h.readyCount,0);
  h.emit({type:'finapp-prior-ready'});h.emit({type:'finapp-prior-ready'});
  assert.equal(h.readyCount,1);assert.equal(h.sent[0].target,PRIOR_LOCAL_ORIGIN);
  h.emit(data);h.emit(data);
  assert.deepEqual(h.snapshots,[packet()]);assert.equal(h.listeners.size,0);
  assert.equal(h.sent.at(-1).data.type,'finapp-prior-received');assert.equal(h.closed,false);
});

test('cancelling rejects late data and closes the helper without touching financial records',t=>{
  const h=harness(t);h.control.cancel();h.emit({type:'finapp-prior-ready'});
  h.emit({type:'finapp-prior-snapshot',snapshot:JSON.stringify(packet())});
  assert.equal(h.closed,true);assert.equal(h.listeners.size,0);assert.equal(h.snapshots.length,0);assert.equal(h.errors.length,0);
});

test('malformed bank data never enters FinApp; popup blocking explains how to retry',t=>{
  const h=harness(t);h.emit({type:'finapp-prior-ready'});
  h.emit({type:'finapp-prior-snapshot',snapshot:JSON.stringify({...packet(),password:'secret'})});
  assert.equal(h.snapshots.length,0);assert.equal(h.errors.length,1);assert.equal(h.closed,true);
  const blocked=harness(t,{blocked:true});assert.equal(blocked.control,null);assert.equal(blocked.listeners.size,0);
  assert.match(blocked.errors[0],/всплывающее окно/);
});

test('missing helper, expired login and closed window end the exchange and reject late messages',t=>{
  const missing=harness(t);assert.equal(missing.timeouts[0].delay,30_000);missing.timeouts[0].fn();
  assert.match(missing.errors[0],/Помощник не ответил/);assert.equal(missing.listeners.size,0);
  const expired=harness(t);expired.emit({type:'finapp-prior-ready'});assert.equal(expired.timeouts.at(-1).delay,600_000);expired.timeouts.at(-1).fn();
  expired.emit({type:'finapp-prior-snapshot',snapshot:JSON.stringify(packet())});
  assert.equal(expired.snapshots.length,0);assert.match(expired.errors[0],/Время подключения истекло/);
  const closed=harness(t);closed.popup.close();closed.intervals[0]();
  assert.match(closed.errors[0],/Окно подключения закрыто/);assert.equal(closed.listeners.size,0);
});

test('server result strictly preserves original money and rejects extra secret fields',()=>{
  const result={format:'finapp-prior-connection',version:1,cards:[packet()],externalCards:0};
  assert.deepEqual(parsePriorConnection(result),{cards:[packet()],externalCards:0});
  for(const change of [v=>{v.session='secret';},v=>{v.cards[0].card.password='secret';},v=>{v.cards[0].card.records[0].accountAmount='1.001';},v=>{v.version=2;},v=>{v.externalCards=-1;},v=>{v.cards=Array(21).fill(packet());}]){
    const copy=structuredClone(result);change(copy);assert.throws(()=>parsePriorConnection(copy));
  }
  assert.match(priorConnectionError('COOLDOWN'),/две минуты/);
  assert.match(priorConnectionError('ADDITIONAL_CONFIRMATION'),/подтверждение/);
  assert.doesNotMatch(priorConnectionError('PRIVATE_SECRET'),/PRIVATE_SECRET/);
  assert.match(priorConnectionError(undefined,401),/Войдите/);
});
