// Synthetic providers/API only. Exercises the actual cache-reading transport and review component.
async page=>{
  const results=[];
  for(const width of [320,390]){
    const context=await page.context().browser().newContext({viewport:{width,height:740},isMobile:true,hasTouch:true,serviceWorkers:'block'}),p=await context.newPage();
    const errors=[],calls=[];p.on('pageerror',e=>errors.push(e.message));
    const account='11111111-1111-4111-8111-111111111111',source='b'.repeat(64);
    const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Minsk'}).format(new Date());
    const d=new Date(today+'T00:00:00Z');d.setUTCDate(d.getUTCDate()-1);const yesterday=d.toISOString().slice(0,10);
    const row=(description,amount,extra={})=>({date:yesterday+'T14:30:00+03:00',description,accountAmount:amount,operationAmount:amount,operationCurrency:'BYN',fee:null,source:'history',...extra});
    const snapshot={format:'finapp-prior',version:1,from:yesterday,to:yesterday,fetchedAt:new Date().toISOString(),card:{sourceKey:source,title:'Test card',maskedNumber:'•••• 1234',currency:'BYN',records:[row('Imported','-50.00'),row('New shop','-12.34'),row('Online top-up','-10.00',{source:'additional',accountAmount:null}),row('MAK.BY','27.00',{source:'additional',accountAmount:null})]}};
    const state={connected:true,reauthRequired:false,lastSyncedAt:snapshot.fetchedAt,selectedSourceKey:source,accountId:account};
    await context.route('**/functions/v1/prior-connect',async r=>{
      const body=r.request().postDataJSON();calls.push(body);
      if(!['view','refresh'].includes(body.action))throw Error('Unexpected banking action '+body.action);
      await r.fulfill({json:{format:'finapp-prior-connection',version:1,cards:[snapshot],externalCards:0,connection:state,syncState:body.action==='view'?'saved':'updating'}});
    });
    await context.route('**/rest/v1/**',async r=>{const url=r.request().url();if(url.includes('/prior_automation_reviews'))await r.fulfill({json:[]});else if(url.includes('/prior_automation?'))await r.fulfill({json:null});else throw Error('Unexpected database request');});
    await context.route('**/src/main.tsx*',r=>r.fulfill({contentType:'application/javascript',body:`
      import React from '/node_modules/.vite/deps/react.js';import ReactDOM from '/node_modules/.vite/deps/react-dom_client.js';
      import {AppContext} from '/src/AppContext.tsx';import {AuthContext} from '/src/AuthContext.tsx';import {PriorImportPanel} from '/src/components/PriorImportPanel.tsx';import {CATEGORIES} from '/src/mockData.ts';import '/src/index.css';
      function Harness(){const [key,setKey]=React.useState(0);const app={accounts:[{id:'${account}',name:'Bank',kind:'bank',currency:'BYN',is_archived:false}],transactions:[{id:'manual',kind:'cashflow',type:'expense',amount:27,date:'${yesterday}',accountId:'${account}',categoryId:'cafes',comment:'Manual purchase'}],categories:CATEGORIES,accountBalances:{'${account}':100},financeLoading:false,financeError:null,previewPriorImport:async()=>({linked:true,importedIndexes:[0],possibleIndexes:[]}),importPriorOperations:async()=>{throw Error('No save authorized in this test');}};
      return React.createElement(AuthContext.Provider,{value:{user:{id:'synthetic-owner'},profile:{household_id:'synthetic-family'}}},React.createElement(AppContext.Provider,{value:app},React.createElement('main',{className:'app-shell',style:{padding:16,overflowY:'auto',height:'100dvh'}},React.createElement('button',{onClick:()=>setKey(k=>k+1)},'Reopen test'),React.createElement(PriorImportPanel,{key}))));}
      ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(React.StrictMode,null,React.createElement(Harness)));
    `}));
    await p.goto('http://127.0.0.1:5190/');await p.getByText('Можно добавить: 1',{exact:true}).waitFor();
    await p.getByText('Статус уточняется: 2.',{exact:false}).waitFor();
    if(calls.some(c=>c.action==='refresh'))throw Error('Opening triggered a bank refresh');
    if((await p.locator('body').innerText()).includes('Invalid Date'))throw Error('Invalid date visible');
    await p.getByText('Сумма в ответе банка: -10.00 BYN',{exact:true}).waitFor();
    await p.getByText('В журнале уже есть запись с такой суммой',{exact:false}).waitFor();
    if(await p.getByLabel('Выбрать операцию 3',{exact:true}).count())throw Error('Unknown top-up offers approval');
    if(await p.getByLabel('Выбрать операцию 4',{exact:true}).count())throw Error('Unknown expense offers approval');
    await p.getByText('Сумма в ответе банка: -10.00 BYN',{exact:true}).scrollIntoViewIfNeeded();
    await p.screenshot({path:'D:/FamilyFinance/.playwright-mcp/prior-sync-unverified-'+width+'.png'});
    await p.getByLabel('Выбрать операцию 2',{exact:true}).check();
    await p.getByLabel('Категория операции 2',{exact:true}).selectOption('other');
    await p.getByRole('button',{name:'Обновить операции',exact:true}).click();
    await p.getByText('Банк уже обновляется.',{exact:false}).waitFor();
    if(!await p.getByLabel('Выбрать операцию 2',{exact:true}).isChecked())throw Error('Busy refresh discarded selection');
    if(await p.getByLabel('Категория операции 2',{exact:true}).inputValue()!=='other')throw Error('Busy refresh discarded category');
    if(await p.getByRole('alert').count())throw Error('False error during worker update');
    if(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1))throw Error('Overflow');
    await p.screenshot({path:'D:/FamilyFinance/.playwright-mcp/prior-sync-clarity-'+width+'.png',fullPage:true});
    if(width===320)await new Promise(resolve=>setTimeout(resolve,20_000));
    await p.getByRole('button',{name:'Reopen test',exact:true}).click();await p.getByText('Можно добавить: 1',{exact:true}).waitFor();
    if(calls.filter(c=>c.action==='refresh').length!==1)throw Error('Reopen triggered a second bank request');
    if(errors.length)throw Error(errors.join('\n'));
    results.push({width,reopenAfterSeconds:width===320?20:0,datesValid:true,countsCorrect:true,rawSignPreserved:true,manual27Warning:true,selectionRetained:true,falseErrors:false,actions:calls.map(c=>c.action)});await context.close();
  }
  return results;
}
