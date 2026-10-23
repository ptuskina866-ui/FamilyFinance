import type { PriorBankConnectionStatus, PriorConnectionResult } from '../types';
import { parsePriorImportFile } from './priorImport';

export function parsePriorConnection(value: unknown): PriorConnectionResult {
  const invalid = () => new Error('Банк вернул неподдерживаемые данные. Ничего не сохранено.');
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalid();
  const data = value as Record<string, unknown>;
  if (Object.keys(data).some(key => !['format','version','cards','externalCards','connection','syncState'].includes(key)) || data.format !== 'finapp-prior-connection' || data.version !== 1 || !Array.isArray(data.cards) || data.cards.length > 20 || !Number.isInteger(data.externalCards) || Number(data.externalCards) < 0) throw invalid();
  if(data.syncState!==undefined&&(typeof data.syncState!=='string'||!['saved','fresh','updating'].includes(data.syncState)))throw invalid();
  if (JSON.stringify(data).length > 8_000_000) throw invalid();
  return {cards: data.cards.map(card => parsePriorImportFile(JSON.stringify(card))), externalCards: Number(data.externalCards),...(data.connection === undefined ? {} : {connection: parsePriorStatus(data.connection)}),...(data.syncState===undefined?{}:{syncState:data.syncState as PriorConnectionResult['syncState']})};
}

export function parsePriorStatus(value: unknown): PriorBankConnectionStatus {
  const invalid = () => new Error('Не удалось проверить состояние подключения.');
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalid();
  const data = value as Record<string,unknown>;
  if (Object.keys(data).length !== 5 || Object.keys(data).some(key => !['connected','reauthRequired','lastSyncedAt','selectedSourceKey','accountId'].includes(key)) || typeof data.connected !== 'boolean' || typeof data.reauthRequired !== 'boolean') throw invalid();
  if (data.lastSyncedAt !== null && (typeof data.lastSyncedAt !== 'string' || !Number.isFinite(Date.parse(data.lastSyncedAt)))) throw invalid();
  if (data.selectedSourceKey !== null && (typeof data.selectedSourceKey !== 'string' || !/^[a-f0-9]{64}$/.test(data.selectedSourceKey))) throw invalid();
  if (data.accountId !== null && (typeof data.accountId !== 'string' || !/^[a-f0-9-]{36}$/i.test(data.accountId))) throw invalid();
  return data as unknown as PriorBankConnectionStatus;
}

export function priorConnectionError(code: unknown, status?: number): string {
  if (status === 401 || code === 'AUTH_REQUIRED') return 'Войдите в FinApp заново и повторите подключение.';
  const messages: Record<string, string> = {
    LOGIN_REJECTED: 'Банк отклонил вход. Проверьте логин и пароль в Prior Online. Повтор автоматически не выполняется.',
    ADDITIONAL_CONFIRMATION: 'Банк запросил дополнительное подтверждение. Этот способ входа пока не поддерживается; ничего не сохранено.',
    COOLDOWN: 'Обновление уже выполняется или было недавно. Сохранённая история остаётся доступной; повторите обновление немного позже.',
    PASSWORD_UNSUPPORTED: 'Пароли длиннее 16 символов пока не поддерживаются этим подключением. Не меняйте банковский пароль ради проверки.',
    DATE_INVALID: 'Выберите период до 31 дня, без будущих дат.',
    INPUT_INVALID: 'Проверьте данные для входа и выбранный период.',
    BANK_BLOCKED: 'Банк сообщил об ограничении доступа. Подключение остановлено.',
    ACCESS_DENIED: 'Банк не разрешил серверное подключение. Автоматического повтора нет.',
    BANK_LIMIT: 'Банк ограничил частоту запросов. Попробуйте позже.',
    FORMAT_CHANGED: 'Банк изменил формат данных. Подключение остановлено без сохранения операций.',
    AMOUNT_INVALID: 'Не удалось проверить суммы банка. Подключение остановлено без округления и сохранения.',
    RESPONSE_TOO_LARGE: 'Слишком много данных. Выберите меньший период.',
    TOO_MANY_ROWS: 'Слишком много операций. Выберите меньший период.',
    MEMBER_REQUIRED: 'Дождитесь загрузки семьи в FinApp и повторите подключение.',
    NOT_CONFIGURED: 'Сервер подключения пока недоступен. Попробуйте позже.',
    SESSION_EXPIRED: 'Банк завершил сессию. Войдите заново, чтобы продолжить. Пароль не сохранялся.',
    CONNECTION_CHANGED: 'Подключение изменилось. Откройте Приорбанк заново.',
  };
  return typeof code === 'string' && Object.prototype.hasOwnProperty.call(messages, code) ? messages[code] : 'Не удалось получить данные банка. Автоматического повтора входа нет. Попробуйте позже.';
}
