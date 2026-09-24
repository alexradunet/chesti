import { randomUUID, timingSafeEqual } from 'node:crypto';
import { existsSync } from 'node:fs';
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
import { VaultRuntime } from './vault/runtime.js';
import { mutationFor } from './vault/resources.js';
import { approvalPage, todayPage } from './vault/today.js';

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
    if (!['selected', 'permissions'].includes(key) && fields.getAll(key).length !== 1) throw new AppError(422, 'Repeated form field.');
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

export function createApp(options: { store?: Store; mode?: 'demo' | 'pi'; composer?: Composer; chatRunner?: ChatRunner; vault?: VaultRuntime; port?: number } = {}): Bun.Server<undefined> {
  const db = options.store?.db ?? options.vault?.db ?? openDatabase(process.env.DATABASE_PATH ?? resolvePath('.data/taskdesk.sqlite'));
  const store = options.store ?? new Store(db);
  const mode = options.mode ?? (process.env.COMPOSER === 'pi' ? 'pi' : 'demo');
  db.transaction(() => {
    if (options.vault) store.vault = options.vault;
    else if (!options.store) {
      store.vault = new VaultRuntime(db);
      if (!store.vault.root) {
        const importRoot = process.env.VAULT_ROOT ?? (existsSync(resolvePath('.data/vault')) ? resolvePath('.data/vault') : fileURLToPath(new URL('../examples/life-vault', import.meta.url)));
        store.vault.importRoot(importRoot);
      }
    }
    if (store.vault && store.vault.db !== db) throw new Error('Store and vault must share one database connection.');
    if (!options.store) store.importLegacy(resolvePath('.data/state.json'));
    store.reconcileVaultReceipts();
  })();
  const css = Bun.file(new URL('../public/style.css', import.meta.url));
  const font = Bun.file(new URL('../node_modules/@fontsource-variable/ibm-plex-sans/files/ibm-plex-sans-latin-wght-normal.woff2', import.meta.url));
  const client = Bun.file(new URL('../public/workspace.js', import.meta.url));
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
      const fields = await formBody(req, ['/vault/act', '/vault/approve'].includes(url.pathname) ? 262_144 : url.pathname.endsWith('/messages') ? 32_768 : 8192);
      if (!sameToken(fields.get('csrf'), visitor.csrf)) throw new AppError(403, 'Invalid form token. Reload the page and try again.');
      const conversation = await conversationRoutes(req, url, visitor, fields);
      if (conversation) return conversation;
      if (url.pathname === '/vault/approve') {
        if (!store.vault) throw new AppError(404, 'No vault is configured.');
        const bulk = fields.has('approvals');
        const allowed = bulk ? ['csrf', 'approvals'] : ['csrf', 'app', 'revision', 'permissions'];
        if ([...fields.keys()].some(k => !allowed.includes(k))) throw new AppError(422, 'Unexpected approval field.');
        let approvals: unknown;
        if (bulk) {
          try { approvals = JSON.parse(fields.get('approvals')!); }
          catch { throw new AppError(422, 'Malformed app approvals.'); }
        } else approvals = [{ app: fields.get('app') ?? '', revision: fields.get('revision') ?? '', permissions: fields.getAll('permissions') }];
        store.vault.approve(approvals);
        return redirect('/');
      }
      if (url.pathname === '/vault/act') {
        if (!store.vault) throw new AppError(404, 'No vault is configured.');
        const workspace = workspaceFor(visitor, fields.get('workspace'));
        if (!workspace) throw new AppError(422, 'Vault actions require a persistent workspace.');
        const resource = workspaceResolver(visitor, store)(fields.get('resource') ?? '');
        if (!resource.href.startsWith('/vault/')) throw new AppError(403, 'Not a vault resource.');
        const action = fields.get('action') ?? '';
        const input = Object.fromEntries([...fields].filter(([key]) => !['csrf', 'workspace', 'resource', 'action', 'version', 'definitionRevision'].includes(key)));
        const receipt: Receipt = { id: randomUUID(), source: 'form', resource: resource.href, action, fields: input, version: fields.get('version') ?? '', status: 'pending', message: '', created: new Date().toISOString() };
        workspace.conversation.receipts.push(receipt);
        try {
          receipt.vaultRequest = mutationFor({ ...resource, version: receipt.version }, action, input, receipt.id);
          receipt.vaultRequest.definitionRevision = fields.get('definitionRevision') ?? '';
          executeReceipt(store, visitor, receipt);
        } catch (error) {
          if (!(error instanceof AppError) || receipt.executionStarted) throw error;
          receipt.status = 'failed';
          receipt.message = error.message;
          receipt.errorStatus = error.status;
          store.save();
        }
        if (receipt.status === 'failed') throw new AppError(receipt.errorStatus ?? 409, receipt.message);
        return redirect(`/workspaces/${workspace.id}`);
      }
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
    const resolver = workspaceResolver(visitor, store);
    const conversation = await conversationRoutes(req, url, visitor);
    if (conversation) return conversation;
    if (url.pathname === '/') {
      if (!store.vault) throw new AppError(404, 'No vault is configured. Set VAULT_ROOT when starting the server.');
      let workspace = visitor.workspaces.find(w => w.kind === 'today');
      if (!workspace) {
        workspace = store.workspace(visitor, 'Plan today, finish useful work, and keep a journal.', {
          plan: { title: 'Today', layout: 'stack', blocks: ['/vault/today', '/vault/tasks', '/vault/journal', '/vault/para'].map(resource => ({ resource, view: 'list' })) },
          engine: 'demo', note: 'A persistent workspace over approved vault resources.', inspected: [], elapsedMs: 0,
        });
        workspace.kind = 'today';
        workspace.conversation.engine = mode;
        store.save();
      }
      return html(todayPage(workspace, visitor, store.vault));
    }
    if (url.pathname === '/vault/apps') {
      if (!store.vault) throw new AppError(404, 'No vault is configured.');
      return html(approvalPage(visitor, store.vault));
    }
    if (url.pathname === '/vault' || url.pathname.startsWith('/vault/')) {
      if (!store.vault) throw new AppError(404, 'No vault is configured.');
      const workspace = workspaceFor(visitor, url.searchParams.get('workspace')) ?? visitor.workspaces.find(w => w.kind === 'today');
      const resourceUrl = new URL(url);
      resourceUrl.searchParams.delete('workspace');
      resourceUrl.searchParams.delete('saved');
      const resource = resolver(resourceUrl.pathname + resourceUrl.search);
      return req.headers.get('accept')?.includes('application/vnd.taskdesk.resource+json')
        ? Response.json(resource, { headers: { 'Content-Type': 'application/vnd.taskdesk.resource+json; charset=utf-8' } })
        : html(resourcePage(resource, visitor, workspace));
    }
    if (url.pathname === '/issues/new') return html(issueHome(visitor, mode));
    const workspaceMatch = /^\/workspaces\/([a-f0-9-]{36})$/.exec(url.pathname);
    if (workspaceMatch) {
      const workspace = workspaceFor(visitor, workspaceMatch[1]!)!;
      return html(workspace.kind === 'today' && store.vault ? todayPage(workspace, visitor, store.vault) : workspacePage(workspace, visitor, resolver));
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
      catch (error) { return withHeaders(failure(error), headers); }
    },
    error(error) { return withHeaders(failure(error), new Headers(securityHeaders)); },
  });
}

if (import.meta.main) {
  const port = Number(process.env.PORT ?? 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be between 1 and 65535.');
  const server = createApp({ port });
  console.log(`Taskdesk → ${server.url} (${process.env.COMPOSER === 'pi' ? 'Pi' : 'demo'} default)`);
}
