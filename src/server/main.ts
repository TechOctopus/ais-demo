import express from 'express';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { createApp } from './app.js';

const port = Number(process.env.PORT ?? 4000);
const { app, setBaseUrl } = createApp();
setBaseUrl(`http://127.0.0.1:${port}`);

const web = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../dist/web');
if (existsSync(web)) {
  app.use(express.static(web));
  // stránky /, /cpo, /emsp, /hub – všetko okrem API (/hub/v1/…, /sim/…, /identity/…, /sandbox/…)
  app.get(/^\/(?!(?:hub|sim|identity|sandbox)\/).*/, (_req, res) => res.sendFile(path.join(web, 'index.html')));
} else {
  console.warn(`Webové rozhranie chýba (${web}). Spustite "npm run build" a server reštartujte. API beží aj bez neho.`);
  app.get('/', (_req, res) =>
    res
      .status(503)
      .type('html')
      .send(
        '<h1>Webové rozhranie nie je zostavené</h1><p>Spustite <code>npm run build</code> a server reštartujte. ' +
          'Hub API beží na <code>/hub/v1</code>.</p>',
      ),
  );
}

app.listen(port, () => console.log(`OneKey Hub Sandbox beží na http://localhost:${port}`));
