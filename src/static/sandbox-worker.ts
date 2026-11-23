// Statická verzia Sandboxu (GitHub Pages): celý server prototypu – createApp() so všetkými komponentmi
// (Hub Service, Identity Service, simulátor External Provider Service) – beží v prehliadači v SharedWorkeri.
// Všetky otvorené okná (CPO, eMSP, Hub a Finance) sa pripoja k tomu istému workeru, takže zdieľajú
// jeden stav a dostávajú živé udalosti rovnako ako cez SSE pri skutočnom serveri.
// Kód Hubu sa nemení: `express` je pri builde nahradený modulom ./express-shim.ts.
import { createApp } from '../server/app.js';
import { dispatch, openStream, type ShimRouter } from './express-shim.js';

const ORIGIN = 'http://sandbox.invalid';

const created = createApp({ emspTimeoutMs: 2000 });
const app = created.app as unknown as ShimRouter;
created.setBaseUrl(ORIGIN);

// HttpEmspGateway volá rozhrania eMSP cez fetch – v prehliadači ich doručíme priamo do tej istej aplikácie
// (vrátane limitu odpovede cez AbortSignal.timeout).
const nativeFetch = globalThis.fetch.bind(globalThis);
globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
  if (url.origin !== ORIGIN) return nativeFetch(input, init);
  const res = await dispatch(
    app,
    { method: init?.method ?? 'GET', url: url.pathname + url.search, headers: init?.headers as Record<string, string>, body: init?.body as string },
    init?.signal,
  );
  return new Response(res.body, { status: res.statusCode, headers: res.headers });
};

export type WorkerRequest =
  | { type: 'request'; id: number; method: string; url: string; headers: Record<string, string>; body?: string }
  | { type: 'bye' };
export type WorkerMessage =
  | { type: 'response'; id: number; status: number; text: string }
  | { type: 'event'; event: unknown };

interface Port {
  postMessage(m: WorkerMessage): void;
  onmessage: ((e: MessageEvent<WorkerRequest>) => void) | null;
}

function attach(port: Port) {
  const close = openStream(app, '/sandbox/events', (chunk) => {
    for (const line of chunk.split('\n')) {
      if (line.startsWith('data: ')) port.postMessage({ type: 'event', event: JSON.parse(line.slice(6)) });
    }
  });
  port.onmessage = async (e) => {
    const m = e.data;
    if (m.type === 'bye') return close();
    try {
      const res = await dispatch(app, m);
      port.postMessage({ type: 'response', id: m.id, status: res.statusCode, text: res.body ?? '' });
    } catch {
      port.postMessage({ type: 'response', id: m.id, status: 0, text: '' });
    }
  };
}

const scope = globalThis as unknown as { onconnect?: unknown } & Port;
if ('onconnect' in scope) {
  scope.onconnect = (e: MessageEvent) => attach(e.ports[0] as unknown as Port);
} else {
  // Prehliadač bez SharedWorker (napr. Chrome na Androide) – dedikovaný worker, stav iba pre jednu kartu.
  attach(scope);
}
