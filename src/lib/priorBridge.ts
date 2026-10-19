/** Both ends accept only these exact FinApp origins. Local entries are for development. */
export const PRIOR_APP_ORIGINS = [
  'https://familyfinance.ptuskina866.workers.dev',
  'http://127.0.0.1:5173', 'http://localhost:5173',
  'http://127.0.0.1:5190', 'http://localhost:5190',
] as const;
export const PRIOR_LOCAL_ORIGIN = 'http://127.0.0.1:5188';

export function priorConnectionUrl(origin: string, token: string): string {
  if (!PRIOR_APP_ORIGINS.some(value => value === origin) || !/^[a-f0-9]{64}$/.test(token)) {
    throw new Error('Подключение доступно в рабочем FinApp на этом компьютере.');
  }
  // The fragment is consumed and removed locally; it is never sent to the HTTP server.
  return `${PRIOR_LOCAL_ORIGIN}/connect#${new URLSearchParams({ origin, token })}`;
}

export type PriorBridgeMessage = { type: 'finapp-prior-ready'; version: 1; token: string }
  | { type: 'finapp-prior-snapshot'; version: 1; token: string; snapshot: string };

/** Origin and popup identity must be checked BEFORE inspecting this message. */
export function readPriorBridgeMessage(value: unknown, token: string): PriorBridgeMessage | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const data = value as Record<string, unknown>;
  if (!/^[a-f0-9]{64}$/.test(token) || data.token !== token || data.version !== 1) return null;
  const keys = Object.keys(data);
  if (data.type === 'finapp-prior-ready' && keys.length === 3) return { type: data.type, version: 1, token };
  if (data.type !== 'finapp-prior-snapshot' || keys.length !== 4 || typeof data.snapshot !== 'string' || data.snapshot.length > 8_000_000) return null;
  return { type: data.type, version: 1, token, snapshot: data.snapshot };
}
