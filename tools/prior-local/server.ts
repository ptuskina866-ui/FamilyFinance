import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { fetchPreview } from './bank.ts';
import { minskToday, object, validateInput, PreviewError } from './model.ts';
import type { BankPreview, PreviewInput } from './model.ts';

interface LocalOptions {
  port?: number; preview?: (input: PreviewInput, signal: AbortSignal) => Promise<BankPreview>;
  cooldownMs?: number; now?: () => number;
}
async function requestBody(req: IncomingMessage): Promise<unknown> {
  const buffers: Buffer[] = []; let bytes = 0;
  for await (const chunk of req.iterator({ destroyOnReturn: false })) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string);
    bytes += buffer.length;
    if (bytes > 8192) { req.resume(); throw new PreviewError('BODY_TOO_LARGE', 'Запрос слишком большой.'); }
    buffers.push(buffer);
  }
  try { return JSON.parse(Buffer.concat(buffers).toString('utf8')) as unknown; }
  catch { throw new PreviewError('INPUT_INVALID', 'Не удалось прочитать запрос.'); }
}

/** Loopback only. No proxy, remote origins, persistence, telemetry, account writes or export. */
export async function startLocalPreview(options: LocalOptions = {}) {
  const nonce = randomBytes(32).toString('base64url'), page = await readFile(new URL('./page.html', import.meta.url), 'utf8');
  const preview = options.preview || fetchPreview, now = options.now || Date.now;
  const cooldown = options.cooldownMs ?? 60_000;
  let busy = false, lastAttempt: number | null = null;
  const active = new Set<AbortController>();
  const server = createServer({ maxHeaderSize: 8192, requestTimeout: 15_000, headersTimeout: 10_000 }, (req, res) => { void handle(req, res); });
  let origin = '';
  const securityHeaders = {
    'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer', 'Cross-Origin-Resource-Policy': 'same-origin', 'Cross-Origin-Opener-Policy': 'same-origin',
    'Content-Security-Policy': `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; frame-ancestors 'none'; form-action 'self'; base-uri 'none'`,
  };
  const reply = (res: ServerResponse, status: number, body: unknown) => {
    if (res.destroyed || res.writableEnded) return;
    res.writeHead(status, { ...securityHeaders, 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(body));
  };
  async function handle(req: IncomingMessage, res: ServerResponse) {
    let raw: Record<string, unknown> | null = null, input: PreviewInput | null = null;
    try {
      const expectedHost = new URL(origin).host;
      const hosts = req.rawHeaders.filter((_value, index) => index % 2 === 0 && req.rawHeaders[index].toLowerCase() === 'host');
      if (req.headers.host !== expectedHost || hosts.length !== 1) {
        reply(res, 403, { error: 'Доступ разрешён только локальной форме.', code: 'LOCAL_ONLY' }); return;
      }
      if (req.method === 'GET' && req.url === '/') {
        res.writeHead(200, { ...securityHeaders, 'Content-Type': 'text/html; charset=utf-8' });
        res.end(page.replaceAll('__LOCAL_NONCE__', nonce).replaceAll('__TODAY__', minskToday())); return;
      }
      if (req.method !== 'POST' || req.url !== '/api/preview') { reply(res, 404, { error: 'Страница не найдена.', code: 'NOT_FOUND' }); return; }
      const token = req.headers['x-finapp-local'];
      if (req.headers.origin !== origin || (req.headers['sec-fetch-site'] && req.headers['sec-fetch-site'] !== 'same-origin') || req.headers['content-type'] !== 'application/json' || typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token) || !timingSafeEqual(Buffer.from(token), Buffer.from(nonce))) {
        reply(res, 403, { error: 'Откройте локальную форму заново.', code: 'LOCAL_ONLY' }); return;
      }
      if (busy) { reply(res, 409, { error: 'Проверка уже выполняется.', code: 'BUSY' }); return; }
      if (lastAttempt !== null && now() - lastAttempt < cooldown) { reply(res, 429, { error: 'Между попытками входа нужна одна минута.', code: 'COOLDOWN' }); return; }
      raw = object(await requestBody(req)); input = validateInput(raw);
      // A second request might finish reading its body while the first acquired the lock.
      if (busy || (lastAttempt !== null && now() - lastAttempt < cooldown)) { reply(res, 409, { error: 'Другая проверка уже началась.', code: 'BUSY' }); return; }
      busy = true; lastAttempt = now();
      const controller = new AbortController(); active.add(controller);
      const disconnect = () => { if (!res.writableEnded) controller.abort(); };
      res.on('close', disconnect);
      try { reply(res, 200, await preview(input, controller.signal)); }
      finally { busy = false; active.delete(controller); res.off('close', disconnect); }
    } catch (error) {
      const known = error instanceof PreviewError;
      reply(res, known && error.code === 'BODY_TOO_LARGE' ? 413 : 400, {
        error: known ? error.message : 'Проверка остановлена. Никакие операции не сохранены.',
        code: known ? error.code : 'PREVIEW_FAILED',
      });
    } finally {
      if (raw) { raw.password = ''; raw.login = ''; }
      if (input) { input.password = ''; input.login = ''; }
    }
  }
  server.on('clientError', (_error, socket) => { socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n'); });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port ?? 5188, '127.0.0.1', () => { server.off('error', reject); resolve(); });
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Local address unavailable.');
  origin = `http://127.0.0.1:${address.port}`;
  return { origin, server, close: () => new Promise<void>((resolve, reject) => {
    active.forEach(controller => controller.abort()); server.close(error => error ? reject(error) : resolve()); server.closeAllConnections();
  }) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (Number(process.versions.node.split('.')[0]) < 24) { console.error('Для локальной проверки нужен Node.js 24 или новее.'); process.exitCode = 1; }
  else {
    try {
      const local = await startLocalPreview();
      console.log(`Проверка Приорбанка: ${local.origin}/`);
      console.log('Пароли не сохраняются. Файл истории создаётся только по кнопке в локальной форме.');
      for (const event of ['SIGINT', 'SIGTERM'] as const) process.once(event, () => { void local.close(); });
    } catch { console.error('Не удалось запустить локальную проверку. Возможно, порт 5188 уже занят.'); process.exitCode = 1; }
  }
}
