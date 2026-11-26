// Real auth, finance and screen components with synthetic HTTP and Realtime.
async page => {
  const results = [];
  for (const width of [320, 390]) {
    const context = await page.context().browser().newContext({
      viewport: { width, height: 820 }, isMobile: true, hasTouch: true, serviceWorkers: 'block',
    });
    const app = await context.newPage();
    const errors = [];
    app.on('pageerror', error => errors.push(error.message));
    const userId = '11111111-1111-4111-8111-111111111111';
    const householdId = '22222222-2222-4222-8222-222222222222';
    const accountId = '33333333-3333-4333-8333-333333333333';
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Minsk' }).format(new Date());
    const member = { id: userId, name: 'Тест', household_id: householdId };
    const ledger = Array.from({ length: 55 }, (_, i) => ({
      id: 'seed-' + i, household_id: householdId, added_by: userId, account_id: accountId,
      amount: 1, type: 'expense', kind: 'cashflow', category_id: 'other', comment: 'Запись ' + i, date: today,
    }));
    const writes = [];
    let journalReads = 0, profileReads = 0, nextReadGate, nextWriteMode = '', confirmationFails = false;
    let releaseBank;
    const bankGate = new Promise(resolve => { releaseBank = resolve; });

    await context.route('**/rest/v1/**', async route => {
      const request = route.request();
      const url = new URL(request.url());
      const table = url.pathname.split('/').at(-1);
      if (table === 'transactions' && request.method() === 'POST') {
        const body = request.postDataJSON();
        writes.push(body.id);
        if (ledger.some(item => item.id === body.id)) {
          await route.fulfill({ status: 409, json: { code: '23505', message: 'duplicate key' } });
          return;
        }
        ledger.unshift(body);
        if (nextWriteMode === 'lost') {
          nextWriteMode = '';
          await route.abort();
          return;
        }
        await route.fulfill({ status: 201, json: body });
        return;
      }
      if (table === 'transactions' && url.searchParams.has('id')) {
        if (confirmationFails) {
          confirmationFails = false;
          await route.abort();
          return;
        }
        await route.fulfill({ json: ledger.filter(item => 'eq.' + item.id === url.searchParams.get('id')) });
        return;
      }
      if (table === 'transactions') {
        journalReads++;
        const snapshot = ledger.slice();
        const gate = nextReadGate;
        nextReadGate = undefined;
        if (gate) await gate;
        await route.fulfill({ json: snapshot });
        return;
      }
      if (table === 'prior_bank_events') await bankGate;
      if (table === 'profiles' && url.searchParams.has('id')) {
        profileReads++;
        await route.fulfill({ json: member });
        return;
      }
      const data = {
        profiles: [member], households: { id: householdId, name: 'Тест' },
        accounts: [{ id: accountId, name: 'Наличные', kind: 'cash', currency: 'BYN', opening_balance: 100, is_archived: false, household_id: householdId }],
        prior_automation: [], prior_automation_reviews: [],
      };
      await route.fulfill({ json: data[table] ?? [] });
    });

    await context.route('**/src/main.tsx*', route => route.fulfill({ contentType: 'application/javascript', body: `
      import React from '/node_modules/.vite/deps/react.js';
      import ReactDOM from '/node_modules/.vite/deps/react-dom_client.js';
      import {supabase} from '/src/supabaseClient.ts';
      import {AuthProvider} from '/src/AuthContext.tsx';
      import {AppProvider} from '/src/AppContext.tsx';
      import {AppContent} from '/src/App.tsx';
      import '/src/index.css';
      const session = {access_token:'synthetic-token',user:{id:'${userId}'}};
      let notifying = false;
      supabase.auth.onAuthStateChange = callback => {
        const send = (event,value=session) => {
          notifying = true;
          try { callback(event,value); } finally { notifying = false; }
        };
        window.authNotice = send;
        const timer = setTimeout(()=>send('INITIAL_SESSION'),0);
        return {data:{subscription:{unsubscribe(){clearTimeout(timer)}}}};
      };
      supabase.auth.getSession = async () => {
        if (notifying) throw Error('Auth reentered synchronously');
        return {data:{session},error:null};
      };
      const listeners = new Map();
      supabase.channel = () => ({
        on(_event,filter,callback){listeners.set(filter.table,callback);return this;},
        subscribe(callback){callback?.('SUBSCRIBED');return this;},
      });
      supabase.removeChannel = async () => 'ok';
      window.realtime = (table,count) => {for(let i=0;i<count;i++) listeners.get(table)?.({});};
      ReactDOM.createRoot(document.getElementById('root')).render(
        React.createElement(AuthProvider,null,React.createElement(AppProvider,null,React.createElement(AppContent)))
      );
    ` }));
    await app.goto('http://127.0.0.1:5190/', { waitUntil: 'domcontentloaded' });
    await app.getByText('Запись 0', { exact: true }).waitFor({ timeout: 8_000 });
    if (await app.locator('.transaction-row').count() !== 40) throw Error('Large history was rendered at once');
    await app.getByRole('button', { name: 'Показать ещё операции' }).click();
    await app.getByText('Запись 54', { exact: true }).waitFor();
    await app.getByRole('textbox', { name: 'Поиск операций' }).fill('Запись 54');
    await app.waitForFunction(() => document.querySelectorAll('.transaction-row').length === 1);
    await app.evaluate(() => {
      window.authNotice('SIGNED_IN');
      window.authNotice('TOKEN_REFRESHED');
      window.realtime('transactions', 180);
    });
    await app.waitForTimeout(600);
    if (profileReads !== 1 || journalReads !== 2) throw Error(`Refreshes multiplied: profiles ${profileReads}, journal ${journalReads}`);

    await app.getByRole('button', { name: 'Добавить', exact: true }).click();
    const amount = app.getByLabel('Сумма новой операции', { exact: true });
    const note = app.getByLabel('Комментарий новой операции', { exact: true });
    await amount.fill('7.25');
    await note.fill('Быстрая запись');
    let releaseJournal;
    nextReadGate = new Promise(resolve => { releaseJournal = resolve; });
    await app.evaluate(() => window.realtime('transactions', 1));
    await app.waitForTimeout(400);
    await app.getByRole('button', { name: /Сохранить расход/ }).click();
    await app.getByText('Быстрая запись', { exact: true }).waitFor({ timeout: 2_000 });
    releaseJournal();
    await app.waitForTimeout(450);
    if (await app.getByText('Быстрая запись', { exact: true }).count() !== 1) throw Error('Stale GET lost confirmed write');

    await app.getByRole('button', { name: 'Добавить', exact: true }).click();
    await amount.fill('9.01');
    await note.fill('Потерянный ответ');
    nextWriteMode = 'lost';
    confirmationFails = true;
    await app.getByRole('button', { name: /Сохранить расход/ }).click();
    await app.getByText('Сервер не подтвердил сохранение. Можно повторить сохранение этой операции.', { exact: true }).waitFor();
    if (await note.inputValue() !== 'Потерянный ответ') throw Error('Failed request discarded draft');
    await app.getByRole('button', { name: /Сохранить расход/ }).click();
    await app.getByText('Потерянный ответ', { exact: true }).waitFor();
    if (writes.length !== 3 || writes[1] !== writes[2] || ledger.filter(row => row.id === writes[1]).length !== 1) {
      throw Error('Manual retry did not preserve the operation ID');
    }
    releaseBank();
    await app.evaluate(() => window.authNotice('SIGNED_OUT', null));
    await app.getByRole('button', { name: 'Войти', exact: true }).waitFor();
    if (await app.getByText('Потерянный ответ', { exact: true }).count()) throw Error('Journal leaked after logout');
    if (errors.length || await app.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)) {
      throw Error(JSON.stringify(errors));
    }
    results.push({ width, burstReads: 1, paginated: true, allHistorySearch: true, profileReads, immediateSave: true, retriedWithoutDuplicate: true, logout: true });
    await context.close();
  }
  return results;
}
