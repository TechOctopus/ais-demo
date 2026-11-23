import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api, eur, isMine, setCredentials, subscribe, type AuthorizationResult, type Cdr, type Member, type Mode, type Period, type Problem, type SandboxEvent, type SandboxState, type Statement, type TariffVersion, type Who } from './api';

const SOURCE_LABEL: Record<AuthorizationResult['source'], string> = {
  EMSP_REALTIME: 'eMSP v reálnom čase',
  WHITELIST: 'Záložný Whitelist v hube',
  HUB_RULE: 'Pravidlo hubu',
};

const SOURCE_PATH: Record<AuthorizationResult['source'], string> = {
  EMSP_REALTIME: 'Nabíjačka (CPO) → OneKey Hub → Backend eMSP',
  WHITELIST: 'Nabíjačka (CPO) → OneKey Hub → Záložný Whitelist (eMSP nedostupný)',
  HUB_RULE: 'Nabíjačka (CPO) → OneKey Hub (zastavené pravidlom hubu)',
};

const REASON_LABEL: Record<string, string> = {
  TOKEN_VALID: 'Backend poskytovateľa vodiča (eMSP) potvrdil, že karta je platná.',
  TOKEN_BLOCKED: 'Poskytovateľ vodiča túto kartu zablokoval. Záložný Whitelist sa v takom prípade zámerne nepoužije.',
  TOKEN_UNKNOWN: 'Poskytovateľ vodiča túto kartu vo svojom systéme nepozná.',
  ON_WHITELIST: 'Poskytovateľ vodiča neodpovedal v limite 2 s, ale karta je na záložnom Whiteliste v hube — vodič môže nabíjať.',
  NOT_ON_WHITELIST: 'Poskytovateľ vodiča neodpovedal v limite 2 s a karta sa nenachádza na záložnom Whiteliste.',
  MEMBER_SUSPENDED: 'Poskytovateľ vodiča je v hube dočasne pozastavený (napr. pre neuhradenú faktúru), roamingové relácie sú zablokované.',
  NOT_A_ROAMING_SESSION: 'Karta aj nabíjačka patria tomu istému poskytovateľovi — nejde o roaming, hub do toho nevstupuje.',
  UNKNOWN_EMSP: 'Karta nepatrí žiadnemu registrovanému členovi hubu OneKey.',
};

const MODE_LABEL: Record<Mode, string> = { online: 'Online', slow: 'Pomalý (>2 s)', offline: 'Offline' };

const LOCATION_LABEL: Record<string, string> = {
  'DUN-BRATISLAVA-01': 'Bratislava – Centrum (Dunaj Energy)',
  'DUN-TRNAVA-03': 'Trnava – Obchodné centrum (Dunaj Energy)',
  'TAT-POPRAD-01': 'Poprad – Tatry (Tatra Charge)',
  'TAT-ZILINA-02': 'Žilina – D1 (Tatra Charge)',
  'SIT-HOTEL-01': 'Hotel Sitno – Parkovisko',
};

const TOKEN_LABEL: Record<string, { title: string; owner: string }> = {
  'SK*TAT*000001': { title: 'Tatra Charge – Karta #1', owner: 'Tatra Charge' },
  'SK*TAT*000002': { title: 'Tatra Charge – Karta #2', owner: 'Tatra Charge' },
  'SK*TAT*000099': { title: 'Tatra Charge – Karta #99 (bez Whitelistu)', owner: 'Tatra Charge' },
  'SK*DUN*000001': { title: 'Dunaj Energy – Karta #1', owner: 'Dunaj Energy' },
  'SK*FLG*000001': { title: 'FleetGo – Firemná karta #1', owner: 'FleetGo' },
  'SK*ONK*000001': { title: 'Karta OneKey – Predplatné #1', owner: 'OneKey Card Unit' },
  'SK*ONK*000002': { title: 'Karta OneKey – Pay-as-you-go #2', owner: 'OneKey Card Unit' },
  'SK*XXX*000001': { title: 'Cudzia karta (neznámy poskytovateľ)', owner: 'Nečlen' },
};

const TARIFF_LABEL: Record<string, string> = {
  'DUN-AC-v1': 'Dunaj AC · verzia 1',
  'TAT-DC-v1': 'Tatra DC · verzia 1',
  'SIT-AC-v1': 'Sitno AC · verzia 1',
};

const locationName = (id: string) => LOCATION_LABEL[id] ?? id;
const tokenTitle = (uid: string) => TOKEN_LABEL[uid]?.title ?? uid;
const tariffTitle = (t: TariffVersion) => `${TARIFF_LABEL[t.versionId] ?? t.versionId} (${(t.pricePerKwhCents / 100).toFixed(2)} €/kWh)`;

