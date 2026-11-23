// BP-Authorization (EA #109) – operácia authorizeToken. R-01, R-02, R-03, R-08; BR-01, BR-02, BR-03, BR-11.
import { partyIdOf, type AuthorizationRecord, type Clock, type Member } from './domain.js';
import type { EmspGateway } from './emsp-gateway.js';
import type { HubStore } from './store.js';

export class AuthorizationService {
  constructor(
    private store: HubStore,
    private gateway: EmspGateway,
    private now: Clock,
  ) {}

  async authorize(cpo: Member, tokenUid: string, locationId: string): Promise<AuthorizationRecord> {
    const base = { tokenUid, cpoId: cpo.memberId, locationId };
    const partyId = partyIdOf(tokenUid);
    const emsp = partyId ? this.store.memberByPartyId(partyId) : undefined;

    if (!emsp) return this.record({ ...base, emspId: null, result: 'REJECTED', source: 'HUB_RULE', reason: 'UNKNOWN_EMSP' });
    const withEmsp = { ...base, emspId: emsp.memberId };

    // BR-11: Hub spracúva iba Roaming sessions.
    if (emsp.memberId === cpo.memberId) {
      return this.record({ ...withEmsp, result: 'REJECTED', source: 'HUB_RULE', reason: 'NOT_A_ROAMING_SESSION' });
    }
    // BR-03 (OQ-03): Suspension blokuje Tokeny pozastaveného eMSP Membera.
    if (emsp.status === 'suspended') {
      return this.record({ ...withEmsp, result: 'REJECTED', source: 'HUB_RULE', reason: 'MEMBER_SUSPENDED' });
    }

    // R-01 / BR-01: najprv eMSP v reálnom čase; jeho včasná odpoveď rozhoduje.
    const answer = await this.gateway.authorize(emsp, tokenUid, locationId);
    if (answer.kind === 'answered') {
      return this.record({
        ...withEmsp,
        result: answer.allowed === 'ALLOWED' ? 'ACCEPTED' : 'REJECTED',
        source: 'EMSP_REALTIME',
        reason: answer.allowed === 'ALLOWED' ? 'TOKEN_VALID' : 'TOKEN_BLOCKED',
      });
    }
    if (answer.kind === 'unknown-token') {
      return this.record({ ...withEmsp, result: 'REJECTED', source: 'EMSP_REALTIME', reason: 'TOKEN_UNKNOWN' });
    }

    // R-02 / BR-02: eMSP neodpovedal včas → Whitelist.
    const entry = this.store.whitelists.get(emsp.memberId)?.get(tokenUid);
    const valid = entry?.valid === true;
    return this.record({
      ...withEmsp,
      result: valid ? 'ACCEPTED' : 'REJECTED',
      source: 'WHITELIST',
      reason: valid ? 'ON_WHITELIST' : 'NOT_ON_WHITELIST',
    });
  }

  /** QR-01: každá Authorization má audit záznam. */
  private record(r: Omit<AuthorizationRecord, 'authorizationId' | 'decidedAt'>): AuthorizationRecord {
    const rec: AuthorizationRecord = { authorizationId: this.store.nextId('AUTH'), decidedAt: this.now().toISOString(), ...r };
    this.store.authorizations.unshift(rec);
    return rec;
  }
}
