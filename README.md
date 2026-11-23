# OneKey Hub – prototyp podľa SDD

Spustiteľný prototyp jedného end-to-end výrezu architektúry OneKey:
**Authorization Tokenu → CDR → mesačný Settlement**. Vznikol postupom Specification-Driven
Development z predmetu (SDD framework v4): najprv specification, potom schválený contract, potom code a testy.

## Online verzia

**https://techoctopus.github.io/ais-demo/** – statická verzia na GitHub Pages. Server prototypu
(`createApp()` – Hub Service, Identity Service aj simulátor) beží priamo v prehliadači v SharedWorkeri
(`src/static/`), takže okná CPO, eMSP a Hub zdieľajú jeden stav a sú prepojené naživo ako pri lokálnom serveri.
Stav je iba v pamäti prehliadača – zatvorením všetkých okien sa obnoví počiatočný stav.
Build: `npm run build:pages` (premenná `STATIC_BASE`, predvolene `/ais-demo/`); nasadenie robí `.github/workflows/pages.yml`.

## Spustenie

```bash
npm install
npm run build      # typecheck + build webového rozhrania
npm start          # http://localhost:4000
npm test           # 44 unit / contract / acceptance / architecture / výkonových testov
npm run test:e2e   # test webového rozhrania v Microsoft Edge (Playwright)
```

Ak sa namiesto rozhrania zobrazí „Webové rozhranie nie je zostavené“, chýba priečinok `dist/web` – spustite `npm run build` a server reštartujte.

`npm run build` a `npm start` fungujú aj na zdieľanom priečinku Parallels (`\\psf\…`, `C:\Mac\…`) – build robí priamo esbuild (`scripts/build-web.mjs`), lebo Vite sieťové cesty nepodporuje. Testy (`npm test`, `npm run test:e2e`) a `npm run dev` však na sieťovej ceste zlyhajú; spúšťajte ich z kópie projektu na lokálnom disku (napr. `C:\onekey\prototype`).

Limit odpovede eMSP sa dá zmeniť premennou `EMSP_TIMEOUT_MS` (predvolene 2000 ms, rozhodnutie OQ-01).

## Čo ukázať

Úvodná stránka http://localhost:4000 otvorí každú časť v samostatnom okne:
http://localhost:4000/cpo, `/emsp` a `/hub`. Okná dajte vedľa seba –
stránky sú prepojené naživo (Server-Sent Events, `/sandbox/events`), takže zmena v jednom okne
sa hneď prejaví v ostatných a ukáže sa krátke upozornenie. Stav spojenia („Spojené“) je v spodnej časti bočného panela.

1. **CPO – priloženie karty:** Dunaj Energy, Karta Tatra Charge → eMSP Tatra Charge potvrdí v reálnom čase.
2. **eMSP backendy:** prepnite Tatra Charge na *Offline* → Hub rozhodne podľa Whitelistu. Zablokujte kartu → Hub ju odmietne aj napriek Whitelistu.
3. **CDR:** po povolení pošlite CDR; voľby „Simulovať chybný CDR“ ukážu odmietnutie s jasným vysvetlením.
4. **Hub a Finance:** pozastavte člena (Suspension), uzavrite mesiac → jeden výpis na člena a kontrola rovnováhy (0,00 €).

## Štruktúra

| Priečinok | Obsah | Úroveň autority (SDD) |
|---|---|---|
| `spec/requirements`, `spec/business` | Goals → Requirements, Business Rules, procesy | 1 |
| `spec/architecture`, `spec/application`, `spec/technology` | výrez modelu B-01 (EA IDs), komponenty, interakcie, Data Objects | 2 |
| `spec/stories`, `spec/contracts/approved` | Gherkin scenáre, OpenAPI contract API-Hub 0.1.0 | 3 |
| `src`, `tests` | realizácia | 4 |
| `reports` | impact analysis, validation report, výsledky testov, screenshoty | – |

Komponenty v kóde zodpovedajú modelu: `src/server/hub` = Hub Service (EA #85),
`src/server/identity` = Identity Service (EA #104), `src/server/member-sim` = simulátor External Provider Service (EA #127).
Názvy Members a ceny sú ilustračné.
