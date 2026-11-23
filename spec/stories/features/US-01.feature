Feature: Authorization Tokenu pri Roaming session

  Background:
    Given Members "Tatra Charge" (CPO, eMSP) a "Dunaj Energy" (CPO, eMSP) sú aktívni
    And "Tatra Charge" vydala Token "SK*TAT*000001"

  @SC-01-01 @R-01
  Scenario: eMSP potvrdí platný Token
    Given backend eMSP "Tatra Charge" odpovedá včas
    When CPO "Dunaj Energy" požiada o Authorization Tokenu "SK*TAT*000001"
    Then Hub Authorization prijme
    And ako zdroj rozhodnutia uvedie eMSP v reálnom čase

  @SC-01-02 @R-01 @BR-01
  Scenario: Token zablokovaný v eMSP neprejde ani cez Whitelist
    Given Token "SK*TAT*000001" je na Whiteliste "Tatra Charge" ako platný
    And eMSP "Tatra Charge" Token pred chvíľou zablokovala
    When CPO "Dunaj Energy" požiada o Authorization Tokenu "SK*TAT*000001"
    Then Hub Authorization odmietne
    And ako zdroj rozhodnutia uvedie eMSP v reálnom čase

  @SC-01-03 @R-01 @R-08
  Scenario: Token OneKey card overí OneKey card unit
    Given OneKey card unit vydala Token "SK*ONK*000001" platnému Subscriberovi
    When CPO "Dunaj Energy" požiada o Authorization Tokenu "SK*ONK*000001"
    Then Hub Authorization prijme
    And Hub nepozná meno ani kontakt Drivera

  @SC-01-04 @R-01 @BR-11
  Scenario: Session vlastného Drivera nie je Roaming session
    When CPO "Tatra Charge" požiada o Authorization Tokenu "SK*TAT*000001"
    Then Hub Authorization odmietne s dôvodom, že nejde o Roaming session

  @SC-02-01 @R-02 @BR-02
  Scenario: Nedostupný eMSP – Token je na Whiteliste
    Given backend eMSP "Tatra Charge" neodpovedá
    And Token "SK*TAT*000001" je na Whiteliste "Tatra Charge" ako platný
    When CPO "Dunaj Energy" požiada o Authorization Tokenu "SK*TAT*000001"
    Then Hub Authorization prijme
    And ako zdroj rozhodnutia uvedie Whitelist

  @SC-02-02 @R-02 @BR-02
  Scenario: Nedostupný eMSP – Token na Whiteliste nie je
    Given backend eMSP "Tatra Charge" neodpovedá
    And Token "SK*TAT*000099" nie je na Whiteliste "Tatra Charge"
    When CPO "Dunaj Energy" požiada o Authorization Tokenu "SK*TAT*000099"
    Then Hub Authorization odmietne
    And ako zdroj rozhodnutia uvedie Whitelist

  @SC-03-01 @R-03 @BR-03
  Scenario: Pozastavený Member nemá Roaming sessions
    Given Finance pozastavila Membera "Tatra Charge"
    When CPO "Dunaj Energy" požiada o Authorization Tokenu "SK*TAT*000001"
    Then Hub Authorization odmietne s dôvodom Suspension
