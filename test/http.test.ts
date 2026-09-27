import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../src/server.js';
import { openDatabase } from '../src/database.js';
import { ObjectRuntime } from '../src/objects/runtime.js';
import { PAGE_TYPE_ID } from '../src/objects/model.js';
import { designAssets } from '../src/ui/assets.js';
import type { ViewConversation, ViewGenerator } from '../src/objects/model.js';

const generator: ViewGenerator = async prompt => ({
  model: 'fixture/contract',
  spec: { title: prompt, blocks: [{ title: 'Pages', component: 'list', sources: [{ typeId: PAGE_TYPE_ID, bindings: {} }] }] },
});

async function app(t: TestContext) {
  const db = openDatabase();
  const objects = new ObjectRuntime(db);
  const server = createApp({ objects, viewGenerator: generator });
  t.after(async () => { await server.stop(true); db.close(); });
  const base = server.url.origin;
  const home = await fetch(base);
  const cookie = home.headers.get('set-cookie')!.split(';')[0]!;
  const markup = await home.text();
  const csrf = /name="csrf" value="([^"]+)"/.exec(markup)![1]!;
  const get = (path: string, headers: Record<string, string> = {}) => fetch(base + path, { headers: { Cookie: cookie, ...headers }, redirect: 'manual' });
  const post = (path: string, fields: Record<string, string>, headers: Record<string, string> = {}) => fetch(base + path, {
    method: 'POST', headers: { Cookie: cookie, Origin: base, ...headers },
    body: new URLSearchParams({ csrf, ...fields }), redirect: 'manual',
  });
  return { base, get, post, cookie, csrf, home, markup, objects, db };
}

test('canonical pages and local assets retain strict browser protections', async t => {
  const a = await app(t);
  assert.equal(a.home.status, 200);
  assert.match(a.home.headers.get('set-cookie')!, /HttpOnly; SameSite=Strict/);
  const csp = a.home.headers.get('content-security-policy')!;
  for (const directive of ["default-src 'none'", "script-src 'self'", "connect-src 'self'", "form-action 'self'", "frame-ancestors 'none'", "base-uri 'none'"]) assert.ok(csp.includes(directive));
  assert.doesNotMatch(csp, /unsafe-inline|unsafe-eval/);
  assert.equal(a.home.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(a.home.headers.get('referrer-policy'), 'same-origin');
  assert.equal(a.home.headers.get('cache-control'), 'no-store');
  for (const [path, contentType] of [
    ['/tokens.css', 'text/css; charset=utf-8'],
    ['/ui.css', 'text/css; charset=utf-8'],
    ['/objects.css', 'text/css; charset=utf-8'],
    ['/writing.css', 'text/css; charset=utf-8'],
    ['/objects-client.js', 'text/javascript; charset=utf-8'],
    ['/writing-client.js', 'text/javascript; charset=utf-8'],
  ] as const) {
    const response = await a.get(path);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), contentType);
    assert.equal(response.headers.get('content-security-policy'), csp);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    await response.arrayBuffer();
  }
});

test('Hearthwood assets are local, explicitly allowlisted, and keep the same security boundary', async t => {
  const a = await app(t);
  const csp = a.home.headers.get('content-security-policy')!;
  assert.ok(csp.includes("img-src 'self'"));
  assert.ok(csp.includes("font-src 'self'"));
  for (const [path, asset] of designAssets) {
    const response = await a.get(path);
    assert.equal(response.status, 200, path);
    assert.equal(response.headers.get('content-type'), asset.type);
    assert.equal(response.headers.get('content-security-policy'), csp);
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    assert.ok((await response.arrayBuffer()).byteLength > 0, path);
    assert.equal((await a.get(path, { Host: 'evil.example' })).status, 403);
  }
  for (const path of ['/balaur/unknown.png', '/balaur/fonts/unknown.ttf', '/balaur/icons/%2e%2e%2f%2e%2e%2f.data/taskdesk.sqlite', '/balaur/../../package.json']) {
    assert.equal((await a.get(path)).status, 404, path);
  }
  const before = a.objects.catalog();
  const specimen = await a.get('/design-system');
  assert.equal(specimen.status, 200);
  assert.equal(specimen.headers.get('content-security-policy'), csp);
  assert.match(await specimen.text(), /Taskdesk UI/);
  assert.deepEqual(a.objects.catalog(), before);
});

