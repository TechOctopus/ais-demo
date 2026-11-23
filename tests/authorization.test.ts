// US-01 – spec/stories/features/US-01.feature
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { expectSchema, startHub } from './helpers.js';

let hub: Awaited<ReturnType<typeof startHub>>;
beforeEach(async () => {
  hub = await startHub();
});
afterEach(() => hub.close());

describe('US-01 Authorization Tokenu pri Roaming session', () => {
  it('SC-01-01 eMSP potvrdí platný Token (R-01)', async () => {
    const r = await hub.authorize('dunaj', 'SK*TAT*000001');
    expect(r.status).toBe(200);
    expectSchema(r.body, 'AuthorizationResult');
    expect(r.body).toMatchObject({ result: 'ACCEPTED', source: 'EMSP_REALTIME', reason: 'TOKEN_VALID', emspId: 'tatra', cpoId: 'dunaj' });
  });

  it('SC-01-02 Token zablokovaný v eMSP neprejde ani cez Whitelist (BR-01)', async () => {
    expect(hub.store.whitelists.get('tatra')?.get('SK*TAT*000001')?.valid).toBe(true);
    hub.sim.emsps.get('tatra')!.tokens.set('SK*TAT*000001', 'BLOCKED');
    const r = await hub.authorize('dunaj', 'SK*TAT*000001');
    expect(r.body).toMatchObject({ result: 'REJECTED', source: 'EMSP_REALTIME', reason: 'TOKEN_BLOCKED' });
  });

  it('SC-01-03 Token OneKey card overí OneKey card unit; Hub nepozná meno Drivera (R-08, QR-02)', async () => {
    const r = await hub.authorize('dunaj', 'SK*ONK*000001');
    expect(r.body).toMatchObject({ result: 'ACCEPTED', source: 'EMSP_REALTIME', emspId: 'onekey-card' });
    const everything = JSON.stringify([r.body, hub.store.authorizations, (await hub.call('hub', 'GET', '/hub/v1/authorizations')).body]);
    expect(everything).not.toContain('Ján Vzorový');
    expect(everything).not.toContain('SUBSCRIPTION');
  });

  it('SC-01-04 Session vlastného Drivera nie je Roaming session (BR-11)', async () => {
    const r = await hub.authorize('tatra', 'SK*TAT*000001');
    expect(r.body).toMatchObject({ result: 'REJECTED', source: 'HUB_RULE', reason: 'NOT_A_ROAMING_SESSION' });
  });

  it('SC-02-01 Nedostupný eMSP – Token je na Whiteliste (R-02)', async () => {
    hub.sim.emsps.get('tatra')!.mode = 'offline';
    const r = await hub.authorize('dunaj', 'SK*TAT*000001');
    expect(r.body).toMatchObject({ result: 'ACCEPTED', source: 'WHITELIST', reason: 'ON_WHITELIST' });
  });

  it('SC-02-01 eMSP neodpovie do časového limitu (OQ-01) – rozhodne Whitelist', async () => {
    hub.sim.emsps.get('tatra')!.mode = 'slow';
    const t0 = Date.now();
    const r = await hub.authorize('dunaj', 'SK*TAT*000002');
    expect(Date.now() - t0).toBeLessThan(450); // nečaká na pomalý backend (500 ms)
    expect(r.body).toMatchObject({ result: 'ACCEPTED', source: 'WHITELIST' });
  });

  it('SC-02-02 Nedostupný eMSP – Token na Whiteliste nie je (BR-02)', async () => {
    hub.sim.emsps.get('tatra')!.mode = 'offline';
    const r = await hub.authorize('dunaj', 'SK*TAT*000099');
    expect(r.body).toMatchObject({ result: 'REJECTED', source: 'WHITELIST', reason: 'NOT_ON_WHITELIST' });
  });

  it('SC-03-01 Pozastavený Member nemá Roaming sessions (R-03, BR-03)', async () => {
    const s = await hub.call('finance', 'PUT', '/hub/v1/members/tatra/status', { status: 'suspended' });
    expect(s.status).toBe(200);
    expectSchema(s.body, 'Member');
    const r = await hub.authorize('dunaj', 'SK*TAT*000001');
    expect(r.body).toMatchObject({ result: 'REJECTED', source: 'HUB_RULE', reason: 'MEMBER_SUSPENDED' });
  });

  it('OQ-03 Nabíjačky pozastaveného Membera ďalej slúžia Driverom iných eMSP', async () => {
    await hub.call('finance', 'PUT', '/hub/v1/members/tatra/status', { status: 'suspended' });
    const r = await hub.authorize('tatra', 'SK*FLG*000001');
    expect(r.body).toMatchObject({ result: 'ACCEPTED', emspId: 'fleetgo' });
  });

  it('Token neznámeho eMSP Hub odmietne', async () => {
    const r = await hub.authorize('dunaj', 'SK*XXX*000001');
    expect(r.body).toMatchObject({ result: 'REJECTED', source: 'HUB_RULE', reason: 'UNKNOWN_EMSP', emspId: null });
  });

  it('QR-01 Každá Authorization má audit záznam', async () => {
    await hub.authorize('dunaj', 'SK*TAT*000001');
    await hub.authorize('tatra', 'SK*TAT*000001');
    const log = await hub.call('hub', 'GET', '/hub/v1/authorizations');
    expect(log.body).toHaveLength(2);
    for (const rec of log.body) expectSchema(rec, 'AuthorizationResult');
  });

  // QR-04: celkovo ≤ limit eMSP (OQ-01: 2 s) + 500 ms vlastného spracovania Hubu.
  // V testoch je limit eMSP skrátený na 150 ms (helpers.ts), rozpočet Hubu 500 ms zostáva rovnaký.
  const HUB_BUDGET_MS = 500;
  const EMSP_TIMEOUT_MS = 150;

  it('QR-04 Vlastné spracovanie Hubu ≤ 500 ms pri každej Authorization (eMSP odpovie hneď)', async () => {
    let worst = 0;
    for (let i = 0; i < 20; i++) {
      const t0 = performance.now();
      const r = await hub.authorize('dunaj', 'SK*TAT*000001');
      worst = Math.max(worst, performance.now() - t0);
      expect(r.body.source).toBe('EMSP_REALTIME');
    }
    expect(worst).toBeLessThan(HUB_BUDGET_MS);
  });

  it('QR-04 Pri pomalom eMSP odpovie Hub do limitu eMSP + 500 ms (Whitelist)', async () => {
    hub.sim.emsps.get('tatra')!.mode = 'slow';
    const t0 = performance.now();
    const r = await hub.authorize('dunaj', 'SK*TAT*000001');
    expect(performance.now() - t0).toBeLessThan(EMSP_TIMEOUT_MS + HUB_BUDGET_MS);
    expect(r.body).toMatchObject({ result: 'ACCEPTED', source: 'WHITELIST' });
  });

  it('QR-03 Bez credentials 401, bez roly CPO 403', async () => {
    const noAuth = await hub.authorize(null as never, 'SK*TAT*000001');
    expect(noAuth.status).toBe(401);
    expectSchema(noAuth.body, 'Problem');
    const emspOnly = await hub.authorize('fleetgo', 'SK*TAT*000001');
    expect(emspOnly.status).toBe(403);
    expect((await hub.call('dunaj', 'GET', '/hub/v1/authorizations')).status).toBe(403);
  });

  it('R-02 eMSP môže poslať iba vlastné Tokeny do Whitelistu', async () => {
    const ok = await hub.call('tatra', 'PUT', '/hub/v1/whitelist', { tokens: [{ uid: 'SK*TAT*000099', valid: true }] });
    expect(ok.body).toEqual({ count: 1 });
    const bad = await hub.call('tatra', 'PUT', '/hub/v1/whitelist', { tokens: [{ uid: 'SK*DUN*000001', valid: true }] });
    expect(bad.status).toBe(422);
    hub.sim.emsps.get('tatra')!.mode = 'offline';
    expect((await hub.authorize('dunaj', 'SK*TAT*000099')).body.source).toBe('WHITELIST');
    expect((await hub.authorize('dunaj', 'SK*TAT*000099')).body.result).toBe('ACCEPTED');
  });
});
