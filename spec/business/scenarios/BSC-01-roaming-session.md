# BSC-01 Roaming session od priloženia karty po mesačné vyúčtovanie

**Kto začne:** Roaming Driver s kartou eMSP *Tatra Charge* príde k nabíjačke CPO *Dunaj Energy*.

**Čo sa stane:**
1. Driver priloží kartu. Backend Dunaj Energy sa spýta Hubu, či je Token platný.
2. Hub sa spýta Tatra Charge. Tatra Charge odpovie, že Token je platný, a Hub to oznámi Dunaj Energy.
   Keby backend Tatra Charge práve nefungoval, Hub by sa pozrel do Whitelistu, ktorý mu Tatra Charge poslala ráno.
3. Driver nabije 30 kWh. Platí Tariff version Dunaj Energy zo štartu session (0,45 €/kWh).
4. Dunaj Energy pošle CDR. Hub ho overí a zaradí do novembrového Settlement.
5. Na konci mesiaca Finance uzavrie november. Tatra Charge dostane jeden statement:
   dlhuje 13,50 € Dunaj Energy cez Hub a Hub fee 0,30 €. Dunaj Energy dostane statement s pohľadávkou 13,50 €.

**Očakávaný výsledok:** Driver nabil bez registrácie u Dunaj Energy; každý Member dostal jediný statement;
Hub si ponechal iba Hub fee.

Ceny a názvy Members sú ilustračné údaje prototypu, nie údaje skutočných spoločností.

Väzby: EV-MemberDriverNeedsCharging, BP-Authorization, BP-BridgeMembers, BP-SettlePayment, R-01 až R-07.
