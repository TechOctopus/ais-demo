// AC-IdentityService (EA #104) – OneKey card unit ako eMSP. Realizuje AS-AuthorizationService (EA #121)
// cez AI-IdentityAPI (EA #125). Vlastní DO-DriverRecord (EA #128); Hub k nemu nemá prístup (AR-01, R-08).
import express from 'express';

export interface DriverRecord {
  tokenUid: string;
  name: string; // osobný údaj – zostáva v OneKey card unit (GDPR controller)
  plan: 'SUBSCRIPTION' | 'PAY_AS_YOU_GO';
  status: 'ALLOWED' | 'BLOCKED';
}

export class IdentityStorage {
  drivers = new Map<string, DriverRecord>();
}

export function identityApi(storage: IdentityStorage, control: { mode: 'online' | 'slow' | 'offline'; slowDelayMs: number }) {
  const r = express.Router();
  r.use(express.json());

  // emspAuthorizeToken (member-backend-api.openapi.yaml) – odpovedá iba ALLOWED/BLOCKED, nikdy menom.
  r.post('/tokens/:tokenUid/authorize', async (req, res) => {
    if (control.mode === 'offline') return res.status(503).end();
    if (control.mode === 'slow') await new Promise((ok) => setTimeout(ok, control.slowDelayMs));
    const d = storage.drivers.get(req.params.tokenUid);
    if (!d) return res.status(404).end();
    res.json({ allowed: d.status });
  });

  return r;
}
