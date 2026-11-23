// Simulátor AC-MemberBackend (EA #127, externý). Nahrádza backendy Members v Sandboxe:
// v role eMSP odpovedá na Authorization (AI-MemberBackendAPI, EA #130).
// Nie je súčasťou contractu API-Hub; slúži testom a ukážke (rola testovacieho prípravku).
import express from 'express';

export type BackendMode = 'online' | 'slow' | 'offline';

export interface SimEmsp {
  memberId: string;
  mode: BackendMode;
  tokens: Map<string, 'ALLOWED' | 'BLOCKED'>;
}

export class MemberBackendSim {
  emsps = new Map<string, SimEmsp>();
  constructor(public slowDelayMs: number) {}
}

export function memberBackendApi(sim: MemberBackendSim) {
  const r = express.Router();
  r.use(express.json());

  r.post('/emsp/:memberId/tokens/:tokenUid/authorize', async (req, res) => {
    const e = sim.emsps.get(req.params.memberId);
    if (!e || e.mode === 'offline') return res.status(503).end();
    if (e.mode === 'slow') await new Promise((ok) => setTimeout(ok, sim.slowDelayMs));
    const status = e.tokens.get(req.params.tokenUid);
    if (!status) return res.status(404).end();
    res.json({ allowed: status });
  });

  return r;
}
