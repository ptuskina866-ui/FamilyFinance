import assert from 'node:assert/strict';
import test from 'node:test';
import { createPriorConnectHandler, connectionResult } from '../supabase/functions/prior-connect/handler.ts';
const uid='11111111-1111-4111-8111-111111111111',origin='https://familyfinance.ptuskina866.workers.dev';
const config={url:'https://project.example',anonKey:'PUBLIC_TEST_KEY',serviceKey:'PRIVATE_TEST_KEY'};
const input=()=>({login:'synthetic-user',password:'Synthetic123!',from:'2026-10-13',to:'2026-10-19'});
const row={date:'2026-10-18',description:'Shop',accountAmount:'-12.34',operationAmount:'-4.99',operationCurrency:'EUR',fee:'0.10',source:'history',possibleDuplicate:true,outsidePeriod:false};
const fixture=()=>({from:'2026-10-13',to:'2026-10-19',fetchedAt:'2026-10-19T12:00:00Z',externalCards:0,session:'PRIVATE_SESSION',cards:[{id:'PRIVATE_BANK_ID',title:'Card',maskedNumber:'•••• 1234',currency:'BYN',available:'123.45',creditLimit:'100.00',records:[row]}]});
const response=body=>new Response(JSON.stringify(body),{headers:{'Content-Type':'application/json'}});
const req=(body=input(),headers={},method='POST')=>new Request('https://project.example/functions/v1/prior-connect',{method,headers:{Origin:origin,Authorization:'Bearer TEST_USER_JWT','Content-Type':'application/json',...headers},...(method==='POST'?{body:JSON.stringify(body)}:{})});
function harness({auth=200,claim=200,preview,releaseFails=false}={}){
  const calls=[];let bankCalls=0;
  const fetcher=async(url,options)=>{calls.push({url,options});if(url.endsWith('/auth/v1/user'))return new Response(JSON.stringify({id:uid,is_anonymous:false}),{status:auth});if(url.endsWith('/claim_prior_connection'))return new Response(claim===200?'null':'{"message":"PRIOR_CONNECTION_LIMIT PRIVATE_TEST_KEY"}',{status:claim});if(url.endsWith('/release_prior_connection')){if(releaseFails)throw Error('PRIVATE_TEST_KEY');return response(null);}throw Error('Unexpected upstream');};
  const handler=createPriorConnectHandler(config,{fetcher,preview:async(value,signal)=>{bankCalls++;return preview?await preview(value,signal):fixture();}});
  return {handler,calls,get bankCalls(){return bankCalls;}};
}
test('server rejects anonymous, foreign origins and wrong methods before any bank access',async()=>{
  const h=harness();
  assert.equal((await h.handler(req({}, {Origin:'https://evil.example'}))).status,403);
  assert.equal((await h.handler(req({}, {Authorization:''}))).status,401);
  assert.equal((await h.handler(req(undefined,{},'GET'))).status,405);
  assert.equal((await h.handler(req(undefined,{},'OPTIONS'))).status,204);
  assert.equal(h.calls.length,0);assert.equal(h.bankCalls,0);
  const expired=harness({auth:401});assert.equal((await expired.handler(req())).status,401);assert.equal(expired.bankCalls,0);
});
test('server validates bounded input before claiming a lease or starting bank login',async()=>{
  const h=harness();
  for(const value of [{...input(),password:'x'.repeat(17)},{...input(),from:'invalid'},{...input(),session:'private'},{...input(),login:''}])assert.equal((await h.handler(req(value))).status,400);
  assert.equal((await h.handler(req({...input(),login:'x'.repeat(9000)}))).status,413);
  assert.equal(h.bankCalls,0);assert.equal(h.calls.filter(c=>c.url.includes('/rpc/')).length,0);
});
test('JWT-verified owner and HMAC login claim protect bank call; exact whitelist omits credentials, raw ID and balance',async()=>{
  const h=harness(),r=await h.handler(req()),data=await r.json();
  assert.equal(r.status,200);assert.equal(r.headers.get('cache-control'),'no-store');assert.equal(r.headers.get('access-control-allow-origin'),origin);
  assert.equal(data.cards[0].card.records[0].accountAmount,'-12.34');assert.equal(data.cards[0].card.records[0].operationCurrency,'EUR');
  assert.doesNotMatch(JSON.stringify(data),/PRIVATE_|available|creditLimit|possibleDuplicate|outsidePeriod|Synthetic123/);
  assert.equal(h.bankCalls,1);assert.equal(h.calls.length,3);
  const claim=JSON.parse(h.calls[1].options.body);assert.equal(claim.p_owner,uid);assert.match(claim.p_login_key,/^[a-f0-9]{64}$/);
  assert.doesNotMatch(h.calls[1].options.body,/synthetic-user|Synthetic123/);
  assert.equal(JSON.parse(h.calls[2].options.body).p_attempt,claim.p_attempt);
  assert.equal(h.calls[0].options.headers.Authorization,'Bearer TEST_USER_JWT');assert.equal(h.calls[1].options.headers.Authorization,'Bearer PRIVATE_TEST_KEY');
});
test('rate limit denies bank calls and never reflects private RPC errors',async()=>{
  const h=harness({claim:400}),r=await h.handler(req());assert.equal(r.status,429);assert.equal(h.bankCalls,0);assert.doesNotMatch(await r.text(),/PRIVATE_TEST_KEY/);
});
test('failed/cancelled bank requests release lease without retry or leaking upstream secrets',async()=>{
  const captured=[];const h=harness({preview:async value=>{captured.push(value);throw Error('PRIVATE_BANK_SESSION Synthetic123!');}});
  const r=await h.handler(req());assert.equal(r.status,503);assert.equal(h.bankCalls,1);assert.equal(h.calls.length,3);assert.doesNotMatch(await r.text(),/PRIVATE_|Synthetic123/);
  assert.equal(captured[0].password,'');assert.equal(captured[0].login,'');
  const aborted=new AbortController(),c=harness({preview:async()=>{aborted.abort();return fixture();}});
  const request=new Request(req(),{signal:aborted.signal});assert.equal((await c.handler(request)).status,400);assert.equal(c.calls.length,3);
});
test('release failure leaves the expiring lease and never discards valid data or echoes errors',async()=>{
  const h=harness({releaseFails:true});assert.equal((await h.handler(req())).status,200);assert.equal(h.bankCalls,1);
  assert.throws(()=>connectionResult({...fixture(),cards:Array(21).fill(fixture().cards[0])}));
});