const toLocalInput = (iso: string) => {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const fromLocalInput = (v: string) => new Date(v).toISOString();
const time = (iso: string) => new Date(iso).toLocaleTimeString('sk-SK', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

/* ---------------- Stránky a živá synchronizácia ---------------- */

type Route = 'home' | 'cpo' | 'emsp' | 'hub';
const PAGES: Array<{ route: Exclude<Route, 'home'>; path: string; label: string; title: string; arch: string; text: string }> = [
  {
    route: 'cpo',
    path: '/cpo',
    label: 'CPO (Nabíjačka)',
    title: 'Prevádzkovateľ nabíjačky (CPO)',
    arch: 'External Provider Service · Proces 1.1 a 1.2',
    text: 'Vodič priloží kartu na cudzej nabíjačke, hub overí token u jeho eMSP a po nabití CPO odošle záznam o relácii (CDR).',
  },
  {
    route: 'emsp',
    path: '/emsp',
    label: 'eMSP (Karty vodičov)',
    title: 'Poskytovatelia služby (eMSP) a Karta OneKey',
    arch: 'External Provider Service + Identity Service (Card Unit)',
    text: 'Ovládanie dostupnosti backendov (Online / Pomalý / Offline), blokovanie kariet vodičov a aktualizácia záložného Whitelistu.',
  },
  {
    route: 'hub',
    path: '/hub',
    label: 'Hub a Finance',
    title: 'Prevádzka OneKey Hubu a mesačné zúčtovanie',
    arch: 'Hub Service + Finance · Proces 1.3 Settle Payment',
    text: 'Správa členov, audit všetkých autorizácií, prijaté záznamy CDR a uzavretie mesiaca s výpočtom čistých sáld (netting).',
  },
];
// Základná cesta webu: „/“ pri lokálnom serveri, napr. „/ais-demo/“ na GitHub Pages (nastavené pri builde).
declare const __BASE__: string;
const href = (path: string) => __BASE__ + path.replace(/^\//, '');
const routeOf = (pathname: string): Route => {
  const rel = pathname.startsWith(__BASE__) ? `/${pathname.slice(__BASE__.length)}` : pathname;
  return PAGES.find((p) => rel.replace(/\/+$/, '') === p.path)?.route ?? 'home';
};

interface Data {
  state: SandboxState;
  members: Member[];
  tariffs: TariffVersion[];
  cdrs: Cdr[];
  auths: AuthorizationResult[];
  periods: Period[];
  statements: Statement[];
}

/** Popis zmeny, ktorú urobila iná stránka (pre krátke upozornenie). */
function describe(e: SandboxEvent, name: (id: string | null) => string): string {
  const p = decodeURIComponent(e.path);
  let m: RegExpMatchArray | null;
  if (p.startsWith('/sandbox/reset')) return 'Údaje sandboxu boli obnovené na počiatočný stav';
  if ((m = p.match(/^\/sandbox\/emsp\/([^/]+)\/mode/))) return `${name(m[1])}: zmena dostupnosti backendu`;
  if ((m = p.match(/^\/sandbox\/emsp\/([^/]+)\/tokens\/(.+)$/))) return `${name(m[1])}: zmena stavu karty (${tokenTitle(m[2])})`;
  if ((m = p.match(/^\/hub\/v1\/tokens\/(.+)\/authorize/))) return `Overenie karty: ${tokenTitle(m[1])}`;
  if (p.startsWith('/hub/v1/cdrs')) return 'Hub prijal nový záznam o nabíjaní (CDR)';
  if (p.startsWith('/hub/v1/whitelist')) return 'Záložný Whitelist bol aktualizovaný';
  if ((m = p.match(/^\/hub\/v1\/members\/([^/]+)\/status/))) return `${name(m[1])}: zmena stavu členstva`;
  if ((m = p.match(/^\/hub\/v1\/settlement-periods\/([^/]+)\/close/))) return `Zúčtovanie za mesiac ${m[1]} bolo uzavreté`;
  return 'Zmena v sandboxe';
}

function useSandbox() {
  const [data, setData] = useState<Data>();
  const [live, setLive] = useState(false);
  const [epoch, setEpoch] = useState(0);
  const [toast, setToast] = useState('');
  const seq = useRef(0);
  const toastTimer = useRef<number | undefined>(undefined);
  const dataRef = useRef<Data | undefined>(undefined);
  dataRef.current = data;

  const flash = useCallback((msg: string) => {
    setToast(msg);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(''), 2600);
  }, []);

  const refresh = useCallback(async () => {
    const mine = ++seq.current;
    const s = await api.state();
    if (!s.ok) return;
    setCredentials(s.data.credentials);
    const [m, t, c, a, p, st] = await Promise.all([api.members(), api.tariffs(), api.cdrs(), api.authorizations(), api.periods(), api.statements()]);
    if (mine !== seq.current) return;
    setData({
      state: s.data,
      members: m.ok ? m.data : [],
      tariffs: t.ok ? t.data : [],
      cdrs: c.ok ? c.data : [],
      auths: a.ok ? a.data : [],
      periods: p.ok ? p.data : [],
      statements: st.ok ? st.data : [],
    });
  }, []);

  useEffect(() => {
    void refresh();
    let timer: number | undefined;
    const unsubscribe = subscribe(
      (e) => {
        if (isMine(e)) return;
        if (e.path.startsWith('/sandbox/reset')) setEpoch((x) => x + 1);
        const members = dataRef.current?.members ?? [];
        flash(describe(e, (id) => members.find((x) => x.memberId === id)?.name ?? id ?? '–'));
        window.clearTimeout(timer);
        timer = window.setTimeout(() => void refresh(), 50);
      },
      (ok) => {
        setLive(ok);
        if (ok) void refresh();
      },
    );
    return () => {
      window.clearTimeout(timer);
      unsubscribe();
    };
  }, [refresh, flash]);

  return { data, live, epoch, setEpoch, toast, flash, refresh };
}

export function App() {
  const route = routeOf(window.location.pathname);
  const { data, live, epoch, setEpoch, toast, flash, refresh } = useSandbox();
  const name = useCallback((id: string | null) => data?.members.find((m) => m.memberId === id)?.name ?? id ?? '–', [data]);
  const page = PAGES.find((p) => p.route === route);

  useEffect(() => {
    document.title = page ? `${page.label} · OneKey Hub` : 'OneKey Hub · Sandbox';
  }, [page]);

  if (!data) return <div className="app loading">Načítavam sandbox…</div>;
  const { state, members, tariffs, cdrs, auths, periods, statements } = data;
  const openPeriod = periods.find((p) => p.status === 'open')?.period ?? '';

  const closed = periods.filter((p) => p.status === 'closed').map((p) => p.period).sort();
  const lastPeriod = closed[closed.length - 1];
  const lastClose = lastPeriod
    ? { period: lastPeriod, hubFeeIncomeCents: statements.filter((s) => s.period === lastPeriod).reduce((a, s) => a + s.hubFeesCents, 0) }
    : null;

  return (
    <div className="app">
      <header className="bar">
        <a className="brand" href={href('/')}>
          OneKey Hub <span className="env">Interaktívny sandbox</span>
        </a>
        <nav className="nav">
          <a href={href('/')} className={route === 'home' ? 'active' : ''}>Prehľad systému</a>
          {PAGES.map((p) => (
            <a key={p.route} href={href(p.path)} className={p.route === route ? 'active' : ''} data-testid={`nav-${p.route}`}>
              {p.label}
            </a>
          ))}
        </nav>
        <div className="status">
          <span className="stat">
            <span className="k">Otvorený mesiac</span> <span className="v" data-testid="open-period">{openPeriod}</span>
          </span>
          <span className="stat">
            <span className="k">Limit odpovede eMSP</span> <span className="v">{state.emspTimeoutMs / 1000} s</span>
          </span>
          <span className={`live ${live ? 'on' : ''}`} data-testid="live" title="Zmeny z ostatných okien sa prejavia okamžite">
            {live ? 'Živé spojenie aktívne' : 'Odpojené'}
          </span>
          <button
            className="reset"
            onClick={async () => {
              await api.reset();
              setEpoch((x) => x + 1);
              await refresh();
              flash('Údaje sandboxu boli obnovené');
            }}
          >
            Obnoviť údaje
          </button>
        </div>
      </header>

      <main className={`main page-${route}`}>
        {page ? (
          <header className="head">
            <div className="head-top">
              <h1>{page.title}</h1>
              <span className="arch-tag">{page.arch}</span>
            </div>
            <p>{page.text}</p>
          </header>
        ) : null}
        {route === 'home' && <Home />}
        {route === 'cpo' && <CpoPage key={`cpo-${epoch}`} state={state} members={members} tariffs={tariffs} name={name} onDone={refresh} />}
        {route === 'emsp' && <EmspPage state={state} members={members} onDone={refresh} flash={flash} />}
        {route === 'hub' && (
          <HubPage
            members={members}
            cdrs={cdrs}
            auths={auths}
            statements={statements}
            openPeriod={openPeriod}
            lastClose={lastClose}
            name={name}
            onClose={async () => {
              const r = await api.close(openPeriod);
              flash(r.ok ? `Mesiac ${r.data.period} je uzavretý, otvorený je ${r.data.nextOpenPeriod}` : r.problem.title);
              await refresh();
            }}
            onStatus={async (id, status) => {
              await api.setStatus(id, status);
              await refresh();
            }}
          />
        )}
      </main>

      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}
    </div>
  );
}

function Home() {
  return (
    <section className="home">
      <h1>Sandbox eRoamingového hubu OneKey</h1>
      <p className="lede">
        Tri živé pohľady na jeden proces nabíjania (<strong>1.0 Charge Member Driver</strong>). Otvorte každý pohľad v samostatnom okne vedľa seba — každá zmena sa okamžite prejaví vo všetkých oknách.
      </p>

      <div className="flow-banner" aria-label="Architektúra roamingovej relácie">
        <div className="flow-node">
          <span className="flow-step">1.1 + 1.2</span>
          <strong>CPO (Nabíjačka)</strong>
          <span>Priloženie karty &amp; odoslanie CDR</span>
        </div>
        <span className="flow-arrow" aria-hidden="true">⇄</span>
        <div className="flow-node flow-hub">
          <span className="flow-step">1.1 · 1.2 · 1.3</span>
          <strong>OneKey Hub</strong>
          <span>Overenie, Whitelist, kontrola CDR &amp; zúčtovanie</span>
        </div>
        <span className="flow-arrow" aria-hidden="true">⇄</span>
        <div className="flow-node">
          <span className="flow-step">1.1</span>
          <strong>eMSP / Karta OneKey</strong>
          <span>Potvrdenie tokenu (oddelený Identity Service)</span>
        </div>
      </div>

      <ul className="launch">
        {PAGES.map((p) => (
          <li key={p.route}>
            <a href={href(p.path)} target="_blank" rel="noreferrer" data-testid={`open-${p.route}`}>
              <span className="launch-label">{p.label}</span>
              <span className="launch-title">
                {p.title} <span className="launch-arch">{p.arch}</span>
              </span>
              <span className="launch-text">{p.text}</span>
              <span className="launch-open">Otvoriť v novom okne →</span>
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}

/* ---------------- Spoločné prvky ---------------- */

function Field({ label, wide, children }: { label: string; wide?: boolean; children: ReactNode }) {
  return (
    <label className={`field ${wide ? 'wide' : ''}`}>
      <span className="field-label">{label}</span>
      {children}
    </label>
  );
}

function Facts({ items }: { items: Array<[string, ReactNode, string?]> }) {
  return (
    <dl className="kv">
      {items.map(([k, v, cls]) => (
        <div key={k}>
          <dt>{k}</dt>
          <dd className={cls}>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

/* ---------------- CPO ---------------- */

function CpoPage({ state, members, tariffs, name, onDone }: { state: SandboxState; members: Member[]; tariffs: TariffVersion[]; name: (id: string | null) => string; onDone: () => Promise<void> }) {
  const cpos = members.filter((m) => m.roles.includes('CPO'));
  const [cpo, setCpo] = useState<Who>('dunaj');
  const [location, setLocation] = useState('');
  const tokens = useMemo(() => {
    const all = [...state.emsps.flatMap((e) => Object.keys(e.tokens)), ...Object.keys(state.identity.tokens), 'SK*XXX*000001'];
    return [...new Set(all)].sort();
  }, [state]);
  const [token, setToken] = useState('SK*TAT*000001');
  const [busy, setBusy] = useState(false);
  const [auth, setAuth] = useState<AuthorizationResult & { ms: number }>();

  const locs = state.locations[cpo] ?? [];
  useEffect(() => setLocation(locs[0] ?? ''), [cpo]); // eslint-disable-line react-hooks/exhaustive-deps

  const cpoTariffs = tariffs.filter((t) => t.cpoId === cpo);
  const [energy, setEnergy] = useState(30);
  const [start, setStart] = useState(() => toLocalInput(new Date(Date.parse(state.now) - 2 * 3600e3).toISOString()));
  const [end, setEnd] = useState(() => toLocalInput(new Date(Date.parse(state.now) - 1 * 3600e3).toISOString()));
  const [version, setVersion] = useState('');
  const [cdrResult, setCdrResult] = useState<{ ok: true; cdr: Cdr } | { ok: false; problem: Problem }>();
  useEffect(() => setVersion(cpoTariffs[cpoTariffs.length - 1]?.versionId ?? ''), [cpo, tariffs.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const tv = cpoTariffs.find((t) => t.versionId === version);
  const cost = Math.round((tv?.pricePerKwhCents ?? 0) * energy);
  const accepted = auth?.result === 'ACCEPTED';

  const preset = (k: 'zero' | 'version' | 'old' | 'reverse') => {
    const now = Date.parse(state.now);
    if (k === 'zero') setEnergy(0);
    if (k === 'reverse') {
      setStart(toLocalInput(new Date(now - 1 * 3600e3).toISOString()));
      setEnd(toLocalInput(new Date(now - 2 * 3600e3).toISOString()));
    }
    if (k === 'old') {
      setStart(toLocalInput(new Date(now - 61 * 86400e3).toISOString()));
      setEnd(toLocalInput(new Date(now - 61 * 86400e3 + 3600e3).toISOString()));
    }
    if (k === 'version') setVersion('NEPLATNA-VERZIA');
    setCdrResult(undefined);
  };

  return (
    <div className="cpo-wrap">
      <ol className="steps" aria-label="Kroky procesu 1.0 Charge Member Driver">
        <li className={auth ? (accepted ? 'done' : 'fail') : 'current'}>
          <span className="step-num">1.1</span>
          <div>
            <strong>Authorization</strong>
            <span>Overenie karty vodiča cez Hub</span>
          </div>
        </li>
        <li className={cdrResult ? (cdrResult.ok ? 'done' : 'fail') : accepted ? 'current' : ''}>
          <span className="step-num">1.2</span>
          <div>
            <strong>Bridge Providers</strong>
            <span>Nabíjanie a odoslanie záznamu CDR</span>
          </div>
        </li>
        <li className={cdrResult?.ok ? 'current' : ''}>
          <span className="step-num">1.3</span>
          <div>
            <strong>Settle Payment</strong>
            <span>Mesačné zúčtovanie v okne Hub a Finance</span>
          </div>
        </li>
      </ol>

      <div className="cpo" data-testid="cpo-panel">
        <section className="block control">
          <h2>1. Priloženie karty na nabíjačke</h2>
          <div className="fields">
            <Field label="Prevádzkovateľ nabíjačky (CPO)">
              <select value={cpo} onChange={(e) => { setCpo(e.target.value as Who); setAuth(undefined); setCdrResult(undefined); }} data-testid="cpo-select">
                {cpos.map((m) => (
                  <option key={m.memberId} value={m.memberId}>{m.name}</option>
                ))}
              </select>
            </Field>
            <Field label="Nabíjacia stanica">
              <select value={location} onChange={(e) => setLocation(e.target.value)}>
                {locs.map((l) => (
                  <option key={l} value={l}>{locationName(l)}</option>
                ))}
              </select>
            </Field>
            <Field label="Karta / token vodiča" wide>
              <select value={token} onChange={(e) => setToken(e.target.value)} data-testid="token-select">
                {tokens.map((t) => (
                  <option key={t} value={t}>{tokenTitle(t)}</option>
                ))}
              </select>
            </Field>
          </div>
          <div className="actions">
            <button
              className="btn primary"
              disabled={busy}
              data-testid="authorize"
              onClick={async () => {
                setBusy(true);
                setCdrResult(undefined);
                const t0 = performance.now();
                const r = await api.authorize(cpo, token, location);
                if (r.ok) setAuth({ ...r.data, ms: Math.round(performance.now() - t0) });
                setBusy(false);
                await onDone();
              }}
            >
              {busy ? 'Hub overuje kartu…' : 'Priložiť kartu'}
            </button>
          </div>
        </section>

        <section className={`block auth ${auth ? (accepted ? 'is-ok' : 'is-no') : 'is-idle'}`}>
          <h2>Odpoveď hubu</h2>
          {auth ? (
            <div className={`verdict ${accepted ? 'ok' : 'no'}`} data-testid="auth-result">
              <p className="verdict-title">{accepted ? 'Nabíjanie povolené' : 'Nabíjanie zamietnuté'}</p>
              <p className="verdict-text">{REASON_LABEL[auth.reason] ?? auth.reason}</p>
              <p className="route-pill">{SOURCE_PATH[auth.source]}</p>
              <Facts
                items={[
                  ['Kto rozhodol', SOURCE_LABEL[auth.source]],
                  ['Poskytovateľ vodiča (eMSP)', name(auth.emspId)],
                  ['Čas odozvy', `${auth.ms} ms`, 'num'],
                  ['Čas rozhodnutia', time(auth.decidedAt)],
                ]}
              />
            </div>
          ) : (
            <p className="placeholder">Vyberte nabíjačku a kartu vodiča, potom kliknite na „Priložiť kartu“.</p>
          )}
        </section>

        {accepted && (
          <section className="block session">
            <h2>2. Ukončenie nabíjania (odoslanie záznamu CDR)</h2>
            <div className="fields">
              <Field label="Dodaná energia (kWh)">
                <input type="number" value={energy} min={0} step={0.1} onChange={(e) => setEnergy(Number(e.target.value))} data-testid="energy" />
              </Field>
              <Field label="Veľkoobchodná tarifa">
                <select value={version} onChange={(e) => setVersion(e.target.value)}>
                  {cpoTariffs.map((t) => (
                    <option key={t.versionId} value={t.versionId}>{tariffTitle(t)}</option>
                  ))}
                  {version === 'NEPLATNA-VERZIA' && <option value="NEPLATNA-VERZIA">Neplatná verzia tarify (test chyby)</option>}
                </select>
              </Field>
              <Field label="Začiatok nabíjania">
                <input type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} />
              </Field>
              <Field label="Koniec nabíjania">
                <input type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} />
              </Field>
            </div>
            <div className="presets">
              <span className="presets-label">Otestovať chybný záznam:</span>
              <button className="btn text" onClick={() => preset('zero')}>0 kWh</button>
              <button className="btn text" onClick={() => preset('version')}>neplatná tarifa</button>
              <button className="btn text" onClick={() => preset('reverse')}>koniec pred začiatkom</button>
              <button className="btn text" onClick={() => preset('old')} data-testid="preset-old">relácia staršia ako 60 dní</button>
            </div>
            <div className="actions">
              <button
                className="btn primary"
                data-testid="send-cdr"
                onClick={async () => {
                  const r = await api.submitCdr(cpo, {
                    cdrId: `CDR-${Date.now()}`,
                    tokenUid: auth.tokenUid,
                    locationId: location,
                    tariffId: tv?.tariffId ?? cpoTariffs[0]?.tariffId ?? '',
                    tariffVersionId: version,
                    startTime: fromLocalInput(start),
                    endTime: fromLocalInput(end),
                    energyKwh: energy,
                    totalCostCents: cost,
                  });
                  setCdrResult(r.ok ? { ok: true, cdr: r.data } : { ok: false, problem: r.problem });
                  await onDone();
                }}
              >
                Poslať záznam (CDR) · {eur(cost)}
              </button>
            </div>
          </section>
        )}

        {accepted && (
          <section className={`block cdr ${cdrResult ? (cdrResult.ok ? 'is-ok' : 'is-no') : 'is-idle'}`}>
            <h2>Spracovanie záznamu v hube</h2>
            {!cdrResult && <p className="placeholder">Záznam o nabíjaní (CDR) ešte nebol odoslaný.</p>}
            {cdrResult?.ok && (
              <div className="verdict ok" data-testid="cdr-result">
                <p className="verdict-title">CDR prijatý a overený</p>
                <p className="verdict-text">
                  {name(cdrResult.cdr.emspId)} dlhuje {name(cdrResult.cdr.cpoId)} sumu {eur(cdrResult.cdr.totalCostCents)} a hubu poplatok {eur(cdrResult.cdr.hubFeeCents)}.
                </p>
                <Facts
                  items={[
                    ['Zúčtovacie obdobie', cdrResult.cdr.settlementPeriod, 'num'],
                    ['Dodaná energia', `${cdrResult.cdr.energyKwh} kWh`, 'num'],
                    ['Použitá tarifa', TARIFF_LABEL[cdrResult.cdr.tariffVersionId] ?? cdrResult.cdr.tariffVersionId],
                    ['Stav nároku', 'Zaradené do mesačného zúčtovania'],
                  ]}
                />
              </div>
            )}
            {cdrResult && !cdrResult.ok && (
              <div className="verdict no" data-testid="cdr-result">
                <p className="verdict-title">CDR odmietnutý hubom</p>
                <p className="verdict-text">Hub odhalil neplatný záznam a do zúčtovania ho nezaradil:</p>
                <ul className="violations">
                  {(cdrResult.problem.violations ?? [{ rule: '', message: cdrResult.problem.title }]).map((v, i) => (
                    <li key={i}>• {v.message}</li>
                  ))}
                </ul>
              </div>
            )}
          </section>
        )}
      </div>
    </div>
  );
}

/* ---------------- eMSP ---------------- */

function EmspPage({ state, members, onDone, flash }: { state: SandboxState; members: Member[]; onDone: () => Promise<void>; flash: (m: string) => void }) {
  const rows = [
    ...state.emsps.map((e) => ({ id: e.memberId, mode: e.mode, tokens: e.tokens })),
    { id: 'onekey-card', mode: state.identity.mode, tokens: state.identity.tokens },
  ];
  return (
    <div className="emsps" data-testid="emsp-panel">
      <div className="legend-bar">
        <strong>Režimy backendu:</strong> <span><em>Online</em> — odpovedá okamžite</span> · <span><em>Pomalý (&gt;2 s)</em> — nestihne limit, hub použije Whitelist</span> · <span><em>Offline</em> — výpadok, hub použije Whitelist</span>
      </div>
      {rows.map((r) => {
        const m = members.find((x) => x.memberId === r.id);
        const wl = new Map((state.whitelists[r.id] ?? []).map((w) => [w.uid, w.valid]));
        const isCardUnit = r.id === 'onekey-card';
        return (
          <section className={`block backend ${isCardUnit ? 'backend-onekey' : ''}`} key={r.id} data-testid={`emsp-${r.id}`}>
            <div className="backend-head">
              <div className="backend-name">
                <h2>{m?.name ?? r.id}</h2>
                <span className="note">
                  {isCardUnit ? 'Oddelená jednotka karty · Identity Service (vlastná DB podľa GDPR)' : `Roly: ${m?.roles.join(' + ')}`}
                </span>
                {m?.status === 'suspended' && <span className="flag">pozastavený</span>}
              </div>
              <div className="seg" role="group" aria-label="Režim backendu">
                {(['online', 'slow', 'offline'] as Mode[]).map((mode) => (
                  <button
                    key={mode}
                    data-mode={mode}
                    aria-pressed={r.mode === mode}
                    data-testid={`mode-${r.id}-${mode}`}
                    onClick={async () => {
                      await api.setMode(r.id, mode);
                      await onDone();
                    }}
                  >
                    {MODE_LABEL[mode]}
                  </button>
                ))}
              </div>
            </div>
            <table className="tbl tokens">
              <thead>
                <tr><th>Karta vodiča</th><th>Stav u poskytovateľa</th><th>Záložný Whitelist v hube</th></tr>
              </thead>
              <tbody>
                {Object.entries(r.tokens).map(([uid, st]) => (
                  <tr key={uid}>
                    <td>
                      <span className="strong">{tokenTitle(uid)}</span>
                      <span className="token-sub mono">{uid}</span>
                    </td>
                    <td>
                      <button
                        className={`tog ${st === 'ALLOWED' ? 'ok' : 'no'}`}
                        data-testid={`token-${uid}`}
                        title={st === 'ALLOWED' ? 'Kliknutím zablokovať kartu' : 'Kliknutím odblokovať kartu'}
                        onClick={async () => {
                          await api.setToken(r.id, uid, st === 'ALLOWED' ? 'BLOCKED' : 'ALLOWED');
                          await onDone();
                        }}
                      >
                        {st === 'ALLOWED' ? 'platná' : 'blokovaná'}
                      </button>
                    </td>
                    <td className={wl.has(uid) && wl.get(uid) ? 'wl-yes' : 'wl-no'}>
                      {wl.has(uid) ? (wl.get(uid) ? 'na Whiteliste' : 'neplatná') : 'nie je na Whiteliste'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="actions">
              <button
                className="btn text"
                onClick={async () => {
                  const r2 = await api.pushWhitelist(r.id as Who, Object.entries(r.tokens).map(([uid, st]) => ({ uid, valid: st === 'ALLOWED' })));
                  flash(r2.ok ? `${m?.name}: Whitelist aktualizovaný (${r2.data.count} kariet)` : r2.problem.title);
                  await onDone();
                }}
              >
                Synchronizovať Whitelist do hubu
              </button>
            </div>
          </section>
        );
      })}
    </div>
  );
}

/* ---------------- Hub a Finance ---------------- */

function HubPage(props: {
  members: Member[];
  cdrs: Cdr[];
  auths: AuthorizationResult[];
  statements: Statement[];
  openPeriod: string;
  lastClose: { period: string; hubFeeIncomeCents: number } | null;
  name: (id: string | null) => string;
  onClose: () => Promise<void>;
  onStatus: (id: string, s: 'active' | 'suspended') => Promise<void>;
}) {
  const { members, cdrs, auths, statements, openPeriod, lastClose, name } = props;
  const open = cdrs.filter((c) => c.settlementPeriod === openPeriod);
  const openHubFees = open.reduce((a, c) => a + c.hubFeeCents, 0);
  const activeMembers = members.filter((m) => m.status === 'active').length;
  const shown = lastClose ? statements.filter((s) => s.period === lastClose.period) : [];
  const sum = shown.reduce((a, s) => a + s.netBalanceCents, 0) + (lastClose?.hubFeeIncomeCents ?? 0);

  return (
    <div className="hub" data-testid="hub-panel">
      <div className="kpi-row">
        <div className="kpi">
          <span className="kpi-label">Aktívni členovia</span>
          <span className="kpi-val">{activeMembers} / {members.length}</span>
        </div>
        <div className="kpi">
          <span className="kpi-label">Overenia kariet</span>
          <span className="kpi-val">{auths.length}</span>
        </div>
        <div className="kpi">
          <span className="kpi-label">Prijaté CDR ({openPeriod})</span>
          <span className="kpi-val">{open.length}</span>
        </div>
        <div className="kpi">
          <span className="kpi-label">Poplatky hubu ({openPeriod})</span>
          <span className="kpi-val pos">{eur(openHubFees)}</span>
        </div>
      </div>

      <section className="block members">
        <h2>Členovia hubu a poplatky zo zmlúv</h2>
        <table className="tbl">
          <thead>
            <tr><th>Člen</th><th>Roly</th><th className="num">Poplatok hubu</th><th>Stav</th><th /></tr>
          </thead>
          <tbody>
            {members.map((m) => (
              <tr key={m.memberId}>
                <td className="strong">{m.name}</td>
                <td>{m.roles.join(' + ')}</td>
                <td className="num">{m.roles.includes('EMSP') ? (m.hubFee.kind === 'FIXED' ? `${eur(m.hubFee.value)} / relácia` : `${m.hubFee.value} % z ceny`) : '– (iba CPO)'}</td>
                <td><span className={`state ${m.status}`}>{m.status === 'active' ? 'aktívny' : 'pozastavený'}</span></td>
                <td className="row-action">
                  {m.roles.includes('EMSP') && (
                    <button className="btn text" data-testid={`suspend-${m.memberId}`} onClick={() => props.onStatus(m.memberId, m.status === 'active' ? 'suspended' : 'active')}>
                      {m.status === 'active' ? 'Pozastaviť člena' : 'Obnoviť člena'}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="block audit">
        <h2>Audit autorizácií (Authorization Record)</h2>
        <table className="tbl" data-testid="audit-log">
          <thead>
            <tr><th>Čas</th><th>Karta vodiča</th><th>Nabíjačka (CPO) → Poskytovateľ (eMSP)</th><th>Výsledok</th><th>Kto rozhodol</th></tr>
          </thead>
          <tbody>
            {auths.length === 0 && (
              <tr><td colSpan={5} className="empty">Zatiaľ neprebehla žiadna autorizácia. Priložte kartu v okne CPO.</td></tr>
            )}
            {auths.slice(0, 8).map((a) => (
              <tr key={a.authorizationId}>
                <td className="mono">{time(a.decidedAt)}</td>
                <td>
                  <span>{tokenTitle(a.tokenUid)}</span>
                  <span className="token-sub mono">{a.tokenUid}</span>
                </td>
                <td>{name(a.cpoId)} → {name(a.emspId)}</td>
                <td><span className={`state ${a.result === 'ACCEPTED' ? 'active' : 'rejected'}`}>{a.result === 'ACCEPTED' ? 'povolené' : 'zamietnuté'}</span></td>
                <td>{SOURCE_LABEL[a.source]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="block cdrs">
        <h2>Prijaté záznamy o nabíjaní (CDR) · mesiac {openPeriod}</h2>
        <table className="tbl">
          <thead>
            <tr><th>CPO (nabíjačka)</th><th>eMSP (platí)</th><th className="num">Energia</th><th className="num">Veľkoobchodná cena</th><th className="num">Poplatok hubu</th></tr>
          </thead>
          <tbody data-testid="cdr-table">
            {open.length === 0 && (
              <tr><td colSpan={5} className="empty">V tomto mesiaci zatiaľ nie sú prijaté žiadne CDR.</td></tr>
            )}
            {open.map((c) => (
              <tr key={`${c.cpoId}-${c.cdrId}`}>
                <td>{name(c.cpoId)}</td>
                <td>{name(c.emspId)}</td>
                <td className="num">{c.energyKwh} kWh</td>
                <td className="num">{eur(c.totalCostCents)}</td>
                <td className="num">{eur(c.hubFeeCents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="actions">
          <button className="btn primary" data-testid="close-period" onClick={props.onClose}>
            Uzavrieť mesiac {openPeriod} a vypočítať zúčtovanie
          </button>
        </div>
      </section>

      <section className="block settle">
        <h2>{lastClose ? `Mesačné zúčtovanie (netting) · ${lastClose.period}` : 'Mesačné zúčtovanie (netting)'}</h2>
        {!lastClose && <p className="placeholder">Zatiaľ nebol uzavretý žiadny mesiac. Po prijatí CDR kliknite na „Uzavrieť mesiac“.</p>}
        {lastClose && (
          <div data-testid="statements">
            <table className="tbl">
              <thead>
                <tr><th>Člen</th><th className="num">Pohľadávky (CPO)</th><th className="num">Záväzky (eMSP)</th><th className="num">Poplatky hubu</th><th className="num">Čisté saldo (1 faktúra)</th></tr>
              </thead>
              <tbody>
                {shown.map((s) => (
                  <tr key={s.memberId}>
                    <td className="strong">{name(s.memberId)}</td>
                    <td className="num">{eur(s.receivablesCents)}</td>
                    <td className="num">{eur(s.payablesCents)}</td>
                    <td className="num">{eur(s.hubFeesCents)}</td>
                    <td className={`num strong ${s.netBalanceCents >= 0 ? 'pos' : 'neg'}`}>{eur(s.netBalanceCents)}</td>
                  </tr>
                ))}
                <tr className="total">
                  <td>OneKey Hub (príjem z poplatkov)</td>
                  <td colSpan={3} />
                  <td className="num strong">{eur(lastClose.hubFeeIncomeCents)}</td>
                </tr>
              </tbody>
            </table>
            <p className={`invariant ${sum === 0 ? 'ok' : 'no'}`} data-testid="invariant">
              Kontrola rovnováhy: súčet všetkých čistých sáld a príjmu hubu je {eur(sum)} — {sum === 0 ? 'v poriadku, žiadne peniaze sa nestratili.' : 'chyba v zúčtovaní.'}
            </p>
            <p className="note">Kladné saldo (+): hub vypláca členovi. Záporné saldo (−): člen uhrádza hubu na základe jednej mesačnej faktúry.</p>
          </div>
        )}
      </section>
    </div>
  );
}
