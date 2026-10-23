import { randomUUID } from 'node:crypto';
import { readPriorSession, validatePriorSession } from '../_shared/prior/bank.ts';
import { minskToday, object, PreviewError } from '../_shared/prior/model.ts';
import { connectionResult } from '../prior-connect/result.ts';
import { recentPriorRange } from '../prior-connect/remembered.ts';
import { detectBankCategory } from '../../../src/lib/bankCategory.ts';

interface Config { url: string; serviceKey: string; }
interface Dependencies { fetcher?: typeof fetch; readSession?: typeof readPriorSession; }
/** Single-use server ticket authenticates the scheduler; no user JWT or bank password is retained. */
export function createPriorAutoHandler(config: Config, deps: Dependencies = {}) {
  const fetcher=deps.fetcher??fetch;
  return async (req: Request): Promise<Response> => {
    const reply=(status:number,body:object)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
    if(req.method!=='POST') return reply(405,{error:'METHOD'});
    if(!config.url||!config.serviceKey) return reply(503,{error:'UNAVAILABLE'});
    const rpc=async(name:string,body:Record<string,unknown>)=>{
      const response=await fetcher(config.url+'/rest/v1/rpc/'+name,{method:'POST',redirect:'error',signal:AbortSignal.timeout(18_000),
        headers:{apikey:config.serviceKey,Authorization:'Bearer '+config.serviceKey,'Content-Type':'application/json'},body:JSON.stringify(body)});
      if(!response.ok) throw new Error(name==='claim_prior_connection'&&(await response.text()).includes('PRIOR_CONNECTION_LIMIT')?'LEASE_BUSY':'RPC_FAILED');
      // PostgREST returns an empty body (including 204) for void lease RPCs.
      const bodyText=await response.text();
      return bodyText.trim()?JSON.parse(bodyText) as unknown:null;
    };
    try {
      if(!req.body) return reply(401,{error:'TICKET'});
      const reader=req.body.getReader();let size=0,raw='';const decoder=new TextDecoder();
      try {while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>256)return reply(413,{error:'SIZE'});raw+=decoder.decode(value,{stream:true});}raw+=decoder.decode();}
      finally {await reader.cancel().catch(()=>{});}
      const body=object(JSON.parse(raw) as unknown);raw='';
      if(Object.keys(body).length!==1||typeof body.ticket!=='string'||!/^[a-f0-9]{64}$/.test(body.ticket))return reply(401,{error:'TICKET'});
      const jobs=await rpc('claim_prior_auto_job',{p_ticket:body.ticket});body.ticket='';
      if(!Array.isArray(jobs))return reply(401,{error:'TICKET'});
      let imported=0;
      await Promise.all(jobs.map(async value=>{
        const job=object(value),owner=job.owner_id,attempt=randomUUID();let claimed=false,connection:Record<string,unknown>|null=null,stage='connection';
        const state=(action:string,data:Record<string,unknown>={})=>rpc('prior_connection_state',{p_owner:owner,p_action:action,p_data:data});
        const complete=(extra:Record<string,unknown>)=>rpc('complete_prior_auto_job',{p_owner:owner,p_revision:job.revision,p_connection_revision:connection?.revision,...extra});
        try {
          connection=object(await state('load'));
          if(connection.connected!==true)return;
          stage='lease';await rpc('claim_prior_connection',{p_owner:owner,p_login_key:connection.loginKey,p_attempt:attempt});claimed=true;
          const to=minskToday(),start=new Date(to+'T00:00:00Z');start.setUTCDate(start.getUTCDate()-30);
          stage='bank';const preview=await(deps.readSession??readPriorSession)(validatePriorSession(connection.session),{from:start.toISOString().slice(0,10),to},AbortSignal.timeout(90_000));
          const result=object(JSON.parse(connectionResult(preview)) as unknown);
          if(!Array.isArray(result.cards))throw new Error('FORMAT');
          const snapshot=result.cards.map(object).find(card=>object(card.card).sourceKey===job.source_key);
          if(!snapshot){await complete({p_issue:'account'});return;}
          const card=object(snapshot.card);
          if(!Array.isArray(card.records))throw new Error('FORMAT');
          const categories=card.records.map((v,index)=>{
            const row=object(v),description=String(row.description),category=detectBankCategory(description,String(row.accountAmount).startsWith('-')?'expense':'income');
            return {index,category,transfer:/между\s+(?:своими\s+)?сч[её]т|собственн.{0,25}сч[её]т|own\s+account/i.test(description)};
          });
          // The existing reviewed screen keeps its completed-day default and can reuse this cache.
          const range=recentPriorRange();
          const manualPreview={...result,cards:result.cards.map(value=>{
            const item=object(value),itemCard=object(item.card);
            return {...item,...range,card:{...itemCard,records:(itemCard.records as Record<string,unknown>[]).filter(row=>row.source==='additional'||(String(row.date).slice(0,10)>=range.from&&String(row.date).slice(0,10)<=range.to))}};
          })};
          stage='cache';await state('touch',{revision:connection.revision,preview:manualPreview});
          stage='import';
          const saved=await complete({p_snapshot:snapshot,p_categories:categories});
          if(saved&&typeof saved==='object'&&'imported' in saved)imported+=Number(saved.imported)||0;
        } catch(error) {
          if(connection){
            if(error instanceof Error&&error.message==='LEASE_BUSY'){try{await complete({p_issue:'busy'});}catch{/* Next scheduled attempt remains bounded. */}return;}
            const code=error instanceof PreviewError?error.code:'';
            const expired=['SESSION_EXPIRED','ACCESS_DENIED','LOGIN_REJECTED','BANK_BLOCKED'].includes(code);
            const issue=expired?'reauth':code==='BANK_LIMIT'?'bank_limit':['FORMAT_CHANGED','AMOUNT_INVALID','TOO_MANY_ROWS','RESPONSE_TOO_LARGE'].includes(code)?'format':'network';
            console.warn('prior_auto_failed',stage,issue); // Enum-only diagnostics; never the upstream error or payload.
            try {await complete({p_issue:issue});if(expired)await state('expire',{revision:connection.revision});}catch{/* No secrets or financial data in logs/responses. */}
          }
        } finally {
          if(connection)connection.session=null;
          if(claimed)try{await rpc('release_prior_connection',{p_owner:owner,p_attempt:attempt});}catch{/* Expiring lease. */}
        }
      }));
      return reply(200,{checked:jobs.length,imported});
    } catch{return reply(400,{error:'REQUEST_FAILED'});}
  };
}
