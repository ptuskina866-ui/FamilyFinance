import { createHash } from 'node:crypto';
import { type BankPreview, type PreviewInput, object, requiredText, validateInput, PreviewError } from './model.ts';
import { makePreview } from './preview.ts';

const BANK_BASE = 'https://www.prior.by/api3/api';
type BankPath = '/Authorization/MobileToken' | '/Authorization/GetSalt' | '/Authorization/Login' | '/Cards' | '/Cards/CardDesc';
export type BankFetch = typeof fetch;

function bankFailure(status: number, body?: Record<string, unknown>): never {
  const message = typeof body?.errorMessage === 'string' ? body.errorMessage : '';
  if (/неверн.*(?:логин|парол)/i.test(message)) throw new PreviewError('LOGIN_REJECTED', 'Банк отклонил вход. Проверьте данные в Prior Online. Повтор автоматически не выполняется.');
  if (/блокир/i.test(message)) throw new PreviewError('BANK_BLOCKED', 'Банк сообщает об ограничении доступа. Проверку остановили.');
  if (status === 401 || status === 403) throw new PreviewError('ACCESS_DENIED', 'Банк не разрешил этот запрос. Повтор автоматически не выполняется.');
  if (status === 429) throw new PreviewError('BANK_LIMIT', 'Банк ограничил частоту запросов. Попробуйте позже.');
  throw new PreviewError('BANK_UNAVAILABLE', 'Банк не выполнил запрос. Проверка остановлена без повторного входа.');
}

async function bankJson(path: BankPath, body: Record<string, unknown> | null, auth: { token: string; client: string } | null, signal: AbortSignal, fetcher: BankFetch): Promise<Record<string, unknown>> {
  try {
    const response = await fetcher(`${BANK_BASE}${path}`, {
      method: body === null ? 'GET' : 'POST', redirect: 'error', signal: AbortSignal.any([signal, AbortSignal.timeout(20_000)]),
      headers: { Accept: 'application/json', 'User-Agent': 'FinAppLocalPreview/0.1', ...(body === null ? {} : { 'Content-Type': 'application/json' }), ...(auth ? { Authorization: `bearer ${auth.token}`, client_id: auth.client } : {}) },
      ...(body === null ? {} : { body: JSON.stringify(body) }),
    });
    if (!response.ok) bankFailure(response.status);
    if (!response.headers.get('content-type')?.includes('application/json')) throw new PreviewError('FORMAT_CHANGED', 'Банк вернул неожиданный формат ответа.');
    if (!response.body) throw new PreviewError('FORMAT_CHANGED', 'Банк вернул пустой ответ.');
    const reader = response.body.getReader(), chunks: Uint8Array[] = []; let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read(); if (done) break;
        size += value.byteLength;
        if (size > 10_000_000) throw new PreviewError('RESPONSE_TOO_LARGE', 'Ответ банка слишком большой. Выберите меньший период.');
        chunks.push(value);
      }
    } finally { await reader.cancel().catch(() => {}); }
    const parsed = object(JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown);
    if (parsed.success === false) bankFailure(response.status, parsed);
    return parsed;
  } catch (error) {
    if (error instanceof PreviewError) throw error;
    if (signal.aborted) throw new PreviewError('CANCELLED', 'Проверка отменена.');
    throw new PreviewError('NETWORK_ERROR', 'Не удалось завершить защищённый запрос к банку. Повтор автоматически не выполняется.');
  }
}

/** Independent protocol implementation; no payment endpoints, refresh, retries or persistent sessions. */
export async function fetchPreview(rawInput: PreviewInput, signal: AbortSignal, fetcher: BankFetch = fetch): Promise<BankPreview> {
  const input = validateInput(rawInput);
  const handshake = await bankJson('/Authorization/MobileToken', null, null, signal, fetcher);
  if (typeof handshake.token_type !== 'string' || handshake.token_type.toLowerCase() !== 'bearer') throw new PreviewError('FORMAT_CHANGED', 'Не удалось проверить начало банковской сессии.');
  const client = requiredText(handshake.client_secret, 16_000), firstToken = requiredText(handshake.access_token, 16_000);
  const saltResponse = await bankJson('/Authorization/GetSalt', { login: input.login, lang: 'RUS' }, { token: firstToken, client }, signal, fetcher);
  const saltValue = object(saltResponse.result).salt;
  if (saltValue != null && typeof saltValue !== 'string') throw new PreviewError('FORMAT_CHANGED', 'Банк изменил способ входа.');
  const salt = typeof saltValue === 'string' ? saltValue : '';
  if (salt.length > 4096) throw new PreviewError('FORMAT_CHANGED', 'Банк изменил способ входа.');
  // These two wire fields follow the observed bank challenge protocol. Never truncate a user's password.
  const digest = createHash('sha512').update(input.password, 'utf8').digest('hex');
  const challengeHash = salt ? createHash('sha512').update(digest + salt, 'utf8').digest('hex') : digest;
  const secondHash = Buffer.concat([createHash('sha512').update(input.password + salt, 'utf8').digest(), Buffer.from(salt, 'utf8')]).toString('base64');
  input.password = '';
  const loginResponse = await bankJson('/Authorization/Login', { login: input.login, password: challengeHash, password2: secondHash, deviceInfo: { precognitiveSessionId: '' }, lang: 'RUS' }, { token: firstToken, client }, signal, fetcher);
  const session = object(loginResponse.result);
  if (typeof session.access_token !== 'string' || typeof session.userSession !== 'string') throw new PreviewError('ADDITIONAL_CONFIRMATION', 'Банк не выдал сессию. Возможно, требуется дополнительное подтверждение. Этот этап прототип пока не поддерживает.');
  const auth = { token: requiredText(session.access_token, 16_000), client }, userSession = requiredText(session.userSession, 16_000);
  const cards = await bankJson('/Cards', { usersession: userSession }, auth, signal, fetcher);
  const details = await bankJson('/Cards/CardDesc', { usersession: userSession, ids: [], dateFromSpecified: true, dateToSpecified: true, dateFrom: input.from, dateTo: input.to }, auth, signal, fetcher);
  return makePreview(cards.result, details.result, input);
}
