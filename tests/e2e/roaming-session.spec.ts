// Akceptačné testy cez webové rozhranie: BSC-01 od priloženia karty po Settlement.
// Každá časť (CPO, eMSP, Hub) beží v samostatnom okne, rovnako ako pri ukážke.
// Screenshoty sa ukladajú do reports/screenshots/ ako dôkaz pre validation report.
import { expect, test, type BrowserContext, type Page } from '@playwright/test';

const shot = (name: string) => `reports/screenshots/${name}.png`;

// Oba testy menia ten istý Sandbox – musia bežať po sebe.
test.describe.configure({ mode: 'serial' });

async function open(context: BrowserContext, path: string): Promise<Page> {
  const p = await context.newPage();
  await p.setViewportSize({ width: 1280, height: 860 });
  await p.goto(path);
  await expect(p.getByTestId('live')).toHaveClass(/on/);
  return p;
}

test('BSC-01 Roaming session end-to-end vo webovom rozhraní', async ({ context, request }) => {
  await request.post('/sandbox/reset');
  const home = await open(context, '/');
  await expect(home.getByTestId('open-period')).toHaveText(/\d{4}-\d{2}/);
  for (const r of ['cpo', 'emsp', 'hub']) await expect(home.getByTestId(`open-${r}`)).toBeVisible();
  await home.screenshot({ path: shot('01-prehlad') });
  await home.close();

  const cpo = await open(context, '/cpo');
  const emsp = await open(context, '/emsp');
  const hub = await open(context, '/hub');
  const auth = cpo.getByTestId('auth-result');

  // SC-01-01: Tatra Driver u Dunaj Energy – eMSP potvrdí v reálnom čase
  await cpo.getByTestId('cpo-select').selectOption('dunaj');
  await cpo.getByTestId('token-select').selectOption('SK*TAT*000001');
  await cpo.getByTestId('authorize').click();
  await expect(auth).toContainText('Nabíjanie povolené');
  await expect(auth).toContainText('eMSP v reálnom čase');

  // SC-04-01: platný CDR
  await cpo.getByTestId('send-cdr').click();
  await expect(cpo.getByTestId('cdr-result')).toContainText('CDR prijatý');
  await expect(hub.getByTestId('cdr-table')).toContainText('Dunaj Energy');
  await cpo.screenshot({ path: shot('02-autorizacia-a-cdr'), fullPage: true });

  // SC-05-01: CDR session spred 61 dní – Hub odmietne
  await cpo.getByTestId('authorize').click();
  await expect(auth).toContainText('Nabíjanie povolené');
  await cpo.getByTestId('preset-old').click();
  await cpo.getByTestId('send-cdr').click();
  await expect(cpo.getByTestId('cdr-result')).toContainText('CDR odmietnutý');
  await expect(cpo.getByTestId('cdr-result')).toContainText('60 dňami');
  await cpo.screenshot({ path: shot('03-cdr-odmietnuty'), fullPage: true });
  await cpo.reload(); // formulár späť na predvolené časy session (stav Hubu zostáva)
  await cpo.getByTestId('cpo-select').selectOption('dunaj');

  // SC-02-01: backend Tatra Charge je offline → Whitelist
  await emsp.getByTestId('mode-tatra-offline').click();
  await cpo.getByTestId('token-select').selectOption('SK*TAT*000002');
  await cpo.getByTestId('authorize').click();
  await expect(auth).toContainText('Nabíjanie povolené');
  await expect(auth).toContainText('Whitelist');
  await expect(hub.getByTestId('audit-log')).toContainText('SK*TAT*000002');
  await cpo.screenshot({ path: shot('04-whitelist-fallback'), fullPage: true });

  // SC-01-02: backend späť online, Token zablokovaný → zamietnuté, aj keď je na Whiteliste
  await emsp.getByTestId('mode-tatra-online').click();
  await emsp.getByTestId('token-SK*TAT*000001').click();
  await cpo.getByTestId('token-select').selectOption('SK*TAT*000001');
  await cpo.getByTestId('authorize').click();
  await expect(auth).toContainText('Nabíjanie zamietnuté');
  await expect(auth).toContainText('zablokoval');

  // SC-01-03: OneKey card cez Identity Service – CDR pre Settlement
  await cpo.getByTestId('token-select').selectOption('SK*ONK*000001');
  await cpo.getByTestId('authorize').click();
  await expect(auth).toContainText('Nabíjanie povolené');
  await cpo.getByTestId('energy').fill('10');
  await cpo.getByTestId('send-cdr').click();
  await expect(cpo.getByTestId('cdr-result')).toContainText('CDR prijatý');

  // SC-03-01: Finance pozastaví Tatra Charge → Tokeny Tatra zamietnuté
  await emsp.getByTestId('token-SK*TAT*000001').click(); // odblokovať
  await hub.getByTestId('suspend-tatra').click();
  await expect(emsp.getByTestId('emsp-tatra')).toContainText('pozastavený');
  await cpo.getByTestId('token-select').selectOption('SK*TAT*000002');
  await cpo.getByTestId('authorize').click();
  await expect(auth).toContainText('Nabíjanie zamietnuté');
  await expect(auth).toContainText('pozastavený');
  await emsp.screenshot({ path: shot('05-emsp'), fullPage: true });
  await hub.getByTestId('suspend-tatra').click(); // obnoviť

  // SC-06-01: Finance uzavrie mesiac → jeden statement na Membera, BR-09
  await hub.getByTestId('close-period').click();
  await expect(hub.getByTestId('statements')).toContainText('Tatra Charge');
  await expect(hub.getByTestId('invariant')).toContainText('v poriadku');
  await expect(hub.locator('.toast')).toBeHidden({ timeout: 5000 });
  await hub.screenshot({ path: shot('06-hub-settlement'), fullPage: true });
});

