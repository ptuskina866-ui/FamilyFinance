// Real screens; all writes are confined to isolated local demo contexts.
// Run with browser_run_code_unsafe(filename), Vite on :5190.
async page=>{
  const results=[];
  for(const width of [320,390]){
    const context=await page.context().browser().newContext({viewport:{width,height:640},isMobile:true,hasTouch:true,serviceWorkers:'block',reducedMotion:'reduce'});
    try{
      const p=await context.newPage(),errors=[],remote=[];p.on('pageerror',e=>errors.push(e.message));p.on('request',r=>{if(/supabase\.co|prior\.by/.test(r.url()))remote.push(r.url());});
      const cents=text=>BigInt(text.replace(/[^0-9-]/g,''));
      const fit=async()=>{
        const bad=await p.evaluate(()=>[...document.querySelectorAll('.category-picker,[role=dialog],.daily-card,.monthly-strip')].filter(el=>el.getBoundingClientRect().width&&el.scrollWidth>el.clientWidth+1).map(el=>el.className));
        if(bad.length||await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth))throw Error('Clipping '+JSON.stringify(bad));
      };
      await p.goto('http://127.0.0.1:5190/?demo=1');await p.locator('.balance-value').waitFor();const before=cents(await p.locator('.balance-value').innerText());
      const colors=await p.evaluate(()=>['.daily-card','.account-card[data-kind=bank]','.account-card[data-kind=cash]'].map(sel=>getComputedStyle(document.querySelector(sel)).backgroundColor));
      if(colors.includes('rgb(255, 255, 255)')||new Set(colors).size!==3)throw Error('Missing visual landmarks');
      await p.screenshot({path:'C:/Users/Honor/AppData/Local/Temp/finapp-accents-home-'+width+'-b.png'});
      const nav=p.getByRole('navigation');await nav.getByRole('button',{name:'Добавить',exact:true}).click();
      const query=p.getByLabel('Поиск категорий',{exact:true});await p.getByLabel('Сумма новой операции').fill('12.34');
      await p.getByRole('button',{name:'Еда и кафе',exact:true}).click();await query.fill('капеечка');
      await p.getByRole('button',{name:'Копеечка',exact:true}).click();
      if(await p.getByRole('button',{name:'Копеечка',exact:true}).getAttribute('aria-pressed')!=='true')throw Error('Category selection failed');
      await query.fill('vape');await p.getByRole('button',{name:'Вейп и табак',exact:true}).click();await fit();
      await p.getByLabel('Очистить поиск категорий').click();
      for(const name of ['Еда и кафе','Счета и связь','Жизнь и прочее'])if(await p.getByRole('button',{name,exact:true}).evaluate(el=>el.scrollWidth>el.clientWidth+1))throw Error('Shrunken group label '+name);
      await query.fill('несуществующаякатегория');await p.getByRole('status').filter({hasText:'Ничего не найдено'}).waitFor();
      await query.fill('вэйп');await p.getByRole('button',{name:'Вейп и табак',exact:true}).click();await fit();
      await p.getByLabel('Комментарий новой операции').fill('Вейп: проверка интерфейса');
      await p.getByRole('button',{name:'Сохранить расход · 12.34 Br',exact:true}).click();await p.locator('.balance-value').waitFor();
      if(cents(await p.locator('.balance-value').innerText())!==before-1234n)throw Error('Expense amount changed');
      if(!(await p.locator('.transaction-row').filter({hasText:'Вейп: проверка интерфейса'}).innerText()).includes('Вейп и табак'))throw Error('Lost saved expense category');
      await nav.getByRole('button',{name:'Добавить',exact:true}).click();await p.getByRole('button',{name:'Доход',exact:true}).click();
      if(await query.inputValue()!=='')throw Error('Search not reset on type change');
      for(const icon of await p.locator('.category-choice-icon').all()){const b=await icon.boundingBox();if(b.height<44||b.width<44)throw Error('Income grid compressed category icons');}
      for(const [search,label]of [['куфар','Продажа вещей'],['пенсия','Пенсия'],['ип','Самозанятость / ИП'],['возврат','Возврат покупки']]){await query.fill(search);await p.getByRole('button',{name:label,exact:true}).click();await fit();}
      await p.getByText('Будет учтён как поступление. Исходная покупка останется в расходах.',{exact:true}).waitFor();
      await query.fill('стипендия');await p.getByRole('button',{name:'Стипендия',exact:true}).click();await p.getByLabel('Сумма новой операции').fill('150.01');await fit();
      await p.screenshot({path:'C:/Users/Honor/AppData/Local/Temp/finapp-accents-income-'+width+'-b.png'});
      await p.getByLabel('Комментарий новой операции').fill('Стипендия: проверка интерфейса');await p.getByRole('button',{name:'Сохранить доход · 150.01 Br',exact:true}).click();await p.locator('.balance-value').waitFor();
      if(cents(await p.locator('.balance-value').innerText())!==before-1234n+15001n)throw Error('Income amount changed');
      await p.getByLabel('Поиск операций').fill('Стипендия: проверка интерфейса');await p.getByLabel('Редактировать операцию',{exact:true}).click();
      const editor=p.getByRole('dialog',{name:'Редактировать операцию'});if(await editor.getByRole('combobox').first().inputValue()!=='income-scholarship')throw Error('Editor lost new income category');
      await p.getByLabel('Закрыть редактирование').click();await fit();
      if(errors.length||remote.length)throw Error(JSON.stringify({errors,remote}));results.push({width,visualLandmarks:true,searchAndGroups:true,newExpenseAndIncomeRoundtrip:true,exactAmounts:true,editor:true,noOverflow:true,noRealRequests:true});
    }finally{await context.close();}
  }
  return results;
}
