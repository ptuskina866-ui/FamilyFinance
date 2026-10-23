import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import test from 'node:test';
const require=createRequire(import.meta.url),root=process.env.FINAPP_TEST_OUTPUT;
const {CATEGORIES}=require(join(root,'mockData.js'));
const {categoryGroup,isIncomeCategory,matchesCategoryQuery,additionalCategorySuggestion}=require(join(root,'lib/categories.js'));
const {budgetProgress}=require(join(root,'lib/planning.js'));
const source=readFileSync(new URL('../src/services/alfaBankService.ts',import.meta.url),'utf8'),exports={};
vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.CommonJS}}).outputText,{exports,require:name=>{
  if(name==='../lib/bankCategory') {
      const categoryExports={};
      vm.runInNewContext(ts.transpileModule(readFileSync(new URL('../src/lib/bankCategory.ts',import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.CommonJS}}).outputText,{exports:categoryExports,require:()=>require(join(process.env.FINAPP_TEST_OUTPUT,'lib/categories.js'))});
      return categoryExports;
    }
    if(name==='../lib/categories'||name==='../lib/bankConnection')return require(join(root,name.replace('../','')+'.js'));
  if(name.endsWith('?url'))return '/pdf-worker';throw Error('Unexpected bank dependency '+name);
}});
const bank=exports.AlfaBankService;

