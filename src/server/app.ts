// Zloženie Artifactu ART-HubPrototypePackage: AC-HubService + AC-IdentityService + simulátor AC-MemberBackend.
// Každý komponent má vlastné úložisko a komunikuje iba cez HTTP rozhranie (AR-01 … AR-03).
import express from 'express';
import { HubStore } from './hub/store.js';
import { HttpEmspGateway } from './hub/emsp-gateway.js';
import { AuthorizationService } from './hub/authorization.js';
import { CdrService } from './hub/cdrs.js';
import { SettlementService } from './hub/settlement.js';
import { hubApi } from './hub/api.js';
import { identityApi, IdentityStorage } from './identity/identity-service.js';
import { MemberBackendSim, memberBackendApi, type BackendMode } from './member-sim/member-backend-sim.js';
import { CREDENTIALS, LOCATIONS, seed } from './seed.js';
import type { Clock } from './hub/domain.js';

export interface AppOptions {
  /** OQ-01: limit odpovede eMSP (predvolene 2000 ms; env EMSP_TIMEOUT_MS) */
  emspTimeoutMs?: number;
  /** oneskorenie „pomalého“ simulovaného backendu */
  slowDelayMs?: number;
  now?: Clock;
}

export function createApp(opts: AppOptions = {}) {
  const emspTimeoutMs = opts.emspTimeoutMs ?? Number(process.env.EMSP_TIMEOUT_MS ?? 2000);
  const slowDelayMs = opts.slowDelayMs ?? emspTimeoutMs + 1500;
  const now: Clock = opts.now ?? (() => new Date());
  let baseUrl = 'http://127.0.0.1:4000';

  const store = new HubStore();
  const identity = new IdentityStorage();
  const identityControl = { mode: 'online' as BackendMode, slowDelayMs };
  const sim = new MemberBackendSim(slowDelayMs);
  seed(store, identity, sim, now());

  const gateway = new HttpEmspGateway(() => baseUrl, emspTimeoutMs);
  const authz = new AuthorizationService(store, gateway, now);
  const cdrs = new CdrService(store, now);
  const settlement = new SettlementService(store, now);

  const app = express();

  // Živá synchronizácia stránok Sandboxu (CPO, eMSP, Hub a Finance v samostatných oknách):
  // po každej úspešnej zmene cez Hub API alebo ovládanie Sandboxu dostanú všetky otvorené
  // stránky udalosť (Server-Sent Events) a znovu si načítajú stav. Nie je súčasťou contractu.
  const listeners = new Set<express.Response>();
  const broadcast = (event: object) => {
    const frame = `data: ${JSON.stringify(event)}\n\n`;
    for (const l of listeners) l.write(frame);
  };
  app.use((req, res, next) => {
    if (req.method !== 'GET' && (req.path.startsWith('/hub/') || req.path.startsWith('/sandbox/'))) {
      res.on('finish', () => {
        if (res.statusCode < 400)
          broadcast({ source: req.get('x-sandbox-client') ?? null, method: req.method, path: req.originalUrl, status: res.statusCode });
      });
    }
    next();
  });

  app.use('/hub/v1', hubApi({ store, authz, cdrs, settlement }));
  app.use('/identity/v1', identityApi(identity, identityControl));
  app.use('/sim', memberBackendApi(sim));

  // Ovládanie Sandboxu pre ukážku (nie je súčasťou contractu API-Hub).
  const control = express.Router();
  control.use(express.json());
  control.get('/state', (_req, res) =>
    res.json({
      now: now().toISOString(),
      emspTimeoutMs,
      credentials: CREDENTIALS,
      locations: LOCATIONS,
      emsps: [...sim.emsps.values()].map((e) => ({ memberId: e.memberId, mode: e.mode, tokens: Object.fromEntries(e.tokens) })),
      identity: { mode: identityControl.mode, tokens: Object.fromEntries([...identity.drivers.values()].map((d) => [d.tokenUid, d.status])) },
      whitelists: Object.fromEntries([...store.whitelists].map(([id, wl]) => [id, [...wl.values()]])),
    }),
  );
  control.get('/events', (req, res) => {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
    res.write('retry: 1000\n\n');
    listeners.add(res);
    const ping = setInterval(() => res.write(': ping\n\n'), 20_000);
    req.on('close', () => {
      clearInterval(ping);
      listeners.delete(res);
    });
  });
  control.put('/emsp/:memberId/mode', (req, res) => {
    const mode = req.body?.mode as BackendMode;
    if (req.params.memberId === 'onekey-card') identityControl.mode = mode;
    else {
      const e = sim.emsps.get(req.params.memberId);
      if (!e) return res.status(404).end();
      e.mode = mode;
    }
    res.json({ mode });
  });
  control.put('/emsp/:memberId/tokens/:uid', (req, res) => {
    const status = req.body?.status === 'BLOCKED' ? 'BLOCKED' : 'ALLOWED';
    if (req.params.memberId === 'onekey-card') {
      const d = identity.drivers.get(req.params.uid);
      if (!d) return res.status(404).end();
      d.status = status;
    } else {
      const e = sim.emsps.get(req.params.memberId);
      if (!e) return res.status(404).end();
      e.tokens.set(req.params.uid, status);
    }
    res.json({ status });
  });
  control.post('/reset', (_req, res) => {
    for (const k of ['members', 'credentials', 'whitelists'] as const) store[k].clear();
    store.tariffs.length = 0;
    store.authorizations.length = 0;
    store.cdrs.length = 0;
    store.claims.length = 0;
    store.periods.length = 0;
    store.statements.length = 0;
    identity.drivers.clear();
    sim.emsps.clear();
    identityControl.mode = 'online';
    seed(store, identity, sim, now());
    res.json({ ok: true });
  });
  app.use('/sandbox', control);

  return {
    app,
    store,
    identity,
    sim,
    identityControl,
    setBaseUrl: (u: string) => {
      baseUrl = u;
    },
  };
}
