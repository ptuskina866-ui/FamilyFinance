import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, UploadCloud } from 'lucide-react';
import { useApp } from '../AppContext';
import { useAuth } from '../AuthContext';
import type { PriorImportCheck, PriorImportResult, PriorImportSelection, PriorImportSnapshot } from '../types';
import { parsePriorImportFile, PRIOR_FILE_LIMIT, priorBlockedReason, priorPossibleDuplicates } from '../lib/priorImport';
import { toMinorUnits } from '../lib/money';
import { AlfaBankService } from '../services/alfaBankService';

export function PriorImportPanel() {
  const { accounts, transactions, categories, accountBalances, financeLoading, financeError, previewPriorImport, importPriorOperations } = useApp();
  const { user } = useAuth();
  const [snapshot, setSnapshot] = useState<PriorImportSnapshot | null>(null);
  const [accountId, setAccountId] = useState('');
  const [checked, setChecked] = useState<PriorImportCheck | null>(null);
  const [items, setItems] = useState<Record<number, PriorImportSelection>>({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [result, setResult] = useState<PriorImportResult | null>(null);
  const [page, setPage] = useState(0);
  const version = useRef(0), pending = useRef(false);
  useEffect(() => () => { ++version.current; }, []);
  useEffect(() => {
    ++version.current; setSnapshot(null); setAccountId(''); setChecked(null); setItems({}); setConfirmed(false); setResult(null);
  }, [user?.id]);
  const bankAccounts = accounts.filter(a => !a.is_archived && a.kind === 'bank' && a.currency === 'BYN');
  const possible = useMemo(() => snapshot ? priorPossibleDuplicates(snapshot, transactions, accountId) : new Set<number>(), [snapshot, transactions, accountId]);
  const imported = new Set(checked?.importedIndexes || []);
  const selected = Object.values(items);
  let net = 0n;
  for (const item of selected) net += BigInt(toMinorUnits(snapshot!.card.records[item.index].accountAmount!));
  const displayCents = (value: bigint) => `${value < 0n ? '−' : ''}${(value < 0n ? -value : value) / 100n}.${String((value < 0n ? -value : value) % 100n).padStart(2, '0')}`;
  const valid = selected.length > 0 && selected.every(item => item.categoryId && (!possible.has(item.index) || item.confirmExisting));
  const resetReview = () => { ++version.current; setChecked(null); setItems({}); setConfirmed(false); setResult(null); setError(''); setPage(0); };
  const load = async (file?: File) => {
    if (!file || pending.current) return;
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
    if (!snapshot || !accountId || pending.current) return;
    resetReview(); const current = version.current; pending.current = true; setBusy(true);
    try { const value = await previewPriorImport(accountId, snapshot); if (current === version.current) setChecked(value); }
    catch (e) { if (current === version.current) setError(e instanceof Error ? e.message : 'Не удалось проверить импорт.'); }
    finally { pending.current = false; setBusy(false); }
  };
  const save = async () => {
    if (!snapshot || !checked || !confirmed || !valid || pending.current || financeLoading || financeError) return;
    pending.current = true; setBusy(true); setError(''); const current = version.current;
    try {
      const value = await importPriorOperations(accountId, snapshot, selected);
      if (current === version.current) { setResult(value); setItems({}); setConfirmed(false); setChecked(null); }
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
  const control = 'w-full min-w-0 rounded-2xl bg-white/80 border border-white p-3 text-xs text-slate-800';
  return <div className="flex flex-col gap-4 max-w-lg mx-auto w-full">
    <div className="card p-5 space-y-3">
      <h2 className="font-black text-slate-900">Приорбанк · импорт после проверки</h2>
      <p className="text-xs text-slate-600 leading-relaxed">В локальном помощнике получите историю и нажмите «Подготовить файл для FinApp». Выберите этот файл здесь. Банковский пароль вводится только в помощнике на компьютере.</p>
      <label className="flex items-center justify-center gap-2 bg-slate-950 text-white rounded-2xl p-4 text-xs font-bold cursor-pointer">
        <UploadCloud size={18} /> Выбрать файл Приорбанка
        <input aria-label="Файл Приорбанка" type="file" accept=".json,application/json" className="sr-only" disabled={busy} onChange={e => { void load(e.target.files?.[0]); e.target.value = ''; }} />
      </label>
      <p className="text-[11px] text-slate-500">Пилот: одна карта BYN на один банковский счёт FinApp, одно окно до 31 дня. При повторной загрузке включайте все ранее загруженные дни этой карты. Импортируется завершённая история до дня получения файла. Валюта покупки может отличаться — сохраняется сумма по счёту BYN.</p>
    </div>
    {error && <div role="alert" className="card p-4 text-xs text-rose-700 flex gap-2"><AlertCircle className="shrink-0" size={18} /><span>{error}</span></div>}
    {result && <div role="status" className="card p-4 text-sm font-bold text-emerald-800 flex gap-2"><CheckCircle2 className="shrink-0" size={18} />Сохранено: {result.imported}. Уже загружено, пропущено: {result.skipped}.</div>}
    {snapshot && <>
      <div className="card p-5 space-y-3">
        <p className="text-sm font-black break-words">{snapshot.card.title} · {snapshot.card.maskedNumber} · {snapshot.card.currency}</p>
        <p className="text-xs text-slate-500">{snapshot.from} — {snapshot.to} · записей: {snapshot.card.records.length}</p>
        <label className="block text-xs font-bold">Счёт для операций
          <select aria-label="Счёт для операций Приорбанка" className={`${control} mt-2`} value={accountId} disabled={busy} onChange={e => { resetReview(); setAccountId(e.target.value); }}>
            <option value="">Выберите банковский счёт BYN</option>{bankAccounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </label>
        {!bankAccounts.length && <p className="text-xs text-amber-800">Сначала создайте банковский счёт BYN на главной странице.</p>}
        <p className="text-xs text-slate-600">Загрузка изменит баланс выбранного счёта. Исключите свои переводы и уже учтённые операции. Начальный остаток должен относиться к дате до импортируемой истории; доступная сумма банка не заменяет его автоматически.</p>
        <button type="button" onClick={() => void check()} disabled={busy || !accountId || snapshot.card.currency !== 'BYN' || financeLoading || !!financeError} className="w-full rounded-2xl p-3 bg-slate-950 text-white text-xs font-bold disabled:opacity-40">{busy ? 'Проверяем…' : 'Проверить выбранный счёт'}</button>
      </div>
      {checked && <div className="card p-5 text-xs text-emerald-800 space-y-3"><p>Проверка пройдена. Уже загружено строк: {imported.size}. Категории предлагаются по описанию — проверьте и при необходимости измените их. {checked.linked ? 'Используется ранее выбранная связь со счётом.' : 'Связь карты со счётом закрепится при первом сохранении.'}</p>
        <button type="button" disabled={busy} className="w-full rounded-2xl bg-white/80 p-3 text-slate-900 font-bold" onClick={() => {
          const next: Record<number, PriorImportSelection> = {};
          snapshot.card.records.forEach((row, index) => { if (!priorBlockedReason(snapshot, row) && !imported.has(index) && !possible.has(index)) next[index] = items[index] || newSelection(index); });
          setItems(next); setConfirmed(false);
        }}>Выбрать новые без спорных совпадений</button>
      </div>}
      <div className="flex flex-col gap-2">
        {snapshot.card.records.slice(page * 40, (page + 1) * 40).map((row, offset) => {
          const index = page * 40 + offset, blocked = priorBlockedReason(snapshot, row), chosen = items[index];
          return <article key={index} className="card p-4 space-y-2 text-xs">
            <label className="flex items-start gap-3">
              <input type="checkbox" aria-label={`Выбрать операцию ${index + 1}`} className="mt-1 w-5 h-5 shrink-0 accent-slate-950" checked={!!chosen} disabled={busy || !checked || !!blocked || imported.has(index)} onChange={e => {
                if (e.target.checked) update(index, {}); else { setItems(previous => { const next = { ...previous }; delete next[index]; return next; }); setConfirmed(false); }
              }} />
              <span className="min-w-0 flex-1"><span className="block font-bold break-words">{row.description}</span><span className="block text-slate-500 mt-1 break-words">{row.date}</span></span>
            </label>
            <p className="font-black text-sm">По счёту: {row.accountAmount ?? '—'} {snapshot.card.currency}</p>
            <p className="text-slate-500">Операция: {row.operationAmount} {row.operationCurrency}{row.fee && row.fee !== '0.00' ? ` · Комиссия в ответе: ${row.fee}` : ''}</p>
            {blocked && <p className="text-amber-800">{blocked}</p>}
            {imported.has(index) && <p className="text-emerald-800">Уже загружена — повторное сохранение недоступно</p>}
            {possible.has(index) && !imported.has(index) && !blocked && <p className="text-amber-800">Есть операция с такой же датой и суммой в файле или журнале. Сверьте, что это отдельная покупка.</p>}
            {chosen && <>
              <p className="text-slate-500">Предложенная категория — можно изменить</p>
              <select className={control} aria-label={`Категория операции ${index + 1}`} value={chosen.categoryId} disabled={busy} onChange={e => update(index, { categoryId: e.target.value })}>
                <option value="">Выберите категорию</option>{categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              {possible.has(index) && <label className="flex gap-2 items-start text-amber-900"><input type="checkbox" checked={chosen.confirmExisting} disabled={busy} className="w-5 h-5 shrink-0" onChange={e => update(index, { confirmExisting: e.target.checked })} />Проверил: это отдельная операция, её нужно добавить</label>}
            </>}
          </article>;
        })}
        {snapshot.card.records.length > 40 && <div className="flex items-center justify-between text-xs gap-2"><button type="button" className="card px-4 py-3 disabled:opacity-40" disabled={page === 0 || busy} onClick={() => setPage(p => p - 1)}>Назад</button><span>{page + 1} / {Math.ceil(snapshot.card.records.length / 40)}</span><button type="button" className="card px-4 py-3 disabled:opacity-40" disabled={(page + 1) * 40 >= snapshot.card.records.length || busy} onClick={() => setPage(p => p + 1)}>Далее</button></div>}
      </div>
      {checked && <div className="card p-5 space-y-3">
        <p className="text-sm font-black">Выбрано: {selected.length} · изменение баланса: {displayCents(net)} BYN</p>
        {accountId && <p className="text-xs text-slate-500">Баланс FinApp сейчас: {accountBalances[accountId]?.toFixed(2) ?? '—'} BYN. Просмотр сам по себе его не меняет.</p>}
        <label className="flex gap-3 text-xs leading-relaxed"><input type="checkbox" className="w-5 h-5 shrink-0" checked={confirmed} disabled={busy} onChange={e => setConfirmed(e.target.checked)} />Проверил счёт, начальный остаток, категории и выбранные операции. Свои переводы и уже учтённые записи исключены.</label>
        <button type="button" onClick={() => void save()} disabled={busy || !valid || !confirmed || financeLoading || !!financeError} className="w-full rounded-2xl p-4 bg-slate-950 text-white text-xs font-black disabled:opacity-40">{busy ? 'Сохраняем…' : `Добавить выбранные операции (${selected.length})`}</button>
      </div>}
    </>}
  </div>;
}
