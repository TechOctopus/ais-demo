// AI-HubAPI (EA #126) – realizácia approved contractu API-Hub 0.1.0
// (spec/contracts/approved/hub-api.openapi.yaml). Mení iba to, čo contract dovoľuje.
import express, { type NextFunction, type Request, type Response } from 'express';
import { HubError, type CdrInput, type Member } from './domain.js';
import type { AuthorizationService } from './authorization.js';
import type { CdrService } from './cdrs.js';
import type { SettlementService } from './settlement.js';
import type { HubStore } from './store.js';

type Caller = { kind: 'member'; member: Member } | { kind: 'staff'; role: 'FINANCE' | 'HUB' };

declare module 'express-serve-static-core' {
  interface Request {
    caller?: Caller;
  }
}

const problem = (res: Response, status: number, title: string, violations?: unknown[]) =>
  res
    .status(status)
    .type('application/problem+json')
    .json({ type: 'about:blank', title, status, ...(violations && violations.length ? { violations } : {}) });

export function hubApi(deps: { store: HubStore; authz: AuthorizationService; cdrs: CdrService; settlement: SettlementService }) {
  const { store, authz, cdrs, settlement } = deps;
  const r = express.Router();
  r.use(express.json());

  // QR-03: autentifikácia hlavičkou "Authorization: Token <credentials>".
  r.use((req, res, next) => {
    const m = /^Token\s+(.+)$/.exec(req.header('authorization') ?? '');
    const cred = m ? store.credentials.get(m[1].trim()) : undefined;
    if (!cred) return problem(res, 401, 'Chýbajú alebo sú neplatné prihlasovacie údaje');
    if (cred.kind === 'staff') req.caller = cred;
    else {
      const member = store.members.get(cred.memberId);
      if (!member) return problem(res, 401, 'Neznámy Member');
      req.caller = { kind: 'member', member };
    }
    next();
  });

  const asMember = (req: Request, res: Response, role: 'CPO' | 'EMSP'): Member | undefined => {
    const c = req.caller!;
    if (c.kind === 'member' && c.member.roles.includes(role)) return c.member;
    problem(res, 403, `Operácia vyžaduje rolu ${role}`);
    return undefined;
  };
  const asStaff = (req: Request, res: Response, ...roles: Array<'FINANCE' | 'HUB'>): boolean => {
    const c = req.caller!;
    if (c.kind === 'staff' && roles.includes(c.role)) return true;
    problem(res, 403, `Operácia vyžaduje rolu ${roles.join(' alebo ')}`);
    return false;
  };
  const isStaff = (req: Request) => req.caller!.kind === 'staff';

  // authorizeToken
  r.post('/tokens/:tokenUid/authorize', async (req, res, next) => {
    try {
      const cpo = asMember(req, res, 'CPO');
      if (!cpo) return;
      const locationId = String(req.body?.locationId ?? '');
      res.json(await authz.authorize(cpo, req.params.tokenUid, locationId));
    } catch (e) {
      next(e);
    }
  });

  // replaceWhitelist
  r.put('/whitelist', (req, res) => {
    const emsp = asMember(req, res, 'EMSP');
    if (!emsp) return;
    const tokens: Array<{ uid: string; valid: boolean }> = Array.isArray(req.body?.tokens) ? req.body.tokens : [];
    const foreign = tokens.filter((t) => !emsp.partyIds.some((p) => String(t.uid).startsWith(`${p}*`)));
    if (foreign.length) {
      return problem(res, 422, 'Whitelist obsahuje cudzie Tokeny', foreign.map((t) => ({ rule: 'R-02', message: `Token ${t.uid} nevydal tento eMSP` })));
    }
    store.whitelists.set(emsp.memberId, new Map(tokens.map((t) => [t.uid, { uid: t.uid, valid: Boolean(t.valid) }])));
    res.json({ count: tokens.length });
  });

  // listTariffVersions / putTariffVersion
  r.get('/tariffs', (_req, res) => res.json(store.tariffs));
  r.put('/tariffs/:tariffId/versions/:versionId', (req, res) => {
    const cpo = asMember(req, res, 'CPO');
    if (!cpo) return;
    const { tariffId, versionId } = req.params;
    const price = Number(req.body?.pricePerKwhCents);
    const validFrom = String(req.body?.validFrom ?? '');
    if (store.tariffs.some((t) => t.tariffId === tariffId && t.versionId === versionId)) {
      return problem(res, 409, `Tariff version ${versionId} už existuje`);
    }
    if (store.tariffs.some((t) => t.tariffId === tariffId && t.cpoId !== cpo.memberId)) return problem(res, 403, 'Tarifa patrí inému CPO');
    if (!(price > 0) || Number.isNaN(Date.parse(validFrom))) {
      return problem(res, 422, 'Neplatná Tariff version', [{ rule: 'BR-04', message: 'Cena musí byť > 0 a validFrom platný čas' }]);
    }
    const tv = { tariffId, versionId, cpoId: cpo.memberId, pricePerKwhCents: price, validFrom: new Date(validFrom).toISOString() };
    store.tariffs.push(tv);
    res.status(201).json(tv);
  });

  // submitCdr / listCdrs
  r.post('/cdrs', (req, res, next) => {
    try {
      const cpo = asMember(req, res, 'CPO');
      if (!cpo) return;
      const b = req.body ?? {};
      const input: CdrInput = {
        cdrId: String(b.cdrId ?? ''),
        tokenUid: String(b.tokenUid ?? ''),
        locationId: String(b.locationId ?? ''),
        tariffId: String(b.tariffId ?? ''),
        tariffVersionId: String(b.tariffVersionId ?? ''),
        startTime: String(b.startTime ?? ''),
        endTime: String(b.endTime ?? ''),
        energyKwh: Number(b.energyKwh),
        totalCostCents: Math.round(Number(b.totalCostCents)),
      };
      res.status(201).json(cdrs.submit(cpo, input));
    } catch (e) {
      next(e);
    }
  });
  r.get('/cdrs', (req, res) => {
    const c = req.caller!;
    res.json(isStaff(req) ? store.cdrs : store.cdrs.filter((x) => c.kind === 'member' && (x.cpoId === c.member.memberId || x.emspId === c.member.memberId)));
  });

  // listStatements
  r.get('/statements', (req, res) => {
    const c = req.caller!;
    const period = req.query.period ? String(req.query.period) : undefined;
    res.json(
      store.statements.filter((s) => (!period || s.period === period) && (isStaff(req) || (c.kind === 'member' && s.memberId === c.member.memberId))),
    );
  });

  // listSettlementPeriods / closeSettlementPeriod
  r.get('/settlement-periods', (_req, res) => res.json(store.periods));
  r.post('/settlement-periods/:period/close', (req, res, next) => {
    try {
      if (!asStaff(req, res, 'FINANCE')) return;
      res.json(settlement.close(req.params.period));
    } catch (e) {
      next(e);
    }
  });

  // listMembers / setMemberStatus
  r.get('/members', (req, res) => {
    if (!asStaff(req, res, 'FINANCE', 'HUB')) return;
    res.json([...store.members.values()].map(({ emspEndpoint: _e, ...m }) => m));
  });
  r.put('/members/:memberId/status', (req, res) => {
    if (!asStaff(req, res, 'FINANCE')) return;
    const m = store.members.get(req.params.memberId);
    if (!m) return problem(res, 404, 'Member neexistuje');
    const status = req.body?.status;
    if (status !== 'active' && status !== 'suspended') return problem(res, 422, 'Stav musí byť active alebo suspended');
    m.status = status;
    const { emspEndpoint: _e, ...pub } = m;
    res.json(pub);
  });

  // listAuthorizations (QR-01)
  r.get('/authorizations', (req, res) => {
    if (!asStaff(req, res, 'FINANCE', 'HUB')) return;
    res.json(store.authorizations);
  });

  r.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof HubError) return problem(res, err.status, err.title, err.violations);
    console.error(err);
    return problem(res, 500, 'Interná chyba Hubu');
  });

  return r;
}
