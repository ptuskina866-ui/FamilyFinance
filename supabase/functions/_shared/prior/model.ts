import { toMinorUnits } from '../../../../src/lib/money.ts';

export class PreviewError extends Error {
  code: string;
  constructor(code: string, message: string) { super(message); this.name = 'PreviewError'; this.code = code; }
}
export interface PreviewInput { login: string; password: string; from: string; to: string; }
export interface PreviewRecord {
  date: string; description: string; accountAmount: string | null; operationAmount: string;
  operationCurrency: string; fee: string | null; source: 'history' | 'additional';
  outsidePeriod: boolean; possibleDuplicate: boolean;
  /** Read-only v2 facts; excluded from the legacy financial envelope. */
  transTime?: string; purchaseAmount?: string | null;
}
export interface PreviewCard {
  id: string; title: string; maskedNumber: string; currency: string;
  available: string; creditLimit: string | null; records: PreviewRecord[];
}
export interface BankPreview { from: string; to: string; fetchedAt: string; cards: PreviewCard[]; externalCards: number; }
export type JsonObject = Record<string, unknown>;
export function object(value: unknown): JsonObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new PreviewError('FORMAT_CHANGED', 'Формат ответа банка изменился. Проверка остановлена.');
  return value as JsonObject;
}
export function list(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new PreviewError('FORMAT_CHANGED', 'В ответе банка отсутствует ожидаемый список.');
  return value;
}
export function requiredText(value: unknown, limit = 200): string {
  if (typeof value !== 'string' || !value || value.length > limit) throw new PreviewError('FORMAT_CHANGED', 'Не удалось проверить поля ответа банка.');
  return value;
}
export function bankId(value: unknown): string {
  if (typeof value === 'number' && Number.isSafeInteger(value)) return String(value);
  return requiredText(value, 80);
}
export function moneyText(value: unknown): string {
  if (typeof value !== 'number' && typeof value !== 'string') throw new PreviewError('AMOUNT_INVALID', 'Банк вернул непроверенную сумму. Проверка остановлена без округления.');
  try {
    const cents = toMinorUnits(value), absolute = Math.abs(cents);
    return `${cents < 0 ? '-' : ''}${Math.trunc(absolute / 100)}.${String(absolute % 100).padStart(2, '0')}`;
  } catch { throw new PreviewError('AMOUNT_INVALID', 'Банк вернул непроверенную сумму. Проверка остановлена без округления.'); }
}
export function dateOnly(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new PreviewError('DATE_INVALID', 'Укажите корректный период.');
  const date = new Date(`${value}T00:00:00Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw new PreviewError('DATE_INVALID', 'Укажите корректный период.');
  return value;
}
export function minskToday(): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Minsk', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts();
  return `${parts.find(p => p.type === 'year')!.value}-${parts.find(p => p.type === 'month')!.value}-${parts.find(p => p.type === 'day')!.value}`;
}
export function validateInput(value: unknown, today = minskToday()): PreviewInput {
  const body = object(value);
  if (typeof body.login !== 'string' || !body.login.trim() || body.login.length > 128 || /[\x00-\x1f]/.test(body.login) || typeof body.password !== 'string' || !body.password || /[\x00-\x1f]/.test(body.password)) {
    throw new PreviewError('INPUT_INVALID', 'Введите логин и пароль от интернет-банка.');
  }
  if (body.password.length > 16) throw new PreviewError('PASSWORD_UNSUPPORTED', 'Этот эксперимент не проверен для паролей длиннее 16 символов. Не меняйте пароль ради проверки.');
  if (typeof body.from !== 'string' || typeof body.to !== 'string') throw new PreviewError('DATE_INVALID', 'Укажите период проверки.');
  const from = dateOnly(body.from), to = dateOnly(body.to);
  if (from > to || to > today || (Date.parse(to) - Date.parse(from)) / 86_400_000 > 30) throw new PreviewError('DATE_INVALID', 'Выберите до 31 дня, без будущих дат.');
  return { login: body.login.trim(), password: body.password, from, to };
}
