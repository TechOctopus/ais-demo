// Minimálna náhrada knižnice Express pre statickú verziu (GitHub Pages).
// Pri statickom builde sa `import express from 'express'` presmeruje sem (esbuild alias), takže tie isté
// routery Hubu, Identity Service a simulátora bežia v prehliadači (SharedWorker) bez zmeny kódu.
// Podporuje iba to, čo prototyp používa: Router, use/get/post/put, :params, json, error handlers.

/* eslint-disable @typescript-eslint/no-explicit-any */
type Next = (err?: unknown) => void;
type Fn = (...args: any[]) => unknown;

export interface ShimRequest {
  method: string;
  originalUrl: string;
  path: string;
  params: Record<string, string>;
  query: Record<string, string>;
  body: any;
  headers: Record<string, string>;
  header(name: string): string | undefined;
  get(name: string): string | undefined;
  on(event: string, cb: () => void): void;
  [key: string]: unknown;
}

export class ShimResponse {
  statusCode = 200;
  headers: Record<string, string> = {};
  body: string | null = null;
  headersSent = false;
  private finish: Array<() => void> = [];
  /** pre streamy (SSE): zavolá sa pri každom res.write */
  onWrite: ((chunk: string) => void) | null = null;
  constructor(private onDone: () => void) {}
  on(event: string, cb: () => void) {
    if (event === 'finish') this.finish.push(cb);
    return this;
  }
  writeHead(status: number, headers?: Record<string, string>) {
    this.statusCode = status;
    Object.assign(this.headers, headers);
    this.headersSent = true;
    return this;
  }
  write(chunk: string) {
    this.onWrite?.(chunk);
    return true;
  }
  status(code: number) {
    this.statusCode = code;
    return this;
  }
  type(t: string) {
    this.headers['content-type'] = t;
    return this;
  }
  json(obj: unknown) {
    if (!this.headers['content-type']) this.type('application/json');
    return this.end(JSON.stringify(obj));
  }
  send(text: string) {
    return this.end(text);
  }
  end(body?: string) {
    if (this.headersSent) return this;
    this.headersSent = true;
    this.body = body ?? null;
    this.onDone();
    for (const cb of this.finish) cb();
    return this;
  }
}

interface Layer {
  method: string | null;
  match: (path: string) => { params: Record<string, string>; rest: string } | null;
  fn: Fn | ShimRouter;
}

function matcher(pattern: string | null, prefix: boolean): Layer['match'] {
  if (pattern === null || pattern === '/') {
    if (prefix) return (path) => ({ params: {}, rest: path });
  }
  const keys: string[] = [];
  const body = (pattern ?? '/')
    .replace(/\/+$/, '')
    .split('/')
    .map((seg) => {
      if (seg.startsWith(':')) {
        keys.push(seg.slice(1));
        return '([^/]+)';
      }
      return seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    })
    .join('/');
  const re = new RegExp(`^${body}${prefix ? '(?=/|$)' : '/?$'}`);
  return (path) => {
    const m = re.exec(path);
    if (!m) return null;
    const params: Record<string, string> = {};
    keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1])));
    return { params, rest: path.slice(m[0].length) || '/' };
  };
}

export class ShimRouter {
  private stack: Layer[] = [];

  use(first: string | Fn | ShimRouter, ...rest: Array<Fn | ShimRouter>) {
    const [path, fns] = typeof first === 'string' ? [first, rest] : [null, [first, ...rest]];
    for (const fn of fns) this.stack.push({ method: null, match: matcher(path, true), fn });
    return this;
  }
  private route(method: string, path: string, fns: Fn[]) {
    for (const fn of fns) this.stack.push({ method, match: matcher(path, false), fn });
    return this;
  }
  get(path: string, ...fns: Fn[]) {
    return this.route('GET', path, fns);
  }
  post(path: string, ...fns: Fn[]) {
    return this.route('POST', path, fns);
  }
  put(path: string, ...fns: Fn[]) {
    return this.route('PUT', path, fns);
  }
  delete(path: string, ...fns: Fn[]) {
    return this.route('DELETE', path, fns);
  }

  handle(req: ShimRequest, res: ShimResponse, out: Next) {
    const basePath = req.path;
    const baseParams = req.params;
    let i = 0;
    const next: Next = (err) => {
      req.path = basePath;
      req.params = baseParams;
      while (i < this.stack.length) {
        const layer = this.stack[i++];
        if (layer.method && layer.method !== req.method) continue;
        const m = layer.match(basePath);
        if (!m) continue;
        const isRouter = layer.fn instanceof ShimRouter;
        const isErrorHandler = !isRouter && (layer.fn as Fn).length === 4;
        if (err !== undefined ? !isErrorHandler : isErrorHandler) continue;
        req.params = { ...baseParams, ...m.params };
        if (isRouter) {
          req.path = m.rest;
          (layer.fn as ShimRouter).handle(req, res, next);
          return;
        }
        try {
          const fn = layer.fn as Fn;
          const r = err !== undefined ? fn(err, req, res, next) : fn(req, res, next);
          if (r && typeof (r as Promise<unknown>).then === 'function') (r as Promise<unknown>).then(undefined, next);
        } catch (e) {
          next(e);
        }
        return;
      }
      out(err);
    };
    next();
  }
}

export interface ShimRequestInit {
  method: string;
  url: string;
  headers?: Record<string, string>;
  body?: string | null;
}

function makeRequest(init: ShimRequestInit, onClose?: (cb: () => void) => void): ShimRequest {
  const u = new URL(init.url, 'http://sandbox.invalid');
  const headers = Object.fromEntries(Object.entries(init.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
  let body: unknown;
  try {
    body = init.body ? JSON.parse(init.body) : undefined;
  } catch {
    body = undefined;
  }
  return {
    method: init.method.toUpperCase(),
    originalUrl: u.pathname + u.search,
    path: u.pathname,
    params: {},
    query: Object.fromEntries(u.searchParams),
    body,
    headers,
    header: (n) => headers[n.toLowerCase()],
    get: (n) => headers[n.toLowerCase()],
    on: (event, cb) => {
      if (event === 'close') onClose?.(cb);
    },
  };
}

/** Otvorí dlhotrvajúcu GET požiadavku (SSE) a odovzdáva zapísané časti; vráti funkciu na zatvorenie. */
export function openStream(app: ShimRouter, url: string, onChunk: (chunk: string) => void): () => void {
  const closers: Array<() => void> = [];
  const req = makeRequest({ method: 'GET', url }, (cb) => closers.push(cb));
  const res = new ShimResponse(() => {});
  res.onWrite = onChunk;
  app.handle(req, res, () => {});
  return () => closers.splice(0).forEach((cb) => cb());
}

/** Spracuje jednu požiadavku ako HTTP server; výsledok je hotová odpoveď. */
export function dispatch(app: ShimRouter, init: ShimRequestInit, signal?: AbortSignal | null): Promise<ShimResponse> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    signal?.addEventListener('abort', () => reject(signal.reason), { once: true });

    const req = makeRequest(init);
    const res = new ShimResponse(() => resolve(res));
    app.handle(req, res, (err) => {
      if (res.headersSent) return;
      if (err !== undefined) {
        console.error(err);
        res.status(500).json({ title: 'Interná chyba servera', status: 500 });
      } else {
        res.status(404).type('text/html').send(`Cannot ${req.method} ${req.path}`);
      }
    });
  });
}

function express() {
  return new ShimRouter();
}
express.Router = () => new ShimRouter();
express.json = () => (_req: ShimRequest, _res: ShimResponse, next: Next) => next();

export default express;
