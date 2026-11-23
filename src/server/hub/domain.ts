// AC-HubService (EA #85) – Data Objects podľa spec/application/data-objects.yaml.
// Názvy sledujú glossary (spec/glossary.md). Peniaze sú v celých eurocentoch.

export type Role = 'CPO' | 'EMSP';
export type MemberStatus = 'active' | 'suspended';

export interface HubFee {
  kind: 'FIXED' | 'PERCENT';
  value: number; // eurocenty pri FIXED, percento pri PERCENT
}

/** DO-Member */
export interface Member {
  memberId: string;
  name: string;
  roles: Role[];
  status: MemberStatus;
  partyIds: string[]; // CC*PPP prefixy Tokenov (iba eMSP)
  hubFee: HubFee;
  /** Base URL eMSP rozhrania (AI-MemberBackendAPI / AI-IdentityAPI); relatívne k Hubu v Sandboxe. */
  emspEndpoint?: string;
}

/** DO-TariffVersion */
export interface TariffVersion {
  tariffId: string;
  versionId: string;
  cpoId: string;
  pricePerKwhCents: number;
  validFrom: string;
}

/** DO-AuthorizationRecord (QR-01) */
export interface AuthorizationRecord {
  authorizationId: string;
  tokenUid: string;
  cpoId: string;
  emspId: string | null;
  locationId: string;
  result: 'ACCEPTED' | 'REJECTED';
  source: 'EMSP_REALTIME' | 'WHITELIST' | 'HUB_RULE';
  reason:
    | 'TOKEN_VALID'
    | 'TOKEN_BLOCKED'
    | 'TOKEN_UNKNOWN'
    | 'ON_WHITELIST'
    | 'NOT_ON_WHITELIST'
    | 'MEMBER_SUSPENDED'
    | 'NOT_A_ROAMING_SESSION'
    | 'UNKNOWN_EMSP';
  decidedAt: string;
}

export interface CdrInput {
  cdrId: string;
  tokenUid: string;
  locationId: string;
  tariffId: string;
  tariffVersionId: string;
  startTime: string;
  endTime: string;
  energyKwh: number;
  totalCostCents: number;
}

/** DO-CDR */
export interface Cdr extends CdrInput {
  cpoId: string;
  emspId: string;
  status: 'accepted' | 'settled';
  receivedAt: string;
  settlementPeriod: string;
  hubFeeCents: number;
}

/** DO-MemberPaymentClaimRecord (EA #136) – pohľadávka z platného CDR (BR-08). */
export interface PaymentClaim {
  claimId: string;
  cdrId: string;
  period: string;
  kind: 'CDR_COST' | 'HUB_FEE';
  debtorId: string; // eMSP
  creditorId: string; // CPO alebo 'HUB'
  amountCents: number;
}

export interface SettlementPeriod {
  period: string;
  status: 'open' | 'closed';
  closedAt: string | null;
}

/** DO-SettlementStatement */
export interface SettlementStatement {
  period: string;
  memberId: string;
  receivablesCents: number;
  payablesCents: number;
  hubFeesCents: number;
  netBalanceCents: number;
  cdrCount: number;
}

export interface RuleViolation {
  rule: string; // BR-xx
  message: string;
}

/** Business odmietnutie, ktoré API mapuje na problem+json. */
export class HubError extends Error {
  constructor(
    public status: number,
    public title: string,
    public violations: RuleViolation[] = [],
  ) {
    super(title);
  }
}

export type Clock = () => Date;

export const HUB = 'HUB';

/** Prefix eMSP z Tokenu CC*PPP*NNN (contract-design-profile: identifiers.token). */
export function partyIdOf(tokenUid: string): string | null {
  const parts = tokenUid.split('*');
  return parts.length === 3 ? `${parts[0]}*${parts[1]}` : null;
}

export function periodOf(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function nextPeriod(period: string): string {
  const [y, m] = period.split('-').map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
}
