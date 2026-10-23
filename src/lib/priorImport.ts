import type { PriorImportRecord, PriorImportSnapshot, Transaction } from '../types';
import { toMinorUnits } from './money';
import { planningDateISO } from './planning';

export const PRIOR_FILE_LIMIT = 8_000_000;
const invalid = () => new Error('Данные Приорбанка повреждены или имеют неподдерживаемый формат. Получите историю заново в локальном помощнике.');
function object(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !keys.includes(key))) throw invalid();
  return value as Record<string, unknown>;
}
function text(value: unknown, max: number): string {
  if (typeof value !== 'string' || !value || value.length > max || /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(value)) throw invalid();
  return value;
}
function date(value: unknown): string {
  const result = text(value, 10), parsed = new Date(`${result}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(result) || !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== result) throw invalid();
  return result;
}
function amount(value: unknown): string {
  if (typeof value !== 'string' || !/^-?(?:0|[1-9]\d{0,9})\.\d{2}$/.test(value)) throw invalid();
  toMinorUnits(value);
  return value;
}

/** Reject extra fields, including accidentally supplied secrets. Return a fresh whitelist. */
export function parsePriorImportFile(raw: string, today = planningDateISO()): PriorImportSnapshot {
  if (raw.length > PRIOR_FILE_LIMIT) throw invalid();
  const data = object(JSON.parse(raw) as unknown, ['format', 'version', 'from', 'to', 'fetchedAt', 'card']);
  if (data.format !== 'finapp-prior' || data.version !== 1) throw invalid();
  const from = date(data.from), to = date(data.to), fetchedAt = text(data.fetchedAt, 80);
  if (from > to || to > today || Date.parse(to) - Date.parse(from) > 30 * 86400000 || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(fetchedAt) || !Number.isFinite(Date.parse(fetchedAt)) || planningDateISO(new Date(fetchedAt)) > today) throw invalid();
  const card = object(data.card, ['sourceKey', 'title', 'maskedNumber', 'currency', 'records']);
  const sourceKey = text(card.sourceKey, 64), currency = text(card.currency, 3), maskedNumber = text(card.maskedNumber, 40);
  if (!/^[a-f0-9]{64}$/.test(sourceKey) || !/^[A-Z]{3}$/.test(currency) || !/^(?:•••• \d{4}|Номер скрыт)$/.test(maskedNumber)) throw invalid();
  if (!Array.isArray(card.records) || card.records.length > 2000) throw invalid();
  const records: PriorImportRecord[] = card.records.map(value => {
    const row = object(value, ['date', 'description', 'accountAmount', 'operationAmount', 'operationCurrency', 'fee', 'source']);
    const timestamp = text(row.date, 80), operationCurrency = text(row.operationCurrency, 3);
    date(timestamp.slice(0, 10));
    if (!/^[A-Z]{3}$/.test(operationCurrency) || (row.source !== 'history' && row.source !== 'additional')) throw invalid();
    if (row.source === 'history' && row.accountAmount === null) throw invalid();
    return { date: timestamp, description: text(row.description, 4000), accountAmount: row.accountAmount === null ? null : amount(row.accountAmount),
      operationAmount: amount(row.operationAmount), operationCurrency, fee: row.fee === null ? null : amount(row.fee), source: row.source };
  });
  return { format: 'finapp-prior', version: 1, from, to, fetchedAt, card: { sourceKey, currency, title: text(card.title, 200), maskedNumber, records } };
}

export function priorBlockedReason(snapshot: PriorImportSnapshot, row: PriorImportRecord, today = planningDateISO()): string | null {
  const day = row.date.slice(0, 10);
  if (snapshot.card.currency !== 'BYN') return 'Счета FinApp пока поддерживают только BYN';
  if (row.source !== 'history') return 'Статус этой записи не подтверждён. В баланс FinApp она не включена.';
  if (day < snapshot.from || day > snapshot.to) return 'Вне выбранного периода';
  if (day >= today) return 'Сегодняшняя история ещё может меняться';
  if (day >= planningDateISO(new Date(snapshot.fetchedAt))) return 'День получения истории ещё не был завершён — получите новые данные';
  if (row.accountAmount === null || toMinorUnits(row.accountAmount) === 0) return 'Нет ненулевой суммы по счёту';
  return null;
}

/** Conservative warning only; never hide or remove a real same-amount purchase. */
export function priorPossibleDuplicates(snapshot: PriorImportSnapshot, transactions: Transaction[], accountId: string): Set<number> {
  const groups = new Map<string, number[]>(), result = new Set<number>();
  snapshot.card.records.forEach((row, index) => {
    if(row.source==='additional'&&row.accountAmount===null){
      // Wire signs in this unverified list do not establish income/expense direction.
      if(row.operationCurrency===snapshot.card.currency&&transactions.some(tx=>tx.accountId===accountId&&(!tx.kind||tx.kind==='cashflow')&&tx.date===row.date.slice(0,10)&&toMinorUnits(tx.amount)===Math.abs(toMinorUnits(row.operationAmount))))result.add(index);
      return;
    }
    if (row.source !== 'history' || row.accountAmount === null) return;
    const signed = toMinorUnits(row.accountAmount), key = `${row.date.slice(0, 10)}:${signed}`;
    const indexes = groups.get(key) || []; indexes.push(index); groups.set(key, indexes);
    if (transactions.some(tx => tx.accountId === accountId && (!tx.kind || tx.kind === 'cashflow') && tx.date === row.date.slice(0, 10)
      && toMinorUnits(tx.amount) === Math.abs(signed) && tx.type === (signed < 0 ? 'expense' : 'income'))) result.add(index);
  });
  for (const indexes of groups.values()) if (indexes.length > 1) indexes.forEach(index => result.add(index));
  return result;
}

/** The bank's calendar day stays authoritative even when its field also contains a time/offset. */
export function priorDateLabel(value:string):string {
  try {const day=date(value.slice(0,10));return new Date(day+'T12:00:00Z').toLocaleDateString('ru-RU',{day:'numeric',month:'short',year:'numeric',timeZone:'Europe/Minsk'});}
  catch{return 'Дата не указана';}
}

export function priorImportError(message: string): string {
  if (/PGRST202|Could not find the function|does not exist/.test(message)) return 'Для импорта Приорбанка требуется обновление базы приложения. Историю можно проверить после обновления.';
  if (message.includes('PRIOR_DAY_CHANGED')) return 'История уже загруженного дня изменилась. Импорт остановлен: сначала нужна сверка этого дня, чтобы не создать повторы.';
  if (message.includes('PRIOR_RANGE_COVERAGE')) return 'Для повторного импорта выберите период, включающий все ранее загруженные дни этой карты. В пилоте поддерживается одно окно до 31 дня; для перехода к следующему окну потребуется отдельная сверка.';
  if (message.includes('PRIOR_SOURCE_BOUND')) return 'Эта карта уже связана с другим счётом или владельцем. Используйте первоначальный счёт и учётную запись.';
  if (message.includes('PRIOR_ACCOUNT_BOUND')) return 'Этот счёт уже связан с другой картой. В первом подключении используйте одну карту на один счёт.';
  if (message.includes('PRIOR_CONFIRM_EXISTING')) return 'Появилась похожая операция. Повторите проверку и подтвердите спорные строки перед сохранением.';
  if (message.includes('PRIOR_')) return 'Проверка импорта не пройдена. Проверьте историю, доступный счёт и выбранные операции. Ничего из этой попытки не сохранено.';
  return 'Не удалось завершить импорт. Повторите проверку: уже сохранённые строки будут пропущены.';
}
