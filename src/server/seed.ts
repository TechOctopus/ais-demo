// Ukážkové údaje Sandboxu. Názvy Members a ceny sú ilustračné (nie skutočné spoločnosti).
import type { HubStore } from './hub/store.js';
import type { IdentityStorage } from './identity/identity-service.js';
import type { MemberBackendSim } from './member-sim/member-backend-sim.js';
import { periodOf, type Member } from './hub/domain.js';

export const CREDENTIALS = {
  tatra: 'tok-tatra',
  dunaj: 'tok-dunaj',
  sitno: 'tok-sitno',
  fleetgo: 'tok-fleetgo',
  'onekey-card': 'tok-onekey-card',
  finance: 'tok-finance',
  hub: 'tok-hub',
} as const;

const MEMBERS: Member[] = [
  { memberId: 'tatra', name: 'Tatra Charge', roles: ['CPO', 'EMSP'], status: 'active', partyIds: ['SK*TAT'], hubFee: { kind: 'FIXED', value: 30 }, emspEndpoint: '/sim/emsp/tatra' },
  { memberId: 'dunaj', name: 'Dunaj Energy', roles: ['CPO', 'EMSP'], status: 'active', partyIds: ['SK*DUN'], hubFee: { kind: 'PERCENT', value: 2 }, emspEndpoint: '/sim/emsp/dunaj' },
  { memberId: 'sitno', name: 'Hotel Sitno', roles: ['CPO'], status: 'active', partyIds: [], hubFee: { kind: 'FIXED', value: 0 } },
  { memberId: 'fleetgo', name: 'FleetGo', roles: ['EMSP'], status: 'active', partyIds: ['SK*FLG'], hubFee: { kind: 'FIXED', value: 25 }, emspEndpoint: '/sim/emsp/fleetgo' },
  { memberId: 'onekey-card', name: 'OneKey card unit', roles: ['EMSP'], status: 'active', partyIds: ['SK*ONK'], hubFee: { kind: 'FIXED', value: 30 }, emspEndpoint: '/identity/v1' },
];

export const LOCATIONS: Record<string, string[]> = {
  tatra: ['TAT-POPRAD-01', 'TAT-ZILINA-02'],
  dunaj: ['DUN-BRATISLAVA-01', 'DUN-TRNAVA-03'],
  sitno: ['SIT-HOTEL-01'],
};

export function seed(store: HubStore, identity: IdentityStorage, sim: MemberBackendSim, now: Date) {
  for (const m of MEMBERS) store.members.set(m.memberId, structuredClone(m));
  for (const [id, cred] of Object.entries(CREDENTIALS)) {
    store.credentials.set(cred, id === 'finance' ? { kind: 'staff', role: 'FINANCE' } : id === 'hub' ? { kind: 'staff', role: 'HUB' } : { kind: 'member', memberId: id });
  }

  const from = `${periodOf(now)}-01T00:00:00.000Z`;
  store.tariffs.push(
    { tariffId: 'DUN-AC', versionId: 'DUN-AC-v1', cpoId: 'dunaj', pricePerKwhCents: 45, validFrom: from },
    { tariffId: 'TAT-DC', versionId: 'TAT-DC-v1', cpoId: 'tatra', pricePerKwhCents: 59, validFrom: from },
    { tariffId: 'SIT-AC', versionId: 'SIT-AC-v1', cpoId: 'sitno', pricePerKwhCents: 39, validFrom: from },
  );
  store.periods.push({ period: periodOf(now), status: 'open', closedAt: null });

  // Whitelisty, ktoré eMSP poslali vopred (R-02)
  store.whitelists.set('tatra', new Map([['SK*TAT*000001', { uid: 'SK*TAT*000001', valid: true }], ['SK*TAT*000002', { uid: 'SK*TAT*000002', valid: true }]]));
  store.whitelists.set('dunaj', new Map([['SK*DUN*000001', { uid: 'SK*DUN*000001', valid: true }]]));
  store.whitelists.set('fleetgo', new Map([['SK*FLG*000001', { uid: 'SK*FLG*000001', valid: true }]]));
  store.whitelists.set('onekey-card', new Map([['SK*ONK*000001', { uid: 'SK*ONK*000001', valid: true }]]));

  // Externé backendy eMSP (simulátor)
  sim.emsps.set('tatra', { memberId: 'tatra', mode: 'online', tokens: new Map([['SK*TAT*000001', 'ALLOWED'], ['SK*TAT*000002', 'ALLOWED'], ['SK*TAT*000099', 'ALLOWED']]) });
  sim.emsps.set('dunaj', { memberId: 'dunaj', mode: 'online', tokens: new Map([['SK*DUN*000001', 'ALLOWED']]) });
  sim.emsps.set('fleetgo', { memberId: 'fleetgo', mode: 'online', tokens: new Map([['SK*FLG*000001', 'ALLOWED']]) });

  // OneKey card unit – Identity Storage (osobné údaje zostávajú tu)
  identity.drivers.set('SK*ONK*000001', { tokenUid: 'SK*ONK*000001', name: 'Ján Vzorový', plan: 'SUBSCRIPTION', status: 'ALLOWED' });
  identity.drivers.set('SK*ONK*000002', { tokenUid: 'SK*ONK*000002', name: 'Eva Ukážková', plan: 'PAY_AS_YOU_GO', status: 'ALLOWED' });
}
