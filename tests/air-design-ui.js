// Air design: additional real-screen form, narrow-layout and touch checks.
// Run with Playwright browser_run_code_unsafe(filename), Vite on :5190.
async (page) => {
  const results=[];
  for (const width of [320,390]) {
    const context=await page.context().browser().newContext({viewport:{width,height:640},isMobile:true,hasTouch:true,serviceWorkers:'block',reducedMotion:'reduce'});
    try {
      const p=await context.newPage(),errors=[],remote=[];
      p.on('pageerror',e=>errors.push(e.message));
      p.on('request',r=>{if(/supabase\.co|prior\.by/.test(r.url()))remote.push(r.url());});
      const fit=async()=>{
        const failures=await p.evaluate(()=>[...document.querySelectorAll('.card,[role=dialog],.bank-connection')].filter(el=>{
          let parent=el.parentElement;
          while(parent){if(getComputedStyle(parent).overflowX==='auto'&&parent.scrollWidth>parent.clientWidth+1)return false;parent=parent.parentElement;}
          const r=el.getBoundingClientRect();return r.width>0&&(r.x<-.5||r.right>innerWidth+.5||el.scrollWidth>el.clientWidth+1);
        }).map(el=>el.className));
        if(failures.length)throw Error('Clipped form at '+width+': '+JSON.stringify(failures));
      };
      const shot=async name=>p.screenshot({path:'C:/Users/Honor/AppData/Local/Temp/finapp-air-'+name+'-'+width+'-b.png'});
      await p.goto('http://127.0.0.1:5190/?demo=1');await p.locator('.balance-value').waitFor();
      const design=await p.evaluate(()=>({bg:getComputedStyle(document.querySelector('.app-shell')).backgroundColor,hero:getComputedStyle(document.querySelector('.balance-hero')).backgroundColor,center:document.querySelector('.quick-action.is-primary').textContent}));
      if(design.bg!=='rgb(247, 247, 249)'||design.hero!=='rgba(0, 0, 0, 0)'||design.center!=='Банки')throw Error('Approved Air hierarchy/palette changed');
      for(const button of await p.locator('.quick-action').all()){const b=await button.boundingBox();if(b.width<44||b.height<44)throw Error('Quick action touch target');}
      const nav=p.getByRole('navigation'),go=name=>nav.getByRole('button',{name,exact:true}).click();
      await p.getByLabel('Записать перевод между счетами',{exact:true}).click();await fit();
      await shot('transfer');await p.keyboard.press('Escape');
      if(!await p.getByLabel('Записать перевод между счетами',{exact:true}).evaluate(el=>el===document.activeElement))throw Error('Transfer focus did not return to its new trigger');
      await go('Планы');
      await p.getByLabel('Создать цель накопления').click();await p.getByLabel('Название цели',{exact:true}).fill('Большая семейная мечта');await fit();await shot('goal-form');await p.keyboard.press('Escape');
      await p.getByRole('button',{name:'Отложить на цель',exact:true}).first().click();await fit();await shot('goal-reserve');await p.keyboard.press('Escape');
      await p.getByRole('button',{name:'Платежи',exact:true}).click();await p.getByLabel('Создать регулярный платеж').click();
      await p.getByRole('dialog',{name:'Регулярная операция',exact:true}).waitFor();await p.getByLabel('Сумма регулярного платежа в белорусских рублях').fill('100');await fit();await shot('recurring-form');await p.keyboard.press('Escape');
      await p.getByRole('button',{name:'Бюджет',exact:true}).click();
      await p.getByRole('button',{name:'Добавить категорию',exact:true}).click();await p.getByLabel('Сумма бюджета').fill('50');await fit();await shot('budget');
      // Seed a category reserve only in this isolated, local demo to expose the transfer form.
      await p.getByRole('button',{name:'Сохранить бюджет',exact:true}).click();await p.getByLabel('Сумма бюджета').waitFor({state:'detached'});
      await p.getByRole('button',{name:'Перенести деньги между категориями',exact:true}).click();await p.getByLabel('Сумма переноса бюджета').fill('10');await fit();
      await p.getByRole('button',{name:'Перенести деньги между категориями',exact:true}).click();
      await p.getByRole('button',{name:'+ Создать шаблон',exact:true}).click();await p.getByLabel('Название шаблона').fill('Мой план');
      await p.getByRole('button',{name:'+ Правило',exact:true}).click();await p.getByLabel('Сумма шаблона 2').fill('10');await fit();await shot('template');
      await p.getByRole('button',{name:'Закрыть',exact:true}).click();
      await p.getByRole('button',{name:'Фонды',exact:true}).click();await p.getByRole('button',{name:'+ Подушка',exact:true}).click();
      const essential=p.locator('details').filter({has:p.getByText('Необходимые категории',{exact:false})});
      if(await essential.getAttribute('open')!==null)throw Error('Emergency categories expanded on arrival');
      await essential.locator('summary').click();await essential.getByLabel('Жилье',{exact:false}).waitFor();await fit();await essential.locator('summary').click();
      await p.getByLabel('Необходимые расходы в месяц',{exact:true}).fill('1000');await p.getByLabel('Месяцы подушки').selectOption('3');await fit();await shot('emergency');
      await p.getByRole('button',{name:'Закрыть',exact:true}).click();await p.getByRole('button',{name:'+ Фонд расходов',exact:true}).click();
      await p.getByLabel('Название фонда').fill('Страховка');await p.getByLabel('Целевая сумма фонда').fill('300');await fit();await shot('fund');
      await p.getByRole('button',{name:'Закрыть',exact:true}).click();
      await go('Профиль');await fit();await p.getByRole('button',{name:'Карты и операции',exact:false}).click();
      await p.getByRole('button',{name:'Подключить Приорбанк',exact:true}).click();await p.getByLabel('Логин Prior Online',{exact:true}).fill('SYNTHETIC');
      await p.getByLabel('Пароль интернет-банка',{exact:false}).fill('SYNTHETIC');await fit();await shot('bank-login');
      await p.getByLabel('Закрыть вход в банк').click();
      if(await p.locator('input[name=prior-password]').count())throw Error('Closed bank form still contains a password input');
      if(errors.length||remote.length)throw Error(JSON.stringify({errors,remote}));
      results.push({width,airLayout:true,transferFocus:true,goalAndReserve:true,recurring:true,budgetAndTemplate:true,emergencyAndFund:true,profileBankAccess:true,noOverflow:true,noRealRequests:true});
    } finally {await context.close();}
  }
  return results;
}
