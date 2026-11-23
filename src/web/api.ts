// Klient Hub API (contract API-Hub 0.1.0). UI vystupuje v mene Members a Finance
// s ich Sandbox credentials – presne ako by volal ich backend.

export type Who = 'tatra' | 'dunaj' | 'sitno' | 'fleetgo' | 'onekey-card' | 'finance' | 'hub';

export interface SandboxState {
  now: string;
  emspTimeoutMs: number;
  credentials: Record<Who, string>;
  locations: Record<string, string[]>;
  emsps: Array<{ memberId: string; mode: Mode; tokens: Record<string, 'ALLOWED' | 'BLOCKED'> }>;
  identity: { mode: Mode; tokens: Record<string, 'ALLOWED' | 'BLOCKED'> };
  whitelists: Record<string, Array<{ uid: string; valid: boolean }>>;
}
export type Mode = 'online' | 'slow' | 'offline';

export interface Member {
  memberId: string;
  name: string;
  roles: Array<'CPO' | 'EMSP'>;
  status: 'active' | 'suspended';
  partyIds: string[];
  hubFee: { kind: 'FIXED' | 'PERCENT'; value: number };
}
export interface AuthorizationResult {
  authorizationId: string;
  tokenUid: string;
  cpoId: string;
  emspId: string | null;
  locationId: string;
  result: 'ACCEPTED' | 'REJECTED';
  source: 'EMSP_REALTIME' | 'WHITELIST' | 'HUB_RULE';
  reason: string;
  decidedAt: string;
}
export interface TariffVersion {
  tariffId: string;
  versionId: string;
  cpoId: string;
  pricePerKwhCents: number;
  validFrom: string;
}
export interface Cdr {
  cdrId: string;
  tokenUid: string;
  cpoId: string;
  emspId: string;
  energyKwh: number;
  totalCostCents: number;
  hubFeeCents: number;
  settlementPeriod: string;
  status: 'accepted' | 'settled';
  tariffVersionId: string;
}
export interface Statement {
  period: string;
  memberId: string;
  receivablesCents: number;
  payablesCents: number;
  hubFeesCents: number;
  netBalanceCents: number;
  cdrCount: number;
}
export interface Period {
  period: string;
  status: 'open' | 'closed';
}
export interface Problem {
  title: string;
  status: number;
  violations?: Array<{ rule: string; message: string }>;
}

// Nastavené pri builde (scripts/build-web.mjs, vite.config.ts).
declare const __STATIC__: boolean;
declare const __WORKER_URL__: string;

let creds: Record<string, string> = {};
export const setCredentials = (c: Record<string, string>) => {
  creds = c;
};

// Identita tejto stránky – server ju vráti v udalosti, aby stránka vedela, že zmenu urobila sama.
const clientId = globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2);

export interface SandboxEvent {
  source: string | null;
  method: string;
  path: string;
  status: number;
}
export const isMine = (e: SandboxEvent) => e.source === clientId;

type BusMessage =
  | { type: 'hello' }
  | { type: 'live'; ok: boolean }
  | { type: 'event'; event: SandboxEvent };

/* ---- Statická verzia (GitHub Pages): server beží v prehliadači v SharedWorkeri ---- */

type WorkerPort = { postMessage(m: unknown): void; onmessage: ((e: MessageEvent) => void) | null };
let workerPort: WorkerPort | null = null;
let nextId = 0;
const pending = new Map<number, (r: { status: number; text: string }) => void>();
const workerListeners = new Set<(e: SandboxEvent) => void>();

function worker(): WorkerPort {
  if (workerPort) return workerPort;
  if (typeof SharedWorker !== 'undefined') {
    const sw = new SharedWorker(__WORKER_URL__, { name: 'onekey-sandbox' });
    workerPort = sw.port;
  } else {
    workerPort = new Worker(__WORKER_URL__, { name: 'onekey-sandbox' });
  }
  workerPort.onmessage = (e) => {
    const m = e.data;
    if (m.type === 'response') {
      pending.get(m.id)?.(m);
      pending.delete(m.id);
    } else if (m.type === 'event') {
      for (const l of workerListeners) l(m.event as SandboxEvent);
    }
  };
  window.addEventListener('pagehide', () => workerPort?.postMessage({ type: 'bye' }));
  return workerPort;
}

function workerFetch(method: string, url: string, headers: Record<string, string>, body?: string) {
  return new Promise<{ status: number; text: string }>((resolve) => {
    const id = ++nextId;
    pending.set(id, resolve);
    worker().postMessage({ type: 'request', id, method, url, headers, body });
  });
}

/**
 * Živé udalosti zo servera (SSE).
 * Používa jedno zdieľané SSE spojenie pre všetky otvorené karty/okná (Web Locks + BroadcastChannel),
 * aby prehliadač nikdy nevyčerpal HTTP/1.1 limit 6 súbežných spojení na jeden origin.
 */
