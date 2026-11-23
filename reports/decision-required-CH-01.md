# DECISION REQUIRED – CH-01 (PREPARE_SPEC → DESIGN_CONTRACT)

Mode: DESIGN_CONTRACT · Change: CH-01 · Specification baseline: 0.1.0 · Architecture baseline: B-01

Contract API-Hub 0.1.0 je navrhnutý (spec/contracts/proposed/). Pred schválením treba uzavrieť štyri otázky,
ktoré specification neurčuje. AI ich podľa SDD_AI_RULES kap. 5 nesmie doplniť sama.

---

DECISION REQUIRED

Kontext: R-02, BR-02, INT-02, INT-03, ADR-0007
Čo specification neurčuje: ADR 0007 hovorí „ak eMSP neodpovie včas“, ale neurčuje časový limit.
Možnosti:
A. Pevný limit pre všetkých eMSP (napr. 2 s) – jednoduché, rovnaké pre všetkých.
B. Limit v hub agreement každého Membera – flexibilné, zložitejšie.
Odporúčanie AI: A s hodnotou nastaviteľnou v konfigurácii Hubu.
Otázka pre človeka: Aký časový limit platí pre odpoveď eMSP?
Kam zapísať rozhodnutie: Requirement R-02 (OQ-01), config

---

DECISION REQUIRED

Kontext: R-04, BR-05
Čo specification neurčuje: idea.md hovorí „trvanie musí dávať zmysel“ bez definície.
Možnosti:
A. Koniec je po začiatku a session netrvá dlhšie ako 24 h.
B. Iba koniec je po začiatku.
Odporúčanie AI: A.
Otázka pre človeka: Kedy je trvanie CDR zmysluplné?
Kam zapísať rozhodnutie: Business Rule BR-05 (OQ-02)

---

DECISION REQUIRED

Kontext: R-03, BR-03, CONTEXT.md – Suspension
Čo specification neurčuje: „Member's Roaming sessions are blocked“ – nie je jasné, či iba ako eMSP, alebo aj ako CPO.
Možnosti:
A. Iba rola eMSP – blokujú sa Tokeny pozastaveného Membera (on je dlžník; jeho nabíjačky ďalej slúžia Driverom iných eMSP).
B. Obe roly – blokujú sa aj sessions na jeho nabíjačkách.
Odporúčanie AI: A (Security deposit a Suspension sa v ADR 0006 viažu na eMSP Members).
Otázka pre človeka: Ktoré sessions blokuje Suspension?
Kam zapísať rozhodnutie: Business Rule BR-03 (OQ-03)

---

DECISION REQUIRED

Kontext: celý contract API-Hub 0.1.0, contract-design-profile.yaml, BR-11
Čo treba potvrdiť: tvar operácií, autentifikáciu hlavičkou `Authorization: Token`, idempotenciu CDR podľa (CPO, cdrId),
peniaze v eurocentoch a odvodené pravidlo BR-11 (Hub spracúva iba Roaming sessions).
Otázka pre človeka: Schvaľuje Solution Architect contract API-Hub 0.1.0?
Kam zapísať rozhodnutie: spec/contracts/approved/approval.yaml
