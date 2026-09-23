import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import { pathToFileURL } from 'node:url';
import { AppError, validatePlan } from './core.js';
import { createComposer, type Composer } from './composer.js';
import { issueResolver } from './issues.js';
import { executeReceipt, workspaceResolver, type ChatRunner } from './conversation.js';
import { createConversationRoutes } from './chat-http.js';
import { errorPage, home, resourcePage, workspacePage } from './render.js';
import { Store, type Receipt, type Visitor, type Workspace } from './store.js';
import { VaultRuntime } from './vault/runtime.js';
import { mutationFor } from './vault/resources.js';
import { approvalPage, todayPage } from './vault/today.js';

function cookieId(req: IncomingMessage): string | undefined {
  return req.headers.cookie?.split(';').map(c => c.trim()).find(c => c.startsWith('taskdesk='))?.slice(9);
}
function sameToken(actual: string | null, expected: string): boolean {
  const a = Buffer.from(actual ?? '');
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
async function formBody(req: IncomingMessage, limit = 8192): Promise<URLSearchParams> {
  if (req.headers['content-type']?.split(';')[0] !== 'application/x-www-form-urlencoded') throw new AppError(415, 'Submit a standard HTML form.');
  if (Number(req.headers['content-length'] ?? 0) > limit) throw new AppError(413, 'Form too large.');
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new AppError(413, 'Form too large.');
    chunks.push(Buffer.from(chunk));
  }
  const fields = new URLSearchParams(Buffer.concat(chunks).toString('utf8'));
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
function html(res: ServerResponse, content: string, status = 200) {
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(content);
}
function redirect(res: ServerResponse, location: string) {
  res.writeHead(303, { Location: location });
  res.end();
}

export function createApp(options: { store?: Store; mode?: 'demo' | 'pi'; composer?: Composer; chatRunner?: ChatRunner; vault?: VaultRuntime } = {}) {
  const store = options.store ?? new Store(resolvePath('.data/state.json'));
  const mode = options.mode ?? (process.env.COMPOSER === 'pi' ? 'pi' : 'demo');
  if (options.vault) store.vault = options.vault;
  else if (!options.store) {
    const root = process.env.VAULT_ROOT ?? resolvePath('.data/vault');
    if (!process.env.VAULT_ROOT && !existsSync(root)) {
      mkdirSync(resolvePath('.data'), { recursive: true, mode: 0o700 });
      cpSync(new URL('../examples/life-vault', import.meta.url), root, { recursive: true, errorOnExist: true, force: false });
    }
    store.vault = new VaultRuntime(root);
  }
  store.reconcileVaultReceipts();
  const css = readFileSync(new URL('../public/style.css', import.meta.url));
  const font = readFileSync(new URL('../node_modules/@fontsource-variable/ibm-plex-sans/files/ibm-plex-sans-latin-wght-normal.woff2', import.meta.url));
  const client = readFileSync(new URL('../public/workspace.js', import.meta.url));
  const conversationRoutes = createConversationRoutes(store, options.chatRunner);
  let composing = false;
  const server = createServer(async (req, res) => {
    res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self'; connect-src 'self'; style-src 'self'; font-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'; object-src 'none'");
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Vary', 'Cookie, Accept');
    try {
      // Bind to loopback and reject unrecognized hosts to reduce DNS-rebinding risk.
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 3000;
      const hosts = new Set([`localhost:${port}`, `127.0.0.1:${port}`]);
      const host = req.headers.host ?? '';
      if (!hosts.has(host)) throw new AppError(403, 'Use the local Taskdesk address.');
      const url = new URL(req.url ?? '/', `http://${host}`);
      if (url.host !== host) throw new AppError(403, 'Unexpected request target.');
      if (!['GET', 'POST'].includes(req.method ?? '')) {
        res.setHeader('Allow', 'GET, POST');
        throw new AppError(405, 'Use a link or a form.');
      }
      if (req.method === 'GET' && (url.pathname === '/style.css' || url.pathname === '/fonts/plex.woff2' || url.pathname === '/workspace.js')) {
        const stylesheet = url.pathname === '/style.css';
        const javascript = url.pathname === '/workspace.js';
        res.writeHead(200, { 'Content-Type': stylesheet ? 'text/css; charset=utf-8' : javascript ? 'text/javascript; charset=utf-8' : 'font/woff2', 'Cache-Control': 'no-cache' });
        res.end(stylesheet ? css : javascript ? client : font);
        return;
      }
      let visitor = store.get(cookieId(req));
      if (req.method === 'POST') {
        if (!visitor) throw new AppError(403, 'Open the desk before submitting a form.');
        if (req.headers.origin && req.headers.origin !== `http://${host}`) throw new AppError(403, 'Cross-origin submissions are not allowed.');
        if (req.headers['sec-fetch-site'] === 'cross-site') throw new AppError(403, 'Cross-site submissions are not allowed.');
        const fields = await formBody(req, url.pathname === '/vault/act' ? 262_144 : url.pathname.endsWith('/messages') ? 32_768 : 8192);
        if (!sameToken(fields.get('csrf'), visitor.csrf)) throw new AppError(403, 'Invalid form token. Reload the page and try again.');
        if (await conversationRoutes(req, res, url, visitor, fields)) return;
        if (url.pathname === '/vault/approve') {
          if (!store.vault) throw new AppError(404, 'No vault is configured.');
          if ([...fields.keys()].some(k => !['csrf', 'app', 'revision', 'permissions'].includes(k))) throw new AppError(422, 'Unexpected approval field.');
          store.vault.approve(fields.get('app') ?? '', fields.get('revision') ?? '', fields.getAll('permissions'));
          redirect(res, '/today');
          return;
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
          redirect(res, `/workspaces/${workspace.id}`);
          return;
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
            redirect(res, `/workspaces/${workspace.id}`);
          } finally { composing = false; }
          return;
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
        redirect(res, `/issues/${mutation[1]}?saved=1${workspace ? `&workspace=${workspace.id}` : ''}`);
        return;
      }
      if (!visitor) {
        visitor = store.create();
        res.setHeader('Set-Cookie', `taskdesk=${visitor.id}; Path=/; HttpOnly; SameSite=Strict; Max-Age=2592000`);
      }
      const resolver = workspaceResolver(visitor, store);
      if (await conversationRoutes(req, res, url, visitor)) return;
      if (url.pathname === '/today') {
        if (!store.vault) throw new AppError(404, 'No vault is configured. Set VAULT_ROOT when starting the server.');
        let workspace = visitor.workspaces.find(w => w.kind === 'today');
        if (!workspace) {
          workspace = store.workspace(visitor, 'Plan today, finish useful work, and keep a Markdown journal.', {
            plan: { title: 'Today', layout: 'stack', blocks: ['/vault/today', '/vault/tasks', '/vault/journal', '/vault/para'].map(resource => ({ resource, view: 'list' })) },
            engine: 'demo', note: 'A persistent workspace over approved Markdown vault resources.', inspected: [], elapsedMs: 0,
          });
          workspace.kind = 'today';
          workspace.conversation.engine = mode;
          store.save();
        }
        redirect(res, `/workspaces/${workspace.id}`);
        return;
      }
      if (url.pathname === '/vault/apps') {
        if (!store.vault) throw new AppError(404, 'No vault is configured.');
        html(res, approvalPage(visitor, store.vault)); return;
      }
      if (url.pathname === '/vault' || url.pathname.startsWith('/vault/')) {
        if (!store.vault) throw new AppError(404, 'No vault is configured.');
        const workspace = workspaceFor(visitor, url.searchParams.get('workspace')) ?? visitor.workspaces.find(w => w.kind === 'today');
        const resourceUrl = new URL(url);
        resourceUrl.searchParams.delete('workspace');
        resourceUrl.searchParams.delete('saved');
        const resource = resolver(resourceUrl.pathname + resourceUrl.search);
        if (req.headers.accept?.includes('application/vnd.taskdesk.resource+json')) {
          res.writeHead(200, { 'Content-Type': 'application/vnd.taskdesk.resource+json; charset=utf-8' });
          res.end(JSON.stringify(resource));
        } else html(res, resourcePage(resource, visitor, workspace));
        return;
      }
      if (url.pathname === '/') { html(res, home(visitor, mode)); return; }
      const workspaceMatch = /^\/workspaces\/([a-f0-9-]{36})$/.exec(url.pathname);
      if (workspaceMatch) {
        const workspace = workspaceFor(visitor, workspaceMatch[1]!)!;
        html(res, workspace.kind === 'today' && store.vault ? todayPage(workspace, visitor, store.vault) : workspacePage(workspace, visitor, resolver));
        return;
      }
      if (url.pathname === '/issues' || /^\/issues\/ISS-\d+$/.test(url.pathname)) {
        const workspace = workspaceFor(visitor, url.searchParams.get('workspace'));
        const ref = url.pathname + (url.pathname === '/issues' && url.searchParams.has('scope') ? `?scope=${url.searchParams.get('scope')}` : '');
        const resource = resolver(ref);
        // One resource, two representations. No separate RPC API for the agent.
        if (req.headers.accept?.includes('application/vnd.taskdesk.resource+json')) {
          res.writeHead(200, { 'Content-Type': 'application/vnd.taskdesk.resource+json; charset=utf-8' });
          res.end(JSON.stringify(resource));
        } else html(res, resourcePage(resource, visitor, workspace, url.searchParams.get('saved') === '1'));
        return;
      }
      throw new AppError(404, 'Page not found.');
    } catch (error) {
      const known = error instanceof AppError;
      if (!known) console.error('Request failed:', error);
      if (!res.headersSent) html(res, errorPage(known ? error.status : 500, known ? error.message : 'An unexpected error occurred. See the local server log.'), known ? error.status : 500);
      else res.end();
    }
  });
  server.requestTimeout = 60_000;
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolvePath(process.argv[1])).href) {
  const port = Number(process.env.PORT ?? 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be between 1 and 65535.');
  createApp().listen(port, '127.0.0.1', () => console.log(`Taskdesk → http://127.0.0.1:${port} (${process.env.COMPOSER === 'pi' ? 'Pi' : 'demo'} default)`));
}
