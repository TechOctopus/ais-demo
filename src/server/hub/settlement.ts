// BP-SettlePayment (EA #111) – operácia closeSettlementPeriod. R-06; BR-07, BR-09, BR-10.
import { HUB, HubError, nextPeriod, type Clock, type SettlementStatement } from './domain.js';
import type { HubStore } from './store.js';

export interface SettlementResult {
  period: string;
  statements: SettlementStatement[];
  hubFeeIncomeCents: number;
  nextOpenPeriod: string;
}

export class SettlementService {
  constructor(
    private store: HubStore,
    private now: Clock,
  ) {}

  close(period: string): SettlementResult {
    const open = this.store.openPeriod();
    if (open.period !== period) {
      const known = this.store.periods.find((p) => p.period === period);
      throw new HubError(409, known?.status === 'closed' ? `Mesiac ${period} je už uzavretý` : `Mesiac ${period} nie je otvorený (otvorený je ${open.period})`);
    }

    const claims = this.store.claims.filter((c) => c.period === period);
    const byMember = new Map<string, SettlementStatement>();
    const row = (memberId: string) => {
      let s = byMember.get(memberId);
      if (!s) {
        s = { period, memberId, receivablesCents: 0, payablesCents: 0, hubFeesCents: 0, netBalanceCents: 0, cdrCount: 0 };
        byMember.set(memberId, s);
      }
      return s;
    };

    let hubFeeIncomeCents = 0;
    for (const c of claims) {
      if (c.kind === 'CDR_COST') {
        row(c.creditorId).receivablesCents += c.amountCents;
        row(c.debtorId).payablesCents += c.amountCents;
        row(c.creditorId).cdrCount += 1;
        row(c.debtorId).cdrCount += 1;
      } else {
        row(c.debtorId).hubFeesCents += c.amountCents;
        if (c.creditorId === HUB) hubFeeIncomeCents += c.amountCents;
      }
    }
    const statements = [...byMember.values()].map((s) => ({ ...s, netBalanceCents: s.receivablesCents - s.payablesCents - s.hubFeesCents }));

    // BR-09: Hub nevytvára ani nestráca peniaze.
    const sum = statements.reduce((a, s) => a + s.netBalanceCents, 0) + hubFeeIncomeCents;
    if (sum !== 0) throw new Error(`Invariant BR-09 porušený: súčet = ${sum}`);

    // Uzavretie mesiaca a otvorenie nasledujúceho (lifecycle Settlement period).
    open.status = 'closed';
    open.closedAt = this.now().toISOString();
    const next = nextPeriod(period);
    this.store.periods.push({ period: next, status: 'open', closedAt: null });
    for (const cdr of this.store.cdrs) if (cdr.settlementPeriod === period) cdr.status = 'settled';
    this.store.statements.push(...statements); // BR-10: jeden statement na Membera a mesiac

    return { period, statements, hubFeeIncomeCents, nextOpenPeriod: next };
  }
}
