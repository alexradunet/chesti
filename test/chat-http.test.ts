import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createApp } from '../src/server.js';
import { Store } from '../src/store.js';
import type { ChatRunner } from '../src/conversation.js';

async function setup(t: TestContext, chatRunner?: ChatRunner, task = 'triage') {
  const store = new Store();
  const server = createApp({ store, mode: 'demo', chatRunner });
  t.after(() => server.stop(true));
  const origin = server.url.origin;
  const home = await fetch(`${origin}/issues/new`);
  const cookie = home.headers.get('set-cookie')!.split(';')[0]!;
  const csrf = /name="csrf" value="([^"]+)"/.exec(await home.text())![1]!;
  const post = (path: string, fields: Record<string, string> | URLSearchParams, headers: Record<string, string> = {}) => {
    const body = new URLSearchParams(fields); if (!body.has('csrf')) body.set('csrf', csrf);
    return fetch(origin + path, { method: 'POST', headers: { Cookie: cookie, Origin: origin, ...headers }, body, redirect: 'manual' });
  };
  const created = await post('/workspaces', { task, engine: 'demo' });
  const path = created.headers.get('location')!;
  const visitor = store.get(cookie.slice('taskdesk='.length))!;
  const workspace = visitor.workspaces[0]!;
  const get = (url = path) => fetch(origin + url, { headers: { Cookie: cookie } });
  const send = (message: string, extra: Record<string, string> = {}, stream = false) => post(`${path}/messages`, { message, engine: 'demo', revision: String(workspace.revision), requestId: randomUUID(), ...extra }, stream ? { Accept: 'text/event-stream' } : {});
  return { store, visitor, workspace, origin, cookie, csrf, post, path, get, send };
}

test('conversation rail and trusted script are available on workspace and linked resource pages', async t => {
  const f = await setup(t);
  for (const path of [f.path, `/issues/ISS-101?workspace=${f.workspace.id}`]) {
    const response = await f.get(path); const html = await response.text();
    assert.match(html, /id="conversation"/);
    assert.match(html, /id="canvas"/);
    assert.match(html, /src="\/workspace.js"/);
    assert.match(html, /name="selected" form="chat-send"/);
    assert.match(response.headers.get('content-security-policy')!, /script-src 'self'/);
    assert.doesNotMatch(html, /onclick=|<script>(?!<\/script>)/);
  }
  const script = await f.get('/workspace.js');
  assert.equal(script.status, 200);
  assert.match(script.headers.get('content-type')!, /javascript/);
});

test('native conversation POST executes assignments and persists history with stable layout', async t => {
  const f = await setup(t);
  const before = structuredClone(f.workspace.plan);
  assert.equal((await f.send('Assign both issues to me')).status, 303);
  assert.equal(f.workspace.conversation.turns[0]!.status, 'done');
  assert.equal(f.workspace.conversation.receipts.length, 2);
  assert.deepEqual(f.workspace.plan, before);
  const markup = await (await f.get()).text();
  assert.match(markup, /Assign both issues to me/);
  assert.match(markup, /owner: alex/);
  assert.match(markup, /Nothing in this queue/);
  assert.match(markup, /DEMO · NO AI/);
  assert.equal(f.visitor.issues.find(i => i.id === 'ISS-105')!.owner, 'alex');
});

test('request replay does not rerun the agent or repeat mutations; changed payload conflicts', async t => {
  let calls = 0;
  const f = await setup(t, async c => {
    calls++; c.inspect('/issues'); c.inspect('/issues/ISS-101');
    c.act('/issues/ISS-101', 'assign', { owner: 'me' }); c.text('Assigned.');
  });
  const requestId = randomUUID();
  assert.equal((await f.send('Assign ISS-101 to me', { requestId })).status, 303);
  assert.equal((await f.send('Assign ISS-101 to me', { requestId })).status, 303);
  const replay = await f.send('Assign ISS-101 to me', { requestId }, true);
  assert.match(await replay.text(), /"replay":true/);
  assert.equal(calls, 1);
  assert.equal(f.visitor.issues[0]!.version, 2);
  assert.equal((await f.send('Close ISS-101', { requestId })).status, 409);
});

