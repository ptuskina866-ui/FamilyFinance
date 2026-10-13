import assert from 'node:assert/strict';import {createRequire} from 'node:module';import {join} from 'node:path';import test from 'node:test';
const require=createRequire(import.meta.url);
const {resolveIncomeTemplate,transferBudgetPreview,distributionRefund,previousBudgetReview,previousPlanningMonth,emergencyTarget,emergencyCoverage,essentialExpenseSuggestion}=require(join(process.env.FINAPP_TEST_OUTPUT,'lib/flexiblePlanning.js'));
const {budgetReserved}=require(join(process.env.FINAPP_TEST_OUTPUT,'lib/planning.js'));
const b=(category_id,allocated_amount,month='2026-10-01')=>({id:category_id,category_id,allocated_amount,month});
const tx=(amount,categoryId,extra={})=>({id:'t',amount,categoryId,type:'expense',kind:'cashflow',date:'2026-10-13',...extra});
test('template prioritizes fixed obligations and exact percentage goals within real funds',()=>{
 const items=[{targetType:'budget',targetId:'utilities',mode:'fixed',value:450},{targetType:'goal',targetId:'holiday',mode:'percent',value:10.5},{targetType:'goal',targetId:'reserve',mode:'fixed',value:200}];
 const result=resolveIncomeTemplate(items,1000,600);
 assert.deepEqual(result.allocations.map(i=>i.amount),[450,105,45]);assert.equal(result.total,600);assert.equal(result.shortfalls[0].amount,155);assert.equal(result.unassigned,0);
});
test('percentages round down in cents and keep full NUMERIC precision',()=>{
 const item={targetType:'goal',targetId:'g',mode:'percent',value:10};
 assert.equal(resolveIncomeTemplate([item],0.19,0.19).total,0.01);
 assert.equal(resolveIncomeTemplate([{...item,value:99.99}],9999999999.99,9999999999.99).total,9998999999.99);
 assert.throws(()=>resolveIncomeTemplate([{...item,value:100.01}],10,10));
 assert.throws(()=>resolveIncomeTemplate([item,item],10,10));assert.throws(()=>resolveIncomeTemplate([item],0,0));
 assert.equal(resolveIncomeTemplate([item],100,-1).total,0);
});
test('budget transfer preserves reservations even when destination was overspent',()=>{
 const budgets=[b('food',100),b('other',10)],ledger=[tx(30,'other')];
 const next=transferBudgetPreview(budgets,ledger,'food','other',25,'2026-10-01');
 assert.equal(next.find(x=>x.category_id==='other').allocated_amount,55);
 assert.equal(budgetReserved(next,ledger,'2026-10-13'),budgetReserved(budgets,ledger,'2026-10-13'));
 assert.equal(budgets[0].allocated_amount,100);assert.throws(()=>transferBudgetPreview(budgets,ledger,'food','other',101,'2026-10-01'));
 assert.throws(()=>transferBudgetPreview(budgets,ledger,'food','food-hippo',1,'2026-10-01'));
});
test('distribution cancellation refunds only available linked funds, preserving expenses',()=>{
 const d={id:'d',month:'2026-10-01',items:[{targetType:'budget',targetId:'food',amount:100},{targetType:'goal',targetId:'g',amount:100}]};
 const ledger=[tx(80,'food'),tx(100,'savings',{incomeDistributionId:'d',goalId:'g',kind:'goal_deposit'})];
 assert.deepEqual(distributionRefund(d,[b('food',100)],[{id:'g',current_amount:40}],ledger).map(i=>i.amount),[20,40]);
 assert.equal(ledger[0].amount,80);assert.equal(distributionRefund(d,[b('food',100)],[{id:'g',current_amount:100,is_archived:true}],ledger)[1].amount,0);
 assert.deepEqual(distributionRefund({...d,status:'cancelled'},[],[],ledger),[]);
});
test('previous-month review distinguishes repeating a total plan from carrying its remainder',()=>{
 const budgets=[b('food',100,'2026-09-01'),b('other',20,'2026-09-01'),b('utilities',40)];
 const ledger=[tx(80,'food',{date:'2026-09-20'})];
 assert.equal(previousPlanningMonth('2026-01-15'),'2025-12-01');
 assert.deepEqual(previousBudgetReview(budgets,ledger,'carry','2026-10-13').map(i=>i.amount),[20,20]);
 assert.deepEqual(previousBudgetReview(budgets,ledger,'repeat','2026-10-13').map(i=>i.amount),[100,20]);
});
test('emergency target and coverage use confirmed necessary expenses',()=>{
 assert.equal(emergencyTarget(800.01,3),2400.03);
 assert.equal(emergencyCoverage({purpose:'emergency',essential_amount:800,current_amount:1200}),1.5);
 assert.equal(emergencyCoverage({purpose:'goal',essential_amount:800,current_amount:1200}),null);
 assert.throws(()=>emergencyTarget(800,13));assert.throws(()=>emergencyTarget(0,3));
});
test('essential expense suggestion includes zero months and never counts goals or overlapping food twice',()=>{
 const ledger=[tx(300,'food-hippo',{date:'2026-08-01'}),tx(100,'housing',{date:'2026-09-20'}),tx(500,'food',{date:'2026-10-01'}),tx(99,'food',{date:'2026-07-01',kind:'goal_deposit'})];
 const result=essentialExpenseSuggestion(ledger,['food','food-hippo','housing'],'2026-10-13');
 assert.equal(result.monthly,133.34);assert.equal(result.start,'2026-07-01');assert.equal(result.end,'2026-09-01');
});
