import { connectionResult } from './result.ts';
import { rememberedPrior, type RememberedDependencies } from './remembered.ts';
import { createHmac, randomUUID } from 'node:crypto';
import { fetchPreview } from '../_shared/prior/bank.ts';
import { object, validateInput, PreviewError, type PreviewInput } from '../_shared/prior/model.ts';

interface Config { url: string; anonKey: string; serviceKey: string; }
interface Dependencies extends RememberedDependencies { fetcher?: typeof fetch; preview?: typeof fetchPreview; }
const origins = new Set(['https://familyfinance.ptuskina866.workers.dev', 'http://127.0.0.1:5173', 'http://localhost:5173', 'http://127.0.0.1:5190', 'http://localhost:5190']);
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

export { connectionResult } from './result.ts';

async function readBody(req: Request): Promise<unknown> {
  if (!req.body) throw new PreviewError('INPUT_INVALID', 'Введите данные для входа.');
  const reader = req.body.getReader(); let raw = '', size = 0;
  const decoder = new TextDecoder();
  try {
    while (true) {
      const {value, done} = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > 8192) throw new PreviewError('BODY_TOO_LARGE', 'Запрос слишком большой.');
      raw += decoder.decode(value, {stream: true});
    }
    raw += decoder.decode();
    return JSON.parse(raw) as unknown;
  } catch (error) {
    if (error instanceof PreviewError) throw error;
    throw new PreviewError('INPUT_INVALID', 'Не удалось прочитать запрос.');
  } finally { raw = ''; await reader.cancel().catch(() => {}); }
}

/** Authenticated proxy: encrypted session retention is explicit, no password storage or ledger writes. */
export function createPriorConnectHandler(config: Config, deps: Dependencies = {}) {
  const fetcher = deps.fetcher ?? fetch, preview = deps.preview ?? fetchPreview;
  return async (req: Request): Promise<Response> => {
    const origin = req.headers.get('origin'), allowed = origin !== null && origins.has(origin);
    const headers: Record<string, string> = {'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', Vary: 'Origin',
      ...(allowed ? {'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Headers': 'authorization, apikey, x-client-info, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS'} : {})};
    const reply = (status: number, code: string, error: string) => new Response(JSON.stringify({code, error}), {status, headers});
    if (origin !== null && !allowed) return reply(403, 'ORIGIN_DENIED', 'Откройте подключение из FinApp.');
    if (req.method === 'OPTIONS') return new Response(null, {status: 204, headers});
    if (req.method !== 'POST') return reply(405, 'METHOD_NOT_ALLOWED', 'Метод не поддерживается.');
    if (!config.url || !config.anonKey || !config.serviceKey) return reply(503, 'NOT_CONFIGURED', 'Сервер подключения пока не настроен.');
    const authorization = req.headers.get('authorization');
    if (!authorization || !/^Bearer [^\s]+$/i.test(authorization)) return reply(401, 'AUTH_REQUIRED', 'Войдите в FinApp заново.');
    if (req.headers.get('content-type')?.split(';')[0].trim() !== 'application/json') return reply(415, 'INPUT_INVALID', 'Ожидается запрос приложения.');
    let input: PreviewInput | null = null, raw: Record<string, unknown> | null = null, owner = '', claimed = false;
    const attempt = randomUUID();
    const rpc = (name: string, body: Record<string, unknown>) => fetcher(`${config.url}/rest/v1/rpc/${name}`, {
      method: 'POST', signal: AbortSignal.timeout(8000), redirect: 'error',
      headers: {apikey: config.serviceKey, Authorization: `Bearer ${config.serviceKey}`, 'Content-Type': 'application/json'}, body: JSON.stringify(body),
    });
    try {
      // The Auth server verifies the JWT and current user. Never trust decoded user_metadata.
      const auth = await fetcher(`${config.url}/auth/v1/user`, {headers: {Authorization: authorization, apikey: config.anonKey}, redirect: 'error', signal: AbortSignal.any([req.signal, AbortSignal.timeout(8000)])});
      if (!auth.ok) return reply(401, 'AUTH_REQUIRED', 'Войдите в FinApp заново.');
      const user = object(await auth.json());
      if (typeof user.id !== 'string' || !uuid.test(user.id) || user.is_anonymous === true) return reply(401, 'AUTH_REQUIRED', 'Нужна учётная запись FinApp.');
      owner = user.id;
      raw = object(await readBody(req));
      if (raw.action !== undefined) {
        const body = await rememberedPrior(req,raw,owner,{rpc,serviceKey:config.serviceKey,openSession:deps.openSession,readSession:deps.readSession});
        return new Response(body,{status:200,headers});
      }
      if (Object.keys(raw).some(key => !['login', 'password', 'from', 'to'].includes(key))) throw new PreviewError('INPUT_INVALID', 'Получен неподдерживаемый запрос.');
      input = validateInput(raw); raw.password = ''; raw.login = '';
      const loginKey = createHmac('sha256', config.serviceKey).update('prior-login-v1:' + input.login.normalize('NFKC').toLowerCase()).digest('hex');
      const claim = await rpc('claim_prior_connection', {p_owner: owner, p_login_key: loginKey, p_attempt: attempt});
      if (!claim.ok) {
        const failure = await claim.text();
        if (failure.includes('PRIOR_CONNECTION_LIMIT')) return reply(429, 'COOLDOWN', 'Вход уже выполняется или был совсем недавно. Подождите две минуты перед новой попыткой.');
        if (failure.includes('PRIOR_CONNECTION_MEMBER')) return reply(403, 'MEMBER_REQUIRED', 'Дождитесь загрузки семьи в FinApp и повторите подключение.');
        return reply(503, 'NOT_CONFIGURED', 'Не удалось подготовить защищённое подключение. Попробуйте позже.');
      }
      claimed = true;
      const result = await preview(input, AbortSignal.any([req.signal, AbortSignal.timeout(90_000)]));
      if (req.signal.aborted) throw new PreviewError('CANCELLED', 'Получение данных отменено.');
      return new Response(connectionResult(result), {status: 200, headers});
    } catch (error) {
      if (error instanceof PreviewError) return reply(error.code === 'BODY_TOO_LARGE' ? 413 : error.code === 'COOLDOWN' ? 429 : 400, error.code, error.message);
      return reply(503, 'CONNECTION_FAILED', 'Не удалось завершить подключение. Автоматического повторного входа нет. Попробуйте позже.');
    } finally {
      if (raw) {raw.password = ''; raw.login = '';}
      if (input) {input.password = ''; input.login = '';}
      if (claimed) {try {await rpc('release_prior_connection', {p_owner: owner, p_attempt: attempt});} catch { /* Lease expires even if release is unavailable. Never log credentials/errors. */ }}
    }
  };
}
