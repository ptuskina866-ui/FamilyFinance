import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import test from 'node:test';
const require = createRequire(import.meta.url);
const { budgetProgress, budgetReserved, validateBudgetScopes, uncoveredRecurring, unassignedDailyTransactions, allocationTotal, cashflowCalendar, planningDateISO } = require(join(process.env.FINAPP_TEST_OUTPUT,'lib/planning.js'));
const { calculateSafeDaily } = require(join(process.env.FINAPP_TEST_OUTPUT,'lib/finance.js'));
const { toMinorUnits } = require(join(process.env.FINAPP_TEST_OUTPUT,'lib/money.js'));
const budget = (category_id='food',allocated_amount=100,month='2026-10-01') => ({id:category_id,category_id,allocated_amount,month});
const tx = (amount,categoryId='food',extra={}) => ({id:'t',type:'expense',kind:'cashflow',date:'2026-10-12',amount,categoryId,...extra});
const recurring = (id,amount,extra={}) => ({id,amount,category_id:'food',type:'expense',is_active:true,day_of_month:20,last_applied:null,...extra});
test('funded food expenses consume one envelope including merchants, never goals or transfers',()=>{
  const ledger=[tx(0.1,'food-hippo'),tx(0.7,'food'),tx(40,'food',{kind:'goal_deposit'}),tx(10,'food',{kind:'transfer'}),tx(50,'food',{type:'income'}),tx(5,'food',{date:'2026-09-30'})];
  assert.deepEqual(budgetProgress(budget('food',1),ledger),{spent:0.8,remaining:0.2,overspent:0});
  assert.equal(budgetReserved([budget('food',1),budget('food',20,'2026-09-01')],ledger,'2026-10-12'),0.2);
  assert.equal(toMinorUnits(100)-toMinorUnits(0.8)-toMinorUnits(budgetReserved([budget('food',1)],ledger,'2026-10-12')),9900);
});
test('overspent envelopes reserve zero and cannot overlap food scopes',()=>{
  assert.deepEqual(budgetProgress(budget('food',10),[tx(12)]),{spent:12,remaining:0,overspent:2});
  assert.throws(()=>validateBudgetScopes([budget('food')],'food-hippo',2,'2026-10-01'),/пересекаются/);
  assert.throws(()=>validateBudgetScopes([budget('food-hippo')],'food',2,'2026-10-01'),/пересекаются/);
  assert.doesNotThrow(()=>validateBudgetScopes([budget('food')],'food-hippo',0,'2026-10-01'));
  assert.doesNotThrow(()=>validateBudgetScopes([budget('food-hippo')],'food-euroopt',2,'2026-10-01'));
});
test('scheduled bills consume shared envelope coverage once without double reserving',()=>{
  const bills=[recurring('b',70,{category_id:'food-hippo',day_of_month:21}),recurring('a',60)];
  const uncovered=uncoveredRecurring(bills,[budget()],[],'2026-10-12');
  assert.deepEqual(uncovered.map(x=>x.amount),[0,30]);
  assert.equal(calculateSafeDaily(50,[],uncovered,'2026-10-12').upcomingObligations,30);
});
test('already applied or inactive bills do not use envelope coverage',()=>{
  const bills=[recurring('a',50,{last_applied:'2026-10-20'}),recurring('b',50,{is_active:false}),recurring('c',50)];
  assert.deepEqual(uncoveredRecurring(bills,[budget()],[],'2026-10-12').map(x=>x.amount),[50,50,0]);
});
test('daily estimate deducts only the portion of today purchases outside funded categories',()=>{
  const ledger=[tx(80,'food',{id:'old',date:'2026-10-11'}),tx(15,'food-hippo',{id:'a'}),tx(10,'food',{id:'b'}),tx(3,'other',{id:'c'})];
  const daily=unassignedDailyTransactions(ledger,[budget()], '2026-10-12');
  assert.deepEqual(daily.map(t=>t.amount),[80,0,5,3]);
  assert.equal(calculateSafeDaily(192,daily,[],'2026-10-12').spentToday,8);
  assert.equal(ledger[1].amount,15); // Preview never edits the ledger itself.
});
test('allocation validates exact amounts and duplicate targets',()=>{
  assert.equal(allocationTotal([{targetType:'budget',targetId:'food',amount:0.1},{targetType:'goal',targetId:'food',amount:0.7}]),0.8);
  for(const items of [[],[{targetType:'budget',targetId:' food',amount:1}],[{targetType:'goal',targetId:'x',amount:0}], [{targetType:'goal',targetId:'x',amount:0.001}], [{targetType:'budget',targetId:'food',amount:1},{targetType:'budget',targetId:'food',amount:2}]]) assert.throws(()=>allocationTotal(items));
});
test('calendar skips posted occurrences, crosses months and orders same-day bills conservatively',()=>{
  const bills=[recurring('salary',100,{type:'income',day_of_month:20}),recurring('bill',20,{day_of_month:20}),recurring('old',30,{day_of_month:10})];
  const events=cashflowCalendar(10,bills,[tx(20,'food',{recurringId:'bill',date:'2026-10-20'})],'2026-10-12',40);
  assert.deepEqual(events.map(e=>[e.date,e.type,e.projectedBalance]),[['2026-10-20','income',110],['2026-11-10','expense',80],['2026-11-20','expense',60],['2026-11-20','income',160]]);
  assert.equal(cashflowCalendar(10,bills,[],'2026-10-12',10)[0].projectedBalance,-10);
});
test('shared planning month follows Minsk at the UTC month boundary',()=>{
  assert.equal(planningDateISO(new Date('2026-09-30T22:00:00Z')),'2026-10-01');
});
