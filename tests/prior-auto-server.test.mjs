import test from 'node:test';
import assert from 'node:assert/strict';
import {createPriorAutoHandler} from '../supabase/functions/prior-auto-sync/handler.ts';
import {PreviewError} from '../supabase/functions/_shared/prior/model.ts';
import {createHash} from 'node:crypto';
const source=createHash('sha256').update(JSON.stringify(['prior-card-v1','BANK_ID','BYN'])).digest('hex');
const response=body=>new Response(JSON.stringify(body),{headers:{'Content-Type':'application/json'}});
const request=ticket=>new Request('https://project.example/auto',{method:'POST',body:JSON.stringify({ticket})});
function harness({invalid=false,expired=false,voidStatus=204}={}){
  const calls=[];let bankCalls=0,used=false;
  const handler=createPriorAutoHandler({url:'https://project.example',serviceKey:'PRIVATE_KEY'},{
    fetcher:async(url,options)=>{const body=JSON.parse(options.body);calls.push({url,body});
      if(url.endsWith('/claim_prior_auto_job')){if(invalid||used)return response(null);used=true;return response([{owner_id:'OWNER',revision:'REVISION',source_key:source}]);}
      if(url.endsWith('/prior_connection_state'))return response({connected:true,revision:'CONNECTION',loginKey:'PRIVATE_LOGIN',session:{token:'PRIVATE_TOKEN',client:'PRIVATE_CLIENT',userSession:'PRIVATE_SESSION'}});
      if(url.endsWith('/claim_prior_connection')||url.endsWith('/release_prior_connection'))return new Response(null,{status:voidStatus});
      if(url.endsWith('/complete_prior_auto_job'))return response({imported:2});
      throw Error('Unexpected call');
    },readSession:async(session,range)=>{bankCalls++;assert.equal(session.token,'PRIVATE_TOKEN');if(expired)throw new PreviewError('SESSION_EXPIRED','PRIVATE_ERROR');
      const rows=[{description:'EUROOPT',accountAmount:'-12.34'},{description:'Зарплата Green',accountAmount:'150.01'}].map(r=>({...r,date:range.to,operationAmount:r.accountAmount,operationCurrency:'BYN',fee:null,source:'history'}));
      return {...range,fetchedAt:new Date().toISOString(),cards:[{id:'BANK_ID',title:'Test',maskedNumber:'•••• 1234',currency:'BYN',records:rows}],externalCards:0};
    }
  });return {handler,calls,get bankCalls(){return bankCalls;}};
}
test('scheduler denies absent/forged/replayed tickets before bank access and never returns secrets',async()=>{
  const h=harness({invalid:true});assert.equal((await h.handler(request('bad'))).status,401);assert.equal(h.calls.length,0);
  const denied=await h.handler(request('a'.repeat(64)));assert.equal(denied.status,401);assert.equal(h.bankCalls,0);
  const allowed=harness(),r=await allowed.handler(request('a'.repeat(64)));assert.equal(r.status,200);assert.deepEqual(await r.json(),{checked:1,imported:2});
  assert.equal((await allowed.handler(request('a'.repeat(64)))).status,401);assert.equal(allowed.bankCalls,1);
  const save=allowed.calls.find(c=>c.url.endsWith('/complete_prior_auto_job')).body;
  assert.equal(save.p_snapshot.to,new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Minsk'}).format(new Date()));
  assert.deepEqual(save.p_categories.map(r=>r.category),['food-euroopt','salary']);
  assert.doesNotMatch(JSON.stringify(save),/PRIVATE_|BANK_ID|password/);
  assert.ok(allowed.calls.some(c=>c.url.endsWith('/release_prior_connection')));
});
test('session expiration pauses jobs without a login attempt or ledger write',async()=>{
  const h=harness({expired:true}),r=await h.handler(request('b'.repeat(64)));
  assert.equal(r.status,200);assert.doesNotMatch(await r.text(),/PRIVATE_/);
  const saved=h.calls.find(c=>c.url.endsWith('/complete_prior_auto_job')).body;
  assert.equal(saved.p_issue,'reauth');assert.equal(saved.p_snapshot,undefined);
  assert.ok(h.calls.some(c=>c.body.p_action==='expire'));
  assert.ok(h.calls.some(c=>c.url.endsWith('/release_prior_connection')));
});
test('empty 200 lease responses also permit bank reads, commit and lease release',async()=>{
  const h=harness({voidStatus:200}),r=await h.handler(request('c'.repeat(64)));
  assert.deepEqual(await r.json(),{checked:1,imported:2});assert.equal(h.bankCalls,1);
  assert.ok(h.calls.some(c=>c.url.endsWith('/release_prior_connection')));
  assert.ok(!h.calls.some(c=>c.body.p_issue==='network'));
});
