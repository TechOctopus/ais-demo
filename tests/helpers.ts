import type { AddressInfo } from 'node:net';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { parse } from 'yaml';
import { Ajv2020 } from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { expect } from 'vitest';
import { createApp } from '../src/server/app.js';
import { CREDENTIALS } from '../src/server/seed.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Approved contract API-Hub 0.1.0 – zdroj schém pre contract testy. */
const contract = parse(readFileSync(path.join(root, 'spec/contracts/approved/hub-api.openapi.yaml'), 'utf8'));
const ajv = new Ajv2020({ strict: false, allErrors: true });
(addFormats as unknown as (a: Ajv2020) => void)(ajv);
ajv.addSchema(contract, 'hub');
export const contractOperations: Array<{ method: string; path: string; operationId: string }> = Object.entries(
  contract.paths as Record<string, Record<string, { operationId: string }>>,
).flatMap(([p, ops]) => Object.entries(ops).map(([method, op]) => ({ method, path: p, operationId: op.operationId })));

export function expectSchema(body: unknown, schema: string) {
  const validate = ajv.getSchema(`hub#/components/schemas/${schema}`)!;
  const ok = validate(body);
  expect(ok, `${schema}: ${ajv.errorsText(validate.errors)}`).toBe(true);
}

export type Who = keyof typeof CREDENTIALS;

/** Spustí Sandbox Hubu na náhodnom porte s pevnými hodinami (2026-11-20 10:00 UTC). */
export async function startHub(opts: { start?: string } = {}) {
  const clock = { now: new Date(opts.start ?? '2026-11-20T10:00:00Z') };
  const h = createApp({ emspTimeoutMs: 150, slowDelayMs: 500, now: () => new Date(clock.now) });
  const server = h.app.listen(0);
  await new Promise<void>((ok) => server.once('listening', () => ok()));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  h.setBaseUrl(url);

  async function call(who: Who | null, method: string, p: string, body?: unknown) {
    const res = await fetch(`${url}${p}`, {
      method,
      headers: { 'content-type': 'application/json', ...(who ? { authorization: `Token ${CREDENTIALS[who]}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    return { status: res.status, type: res.headers.get('content-type') ?? '', body: text ? JSON.parse(text) : undefined };
  }

  return {
    ...h,
    url,
    clock,
    call,
    authorize: (cpo: Who, token: string, locationId = 'LOC-1') => call(cpo, 'POST', `/hub/v1/tokens/${encodeURIComponent(token)}/authorize`, { locationId }),
    submitCdr: (cpo: Who, cdr: Record<string, unknown>) => call(cpo, 'POST', '/hub/v1/cdrs', cdr),
    close: () => new Promise<void>((ok) => server.close(() => ok())),
  };
}

let n = 0;
/** Platný CDR CPO Dunaj Energy za Token eMSP Tatra Charge (30 kWh × 0,45 € = 13,50 €). */
export function cdr(over: Record<string, unknown> = {}) {
  n += 1;
  return {
    cdrId: `CDR-${n}`,
    tokenUid: 'SK*TAT*000001',
    locationId: 'DUN-BRATISLAVA-01',
    tariffId: 'DUN-AC',
    tariffVersionId: 'DUN-AC-v1',
    startTime: '2026-11-19T08:00:00Z',
    endTime: '2026-11-19T09:00:00Z',
    energyKwh: 30,
    totalCostCents: 1350,
    ...over,
  };
}