test('SSE publishes text and authoritative receipts; failures do not run a demo fallback', async t => {
  const f = await setup(t, async c => {
    c.text('<script>not executable</script>');
    c.inspect('/issues'); c.inspect('/issues/ISS-101');
    c.act('/issues/ISS-101', 'assign', { owner: 'me' });
    throw new Error('Synthetic provider failure');
  });
  const response = await f.send('Assign both issues to me', { engine: 'pi' }, true);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-security-policy')!, /default-src 'none'/);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const stream = await response.text();
  assert.match(stream, /"type":"text"/);
  assert.match(stream, /"type":"receipt"/);
  assert.match(stream, /"status":"failed"/);
  assert.equal(f.workspace.conversation.turns[0]!.status, 'failed');
  assert.equal(f.visitor.issues[0]!.owner, 'alex');
  assert.equal(f.visitor.issues.find(i => i.id === 'ISS-105')!.owner, 'unassigned');
  const html = await (await f.get()).text();
  assert.match(html, /&lt;script&gt;not executable/);
  assert.doesNotMatch(html, /<script>not executable/);
  assert.match(html, /Some actions may already have applied/);
});

test('busy turn rejects overlap; stop prevents subsequent actions and retains earlier receipts', async t => {
  const f = await setup(t, async c => {
    c.inspect('/issues'); c.inspect('/issues/ISS-101'); c.inspect('/issues/ISS-105');
    c.act('/issues/ISS-101', 'assign', { owner: 'me' });
    await new Promise<void>(resolve => { if (c.signal.aborted) resolve(); else c.signal.addEventListener('abort', () => resolve(), { once: true }); });
    c.act('/issues/ISS-105', 'assign', { owner: 'me' });
  });
  const id = randomUUID();
  const response = await f.send('Assign both issues to me', { requestId: id }, true);
  assert.equal((await f.send('Another request')).status, 429);
  assert.equal((await f.post(`${f.path}/stop`, { turnId: id })).status, 204);
  assert.match(await response.text(), /"status":"stopped"/);
  assert.equal(f.visitor.issues[0]!.owner, 'alex');
  assert.equal(f.visitor.issues.find(i => i.id === 'ISS-105')!.owner, 'unassigned');
  const state = await (await f.get(`${f.path}/state`)).json() as { busy: boolean };
  assert.equal(state.busy, false);
});

test('canceling the response stream stops the turn and persists its final text and applied receipts', { timeout: 5000 }, async t => {
  const disconnected = Promise.withResolvers<void>();
  const f = await setup(t, async c => {
    c.inspect('/issues'); c.inspect('/issues/ISS-101');
    c.act('/issues/ISS-101', 'assign', { owner: 'me' });
    c.text('Assignment saved before disconnect.');
    if (c.signal.aborted) disconnected.resolve();
    else c.signal.addEventListener('abort', () => disconnected.resolve(), { once: true });
    await disconnected.promise;
    c.signal.throwIfAborted();
  });
  const response = await f.send('Assign ISS-101 to me', {}, true);
  const reader = response.body!.getReader();
  await reader.read();
  await reader.cancel();
  await disconnected.promise;
  const state = await (await f.get(`${f.path}/state`)).json() as { busy: boolean };
  assert.equal(state.busy, false, 'Disconnect must release the active turn');
  const restored = new Store(f.store.db).get(f.visitor.id)!;
  const conversation = restored.workspaces[0]!.conversation;
  assert.equal(conversation.turns[0]!.status, 'stopped');
  assert.equal(conversation.turns[0]!.response, 'Assignment saved before disconnect.');
  assert.equal(conversation.receipts[0]!.status, 'applied');
  assert.equal(restored.issues.find(issue => issue.id === 'ISS-101')!.owner, 'alex');
});

