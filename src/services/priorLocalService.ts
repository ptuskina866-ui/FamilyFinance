import type { PriorImportSnapshot } from '../types';
import { PRIOR_LOCAL_ORIGIN, priorConnectionUrl, readPriorBridgeMessage } from '../lib/priorBridge';
import { parsePriorImportFile } from '../lib/priorImport';

interface ConnectionCallbacks {
  onReady: () => void;
  onSnapshot: (snapshot: PriorImportSnapshot) => void;
  onError: (message: string) => void;
}

/** A user-initiated, single-card exchange. Never receives bank login or session data. */
export function connectPriorLocal(callbacks: ConnectionCallbacks): { cancel: () => void } | null {
  const token = Array.from(crypto.getRandomValues(new Uint8Array(32)), byte => byte.toString(16).padStart(2, '0')).join('');
  let popup: Window | null = null, ready = false, finished = false;
  let timeout: ReturnType<typeof setTimeout>, closed: ReturnType<typeof setInterval>;
  const cleanup = (close: boolean) => {
    finished = true; window.removeEventListener('message', receive);
    clearTimeout(timeout); clearInterval(closed);
    if (close && popup && !popup.closed) popup.close();
  };
  const fail = (message: string) => { if (finished) return; cleanup(true); callbacks.onError(message); };
  const receive = (event: MessageEvent<unknown>) => {
    if (finished || !popup || event.source !== popup || event.origin !== PRIOR_LOCAL_ORIGIN) return;
    const data = readPriorBridgeMessage(event.data, token);
    if (!data) return;
    if (data.type === 'finapp-prior-ready') {
      popup.postMessage({ type: 'finapp-prior-ack', version: 1, token }, PRIOR_LOCAL_ORIGIN);
      if (!ready) {
        ready = true; clearTimeout(timeout); callbacks.onReady();
        timeout = setTimeout(() => fail('Время подключения истекло. Откройте подключение заново.'), 10 * 60_000);
      }
      return;
    }
    if (!ready) return;
    try {
      const snapshot = parsePriorImportFile(data.snapshot);
      callbacks.onSnapshot(snapshot);
      popup.postMessage({ type: 'finapp-prior-received', version: 1, token }, PRIOR_LOCAL_ORIGIN);
      cleanup(false);
    } catch {
      fail('Помощник вернул неподдерживаемые данные. Ничего не добавлено. Получите историю заново.');
    }
  };
  try {
    const url = priorConnectionUrl(window.location.origin, token);
    window.addEventListener('message', receive);
    // Keep the opener only for this verified loopback page. It has no links or remote scripts.
    popup = window.open(url, '_blank', 'popup,width=500,height=760');
    if (!popup) { fail('Разрешите всплывающее окно для FinApp и нажмите «Подключить Приорбанк» ещё раз.'); return null; }
    timeout = setTimeout(() => fail('Помощник не ответил. Запустите Start-Prior-Preview.cmd на этом компьютере и повторите подключение.'), 30_000);
    closed = setInterval(() => { if (popup?.closed) fail('Окно подключения закрыто. Можно попробовать снова.'); }, 750);
    return { cancel: () => cleanup(true) };
  } catch {
    fail('Не удалось открыть подключение. Откройте рабочий FinApp в браузере на компьютере и попробуйте снова.');
    return null;
  }
}
