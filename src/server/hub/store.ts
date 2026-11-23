// Úložisko AC-HubService v pamäti. Vlastní iba Data Objects Hubu –
// nikdy nie DO-DriverRecord (AR-01).
import type {
  AuthorizationRecord,
  Cdr,
  Member,
  PaymentClaim,
  SettlementPeriod,
  SettlementStatement,
  TariffVersion,
} from './domain.js';

export interface WhitelistEntry {
  uid: string;
  valid: boolean;
}

export class HubStore {
  members = new Map<string, Member>();
  /** credentials → memberId alebo interná rola */
  credentials = new Map<string, { kind: 'member'; memberId: string } | { kind: 'staff'; role: 'FINANCE' | 'HUB' }>();
  whitelists = new Map<string, Map<string, WhitelistEntry>>(); // emspId → uid → entry
  tariffs: TariffVersion[] = [];
  authorizations: AuthorizationRecord[] = [];
  cdrs: Cdr[] = [];
  claims: PaymentClaim[] = [];
  periods: SettlementPeriod[] = [];
  statements: SettlementStatement[] = [];
  private seq = 0;

  nextId(prefix: string): string {
    this.seq += 1;
    return `${prefix}-${String(this.seq).padStart(5, '0')}`;
  }

  openPeriod(): SettlementPeriod {
    const open = this.periods.find((p) => p.status === 'open');
    if (!open) throw new Error('Invariant: práve jeden mesiac musí byť otvorený');
    return open;
  }

  memberByPartyId(partyId: string): Member | undefined {
    return [...this.members.values()].find((m) => m.roles.includes('EMSP') && m.partyIds.includes(partyId));
  }
}
