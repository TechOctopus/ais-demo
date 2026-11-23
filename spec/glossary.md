# Glossary – výrez pre prototyp

Zdrojom pojmov je `../CONTEXT.md` (glossary celého projektu). Tu sú iba pojmy,
ktoré používa výrez CH-01, s priradenými IDs. Pojmy sa nesmú nahrádzať synonymami
zo stĺpca „Nepoužívať“.

## Member
Spoločnosť, ktorá podpísala hub agreement. Má rolu CPO, eMSP alebo obe.
- IDs: BA-Member (EA #68), DO-Member (nový)
- Nepoužívať: provider, partner, client

## CPO
Rola Membera, ktorý vlastní a prevádzkuje nabíjačky. V prototype posiela Authorization requesty a CDR.
- Nepoužívať: station owner, operator

## eMSP
Rola Membera, ktorý vydáva Tokeny Driverom a účtuje im.
- Nepoužívať: card issuer, provider

## OneKey card unit
Obchodná jednotka OneKey, ktorá vystupuje ako eMSP pre OneKey card. Jej Tokeny overuje Identity Service.
- IDs: BA-OneKeyCardUnit (EA #63), AC-IdentityService (EA #104)

## Driver / Roaming Driver
Osoba, ktorá nabíja s Tokenom od eMSP. Roaming Driver nabíja s Tokenom od Member eMSP.
- IDs: BA-Driver (EA #67), ROLE-RoamingDriver (EA #71)
- Nepoužívať: user, customer

## Token
ID RFID karty alebo účtu Drivera, ktoré vydal jeden eMSP. Hub o Driveroch iných eMSP pozná iba Token, nie meno.
- IDs: DO-Token (nový)
- Nepoužívať: card ID, key

## Authorization
Odpoveď Hubu CPO, či je Token platný. Hub sa najprv pýta eMSP Drivera a ak eMSP neodpovie včas, použije Whitelist.
- IDs: BP-Authorization (EA #109), DO-AuthorizationRecord (nový)

## Whitelist
Zoznam platných Tokenov, ktorý eMSP vopred pošle do Hubu.
- IDs: DO-Whitelist (nový)

## Charging session / Roaming session
Jedno nabíjanie jedného auta u jedného CPO. Roaming session je Charging session, pri ktorej sú eMSP Drivera a CPO nabíjačky rôzni Members.

## CDR
Záznam CPO o jednej ukončenej Charging session: energia, trvanie, Tariff version a cena.
- IDs: DO-CDR (nový)
- Nepoužívať: receipt, session log, transaction

## Tariff version
Jeden Wholesale tariff s časom, od ktorého platí. Charging session používa Tariff version platnú pri štarte session.
- IDs: DO-TariffVersion (nový)

## Hub fee
Čo Hub účtuje eMSP za každú Roaming session podľa jeho hub agreement: pevná suma, percento alebo iná dohodnutá suma.

## Settlement
Mesačný proces, v ktorom Hub zneguje (netting) bilancie Members a pošle každému Memberovi jednu faktúru.
- IDs: BP-SettlePayment (EA #111), BS-SettlementService (EA #80), DO-SettlementStatement (nový)
- Nepoužívať: clearing, billing

## Net balance
Čo Member dlhuje Hubu alebo Hub Memberovi za jeden mesiac po nettingu.

## Suspension
Stav Membera, v ktorom sú jeho Roaming sessions blokované, kým nezaplatí Net balance.
- IDs: DO-Member.status = suspended

## Payment Claim / Provider Payment Claim
Business Objects modelu (EA #113, #135). V prototype: pohľadávka, ktorá vznikne z platného CDR – eMSP dlhuje CPO cenu CDR a Hubu Hub fee.
- IDs: BO-PaymentClaim (EA #113), BO-MemberPaymentClaim (EA #135), DO-MemberPaymentClaimRecord (EA #136)
