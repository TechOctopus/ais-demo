// VERIFY: component boundaries a allowed dependencies (spec/application/components.yaml – AR-01, AR-02, AR-03)
// a pokrytie operácií approved contractu.
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { contractOperations, startHub } from './helpers.js';

const src = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src/server');
const imports = (dir: string) =>
  readdirSync(path.join(src, dir))
    .filter((f) => f.endsWith('.ts'))
    .flatMap((f) => [...readFileSync(path.join(src, dir, f), 'utf8').matchAll(/from\s+'([^']+)'/g)].map((m) => ({ file: `${dir}/${f}`, spec: m[1] })));

describe('Architecture rules', () => {
  it('AR-01/AR-02 AC-HubService neimportuje Identity Service ani simulátor External Provider Service', () => {
    const bad = imports('hub').filter((i) => /identity|member-sim|seed/.test(i.spec));
    expect(bad).toEqual([]);
  });
  it('AR-01 AC-IdentityService neimportuje AC-HubService', () => {
    expect(imports('identity').filter((i) => /hub/.test(i.spec))).toEqual([]);
  });
  it('Simulátor External Provider Service neimportuje vnútro Hubu', () => {
    expect(imports('member-sim').filter((i) => /hub|identity/.test(i.spec))).toEqual([]);
  });
});

describe('Contract coverage – API-Hub 0.1.0', () => {
  let hub: Awaited<ReturnType<typeof startHub>>;
  beforeAll(async () => {
    hub = await startHub();
  });
  afterAll(() => hub.close());

  it.each(contractOperations)('$operationId ($method $path) je implementovaná', async ({ method, path: p }) => {
    const concrete = p.replace('{tokenUid}', encodeURIComponent('SK*TAT*000001')).replace('{tariffId}', 'X').replace('{versionId}', 'Y').replace('{period}', '2030-01').replace('{memberId}', 'tatra');
    const r = await hub.call('hub', method.toUpperCase(), `/hub/v1${concrete}`, method === 'get' ? undefined : {});
    // Nepoznaná cesta by vrátila HTML 404 z Express; contract operácie vracajú JSON alebo problem+json.
    expect(r.type).toMatch(/json/);
  });
});
