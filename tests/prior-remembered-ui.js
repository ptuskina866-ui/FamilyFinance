// Run with the connected Playwright browser_run_code_unsafe filename option while Vite serves :5190.
// Only synthetic providers/API responses in a fresh context; no real bank/financial requests.
async (page) => {
  const browser=page.context().browser(),results=[];
  for(const width of [320,390]) {
    const context=await browser.newContext({viewport:{width,height:900},isMobile:true,hasTouch:true,serviceWorkers:'block'}),p=await context.newPage();
    const errors=[],calls=[];p.on('pageerror',e=>errors.push(e.message));
    const account='11111111-1111-4111-8111-111111111111',source='b'.repeat(64);
    let connected=true,expired=false,selectedSource=source,delayNext=false,releaseLate,markDelayed;
    const delayedRequest=new Promise(resolve=>markDelayed=resolve);
    const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Minsk'}).format(new Date());
    const shift=n=>{const d=new Date(today+'T00:00:00Z');d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10);};
    const status=()=>({connected,reauthRequired:!connected,lastSyncedAt:connected?new Date().toISOString():null,selectedSourceKey:selectedSource,accountId:selectedSource===source?account:null});
    const snapshot={format:'finapp-prior',version:1,from:shift(-10),to:shift(-1),fetchedAt:new Date().toISOString(),card:{sourceKey:source,title:'Card',maskedNumber:'•••• 1234',currency:'BYN',records:[{date:shift(-2),description:'Already imported',accountAmount:'-56.78',operationAmount:'-56.78',operationCurrency:'BYN',fee:null,source:'history'},{date:shift(-1),description:'Shop <img src=x onerror=alert(1)>',accountAmount:'-12.34',operationAmount:'-4.99',operationCurrency:'EUR',fee:'0.10',source:'history'}]}};
    await context.route('**/functions/v1/prior-connect',async route=>{
      const body=route.request().postDataJSON();calls.push(body);
      if(body.action==='sync'&&delayNext){delayNext=false;await new Promise(resolve=>{releaseLate=resolve;markDelayed();});}
      if(body.action==='disconnect')connected=false;
      if(body.action==='connect'){connected=true;expired=false;}
      if(body.action==='select')selectedSource=body.sourceKey;
      const failure=body.action==='sync'&&expired;
      const cards=width===390?[snapshot,{...snapshot,card:{...snapshot.card,sourceKey:'c'.repeat(64),title:'Second card'}}]:[snapshot];
      const value=failure?{code:'SESSION_EXPIRED'}:['sync','connect'].includes(body.action)?{format:'finapp-prior-connection',version:1,cards,externalCards:0,connection:status()}:{format:'finapp-prior-status',version:1,connection:status()};
      try {await route.fulfill({status:failure?400:200,json:value});} catch { /* The test intentionally cancels one browser request. */ }
    });
    await context.route('**/rest/v1/**',r=>r.fulfill({status:500,json:{message:'Unexpected real request'}}));
    await context.route('**/src/main.tsx*',r=>r.fulfill({contentType:'application/javascript',body:`
      import React from '/node_modules/.vite/deps/react.js';
      import ReactDOM from '/node_modules/.vite/deps/react-dom_client.js';
      import {AppContext} from '/src/AppContext.tsx'; import {AuthContext} from '/src/AuthContext.tsx';
      import {PriorImportPanel} from '/src/components/PriorImportPanel.tsx';import {CATEGORIES} from '/src/mockData.ts';import '/src/index.css';
      const account='${account}';let imported=[0];window.__saves=[];
      function Harness(){const [key,setKey]=React.useState(0),[ready,setReady]=React.useState(${width!==390});
        React.useEffect(()=>{const timer=setTimeout(()=>setReady(true),300);return()=>clearTimeout(timer);},[]);
        const auth={user:{id:'synthetic-owner'},profile:{id:'synthetic-owner',household_id:'synthetic-family'}};
        const app={accounts:ready?[{id:account,name:'My bank',kind:'bank',currency:'BYN',is_archived:false}]:[],transactions:[],categories:CATEGORIES,accountBalances:{[account]:100},financeLoading:!ready,financeError:null,
          previewPriorImport:async()=>({importedIndexes:imported,linked:true,possibleIndexes:[]}),
          importPriorOperations:async(a,s,items)=>{window.__saves.push({a,s,items});imported=[...new Set([...imported,...items.map(i=>i.index)])];return {imported:items.length,skipped:0};}};
        return React.createElement(AuthContext.Provider,{value:auth},React.createElement(AppContext.Provider,{value:app},React.createElement('button',{onClick:()=>setKey(k=>k+1)},'Reopen test'),React.createElement(PriorImportPanel,{key})));}
      ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(React.StrictMode,null,React.createElement(Harness)));
    `}));
    await p.goto('http://127.0.0.1:5190/');
    await p.getByText('Проверка пройдена.',{exact:false}).waitFor({timeout:10000});
    if(calls.filter(c=>c.action==='sync').length!==1)throw Error('Opening sync count');
    if(await p.locator('input[name=prior-password]').count())throw Error('Unexpected login');
    if(await p.getByLabel('Счёт для операций Приорбанка').inputValue()!==account)throw Error('Lost saved account');
    if(await p.getByText('Already imported',{exact:true}).count())throw Error('Imported row visible');
    if(await p.locator('article img').count())throw Error('HTML injected');
    await p.getByLabel('Выбрать операцию 2',{exact:true}).check();
    const category=p.getByLabel('Категория операции 2',{exact:true});if(!await category.inputValue())await category.selectOption('other');
    await p.screenshot({path:'C:/Users/Honor/AppData/Local/Temp/finapp-prior-remembered-'+width+'.png',fullPage:true});
    await p.getByRole('button',{name:'Добавить выбранные операции (1)',exact:true}).click();
    await p.getByText('Всё добавлено.',{exact:false}).waitFor({timeout:10000});
    const saved=await p.evaluate(()=>window.__saves);if(saved.length!==1||saved[0].items[0].index!==1)throw Error('Wrong selection');
    await p.getByRole('button',{name:'Reopen test',exact:true}).click();await p.getByText('Всё добавлено.',{exact:false}).waitFor({timeout:10000});
    if(calls.filter(c=>c.action==='sync').length!==2||calls.some(c=>c.action==='connect'))throw Error('Revisit relogged');
    if(width===390){
      await p.getByLabel('Карта Приорбанка',{exact:true}).selectOption('1');await p.getByRole('button',{name:'Запомнить карту и показать операции',exact:true}).click();
      await p.locator('p').filter({hasText:'Second card · •••• 1234 · BYN'}).waitFor();
      if(await p.getByLabel('Счёт для операций Приорбанка').inputValue())throw Error('Another card inherited account');
      await p.getByLabel('Карта Приорбанка',{exact:true}).selectOption('0');await p.getByRole('button',{name:'Запомнить карту и показать операции',exact:true}).click();
      await p.getByText('Всё добавлено.',{exact:false}).waitFor();
      if(calls.filter(c=>c.action==='select').length!==2)throw Error('Card preference not saved');
    }
    delayNext=true;await p.getByRole('button',{name:'Обновить операции',exact:true}).click();
    await delayedRequest;await p.getByRole('button',{name:'Отменить ожидание',exact:true}).click();releaseLate();
    await p.getByText('Ожидание отменено.',{exact:false}).waitFor();
    if(await p.getByLabel('Выбрать операцию 2',{exact:true}).count())throw Error('Late cancelled result accepted');
    expired=true;await p.getByRole('button',{name:'Обновить операции',exact:true}).click();
    await p.locator('input[name=prior-password]').waitFor({timeout:10000});
    await p.locator('input[name=prior-login]').fill('SyntheticUser');await p.locator('input[name=prior-password]').fill('Synthetic123!');
    await p.getByLabel('Разрешаю вход и сохранение защищённой банковской сессии.',{exact:false}).check();
    await p.getByRole('button',{name:'Подключить и получить операции',exact:true}).click();
    await p.getByText('Приорбанк подключён',{exact:true}).waitFor({timeout:10000});
    if(await p.locator('input[name=prior-password]').count())throw Error('Password form retained');
    await p.getByRole('button',{name:'Отключить банк',exact:true}).click();await p.getByRole('button',{name:'Удалить подключение',exact:true}).click();
    await p.getByText('Подключение удалено.',{exact:false}).waitFor({timeout:10000});
    if(await p.getByLabel('Выбрать операцию 2',{exact:true}).count())throw Error('Draft retained');
    const overflow=await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth);
    if(overflow||errors.length)throw Error(JSON.stringify({overflow,errors}));
    results.push({width,autoSync:true,revisitWithoutLogin:true,selectedOnly:true,expiryLogin:true,disconnect:true,overflow,errors,actions:calls.map(c=>c.action)});
    await context.close();
  }
  return results;
}
