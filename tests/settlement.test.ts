// US-02 (časť Settlement) – SC-06-01, SC-06-02; BR-08, BR-09, BR-10
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cdr, expectSchema, startHub } from './helpers.js';

let hub: Awaited<ReturnType<typeof startHub>>;
beforeEach(async () => {
  hub = await startHub();
});
afterEach(() => hub.close());

async function novemberTraffic() {
  // Tatra Driver u Dunaj (13,50 €, fee 0,30 €)
  await hub.submitCdr('dunaj', cdr({ cdrId: 'S-1' }));
  // FleetGo Driver u Hotel Sitno (20 kWh × 0,39 = 7,80 €, fee 0,25 €)
  await hub.submitCdr('sitno', cdr({ cdrId: 'S-2', tokenUid: 'SK*FLG*000001', tariffId: 'SIT-AC', tariffVersionId: 'SIT-AC-v1', locationId: 'SIT-HOTEL-01', energyKwh: 20, totalCostCents: 780 }));
  // Dunaj Driver u Tatra (30 kWh × 0,59 = 17,70 €, fee 2 % = 0,35 €)
  await hub.submitCdr('tatra', cdr({ cdrId: 'S-3', tokenUid: 'SK*DUN*000001', tariffId: 'TAT-DC', tariffVersionId: 'TAT-DC-v1', locationId: 'TAT-POPRAD-01', totalCostCents: 1770 }));
  // OneKey card Subscriber u Dunaj (10 kWh, 4,50 €, fee 0,30 €)
  await hub.submitCdr('dunaj', cdr({ cdrId: 'S-4', tokenUid: 'SK*ONK*000001', energyKwh: 10, totalCostCents: 450 }));
}

describe('US-02 Mesačný Settlement', () => {
  it('SC-06-01 Uzavretie mesiaca: jeden statement na Membera, súčet Net balance + príjem Hubu = 0', async () => {
    await novemberTraffic();
    const r = await hub.call('finance', 'POST', '/hub/v1/settlement-periods/2026-11/close');
    expect(r.status).toBe(200);
    expectSchema(r.body, 'SettlementResult');
    const s = Object.fromEntries(r.body.statements.map((x: { memberId: string }) => [x.memberId, x]));

    // BR-10: práve jeden statement pre každého Membera s pohybom
    expect(Object.keys(s).sort()).toEqual(['dunaj', 'fleetgo', 'onekey-card', 'sitno', 'tatra']);
    expect(r.body.statements).toHaveLength(5);

    expect(s.tatra).toMatchObject({ receivablesCents: 1770, payablesCents: 1350, hubFeesCents: 30, netBalanceCents: 390 });
    expect(s.dunaj).toMatchObject({ receivablesCents: 1800, payablesCents: 1770, hubFeesCents: 35, netBalanceCents: -5 });
    expect(s.sitno).toMatchObject({ receivablesCents: 780, netBalanceCents: 780 });
    expect(s.fleetgo).toMatchObject({ payablesCents: 780, hubFeesCents: 25, netBalanceCents: -805 });
    expect(s['onekey-card']).toMatchObject({ payablesCents: 450, hubFeesCents: 30, netBalanceCents: -480 });
    expect(r.body.hubFeeIncomeCents).toBe(30 + 25 + 35 + 30);

    // BR-09: zachovanie peňazí
    const sum = r.body.statements.reduce((a: number, x: { netBalanceCents: number }) => a + x.netBalanceCents, 0);
    expect(sum + r.body.hubFeeIncomeCents).toBe(0);

    expect(r.body.nextOpenPeriod).toBe('2026-12');
    expect(hub.store.cdrs.every((c) => c.status === 'settled')).toBe(true);
  });

  it('SC-06-02 Mesiac nemožno uzavrieť dvakrát', async () => {
    await novemberTraffic();
    await hub.call('finance', 'POST', '/hub/v1/settlement-periods/2026-11/close');
    const before = JSON.stringify(hub.store.statements);
    const again = await hub.call('finance', 'POST', '/hub/v1/settlement-periods/2026-11/close');
    expect(again.status).toBe(409);
    expectSchema(again.body, 'Problem');
    expect(JSON.stringify(hub.store.statements)).toBe(before);
    const periods = await hub.call('dunaj', 'GET', '/hub/v1/settlement-periods');
    expect(periods.body.filter((p: { status: string }) => p.status === 'open')).toHaveLength(1);
  });

  it('QR-03 Member vidí iba vlastný statement; uzavrieť mesiac smie iba Finance', async () => {
    await novemberTraffic();
    expect((await hub.call('dunaj', 'POST', '/hub/v1/settlement-periods/2026-11/close')).status).toBe(403);
    await hub.call('finance', 'POST', '/hub/v1/settlement-periods/2026-11/close');
    const own = await hub.call('tatra', 'GET', '/hub/v1/statements');
    expect(own.body).toHaveLength(1);
    expect(own.body[0].memberId).toBe('tatra');
    expectSchema(own.body[0], 'SettlementStatement');
  });
});