test('Tri samostatné stránky (CPO, eMSP, Hub) sa synchronizujú naživo', async ({ context, request }) => {
  await request.post('/sandbox/reset');
  const cpo = await open(context, '/cpo');
  const emsp = await open(context, '/emsp');
  const hub = await open(context, '/hub');

  // eMSP stránka: backend Tatra Charge offline → CPO stránka: Hub rozhodne podľa Whitelistu
  await emsp.getByTestId('mode-tatra-offline').click();
  await cpo.getByTestId('cpo-select').selectOption('dunaj');
  await cpo.getByTestId('token-select').selectOption('SK*TAT*000002');
  await cpo.getByTestId('authorize').click();
  await expect(cpo.getByTestId('auth-result')).toContainText('Whitelist');

  // … a Hub stránka má Authorization v audite bez obnovenia stránky
  await expect(hub.getByTestId('audit-log')).toContainText('SK*TAT*000002');

  // CPO pošle CDR → objaví sa v tabuľke CDR na Hub stránke
  await cpo.getByTestId('send-cdr').click();
  await expect(cpo.getByTestId('cdr-result')).toContainText('CDR prijatý');
  await expect(hub.getByTestId('cdr-table')).toContainText('Dunaj Energy');

  // Hub stránka: Finance pozastaví Tatra Charge → eMSP stránka ukáže pozastavenie
  await hub.getByTestId('suspend-tatra').click();
  await expect(emsp.getByTestId('emsp-tatra')).toContainText('pozastavený');

  // Hub stránka: uzavretie mesiaca → Settlement a kontrola BR-09
  await hub.getByTestId('close-period').click();
  await expect(hub.getByTestId('invariant')).toContainText('v poriadku');

  // Obnovenie Sandboxu na Hub stránke vyčistí formulár na CPO stránke
  await hub.getByRole('button', { name: 'Obnoviť údaje' }).click();
  await expect(cpo.getByTestId('auth-result')).toHaveCount(0);
  await expect(emsp.getByTestId('emsp-tatra')).not.toContainText('pozastavený');
});
