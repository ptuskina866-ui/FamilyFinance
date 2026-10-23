import { createHmac, randomUUID } from 'node:crypto';
import { openPriorSession, readPriorSession, validatePriorSession } from '../_shared/prior/bank.ts';
import { minskToday, object, validateInput, PreviewError, type PreviewInput } from '../_shared/prior/model.ts';
import { connectionResult } from './result.ts';

export interface RememberedDependencies { openSession?: typeof openPriorSession; readSession?: typeof readPriorSession; }
interface Runtime extends RememberedDependencies { serviceKey: string; rpc: (name: string, body: Record<string, unknown>) => Promise<Response>; }
export function recentPriorRange(today = minskToday()) {
  const date = new Date(today+'T00:00:00Z'); date.setUTCDate(date.getUTCDate()-1);
  const to = date.toISOString().slice(0,10); date.setUTCDate(date.getUTCDate()-9);
  return {from: date.toISOString().slice(0,10), to};
}
function publicStatus(value: Record<string, unknown>) {
  return {connected: value.connected === true, reauthRequired: value.reauthRequired === true,
    lastSyncedAt: value.lastSyncedAt ?? null, selectedSourceKey: value.selectedSourceKey ?? null, accountId: value.accountId ?? null};
}
/** The only path that retains bank access: an explicitly requested encrypted session, no password. */
export async function rememberedPrior(req: Request, raw: Record<string, unknown>, owner: string, runtime: Runtime): Promise<string> {
  const enhanced=raw.action==='refresh'||raw.action==='view';
  const action = raw.action==='refresh'?'sync':raw.action;
  const permitted = action === 'connect' ? ['action','login','password','from','to'] : action === 'sync' ? ['action','from','to'] : action === 'select' ? ['action','sourceKey'] : ['action'];
  if (!['connect','sync','status','disconnect','select','view'].includes(String(action)) || Object.keys(raw).some(key => !permitted.includes(key))) throw new PreviewError('INPUT_INVALID','Неподдерживаемый запрос.');
  const state = async (operation: string, data: Record<string, unknown> = {}) => {
    const response = await runtime.rpc('prior_connection_state',{p_owner: owner,p_action: operation,p_data: data});
    if (!response.ok) {
      const body = await response.text();
      if (body.includes('PRIOR_CONNECTION_CHANGED')) throw new PreviewError('CONNECTION_CHANGED','Подключение изменилось. Откройте банк заново.');
      throw new PreviewError('CONNECTION_FAILED','Не удалось обновить защищённое подключение.');
    }
    return object(await response.json());
  };
  if (action === 'status' || action === 'disconnect' || action === 'select') {
    const status = await state(String(action),action === 'select' ? {sourceKey: raw.sourceKey} : {});
    return JSON.stringify({format:'finapp-prior-status',version:1,connection:publicStatus(status)});
  }
  const stored = await state('load');
  const cached=stored.connected===true&&stored.preview?object(stored.preview):null;
  // Read-only opening: never claims a lease, logs in, or competes with the scheduled worker.
  if(action==='view')return JSON.stringify({...(cached??{format:'finapp-prior-connection',version:1,cards:[],externalCards:0}),connection:publicStatus(stored),syncState:'saved'});
  if (action === 'sync' && stored.connected !== true) throw new PreviewError('SESSION_EXPIRED','Войдите в банк, чтобы запомнить подключение.');
  const range = raw.from === undefined && raw.to === undefined ? recentPriorRange() : {from: raw.from, to: raw.to};
  let input: PreviewInput | null = null;
  const attempt = randomUUID(); let claimed = false;
  try {
    input = validateInput(action === 'connect' ? {...raw,...range} : {login:'session',password:'session',...range});
    raw.password = ''; raw.login = '';
    if (action === 'sync' && stored.cacheFresh === true && stored.preview) {
      const cached = object(stored.preview), cards = cached.cards;
      if (Array.isArray(cards) && cards.every(card => object(card).from === input!.from && object(card).to === input!.to)) {
        return JSON.stringify({...cached,connection:publicStatus(stored),...(enhanced?{syncState:'saved'}:{})});
      }
    }
    const loginKey = action === 'connect' ? createHmac('sha256',runtime.serviceKey).update('prior-login-v1:'+input.login.normalize('NFKC').toLowerCase()).digest('hex') : stored.loginKey;
    const claim = await runtime.rpc('claim_prior_connection',{p_owner:owner,p_login_key:loginKey,p_attempt:attempt});
    if (!claim.ok) {
      const reason = await claim.text();
      if(action==='sync'&&reason.includes('PRIOR_CONNECTION_LIMIT')&&cached&&Array.isArray(cached.cards)&&cached.cards.every(card=>object(card).from===input!.from&&object(card).to===input!.to)) {
        return JSON.stringify({...cached,connection:publicStatus(stored),...(enhanced?{syncState:'updating'}:{})});
      }
      throw new PreviewError(reason.includes('PRIOR_CONNECTION_LIMIT') ? 'COOLDOWN' : 'CONNECTION_FAILED','Подключение уже обновляется или временно недоступно.');
    }
    claimed = true;
    const signal = AbortSignal.any([req.signal,AbortSignal.timeout(90_000)]);
    const session = action === 'connect' ? await (runtime.openSession ?? openPriorSession)(input,signal) : validatePriorSession(stored.session);
    input.password = ''; input.login = '';
    const preview = await (runtime.readSession ?? readPriorSession)(session,input,signal);
    const result = JSON.parse(connectionResult(preview)) as Record<string,unknown>;
    if (req.signal.aborted) throw new PreviewError('CANCELLED','Ожидание отменено.');
    const status = await state(action === 'connect' ? 'save' : 'touch',{
      revision: stored.revision,preview: result,...(action === 'connect' ? {session,loginKey} : {}),
    });
    return JSON.stringify({...result,connection:publicStatus(status),...(enhanced?{syncState:'fresh'}:{})});
  } catch (error) {
    if (action === 'sync' && error instanceof PreviewError && ['SESSION_EXPIRED','ACCESS_DENIED','LOGIN_REJECTED'].includes(error.code)) {
      await state('expire',{revision:stored.revision});
      throw new PreviewError('SESSION_EXPIRED','Банк завершил сессию. Войдите заново. Пароль не сохранялся.');
    }
    throw error;
  } finally {
    if (input) {input.password = ''; input.login = '';}
    if (claimed) {try {await runtime.rpc('release_prior_connection',{p_owner:owner,p_attempt:attempt});} catch { /* Expiring lease; never log bank data. */ }}
  }
}