test('pending confirmation requires CSRF, workspace ownership and original version', async t => {
  const f = await setup(t);
  await f.send('Close ISS-101');
  const receipt = f.workspace.conversation.receipts[0]!;
  assert.equal(receipt.status, 'pending');
  assert.equal(f.visitor.issues[0]!.status, 'open');
  const route = `${f.path}/receipts/${receipt.id}`;
  assert.equal((await f.post(route, { decision: 'confirm', csrf: 'forged' })).status, 403);
  const stranger = await fetch(`${f.origin}/issues/new`); const strangerCookie = stranger.headers.get('set-cookie')!.split(';')[0]!;
  const strangerCsrf = /name="csrf" value="([^"]+)"/.exec(await stranger.text())![1]!;
  assert.equal((await fetch(f.origin + route, { method: 'POST', headers: { Cookie: strangerCookie }, body: new URLSearchParams({ decision: 'confirm', csrf: strangerCsrf }) })).status, 404);
  assert.equal((await f.post(route, { decision: 'confirm' })).status, 303);
  assert.equal((await f.post(route, { decision: 'confirm' })).status, 303);
  assert.equal(f.visitor.issues[0]!.version, 2);
  assert.equal(f.visitor.issues[0]!.status, 'closed');
});

test('explicit selections are accepted; foreign or stale context, bad CSRF and extra authority are not', async t => {
  const f = await setup(t, undefined, 'all');
  const fields = new URLSearchParams({ message: 'assign selected issues to me', engine: 'demo', requestId: randomUUID(), revision: '1' });
  fields.append('selected', '/issues/ISS-101'); fields.append('selected', '/issues/ISS-105');
  assert.equal((await f.post(`${f.path}/messages`, fields)).status, 303);
  assert.equal(f.workspace.conversation.receipts.length, 2);
  assert.equal((await f.send('Hello', { selected: '/issues/ISS-999' })).status, 409);
  assert.equal((await f.send('Hello', { actor: 'sam' })).status, 422);
  assert.equal((await f.send('Hello', { csrf: 'wrong' })).status, 403);
  assert.equal((await f.send('Hello', { revision: '0' })).status, 409);
  assert.equal((await f.send('Hello', { focus: 'https://evil.example' })).status, 404);
  const foreign = await fetch(f.origin + `${f.path}/state`);
  assert.equal(foreign.status, 404);
});

test('native form receipts are part of the next agent context; state exposes no SDK entries', async t => {
  const f = await setup(t, async c => {
    assert.equal(c.context.recentActions.at(-1)!.source, 'form');
    assert.equal(c.context.recentActions.at(-1)!.status, 'applied');
    c.inspect('/issues');
    assert.equal(c.inspect('/issues/ISS-101').facts.Assignee, 'Sam');
    c.text('You assigned ISS-101 to Sam.');
  });
  await f.post('/issues/ISS-101/assign', { workspace: f.workspace.id, owner: 'sam', version: '1' });
  await f.send('What changed?');
  assert.equal(f.workspace.conversation.turns[0]!.status, 'done');
  const state = await (await f.get(`${f.path}/state`)).json() as Record<string, unknown>;
  assert.deepEqual(Object.keys(state).sort(), ['busy', 'canvas', 'conversation', 'revision']);
  assert.match(String(state.conversation), /You assigned ISS-101 to Sam/);
});

test('layout updates and undo work via HTTP without undoing issue actions', async t => {
  const f = await setup(t);
  const original = structuredClone(f.workspace.plan);
  await f.send('Assign both issues to me');
  await f.send('show my work');
  assert.equal(f.workspace.revision, 2);
  assert.equal(f.workspace.plan.blocks[0]!.resource, '/issues?scope=mine');
  assert.equal((await f.post(`${f.path}/undo`, { revision: '1' })).status, 409);
  assert.equal((await f.post(`${f.path}/undo`, { revision: '2' })).status, 303);
  assert.deepEqual(f.workspace.plan, original);
  assert.equal(f.visitor.issues[0]!.owner, 'alex');
});
