# AGENTS.md – pravidlá práce AI (podľa SDD_AI_RULES v4, predmet AIS FIIT STU)

Plné znenie pravidiel je v `../subject/SDD_AI_RULES_v4.pdf`. Toto je ich záväzný výťah pre tento repozitár.

1. **Režim:** každá úloha uvádza práve jeden režim – PREPARE_SPEC, DESIGN_CONTRACT, IMPLEMENT_CHANGE alebo VERIFY_CHANGE. Inak AI vráti DECISION REQUIRED.
2. **Vstupy:** AI najprv číta `spec/manifest.yaml` a používa iba registrované podklady. Poradie autority: approved Requirements a rules → model B-01 (obrázky + architecture-context) → accepted ADR → approved scenarios a contracts → code.
3. **Bez domýšľania:** AI nevymýšľa business rules, práva, stavy, vlastníka dát, sync vs. async, správanie pri výpadku a opakovaní, SLA, DBMS, cloud ani verzie. Chýbajúce rozhodnutie → DECISION REQUIRED (formát v `reports/decision-required-CH-01.md`).
4. **Schvaľovanie:** iba človek schvaľuje contract (`spec/contracts/approved/approval.yaml`) a mení stav ADR. AI pripravuje ADR iba ako Proposed.
5. **IMPLEMENT_CHANGE:** iba s approved contractom; rešpektuje component boundaries (AR-01 … AR-03 v `spec/application/components.yaml`), nemení contract, nevytvára UML ani databázový návrh.
6. **VERIFY_CHANGE:** nemení nič okrem nového reportu v `reports/`; každá kontrola má PASS, FAIL alebo UNKNOWN s dôkazom.
7. **Gherkin:** Given = stav, When = jedna udalosť, Then = pozorovateľný výsledok; business jazyk z `spec/glossary.md`; ku každému dôležitému pravidlu pozitívny aj negatívny scenár.
8. **Štruktúra odpovede AI:** Pochopenie úlohy · Režim a baseline · Použité autoritatívne vstupy · Chýbajúce informácie alebo rozpory · Impact analysis · Navrhovaný výstup · Validation results · Traceability summary · Decision required / ADR.
