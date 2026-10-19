import { supabase } from '../supabaseClient';
import type { PriorConnectionInput, PriorConnectionResult } from '../types';
import { parsePriorConnection, priorConnectionError } from '../lib/priorBankConnection';

export async function connectPriorBank(input: PriorConnectionInput, signal: AbortSignal): Promise<PriorConnectionResult> {
  if (import.meta.env.DEV && new URLSearchParams(window.location.search).get('demo') === '1') {
    input.password = '';
    throw new Error('Демо не подключается к банку. Откройте рабочий FinApp и войдите в свой аккаунт.');
  }
  try {
    const {data, error} = await supabase.functions.invoke<unknown>('prior-connect', {body: input, signal, timeout: 110_000});
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
    if (error) {
      let code: unknown, status: number | undefined;
      if (error.context instanceof Response) {
        status = error.context.status;
        try {const body: unknown = await error.context.json(); if (body && typeof body === 'object' && 'code' in body) code = body.code;} catch { /* Never display an unverified backend response. */ }
      }
      throw new Error(priorConnectionError(code, status));
    }
    return parsePriorConnection(data);
  } finally { input.password = ''; input.login = ''; }
}
