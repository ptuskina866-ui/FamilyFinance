import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {join} from 'node:path';
const require=createRequire(import.meta.url),root=process.env.FINAPP_TEST_OUTPUT;
const {parseQuickEntry}=require(join(root,'lib/quickEntry.js'));
const {CATEGORIES}=require(join(root,'mockData.js'));
const accounts=[{id:'cash',name:'Наличные',kind:'cash'},{id:'card',name:'Карта Приор',kind:'bank'}];
const parse=(s,a=accounts)=>parseQuickEntry(s,a,CATEGORIES,'2026-03-01');
test('phrase amounts are exact for digits, spoken prices and kopecks',()=>{
 for(const [text,amount] of [['Кофе 5,50 наличными',5.5],['Кофе 5.50',5.5],['кофе пять пятьдесят',5.5],['стрижка тридцать пять',35],['кофе пять рублей пятьдесят копеек',5.5],['кофе 50 копеек',0.5],['продукты тысяча двести тридцать четыре рубля пять копеек',1234.05],['кофе 5 рублей 05 копеек',5.05]]){const d=parse(text);assert.equal(d.amount,amount,text);assert.deepEqual(d.issues,[],text);}
});
test('amount ambiguity, invalid precision and unsupported debt/currency never create a draft for saving',()=>{
 for(const text of ['кофе 5 и обед 20','кофе 5 50','кофе 0','кофе 0 копеек','кофе -5','кофе минус пять','кофе 1.999','кофе 10000000000','кофе сто двести','кофе','дал Саше 100 в долг','кофе 5 евро','кофе завтра 5','кофе 31.02.2026 5','кофе вчера сегодня 5','кофе пять с половиной','кофе примерно 5'])assert.ok(parse(text).issues.length,text);
});
test('explicit income, categories, calendar dates and cash account are retained for review',()=>{
 const d=parse('Вчера получил двести наличными за подработку');assert.equal(d.amount,200);assert.equal(d.type,'income');assert.equal(d.date,'2026-02-28');assert.equal(d.categoryId,'income-freelance');assert.equal(d.accountId,'cash');
 assert.equal(parse('Позавчера стрижка тридцать пять').date,'2026-02-27');assert.equal(parse('Стрижка 35 28.02.2026').date,'2026-02-28');assert.equal(parse('Кофе 5').categoryId,'cafes');assert.equal(parse('Стрижка 35').categoryId,'beauty');
 assert.equal(parse('неизвестная покупка 20').categoryId,'');
 assert.equal(parse('Кофе сто').categoryId,'cafes');assert.equal(parse('Продукты 1 234,56').amount,1234.56);
 assert.deepEqual(parse('Евроопт 20 наличными').issues,[]);assert.equal(parse('Мне перевели 100 наличными').type,'income');assert.equal(parse('Мне перевели 100 наличными').kind,'cashflow');
 assert.equal(parse('Отдал 35 к парикмахеру').amount,35);
});
test('withdrawal and cash deposit are transfers, generic direction and multiple accounts require review',()=>{
 const d=parse('Снял сто с карты в наличные');assert.equal(d.kind,'transfer');assert.equal(d.accountId,'card');assert.equal(d.targetAccountId,'cash');assert.equal(d.amount,100);
 const p=parse('Пополнил карту на 100 наличными');assert.equal(p.kind,'transfer');assert.equal(p.accountId,'cash');assert.equal(p.targetAccountId,'card');
 assert.equal(parse('кофе 5',accounts.concat({id:'cash2',name:'Кошелёк',kind:'cash'})).accountId,'');
 const t=parse('перевел 100');assert.equal(t.accountId,'');assert.equal(t.targetAccountId,'');
 assert.equal(parse('кофе 5 с Карта Приор').accountId,'card');
});
