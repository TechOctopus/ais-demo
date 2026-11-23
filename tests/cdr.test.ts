// US-02 (časť CDR) – spec/stories/features/US-02.feature
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cdr, expectSchema, startHub } from './helpers.js';

let hub: Awaited<ReturnType<typeof startHub>>;
beforeEach(async () => {
  hub = await startHub();
});
afterEach(() => hub.close());

const rules = (body: { violations?: Array<{ rule: string }> }) => (body.violations ?? []).map((v) => v.rule);

describe('US-02 Prijatie CDR', () => {
  it('SC-04-01 Platný CDR vstúpi do Settlement a vzniknú pohľadávky (R-04, BR-08)', async () => {
    const r = await hub.submitCdr('dunaj', cdr({ cdrId: 'A-1' }));
    expect(r.status).toBe(201);
    expectSchema(r.body, 'Cdr');
    expect(r.body).toMatchObject({ status: 'accepted', settlementPeriod: '2026-11', cpoId: 'dunaj', emspId: 'tatra', hubFeeCents: 30 });
    const claims = hub.store.claims.filter((c) => c.cdrId === 'A-1');
    expect(claims).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'CDR_COST', debtorId: 'tatra', creditorId: 'dunaj', amountCents: 1350 }),
        expect.objectContaining({ kind: 'HUB_FEE', debtorId: 'tatra', creditorId: 'HUB', amountCents: 30 }),
      ]),
    );
  });

  it('SC-04-02 CDR so zlou Tariff version (BR-04)', async () => {
    const v2 = await hub.call('dunaj', 'PUT', '/hub/v1/tariffs/DUN-AC/versions/DUN-AC-v2', { pricePerKwhCents: 49, validFrom: '2026-11-15T00:00:00Z' });
    expect(v2.status).toBe(201);
    expectSchema(v2.body, 'TariffVersion');
    const r = await hub.submitCdr('dunaj', cdr({ startTime: '2026-11-19T08:00:00Z', tariffVersionId: 'DUN-AC-v1' }));
    expect(r.status).toBe(422);
    expectSchema(r.body, 'Problem');
    expect(rules(r.body)).toEqual(['BR-04']);
    // Session začatá pred zmenou tarify ostáva na v1
    const old = await hub.submitCdr('dunaj', cdr({ startTime: '2026-11-14T22:00:00Z', endTime: '2026-11-14T23:00:00Z', tariffVersionId: 'DUN-AC-v1' }));
    expect(old.status).toBe(201);
  });

  it('SC-04-03 CDR s nulovou energiou (BR-05)', async () => {
    const r = await hub.submitCdr('dunaj', cdr({ energyKwh: 0 }));
    expect(r.status).toBe(422);
    expect(rules(r.body)).toEqual(['BR-05']);
  });

  it('SC-04-04 CDR, ktorého koniec je skôr ako začiatok (BR-05)', async () => {
    const r = await hub.submitCdr('dunaj', cdr({ startTime: '2026-11-19T10:00:00Z', endTime: '2026-11-19T09:00:00Z' }));
    expect(r.status).toBe(422);
    expect(rules(r.body)).toEqual(['BR-05']);
  });

  it('OQ-02 Session dlhšia ako 24 h je neplatná (BR-05)', async () => {
    const r = await hub.submitCdr('dunaj', cdr({ startTime: '2026-11-18T08:00:00Z', endTime: '2026-11-19T08:00:01Z' }));
    expect(rules(r.body)).toEqual(['BR-05']);
    const ok = await hub.submitCdr('dunaj', cdr({ startTime: '2026-11-18T08:00:00Z', endTime: '2026-11-19T08:00:00Z' }));
    expect(ok.status).toBe(201);
  });

  it('SC-05-01 CDR k session staršej ako 60 dní (BR-06)', async () => {
    hub.clock.now = new Date('2027-01-20T10:00:00Z'); // 61 dní po 2026-11-20
    const r = await hub.submitCdr('dunaj', cdr({ startTime: '2026-11-20T08:00:00Z', endTime: '2026-11-20T09:00:00Z' }));
    expect(r.status).toBe(422);
    expect(rules(r.body)).toContain('BR-06');
  });

  it('SC-05-02 Neskorý CDR ide do nasledujúceho mesiaca (BR-07)', async () => {
    await hub.submitCdr('dunaj', cdr({ cdrId: 'NOV-1' }));
    hub.clock.now = new Date('2026-12-01T09:00:00Z');
    const closed = await hub.call('finance', 'POST', '/hub/v1/settlement-periods/2026-11/close');
    const novBefore = JSON.stringify(closed.body.statements);
    const late = await hub.submitCdr('dunaj', cdr({ cdrId: 'LATE-1', startTime: '2026-11-28T08:00:00Z', endTime: '2026-11-28T09:00:00Z' }));
    expect(late.status).toBe(201);
    expect(late.body.settlementPeriod).toBe('2026-12');
    const nov = await hub.call('finance', 'GET', '/hub/v1/statements?period=2026-11');
    expect(JSON.stringify(nov.body)).toBe(novBefore);
  });

  it('Idempotencia: rovnaký CDR od toho istého CPO sa nezapočíta dvakrát', async () => {
    const c = cdr({ cdrId: 'DUP-1' });
    expect((await hub.submitCdr('dunaj', c)).status).toBe(201);
    const again = await hub.submitCdr('dunaj', c);
    expect(again.status).toBe(409);
    expectSchema(again.body, 'Problem');
    expect(hub.store.claims.filter((x) => x.cdrId === 'DUP-1')).toHaveLength(2);
  });

  it('BR-11 CDR vlastného Drivera Hub odmietne', async () => {
    const r = await hub.submitCdr('tatra', cdr({ tariffId: 'TAT-DC', tariffVersionId: 'TAT-DC-v1', locationId: 'TAT-POPRAD-01' }));
    expect(rules(r.body)).toEqual(['BR-11']);
  });

  it('Viac porušení naraz sa vráti v jednom zozname', async () => {
    const r = await hub.submitCdr('dunaj', cdr({ energyKwh: -1, tariffVersionId: 'NOPE', startTime: '2026-11-19T10:00:00Z', endTime: '2026-11-19T09:00:00Z' }));
    expect(new Set(rules(r.body))).toEqual(new Set(['BR-04', 'BR-05']));
  });

  it('Percentuálny Hub fee: Token Dunaj Energy u Tatra Charge (2 % z 17,70 €)', async () => {
    const r = await hub.submitCdr(
      'tatra',
      cdr({ tokenUid: 'SK*DUN*000001', tariffId: 'TAT-DC', tariffVersionId: 'TAT-DC-v1', locationId: 'TAT-POPRAD-01', totalCostCents: 1770 }),
    );
    expect(r.body.hubFeeCents).toBe(35); // 35,4 → 35
  });
});
