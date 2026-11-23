Feature: Prijatie CDR a mesačný Settlement

  Background:
    Given CPO "Dunaj Energy" má Tariff version "DUN-AC-v1" s cenou 0,45 €/kWh platnú od 1. 11. 2026
    And hub agreement eMSP "Tatra Charge" určuje Hub fee 0,30 € za Roaming session
    And otvorený mesiac je november 2026

  @SC-04-01 @R-04
  Scenario: Platný CDR vstúpi do Settlement
    When CPO "Dunaj Energy" pošle CDR na 30 kWh s Tariff version "DUN-AC-v1" za Token eMSP "Tatra Charge"
    Then Hub CDR prijme do novembra 2026
    And eMSP "Tatra Charge" dlhuje CPO "Dunaj Energy" 13,50 € a Hubu 0,30 €

  @SC-04-02 @R-04 @BR-04
  Scenario: CDR so zlou Tariff version
    Given CPO "Dunaj Energy" od 15. 11. 2026 používa Tariff version "DUN-AC-v2"
    When CPO pošle CDR session začatej 20. 11. 2026 s Tariff version "DUN-AC-v1"
    Then Hub CDR odmietne pre nezhodu Tariff version

  @SC-04-03 @R-04 @BR-05
  Scenario: CDR s nulovou energiou
    When CPO "Dunaj Energy" pošle CDR s energiou 0 kWh
    Then Hub CDR odmietne pre neplatnú energiu

  @SC-04-04 @R-04 @BR-05
  Scenario: CDR s nezmyselným trvaním
    When CPO "Dunaj Energy" pošle CDR, ktorého koniec je skôr ako začiatok
    Then Hub CDR odmietne pre neplatné trvanie

  @SC-05-01 @R-05 @BR-06
  Scenario: CDR k session staršej ako 60 dní
    When CPO "Dunaj Energy" pošle CDR session, ktorá začala pred 61 dňami
    Then Hub CDR odmietne pre prekročenie limitu 60 dní

  @SC-05-02 @R-05 @BR-07
  Scenario: Neskorý CDR ide do nasledujúceho mesiaca
    Given Finance uzavrela november 2026
    When CPO "Dunaj Energy" pošle platný CDR session z 28. 11. 2026
    Then Hub CDR zaradí do decembra 2026
    And statement za november 2026 sa nezmení

  @SC-06-01 @R-06 @R-07 @BR-08 @BR-09 @BR-10
  Scenario: Uzavretie mesiaca vytvorí jeden statement na Membera
    Given v novembri 2026 sú prijaté CDR viacerých Members
    When Finance uzavrie november 2026
    Then každý Member s pohybom dostane práve jeden statement
    And súčet Net balance všetkých Members a príjmu Hubu je 0

  @SC-06-02 @R-06 @BR-10
  Scenario: Mesiac nemožno uzavrieť dvakrát
    Given Finance uzavrela november 2026
    When Finance znova požiada o uzavretie novembra 2026
    Then Hub požiadavku odmietne a statements sa nezmenia
