// BP-BridgeMembers (EA #110) – operácia submitCdr. R-04, R-05, R-07; BR-04 … BR-08, BR-11.
import { HUB, HubError, partyIdOf, type CdrInput, type Cdr, type Clock, type Member, type RuleViolation } from './domain.js';
import type { HubStore } from './store.js';

const DAY_MS = 24 * 60 * 60 * 1000;
export const MAX_SESSION_MS = DAY_MS; // OQ-02: max. 24 h
export const MAX_CDR_AGE_DAYS = 60;

export function hubFeeCents(emsp: Member, totalCostCents: number): number {
  return emsp.hubFee.kind === 'FIXED' ? Math.round(emsp.hubFee.value) : Math.round((totalCostCents * emsp.hubFee.value) / 100);
}

export class CdrService {
  constructor(
    private store: HubStore,
    private now: Clock,
  ) {}

  /** Tariff version platná pri štarte session (BR-04). */
  versionValidAt(tariffId: string, cpoId: string, at: Date) {
    return this.store.tariffs
      .filter((t) => t.tariffId === tariffId && t.cpoId === cpoId && new Date(t.validFrom) <= at)
      .sort((a, b) => Date.parse(b.validFrom) - Date.parse(a.validFrom))[0];
  }

  submit(cpo: Member, input: CdrInput): Cdr {
    // Idempotencia (contract-design-profile): (CPO, cdrId) sa započíta iba raz.
    if (this.store.cdrs.some((c) => c.cpoId === cpo.memberId && c.cdrId === input.cdrId)) {
      throw new HubError(409, `CDR ${input.cdrId} od tohto CPO už bol prijatý`);
    }

    const violations: RuleViolation[] = [];
    const now = this.now();
    const start = new Date(input.startTime);
    const end = new Date(input.endTime);

    const partyId = partyIdOf(input.tokenUid);
    const emsp = partyId ? this.store.memberByPartyId(partyId) : undefined;
    if (!emsp) violations.push({ rule: 'BR-08', message: 'Token nepatrí žiadnemu eMSP Memberovi – pohľadávku nemožno priradiť.' });
    else if (emsp.memberId === cpo.memberId) violations.push({ rule: 'BR-11', message: 'eMSP a CPO sú ten istý Member – nejde o Roaming session.' });

    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      violations.push({ rule: 'BR-05', message: 'Začiatok alebo koniec session nie je platný čas.' });
    } else {
      const valid = this.versionValidAt(input.tariffId, cpo.memberId, start);
      if (!valid || valid.versionId !== input.tariffVersionId) {
        violations.push({
          rule: 'BR-04',
          message: valid
            ? `Pri štarte session platila Tariff version ${valid.versionId}, CDR uvádza ${input.tariffVersionId}.`
            : `CPO nemá Tariff version tarify ${input.tariffId} platnú pri štarte session.`,
        });
      }
      const duration = end.getTime() - start.getTime();
      if (duration <= 0) violations.push({ rule: 'BR-05', message: 'Koniec session musí byť po jej začiatku.' });
      else if (duration > MAX_SESSION_MS) violations.push({ rule: 'BR-05', message: 'Session nesmie trvať dlhšie ako 24 hodín.' });
      if (now.getTime() - start.getTime() > MAX_CDR_AGE_DAYS * DAY_MS) {
        violations.push({ rule: 'BR-06', message: `Session začala pred viac ako ${MAX_CDR_AGE_DAYS} dňami.` });
      }
    }
    if (!(input.energyKwh > 0)) violations.push({ rule: 'BR-05', message: 'Energia musí byť väčšia ako 0 kWh.' });

    if (violations.length > 0 || !emsp) throw new HubError(422, 'CDR porušuje pravidlá Hubu', violations);

    // BR-07: CDR patrí do mesiaca otvoreného pri prijatí.
    const period = this.store.openPeriod().period;
    const fee = hubFeeCents(emsp, input.totalCostCents);
    const cdr: Cdr = {
      ...input,
      cpoId: cpo.memberId,
      emspId: emsp.memberId,
      status: 'accepted',
      receivedAt: now.toISOString(),
      settlementPeriod: period,
      hubFeeCents: fee,
    };
    this.store.cdrs.push(cdr);

    // BR-08: eMSP dlhuje CPO cenu CDR a Hubu Hub fee.
    this.store.claims.push(
      { claimId: this.store.nextId('CLM'), cdrId: cdr.cdrId, period, kind: 'CDR_COST', debtorId: emsp.memberId, creditorId: cpo.memberId, amountCents: input.totalCostCents },
      { claimId: this.store.nextId('CLM'), cdrId: cdr.cdrId, period, kind: 'HUB_FEE', debtorId: emsp.memberId, creditorId: HUB, amountCents: fee },
    );
    return cdr;
  }
}
