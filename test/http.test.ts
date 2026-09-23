import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { get as httpGet } from 'node:http';
import { createApp } from '../src/server.js';
import { Store } from '../src/store.js';
import { demoComposition, type Composer } from '../src/composer.js';
import type { Resource } from '../src/core.js';

async function app(t: TestContext, composer?: Composer) {
  let compositions = 0;
  const server = createApp({ store: new Store(), mode: 'demo', composer: composer ?? (async (task, resolve) => { compositions++; return demoComposition(task, resolve); }) });
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
  t.after(() => new Promise<void>((done, reject) => { server.close(error => error ? reject(error) : done()); server.closeAllConnections(); }));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}`;
  const home = await fetch(base);
  const cookie = home.headers.get('set-cookie')!.split(';')[0]!;
  const markup = await home.text();
  const csrf = /name="csrf" value="([^"]+)"/.exec(markup)![1]!;
  const get = (path: string, headers: Record<string, string> = {}) => fetch(base + path, { headers: { Cookie: cookie, ...headers }, redirect: 'manual' });
  const post = (path: string, fields: Record<string, string>, headers: Record<string, string> = {}) => fetch(base + path, {
    method: 'POST', headers: { Cookie: cookie, Origin: base, ...headers },
    body: new URLSearchParams({ csrf, ...fields }), redirect: 'manual',
  });
  return { base, get, post, cookie, csrf, home, markup, count: () => compositions };
}

test('native page shell, strict CSP, local assets and no browser JavaScript', async t => {
  const a = await app(t);
  assert.match(a.markup, /method="post" action="\/workspaces"/);
  assert.match(a.markup, /DETERMINISTIC|Deterministic/);
  assert.doesNotMatch(a.markup, /<script|onclick=/i);
  assert.match(a.home.headers.get('content-security-policy')!, /default-src 'none'/);
  assert.match(a.home.headers.get('set-cookie')!, /HttpOnly; SameSite=Strict/);
  const css = await a.get('/style.css');
  assert.equal(css.status, 200);
  assert.match(await css.text(), /@view-transition/);
  const font = await a.get('/fonts/plex.woff2');
  assert.equal(font.headers.get('content-type'), 'font/woff2');
  assert.ok((await font.arrayBuffer()).byteLength > 1000);
});

test('create → refresh → native mutation → refreshed workspace never recomposes', async t => {
  const a = await app(t);
  const created = await a.post('/workspaces', { engine: 'demo', task: 'Help me triage issues' });
  assert.equal(created.status, 303);
  const location = created.headers.get('location')!;
  const id = location.split('/').at(-1)!;
  const workspace = await a.get(location);
  const html = await workspace.text();
  assert.match(html, /DEMO · NO AI/);
  assert.match(html, /Triage queue/);
  assert.equal(a.count(), 1);
  assert.equal((await a.get(location)).status, 200);
  assert.equal(a.count(), 1);
  const record = await a.get(`/issues/ISS-101?workspace=${id}`);
  const recordHtml = await record.text();
  assert.match(recordHtml, new RegExp(`href="/workspaces/${id}"`));
  const assigned = await a.post('/issues/ISS-101/assign', { version: '1', owner: 'alex', workspace: id });
  assert.equal(assigned.status, 303);
  assert.match(assigned.headers.get('location')!, /saved=1/);
  const refreshed = await (await a.get(location)).text();
  assert.match(refreshed, /Alex \(you\)/);
  const closed = await a.post('/issues/ISS-101/close', { version: '2', workspace: id });
  assert.equal(closed.status, 303);
  const after = await (await a.get(location)).text();
  assert.doesNotMatch(after, /action="\/issues\/ISS-101\/close"/);
  assert.match(after, /action="\/issues\/ISS-101\/reopen"/);
  assert.equal(a.count(), 1);
  const stale = await a.post('/issues/ISS-101/reopen', { version: '2' });
  assert.equal(stale.status, 409);
});

test('same resource exposes discoverable links and actions via content negotiation', async t => {
  const a = await app(t);
  const headers = { Accept: 'application/vnd.taskdesk.resource+json' };
  const root = await a.get('/issues', headers);
  assert.match(root.headers.get('content-type')!, /vnd.taskdesk.resource\+json/);
  const resource = await root.json() as Resource;
  const triage = resource.links.find(l => l.rel === 'triage')!;
  const queue = await (await a.get(triage.href, headers)).json() as Resource;
  const issue = await (await a.get(queue.items![0]!.href, headers)).json() as Resource;
  const start = issue.actions.find(action => action.id === 'start')!;
  assert.equal(start.method, 'post');
  assert.ok(issue.version);
  assert.equal((await a.post(start.href, { version: String(issue.version) })).status, 303);
  const updated = await (await a.get(issue.href, headers)).json() as Resource;
  assert.equal(updated.facts.Status, 'In progress');
  assert.ok(!updated.actions.some(action => action.id === 'start'));
  assert.doesNotMatch(JSON.stringify(updated), /csrf|taskdesk=/);
  assert.equal(a.count(), 0);
});

test('CSRF, cross-origin, invalid fields and foreign workspace are rejected', async t => {
  const a = await app(t);
  const params = { engine: 'demo', task: 'triage' };
  assert.equal((await a.post('/workspaces', { ...params, csrf: 'wrong' })).status, 403);
  assert.equal((await a.post('/workspaces', params, { Origin: 'https://evil.example' })).status, 403);
  assert.equal((await a.post('/workspaces', params, { 'Sec-Fetch-Site': 'cross-site' })).status, 403);
  assert.equal((await a.post('/workspaces', { ...params, engine: 'invented' })).status, 422);
  assert.equal((await a.post('/workspaces', { ...params, task: 'x'.repeat(501) })).status, 422);
  assert.equal((await a.post('/issues/ISS-101/assign', { version: '1', owner: 'root' })).status, 422);
  assert.equal((await a.post('/issues/ISS-101/assign', { version: '1', owner: 'alex', script: 'bad' })).status, 422);
  const created = await a.post('/workspaces', params);
  const path = created.headers.get('location')!;
  const stranger = await fetch(a.base + path);
  assert.equal(stranger.status, 404);
  const strangerCookie = stranger.headers.get('set-cookie')!.split(';')[0]!;
  const strangerHome = await (await fetch(a.base, { headers: { Cookie: strangerCookie } })).text();
  const strangerCsrf = /name="csrf" value="([^"]+)"/.exec(strangerHome)![1]!;
  const foreign = await fetch(a.base + '/issues/ISS-101/close', {
    method: 'POST', headers: { Cookie: strangerCookie }, body: new URLSearchParams({ csrf: strangerCsrf, version: '1', workspace: path.split('/').at(-1)! }),
  });
  assert.equal(foreign.status, 404);
});

test('invalid methods, paths, hosts, body types, duplicates and oversized bodies fail closed', async t => {
  const a = await app(t);
  assert.equal((await a.get('/issues?scope=not-a-scope')).status, 404);
  assert.equal((await a.get('/issues/ISS-101/close')).status, 404);
  assert.equal((await a.get('/.data/state.json')).status, 404);
  const badHostStatus = await new Promise<number | undefined>((resolve, reject) => {
    httpGet(a.base, { headers: { Host: 'evil.example' } }, response => {
      response.resume();
      resolve(response.statusCode);
    }).on('error', reject);
  });
  assert.equal(badHostStatus, 403);
  assert.equal((await fetch(a.base + '/issues', { method: 'DELETE' })).status, 405);
  assert.equal((await fetch(a.base + '/workspaces', { method: 'POST', headers: { Cookie: a.cookie, 'Content-Type': 'application/json' }, body: '{}' })).status, 415);
  assert.equal((await fetch(a.base + '/workspaces', { method: 'POST', headers: { Cookie: a.cookie, 'Content-Type': 'application/x-www-form-urlencoded' }, body: `csrf=${a.csrf}&task=a&task=b&engine=demo` })).status, 422);
  assert.equal((await a.post('/workspaces', { engine: 'demo', task: 'x'.repeat(9000) })).status, 413);
  assert.equal(a.count(), 0);
});

test('an untrusted composer cannot publish invented action URLs or render scripts', async t => {
  const a = await app(t, async () => ({
    plan: { title: '<script>bad()</script>', layout: 'stack', blocks: [{ resource: 'javascript:bad()', view: 'actions' }] },
    engine: 'pi', note: '', inspected: [], elapsedMs: 0,
  }));
  const response = await a.post('/workspaces', { task: 'bad', engine: 'pi' });
  assert.equal(response.status, 422);
  assert.doesNotMatch(await response.text(), /<script>/);
});

test('fallback output is visibly distinct from genuine Pi output', async t => {
  const a = await app(t, async (task, resolve) => demoComposition(task, resolve, true));
  const created = await a.post('/workspaces', { task: 'triage', engine: 'pi' });
  const html = await (await a.get(created.headers.get('location')!)).text();
  assert.match(html, /FALLBACK · NO AI VIEW/);
  assert.match(html, /Pi could not complete/);
  assert.doesNotMatch(html, /PI COMPOSED/);
});
