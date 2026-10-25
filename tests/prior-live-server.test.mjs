import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {makePreview} from '../supabase/functions/_shared/prior/preview.ts';
import {priorLiveSnapshot} from '../supabase/functions/_shared/prior/live.ts';
import {readRememberedPrior} from '../supabase/functions/_shared/prior/renewal.ts';
import {rememberedPrior} from '../supabase/functions/prior-connect/remembered.ts';
import {connectionResult} from '../supabase/functions/prior-connect/result.ts';
import {PreviewError,minskToday} from '../supabase/functions/_shared/prior/model.ts';
const today=minskToday(),range={from:today,to:today},source=createHash('sha256').update(JSON.stringify(['prior-card-v1','1','BYN'])).digest('hex');
const bankPreview=(records=[])=>({from:today,to:today,fetchedAt:new Date().toISOString(),externalCards:0,cards:[{id:'1',title:'Test',maskedNumber:'•••• 1234',currency:'BYN',available:'100.00',creditLimit:null,records}]});
const record=(extra={})=>({date:today+'T00:00:00+03:00',transTime:'12:34:56',description:'Retail Shop',accountAmount:null,operationAmount:'27.00',operationCurrency:'BYN',purchaseAmount:'27.00',fee:null,source:'additional',outsidePeriod:false,possibleDuplicate:false,...extra});
test('v2 uses authorization sign and account currency amount, keeps time/invoice and preserves legacy v1',()=>{
 const preview=bankPreview([record(),record({description:'Top-up',operationAmount:'-10.00',purchaseAmount:'-10.00'}),record({description:'FX',operationAmount:'12.34',purchaseAmount:'4.99',operationCurrency:'EUR'}),record({description:'Large',operationAmount:'-9999999999.99'}),record({source:'history',accountAmount:'-28.19',operationAmount:'-27.00'})]);
 const v2=priorLiveSnapshot(preview,source);
 assert.deepEqual(v2.records.map(r=>r.amount),['-27.00','10.00','-12.34','9999999999.99','-28.19']);
 assert.equal(v2.records[2].originalAmount,'4.99');assert.equal(v2.records[0].occurredAt,today+'T12:34:56+03:00');
 const old=JSON.parse(connectionResult(preview));assert.equal(old.version,1);assert.equal(old.cards[0].card.records[0].accountAmount,null);
 assert.ok(!JSON.stringify(old).includes('purchaseAmount'));assert.ok(!JSON.stringify(old).includes('transTime'));
 const two=priorLiveSnapshot(bankPreview([record(),record()]),source);assert.notEqual(two.records[0].key,two.records[1].key);
 const zero=priorLiveSnapshot(bankPreview([record({operationAmount:'0.00'})]),source);assert.equal(zero.records[0].state,'needs_review');
});
test('bad bank time fails before reconciliation and foreign missing purchase amount stays for review',()=>{
 const cards=[{clientObject:{id:1,currIso:'BYN',cardMaskedNumber:'•••• 1234',defaultSynonym:'Test'},balance:{available:100}}];
 const details=[{id:1,contract:{account:{transCardList:[{transactionList:[{transDate:today,transTime:'25:00:00',transDetails:'Shop',accountAmount:-1,amount:-1,transCurrIso:'BYN'}]}]},abortedContractList:[]}}];
 assert.throws(()=>makePreview(cards,details,range),{code:'FORMAT_CHANGED'});
 assert.equal(priorLiveSnapshot(bankPreview([record({operationCurrency:'EUR',purchaseAmount:null})]),source).records[0].state,'needs_review');
});
function renewalHarness({failure='SESSION_EXPIRED',loginFailure,disconnected=false}={}){
 const calls=[],passwordInputs=[];let reads=0,opens=0;
 const stored={revision:'OLD',loginKey:'HASH',autoReconnect:true,session:{token:'OLD_TOKEN',client:'CLIENT',userSession:'SESSION'},preview:{cards:[]}};
 const runtime={rpc:async(action,data={})=>{calls.push({action,data:structuredClone(data)});if(action==='reauth')return {credentials:{login:'Synthetic',password:'Test123!'}};if(action==='rotate'){if(disconnected)throw new PreviewError('CONNECTION_CHANGED','Changed');return {revision:'NEW',automationRevision:'NEW_AUTO'};}return {};},
 openSession:async input=>{opens++;passwordInputs.push(input);if(loginFailure)throw new PreviewError(loginFailure,'Synthetic failure');return {token:'NEW_TOKEN',client:'CLIENT',userSession:'SESSION'};},
 readSession:async()=>{reads++;if(reads===1)throw new PreviewError(failure,'Synthetic failure');return bankPreview();}};
 return {calls,stored,runtime,passwordInputs,get reads(){return reads;},get opens(){return opens;}};
}
test('explicit expiry renews once, persists new generation and reads once more without returning credentials',async()=>{
 const h=renewalHarness(),result=await readRememberedPrior(h.stored,range,'ATTEMPT',new AbortController().signal,h.runtime);
 assert.equal(h.reads,2);assert.equal(h.opens,1);assert.deepEqual(h.calls.map(c=>c.action),['reauth','rotate']);
 assert.equal(h.stored.revision,'NEW');assert.equal(h.stored.automationRevision,'NEW_AUTO');
 assert.equal(h.passwordInputs[0].password,'');assert.ok(!JSON.stringify(result).includes('Test123!'));
});
test('network/403 failures never initiate login; rejected credentials and MFA block automatic retries',async()=>{
 for(const failure of ['NETWORK_ERROR','ACCESS_DENIED','BANK_LIMIT']){
  const h=renewalHarness({failure});await assert.rejects(()=>readRememberedPrior(h.stored,range,'ATTEMPT',new AbortController().signal,h.runtime),{code:failure});assert.equal(h.opens,0);assert.equal(h.calls.length,0);
 }
 for(const loginFailure of ['LOGIN_REJECTED','BANK_BLOCKED','ADDITIONAL_CONFIRMATION']){
  const h=renewalHarness({loginFailure});await assert.rejects(()=>readRememberedPrior(h.stored,range,'ATTEMPT',new AbortController().signal,h.runtime),{code:loginFailure});assert.equal(h.opens,1);assert.equal(h.reads,1);assert.deepEqual(h.calls.map(c=>c.action),['reauth','auth_failed']);assert.equal(h.passwordInputs[0].password,'');
 }
});
test('disconnect during renewal invalidates the response before another bank read or financial result',async()=>{
 const h=renewalHarness({disconnected:true});await assert.rejects(()=>readRememberedPrior(h.stored,range,'ATTEMPT',new AbortController().signal,h.runtime),{code:'CONNECTION_CHANGED'});assert.equal(h.reads,1);
});
test('live refresh only queues the common worker and returns a v2 cache, without lease, login or private fields',async()=>{
 const calls=[],preview=JSON.parse(connectionResult(bankPreview()));
 const body=await rememberedPrior(new Request('https://example.test'),{action:'refresh',apiVersion:2},'OWNER',{
  serviceKey:'TEST_KEY',rpc:async(_name,args)=>{calls.push(args.p_action);return new Response(JSON.stringify(args.p_action==='load'?{connected:true,autoReconnect:true,liveEnabled:true,liveReady:true,preview,revision:'SECRET',session:{token:'PRIVATE_TOKEN'}}:{}));},
  openSession:async()=>{throw Error('No login expected');},readSession:async()=>{throw Error('No bank read expected');}});
 const result=JSON.parse(body);assert.equal(result.version,2);assert.deepEqual(result.live,{autoReconnect:true,enabled:true,ready:true});assert.deepEqual(calls,['load','request']);assert.ok(!/PRIVATE_|SECRET|password|session/.test(body));
});
