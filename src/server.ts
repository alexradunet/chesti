import { timingSafeEqual } from 'node:crypto';
import { resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AppError } from './core.js';
import { VisitorStore } from './visitors.js';
import type { ObjectRuntime } from './objects/runtime.js';
import { openWorkspace } from './objects/workspace.js';
import { createObjectRoutes } from './objects/http.js';
import type { ViewGenerator } from './objects/model.js';

const securityHeaders = {
  'Content-Security-Policy': "default-src 'none'; script-src 'self'; connect-src 'self'; style-src 'self'; font-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'; object-src 'none'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'same-origin',
  'Cache-Control': 'no-store',
  Vary: 'Cookie, Accept',
};

function sameToken(actual: string | null, expected: string): boolean {
  const a = Buffer.from(actual ?? '');
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
async function formBody(req: Request, limit = 8192): Promise<URLSearchParams> {
  if (req.headers.get('content-type')?.split(';')[0] !== 'application/x-www-form-urlencoded') throw new AppError(415, 'Submit a standard HTML form.');
  if (Number(req.headers.get('content-length') ?? 0) > limit) throw new AppError(413, 'Form too large.');
  const chunks: Uint8Array[] = [];
  let size = 0;
  const reader = req.body?.getReader();
  if (reader) {
    try {
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        size += chunk.value.byteLength;
        if (size > limit) {
          await reader.cancel();
          throw new AppError(413, 'Form too large.');
        }
        chunks.push(chunk.value);
      }
    } finally { reader.releaseLock(); }
  }
  const fields = new URLSearchParams(Buffer.concat(chunks, size).toString('utf8'));
  for (const key of fields.keys()) {
    if (!/^(?:draft:)?p:[a-f0-9-]{36}$/.test(key) && fields.getAll(key).length !== 1) throw new AppError(422, 'Repeated form field.');
  }
  return fields;
}
function failure(error: unknown): Response {
  const known = error instanceof AppError;
  if (!known) console.error('Request failed:', error);
  const status = known ? error.status : 500;
  const message = Bun.escapeHTML(known ? error.message : 'An unexpected error occurred. See the local server log.');
  return new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${status} · Taskdesk</title></head><body><main><h1>${status}</h1><p>${message}</p><a href="/">Return to Taskdesk</a></main></body></html>`, { status, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}
function withHeaders(response: Response, headers: Headers): Response {
  for (const [name, value] of headers) if (!response.headers.has(name)) response.headers.set(name, value);
  return response;
}

export function createApp(options: { objects?: ObjectRuntime; viewGenerator?: ViewGenerator; port?: number } = {}): Bun.Server<undefined> {
  const objects = options.objects ?? openWorkspace(process.env.DATABASE_PATH ?? resolvePath('.data/taskdesk.sqlite'));
  const visitors = new VisitorStore(objects.db);
  const objectRoutes = createObjectRoutes(objects, options.viewGenerator);
  let objectClient: Promise<Bun.BuildOutput> | undefined;
  const tokensCss = Bun.file(new URL('../public/tokens.css', import.meta.url));
  const objectCss = Bun.file(new URL('../public/objects.css', import.meta.url));
  const handle = async (req: Request, server: Bun.Server<undefined>, headers: Headers): Promise<Response> => {
    // Bind to loopback and reject unrecognized hosts to reduce DNS-rebinding risk.
    const host = req.headers.get('host') ?? '';
    if (host !== `localhost:${server.port}` && host !== `127.0.0.1:${server.port}`) throw new AppError(403, 'Use the local Taskdesk address.');
    const url = new URL(req.url);
    if (url.host !== host || url.protocol !== 'http:') throw new AppError(403, 'Unexpected request target.');
    if (!['GET', 'POST'].includes(req.method)) {
      headers.set('Allow', 'GET, POST');
      throw new AppError(405, 'Use a link or a form.');
    }
    if (req.method === 'GET' && url.pathname === '/tokens.css') return new Response(tokensCss, { headers: { 'Content-Type': 'text/css; charset=utf-8' } });
    if (req.method === 'GET' && url.pathname === '/objects.css') return new Response(objectCss, { headers: { 'Content-Type': 'text/css; charset=utf-8' } });
    if (req.method === 'GET' && url.pathname === '/objects-client.js') {
      objectClient ??= Bun.build({ entrypoints: [fileURLToPath(new URL('./objects/client.ts', import.meta.url))], target: 'browser', minify: true });
      const build = await objectClient;
      if (!build.success || !build.outputs[0]) {
        objectClient = undefined;
        console.error('Object editor bundle failed:', build.logs);
        throw new AppError(500, 'The writing editor could not load. The native editor is still available.');
      }
      return new Response(build.outputs[0], { headers: { 'Content-Type': 'text/javascript; charset=utf-8' } });
    }
    let visitor = visitors.get(new Bun.CookieMap(req.headers.get('cookie') ?? '').get('taskdesk') ?? undefined);
    if (req.method === 'POST') {
      if (!visitor) throw new AppError(403, 'Open the desk before submitting a form.');
      const origin = req.headers.get('origin');
      if (origin && origin !== `http://${host}`) throw new AppError(403, 'Cross-origin submissions are not allowed.');
      if (req.headers.get('sec-fetch-site') === 'cross-site') throw new AppError(403, 'Cross-site submissions are not allowed.');
      const fields = await formBody(req, url.pathname.startsWith('/objects/') ? 1_048_576 : url.pathname === '/views/generate' ? 32_768 : 8192);
      if (!sameToken(fields.get('csrf'), visitor.csrf)) throw new AppError(403, 'Invalid form token. Reload the page and try again.');
      const objectResponse = await objectRoutes(req, url, visitor, fields);
      if (objectResponse) return objectResponse;
      throw new AppError(404, 'Action not found.');
    }
    if (!visitor) {
      visitor = visitors.create();
      headers.set('Set-Cookie', `taskdesk=${visitor.id}; Path=/; HttpOnly; SameSite=Strict; Max-Age=2592000`);
    }
    const objectResponse = await objectRoutes(req, url, visitor);
    if (objectResponse) return objectResponse;
    throw new AppError(404, 'Page not found.');
  };
  return Bun.serve({
    port: options.port ?? 0,
    hostname: '127.0.0.1',
    development: false,
    idleTimeout: 65,
    // Enforce route-specific limits while reading, so rejected forms use our secured error pages.
    maxRequestBodySize: Number.MAX_SAFE_INTEGER,
    async fetch(req, server) {
      const headers = new Headers(securityHeaders);
      try { return withHeaders(await handle(req, server, headers), headers); }
      catch (error) {
        const path = new URL(req.url).pathname;
        if (path === '/objects/lookup' || (req.headers.get('accept')?.includes('application/json') && (path === '/views/generate' || path.startsWith('/views/conversations/')))) {
          const known = error instanceof AppError;
          if (!known) console.error('Request failed:', error);
          return withHeaders(Response.json({ error: known ? error.message : 'An unexpected error occurred. See the local server log.' }, { status: known ? error.status : 500 }), headers);
        }
        return withHeaders(failure(error), headers);
      }
    },
    error(error) { return withHeaders(failure(error), new Headers(securityHeaders)); },
  });
}

if (import.meta.main) {
  const port = Number(process.env.PORT ?? 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be between 1 and 65535.');
  const server = createApp({ port });
  console.log(`Taskdesk → ${server.url} (objects · AI-authored views)`);
}
