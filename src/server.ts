import { randomUUID, timingSafeEqual } from 'node:crypto';
import { resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AppError, validatePlan } from './core.js';
import { createComposer } from './composer.js';
import type { Composer } from './composer.js';
import { issueResolver } from './issues.js';
import { executeReceipt, workspaceResolver } from './conversation.js';
import type { ChatRunner } from './conversation.js';
import { createConversationRoutes } from './chat-http.js';
import { openDatabase } from './database.js';
import { errorPage, issueHome, resourcePage, workspacePage } from './render.js';
import { Store } from './store.js';
import type { Receipt, Visitor, Workspace } from './store.js';
import { ObjectRuntime } from './objects/runtime.js';
import { createObjectRoutes } from './objects/http.js';
import type { ViewGenerator } from './objects/model.js';

const securityHeaders = {
  'Content-Security-Policy': "default-src 'none'; script-src 'self'; connect-src 'self'; style-src 'self'; font-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'; object-src 'none'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'same-origin',
  'Cache-Control': 'no-store',
  Vary: 'Cookie, Accept',
};

function cookieId(req: Request): string | undefined {
  return req.headers.get('cookie')?.split(';').map(c => c.trim()).find(c => c.startsWith('taskdesk='))?.slice(9);
}
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
    if (!['selected', 'permissions'].includes(key) && !/^p:[a-f0-9-]{36}$/.test(key) && fields.getAll(key).length !== 1) throw new AppError(422, 'Repeated form field.');
  }
  return fields;
}
function workspaceFor(visitor: Visitor, id: string | null): Workspace | undefined {
  if (!id) return;
  const workspace = visitor.workspaces.find(w => w.id === id);
  if (!workspace) throw new AppError(404, 'Workspace not found in this browser sandbox.');
  return workspace;
}
function html(content: string, status = 200): Response {
  return new Response(content, { status, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}
function redirect(location: string): Response {
  return new Response(null, { status: 303, headers: { Location: location } });
}
function failure(error: unknown): Response {
  const known = error instanceof AppError;
  if (!known) console.error('Request failed:', error);
  const status = known ? error.status : 500;
  return html(errorPage(status, known ? error.message : 'An unexpected error occurred. See the local server log.'), status);
}
function withHeaders(response: Response, headers: Headers): Response {
  for (const [name, value] of headers) if (!response.headers.has(name)) response.headers.set(name, value);
  return response;
}

export function createApp(options: { store?: Store; mode?: 'demo' | 'pi'; composer?: Composer; chatRunner?: ChatRunner; objects?: ObjectRuntime; viewGenerator?: ViewGenerator; port?: number } = {}): Bun.Server<undefined> {
  const db = options.store?.db ?? options.objects?.db ?? openDatabase(process.env.DATABASE_PATH ?? resolvePath('.data/taskdesk.sqlite'));
  const store = options.store ?? new Store(db);
  const objects = options.objects ?? new ObjectRuntime(db);
  if (objects.db !== db) throw new Error('Objects and browser state must share one database connection.');
  const objectRoutes = createObjectRoutes(objects, options.viewGenerator);
  const mode = options.mode ?? (process.env.COMPOSER === 'pi' ? 'pi' : 'demo');
  let objectClient: Promise<Bun.BuildOutput> | undefined;
  const css = Bun.file(new URL('../public/style.css', import.meta.url));
  const font = Bun.file(new URL('../node_modules/@fontsource-variable/ibm-plex-sans/files/ibm-plex-sans-latin-wght-normal.woff2', import.meta.url));
  const client = Bun.file(new URL('../public/workspace.js', import.meta.url));
  const objectCss = Bun.file(new URL('../public/objects.css', import.meta.url));
  const conversationRoutes = createConversationRoutes(store, options.chatRunner);
  let composing = false;
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
    if (req.method === 'GET' && (url.pathname === '/style.css' || url.pathname === '/fonts/plex.woff2' || url.pathname === '/workspace.js')) {
      const stylesheet = url.pathname === '/style.css';
      const javascript = url.pathname === '/workspace.js';
      return new Response(stylesheet ? css : javascript ? client : font, { headers: { 'Content-Type': stylesheet ? 'text/css; charset=utf-8' : javascript ? 'text/javascript; charset=utf-8' : 'font/woff2', 'Cache-Control': 'no-cache' } });
    }
    let visitor = store.get(cookieId(req));
    if (req.method === 'POST') {
      if (!visitor) throw new AppError(403, 'Open the desk before submitting a form.');
      const origin = req.headers.get('origin');
      if (origin && origin !== `http://${host}`) throw new AppError(403, 'Cross-origin submissions are not allowed.');
      if (req.headers.get('sec-fetch-site') === 'cross-site') throw new AppError(403, 'Cross-site submissions are not allowed.');
      const fields = await formBody(req, url.pathname.startsWith('/objects/') ? 1_048_576 : url.pathname.endsWith('/messages') || url.pathname === '/views/generate' ? 32_768 : 8192);
      if (!sameToken(fields.get('csrf'), visitor.csrf)) throw new AppError(403, 'Invalid form token. Reload the page and try again.');
      const objectResponse = await objectRoutes(req, url, visitor, fields);
      if (objectResponse) return objectResponse;
      const conversation = await conversationRoutes(req, url, visitor, fields);
      if (conversation) return conversation;
      if (url.pathname === '/workspaces') {
        if ([...fields.keys()].some(k => !['csrf', 'task', 'engine'].includes(k))) throw new AppError(422, 'Unexpected form field.');
        const task = fields.get('task')?.trim() ?? '';
        const engine = fields.get('engine');
        if (!task || task.length > 500) throw new AppError(422, 'Describe your task in 1–500 characters.');
        if (engine !== 'demo' && engine !== 'pi') throw new AppError(422, 'Choose a supported composer.');
        if (composing) throw new AppError(429, 'A workspace is already being composed. Please try again shortly.');
        if (visitor.workspaces.length >= 50) throw new AppError(429, 'This local sandbox has reached its 50-workspace limit.');
        composing = true;
        try {
          const resolver = issueResolver(visitor.issues);
          const composition = await (options.composer ?? createComposer(engine))(task, resolver);
          // Validate again at the HTTP boundary; never trust a composer adapter.
          composition.plan = validatePlan(composition.plan, resolver, new Set(composition.inspected));
          const workspace = store.workspace(visitor, task, composition);
          workspace.conversation.engine = engine;
          store.save();
          return redirect(`/workspaces/${workspace.id}`);
        } finally { composing = false; }
      }
      const mutation = /^\/issues\/(ISS-\d+)\/(assign|prioritize|start|close|reopen)$/.exec(url.pathname);
      if (!mutation) throw new AppError(404, 'Action not found.');
      const workspace = workspaceFor(visitor, fields.get('workspace'));
      const version = Number(fields.get('version'));
      if (!Number.isSafeInteger(version) || version < 1 || fields.get('version') !== String(version)) throw new AppError(422, 'Invalid resource version.');
      const receipt: Receipt = { id: randomUUID(), source: 'form', resource: `/issues/${mutation[1]}`, action: mutation[2]!, fields: Object.fromEntries([...fields].filter(([k]) => !['csrf', 'version', 'workspace'].includes(k))), version, status: 'pending', message: '', created: new Date().toISOString() };
      workspace?.conversation.receipts.push(receipt);
      try { executeReceipt(store, visitor, receipt); } catch (error) { workspace?.conversation.receipts.pop(); throw error; }
      if (receipt.status === 'failed') throw new AppError(receipt.errorStatus ?? 409, receipt.message);
      return redirect(`/issues/${mutation[1]}?saved=1${workspace ? `&workspace=${workspace.id}` : ''}`);
    }
    if (!visitor) {
      visitor = store.create();
      headers.set('Set-Cookie', `taskdesk=${visitor.id}; Path=/; HttpOnly; SameSite=Strict; Max-Age=2592000`);
    }
    const objectResponse = await objectRoutes(req, url, visitor);
    if (objectResponse) return objectResponse;
    const resolver = workspaceResolver(visitor, store);
    const conversation = await conversationRoutes(req, url, visitor);
    if (conversation) return conversation;
    if (url.pathname === '/issues/new') return html(issueHome(visitor, mode));
    const workspaceMatch = /^\/workspaces\/([a-f0-9-]{36})$/.exec(url.pathname);
    if (workspaceMatch) {
      const workspace = workspaceFor(visitor, workspaceMatch[1]!)!;
      if (workspace.kind === 'today') throw new AppError(410, 'This app-owned workspace has been replaced by the object workspace. Your records are available from home.');
      return html(workspacePage(workspace, visitor, resolver));
    }
    if (url.pathname === '/issues' || /^\/issues\/ISS-\d+$/.test(url.pathname)) {
      const workspace = workspaceFor(visitor, url.searchParams.get('workspace'));
      const ref = url.pathname + (url.pathname === '/issues' && url.searchParams.has('scope') ? `?scope=${url.searchParams.get('scope')}` : '');
      const resource = resolver(ref);
      // One resource, two representations. No separate RPC API for the agent.
      return req.headers.get('accept')?.includes('application/vnd.taskdesk.resource+json')
        ? Response.json(resource, { headers: { 'Content-Type': 'application/vnd.taskdesk.resource+json; charset=utf-8' } })
        : html(resourcePage(resource, visitor, workspace, url.searchParams.get('saved') === '1'));
    }
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
        if (req.headers.get('accept')?.includes('application/json') && (path === '/views/generate' || path.startsWith('/views/conversations/'))) {
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
