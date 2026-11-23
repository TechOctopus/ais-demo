Mode: IMPLEMENT_CHANGE
Change: CH-01 (R-01 … R-08)
Specification baseline: 0.1.0
Architecture baseline: B-01
Approved contract: API-Hub 0.1.0

Najprv priprav generation plan po súboroch. Potom vytvor najmenší candidate code a tests.
Nemeň approved contract ani component boundaries (AR-01 … AR-03).
Ak narazíš na chýbajúce rozhodnutie, vráť DECISION REQUIRED.

Generation plan:
1. src/server/hub/* – AC-HubService (domain, store, emsp-gateway, authorization, cdrs, settlement, api)
2. src/server/identity/* – AC-IdentityService
3. src/server/member-sim/* – simulátor AC-MemberBackend
4. src/server/app.ts, main.ts, seed.ts – ART-HubPrototypePackage
5. src/web/* – webové rozhranie Sandboxu
6. tests/* – acceptance, contract a architecture testy; tests/e2e – test v prehliadači
