// INT-02 / INT-03: volanie eMSP v reálnom čase cez AI-MemberBackendAPI alebo AI-IdentityAPI.
// Hub pozná iba URL rozhrania eMSP; nič neimportuje z modulov identity/ ani member-sim/ (AR-01, AR-02).
import type { Member } from './domain.js';

export type EmspAnswer =
  | { kind: 'answered'; allowed: 'ALLOWED' | 'BLOCKED' | 'EXPIRED' | 'NO_CREDIT' | 'NOT_ALLOWED' }
  | { kind: 'unknown-token' }
  | { kind: 'no-answer'; cause: string };

export interface EmspGateway {
  authorize(emsp: Member, tokenUid: string, locationId: string): Promise<EmspAnswer>;
}

export class HttpEmspGateway implements EmspGateway {
  /**
   * @param baseUrl adresa, na ktorej sú dostupné rozhrania eMSP v Sandboxe
   * @param timeoutMs limit odpovede eMSP – OQ-01: 2 s, konfigurovateľný
   */
  constructor(
    private baseUrl: () => string,
    private timeoutMs: number,
  ) {}

  async authorize(emsp: Member, tokenUid: string, locationId: string): Promise<EmspAnswer> {
    if (!emsp.emspEndpoint) return { kind: 'no-answer', cause: 'eMSP nemá rozhranie' };
    const url = new URL(`${emsp.emspEndpoint}/tokens/${encodeURIComponent(tokenUid)}/authorize`, this.baseUrl());
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ locationId }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      if (res.status === 404) return { kind: 'unknown-token' };
      if (!res.ok) return { kind: 'no-answer', cause: `HTTP ${res.status}` };
      const body = (await res.json()) as { allowed?: string };
      const allowed = body.allowed;
      if (allowed === 'ALLOWED' || allowed === 'BLOCKED' || allowed === 'EXPIRED' || allowed === 'NO_CREDIT' || allowed === 'NOT_ALLOWED') {
        return { kind: 'answered', allowed };
      }
      return { kind: 'no-answer', cause: 'neplatná odpoveď eMSP' };
    } catch (e) {
      return { kind: 'no-answer', cause: e instanceof Error && e.name === 'TimeoutError' ? 'timeout' : 'nedostupný' };
    }
  }
}
