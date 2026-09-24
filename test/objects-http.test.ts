import { test } from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { cpSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../src/server.js';
import { openDatabase } from '../src/database.js';
import { AppError } from '../src/core.js';
import { Store } from '../src/store.js';
import { ObjectRuntime } from '../src/objects/runtime.js';
import { ViewService } from '../src/objects/views.js';
import { VaultRuntime } from '../src/vault/runtime.js';
import type { ViewConversation, ViewGenerator } from '../src/objects/model.js';

async function setup(t: TestContext, generator: ViewGenerator) {
  const db = openDatabase();
  const objects = new ObjectRuntime(db);
  const store = new Store(db);
  const server = createApp({ store, objects, viewGenerator: generator });
  t.after(async () => { await server.stop(true); db.close(); });
  const origin = server.url.origin;
  const home = await fetch(origin);
  const cookie = home.headers.get('set-cookie')!.split(';')[0]!;
  const visitor = store.get(cookie.slice('taskdesk='.length))!;
  const get = (path: string) => fetch(origin + path, { headers: { Cookie: cookie }, redirect: 'manual' });
  const post = (path: string, fields: Record<string, string>, accept = 'text/html') => fetch(origin + path, {
    method: 'POST', headers: { Cookie: cookie, Origin: origin, Accept: accept }, body: new URLSearchParams({ csrf: visitor.csrf, ...fields }), redirect: 'manual',
  });
  return { objects, views: new ViewService(objects), post, get, origin, visitor, store };
}

test('native object forms and an AI-authored calendar share data without regeneration', async t => {
  let calls = 0;
  const f = await setup(t, async (_prompt, catalog) => {
    calls++;
    const sources = catalog.types.filter(type => ['Task', 'Meeting'].includes(type.name)).map(type => ({ typeId: type.id, bindings: { date: type.propertyIds[0]! } }));
    return { model: 'fixture/contract', spec: { title: 'Schedule', blocks: [{ title: 'Scheduled work', component: 'calendar', sources, editable: true }] } };
  });
  const taskResponse = await f.post('/types/create', { name: 'Task' });
  assert.equal(taskResponse.status, 303);
  const task = f.objects.catalog().types.find(type => type.name === 'Task')!;
  assert.equal((await f.post(`/types/${task.id}/properties`, { revision: String(task.revision), label: 'Scheduled', kind: 'date' })).status, 303);
  const property = f.objects.catalog().properties.find(property => property.label === 'Scheduled')!;
  await f.post('/types/create', { name: 'Meeting' });
  const meeting = f.objects.catalog().types.find(type => type.name === 'Meeting')!;
  assert.equal((await f.post(`/types/${meeting.id}/properties`, { revision: String(meeting.revision), propertyId: property.id })).status, 303);
  const create = (typeId: string, title: string, date = '') => f.post('/objects/create', { requestId: randomUUID(), typeId, title, body: 'Original writing', [`p:${property.id}`]: date });
  const taskObject = await create(task.id, 'Ship the object workspace', '2026-09-24');
  const taskPath = taskObject.headers.get('location')!.split('?')[0]!;
  const taskId = taskPath.split('/').at(-1)!;
  await create(meeting.id, 'Architecture review', '2026-09-24');
  await create(task.id, 'Unscheduled task');
  assert.equal((await f.post('/views/generate', { prompt: 'Make a calendar for my tasks and meetings' })).status, 303);
  const view = f.views.list()[0]!;
  assert.equal(view.status, 'draft');
  assert.equal((await f.post(`/views/${view.id}/publish`, { revision: String(view.revision) })).status, 303);
  const published = f.views.get(view.id);
  const calendar = await (await f.get(`/views/${view.id}`)).text();
  for (const title of ['Ship the object workspace', 'Architecture review', 'Unscheduled task']) assert.ok(calendar.includes(title));
  assert.equal(calls, 1);
  assert.equal((await f.post(`/properties/${property.id}/update`, { revision: String(property.revision), label: 'When' })).status, 303);
  assert.equal(f.views.evaluate(view.id).blocks[0]!.rows.length, 3);
  const record = f.objects.getObject(taskId);
  const action = { revision: String(published.revision), objectId: taskId, objectRevision: String(record.revision), blockIndex: '0', role: 'date', value: '2026-09-25' };
  assert.equal((await f.post(`/views/${view.id}/act`, action)).status, 303);
  assert.equal(f.objects.getObject(taskId).properties[property.id], '2026-09-25');
  assert.equal((await f.post(`/views/${view.id}/act`, action)).status, 409);
  assert.equal((await f.get(taskPath)).status, 200);
  assert.equal(calls, 1, 'Opening and operating the saved view does not call AI');
  assert.equal((await f.post(`/views/${view.id}/delete`, { revision: String(published.revision) })).status, 303);
  assert.equal((await f.get(taskPath)).status, 200);
  assert.equal(f.objects.listObjects().length, 3);
});

test('AI failure and invalid generated bindings never publish a fallback or mutate objects', async t => {
  let invalid = false;
  const f = await setup(t, async () => {
    if (!invalid) throw new Error('Provider unavailable');
    return { model: 'fixture/contract', spec: { title: 'Invalid', blocks: [{ title: 'Missing', component: 'calendar', sources: [{ typeId: randomUUID(), bindings: { date: randomUUID() } }] }] } };
  });
  assert.equal((await f.post('/views/generate', { prompt: 'Show a calendar' })).status, 502);
  invalid = true;
  assert.equal((await f.post('/views/generate', { prompt: 'Show a calendar' })).status, 422);
  assert.deepEqual(f.views.list(), []);
  assert.deepEqual(f.objects.listObjects(), []);
  // The public endpoint accepts a request, never an arbitrary user-supplied view definition.
  assert.equal((await f.post('/views/generate', { prompt: 'Show a calendar', spec: '{}' })).status, 422);
});

test('view conversations continue saved turns while explicit seeds and new threads stay independent', async t => {
  const f = await setup(t, async (prompt, catalog) => ({
    model: 'fixture/contract', spec: { title: prompt, blocks: [{ title: 'Pages', component: 'list', sources: [{ typeId: catalog.types[0]!.id, bindings: {} }] }] },
  }));
  const first = await f.post('/views/generate', { prompt: 'Original view' });
  assert.equal(first.status, 303);
  const location = new URL(first.headers.get('location')!, f.origin);
  assert.equal(location.searchParams.get('ai'), '1');
  const firstId = location.pathname.split('/').at(-1)!;
  const id = location.searchParams.get('conversation')!;
  const initial = await (await f.get(`/views/conversations/${id}`)).json() as ViewConversation;
  assert.deepEqual(initial.turns.map(turn => [turn.prompt, turn.viewId]), [['Original view', firstId]]);
  assert.equal(initial.previousId, undefined);

  const refined = await f.post('/views/generate', { prompt: 'Refined view', conversationId: id }, 'application/json');
  assert.equal(refined.status, 200);
  const result = await refined.json() as { conversation: ViewConversation; viewId: string; url: string };
  assert.equal(result.conversation.id, id);
  assert.equal(result.url, `/views/${result.viewId}`);
  assert.notEqual(result.viewId, firstId);
  assert.deepEqual(result.conversation.turns.map(turn => turn.prompt), ['Original view', 'Refined view']);
  assert.deepEqual(await (await f.get(`/views/conversations/${id}`)).json(), result.conversation);
  assert.equal(f.views.get(firstId).spec.title, 'Original view');

  const fork = await f.post('/views/generate', { prompt: 'Independent fork', previousId: firstId }, 'application/json');
  assert.equal(fork.status, 200);
  const forked = await fork.json() as { conversation: ViewConversation };
  assert.notEqual(forked.conversation.id, id);
  assert.equal(forked.conversation.previousId, firstId);
  assert.equal(forked.conversation.contextTitle, 'Original view');
  assert.deepEqual(forked.conversation.turns.map(turn => turn.prompt), ['Independent fork']);
  const fresh = await f.post('/views/generate', { prompt: 'Unseeded view' }, 'application/json');
  const freshResult = await fresh.json() as { conversation: ViewConversation };
  assert.notEqual(freshResult.conversation.id, forked.conversation.id);
  assert.equal(freshResult.conversation.previousId, undefined);
  assert.deepEqual(freshResult.conversation.turns.map(turn => turn.prompt), ['Unseeded view']);
  assert.deepEqual(await (await f.get(`/views/conversations/${id}`)).json(), result.conversation);
});

test('view conversations reject other visitors and deleted latest results without recording failed turns', async t => {
  let unavailable = false;
  let calls = 0;
  const f = await setup(t, async (_prompt, catalog) => {
    calls++;
    if (unavailable) throw new AppError(503, 'Provider unavailable');
    return { model: 'fixture/contract', spec: { title: 'Pages', blocks: [{ title: 'Pages', component: 'list', sources: [{ typeId: catalog.types[0]!.id, bindings: {} }] }] } };
  });
  const created = await f.post('/views/generate', { prompt: 'Show pages' }, 'application/json');
  const result = await created.json() as { conversation: ViewConversation; viewId: string };
  const path = `/views/conversations/${result.conversation.id}`;
  const other = f.store.create();
  const foreignHeaders = { Cookie: `taskdesk=${other.id}`, Origin: f.origin, Accept: 'application/json' };
  assert.equal((await fetch(f.origin + path, { headers: foreignHeaders })).status, 404);
  const foreignPost = await fetch(f.origin + '/views/generate', { method: 'POST', headers: foreignHeaders, body: new URLSearchParams({ csrf: other.csrf, prompt: 'Change it', conversationId: result.conversation.id }) });
  assert.equal(foreignPost.status, 404);
  assert.equal((await f.get(`/views/${result.viewId}?ai=1&conversation=${result.conversation.id}`)).status, 200);
  assert.equal((await fetch(f.origin + `/views/${result.viewId}?ai=1&conversation=${result.conversation.id}`, { headers: foreignHeaders })).status, 404);
  assert.equal((await f.post('/views/generate', { prompt: 'Change it', conversationId: result.conversation.id, previousId: result.viewId }, 'application/json')).status, 422);
  assert.equal((await f.post('/views/generate', { prompt: 'Change it', conversationId: 'not-an-id' }, 'application/json')).status, 422);
  assert.equal(calls, 1);
  unavailable = true;
  const failed = await f.post('/views/generate', { prompt: 'Try a refinement', conversationId: result.conversation.id }, 'application/json');
  assert.equal(failed.status, 503);
  assert.deepEqual(await failed.json(), { error: 'Provider unavailable' });
  assert.deepEqual(await (await f.get(path)).json(), result.conversation);
  f.views.delete(result.viewId, f.views.get(result.viewId).revision);
  const deleted = await f.post('/views/generate', { prompt: 'Try after deletion', conversationId: result.conversation.id }, 'application/json');
  assert.equal(deleted.status, 409);
  assert.equal(typeof (await deleted.json() as { error: string }).error, 'string');
  assert.equal(calls, 2, 'Deleted context never reaches generation or silently starts a new view');
  assert.deepEqual(await (await f.get(path)).json(), result.conversation);
});

test('saving a conversation turn is atomic with its generated view and retry remains possible', async t => {
  const f = await setup(t, async (_prompt, catalog) => ({
    model: 'fixture/contract', spec: { title: 'Pages', blocks: [{ title: 'Pages', component: 'list', sources: [{ typeId: catalog.types[0]!.id, bindings: {} }] }] },
  }));
  const rejectTurn = () => f.objects.db.exec("CREATE TRIGGER reject_generated_turn BEFORE INSERT ON object_view_conversation_turns BEGIN SELECT RAISE(ABORT, 'Fixture write failure'); END");
  rejectTurn();
  assert.equal((await f.post('/views/generate', { prompt: 'Show pages' }, 'application/json')).status, 502);
  assert.deepEqual(f.views.list(), []);
  assert.equal(f.objects.db.query<{ count: number }, []>('SELECT count(*) AS count FROM object_view_conversations').get()!.count, 0);
  f.objects.db.exec('DROP TRIGGER reject_generated_turn');
  const created = await f.post('/views/generate', { prompt: 'Show pages' }, 'application/json');
  const result = await created.json() as { conversation: ViewConversation; viewId: string };
  rejectTurn();
  assert.equal((await f.post('/views/generate', { prompt: 'Refine pages', conversationId: result.conversation.id }, 'application/json')).status, 502);
  assert.deepEqual(f.views.list().map(view => view.id), [result.viewId]);
  assert.deepEqual(await (await f.get(`/views/conversations/${result.conversation.id}`)).json(), result.conversation);
  f.objects.db.exec('DROP TRIGGER reject_generated_turn');
  const retried = await f.post('/views/generate', { prompt: 'Refine pages', conversationId: result.conversation.id }, 'application/json');
  assert.equal(retried.status, 200);
  const successful = await retried.json() as { conversation: ViewConversation };
  assert.deepEqual(successful.conversation.turns.map(turn => turn.prompt), ['Show pages', 'Refine pages']);
});

test('existing owner data migrates without app approval and retired mutations cannot fork it', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'objects-migration-http-'));
  const root = join(directory, 'vault');
  cpSync(new URL('../examples/life-vault', import.meta.url), root, { recursive: true });
  const db = openDatabase(join(directory, 'workspace.sqlite'));
  new VaultRuntime(db, { importRoot: root });
  const before = db.query<{ id: string; title: string; body: string }, []>('SELECT id, title, body FROM vault_records ORDER BY id').all();
  const source = readFileSync(join(root, 'Projects/Website/Tasks/Publish homepage.md'), 'utf8');
  const objects = new ObjectRuntime(db);
  assert.throws(() => new VaultRuntime(db), (error: unknown) => error instanceof AppError && error.status === 409);
  const store = new Store(db);
  const server = createApp({ store, objects });
  t.after(async () => { await server.stop(true); db.close(); rmSync(directory, { recursive: true, force: true }); });
  const home = await fetch(server.url);
  assert.equal(home.status, 200);
  const cookie = home.headers.get('set-cookie')!.split(';')[0]!;
  const visitor = store.get(cookie.slice('taskdesk='.length))!;
  for (const row of before) assert.equal(objects.getObject(row.id.toLowerCase()).title, row.title);
  const retired = await fetch(new URL('/vault/act', server.url), {
    method: 'POST', headers: { Cookie: cookie, Origin: server.url.origin }, body: new URLSearchParams({ csrf: visitor.csrf }), redirect: 'manual',
  });
  assert.equal(retired.status, 404);
  assert.deepEqual(db.query('SELECT id, title, body FROM vault_records ORDER BY id').all(), before);
  assert.equal(readFileSync(join(root, 'Projects/Website/Tasks/Publish homepage.md'), 'utf8'), source);
});
