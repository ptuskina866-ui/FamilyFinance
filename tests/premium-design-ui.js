// Run using Playwright browser_run_code_unsafe(filename) with Vite on :5190.
// Real screens + isolated development demo; financial changes stay in this test context.
async (page) => {
  const browser=page.context().browser(),results=[];
  for(const width of [320,390,1024]) {
    const context=await browser.newContext({viewport:{width,height:width===1024?768:844},isMobile:width<640,hasTouch:width<640,serviceWorkers:'block',reducedMotion:'reduce'});
    const p=await context.newPage(),errors=[],remote=[];
    p.on('pageerror',e=>errors.push(e.message));
    p.on('request',r=>{if(r.url().includes('supabase.co')||r.url().includes('prior.by'))remote.push(r.url());});
    await p.goto('http://127.0.0.1:5190/?demo=1');
    const nav=p.getByRole('navigation',{name:'Основная навигация'});await nav.waitFor();
    const go=label=>nav.getByRole('button',{name:label,exact:true}).click();
    const fit=async()=>{if(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth))throw Error('Horizontal overflow '+width);};
    const money=value=>BigInt(value.replace(/[^0-9-]/g,''));
    const before=money(await p.locator('.balance-value').innerText());
    const daily=await p.locator('.daily-card').boundingBox();const navBox=await nav.boundingBox();
    if(daily.y+daily.height>navBox.y)throw Error('Daily decision hidden below navigation');
    for(const button of await nav.getByRole('button').all()){const b=await button.boundingBox();if(b.width<44||b.height<44)throw Error('Small navigation target');}
    if(width<640){
      const carousel=p.locator('section[aria-labelledby="accounts-heading"] .overflow-x-auto');await carousel.scrollIntoViewIfNeeded();
      const box=await carousel.boundingBox(),touch=await context.newCDPSession(p);
      await touch.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:box.x+box.width*.8,y:box.y+box.height*.5}]});
      for(let step=1;step<=6;step++)await touch.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:box.x+box.width*(.8-step*.09),y:box.y+box.height*.5}]});
      await touch.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
      await p.waitForFunction(()=>document.querySelector('section[aria-labelledby="accounts-heading"] .overflow-x-auto').scrollLeft>10);
      await touch.detach();
    }
    const more=p.locator('.overview-disclosure');
    if(await more.getAttribute('open')!==null)throw Error('Extra home cards are expanded on arrival');
    await p.getByLabel('Скрыть суммы',{exact:true}).click();
    await more.locator(':scope > summary').click();
    await p.locator('.goal-preview').waitFor();
    if(/\d[\s\S]*Br/.test(await p.locator('.goal-preview').innerText()))throw Error('Goal amounts leak when expanded');
    await more.locator(':scope > summary').click();
    if(await p.locator('.goal-preview').isVisible())throw Error('Extra home cards did not collapse');
    for(const target of ['.balance-value','.daily-amount','.transaction-amount'])for(const value of await p.locator(target).allTextContents())if(!value.includes('••••'))throw Error('Visible money in privacy mode');
    if(/\d[\s\S]*Br/.test(await p.locator('.monthly-strip').innerText()))throw Error('Monthly totals leak');
    await p.getByLabel('Показать суммы',{exact:true}).click();
    await p.getByRole('button',{name:'Операции',exact:true}).click();await p.getByLabel('Поиск операций').fill('Продукты на неделю');
    const rowBox=await p.locator('.transaction-row').first().boundingBox(),journalNav=await nav.boundingBox();
    if(journalNav.y+journalNav.height>(width===1024?768:844)||journalNav.y<0)throw Error('Journal moved the navigation out of view');
    if(rowBox.y+rowBox.height>journalNav.y)throw Error('Search result is below navigation');
    if(await p.locator('.transaction-row').count()!==1)throw Error('Journal search regression');
    await p.screenshot({path:'C:/Users/Honor/AppData/Local/Temp/finapp-premium-journal-'+width+'.png'});
    await p.getByLabel('Редактировать операцию',{exact:true}).click();await p.getByRole('dialog',{name:'Редактировать операцию'}).waitFor();
    await p.getByLabel('Закрыть редактирование').click();await p.getByLabel('Поиск операций').fill('');
    await p.getByLabel('Записать перевод между счетами',{exact:true}).click();
    await p.getByText('Запись для учёта денег. Чтобы перевести их, выполните перевод в банке.',{exact:true}).waitFor();
    await p.getByLabel('Закрыть окно счетов').click();
    await p.getByLabel('Добавить счет',{exact:true}).click();await p.getByRole('dialog',{name:'Новый счет'}).waitFor();
    await p.getByLabel('Закрыть окно счетов').click();
    await go('Аналитика');await p.getByRole('heading',{name:'Аналитика',exact:true}).waitFor();
    if(!await p.locator('.recharts-area-curve').getAttribute('d'))throw Error('Chart missing');
    await p.getByLabel('Предыдущий месяц').click();await p.getByLabel('Следующий месяц').click();
    await p.getByRole('button',{name:'Доходы',exact:true}).click();await p.getByRole('button',{name:'Расходы',exact:true}).click();await fit();
    await p.screenshot({path:'C:/Users/Honor/AppData/Local/Temp/finapp-premium-analytics-'+width+'.png'});
    await go('Планы');for(const label of ['Платежи','Бюджет','Фонды','Цели']){await p.getByRole('button',{name:label,exact:true}).click();await fit();}
    await p.getByLabel('Создать цель накопления').click();await p.getByRole('dialog').waitFor();
    await p.keyboard.press('Escape');if(await p.getByRole('dialog').count())throw Error('Goal dialog Escape regression');
    await go('Профиль');await p.getByRole('heading',{name:'Профиль',exact:true}).waitFor();await fit();
    await go('Добавить');await p.getByLabel('Сумма новой операции').fill('1.23');
    await p.getByLabel('Комментарий новой операции').fill('Дизайн: контрольная запись');
    await p.getByRole('button',{name:'Сохранить расход · 1.23 Br',exact:true}).click();
    await p.locator('.balance-value').waitFor();const after=money(await p.locator('.balance-value').innerText());if(before-after!==123n)throw Error('Exact balance/save regression');
    await p.getByRole('button',{name:'Банки и операции',exact:true}).click();await p.getByRole('heading',{name:'Приорбанк',exact:true}).waitFor();
    if(!(await p.locator('body').innerText()).includes('Демо не подключается к банку'))throw Error('Missing honest demo bank state');
    await p.getByRole('button',{name:'Подключить Приорбанк',exact:true}).click();
    await p.getByLabel('Логин Prior Online',{exact:true}).waitFor();
    if(await p.getByText('Другой период',{exact:true}).isVisible())throw Error('Bank settings expanded by default');
    await p.getByRole('button',{name:'Отмена',exact:true}).click();
    await p.getByRole('button',{name:'Подключить Приорбанк',exact:true}).waitFor();
    await p.getByRole('button',{name:'Выписка Альфы',exact:true}).click();await fit();
    await p.getByLabel('Вернуться к обзору').click();await p.getByRole('navigation').waitFor();
    await p.screenshot({path:'C:/Users/Honor/AppData/Local/Temp/finapp-premium-home-'+width+'.png'});
    if(errors.length||remote.length)throw Error(JSON.stringify({width,errors,remote}));
    results.push({width,navigation:true,dailyVisible:true,privacy:true,journal:true,dialogs:true,chart:true,planningTabs:true,exactDemoSave:true,bankFallback:true,noRealRequests:true});
    await context.close();
  }
  // Login/registration remain navigable, labelled and visible with the keyboard-sized viewport.
  const c=await browser.newContext({viewport:{width:320,height:640},isMobile:true,hasTouch:true,serviceWorkers:'block',reducedMotion:'reduce'}),p=await c.newPage();
  await p.goto('http://127.0.0.1:5190/');await p.getByLabel('Email',{exact:true}).fill('test@example.invalid');await p.getByLabel('Пароль',{exact:true}).fill('SYNTHETIC');
  await p.getByRole('button',{name:'Зарегистрироваться',exact:true}).click();await p.getByLabel('Ваше имя',{exact:true}).fill('Тест');
  await p.getByRole('button',{name:'По приглашению',exact:true}).click();await p.getByPlaceholder('Вставьте код из профиля партнера').waitFor();
  await p.getByLabel('Вернуться ко входу').click();await p.getByRole('button',{name:'Войти',exact:true}).waitFor();
  results.push({loginRegistration320:true});await c.close();return results;
}