test('draft preview uses the safe renderer without saving objects, revisions, or backlinks', async t => {
  const a = await app(t);
  const saved = a.objects.createObject({ typeId: PAGE_TYPE_ID, title: 'Unchanged', properties: {}, body: 'Saved source' });
  const before = a.db.serialize();
  const body = `# Unsaved draft\n\n**bold** [local](/objects/${saved.id}) [safe](https://example.com) [unsafe](javascript:alert)\n\n![inert](https://example.com/image.png)\n\n<script>alert(1)</script>`;
  const response = await a.post('/objects/preview', { body });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.match(response.headers.get('content-security-policy')!, /default-src 'none'/);
  const { html } = await response.json() as { html: string };
  assert.match(html, /<h1>Unsaved draft<\/h1>/);
  assert.match(html, /<strong>bold<\/strong>/);
  assert.ok(html.includes(`href="/objects/${saved.id}"`));
  assert.match(html, /href="https:\/\/example.com"/);
  assert.doesNotMatch(html, /<script|<img|href="javascript:/);
  assert.match(html, /\[Image: inert\]/);
  assert.deepEqual(a.db.serialize(), before);
  assert.deepEqual(a.objects.getObject(saved.id), saved);
  assert.deepEqual(a.objects.backlinks(saved.id).links, []);
  const empty = await a.post('/objects/preview', { body: '' });
  assert.deepEqual(await empty.json(), { html: '' });
});

test('draft preview enforces CSRF, origin, strict fields, and UTF-8 body bounds with explicit JSON errors', async t => {
  const a = await app(t);
  for (const [fields, headers, status] of [
    [{ body: 'draft', csrf: 'wrong' }, {}, 403],
    [{ body: 'draft' }, { Cookie: '' }, 403],
    [{ body: 'draft' }, { Origin: 'https://evil.example' }, 403],
    [{ body: 'draft' }, { 'Sec-Fetch-Site': 'cross-site' }, 403],
    [{ body: 'draft', revision: '1' }, {}, 422],
    [{}, {}, 422],
    [{ body: 'é'.repeat(131_073) }, {}, 422],
    [{ body: 'x'.repeat(1_048_576) }, {}, 413],
  ] as const) {
    const response = await a.post('/objects/preview', fields, headers);
    assert.equal(response.status, status);
    assert.equal(typeof (await response.json() as { error: string }).error, 'string');
  }
  const repeated = await fetch(a.base + '/objects/preview', {
    method: 'POST', headers: { Cookie: a.cookie },
    body: new URLSearchParams([['csrf', a.csrf], ['body', 'one'], ['body', 'two']]),
  });
  assert.equal(repeated.status, 422);
  assert.equal(typeof (await repeated.json() as { error: string }).error, 'string');
  assert.equal((await a.post('/objects/preview', { body: 'é'.repeat(131_072) })).status, 200);
  assert.equal((await a.get('/objects/preview')).status, 404);
  assert.deepEqual(a.objects.listObjects(), []);
});

test('canonical mutations reject missing ownership, CSRF, cross-origin and unexpected fields', async t => {
  const a = await app(t);
  const fields = { name: 'Project' };
  assert.equal((await a.post('/types/create', { ...fields, csrf: 'wrong' })).status, 403);
  assert.equal((await a.post('/types/create', fields, { Cookie: '' })).status, 403);
  assert.equal((await a.post('/types/create', fields, { Cookie: 'taskdesk=unknown' })).status, 403);
  assert.equal((await a.post('/types/create', fields, { Origin: 'https://evil.example' })).status, 403);
  assert.equal((await a.post('/types/create', fields, { 'Sec-Fetch-Site': 'cross-site' })).status, 403);
  assert.equal((await a.post('/types/create', { ...fields, script: 'bad' })).status, 422);
  assert.equal(a.objects.catalog().types.some(type => type.name === fields.name), false);
  assert.equal((await a.post('/types/create', fields)).status, 303);
  assert.equal(a.objects.catalog().types.some(type => type.name === fields.name), true);
  const rejected = await a.post('/views/generate', { prompt: 'Pages', csrf: 'wrong' }, { Accept: 'application/json' });
  assert.equal(rejected.status, 403);
  assert.equal(typeof (await rejected.json() as { error: string }).error, 'string');
});

test('invalid methods, paths, hosts, body types, duplicates and oversized bodies fail closed', async t => {
  const a = await app(t);
  assert.equal((await a.get('/objects/create')).status, 404);
  assert.equal((await a.get('/.data/taskdesk.sqlite')).status, 404);
  assert.equal((await a.get('/', { Host: 'evil.example' })).status, 403);
  const method = await fetch(a.base + '/types/create', { method: 'DELETE' });
  assert.equal(method.status, 405);
  const catalog = a.objects.catalog();
  assert.equal(method.headers.get('allow'), 'GET, POST');
  assert.equal((await fetch(a.base + '/types/create', { method: 'POST', headers: { Cookie: a.cookie, 'Content-Type': 'application/json' }, body: '{}' })).status, 415);
  for (const body of [`csrf=${a.csrf}&name=a&name=b`, `csrf=${a.csrf}&csrf=${a.csrf}&name=a`]) {
    const response = await fetch(a.base + '/types/create', { method: 'POST', headers: { Cookie: a.cookie, 'Content-Type': 'application/x-www-form-urlencoded' }, body });
    assert.equal(response.status, 422);
  }
  assert.equal((await a.post('/types/create', { name: 'x'.repeat(9000) })).status, 413);
  assert.equal((await a.post('/views/generate', { prompt: 'x'.repeat(40_000) })).status, 413);
  assert.equal((await a.post('/objects/create', { title: 'Too large', body: 'x'.repeat(1_048_576) })).status, 413);
  const chunked = await fetch(a.base + '/types/create', {
    method: 'POST', headers: { Cookie: a.cookie, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(`csrf=${a.csrf}&name=`));
        controller.enqueue(new TextEncoder().encode('x'.repeat(9000)));
        controller.close();
      },
    }),
  });
  assert.equal(chunked.status, 413);
  assert.match(chunked.headers.get('content-security-policy')!, /default-src 'none'/);
  assert.deepEqual(a.objects.listObjects(), []);
  assert.deepEqual(a.objects.catalog(), catalog);
});

