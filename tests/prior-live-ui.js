// Actual mobile components with synthetic providers and intercepted APIs only.
async page=>{
 const results=[];
 for(const width of [320,390]){
  const context=await page.context().browser().newContext({viewport:{width,height:740},isMobile:true,hasTouch:true,serviceWorkers:'block'}),p=await context.newPage(),errors=[],calls=[];
  p.on('pageerror',e=>errors.push(e.message));
  const owner='11111111-1111-4111-8111-111111111111',household='22222222-2222-4222-8222-222222222222',account='33333333-3333-4333-8333-333333333333',source='f'.repeat(64);
  const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Minsk'}).format(new Date()),yesterday=new Date(today+'T00:00:00Z');yesterday.setUTCDate(yesterday.getUTCDate()-1);const day=yesterday.toISOString().slice(0,10);
  let autoReconnect=false;
  const snapshot={format:'finapp-prior',version:1,from:day,to:day,fetchedAt:new Date().toISOString(),card:{sourceKey:source,title:'Test card',maskedNumber:'•••• 1234',currency:'BYN',records:[]}};
  await context.route('**/functions/v1/prior-connect',async r=>{
   const body=r.request().postDataJSON();calls.push(body);
   if(body.action==='connect'){if(body.apiVersion!==2||body.autoReconnect!==true)throw Error('Missing explicit v2 automatic-login consent');autoReconnect=true;}
   await r.fulfill({json:{format:'finapp-prior-connection',version:2,cards:[snapshot],externalCards:0,connection:{connected:true,reauthRequired:false,lastSyncedAt:snapshot.fetchedAt,selectedSourceKey:source,accountId:account},syncState:body.action==='refresh'?'updating':'saved',live:{autoReconnect,enabled:true,ready:true}}});
  });
  await context.route('**/rest/v1/**',async r=>{
   const u=r.request().url();
   if(u.includes('/prior_bank_events'))await r.fulfill({json:[]});
   else if(u.includes('/prior_automation_reviews'))await r.fulfill({json:[]});
   else if(u.includes('/prior_automation?'))await r.fulfill({json:{owner_id:owner,household_id:household,account_id:account,source_key:source,enabled:true,live_enabled:true,live_requested:true,last_checked_at:new Date().toISOString(),issue:null,imported_count:2,additional_count:2}});
   else throw Error('Unexpected API '+u);
  });
  await context.route('**/src/main.tsx*',r=>r.fulfill({contentType:'application/javascript',body:`
   import React from '/node_modules/.vite/deps/react.js';import ReactDOM from '/node_modules/.vite/deps/react-dom_client.js';
   import {AppContext} from '/src/AppContext.tsx';import {AuthContext} from '/src/AuthContext.tsx';import {PriorImportPanel} from '/src/components/PriorImportPanel.tsx';import HomeScreen from '/src/screens/HomeScreen.tsx';import {CATEGORIES} from '/src/mockData.ts';import '/src/index.css';
   const event=(state,amount,history=[])=>({id:'e-'+state,transaction_id:'t-'+state,state,bank_amount:amount,applied_amount:amount,original_amount:amount,original_currency:'BYN',description:state,day:'${today}',reason:null,suppressed:false,history});
   const tx=(id,type,amount,bankEvent)=>({id,type,amount,bankEvent,comment:id,date:'${today}',categoryId:type==='income'?'income-other':'cafes',kind:'cashflow',accountId:'${account}',addedBy:'${owner}',importOrigin:'prior-auto'});
   const transactions=[tx('Early shop','expense',27,event('provisional',-27)),tx('Early income','income',10,event('provisional',10)),tx('Changed shop','expense',28.19,event('posted',-28.19,[{at:new Date().toISOString(),fromState:'provisional',toState:'posted',oldAmount:'-27.00',amount:'-28.19',reason:null}])),tx('Cancelled shop','expense',0,event('cancelled',-8.25))];
   const app={transactions,categories:CATEGORIES,members:[],accounts:[{id:'${account}',name:'Test account',kind:'bank',currency:'BYN',opening_balance:100,is_archived:false}],accountBalances:{'${account}':54.81},accountsReady:true,schemaReady:true,financeLoading:false,financeError:null,availableBalance:-20,balance:54.81,reservedBalance:74.81,budgetReservedBalance:0,monthlyIncome:10,monthlyExpense:55.19,budgetLimit:1500,savingsGoals:[],recurringTransactions:[],categoryBudgets:[],incomeDistributions:[],incomeTemplates:[],budgetRollovers:[],distributionRevisions:[],planningReady:true,flexiblePlanningReady:true,getCategoryById:id=>CATEGORIES.find(c=>c.id===id),getMemberById:()=>null,previewPriorImport:async()=>({linked:true,importedIndexes:[],possibleIndexes:[]}),updateTransaction:async()=>{throw Error('No save expected');},deleteTransaction:async()=>{throw Error('No delete expected');}};
   function Harness(){const [home,setHome]=React.useState(false);return React.createElement(AuthContext.Provider,{value:{user:{id:'${owner}'},profile:{id:'${owner}',household_id:'${household}',name:'Synthetic'}}},React.createElement(AppContext.Provider,{value:app},React.createElement('main',{className:'app-shell',style:{padding:16,overflowY:'auto',height:'100dvh'}},React.createElement('button',{onClick:()=>setHome(v=>!v)},'Show home test'),home?React.createElement(HomeScreen):React.createElement(PriorImportPanel))));}
   ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(React.StrictMode,null,React.createElement(Harness)));
  `}));
  await p.goto('http://127.0.0.1:5190/');await p.getByText('История для ручного добавления',{exact:true}).waitFor();
  const disclosure=p.locator('details').filter({has:p.getByText('История для ручного добавления',{exact:true})}).first();if(await disclosure.getAttribute('open')!==null)throw Error('Legacy history is not collapsed');
  await p.getByRole('button',{name:'включите автоподключение',exact:true}).click();
  if(await p.getByRole('button',{name:'Подключить и получить операции',exact:true}).isEnabled())throw Error('Session consent missing');
  await p.locator('input[name=prior-login]').fill('Synthetic');await p.locator('input[name=prior-password]').fill('LoginSecret!');
  await p.getByLabel('Разрешаю вход и сохранение защищённой банковской сессии.',{exact:true}).check();
  await p.getByRole('button',{name:'Подключить и получить операции',exact:true}).click();await p.getByText('Автоподключение включено.',{exact:false}).waitFor();
  if(await p.locator('input[name=prior-password]').count())throw Error('Password form retained');
  if(await p.evaluate(()=>JSON.stringify({...localStorage,...sessionStorage}).includes('LoginSecret!')))throw Error('Credentials persisted in browser storage');
  await p.getByRole('button',{name:'Обновить операции',exact:true}).click();await p.getByText('Проверка запрошена.',{exact:false}).waitFor();
  if(await p.getByRole('alert').count())throw Error('False update error');
  await p.screenshot({path:'D:/FamilyFinance/.playwright-mcp/prior-live-bank-'+width+'.png'});
  await p.getByRole('button',{name:'Show home test',exact:true}).click();await p.getByText('Предварительно',{exact:true}).first().waitFor();
  if(await p.getByText('Предварительно',{exact:true}).count()!==2)throw Error('Missing provisional income/expense labels');
  await p.getByText('Отменено · в расчётах 0',{exact:true}).waitFor();await p.getByText('Не хватает',{exact:false}).waitFor();
  await p.getByText('Изменено банком',{exact:true}).click();await p.getByText('Changed shop',{exact:true}).scrollIntoViewIfNeeded();
  await p.screenshot({path:'D:/FamilyFinance/.playwright-mcp/prior-live-journal-'+width+'.png'});
  await p.getByLabel('Скрыть суммы',{exact:true}).click();
  const change=p.locator('details').filter({has:p.getByText('Изменено банком',{exact:true})}).first();if((await change.innerText()).includes('28,19'))throw Error('Change history bypasses amount privacy');
  if(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1))throw Error('Horizontal overflow');if(errors.length)throw Error(errors.join('\n'));
  results.push({width,encryptedLoginConsent:true,noBrowserCredentials:true,queuedRefresh:true,provisionalIncomeAndExpense:true,settlementAudit:true,cancellation:true,deficit:true,privacy:true,errors,actions:calls.map(c=>c.action)});await context.close();
 }
 return results;
}
