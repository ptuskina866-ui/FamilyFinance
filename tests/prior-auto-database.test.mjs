import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';

test('automatic accounting: consent, household isolation, today, append-only occurrences, tombstones and atomic pauses',async t=>{
  const db=new PGlite();t.after(()=>db.close());let checks=0;
  const q=async(sql,params=[])=>(await db.query(sql,params)).rows;
  const equal=(a,b)=>{assert.deepEqual(a,b);checks++;};
  const fail=async(fn,re)=>{await assert.rejects(fn,re);checks++;};
  await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;CREATE SCHEMA auth;
    GRANT USAGE ON SCHEMA auth TO anon,authenticated;
    CREATE TABLE auth.users(id uuid PRIMARY KEY,raw_user_meta_data jsonb);
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    CREATE PUBLICATION supabase_realtime;
    CREATE SCHEMA vault;CREATE TABLE vault.secrets(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),secret text);
    CREATE VIEW vault.decrypted_secrets AS SELECT id,secret AS decrypted_secret FROM vault.secrets;
    CREATE FUNCTION vault.create_secret(new_secret text,new_name text DEFAULT NULL,new_description text DEFAULT NULL,new_key_id uuid DEFAULT NULL) RETURNS uuid LANGUAGE sql AS $$INSERT INTO vault.secrets(secret) VALUES(new_secret) RETURNING id$$;`);
  const schema=await fs.readFile(new URL('../supabase_schema.sql',import.meta.url),'utf8');
  const migration=await fs.readFile(new URL('../supabase/migrations/20261023202140_prior_automatic_accounting.sql',import.meta.url),'utf8');
  equal(schema.split('-- 18. Automatic Priorbank accounting (2026-10-23)')[1].split('-- 19. Priorbank live accounting')[0].trim(),migration.trim());
  await db.exec(schema);await db.exec(migration);await db.exec('GRANT SELECT,INSERT ON public.transactions TO authenticated;');
  const owner='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222',source='f'.repeat(64);
  await q(`INSERT INTO auth.users VALUES($1,'{"household_action":"create","household_name":"A"}'),($2,'{"household_action":"create","household_name":"B"}')`,[owner,other]);
  const auth=async id=>{await db.exec(`RESET ROLE;SET ROLE authenticated;SELECT set_config('request.jwt.claim.sub','${id}',false);`);};
  await auth(owner);await q(`SELECT initialize_finance('{}'::uuid[])`);const [{id:account}]=await q('SELECT id FROM accounts');
  await fail(()=>q('SELECT set_prior_automation(true,$1,$2)',[account,source]),/PRIOR_AUTO_SESSION/);
  await db.exec('RESET ROLE;SET ROLE service_role');
  const state=async(action,data={})=>(await q('SELECT prior_connection_state($1,$2,$3) v',[owner,action,data]))[0].v;
  let c=await state('status');
  c=await state('save',{revision:c.revision,session:{token:'TEST',client:'TEST',userSession:'TEST'},loginKey:'a'.repeat(64),preview:{cards:[{card:{sourceKey:source,currency:'BYN'}}]}});
  const connection=c.revision;
  await auth(owner);await q('SELECT set_prior_automation(true,$1,$2)',[account,source]);
  const [{household_id:h,revision,today,from}]=await q(`SELECT household_id,revision,(now() AT TIME ZONE 'Europe/Minsk')::date::text today,((now() AT TIME ZONE 'Europe/Minsk')::date-30)::text "from" FROM prior_automation`);
  await auth(other);equal((await q('SELECT * FROM prior_automation')).length,0);
  await fail(()=>q('SELECT set_prior_automation(true,$1,$2)',[account,source]),/PRIOR_AUTO_SESSION/);
  await fail(()=>q('UPDATE prior_automation SET enabled=false'),/permission denied/);
  const row=(description,amount='-12.34',day=today)=>({date:day,description,accountAmount:amount,operationAmount:amount,operationCurrency:'BYN',fee:null,source:'history'});
  const packet=rows=>({format:'finapp-prior',version:1,from,to:today,fetchedAt:new Date().toISOString(),card:{sourceKey:source,title:'Test',maskedNumber:'•••• 1234',currency:'BYN',records:rows}});
  const save=async(rows,rev=revision)=>{
    const categories=rows.map((r,index)=>({index,category:r.accountAmount?.startsWith('-')?'other':'income-other',transfer:r.description==='Own transfer'}));
    return (await q('SELECT complete_prior_auto_job($1,$2,$3,$4,$5) v',[owner,rev,connection,packet(rows),categories]))[0].v;
  };
  for(const role of ['anon','authenticated']){
    await db.exec('RESET ROLE;SET ROLE '+role);
    await fail(()=>save([row('Shop')]),/permission denied/);
    await fail(()=>q("SELECT claim_prior_auto_job($1)",['a'.repeat(64)]),/permission denied/);
  }
  await db.exec('RESET ROLE;SET ROLE service_role');
  let rows=[row('Shop'),row('Income','150.01')];
  equal(await save(rows),{imported:2,issue:null});equal(await save(rows),{imported:0,issue:null});
  rows.push(row('Shop'));equal(await save(rows),{imported:1,issue:null});
  // A new identical legitimate purchase is an extra occurrence, not a removed duplicate.
  await db.exec('RESET ROLE');equal((await q('SELECT sum(CASE WHEN type=\'expense\' THEN -amount ELSE amount END)::text v FROM transactions'))[0].v,'125.33');
  const [{id:deleted}]=await q("SELECT id FROM transactions WHERE comment='Shop' LIMIT 1");
  await auth(owner);await q('SELECT delete_finance_transaction($1)',[deleted]);
  await db.exec('RESET ROLE;SET ROLE service_role');equal(await save(rows),{imported:0,issue:null});
  const changed=structuredClone(rows);changed[0].accountAmount='-99.99';changed.push(row('Must roll back'));
  equal(await save(changed),{imported:0,issue:'history_changed'});
  await db.exec('RESET ROLE');equal((await q("SELECT count(*)::int n FROM transactions WHERE comment='Must roll back'"))[0].n,0);
  equal((await q('SELECT issue FROM prior_automation'))[0].issue,'history_changed');
  // A manual row of the same amount stays for review, without silently deleting either purchase.
  await auth(owner);await db.exec('RESET ROLE');await q(`INSERT INTO transactions(household_id,added_by,type,amount,category_id,comment,date,kind,account_id) VALUES($1,$2,'expense',10.01,'other','Manual',$3,'cashflow',$4)`,[h,owner,today,account]);
  await db.exec('RESET ROLE;SET ROLE service_role');rows.push(row('Maybe manual','-10.01'),row('Own transfer','200.00'));
  equal(await save(rows),{imported:0,issue:null});
  await auth(owner);equal((await q('SELECT reason FROM prior_automation_reviews ORDER BY reason')).map(r=>r.reason),['similar','transfer']);
  const [{event_key:key}]=await q("SELECT event_key FROM prior_automation_reviews WHERE reason='similar'");
  await q('SELECT ignore_prior_automation_review($1)',[key]);
  await auth(other);equal((await q('SELECT * FROM prior_automation_reviews')).length,0);
  await auth(owner);await q('SELECT set_prior_automation(false)');
  await db.exec('RESET ROLE;SET ROLE service_role');equal(await save([...rows,row('After disable')]),null);
  await auth(owner);await q('SELECT set_prior_automation(true,$1,$2)',[account,source]);
  await db.exec('RESET ROLE;SET ROLE service_role');equal(await save([...rows,row('Stale reply')]),null);
  await db.exec('RESET ROLE');const [{revision:currentRevision}]=await q('SELECT revision FROM public.prior_automation');await db.exec('SET ROLE service_role');
  // Additional bank lists have no verified status and never affect money.
  rows.push({...row('Unknown additional','100.00'),source:'additional',accountAmount:null});
  equal(await save(rows,currentRevision),{imported:0,issue:null});
  await db.exec('RESET ROLE');equal((await q('SELECT additional_count FROM prior_automation'))[0].additional_count,1);
  // A settled older row still present in the same response proves a repeated daily purchase is separate.
  const yesterday=new Date(today+'T00:00:00Z');yesterday.setUTCDate(yesterday.getUTCDate()-1);const old=yesterday.toISOString().slice(0,10);
  await q('UPDATE prior_automation SET started_on=$1',[old]);
  rows.push(row('Daily coffee','-7.77',old));
  await db.exec('SET ROLE service_role');equal(await save(rows,currentRevision),{imported:1,issue:null});
  rows.push(row('Daily coffee','-7.77'));equal(await save(rows,currentRevision),{imported:1,issue:null});
  equal(await save([...rows].reverse(),currentRevision),{imported:0,issue:null});
  const moved=structuredClone(rows);moved.find(r=>r.description==='Daily coffee'&&r.date===old).date=today;
  equal(await save(moved,currentRevision),{imported:0,issue:'history_changed'});
  await db.exec('RESET ROLE');const beforeFailure=(await q('SELECT count(*)::int n FROM transactions'))[0].n;
  await db.exec('SET ROLE service_role');
  await q('SELECT complete_prior_auto_job($1,$2,$3,NULL,\'[]\',\'network\')',[owner,currentRevision,connection]);
  await db.exec('RESET ROLE');equal((await q('SELECT issue,next_run_at>now()+interval \'14 minutes\' delayed FROM prior_automation'))[0],{issue:'network',delayed:true});
  equal((await q('SELECT count(*)::int n FROM transactions'))[0].n,beforeFailure);
  await db.exec('SET ROLE service_role');await state('expire',{revision:connection});
  await db.exec('RESET ROLE');equal((await q('SELECT enabled,issue FROM prior_automation'))[0],{enabled:true,issue:'reauth'});
  await db.exec('SET ROLE service_role');let expiredMeta=await state('status');
  await state('save',{revision:expiredMeta.revision,session:{token:'NEW',client:'NEW',userSession:'NEW'},loginKey:'a'.repeat(64),preview:{cards:[{card:{sourceKey:source,currency:'BYN'}}]}});
  await db.exec('RESET ROLE');equal((await q('SELECT enabled,issue FROM prior_automation'))[0],{enabled:true,issue:null});
  // Ticket is single use, unguessable and inaccessible to clients. Claiming is bounded.
  await db.exec('RESET ROLE');const ticket='e'.repeat(64);
  await q("INSERT INTO finance_private.prior_auto_tickets VALUES(encode(sha256(convert_to($1,'UTF8')),'hex'),now()+interval '1 minute')",[ticket]);
  await db.exec('SET ROLE service_role');equal((await q('SELECT claim_prior_auto_job($1) v',[ticket]))[0].v.length,1);
  equal((await q('SELECT claim_prior_auto_job($1) v',[ticket]))[0].v,null);
  await state('disconnect');await db.exec('RESET ROLE');equal((await q('SELECT enabled FROM prior_automation'))[0].enabled,false);
  await db.exec('RESET ROLE');equal((await q("SELECT count(*)::int n FROM pg_policies WHERE tablename IN ('prior_automation','prior_automation_reviews')"))[0].n,8);
  t.diagnostic(`${checks} automatic-accounting SQL assertions passed; native scheduler/Vault encryption require hosted checks`);
});
