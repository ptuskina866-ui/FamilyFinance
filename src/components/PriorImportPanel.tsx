import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, ChevronDown, UploadCloud } from 'lucide-react';
import { useApp } from '../AppContext';
import { useAuth } from '../AuthContext';
import type { PriorImportCheck, PriorImportResult, PriorImportSelection, PriorImportSnapshot } from '../types';
import { parsePriorImportFile, PRIOR_FILE_LIMIT, priorBlockedReason, priorPossibleDuplicates } from '../lib/priorImport';
import { toMinorUnits } from '../lib/money';
import { AlfaBankService } from '../services/alfaBankService';
import { PriorBankConnection } from './PriorBankConnection';
import { PriorAutomation } from './PriorAutomation';

export function PriorImportPanel() {
  const { accounts, transactions, categories, accountBalances, financeLoading, financeError, previewPriorImport, importPriorOperations } = useApp();
  const { user, profile } = useAuth();
  const [snapshot, setSnapshot] = useState<PriorImportSnapshot | null>(null);
  const [accountId, setAccountId] = useState('');
  const [checked, setChecked] = useState<PriorImportCheck | null>(null);
  const [items, setItems] = useState<Record<number, PriorImportSelection>>({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [result, setResult] = useState<PriorImportResult | null>(null);
  const [page, setPage] = useState(0);
  const [connecting, setConnecting] = useState(false);
  const [showImported, setShowImported] = useState(false);
  const version = useRef(0), pending = useRef(false);
  useEffect(() => () => { ++version.current; }, []);
  useEffect(() => {
    setConnecting(false); setError('');
    ++version.current; setSnapshot(null); setAccountId(''); setChecked(null); setItems({}); setConfirmed(false); setResult(null);
  }, [user?.id, profile?.household_id]);
  const controlsDisabled = busy || connecting;
  const bankAccounts = accounts.filter(a => !a.is_archived && a.kind === 'bank' && a.currency === 'BYN');
  const possible = useMemo(() => new Set([...(snapshot ? priorPossibleDuplicates(snapshot, transactions, accountId) : []), ...(checked?.possibleIndexes || [])]), [snapshot, transactions, accountId, checked]);
  const imported = new Set(checked?.importedIndexes || []);
  const visibleRows = snapshot?.card.records.map((row,index) => ({row,index})).filter(({index}) => showImported || !imported.has(index)) || [];
  const selected = Object.values(items);
  let net = 0n;
  for (const item of selected) net += BigInt(toMinorUnits(snapshot!.card.records[item.index].accountAmount!));
  const displayCents = (value: bigint) => `${value < 0n ? '−' : ''}${(value < 0n ? -value : value) / 100n}.${String((value < 0n ? -value : value) % 100n).padStart(2, '0')}`;
  const valid = selected.length > 0 && selected.every(item => item.categoryId && (!possible.has(item.index) || item.confirmExisting));
  const resetReview = () => { ++version.current; setChecked(null); setItems({}); setConfirmed(false); setResult(null); setError(''); setPage(0); };
  useEffect(() => {
    if (accountId && !financeLoading && !financeError && !accounts.some(a => a.id === accountId && !a.is_archived && a.kind === 'bank' && a.currency === 'BYN')) {resetReview(); setAccountId('');}
  }, [accounts, accountId, financeLoading, financeError]);
  const load = async (file?: File) => {
    if (!file || pending.current || connecting) return;
    resetReview(); setSnapshot(null);
    const current = version.current;
    try {
      if (file.size > PRIOR_FILE_LIMIT) throw new Error('Файл слишком большой. Выберите меньший период в помощнике.');
      const parsed = parsePriorImportFile(await file.text());
      if (current !== version.current) return;
      setSnapshot(parsed);
    } catch { if (current === version.current) setError('Не удалось прочитать файл Приорбанка. Подготовьте новый файл в локальном помощнике.'); }
  };
  const check = async () => {
    if (!snapshot || !accountId || pending.current || connecting) return;
    resetReview(); const current = version.current; pending.current = true; setBusy(true);
    try { const value = await previewPriorImport(accountId, snapshot); if (current === version.current) setChecked(value); }
    catch (e) { if (current === version.current) setError(e instanceof Error ? e.message : 'Не удалось проверить импорт.'); }
    finally { pending.current = false; setBusy(false); }
  };
  useEffect(() => {
    if (snapshot && bankAccounts.some(a => a.id === accountId) && snapshot.card.currency === 'BYN' && !checked && !error && !connecting && !financeLoading && !financeError && !pending.current) void check();
  }, [snapshot, accountId, connecting, financeLoading, financeError, checked, error]);
  const save = async () => {
    if (!snapshot || !checked || (!checked.linked && !confirmed) || !valid || pending.current || connecting || financeLoading || financeError) return;
    pending.current = true; setBusy(true); setError(''); const current = version.current;
    try {
      const value = await importPriorOperations(accountId, snapshot, selected);
      if (current === version.current) { setResult(value); setItems({}); setConfirmed(false); setPage(0); setChecked({...checked, linked:true, importedIndexes:[...new Set([...checked.importedIndexes,...selected.map(item => item.index)])]}); }
    } catch (e) {
      if (current === version.current) { setError(e instanceof Error ? e.message : 'Не удалось завершить импорт.'); setChecked(null); setItems({}); setConfirmed(false); }
    } finally { pending.current = false; setBusy(false); }
  };
  const update = (index: number, change: Partial<PriorImportSelection>) => {
    setItems(previous => ({ ...previous, [index]: { ...(previous[index] || newSelection(index)), ...change } })); setConfirmed(false);
  };
  const newSelection = (index: number): PriorImportSelection => {
    const row = snapshot!.card.records[index];
    const suggestion = AlfaBankService.detectCategory(row.description, toMinorUnits(row.accountAmount!) < 0 ? 'expense' : 'income');
    return { index, categoryId: categories.some(c => c.id === suggestion) ? suggestion : '', confirmExisting: false };
  };
  const control = 'input-light w-full min-w-0';
  const dateLabel = (value: string) => new Date(value+'T12:00:00Z').toLocaleDateString('ru-RU',{day:'numeric',month:'short',year:'numeric',timeZone:'Europe/Minsk'});
  const accountName = bankAccounts.find(account => account.id === accountId)?.name;
  const accountSelect = <label className="block text-xs font-semibold">Счёт для операций<select aria-label="Счёт для операций Приорбанка" className={control+' mt-2'} value={accountId} disabled={controlsDisabled} onChange={e => {resetReview();setAccountId(e.target.value);}}><option value="">Выберите банковский счёт BYN</option>{bankAccounts.map(account => <option key={account.id} value={account.id}>{account.name}</option>)}</select></label>;
  return <div className="bank-import flex flex-col gap-4 max-w-lg mx-auto w-full">
    <div>
      <PriorBankConnection key={user?.id+':'+profile?.household_id} disabled={busy} onBusy={setConnecting} onStart={() => {resetReview();setSnapshot(null);}} onConnected={(value,savedAccountId) => {resetReview();setSnapshot(value);setShowImported(false);setAccountId(savedAccountId??'');}}/>
    </div>
    <PriorAutomation accountId={bankAccounts.some(a=>a.id===accountId)?accountId:undefined} sourceKey={snapshot?.card.sourceKey} linked={checked?.linked} disabled={controlsDisabled||financeLoading||!!financeError}/>
    {error && <div role="alert" className="bank-notice text-rose-700 flex gap-2"><AlertCircle className="shrink-0" size={18}/><span>{error}</span></div>}
    {result && <div role="status" className="bank-notice text-emerald-800 flex gap-2"><CheckCircle2 className="shrink-0" size={18}/><span>Добавлено: {result.imported}.{result.skipped>0 && ' Уже загружено, пропущено: '+result.skipped+'.'}</span></div>}
    {snapshot && <>
      <section className="bank-review space-y-3 px-1" aria-label="Проверка операций Приорбанка">
        <div><h3 className="section-title">{checked && !visibleRows.length ? 'Всё актуально' : 'Выберите операции'}</h3><p className="bank-caption mt-2">{dateLabel(snapshot.from)} — {dateLabel(snapshot.to)}</p><p className="bank-caption mt-1 break-words">{snapshot.card.title} · {snapshot.card.maskedNumber} · {snapshot.card.currency}</p></div>
        {checked?.linked && accountName ? <details className="disclosure"><summary><span className="min-w-0 break-words">Счёт: {accountName}</span><ChevronDown size={15}/></summary><div className="disclosure-body">{accountSelect}</div></details> : accountSelect}
        {financeLoading && <p role="status" className="bank-caption">Загружаем счета FinApp…</p>}
        {financeError && <p role="alert" className="bank-notice text-rose-700">{financeError}</p>}
        {!bankAccounts.length && !financeLoading && !financeError && <p className="bank-notice text-amber-800">Сначала создайте банковский счёт BYN на главной странице.</p>}
        {(!checked || !checked.linked) && <p className="bank-caption">Выбранные записи изменят баланс этого счёта. Начальный остаток должен быть указан до загружаемого периода.</p>}
        {busy && <p role="status" className="bank-caption">Проверяем операции…</p>}
        {error && <button type="button" onClick={() => void check()} disabled={controlsDisabled || !accountId || snapshot.card.currency!=='BYN' || financeLoading || !!financeError} className="auth-button">Повторить проверку</button>}
        {checked && <>
          <p role="status" className="sr-only">Проверка пройдена.</p><div className="flex items-center justify-between gap-3"><span className="text-xs text-slate-500">Новых: {snapshot.card.records.length-imported.size}</span>
          {visibleRows.some(({row,index})=>!priorBlockedReason(snapshot,row) && !imported.has(index) && !possible.has(index)) && <button type="button" disabled={controlsDisabled} className="text-action" onClick={() => {
            if(selected.length){setItems({});setConfirmed(false);return;}
            const next: Record<number,PriorImportSelection> = {};
            snapshot.card.records.forEach((row,index) => {if(!priorBlockedReason(snapshot,row) && !imported.has(index) && !possible.has(index)) next[index]=newSelection(index);});
            setItems(next);setConfirmed(false);
          }}>{selected.length?'Снять выбор':'Выбрать новые'}</button>}</div>
          {visibleRows.length>0 && <p className="bank-caption">Не выбирайте свои переводы и уже учтённые записи.{possible.size>0 && ' Похожие операции требуют отдельного подтверждения.'}</p>}
          {imported.size>0 && <label className="bank-check"><input type="checkbox" checked={showImported} onChange={e => {setShowImported(e.target.checked);setPage(0);}} className="w-5 h-5"/>Показать уже добавленные ({imported.size})</label>}
        </>}
      </section>
      {checked && !visibleRows.length && <p role="status" className="bank-empty"><CheckCircle2 size={26} strokeWidth={1.5}/>Всё добавлено. Новых операций за этот период нет.</p>}
      <div className="import-list">
        {visibleRows.slice(page*40,(page+1)*40).map(({row,index}) => {
          const blocked=priorBlockedReason(snapshot,row),chosen=items[index];
          const showOriginal=row.operationCurrency!==snapshot.card.currency || row.operationAmount!==row.accountAmount;
          return <article key={index} className={'import-row'+(chosen?' is-selected':'')}>
            <label className="import-row-choice">
              <input type="checkbox" aria-label={`Выбрать операцию ${index+1}`} className="w-5 h-5 shrink-0" checked={!!chosen} disabled={controlsDisabled || !checked || !!blocked || imported.has(index)} onChange={e => {
                if(e.target.checked) update(index,{});else {setItems(previous => {const next={...previous};delete next[index];return next;});setConfirmed(false);}
              }}/>
              <span className="min-w-0 flex-1"><span className="block text-xs font-semibold break-words leading-relaxed">{row.description}</span><span className="block bank-caption mt-1">{dateLabel(row.date)}</span></span>
              <span className={'import-row-amount money'+(row.accountAmount?.startsWith('-')?'':' text-emerald-800')}>{row.accountAmount?.replace('.',',')??'—'}<span className="block bank-caption mt-1">{snapshot.card.currency}</span></span>
            </label>
            {(showOriginal || (row.fee && row.fee!=='0.00')) && <p className="bank-caption">{showOriginal && 'Сумма покупки: '+row.operationAmount+' '+row.operationCurrency}{row.fee && row.fee!=='0.00' && (showOriginal?' · ':'')+'Комиссия в ответе банка: '+row.fee}</p>}
            {blocked && <p className="bank-notice text-amber-800">{blocked}</p>}
            {imported.has(index) && <p className="bank-caption text-emerald-800">Уже добавлена</p>}
            {possible.has(index) && !imported.has(index) && !blocked && <p className="bank-notice text-amber-800">Возможно, повтор. Сверьте дату, сумму и описание с журналом.</p>}
            {chosen && <div className="space-y-3">
              <label className="block bank-caption">Предложенная категория<select className={control+' mt-2'} aria-label={`Категория операции ${index+1}`} value={chosen.categoryId} disabled={controlsDisabled} onChange={e=>update(index,{categoryId:e.target.value})}><option value="">Выберите категорию</option>{categories.map(category=><option key={category.id} value={category.id}>{category.name}</option>)}</select></label>
              {possible.has(index) && <label className="bank-check text-amber-900"><input type="checkbox" checked={chosen.confirmExisting} disabled={controlsDisabled} className="w-5 h-5 shrink-0" onChange={e=>update(index,{confirmExisting:e.target.checked})}/>Проверил: это отдельная операция, её нужно добавить</label>}
            </div>}
          </article>;
        })}
      </div>
      {visibleRows.length>40 && <div className="flex items-center justify-between text-xs gap-2"><button type="button" className="bank-secondary w-auto px-4" disabled={page===0 || controlsDisabled} onClick={()=>setPage(p=>p-1)}>Назад</button><span>{page+1} / {Math.ceil(visibleRows.length/40)}</span><button type="button" className="bank-secondary w-auto px-4" disabled={(page+1)*40>=visibleRows.length || controlsDisabled} onClick={()=>setPage(p=>p+1)}>Далее</button></div>}
      {checked && selected.length>0 && <section className={'import-save space-y-3'+(!checked.linked?' import-save-first':'')} aria-label="Добавление выбранных операций">
        <div className="flex items-start justify-between gap-3"><span className="text-xs text-slate-500">Выбрано: {selected.length}<span className="block bank-caption mt-1">Изменение баланса</span></span><strong className="money text-lg">{displayCents(net).replace('.',',')} BYN</strong></div>
        {!checked.linked && <><p className="bank-caption">Баланс FinApp сейчас: {accountBalances[accountId]?.toFixed(2)??'—'} BYN. Доступная сумма банка его не заменяет.</p><label className="bank-check"><input type="checkbox" className="w-5 h-5 shrink-0" checked={confirmed} disabled={controlsDisabled} onChange={e=>setConfirmed(e.target.checked)}/>Проверил счёт, начальный остаток, категории и выбранные операции. Свои переводы и уже учтённые записи исключены.</label></>}
        {selected.some(item=>!item.categoryId) && <p className="bank-caption">Выберите категорию для каждой отмеченной операции.</p>}
        <button type="button" onClick={()=>void save()} disabled={controlsDisabled || !valid || (!checked.linked && !confirmed) || financeLoading || !!financeError} className="auth-button">{busy?'Сохраняем…':`Добавить выбранные операции (${selected.length})`}</button>
      </section>}
    </>}
    <details className="disclosure bank-help"><summary>Помощь и загрузка файла<ChevronDown size={15}/></summary><div className="disclosure-body space-y-3">
      <p className="bank-caption">Одна карта BYN связана с одним счётом FinApp. При первом сохранении связь закрепится. Уже добавленные записи пропускаются; изменение ранее полученной истории остановит импорт. Для валютной покупки сохраняется сумма по счёту BYN.</p>
      <p className="bank-caption">Если уже есть файл из локального помощника, его можно загрузить вместо подключения.</p>
      <label className="bank-secondary cursor-pointer"><UploadCloud size={17}/>Выбрать файл Приорбанка<input aria-label="Файл Приорбанка" type="file" accept=".json,application/json" className="sr-only" disabled={controlsDisabled} onChange={e=>{void load(e.target.files?.[0]);e.target.value='';}}/></label>
    </div></details>
  </div>;
}
