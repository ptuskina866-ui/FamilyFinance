import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {makePreview} from '../supabase/functions/_shared/prior/preview.ts';
import {priorLiveSnapshot} from '../supabase/functions/_shared/prior/live.ts';
import {minskToday} from '../supabase/functions/_shared/prior/model.ts';

test('Prior v2: shadow, authorizations, settlement, occurrences, cancellation, tombstones, receipts and RLS',async t=>{
 const db=new PGlite();t.after(()=>db.close());let checks=0;
 const q=async(sql,p=[])=>(await db.query(sql,p)).rows;
 const eq=(a,b)=>{assert.deepEqual(a,b);checks++;};
 await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;CREATE SCHEMA auth;
 GRANT USAGE ON SCHEMA auth TO anon,authenticated;
 CREATE TABLE auth.users(id uuid PRIMARY KEY,raw_user_meta_data jsonb);
 CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 CREATE PUBLICATION supabase_realtime;CREATE SCHEMA vault;CREATE TABLE vault.secrets(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),secret text);
 CREATE VIEW vault.decrypted_secrets AS SELECT id,secret AS decrypted_secret FROM vault.secrets;
 CREATE FUNCTION vault.create_secret(new_secret text,new_name text DEFAULT NULL,new_description text DEFAULT NULL) RETURNS uuid LANGUAGE sql AS $$INSERT INTO vault.secrets(secret) VALUES(new_secret) RETURNING id$$;`);
 await db.exec(await fs.readFile(new URL('../supabase_schema.sql',import.meta.url),'utf8'));
 const migration=await fs.readFile(new URL('../supabase/migrations/20261025153840_prior_live_accounting.sql',import.meta.url),'utf8');
 eq((await fs.readFile(new URL('../supabase_schema.sql',import.meta.url),'utf8')).split('-- 19. Priorbank live accounting (2026-10-25)')[1].split('-- 20. Merchant rules')[0].trim(),migration.trim());
 await db.exec(migration);await db.exec(migration);
 const owner='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222';
 await q(`INSERT INTO auth.users VALUES($1,'{"household_action":"create","household_name":"A"}'),($2,'{"household_action":"create","household_name":"B"}')`,[owner,other]);
 const auth=async id=>db.exec(`RESET ROLE;SET ROLE authenticated;SELECT set_config('request.jwt.claim.sub','${id}',false);`);
 await auth(owner);await q(`SELECT initialize_finance('{}'::uuid[])`);const [{id:account,household_id:h}]=await q('SELECT id,household_id FROM accounts');
 const source=createHash('sha256').update(JSON.stringify(['prior-card-v1','1','BYN'])).digest('hex'),today=minskToday();
 const from=new Date(today+'T00:00:00Z');from.setUTCDate(from.getUTCDate()-30);const range={from:from.toISOString().slice(0,10),to:today};
 await db.exec('RESET ROLE;SET ROLE service_role');
 const state=async(action,data={})=>(await q('SELECT prior_connection_state($1,$2,$3) v',[owner,action,data]))[0].v;
 let c=await state('status');c=await state('save',{revision:c.revision,session:{token:'TEST',client:'TEST',userSession:'TEST'},loginKey:'a'.repeat(64),preview:{cards:[{card:{sourceKey:source,currency:'BYN'}}]}});
 await auth(owner);await q('SELECT set_prior_automation(true,$1,$2)',[account,source]);
 await q('SELECT set_prior_live(true)');eq((await q('SELECT live_enabled,live_requested FROM prior_automation'))[0],{live_enabled:false,live_requested:true});
 await db.exec('RESET ROLE;SET ROLE service_role');
 const packet=rows=>priorLiveSnapshot(makePreview([{clientObject:{id:1,currIso:'BYN',cardMaskedNumber:'•••• 1234',defaultSynonym:'Test'},balance:{available:500}}],[{id:1,contract:{account:{transCardList:[{transactionList:rows.filter(r=>r.source==='history').map(r=>r.wire)}]},abortedContractList:[{abortedTransactionList:rows.filter(r=>r.source==='additional').map(r=>r.wire)}]}}],range),source);
 const row=(description,amount,time,source='additional')=>({source,wire:{transDate:today+'T00:00:00+03:00',transTime:time,transDetails:description,accountAmount:source==='history'?amount:null,amount:source==='history'?amount:String(-Number(amount)),transAmount:amount,transCurrIso:'BYN',feeAmount:0}});
 let rows=[row('Shop','-27.00','12:00:01'),row('Top-up','10.00','12:00:02')];
 const save=async(snapshot=packet(rows),shadow=false,rev)=>{await db.exec('RESET ROLE');const a=(await q('SELECT revision FROM public.prior_automation WHERE owner_id=$1',[owner]))[0];await db.exec('SET ROLE service_role');const c=(await state('load'));return (await q('SELECT complete_prior_live_job($1,$2,$3,$4,$5) v',[owner,rev??a.revision,c.revision,snapshot,shadow]))[0].v;};
 eq(await save(undefined,true),{imported:0,shadow:true});await db.exec('RESET ROLE');eq((await q('SELECT count(*)::int n FROM public.transactions'))[0].n,0);
 await auth(owner);eq((await q('SELECT live_enabled FROM prior_automation'))[0].live_enabled,true);await db.exec('RESET ROLE;SET ROLE service_role');
 eq((await save()).imported,2);eq((await save()).imported,0);
 await db.exec('RESET ROLE');eq((await q("SELECT sum(CASE WHEN type='income' THEN amount ELSE -amount END)::text n FROM transactions"))[0].n,'-17.00');
 const [{id:shop}]=await q("SELECT id FROM transactions WHERE comment='Shop'");
 await q("UPDATE transactions SET category_id='cafes',comment='My note' WHERE id=$1",[shop]);
 rows=[row('Shop','-27.00','12:00:01','history'),row('Top-up','10.00','12:00:02','history')];await db.exec('SET ROLE service_role');
 eq((await save()).imported,0);await db.exec('RESET ROLE');eq((await q('SELECT id,category_id,comment FROM transactions WHERE id=$1',[shop]))[0],{id:shop,category_id:'cafes',comment:'My note'});
 eq((await q("SELECT count(*)::int n FROM prior_bank_events WHERE state='posted'"))[0].n,2);
 // Changed amount with the same precise operation identity updates one ledger row and records history.
 rows[0]=row('Shop','-28.19','12:00:01','history');await db.exec('SET ROLE service_role');eq((await save()).imported,0);
 await db.exec('RESET ROLE');eq((await q('SELECT amount::text n FROM transactions WHERE id=$1',[shop]))[0].n,'28.19');eq((await q('SELECT jsonb_array_length(history)::int n FROM prior_bank_events WHERE transaction_id=$1',[shop]))[0].n>0,true);
 // Existing automatic rows gain a metadata link only; another real same-price purchase
 // must not be suppressed by that unlinked old ledger entry.
 await q("INSERT INTO transactions(household_id,account_id,added_by,type,amount,category_id,comment,date,kind,import_origin) VALUES($1,$2,$3,'expense',6.66,'other','Legacy shop',$4,'cashflow','prior-auto')",[h,account,owner,today]);
 const [{k:legacyKey}]=await q("SELECT encode(sha256(convert_to(jsonb_build_array($1::text,'Legacy shop',(-6.66)::numeric,(-6.66)::numeric,'BYN',(0.00)::numeric)::text,'UTF8')),'hex')||':1' k",[today+'T00:00:00+03:00']);
 await q('UPDATE prior_import_days SET imported_keys=array_append(imported_keys,$1) WHERE household_id=$2 AND day=$3',[legacyKey,h,today]);
 rows.push(row('Legacy shop','-6.66','11:11:01','history'),row('Legacy shop','-6.66','11:11:02','history'));
 await db.exec('SET ROLE service_role');eq((await save()).imported,1);eq((await save()).imported,0);
 await db.exec('RESET ROLE');eq((await q("SELECT count(*)::int n FROM transactions WHERE comment='Legacy shop'"))[0].n,2);
 // Two genuinely identical authorizations are two occurrences, not one.
 rows.push(row('Coffee','-5.00','13:00:00'),row('Coffee','-5.00','13:00:00'));await db.exec('SET ROLE service_role');eq((await save()).imported,2);eq((await save()).imported,0);
 // Disappearance is not cancellation.
 rows=rows.slice(0,2);eq((await save()).imported,0);await db.exec('RESET ROLE');eq((await q("SELECT count(*)::int n FROM transactions WHERE comment='Coffee'"))[0].n,2);
 // Explicit, identity-linked cancellation has zero effect; nothing is inferred from an absent row.
 let cancel=packet(rows);cancel.records[0].state='cancelled';await db.exec('SET ROLE service_role');eq((await save(cancel)).imported,0);
 await db.exec('RESET ROLE');eq((await q('SELECT amount::text n FROM transactions WHERE id=$1',[shop]))[0].n,'0.00');
 // A labelled reversal of a uniquely matching purchase cancels that event; a second sync
 // including the original posting must not reactivate it or create a separate refund.
 rows.push(row('Retail Test shop','-8.25','16:00:00'));await db.exec('SET ROLE service_role');eq((await save()).imported,1);
 rows.push(row('Reversal. Retail Test shop','8.25','16:01:00','history'));eq((await save()).imported,0);eq((await save()).imported,0);
 await db.exec('RESET ROLE');eq((await q("SELECT t.amount::text n,e.state FROM transactions t JOIN prior_bank_events e ON e.transaction_id=t.id WHERE e.description='Retail Test shop'"))[0],{n:'0.00',state:'cancelled'});
 // Deleting a row keeps an immutable tombstone; a later sync does not resurrect it.
 await q('DELETE FROM transactions WHERE id=$1',[shop]);eq((await q('SELECT count(*)::int n FROM transactions WHERE id=$1',[shop]))[0].n,0);await db.exec('SET ROLE service_role');eq((await save(cancel)).imported,0);
 // A manually entered expense is held for review rather than charged twice.
 await db.exec('RESET ROLE');await q("INSERT INTO transactions(household_id,account_id,type,amount,category_id,comment,date,kind) VALUES($1,$2,'expense',19.99,'other','Manual',$3,'cashflow')",[h,account,today]);
 rows.push(row('Manual match','-19.99','14:00:00'));await db.exec('SET ROLE service_role');eq((await save()).imported,0);
 await db.exec('RESET ROLE');eq((await q("SELECT reason FROM prior_bank_events WHERE description='Manual match'"))[0].reason,'similar');
 // Unknown foreign purchase amount and zero data never become guessed cashflow.
 rows.push(row('FX','-11.00','15:00:00'));rows.at(-1).wire.transCurrIso='EUR';delete rows.at(-1).wire.transAmount;
 await db.exec('SET ROLE service_role');eq((await save()).imported,0);
 // An explicit resolution is owner-scoped and checks the exact observed amount/state.
 await auth(owner);const [manualEvent]=await q("SELECT id,bank_amount,observed_state FROM prior_bank_events WHERE description='Manual match'");
 await assert.rejects(()=>q('SELECT resolve_prior_event($1,\'apply\',999,$2)',[manualEvent.id,manualEvent.observed_state]),/PRIOR_REVIEW_CHANGED/);checks++;
 await q("SELECT resolve_prior_event($1,'ignore',$2,$3)",[manualEvent.id,manualEvent.bank_amount,manualEvent.observed_state]);
 // Actual bank corrections can reveal a deficit; they never rewrite a user's reserves.
 rows.push(row('Incoming','100.00','17:00:00'));await db.exec('RESET ROLE;SET ROLE service_role');eq((await save()).imported,1);
 await db.exec('RESET ROLE');const [{capital}]=await q('SELECT finance_capital($1)::text capital',[h]);
 await q("INSERT INTO savings_goals(household_id,name,target_amount,current_amount) VALUES($1,'Reserve',1000,$2)",[h,capital]);
 const corrected=packet(rows);corrected.records.find(r=>r.description==='Incoming').state='cancelled';await db.exec('SET ROLE service_role');eq((await save(corrected)).imported,0);
 await db.exec('RESET ROLE');eq((await q("SELECT current_amount::text n FROM savings_goals WHERE name='Reserve'"))[0].n,capital);
 eq((await q('SELECT (finance_capital($1)-finance_reserved($1))::text n',[h]))[0].n,'-100.00');
 const oldSnapshot=packet(rows);oldSnapshot.fetchedAt=new Date(Date.now()-60_000).toISOString();await db.exec('SET ROLE service_role');eq((await save(oldSnapshot)).stale,true);
 await auth(other);eq((await q('SELECT * FROM prior_bank_events')).length,0);
 await assert.rejects(()=>q('SELECT complete_prior_live_job($1,$2,$3,$4,false)',[owner,c.revision,c.revision,packet(rows)]),/permission denied/);checks++;
 await auth(owner);await assert.rejects(()=>q("UPDATE prior_bank_events SET bank_amount=1"),/permission denied/);checks++;
 await db.exec('RESET ROLE');const [{revision}]=await q('SELECT revision FROM prior_automation');
 await auth(owner);await q('SELECT set_prior_automation(false)');await db.exec('RESET ROLE;SET ROLE service_role');eq(await save(undefined,false,revision),null);
 await db.exec('RESET ROLE');eq((await q('SELECT bool_and(array_length(imported_keys,1)>0) b FROM prior_import_days'))[0].b,true);
 // Credentials are obtainable only for one renewal under an existing lease; disconnect erases both secrets.
 await db.exec('SET ROLE service_role');c=await state('load');
 c=await state('save_auto',{revision:c.revision,session:{token:'NEW',client:'TEST',userSession:'TEST'},loginKey:'a'.repeat(64),preview:{cards:[{card:{sourceKey:source,currency:'BYN'}}]},credentials:{login:'Synthetic',password:'Test123!'}});
 eq(c.autoReconnect,true);const loaded=await state('load');eq(JSON.stringify(loaded).includes('Test123!'),false);
 const attempt='33333333-3333-4333-8333-333333333333';
 await assert.rejects(()=>state('reauth',{revision:c.revision,attempt}),/PRIOR_CONNECTION_CHANGED/);checks++;
 await q('SELECT claim_prior_connection($1,$2,$3)',[owner,'a'.repeat(64),attempt]);
 eq((await state('reauth',{revision:c.revision,attempt})).credentials,{login:'Synthetic',password:'Test123!'});
 eq(await state('reauth',{revision:c.revision,attempt}),{});
 await state('disconnect');await db.exec('RESET ROLE');eq((await q('SELECT count(*)::int n FROM vault.secrets'))[0].n,0);
 t.diagnostic(`${checks} v2 financial assertions`);
});
