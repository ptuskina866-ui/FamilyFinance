// Real components with intercepted synthetic metadata/RPCs. No bank or working financial data.
async page=>{
  const results=[];
  for(const width of [320,390]){
    const context=await page.context().browser().newContext({viewport:{width,height:740},isMobile:true,hasTouch:true,serviceWorkers:'block'}),p=await context.newPage();
    const errors=[],calls=[];p.on('pageerror',e=>errors.push(e.message));
    const owner='11111111-1111-4111-8111-111111111111',household='22222222-2222-4222-8222-222222222222',account='33333333-3333-4333-8333-333333333333',source='f'.repeat(64);
    let state=null,reviews=[],fail=false,hold=false,releasePending,notifyPending;
    const pendingRequest=new Promise(resolve=>notifyPending=resolve);
    await context.route('**/rest/v1/**',async route=>{
      const url=route.request().url(),body=route.request().postDataJSON();
      if(url.includes('/rpc/set_prior_automation')){calls.push(body);if(fail){await route.fulfill({status:400,json:{message:'PRIOR_AUTO_SESSION'}});return;}
        if(hold){notifyPending();await new Promise(resolve=>releasePending=resolve);}
        state={owner_id:owner,household_id:household,account_id:account,source_key:source,enabled:body.p_enabled,started_on:'2026-10-23',last_checked_at:null,issue:null,imported_count:0,additional_count:0};
        await route.fulfill({json:null});return;
      }
      if(url.includes('/rpc/ignore_prior_automation_review')){reviews=[];await route.fulfill({json:null});return;}
      if(url.includes('/prior_automation_reviews')){await route.fulfill({json:reviews});return;}
      if(url.includes('/prior_automation?')){await route.fulfill({json:new URL(url).searchParams.get('owner_id')==='eq.'+owner?state:null});return;}
      throw Error('Unexpected request '+url);
    });
    await context.route('**/src/main.tsx*',r=>r.fulfill({contentType:'application/javascript',body:`
      import React from '/node_modules/.vite/deps/react.js';import ReactDOM from '/node_modules/.vite/deps/react-dom_client.js';
      import {AuthContext} from '/src/AuthContext.tsx';import {PriorAutomation} from '/src/components/PriorAutomation.tsx';import '/src/index.css';
      function Harness(){const [version,setVersion]=React.useState(0),[owner,setOwner]=React.useState('${owner}');window.__switchOwner=()=>setOwner('44444444-4444-4444-8444-444444444444');return React.createElement(AuthContext.Provider,{value:{user:{id:owner},profile:{household_id:'${household}'}}},React.createElement('main',{className:'app-shell',style:{overflowY:'auto',padding:16,height:'100dvh'}},React.createElement('button',{onClick:()=>setVersion(v=>v+1)},'Reopen test'),React.createElement(PriorAutomation,{key:version,accountId:'${account}',sourceKey:'${source}',linked:false})));}
      ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(React.StrictMode,null,React.createElement(Harness)));
    `}));
    await p.goto('http://127.0.0.1:5190/');
    const toggle=p.getByRole('switch',{name:'Автоматический учёт',exact:true});await toggle.waitFor();await toggle.click();
    if(calls.length)throw Error('Enabled without one-time setup');
    await p.getByText('Начальный остаток выбранного счёта',{exact:false}).waitFor();
    await p.getByRole('button',{name:'Включить автоматическое добавление',exact:true}).click();
    await p.getByText('Первая проверка начнётся',{exact:false}).waitFor();
    if(await toggle.getAttribute('aria-checked')!=='true')throw Error('Switch state');
    if(calls.length!==1||calls[0].p_account_id!==account||calls[0].p_source_key!==source)throw Error('Wrong opt-in source');
    state={...state,last_checked_at:new Date().toISOString(),imported_count:2,additional_count:1};
    reviews=[{event_key:'test',day:'2026-10-23',description:'Shop <img src=x onerror=alert(1)>',amount:'-12.34',reason:'similar'}];
    await p.getByRole('button',{name:'Reopen test',exact:true}).click();
    await p.getByText('Добавлено автоматически: 2.',{exact:false}).waitFor();
    await p.locator('summary').filter({hasText:'Для сверки'}).click();
    await p.getByText('Shop <img src=x onerror=alert(1)>',{exact:true}).waitFor();
    if(await p.locator('article img').count())throw Error('Unsafe description');
    if(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1))throw Error('Horizontal overflow');
    await p.screenshot({path:'D:/FamilyFinance/.playwright-mcp/prior-auto-'+width+'.png',fullPage:true});
    await p.getByRole('button',{name:'Не добавлять эту запись',exact:true}).click();
    await p.getByText('Shop <img src=x onerror=alert(1)>',{exact:true}).waitFor({state:'detached'});
    await toggle.click();await p.getByText('Новые операции будут добавляться сами',{exact:true}).waitFor();
    if(calls.at(-1).p_enabled!==false)throw Error('Disable missing');
    fail=true;await toggle.click();await p.getByRole('button',{name:'Включить автоматическое добавление',exact:true}).click();
    await p.getByRole('alert').filter({hasText:'Сначала войдите'}).waitFor();
    if(await toggle.getAttribute('aria-checked')!=='false')throw Error('False successful enable');
    fail=false;hold=true;await p.getByRole('button',{name:'Включить автоматическое добавление',exact:true}).click();await pendingRequest;
    await p.evaluate(()=>window.__switchOwner());
    await p.getByText('Новые операции будут добавляться сами',{exact:true}).waitFor();
    if(!await toggle.isEnabled())throw Error('New owner stuck behind previous request');
    releasePending();await p.getByRole('button',{name:'Включить автоматическое добавление',exact:true}).waitFor({state:'detached'});
    if(await toggle.getAttribute('aria-checked')!=='false')throw Error('Late previous-owner state leaked');
    if(errors.length)throw Error(errors.join('\n'));
    results.push({width,checks:'setup, enable, counters, review, HTML escaping, ignore, disable, expired session, no overflow/errors'});await context.close();
  }
  return results;
}
