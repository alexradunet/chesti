import { test } from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Value } from 'typebox/value';
import { createApp } from '../src/server.js';
import { openDatabase } from '../src/database.js';
import { AppError } from '../src/core.js';
import { VisitorStore } from '../src/visitors.js';
import { ObjectRuntime } from '../src/objects/runtime.js';
import { ViewService } from '../src/objects/views.js';
import { ObjectLookupSchema, PAGE_TYPE_ID } from '../src/objects/model.js';
import type { ObjectLookupResult, ViewConversation, ViewGenerator } from '../src/objects/model.js';

async function setup(t: TestContext, generator: ViewGenerator) {
  const db = openDatabase();
  const objects = new ObjectRuntime(db);
  const visitors = new VisitorStore(db);
  const server = createApp({ objects, viewGenerator: generator });
  t.after(async () => { await server.stop(true); db.close(); });
  const origin = server.url.origin;
  const home = await fetch(origin);
  const cookie = home.headers.get('set-cookie')!.split(';')[0]!;
  const visitor = visitors.get(cookie.slice('taskdesk='.length))!;
  const get = (path: string) => fetch(origin + path, { headers: { Cookie: cookie }, redirect: 'manual' });
  const post = (path: string, fields: Record<string, string>, accept = 'text/html') => fetch(origin + path, {
    method: 'POST', headers: { Cookie: cookie, Origin: origin, Accept: accept }, body: new URLSearchParams({ csrf: visitor.csrf, ...fields }), redirect: 'manual',
  });
  return { objects, views: new ViewService(objects), post, get, origin, visitor, visitors };
}