test('Belarus catalogue is additive, has stable valid IDs, and income categories stay out of expense groups',()=>{
  assert.equal(new Set(CATEGORIES.map(c=>c.id)).size,CATEGORIES.length);
  for(const c of CATEGORIES){assert.match(c.id,/^[a-z][a-z0-9-]{0,63}$/);assert.ok(c.name&&c.icon);assert.ok(['food','shopping','transport','bills','life'].includes(categoryGroup(c)));}
  for(const id of ['food-hippo','food-euroopt','food-fixprice','food-mayak','marketplaces','transport','internet','salary','income-transfer','income-freelance','income-relatives'])assert.ok(CATEGORIES.some(c=>c.id===id),'Missing legacy '+id);
  for(const id of ['income-pension','income-scholarship','income-business','income-sale','income-refund','income-interest'])assert.ok(isIncomeCategory(id));
  assert.equal(isIncomeCategory('vape-tobacco'),false);assert.equal(categoryGroup(CATEGORIES.find(c=>c.id==='food-kopeechka')),'food');
});
test('category search handles Belarusian/Russian spellings, Latin merchants and words without changing selection data',()=>{
  const before=JSON.stringify(CATEGORIES);
  for(const [query,id]of [['вэйп','vape-tobacco'],['vape shop','vape-tobacco'],['Капеечка','food-kopeechka'],['ProStore','food-prostore'],['е-доставка','food-euroopt'],['21 век','electronics'],['озон','marketplaces'],['ип','income-business'],['КУФАР','income-sale'],['проценты вклад','income-interest']])assert.ok(matchesCategoryQuery(CATEGORIES.find(c=>c.id===id),query),query);
  assert.equal(matchesCategoryQuery(CATEGORIES.find(c=>c.id==='food-korona'),'подписка'),false);
  assert.equal(JSON.stringify(CATEGORIES),before);
});
test('income is detected before store names, so refunds/payroll never acquire an expense category',()=>{
  for(const [text,id]of [['Возврат покупки EUROOPT','income-refund'],['REFUND KORONA','income-refund'],['Зарплата ООО Доброном','salary'],['Аванс Green','salary'],['Кэшбэк ProStore','income-cashback'],['Стипендия','income-scholarship'],['Выплата пенсии','income-pension'],['Пособие на ребенка','income-benefits'],['Проценты по вкладу','income-interest'],['Арендная плата','income-rent'],['Отпускные','income-bonus'],['Оплата услуг','income-business']]){
    assert.equal(bank.detectCategory(text,'income'),id,text);assert.ok(isIncomeCategory(id));
  }
  assert.equal(bank.detectCategory('Возврат долга от друга','income'),'income-other');
  assert.equal(bank.detectCategory('Перевод между счетами','income'),'transfer');
  assert.equal(bank.detectCategory('Перевод между счетами: проценты по вкладу EUROOPT','income'),'transfer');
});
test('new import suggestions are specific, preserve legacy mappings and leave ambiguous scenarios for review',()=>{
  for(const [text,id]of [['POS KORONA MINSK','food-korona'],['Корона Минск','food-korona'],['PROSTORE','food-prostore'],['Белмаркет','food-belmarket'],['DOBRONOM','food-dobronom'],['Копеечка','food-kopeechka'],['VAPE SHOP','vape-tobacco'],['Вейпшоп','vape-tobacco'],['Европочта','postal'],['YANDEX.EDA','meal-delivery'],['Яндекс Плюс','subscriptions'],['Оплата парковки','parking'],['Корона Техно','electronics'],['Корона Дом','household'],['EUROOPT','food-euroopt'],['FixPrice','food-fixprice'],['МТС','mobile'],['Белтелеком','internet'],['ЕРИП коммунальные услуги','utilities'],['АЗС Белоруснефть','car'],['KFC','cafes']])assert.equal(bank.detectCategory(text,'expense'),id,text);
  assert.equal(additionalCategorySuggestion('HIT MUSIC','expense'),null);
  assert.equal(additionalCategorySuggestion('KORONA PAY','expense'),null);
  assert.equal(bank.detectCategory('Незнакомый магазин','expense'),'other');
  assert.equal(bank.detectCategory('Газоснабжение','expense'),'utilities');
  assert.equal(bank.detectCategory('АЗС Газпромнефть','expense'),'car');
});
test('new food stores consume the existing food budget once, without changing original money or dates',()=>{
  const tx={id:'t',kind:'cashflow',type:'expense',amount:12.34,categoryId:'food-dobronom',date:'2026-10-20',comment:'Покупка',addedBy:'member'};
  const before=JSON.stringify(tx),progress=budgetProgress({id:'b',household_id:'h',month:'2026-10-01',category_id:'food',allocated_amount:50},[tx]);
  assert.equal(progress.spent,12.34);assert.equal(progress.remaining,37.66);assert.equal(JSON.stringify(tx),before);
});
test('existing CSV, tab, 1C and both PDF-text paths keep original amounts/dates while using new categories',()=>{
  const expected=[{date:'2026-10-20',amount:12.34,type:'expense',categoryId:'vape-tobacco',currency:'BYN'},{date:'2026-10-21',amount:150.01,type:'income',categoryId:'income-scholarship',currency:'BYN'}];
  const pick=rows=>Array.from(rows,({date,amount,type,categoryId,currency})=>({date,amount,type,categoryId,currency}));
  for(const separator of [';', '\t', ',']){
    const decimal=separator===','?'.':',';
    const csv=[['Дата','Сумма','Описание'],['20.10.2026','-12'+decimal+'34','VAPE SHOP'],['21.10.2026','+150'+decimal+'01','Зачисление стипендии']].map(cols=>cols.join(separator)).join('\n');
    assert.deepEqual(pick(bank.parseStatementFile(csv)),expected);
  }
  const oneC=['1CClientBankExchange','СекцияДокумент=Платежное поручение','Дата=20.10.2026','ДатаСписано=20.10.2026','Сумма=12,34','НазначениеПлатежа=VAPE SHOP','КонецДокумента','СекцияДокумент=Платежное поручение','Дата=21.10.2026','ДатаПоступило=21.10.2026','Сумма=150,01','НазначениеПлатежа=Зачисление стипендии','КонецДокумента'].join('\n');
  assert.deepEqual(pick(bank.parseStatementFile(oneC)),expected);
  const card=['Детальная информация по карте','Номер транзакции Тип операции','20.10.2026 Покупка 12,34 BYN VAPE SHOP','21.10.2026 Зачисление стипендии 150,01 BYN Minsk','22.10.2026 Покупка отклонено 50,00 BYN EUROOPT'];
  assert.deepEqual(pick(bank.extractTransactionsFromTextLines(card)),expected);
  const account=['Выписка за период 20.10.2026 — 21.10.2026','Дата Примечание','20.10.2026 Покупка VAPE SHOP -12,34 BYN -12,34 BYN','21.10.2026 Зачисление стипендии 150,01 BYN +150,01 BYN'];
  assert.deepEqual(pick(bank.extractTransactionsFromTextLines(account)),expected);
  const foreign=bank.extractTransactionsFromTextLines(['Выписка по карте','Номер транзакции Тип операции','20.10.2026 Покупка 12,34 USD VAPE SHOP']);
  assert.equal(foreign[0].amount,12.34);assert.equal(foreign[0].currency,'USD');
  assert.equal(bank.parseStatementFile('не выписка').length,0);assert.equal(bank.extractTransactionsFromTextLines(['не выписка']).length,0);
});
