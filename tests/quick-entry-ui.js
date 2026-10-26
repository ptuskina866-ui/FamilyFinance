// Real AppProvider + AddTransactionScreen, intercepted synthetic API only.
async page=>{
 const results=[];
 for(const width of [320,390]){
  const ctx=await page.context().browser().newContext({viewport:{width,height:820},isMobile:true,hasTouch:true,serviceWorkers:'block'}),p=await ctx.newPage(),errors=[],writes=[];
  const owner='11111111-1111-4111-8111-111111111111',hh='22222222-2222-4222-8222-222222222222',cash='33333333-3333-4333-8333-333333333333',card='44444444-4444-4444-8444-444444444444';
  const ledger=[],today=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Minsk'}).format(new Date());let failNext=false;
  p.on('pageerror',e=>errors.push(e.message));
  await ctx.addInitScript(({width})=>{window.speechInstances=[];window.speechAborts=0;class Speech{start(){window.speechInstances.push(this);}stop(){this.onend?.();}abort(){window.speechAborts++;this.onend?.();}};delete window.SpeechRecognition;delete window.webkitSpeechRecognition;window[width===320?'webkitSpeechRecognition':'SpeechRecognition']=Speech;},{width});
  await ctx.route('**/rest/v1/**',async route=>{
   const req=route.request(),path=new URL(req.url()).pathname.split('/').at(-1),body=req.method()==='POST'?req.postDataJSON():null;
   if(req.method()==='POST'&&path==='transactions'){
    writes.push({path,body});await new Promise(r=>setTimeout(r,200));
    if(failNext){failNext=false;await route.fulfill({status:503,json:{message:'Проверочная ошибка сети',code:'503'}});return;}
    if(body.household_id!==hh||body.added_by!==owner||body.kind!=='cashflow')throw Error('Invalid authenticated cashflow');
    ledger.push({id:crypto.randomUUID(),...body,created_at:new Date().toISOString()});await route.fulfill({status:201,body:''});return;
   }
   if(req.url().includes('/rpc/')){
    if(path==='transfer_finance'){writes.push({path,body});if(body.p_from!==card||body.p_to!==cash||body.p_amount!==100)throw Error('Withdrawal became a cash expense');ledger.push({id:crypto.randomUUID(),household_id:hh,added_by:owner,kind:'transfer',type:'expense',account_id:card,target_account_id:cash,amount:100,date:body.p_date,comment:body.p_comment,category_id:'transfer',created_at:new Date().toISOString()});}
    else if(!['apply_due_recurring','request_prior_sync'].includes(path))throw Error('Unexpected RPC '+path);
    await route.fulfill({json:path==='apply_due_recurring'?0:null});return;
   }
   const data={transactions:ledger,profiles:[{id:owner,name:'Test member',household_id:hh}],accounts:[{id:cash,household_id:hh,name:'Наличные',kind:'cash',currency:'BYN',opening_balance:1000,is_archived:false},{id:card,household_id:hh,name:'Карта Приор',kind:'bank',currency:'BYN',opening_balance:1000,is_archived:false}],savings_goals:[],recurring_transactions:[],category_budgets:[],income_distributions:[],income_templates:[],budget_rollovers:[],income_distribution_revisions:[],prior_bank_events:[],merchant_rules:[]};
   if(!(path in data))throw Error('Unexpected table '+path);await route.fulfill({json:data[path]});
  });
  await ctx.route('**/src/main.tsx*',r=>r.fulfill({contentType:'application/javascript',body:`
   import React from '/node_modules/.vite/deps/react.js';import ReactDOM from '/node_modules/.vite/deps/react-dom_client.js';
   import {AppProvider,useApp} from '/src/AppContext.tsx';import {AuthContext} from '/src/AuthContext.tsx';import Add from '/src/screens/AddTransactionScreen.tsx';import '/src/index.css';
   function Scene(){const [show,setShow]=React.useState(true);const {transactions,balance,accountBalances}=useApp();return React.createElement('main',{className:'app-shell',style:{overflowY:'auto',height:'100dvh'}},React.createElement('output',{'aria-label':'Test state'},JSON.stringify({count:transactions.length,balance,accountBalances})),show?React.createElement(Add,{onNavigateHome:()=>setShow(false)}):React.createElement('button',{onClick:()=>setShow(true)},'Ещё операция'));}
   ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(React.StrictMode,null,React.createElement(AuthContext.Provider,{value:{user:{id:'${owner}'},profile:{id:'${owner}',household_id:'${hh}',name:'Test member'}}},React.createElement(AppProvider,null,React.createElement(Scene)))));
  `}));
  await p.goto('http://127.0.0.1:5190/');const field=p.getByLabel('Фраза для новой операции',{exact:true});await field.fill('Кофе пять пятьдесят наличными');await p.getByRole('button',{name:'Разобрать фразу',exact:true}).click();
  await p.getByLabel('Итог распознавания',{exact:true}).waitFor();if(await p.getByLabel('Распознанная сумма').inputValue()!=='5.50'||await p.getByLabel('Категория распознанной операции').inputValue()!=='cafes'||writes.length)throw Error('Unreviewed or invalid draft');
  await p.getByRole('button',{name:'Добавить операцию',exact:true}).scrollIntoViewIfNeeded();await p.screenshot({path:'D:/FamilyFinance/.playwright-mcp/quick-entry-'+width+'.png'});
  await p.getByRole('button',{name:'Добавить операцию',exact:true}).evaluate(b=>{b.click();b.click();});await p.getByRole('button',{name:'Ещё операция',exact:true}).waitFor();if(writes.length!==1||ledger[0].amount!==5.5||ledger[0].account_id!==cash)throw Error('Duplicate or wrong cash write');
  await p.getByRole('button',{name:'Ещё операция',exact:true}).click();await field.fill('Вчера получил двести наличными за подработку');await p.getByRole('button',{name:'Разобрать фразу',exact:true}).click();await p.getByRole('button',{name:'Добавить операцию',exact:true}).click();await p.getByRole('button',{name:'Ещё операция',exact:true}).waitFor();if(ledger[1].type!=='income'||ledger[1].amount!==200||ledger[1].category_id!=='income-freelance'||ledger[1].date===today)throw Error('Wrong income');
  await p.getByRole('button',{name:'Ещё операция',exact:true}).click();await field.fill('Снял сто с карты в наличные');await p.getByRole('button',{name:'Разобрать фразу',exact:true}).click();await p.getByRole('button',{name:'Записать перевод',exact:true}).click();await p.getByRole('button',{name:'Ещё операция',exact:true}).waitFor();const state=JSON.parse(await p.getByLabel('Test state').textContent());if(state.count!==3||state.balance!==2194.5||state.accountBalances[cash]!==1294.5||state.accountBalances[card]!==900)throw Error('Transfer corrupted capital '+JSON.stringify(state));
  await p.getByRole('button',{name:'Ещё операция',exact:true}).click();await field.fill('кофе 5 и обед 20');await p.getByRole('button',{name:'Разобрать фразу',exact:true}).click();await p.getByText('Не удалось однозначно определить сумму. Оставьте в фразе одну сумму.',{exact:true}).waitFor();if(await p.getByRole('button',{name:'Добавить операцию',exact:true}).count())throw Error('Ambiguous money can be saved');
  await field.fill('неизвестная покупка 10');await p.getByRole('button',{name:'Разобрать фразу',exact:true}).click();if(!await p.getByRole('button',{name:'Добавить операцию',exact:true}).isDisabled())throw Error('Unknown category guessed');await p.getByLabel('Категория распознанной операции').selectOption('other');failNext=true;await p.getByRole('button',{name:'Добавить операцию',exact:true}).click();await p.getByText('Проверочная ошибка сети Проверьте журнал перед повторной попыткой.',{exact:true}).waitFor();if(ledger.length!==3||await field.inputValue()!=='неизвестная покупка 10')throw Error('Failure lost draft or wrote money');
  await p.getByRole('button',{name:'Надиктовать операцию',exact:true}).click();await p.evaluate(()=>window.speechInstances.at(-1).onresult({results:[[{transcript:'Стрижка тридцать пять наличными'}]]}));await p.evaluate(()=>window.speechInstances.at(-1).onend());if(await p.getByLabel('Распознанная сумма').inputValue()!=='35.00'||await p.getByLabel('Категория распознанной операции').inputValue()!=='beauty')throw Error('Voice draft invalid');
  await p.getByRole('button',{name:'Надиктовать операцию',exact:true}).click();await p.getByRole('button',{name:'Назад к обзору',exact:true}).click();if(await p.evaluate(()=>window.speechAborts)<1)throw Error('Microphone not aborted on unmount');
  await p.getByRole('button',{name:'Ещё операция',exact:true}).click();await p.getByRole('button',{name:'Надиктовать операцию',exact:true}).click();await p.evaluate(()=>{const r=window.speechInstances.at(-1);r.onerror({error:'not-allowed'});r.onend?.();});await p.getByText(/Микрофон недоступен/).waitFor();
  await p.evaluate(()=>{delete window.SpeechRecognition;delete window.webkitSpeechRecognition;});await p.getByRole('button',{name:'Назад к обзору',exact:true}).click();await p.getByRole('button',{name:'Ещё операция',exact:true}).click();await p.getByText('Можно написать или надиктовать через микрофон клавиатуры.',{exact:true}).waitFor();
  await p.getByLabel('Сумма новой операции',{exact:true}).fill('7.25');await p.getByRole('button',{name:/Сохранить расход · 7.25 Br/}).click();await p.getByRole('button',{name:'Ещё операция',exact:true}).waitFor();if(ledger.length!==4||ledger[3].amount!==7.25||ledger[3].account_id!==cash)throw Error('Original manual form regressed');
  if(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1)||errors.length)throw Error(JSON.stringify(errors));
  results.push({width,reviewRequired:true,oneWriteOnDoubleClick:true,income:true,transferPreservesCapital:true,ambiguousBlocked:true,networkDraftPreserved:true,voice:true,permissionFallback:true,micCleanup:true,originalForm:true,noOverflow:true});await ctx.close();
 }
 return results;
}