// Read the native editor's returned values, including HTML escaping and the
// initial textarea newline that browsers discard during HTML parsing.
function nativeObjectFields(markup: string): Record<string, string> {
  const fields: Record<string, string> = {};
  const entities: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'" };
  const decode = (value: string) => value.replace(/&(amp|lt|gt|quot|#39);/g, (_, entity: string) => entities[entity]!);
  const form = /<form\b[^>]*data-object-editor[^>]*>([\s\S]*?)<\/form>/.exec(markup)?.[1] ?? '';
  for (const input of form.matchAll(/<input\b[^>]*name="([^"]+)"[^>]*value="([^"]*)"[^>]*>/g)) fields[input[1]!] = decode(input[2]!);
  const textarea = /<textarea\b[^>]*name="body"[^>]*>([\s\S]*?)<\/textarea>/.exec(form);
  if (textarea) fields.body = decode(textarea[1]!.replace(/^\n/, ''));
  return fields;
}

test('HTTP saves exact Markdown source and omitted updates preserve writing', async t => {
  const f = await setup(t, async () => { throw new Error('Not used'); });
  const body = '\n# A heading\n\n7. First  \n8. Second\n\n```md\n**literal**\n```\n\n**Bold** and <script>alert("no")</script>\n';
  const created = await f.post('/objects/create', { title: 'Source', body });
  assert.equal(created.status, 303);
  const path = created.headers.get('location')!.split('?')[0]!;
  const id = path.split('/').at(-1)!;
  const record = f.objects.getObject(id);
  assert.equal(record.body, body);
  const markup = await (await f.get(path)).text();
  assert.equal(nativeObjectFields(markup).body, body);
  assert.ok(markup.includes('<strong>Bold</strong>'));
  assert.ok(!markup.includes('<script>alert'));
  const updatedBody = `${body}\n[Ordinary link](https://example.com)\n\n`;
  assert.equal((await f.post(`${path}/update`, { title: record.title, revision: String(record.revision), body: updatedBody })).status, 303);
  const updated = f.objects.getObject(id);
  assert.equal(updated.body, updatedBody);
  assert.equal((await f.post(`${path}/update`, { title: 'Renamed only', revision: String(updated.revision) })).status, 303);
  assert.equal(f.objects.getObject(id).body, updatedBody);
});

test('HTTP rejects obsolete document payloads without creating or changing objects', async t => {
  const f = await setup(t, async () => { throw new Error('Not used'); });
  const document = JSON.stringify({ type: 'doc', content: [{ type: 'paragraph' }] });
  assert.equal((await f.post('/objects/create', { title: 'Old format', document })).status, 422);
  assert.deepEqual(f.objects.listObjects(), []);
  const created = await f.post('/objects/create', { title: 'Keep', body: 'Keep **source**.' });
  const path = created.headers.get('location')!.split('?')[0]!;
  const saved = f.objects.getObject(path.split('/').at(-1)!);
  assert.equal((await f.post(`${path}/update`, { title: 'Overwrite', revision: String(saved.revision), body: 'Replacement', document })).status, 422);
  assert.deepEqual(f.objects.getObject(saved.id), saved);
});

test('Markdown object links create document-level backlinks and unsafe content stays inert', async t => {
  const f = await setup(t, async () => { throw new Error('Not used'); });
  const targetResponse = await f.post('/objects/create', { title: 'Target' });
  const targetPath = targetResponse.headers.get('location')!.split('?')[0]!;
  const targetId = targetPath.split('/').at(-1)!;
  const body = `[Target](${targetPath}) and [again](${targetPath})\n\n[bad](javascript:alert)\n\n<img src=x onerror=alert(1)>`;
  const sourceResponse = await f.post('/objects/create', { title: 'Source', body });
  assert.equal(sourceResponse.status, 303);
  const sourcePath = sourceResponse.headers.get('location')!.split('?')[0]!;
  const sourceId = sourcePath.split('/').at(-1)!;
  assert.deepEqual(f.objects.backlinks(targetId), [{ object: f.objects.getObject(sourceId) }]);
  const sourceMarkup = await (await f.get(sourcePath)).text();
  const renderedLinks: string[] = [];
  let executableElements = 0;
  new HTMLRewriter()
    .on('.markdown-content a', { element(element) { renderedLinks.push(element.getAttribute('href') ?? ''); } })
    .on('.markdown-content img, .markdown-content script', { element() { executableElements++; } })
    .transform(sourceMarkup);
  assert.deepEqual(renderedLinks, [targetPath, targetPath]);
  assert.equal(executableElements, 0);
  const backlinks: string[] = [];
  new HTMLRewriter().on('.backlinks a', { element(element) { backlinks.push(element.getAttribute('href')!); } }).transform(await (await f.get(targetPath)).text());
  assert.deepEqual(backlinks, [sourcePath]);
});

test('rejected native writes preserve title and Markdown without replacing saved content or stale revisions', async t => {
  const f = await setup(t, async () => { throw new Error('Not used'); });
  let type = f.objects.createType('Measured');
  type = f.objects.addProperty(type.id, type.revision, { label: 'Count', kind: 'number' });
  const propertyId = type.propertyIds[0]!;
  const requestId = randomUUID();
  const title = 'Draft "title" & <notes>';
  const body = '\n## Unsaved\n\nKeep **spacing**.  \n<script>not executable</script>\n';
  const rejected = await f.post('/objects/create', { requestId, typeId: type.id, title, body, [`p:${propertyId}`]: 'not a number' });
  assert.equal(rejected.status, 422);
  const createDraft = nativeObjectFields(await rejected.text());
  assert.equal(createDraft.title, title);
  assert.equal(createDraft.body, body);
  assert.equal(createDraft.requestId, requestId);
  assert.deepEqual(f.objects.listObjects(), []);
  const saved = f.objects.createObject({ typeId: type.id, title: 'Saved title', body: '**Saved writing**', properties: {} });
  const latest = f.objects.updateObject(saved.id, saved.revision, { ...saved, title: 'Concurrent edit' });
  const fields = { title, body, revision: String(saved.revision) };
  const conflict = await f.post(`/objects/${saved.id}/update`, fields);
  assert.equal(conflict.status, 409);
  const conflictMarkup = await conflict.text();
  const conflictDraft = nativeObjectFields(conflictMarkup);
  assert.equal(conflictDraft.title, title);
  assert.equal(conflictDraft.body, body);
  assert.equal(conflictDraft.revision, String(saved.revision));
  assert.ok(conflictMarkup.includes('<strong>Saved writing</strong>'));
  assert.ok(!conflictMarkup.includes('<h2>Unsaved</h2>'));
  assert.equal((await f.post(`/objects/${saved.id}/update`, { title: conflictDraft.title!, body: conflictDraft.body!, revision: conflictDraft.revision! })).status, 409);
  const invalid = await f.post(`/objects/${saved.id}/update`, { ...fields, revision: String(latest.revision), [`p:${propertyId}`]: 'invalid' });
  assert.equal(invalid.status, 422);
  const invalidDraft = nativeObjectFields(await invalid.text());
  assert.equal(invalidDraft.title, title);
  assert.equal(invalidDraft.body, body);
  const oversizedBody = 'x'.repeat(256 * 1024 + 1);
  const oversized = await f.post(`/objects/${saved.id}/update`, { ...fields, revision: String(latest.revision), body: oversizedBody });
  assert.equal(oversized.status, 422);
  const oversizedDraft = nativeObjectFields(await oversized.text());
  assert.equal(oversizedDraft.title, title);
  assert.equal(oversizedDraft.body, oversizedBody);
  assert.equal(oversizedDraft.revision, String(latest.revision));
  assert.deepEqual(f.objects.getObject(saved.id), latest);
});

test('lookup searches the entire live collection by title and writing with literal wildcards', async t => {
  const f = await setup(t, async () => { throw new Error('Not used'); });
  const type = f.objects.createType('Research');
  const older = f.objects.createObject({ typeId: type.id, title: 'Archive %_ title', body: 'A singular body needle.', properties: {} });
  f.objects.db.query('UPDATE objects SET updated_at = ? WHERE id = ?').run('2000-01-01T00:00:00.000Z', older.id);
  const trashed = f.objects.createObject({ typeId: type.id, title: 'Archive %_ trash', body: 'A singular body needle.', properties: {} });
  f.objects.setTrashed(trashed.id, trashed.revision, true);
  for (let index = 0; index < 205; index++) f.objects.createObject({ typeId: PAGE_TYPE_ID, title: `Recent ${index}`, body: 'Ordinary writing', properties: {} });
  assert.equal(f.objects.listObjects({ limit: 200 }).some(record => record.id === older.id), false);
  for (const query of ['Archive', 'singular body needle', '%', '_']) {
    const response = await f.get(`/objects/lookup?q=${encodeURIComponent(query)}`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const result: unknown = await response.json();
    assert.ok(Value.Check(ObjectLookupSchema, result));
    assert.deepEqual(result, { items: [{ id: older.id, title: older.title, typeName: type.name }], truncated: false });
  }
});

test('lookup returns at most fifty results and rejects unsupported, repeated, or oversized queries as uncached JSON', async t => {
  const f = await setup(t, async () => { throw new Error('Not used'); });
  const records = Array.from({ length: 50 }, (_, index) => f.objects.createObject({ typeId: PAGE_TYPE_ID, title: `Batch ${index}`, body: '', properties: {} }));
  const exact = await (await f.get('/objects/lookup?q=Batch')).json() as ObjectLookupResult;
  assert.equal(exact.truncated, false);
  assert.deepEqual(exact.items.map(item => item.id).sort(), records.map(record => record.id).sort());
  const extra = f.objects.createObject({ typeId: PAGE_TYPE_ID, title: 'Batch extra', body: '', properties: {} });
  const overflow = await (await f.get('/objects/lookup')).json() as ObjectLookupResult;
  assert.ok(Value.Check(ObjectLookupSchema, overflow));
  assert.equal(overflow.items.length, 50);
  assert.equal(overflow.truncated, true);
  assert.equal(new Set(overflow.items.map(item => item.id)).size, 50);
  const validIds = new Set([...records, extra].map(record => record.id));
  assert.ok(overflow.items.every(item => validIds.has(item.id)));
  f.objects.setTrashed(extra.id, extra.revision, true);
  assert.equal((await (await f.get('/objects/lookup?q=Batch')).json() as ObjectLookupResult).truncated, false);
  const boundary = await f.get(`/objects/lookup?q=${'x'.repeat(200)}`);
  assert.equal(boundary.status, 200);
  assert.deepEqual(await boundary.json(), { items: [], truncated: false });
  for (const query of [`q=${'x'.repeat(201)}`, 'q=a&q=b', 'limit=100', 'trash=1', 'conversation=not-an-id']) {
    const response = await f.get(`/objects/lookup?${query}`);
    assert.equal(response.status, 422);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(typeof (await response.json() as { error: string }).error, 'string');
  }
});

test('explicit review still conflicts with subsequent writes and preserves the reconciled draft until saved', async t => {
  const f = await setup(t, async () => { throw new Error('Not used'); });
  let type = f.objects.createType('Measured review');
  type = f.objects.addProperty(type.id, type.revision, { label: 'Count', kind: 'number' });
  const propertyId = type.propertyIds[0]!;
  const saved = f.objects.createObject({ typeId: type.id, title: 'Original', body: 'Original body', properties: { [propertyId]: 1 } });
  const reviewed = f.objects.updateObject(saved.id, saved.revision, { ...saved, title: 'Reviewed title', body: 'Reviewed body', properties: { [propertyId]: 2 } });
  const latest = f.objects.updateObject(saved.id, reviewed.revision, { ...reviewed, title: 'Another edit', properties: { [propertyId]: 3 } });
  const path = `/objects/${saved.id}/update`;
  const fields = { revision: String(saved.revision), reviewedRevision: String(reviewed.revision), title: 'Reconciled title', body: '\nReconciled **body**.\n\n', [`p:${propertyId}`]: '42' };
  const conflict = await f.post(path, fields);
  assert.equal(conflict.status, 409);
  const draft = nativeObjectFields(await conflict.text());
  assert.equal(draft.title, fields.title);
  assert.equal(draft.body, fields.body);
  assert.equal(draft[`p:${propertyId}`], '42');
  assert.equal(draft.revision, String(reviewed.revision));
  assert.deepEqual(f.objects.getObject(saved.id), latest);
  assert.equal((await f.post(path, { ...fields, reviewedRevision: String(latest.revision) })).status, 303);
  const reconciled = f.objects.getObject(saved.id);
  assert.equal(reconciled.title, fields.title);
  assert.equal(reconciled.body, fields.body);
  assert.deepEqual(reconciled.properties, { [propertyId]: 42 });
  assert.equal(reconciled.revision, latest.revision + 1);
});

test('reviewed revisions cannot bypass missing or invalid original revisions and are update-only', async t => {
  const f = await setup(t, async () => { throw new Error('Not used'); });
  const saved = f.objects.createObject({ typeId: PAGE_TYPE_ID, title: 'Saved', body: 'Saved body', properties: {} });
  const path = `/objects/${saved.id}/update`;
  const attempt = { title: 'Draft title', body: '\nUnsaved body\n', reviewedRevision: String(saved.revision) };
  const invalidFields: Record<string, string>[] = [
    attempt,
    { ...attempt, revision: '1.5' },
    { ...attempt, revision: String(saved.revision), reviewedRevision: '9007199254740992' },
  ];
  for (const fields of invalidFields) {
    const response = await f.post(path, fields);
    assert.equal(response.status, 422);
    const draft = nativeObjectFields(await response.text());
    assert.equal(draft.title, attempt.title);
    assert.equal(draft.body, attempt.body);
    assert.equal(draft.revision, fields.reviewedRevision);
    assert.deepEqual(f.objects.getObject(saved.id), saved);
  }
  const repeated = new URLSearchParams({ csrf: f.visitor.csrf, ...attempt, revision: String(saved.revision) });
  repeated.append('reviewedRevision', String(saved.revision));
  const duplicate = await fetch(f.origin + path, { method: 'POST', headers: { Cookie: `taskdesk=${f.visitor.id}`, Origin: f.origin }, body: repeated });
  assert.equal(duplicate.status, 422);
  assert.equal((await f.post(`/objects/${saved.id}/trash`, { revision: String(saved.revision), reviewedRevision: String(saved.revision) })).status, 422);
  assert.equal((await f.post('/objects/create', { title: 'Not created', reviewedRevision: String(saved.revision) })).status, 422);
  assert.deepEqual(f.objects.getObject(saved.id), saved);
  assert.deepEqual(f.objects.listObjects(), [saved]);
});

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
  const other = f.visitors.create();
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