test('stored object titles and generated view titles cannot inject executable markup', async t => {
  const a = await app(t);
  const title = '<script>alert("injected")</script>';
  const created = await a.post('/objects/create', { title });
  assert.equal(created.status, 303);
  const object = await (await a.get(created.headers.get('location')!)).text();
  assert.ok(!object.includes(title));
  assert.match(object, /&lt;script&gt;/);
  const generated = await a.post('/views/generate', { prompt: title });
  assert.equal(generated.status, 303);
  const view = await (await a.get(generated.headers.get('location')!)).text();
  assert.ok(!view.includes(title));
  assert.match(view, /&lt;script&gt;/);
});

test('retired routes and assets are unavailable and fresh apps create no retired tables', async t => {
  const a = await app(t);
  for (const path of ['/issues', '/issues/new', '/issues/ISS-101', '/workspaces', '/workspaces/00000000-0000-4000-8000-000000000000', '/vault', '/style.css', '/workspace.js', '/fonts/plex.woff2', '/writing-prose.css', '/writing-tables.css']) assert.equal((await a.get(path)).status, 404, path);
  for (const path of ['/workspaces', '/issues/ISS-101/close', '/vault/act', '/workspaces/00000000-0000-4000-8000-000000000000/messages']) assert.equal((await a.post(path, {})).status, 404, path);
  const tables = a.db.query<{ name: string }, []>("SELECT name FROM sqlite_master WHERE type = 'table'").all().map(row => row.name);
  assert.ok(tables.includes('browser_visitors'));
  assert.deepEqual(tables.filter(name => /^(?:browser_(?:schema|imports)|sandbox_issues|workspaces|chat_turns|action_receipts|sdk_entries|vault_.*)$/.test(name)), []);
});

test('existing visitor cookies retain CSRF and private conversation ownership after restart', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'objects-visitors-http-'));
  const file = join(directory, 'workspace.sqlite');
  let db = openDatabase(file);
  const id = 'a'.repeat(64);
  const csrf = 'b'.repeat(64);
  db.exec('CREATE TABLE browser_visitors (id TEXT PRIMARY KEY, csrf TEXT NOT NULL)');
  db.query('INSERT INTO browser_visitors(id, csrf) VALUES (?, ?)').run(id, csrf);
  let server = createApp({ objects: new ObjectRuntime(db), viewGenerator: generator });
  t.after(async () => { await server.stop(true); db.close(); rmSync(directory, { recursive: true, force: true }); });
  const cookie = `other=value; taskdesk=${id}; another=value`;
  const firstHome = await fetch(server.url, { headers: { Cookie: cookie } });
  assert.equal(firstHome.headers.get('set-cookie'), null);
  assert.ok((await firstHome.text()).includes(`name="csrf" value="${csrf}"`));
  const generated = await fetch(new URL('/views/generate', server.url), {
    method: 'POST', headers: { Cookie: cookie, Origin: server.url.origin, Accept: 'application/json' },
    body: new URLSearchParams({ csrf, prompt: 'Original pages' }),
  });
  assert.equal(generated.status, 200);
  const result = await generated.json() as { conversation: ViewConversation };
  await server.stop(true);
  db.close();
  db = openDatabase(file);
  server = createApp({ objects: new ObjectRuntime(db), viewGenerator: generator });
  const restored = await fetch(server.url, { headers: { Cookie: cookie } });
  assert.equal(restored.headers.get('set-cookie'), null);
  assert.ok((await restored.text()).includes(`name="csrf" value="${csrf}"`));
  const path = new URL(`/views/conversations/${result.conversation.id}`, server.url);
  const owned = await fetch(path, { headers: { Cookie: cookie } });
  assert.equal(owned.status, 200);
  assert.deepEqual(await owned.json(), result.conversation);
  assert.equal((await fetch(path)).status, 404);
  const continued = await fetch(new URL('/views/generate', server.url), {
    method: 'POST', headers: { Cookie: cookie, Origin: server.url.origin, Accept: 'application/json' },
    body: new URLSearchParams({ csrf, prompt: 'Refined pages', conversationId: result.conversation.id }),
  });
  assert.equal(continued.status, 200);
  const updated = await continued.json() as { conversation: ViewConversation };
  assert.deepEqual(updated.conversation.turns.map(turn => turn.prompt), ['Original pages', 'Refined pages']);
});
