import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {join} from 'node:path';
import test from 'node:test';
const require=createRequire(import.meta.url),load=file=>require(join(process.env.FINAPP_TEST_OUTPUT,'lib',file+'.js'));
const {merchantIdentity,transactionTitle}=load('merchants');
const {discoverRecurringExpenses}=load('recurringInsights');
const {recurringPaid,calculateSafeDaily}=load('finance');
const {cashflowCalendar}=load('planning');
test('readable bank titles preserve original descriptors, personal notes and branch identity',()=>{
 const raw='Retail BLR Minsk MAK.BY',tx={type:'expense',comment:raw,bankEvent:{description:raw,merchant_key:'brand:mak-by',merchant_name:'Мак.by'}};
 assert.equal(transactionTitle(tx),'Мак.by');assert.equal(tx.comment,raw);
 const rules=[{merchant_key:'brand:mak-by',transaction_type:'expense',display_name:'Мой Мак'}];
 assert.equal(transactionTitle(tx,rules),'Мой Мак');assert.equal(transactionTitle({...tx,comment:'Ужин с друзьями'},rules),'Ужин с друзьями');
 assert.equal(transactionTitle({...tx,type:'income'},rules),'Мак.by');
 assert.notEqual(merchantIdentity('Shop 123').key,merchantIdentity('Shop 124').key);
 assert.notEqual(merchantIdentity('SMAK.BY').key,'brand:mak-by');assert.equal(merchantIdentity('оплата').key,'');
});
test('monthly discovery uses immutable bank identity even when a personal note is edited',()=>{
 const rows=['2026-08-12','2026-09-12','2026-10-12'].map((date,i)=>({id:String(i),date,type:'expense',kind:'cashflow',amount:12.99,categoryId:'subscriptions',accountId:'card',comment:'Моя заметка '+i,bankEvent:{description:'Netflix.com',merchant_key:'brand:netflix',merchant_name:'Netflix'}}));
 const result=discoverRecurringExpenses(rows,[],'2026-10-20');assert.equal(result.length,1);assert.equal(result[0].merchantKey,'brand:netflix');assert.equal(result[0].merchant,'Netflix');
 assert.equal(discoverRecurringExpenses([...rows,{...rows[2],id:'another'}],[],'2026-10-20').length,0);
});
test('an early bank payment satisfies its monthly plan without double reserving; cancellation does not',()=>{
 const plan={id:'bill',type:'expense',is_active:true,match_mode:'bank',amount:12.99,day_of_month:12,last_applied:'2099-01-01',comment:'Netflix'};
 const tx={id:'payment',type:'expense',kind:'cashflow',amount:13.19,date:'2026-10-10',recurringId:'bill',recurringMonth:'2026-10-01',bankEvent:{state:'provisional'}};
 assert.equal(recurringPaid(plan,[tx],'2026-10-12'),true);
 assert.equal(calculateSafeDaily(100,[tx],[plan],'2026-10-10').upcomingObligations,0);
 assert.equal(cashflowCalendar(100,[plan],[tx],'2026-10-10',5).length,0);
 assert.equal(recurringPaid(plan,[],'2026-10-12'),false);
 assert.equal(recurringPaid(plan,[{...tx,amount:0,bankEvent:{state:'cancelled'}}],'2026-10-12'),false);
 assert.equal(recurringPaid(plan,[tx],'2026-11-12'),false);
});
test('bank-observed month-end schedules clamp to leap/nonleap February without generating a March date',()=>{
 const plan={id:'bill',type:'expense',is_active:true,match_mode:'bank',amount:12.99,day_of_month:31,last_applied:null,comment:'Subscription'};
 assert.equal(cashflowCalendar(100,[plan],[],'2024-02-01',28)[0].date,'2024-02-29');
 assert.equal(cashflowCalendar(100,[plan],[],'2026-02-01',27)[0].date,'2026-02-28');
});
