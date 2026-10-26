// Actual AppProvider and mobile components. All APIs are intercepted; no working data is written.
async page=>{
 const results=[];
 for(const width of [320,390]){
  const ctx=await page.context().browser().newContext({viewport:{width,height:760},isMobile:true,hasTouch:true,serviceWorkers:'block'}),p=await ctx.newPage(),errors=[],calls=[];
  p.on('pageerror',e=>errors.push(e.message));
  const owner='11111111-1111-4111-8111-111111111111',hh='22222222-2222-4222-8222-222222222222',account='33333333-3333-4333-8333-333333333333',raw='Retail BLR Minsk MAK.BY';
  const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Minsk'}).format(new Date()),day=Math.min(12,Number(today.slice(8))),date=today.slice(0,8)+String(day).padStart(2,'0'),prev=new Date(date+'T00:00:00Z');prev.setUTCMonth(prev.getUTCMonth()-1);
  const tx=(id,description,amount,date)=>({id,household_id:hh,added_by:owner,account_id:account,type:'expense',kind:'cashflow',amount,category_id:'other',comment:description,date,created_at:date+'T12:00:00Z'});
  const event=(id,txid,category=null)=>({id,household_id:hh,owner_id:owner,transaction_id:txid,state:'posted',bank_amount:-27,applied_amount:-27,original_amount:-27,original_currency:'BYN',description:raw,merchant_key:'brand:mak-by',merchant_name:'Мак.by',rule_category:category,day:today,reason:null,suppressed:false,history:[],created_at:new Date().toISOString()});
  const data={transactions:[tx('purchase',raw,27,today),tx('sub-a','Netflix.com',12.99,prev.toISOString().slice(0,10)),tx('sub-b','Netflix.com',12.99,date)],events:[event('event-a','purchase')],rules:[],recurring:[]};
  await ctx.route('**/rest/v1/**',async route=>{
   const req=route.request(),path=new URL(req.url()).pathname.split('/').at(-1),rpc=req.url().includes('/rpc/');
   if(rpc){const body=req.postDataJSON();calls.push({path,body});
    if(path==='save_transaction_with_rule'){if(body.p_remember!==true||body.p_amount!==27||body.p_comment!==raw)throw Error('Learning changed source money/note');data.transactions[0].category_id=body.p_category_id;data.rules=[{id:'rule-a',household_id:hh,merchant_key:'brand:mak-by',transaction_type:'expense',display_name:body.p_merchant_name,category_id:body.p_category_id,created_at:new Date().toISOString()}];}
    else if(path==='confirm_bank_bill'){if(body.p_evidence.length!==2)throw Error('Unreviewed evidence');data.recurring=[{id:'bill',household_id:hh,account_id:account,type:'expense',amount:12.99,category_id:'other',comment:'Netflix',day_of_month:day,match_mode:'bank',merchant_key:'brand:netflix',last_applied:null,is_active:true,created_at:new Date().toISOString()}];for(const t of data.transactions.filter(t=>body.p_evidence.includes(t.id))){t.recurring_id='bill';t.recurring_month=t.date.slice(0,7)+'-01';}}
    else if(path==='delete_merchant_rule')data.rules=[];
    else if(!['apply_due_recurring','request_prior_sync'].includes(path))throw Error('Unexpected RPC '+path);
    await route.fulfill({status:200,json:path==='apply_due_recurring'?0:null});return;
   }
   const tables={transactions:data.transactions,profiles:[{id:owner,name:'Test member',household_id:hh}],accounts:[{id:account,household_id:hh,name:'Test card',kind:'bank',currency:'BYN',opening_balance:1000,is_archived:false}],savings_goals:[],recurring_transactions:data.recurring,category_budgets:[],income_distributions:[],income_templates:[],budget_rollovers:[],income_distribution_revisions:[],prior_bank_events:data.events,merchant_rules:data.rules,prior_automation:null,prior_automation_reviews:[]};
   if(!(path in tables))throw Error('Unexpected table '+path);await route.fulfill({json:tables[path]});
  });
  await ctx.route('**/src/main.tsx*',r=>r.fulfill({contentType:'application/javascript',body:`
   import React from '/node_modules/.vite/deps/react.js';import ReactDOM from '/node_modules/.vite/deps/react-dom_client.js';
   import {AppProvider} from '/src/AppContext.tsx';import {AuthContext} from '/src/AuthContext.tsx';import Home from '/src/screens/HomeScreen.tsx';import Plans from '/src/screens/PlansScreen.tsx';import {MerchantRules} from '/src/components/MerchantRules.tsx';import {RecurringInsights} from '/src/components/RecurringInsights.tsx';import '/src/index.css';
   function Harness(){const [scene,setScene]=React.useState('home');return React.createElement(AuthContext.Provider,{value:{user:{id:'${owner}'},profile:{id:'${owner}',household_id:'${hh}',name:'Test member'}}},React.createElement(AppProvider,null,React.createElement('main',{className:'app-shell',style:{padding:16,overflowY:'auto',height:'100dvh'}},React.createElement('nav',null,['home','insights','rules','plans'].map(x=>React.createElement('button',{key:x,onClick:()=>setScene(x),style:{padding:8}},'Test '+x))),scene==='home'?React.createElement(Home):scene==='insights'?React.createElement(RecurringInsights):scene==='rules'?React.createElement(MerchantRules):React.createElement(Plans))));}
   ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(React.StrictMode,null,React.createElement(Harness)));
  `}));
  await p.goto('http://127.0.0.1:5190/');await p.getByRole('button',{name:'Редактировать операцию'}).first().waitFor();
  await p.getByText('Мак.by',{exact:true}).waitFor();await p.getByRole('button',{name:'Редактировать операцию'}).first().click();
  await p.getByLabel('Категория операции',{exact:true}).selectOption('cafes');await p.getByRole('checkbox',{name:/Всегда относить операции/}).check();await p.getByLabel('Название магазина для правила').fill('Мой Мак');
  await p.getByLabel('Название магазина для правила').scrollIntoViewIfNeeded();await p.screenshot({path:'D:/FamilyFinance/.playwright-mcp/merchant-editor-'+width+'.png'});
  await p.getByRole('button',{name:'Сохранить изменения',exact:true}).click();await p.getByText('Мой Мак',{exact:true}).waitFor();
  if(calls.filter(c=>c.path==='save_transaction_with_rule').length!==1)throw Error('Learning did not save atomically once');
  const future=tx('future',raw,30,today);future.category_id='cafes';data.transactions.push(future);data.events.push(event('event-b','future','cafes'));await p.evaluate(()=>window.dispatchEvent(new Event('online')));
  await p.getByText('Категория по вашему правилу',{exact:true}).waitFor();await p.getByText('Данные банка',{exact:true}).first().click();await p.getByText(raw,{exact:true}).first().waitFor();
  await p.getByRole('button',{name:'Test insights',exact:true}).click();await p.getByText('Netflix',{exact:true}).waitFor();await p.getByRole('button',{name:'Учитывать в плане',exact:true}).click();
  const count=data.transactions.length;await p.getByRole('button',{name:'Подтвердить ежемесячный платёж',exact:true}).click();await p.getByText('Добавлено в Планы → Платежи. Оплату отметим по операции банка.',{exact:true}).waitFor();
  if(data.transactions.length!==count)throw Error('Confirming a bill created money');
  await p.getByRole('button',{name:'Test plans',exact:true}).click();await p.getByRole('button',{name:'Платежи',exact:true}).click();await p.getByText('Оплачено в этом месяце',{exact:true}).waitFor();await p.getByText('Netflix',{exact:true}).waitFor();
  await p.getByRole('button',{name:'Удалить регулярный платеж Netflix',exact:true}).scrollIntoViewIfNeeded();
  await p.screenshot({path:'D:/FamilyFinance/.playwright-mcp/merchant-bills-'+width+'.png'});
  await p.getByRole('button',{name:'Test rules',exact:true}).click();await p.getByText('Правила магазинов · 1',{exact:true}).click();await p.getByRole('button',{name:'Удалить правило Мой Мак'}).click();await p.getByText('Правила магазинов · 0',{exact:true}).waitFor();
  if(data.transactions.find(t=>t.id==='future').category_id!=='cafes')throw Error('Deleting a rule recategorized history');
  if(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1)||errors.length)throw Error(JSON.stringify(errors));
  results.push({width,atomicLearning:true,cleanTitle:true,originalDescriptor:true,ruleProvenance:true,monthlyConfirmation:true,noSyntheticCharge:true,ruleRemovalPreservesHistory:true,errors});await ctx.close();
 }
 return results;
}
