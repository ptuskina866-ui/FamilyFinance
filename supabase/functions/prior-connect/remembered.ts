import { createHmac, randomUUID } from 'node:crypto';
import { openPriorSession, readPriorSession } from '../_shared/prior/bank.ts';
import { minskToday, object, validateInput, PreviewError, type PreviewInput } from '../_shared/prior/model.ts';
import { connectionResult } from './result.ts';
import { readRememberedPrior } from '../_shared/prior/renewal.ts';

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
/** Explicit session retention; reusable login credentials require separate v2 consent. */
export async function rememberedPrior(req: Request, raw: Record<string, unknown>, owner: string, runtime: Runtime): Promise<string> {
  const v2=raw.apiVersion===2;
  const enhanced=raw.action==='refresh'||raw.action==='view';
  const action = raw.action==='refresh'?'sync':raw.action;
  const permitted = [...(action === 'connect' ? ['action','login','password','from','to'] : action === 'sync' ? ['action','from','to'] : action === 'select' ? ['action','sourceKey'] : ['action']),...(v2?['apiVersion',...(action==='connect'?['autoReconnect']:[])]:[])];
  if (!['connect','sync','status','disconnect','select','view'].includes(String(action)) || Object.keys(raw).some(key => !permitted.includes(key))) throw new PreviewError('INPUT_INVALID','Неподдерживаемый запрос.');
  if(v2&&raw.autoReconnect!==undefined&&typeof raw.autoReconnect!=='boolean')throw new PreviewError('INPUT_INVALID','Проверьте настройку автоподключения.');
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
  const live=()=>v2?{live:{autoReconnect:stored.autoReconnect===true,enabled:stored.liveEnabled===true,ready:stored.liveReady===true}}:{};
  const envelope=(value:Record<string,unknown>)=>JSON.stringify({...value,...(v2?{version:2,...live()}:{}),connection:publicStatus(stored)});
  const cached=(stored.connected===true||(v2&&stored.autoReconnect===true))&&stored.preview?object(stored.preview):null;
  // Read-only opening: never claims a lease, logs in, or competes with the scheduled worker.
  if(action==='view')return envelope({...(cached??{format:'finapp-prior-connection',version:1,cards:[],externalCards:0}),syncState:'saved'});
  if(v2&&action==='sync'&&(stored.liveEnabled===true||stored.liveRequested===true)&&raw.from===undefined&&raw.to===undefined){await state('request');return envelope({...(cached??{format:'finapp-prior-connection',version:1,cards:[],externalCards:0}),syncState:'updating'});}
  if (action === 'sync' && stored.connected !== true&&stored.autoReconnect!==true) throw new PreviewError('SESSION_EXPIRED','Войдите в банк, чтобы запомнить подключение.');
  const range = raw.from === undefined && raw.to === undefined ? recentPriorRange() : {from: raw.from, to: raw.to};
  let input: PreviewInput | null = null;
  const attempt = randomUUID(); let claimed = false;
  try {
    input = validateInput(action === 'connect' ? {...raw,...range} : {login:'session',password:'session',...range});
    raw.password = ''; raw.login = '';
    if (action === 'sync' && stored.cacheFresh === true && stored.preview) {
      const cached = object(stored.preview), cards = cached.cards;
      if (Array.isArray(cards) && cards.every(card => object(card).from === input!.from && object(card).to === input!.to)) {
        return envelope({...cached,...(enhanced?{syncState:'saved'}:{})});
      }
    }
    const loginKey = action === 'connect' ? createHmac('sha256',runtime.serviceKey).update('prior-login-v1:'+input.login.normalize('NFKC').toLowerCase()).digest('hex') : stored.loginKey;
    const claim = await runtime.rpc('claim_prior_connection',{p_owner:owner,p_login_key:loginKey,p_attempt:attempt});
    if (!claim.ok) {
      const reason = await claim.text();
      if(action==='sync'&&reason.includes('PRIOR_CONNECTION_LIMIT')&&cached&&Array.isArray(cached.cards)&&cached.cards.every(card=>object(card).from===input!.from&&object(card).to===input!.to)) {
        return envelope({...cached,...(enhanced?{syncState:'updating'}:{})});
      }
      throw new PreviewError(reason.includes('PRIOR_CONNECTION_LIMIT') ? 'COOLDOWN' : 'CONNECTION_FAILED','Подключение уже обновляется или временно недоступно.');
    }
    claimed = true;
    const signal = AbortSignal.any([req.signal,AbortSignal.timeout(90_000)]);
    const credentials=action==='connect'&&v2&&raw.autoReconnect===true?{login:input.login,password:input.password}:undefined;
    try{
    const session = action === 'connect' ? await (runtime.openSession ?? openPriorSession)(input,signal) : null;
    input.password = ''; input.login = '';
    const preview=action==='connect'?await(runtime.readSession??readPriorSession)(session!,input,signal):await readRememberedPrior(stored,input,attempt,signal,{rpc:state,openSession:runtime.openSession,readSession:runtime.readSession});
    const result = JSON.parse(connectionResult(preview)) as Record<string,unknown>;
    if (req.signal.aborted) throw new PreviewError('CANCELLED','Ожидание отменено.');
    const status = await state(action === 'connect' ? credentials?'save_auto':'save' : 'touch',{
      revision: stored.revision,preview: result,...(action === 'connect' ? {session,loginKey,...(credentials?{credentials}:{})} : {}),
    });
    Object.assign(stored,status);
    return envelope({...result,...(enhanced?{syncState:'fresh'}:{})});
    }finally{if(credentials){credentials.password='';credentials.login='';}}
  } catch (error) {
    if (action === 'sync' && error instanceof PreviewError && ['SESSION_EXPIRED','ACCESS_DENIED','LOGIN_REJECTED','BANK_BLOCKED','ADDITIONAL_CONFIRMATION'].includes(error.code)) {
      if(error.code!=='SESSION_EXPIRED')await state('auth_failed',{revision:stored.revision});
      await state('expire',{revision:stored.revision});
      throw new PreviewError('SESSION_EXPIRED',stored.autoReconnect?'Для продолжения требуется ваш вход в Приорбанк. Проверьте пароль или дополнительное подтверждение.':'Банк завершил сессию. Войдите заново.');
    }
    throw error;
  } finally {
    if (input) {input.password = ''; input.login = '';}
    if (claimed) {try {await runtime.rpc('release_prior_connection',{p_owner:owner,p_attempt:attempt});} catch { /* Expiring lease; never log bank data. */ }}
  }
}
