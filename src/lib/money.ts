export type MoneyValue = number | string;

// Matches PostgreSQL NUMERIC(12, 2). Keeping cents in this range also ensures
// their decimal number representation round-trips without losing a cent.
const MAX_MINOR_UNITS = 999_999_999_999;

/** Parse a monetary value exactly; never round an unsupported third decimal. */
export function toMinorUnits(value: MoneyValue): number {
  if (typeof value === 'number' && !Number.isFinite(value)) {
    throw new RangeError('Сумма должна быть конечным числом.');
  }
  const text = String(value).trim();
  const match = /^([+-]?)(\d+)(?:\.(\d{1,2}))?$/.exec(text);
  if (!match) throw new RangeError('Укажите сумму с точностью до двух знаков.');
  const cents = BigInt(match[2]) * 100n + BigInt((match[3] || '').padEnd(2, '0'));
  if (cents > BigInt(MAX_MINOR_UNITS)) throw new RangeError('Сумма слишком велика.');
  const result = Number(cents) * (match[1] === '-' ? -1 : 1);
  return result === 0 ? 0 : result;
}

export function fromMinorUnits(value: number): number {
  if (!Number.isSafeInteger(value) || Math.abs(value) > MAX_MINOR_UNITS) {
    throw new RangeError('Некорректная сумма в копейках.');
  }
  return value === 0 ? 0 : value / 100;
}

/** Accept decimal commas and standard spaces used by Russian money inputs. */
export function parseMoneyInput(value: string): number | null {
  const text = value.trim();
  if (!text) return null;
  // Spaces are accepted only in groups of three; "1 2" must not become 12.
  const normalized = text.replace(/[\u00a0\u202f]/g, ' ');
  if (!/^[+-]?(?:\d+|\d{1,3}(?: \d{3})+)(?:[.,]\d{1,2})?$/.test(normalized)) {
    return null;
  }
  try {
    return fromMinorUnits(toMinorUnits(normalized.replace(/ /g, '').replace(',', '.')));
  } catch {
    return null;
  }
}

export function sumMoney(values: Iterable<MoneyValue>): number {
  let cents = 0;
  for (const value of values) {
    cents += toMinorUnits(value);
    if (!Number.isSafeInteger(cents)) throw new RangeError('Сумма слишком велика.');
  }
  return fromMinorUnits(cents);
}

/** Date-only financial records follow the user's local calendar, not UTC. */
export function localDateISO(date = new Date()): string {
  if (!Number.isFinite(date.getTime())) throw new RangeError('Некорректная дата.');
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
