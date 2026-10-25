import { openPriorSession, readPriorSession, validatePriorSession } from './bank.ts';
import { object, validateInput, PreviewError, type BankPreview } from './model.ts';

export interface PriorSessionRuntime {
 rpc:(action:string,data?:Record<string,unknown>)=>Promise<Record<string,unknown>>;
 openSession?:typeof openPriorSession;readSession?:typeof readPriorSession;
}
/** One renewal only after explicit expiry. A network failure or 403 never becomes a login loop. */
export async function readRememberedPrior(stored:Record<string,unknown>,range:{from:string;to:string},attempt:string,signal:AbortSignal,runtime:PriorSessionRuntime):Promise<BankPreview> {
 const read=runtime.readSession??readPriorSession;
 try{return await read(validatePriorSession(stored.session),range,signal);}
 catch(error){
  if(!(error instanceof PreviewError)||error.code!=='SESSION_EXPIRED'||stored.autoReconnect!==true)throw error;
 }
 const secret=await runtime.rpc('reauth',{revision:stored.revision,attempt});
 if(!secret.credentials)throw new PreviewError('SESSION_EXPIRED','Для продолжения нужен вход в Приорбанк.');
 const credentials=object(secret.credentials),input=validateInput({...credentials,...range});
 try{
  const session=await(runtime.openSession??openPriorSession)(input,signal);
  const rotated=await runtime.rpc('rotate',{revision:stored.revision,session,loginKey:stored.loginKey,preview:stored.preview});
  Object.assign(stored,rotated,{session});
  return await read(session,range,signal);
 }catch(error){
  if(error instanceof PreviewError&&['LOGIN_REJECTED','BANK_BLOCKED','ADDITIONAL_CONFIRMATION','ACCESS_DENIED'].includes(error.code)){
   await runtime.rpc('auth_failed',{revision:stored.revision});
  }
  throw error;
 }finally{input.password='';input.login='';credentials.password='';credentials.login='';secret.credentials=null;}
}
