import { supabase } from '../supabaseClient';
import type { PriorBankConnectionStatus, PriorConnectionInput, PriorConnectionResult } from '../types';
import { parsePriorConnection, parsePriorStatus, priorConnectionError } from '../lib/priorBankConnection';

export class PriorBankError extends Error { constructor(message: string, readonly code?: string) { super(message); } }
async function invoke(body: Record<string, unknown>, signal: AbortSignal): Promise<unknown> {
  if (import.meta.env.DEV && new URLSearchParams(window.location.search).get('demo') === '1') {
    throw new Error('Демо не подключается к банку. Откройте рабочий FinApp и войдите в свой аккаунт.');
  }
    const {data, error} = await supabase.functions.invoke<unknown>('prior-connect', {body, signal, timeout: 110_000});
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
    if (error) {
      let code: unknown, status: number | undefined;
      if (error.context instanceof Response) {
        status = error.context.status;
        try {const body: unknown = await error.context.json(); if (body && typeof body === 'object' && 'code' in body) code = body.code;} catch { /* Never display an unverified backend response. */ }
      }
      throw new PriorBankError(priorConnectionError(code, status), typeof code === 'string' ? code : undefined);
    }
    return data;
}
export async function connectPriorBank(input: PriorConnectionInput, signal: AbortSignal): Promise<PriorConnectionResult> {
  try { return parsePriorConnection(await invoke({action: 'connect',apiVersion:2, ...input}, signal)); }
  finally { input.password = ''; input.login = ''; }
}
export async function syncPriorBank(signal: AbortSignal, range?: {from: string; to: string}): Promise<PriorConnectionResult> {
  return parsePriorConnection(await invoke({action: 'refresh',apiVersion:2, ...range}, signal));
}
export async function viewPriorBank(signal:AbortSignal):Promise<PriorConnectionResult> {
  return parsePriorConnection(await invoke({action:'view',apiVersion:2},signal));
}
export async function priorBankStatus(action: 'status' | 'disconnect' | 'select', signal: AbortSignal, sourceKey?: string): Promise<PriorBankConnectionStatus> {
  const value = await invoke({action, ...(sourceKey ? {sourceKey} : {})}, signal);
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Не удалось проверить подключение.');
  const data = value as Record<string, unknown>;
  if (Object.keys(data).length !== 3 || data.format !== 'finapp-prior-status' || data.version !== 1) throw new Error('Не удалось проверить подключение.');
  return parsePriorStatus(data.connection);
}
