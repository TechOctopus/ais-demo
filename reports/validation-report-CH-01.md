# Validation report – CH-01 (VERIFY_CHANGE)

Mode: VERIFY_CHANGE · Change: CH-01 · Specification baseline: 0.1.0 · Approved contract: API-Hub 0.1.0 · Dátum: 2026-11-16 · Aktualizované: 2026-11-17 (prijatie ADR, nové webové rozhranie, nový export views, doplnenie modelu EA, schválenie specification)

Tento report nemení specification, contract, code ani rozhodnutia. Dôkazy: `reports/unit-results.json`,
`reports/e2e-results.json`, `reports/screenshots/`.

| # | Kontrola | Výsledok | Dôkaz |
|---|---|---|---|
| 1 | Syntax a schéma súborov | PASS | Ajv 2020 načíta `spec/contracts/approved/hub-api.openapi.yaml` a kompiluje všetky použité schémy (tests/helpers.ts); `tsc` bez chýb (`npm run typecheck`) |
| 2 | Existencia použitých IDs | PASS | IDs v testoch, contract-mapping a traceability sú definované v requirements, business-rules, components, data-objects alebo architecture-context (EA Object_ID) |
| 3 | Traceability Requirement → test | PASS | `spec/traceability/traceability.yaml`; každý R-01 … R-08 má aspoň jeden scenár a test |
| 4 | Service Realization a Application Usage | PASS | `service-realization.yaml`; väzba AS-HubService → BP-Authorization doplnená do modelu (EA konektor 414) a viditeľná v Service Realization, Application Usage a Layered view |
| 5 | Component boundaries a dependencies | PASS | tests/architecture.test.ts – AR-01, AR-02 (3 testy) |
| 6 | Zhoda code s approved contractom | PASS | 13/13 operácií implementovaných (contract coverage); odpovede validované voči schémam AuthorizationResult, Cdr, TariffVersion, Member, SettlementResult, SettlementStatement, Problem |
| 7 | Pokrytie scenarios | PASS | 15/15 scenárov z US-01.feature a US-02.feature má test s tagom SC-xx-yy; 9 negatívnych |
| 8 | Pokrytie invariants | PASS | BR-03 (SC-03-01), BR-04 (SC-04-02), BR-09 (SC-06-01 + runtime kontrola v SettlementService), BR-10 (SC-06-01, SC-06-02) |
| 9 | Retry / idempotencia | PASS | duplicitný CDR → 409, pohľadávky sa nezdvojili (cdr.test.ts) |
| 10 | Security a privacy | PASS | QR-02: meno Drivera sa neobjaví v odpovediach ani audite (SC-01-03); QR-03: 401/403 (authorization, settlement testy) |
| 11 | Audit | PASS | QR-01: audit záznam pre každú Authorization |
| 12 | Deployable Artifact vs. Deployment context | PASS | `npm run build` + `npm start` spustí ART-HubPrototypePackage; e2e testy v Microsoft Edge prešli (2/2) |
| 13 | Výkon (QR-04) | PASS (Sandbox) | cieľ ≤ 2,5 s = limit eMSP 2 s + ≤ 500 ms Hubu; namerané v Sandboxe: 20 realtime Authorizations spolu 36 ms, Whitelist pri pomalom eMSP 166 ms pri testovacom limite 150 ms (`unit-results.json`). Záťažový test nebol robený – výsledok platí pre jednotlivé volania |
| 14 | Stav ADR | PASS | ADR-P01 a ADR-P02 sú Accepted – prijal ich tím 2026-11-17 (`spec/architecture/decisions/`) |
| 15 | Zhoda obrázkov views s modelom | PASS | 13 obrázkov exportovaných z ais.qea 2026-11-17 (5 z nich znova po doplnení modelu: Information Structure, Application Structure, Application Usage, Service Realization, Layered); 59 prvkov a 37 väzieb v `architecture-context.yaml` zodpovedá modelu (názov, EA ID, typ a smer väzby); obrázky potvrdil tím (`reviewed_by` v manifeste) |
| 16 | GAP Analysis | not applicable | výrez je odôvodnený Requirements R-01 … R-08, nie výsledkom GAP Analysis (SDD_AI_RULES kap. 6) |

## Výsledky testov

- Unit, contract, acceptance, architecture a výkonové testy (Vitest): **44 passed, 0 failed** (4 súbory).
- Akceptačné testy webového rozhrania (Playwright, Microsoft Edge): **2 passed** – scenár BSC-01 na troch samostatných stránkach a živé prepojenie stránok, 6 screenshotov.

## Otvorené body pre človeka

Žiadne.

Uzavreté 2026-11-17: QR-04 má cieľovú hodnotu, ktorú určil tím (≤ 2,5 s spolu, ≤ 500 ms Hub), a dva testy ju overujú. Model obsahuje aj prístup AC-HubService k Provider Payment Claim Record (EA 421 + 422). všetky Data Objects prototypu – CDR, Token, Whitelist, Tariff version, Settlement statement, Member a Authorization record (EA 294–300) – sú v modeli spolu s realizáciami, asociáciami a prístupom AC-HubService; väzba Serving AS-HubService → BP-Authorization (EA 414) je v modeli. Specification 0.1.0 (`manifest.yaml`), Requirements R-01 … R-08, constraints C-01 … C-03 a QR-01 … QR-04 schválil tím (status `approved`).
