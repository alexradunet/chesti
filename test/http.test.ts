import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/server.js';
import { openDatabase } from '../src/database.js';
import { ObjectRuntime } from '../src/objects/runtime.js';
import { PAGE_TYPE_ID } from '../src/objects/model.js';
import { designAssets } from '../src/ui/assets.js';
import type { ViewGenerator } from '../src/objects/model.js';

const generator: ViewGenerator = async prompt => ({ model: 'fixture/contract', spec: { title: prompt, blocks: [{ title: 'Pages', component: 'list', sources: [{ typeId: PAGE_TYPE_ID, bindings: {} }] }] } });
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
  const post = (path: string, fields: Record<string, string>, headers: Record<string, string> = {}) => fetch(base + path, { method: 'POST', headers: { Cookie: cookie, Origin: base, ...headers }, body: new URLSearchParams({ csrf, ...fields }), redirect: 'manual' });
  return { base, get, post, cookie, csrf, home, markup, objects, db };
}

test('canonical pages and local assets retain strict browser protections', async t => {
  const a = await app(t);
  assert.equal(a.home.status, 200);
  assert.match(a.home.headers.get('set-cookie')!, /HttpOnly; SameSite=Strict/);
  const csp = a.home.headers.get('content-security-policy')!;
  for (const directive of ["default-src 'none'", "script-src 'self'", "connect-src 'self'", "form-action 'self'", "frame-ancestors 'none'", "base-uri 'none'"]) assert.ok(csp.includes(directive));
  for (const [path, contentType] of [['/tokens.css', 'text/css; charset=utf-8'], ['/ui.css', 'text/css; charset=utf-8'], ['/objects.css', 'text/css; charset=utf-8'], ['/objects-client.js', 'text/javascript; charset=utf-8']] as const) {
    const response = await a.get(path);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), contentType);
  }
});

test('Hearthwood assets are local and allowlisted', async t => {
  const a = await app(t);
  for (const [path, asset] of designAssets) {
    const response = await a.get(path);
    assert.equal(response.status, 200, path);
    assert.equal(response.headers.get('content-type'), asset.type);
  }
  assert.equal((await a.get('/balaur/unknown.png')).status, 404);
});

test('draft preview uses safe renderer without saving objects', async t => {
  const a = await app(t);
  const saved = a.objects.createObject({ typeId: PAGE_TYPE_ID, title: 'Unchanged', properties: {}, body: 'Saved source' });
  const response = await a.post('/objects/preview', { body: `# Draft\n\n[local](/objects/${saved.id}) <script>x</script>` });
  assert.equal(response.status, 200);
  const { html } = await response.json() as { html: string };
  assert.match(html, /<h1>Draft<\/h1>/);
  assert.doesNotMatch(html, /<script/);
  assert.deepEqual(a.objects.getObject(saved.id), saved);
});

test('retired schema mutation route is not writable', async t => {
  const a = await app(t);
  const response = await a.post('/types/create', { name: 'Custom' });
  assert.equal(response.status, 404);
  assert.equal(a.objects.catalog().types.length, 4);
});