export function subscribe(onEvent: (e: SandboxEvent) => void, onLive: (live: boolean) => void) {
  if (__STATIC__) {
    worker();
    workerListeners.add(onEvent);
    onLive(true);
    return () => {
      workerListeners.delete(onEvent);
    };
  }

  let closed = false;

  const openDirect = () => {
    const es = new EventSource('/sandbox/events');
    es.onopen = () => !closed && onLive(true);
    es.onerror = () => !closed && onLive(false);
    es.onmessage = (m) => !closed && onEvent(JSON.parse(m.data) as SandboxEvent);
    const cleanup = () => {
      if (closed) return;
      closed = true;
      es.close();
      window.removeEventListener('pagehide', cleanup);
    };
    window.addEventListener('pagehide', cleanup);
    return cleanup;
  };

  if (typeof BroadcastChannel === 'undefined' || !navigator.locks) {
    return openDirect();
  }

  const channel = new BroadcastChannel('onekey-sandbox-sse');
  const ac = new AbortController();
  let isLeader = false;
  let leaderLive = false;
  let es: EventSource | null = null;
  let releaseLock: (() => void) | null = null;

  channel.onmessage = (msg: MessageEvent<BusMessage>) => {
    if (closed) return;
    const data = msg.data;
    if (data.type === 'hello') {
      if (isLeader) channel.postMessage({ type: 'live', ok: leaderLive } satisfies BusMessage);
    } else if (data.type === 'live') {
      onLive(data.ok);
    } else if (data.type === 'event') {
      onEvent(data.event);
    }
  };

  // Opýtame sa existujúceho lídra na aktuálny stav spojenia
  channel.postMessage({ type: 'hello' } satisfies BusMessage);

  void navigator.locks
    .request('onekey-sandbox-sse-leader', { signal: ac.signal }, () => {
      if (closed) return Promise.resolve();
      isLeader = true;
      return new Promise<void>((resolve) => {
        releaseLock = resolve;
        es = new EventSource('/sandbox/events');
        es.onopen = () => {
          if (closed) return;
          leaderLive = true;
          onLive(true);
          channel.postMessage({ type: 'live', ok: true } satisfies BusMessage);
        };
        es.onerror = () => {
          if (closed) return;
          leaderLive = false;
          onLive(false);
          channel.postMessage({ type: 'live', ok: false } satisfies BusMessage);
        };
        es.onmessage = (m) => {
          if (closed) return;
          const event = JSON.parse(m.data) as SandboxEvent;
          onEvent(event);
          channel.postMessage({ type: 'event', event } satisfies BusMessage);
        };
      });
    })
    .catch(() => {
      // AbortError pri zatvorení karty počas čakania na zámok – očakávané
    });

  const cleanup = () => {
    if (closed) return;
    closed = true;
    ac.abort();
    es?.close();
    es = null;
    isLeader = false;
    releaseLock?.();
    releaseLock = null;
    channel.close();
    window.removeEventListener('pagehide', cleanup);
  };
  window.addEventListener('pagehide', cleanup);
  return cleanup;
}

async function req<T>(method: string, url: string, who?: Who, body?: unknown): Promise<{ ok: true; data: T } | { ok: false; problem: Problem }> {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'x-sandbox-client': clientId,
    ...(who ? { authorization: `Token ${creds[who]}` } : {}),
  };
  const payload = body === undefined ? undefined : JSON.stringify(body);
  try {
    let status: number;
    let text: string;
    if (__STATIC__) {
      ({ status, text } = await workerFetch(method, url, headers, payload));
      if (status === 0) throw new Error('worker');
    } else {
      const res = await fetch(url, { method, headers, body: payload });
      status = res.status;
      text = await res.text();
    }
    const json = text ? JSON.parse(text) : undefined;
    return status >= 200 && status < 300 ? { ok: true, data: json as T } : { ok: false, problem: json as Problem };
  } catch {
    return { ok: false, problem: { title: 'Server nie je dostupný', status: 0 } };
  }
}

const hub = (p: string) => `/hub/v1${p}`;

export const api = {
  state: () => req<SandboxState>('GET', '/sandbox/state'),
  reset: () => req('POST', '/sandbox/reset'),
  setMode: (memberId: string, mode: Mode) => req('PUT', `/sandbox/emsp/${memberId}/mode`, undefined, { mode }),
  setToken: (memberId: string, uid: string, status: 'ALLOWED' | 'BLOCKED') => req('PUT', `/sandbox/emsp/${memberId}/tokens/${encodeURIComponent(uid)}`, undefined, { status }),

  authorize: (cpo: Who, tokenUid: string, locationId: string) => req<AuthorizationResult>('POST', hub(`/tokens/${encodeURIComponent(tokenUid)}/authorize`), cpo, { locationId }),
  pushWhitelist: (emsp: Who, tokens: Array<{ uid: string; valid: boolean }>) => req<{ count: number }>('PUT', hub('/whitelist'), emsp, { tokens }),
  tariffs: () => req<TariffVersion[]>('GET', hub('/tariffs'), 'hub'),
  putTariff: (cpo: Who, tariffId: string, versionId: string, pricePerKwhCents: number, validFrom: string) =>
    req<TariffVersion>('PUT', hub(`/tariffs/${tariffId}/versions/${versionId}`), cpo, { pricePerKwhCents, validFrom }),
  submitCdr: (cpo: Who, cdr: Record<string, unknown>) => req<Cdr>('POST', hub('/cdrs'), cpo, cdr),
  cdrs: () => req<Cdr[]>('GET', hub('/cdrs'), 'finance'),
  members: () => req<Member[]>('GET', hub('/members'), 'finance'),
  setStatus: (memberId: string, status: 'active' | 'suspended') => req<Member>('PUT', hub(`/members/${memberId}/status`), 'finance', { status }),
  authorizations: () => req<AuthorizationResult[]>('GET', hub('/authorizations'), 'hub'),
  periods: () => req<Period[]>('GET', hub('/settlement-periods'), 'finance'),
  close: (period: string) => req<{ period: string; statements: Statement[]; hubFeeIncomeCents: number; nextOpenPeriod: string }>('POST', hub(`/settlement-periods/${period}/close`), 'finance'),
  statements: () => req<Statement[]>('GET', hub('/statements'), 'finance'),
};

export const eur = (cents: number) => (cents / 100).toLocaleString('sk-SK', { style: 'currency', currency: 'EUR' });
