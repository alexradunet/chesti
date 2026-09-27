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
import { ViewConversationService } from '../src/objects/conversations.js';
import { ViewService } from '../src/objects/views.js';
import { ObjectLookupSchema, PAGE_TYPE_ID, TASK_TYPE_ID, TASK_DUE_PROPERTY_ID, JOURNAL_TYPE_ID, JOURNAL_DATE_PROPERTY_ID } from '../src/objects/model.js';
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

async function nativePropertyForm(markup: string) {
  const result = { fields: {} as Record<string, string>, selected: {} as Record<string, string>, checked: false, draft: false };
  const entities: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'" };
  const decode = (value: string) => value.replace(/&(amp|lt|gt|quot|#39);/g, (_, entity: string) => entities[entity]!);
  await new HTMLRewriter()
    .on('form[data-new-property]', {
      element(element) { result.draft = element.hasAttribute('data-draft'); },
    })
    .on('form[data-new-property] input', {
      element(element) {
        const name = element.getAttribute('name');
        if (!name) return;
        if (name === 'multiple') result.checked = element.hasAttribute('checked');
        result.fields[name] = decode(element.getAttribute('value') ?? '');
      },
    })
    .on('form[data-new-property] textarea[name="options"]', {
      text(chunk) { result.fields.options = (result.fields.options ?? '') + chunk.text; },
    })
    .on('form[data-new-property] select[name="kind"] option[selected]', {
      element(element) { result.selected.kind = decode(element.getAttribute('value') ?? ''); },
    })
    .on('form[data-new-property] select[name="targetTypeId"] option[selected]', {
      element(element) { result.selected.targetTypeId = decode(element.getAttribute('value') ?? ''); },
    })
    .transform(new Response(markup)).text();
  result.fields.options = decode(result.fields.options ?? '').replace(/^\n/, '');
  return result;
}

test('rejected native property creation retains select and reference drafts without changing schemas', async t => {
  const f = await setup(t, async () => { throw new Error('Not used'); });
  const type = f.objects.createType('Drafted properties');
  const target = f.objects.createType('Draft target');
  const label = 'Status "now" & <later>';
  const options = '\n  Todo  \nDoing\n\nTodo\n';
  const select = await f.post(`/types/${type.id}/properties`, { revision: String(type.revision), label, kind: 'select', options });
  assert.equal(select.status, 422);
  const selectMarkup = await select.text();
  assert.ok(selectMarkup.includes('Option labels must be unique.'));
  const selectForm = await nativePropertyForm(selectMarkup);
  assert.equal(selectForm.draft, true);
  assert.equal(selectForm.fields.label, label);
  assert.equal(selectForm.fields.revision, String(type.revision));
  assert.equal(selectForm.selected.kind, 'select');
  assert.equal(selectForm.fields.options, options);
  assert.equal(selectForm.selected.targetTypeId, '');
  assert.equal(selectForm.checked, false);
  assert.deepEqual(f.objects.getType(type.id), type);
  assert.equal(f.objects.catalog().properties.some(property => property.label === label), false);

  const corrected = await f.post(`/types/${type.id}/properties`, { revision: selectForm.fields.revision, label: selectForm.fields.label, kind: selectForm.selected.kind, options: 'Todo\nDoing' });
  assert.equal(corrected.status, 303);
  const withSelect = f.objects.getType(type.id);
  assert.equal(withSelect.propertyIds.length, 1);
  const property = f.objects.getProperty(withSelect.propertyIds[0]!);
  assert.equal(property.label, label);
  assert.equal(property.kind, 'select');
  assert.deepEqual(property.options?.map(option => option.label), ['Todo', 'Doing']);

  const incompatible = await f.post(`/types/${type.id}/properties`, { revision: String(withSelect.revision), label: 'Wrong fields', kind: 'select', options: 'One', targetTypeId: target.id, multiple: 'true' });
  assert.equal(incompatible.status, 422);
  const incompatibleMarkup = await incompatible.text();
  assert.ok(incompatibleMarkup.includes('Only reference properties have a target type or multiple values.'));
  const incompatibleForm = await nativePropertyForm(incompatibleMarkup);
  assert.equal(incompatibleForm.fields.label, 'Wrong fields');
  assert.equal(incompatibleForm.fields.revision, String(withSelect.revision));
  assert.equal(incompatibleForm.selected.kind, 'select');
  assert.equal(incompatibleForm.fields.options, 'One');
  assert.equal(incompatibleForm.selected.targetTypeId, target.id);
  assert.equal(incompatibleForm.checked, true);
  assert.deepEqual(f.objects.getType(type.id), withSelect);

  const missingTarget = randomUUID();
  const reference = await f.post(`/types/${type.id}/properties`, { revision: String(withSelect.revision), label: 'Related item', kind: 'reference', targetTypeId: missingTarget, multiple: 'true' });
  assert.equal(reference.status, 404);
  const referenceForm = await nativePropertyForm(await reference.text());
  assert.equal(referenceForm.fields.label, 'Related item');
  assert.equal(referenceForm.fields.revision, String(withSelect.revision));
  assert.equal(referenceForm.selected.kind, 'reference');
  assert.equal(referenceForm.selected.targetTypeId, missingTarget);
  assert.equal(referenceForm.checked, true);
  assert.deepEqual(f.objects.getType(type.id), withSelect);
});

test('native property drafts keep stale revisions and can be corrected without affecting reuse', async t => {
  const f = await setup(t, async () => { throw new Error('Not used'); });
  let type = f.objects.createType('Property corrections');
  const reusable = f.objects.addProperty(PAGE_TYPE_ID, f.objects.getType(PAGE_TYPE_ID).revision, { label: 'Reusable note', kind: 'text' });
  const staleRevision = type.revision;
  type = f.objects.addProperty(type.id, type.revision, { label: 'Concurrent flag', kind: 'boolean' });
  const staleFields = { revision: String(staleRevision), label: 'Blocked select', kind: 'select', options: 'One\nTwo' };
  const stale = await f.post(`/types/${type.id}/properties`, staleFields);
  assert.equal(stale.status, 409);
  const staleForm = await nativePropertyForm(await stale.text());
  assert.equal(staleForm.fields.revision, String(staleRevision));
  assert.equal(staleForm.fields.label, staleFields.label);
  assert.equal(staleForm.fields.options, staleFields.options);
  assert.equal((await f.post(`/types/${type.id}/properties`, staleFields)).status, 409);
  assert.deepEqual(f.objects.getType(type.id), type);

  const corrected = await f.post(`/types/${type.id}/properties`, { revision: String(type.revision), label: 'Blocked select', kind: 'select', options: 'One\nTwo' });
  assert.equal(corrected.status, 303);
  const withSelect = f.objects.getType(type.id);
  assert.equal(withSelect.propertyIds.length, type.propertyIds.length + 1);
  const property = f.objects.getProperty(withSelect.propertyIds.at(-1)!);
  assert.equal(property.label, 'Blocked select');
  assert.deepEqual(property.options?.map(option => option.label), ['One', 'Two']);

  const beforeReuse = f.objects.getType(type.id);
  const reuse = await f.post(`/types/${type.id}/properties`, { revision: String(beforeReuse.revision), propertyId: reusable.propertyIds.at(-1)! });
  assert.equal(reuse.status, 303);
  const afterReuse = f.objects.getType(type.id);
  assert.equal(afterReuse.propertyIds.at(-1), reusable.propertyIds.at(-1));
});

test('native type browsing keeps search and trash scope when switching layouts and pages', async t => {
  const f = await setup(t, async () => { throw new Error('Not used'); });
  const task = f.objects.createType('Task');
  const wanted = Array.from({ length: 51 }, (_, index) => f.objects.createObject({
    typeId: task.id, title: `Needle ${index}`, body: 'Saved writing.', properties: {},
  }));
  f.objects.createObject({ typeId: task.id, title: 'Unmatched task', body: '', properties: {} });
  f.objects.createObject({ typeId: PAGE_TYPE_ID, title: 'Needle page', body: '', properties: {} });
  const removedTask = f.objects.createObject({ typeId: task.id, title: 'Needle removed task', body: '', properties: {} });
  const removedPage = f.objects.createObject({ typeId: PAGE_TYPE_ID, title: 'Needle removed page', body: '', properties: {} });
  f.objects.setTrashed(removedTask.id, removedTask.revision, true);
  f.objects.setTrashed(removedPage.id, removedPage.revision, true);

  const browse = async (path: string) => {
    const response = await f.get(path);
    assert.equal(response.status, 200);
    const ids: string[] = [];
    const pages: string[] = [];
    const layouts: Record<string, string> = {};
    await new HTMLRewriter()
      .on('main a', { element(element) {
        const match = /^\/objects\/([a-f0-9-]{36})$/.exec(element.getAttribute('href') ?? '');
        if (match) ids.push(match[1]!);
      } })
      .on('nav[aria-label="Object layout"] a', { element(element) {
        const href = element.getAttribute('href')!.replaceAll('&amp;', '&');
        layouts[new URL(href, f.origin).searchParams.get('layout')!] = href;
      } })
      .on('nav[aria-label="Object pages"] a', { element(element) {
        pages.push(element.getAttribute('href')!.replaceAll('&amp;', '&'));
      } })
      .transform(response).text();
    return { ids, pages, layouts };
  };

  assert.deepEqual((await browse('/')).ids, []);
  assert.deepEqual((await browse('/?focus=search')).ids, []);
  const first = await browse(`/?type=${task.id}&q=Needle`);
  assert.equal(first.ids.length, 50);
  const gallery = await browse(first.layouts.gallery!);
  assert.deepEqual(gallery.ids, first.ids);
  const second = await browse(gallery.pages[0]!);
  assert.equal(second.ids.length, 1);
  assert.deepEqual([...first.ids, ...second.ids].sort(), wanted.map(record => record.id).sort());
  assert.deepEqual((await browse(second.layouts.list!)).ids, second.ids);

  const trash = await browse(`/?type=${task.id}&q=Needle&trash=1&layout=gallery`);
  assert.deepEqual(trash.ids, [removedTask.id]);
  assert.deepEqual((await browse(trash.layouts.list!)).ids, [removedTask.id]);
  assert.equal((await f.get(`/?type=${task.id}&layout=board`)).status, 422);
});

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
  assert.deepEqual(f.objects.backlinks(targetId).links, [{ object: f.objects.getObjectSummary(sourceId) }]);
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

test('lookup searches the entire live collection by title and writing with literal wildcards and optional type scope', async t => {
  const f = await setup(t, async () => { throw new Error('Not used'); });
  const type = f.objects.createType('Research');
  const otherType = f.objects.createType('Other research');
  const older = f.objects.createObject({ typeId: type.id, title: 'Archive %_ title', body: 'A singular body needle.', properties: {} });
  f.objects.db.query('UPDATE objects SET updated_at = ? WHERE id = ?').run('2000-01-01T00:00:00.000Z', older.id);
  const wrongType = f.objects.createObject({ typeId: otherType.id, title: 'Archive %_ wrong type', body: 'A singular body needle.', properties: {} });
  const trashed = f.objects.createObject({ typeId: type.id, title: 'Archive %_ trash', body: 'A singular body needle.', properties: {} });
  f.objects.setTrashed(trashed.id, trashed.revision, true);
  for (let index = 0; index < 205; index++) f.objects.createObject({ typeId: PAGE_TYPE_ID, title: `Recent ${index}`, body: 'Ordinary writing', properties: {} });
  assert.equal(f.objects.listObjects({ limit: 200 }).some(record => record.id === older.id), false);
  for (const query of ['Archive', 'singular body needle', '%', '_']) {
    const response = await f.get(`/objects/lookup?q=${encodeURIComponent(query)}&typeId=${type.id}`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const result: unknown = await response.json();
    assert.ok(Value.Check(ObjectLookupSchema, result));
    assert.deepEqual(result, { items: [{ id: older.id, title: older.title, typeName: type.name }], truncated: false });
  }
  const untyped = await (await f.get('/objects/lookup?q=Archive')).json() as ObjectLookupResult;
  assert.deepEqual(new Set(untyped.items.map(item => item.id)), new Set([older.id, wrongType.id]));
  const empty = await (await f.get(`/objects/lookup?q=&typeId=${type.id}`)).json() as ObjectLookupResult;
  assert.equal(empty.items.length, 1);
  assert.equal(empty.items[0]!.id, older.id);
  for (let index = 0; index < 55; index++) f.objects.createObject({ typeId: type.id, title: `Archive typed overflow ${index}`, body: '', properties: {} });
  const typedOverflow = await (await f.get(`/objects/lookup?q=Archive&typeId=${type.id}`)).json() as ObjectLookupResult;
  assert.equal(typedOverflow.items.length, 50);
  assert.equal(typedOverflow.truncated, true);
  assert.ok(typedOverflow.items.every(item => item.typeName === type.name));
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
  const invalidQueries = [`q=${'x'.repeat(201)}`, 'q=a&q=b', 'typeId=not-a-uuid', 'typeId=', `typeId=${PAGE_TYPE_ID}&typeId=${TASK_TYPE_ID}`, 'limit=100', 'trash=1', 'conversation=not-an-id'];
  for (const query of invalidQueries) {
    const response = await f.get(`/objects/lookup?${query}`);
    assert.equal(response.status, 422, query);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(typeof (await response.json() as { error: string }).error, 'string');
  }
  const unknownType = await f.get(`/objects/lookup?typeId=${randomUUID()}`);
  assert.equal(unknownType.status, 404);
  assert.equal(unknownType.headers.get('cache-control'), 'no-store');
  assert.equal(typeof (await unknownType.json() as { error: string }).error, 'string');
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
    const sources = catalog.types.filter(type => type.propertyIds.includes(TASK_DUE_PROPERTY_ID)).map(type => ({ typeId: type.id, bindings: { date: TASK_DUE_PROPERTY_ID } }));
    return { model: 'fixture/contract', spec: { title: 'Schedule', blocks: [{ title: 'Scheduled work', component: 'calendar', sources, editable: true }] } };
  });
  const task = f.objects.getType(TASK_TYPE_ID);
  const property = f.objects.getProperty(TASK_DUE_PROPERTY_ID);
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

test('published input boards offer reference action choices from the binding target type only', async t => {
  const f = await setup(t, async () => { throw new Error('Not used'); });
  const projectType = f.objects.createType('Project');
  const personType = f.objects.createType('Person');
  let workType = f.objects.createType('Work');
  workType = f.objects.addProperty(workType.id, workType.revision, { label: 'Project', kind: 'reference', targetTypeId: projectType.id });
  workType = f.objects.addProperty(workType.id, workType.revision, { label: 'Assignee', kind: 'reference', targetTypeId: personType.id });
  const [projectProperty, assigneeProperty] = workType.propertyIds as [string, string];
  const project = f.objects.createObject({ typeId: projectType.id, title: 'Website', body: '', properties: {} });
  const alice = f.objects.createObject({ typeId: personType.id, title: 'Alice', body: '', properties: {} });
  const bob = f.objects.createObject({ typeId: personType.id, title: 'Bob', body: '', properties: {} });
  const work = f.objects.createObject({ typeId: workType.id, title: 'Build launch page', body: '', properties: { [projectProperty]: project.id, [assigneeProperty]: alice.id } });
  const draft = f.views.create({ model: 'fixture/contract', spec: {
    title: 'Project board',
    input: { label: 'Project', typeId: projectType.id },
    blocks: [{
      title: 'Work by assignee', component: 'board', editable: true,
      columns: [{ role: 'project', label: 'Project' }],
      sources: [{ typeId: workType.id, bindings: { group: assigneeProperty, project: projectProperty }, where: [{ propertyId: projectProperty, operator: 'equals', value: { input: true } }] }],
    }],
  } }, 'Show project work by assignee');
  const view = f.views.publish(draft.id, draft.revision);
  const response = await f.get(`/views/${view.id}?input=${project.id}`);
  assert.equal(response.status, 200);
  const markup = await response.text();
  assert.deepEqual(selectOptions(markup, 'value').map(option => option.id).sort(), [alice.id, bob.id].sort());
  assert.deepEqual(selectOptions(markup, 'input').map(option => option.id), [project.id]);
  const controls = await referenceSearchControls(markup);
  const inputButton = controls.buttons.find(item => controls.selects.get(item.target) === 'input');
  assert.ok(inputButton);
  assert.equal(inputButton.typeId, projectType.id);
  const actionButton = controls.buttons.find(item => controls.selects.get(item.target) === 'value');
  assert.ok(actionButton);
  assert.equal(actionButton.typeId, personType.id);
  assert.equal((await f.post(`/views/${view.id}/act`, {
    revision: String(view.revision), objectId: work.id, objectRevision: String(work.revision), blockIndex: '0', role: 'group', inputId: project.id, value: bob.id,
  })).status, 303);
  assert.equal(f.objects.getObject(work.id).properties[assigneeProperty], bob.id);
  assert.equal((await f.post(`/views/${view.id}/act`, {
    revision: String(view.revision), objectId: work.id, objectRevision: String(work.revision), blockIndex: '0', role: 'group', inputId: bob.id, value: alice.id,
  })).status, 422);
});

test('published boards bound reference choices per target type and retain selected references', async t => {
  const f = await setup(t, async () => { throw new Error('Not used'); });
  const personType = f.objects.createType('Board people');
  const milestoneType = f.objects.createType('Milestones');
  let workType = f.objects.createType('Board work');
  workType = f.objects.addProperty(workType.id, workType.revision, { label: 'Assignee', kind: 'reference', targetTypeId: personType.id });
  workType = f.objects.addProperty(workType.id, workType.revision, { label: 'Milestone', kind: 'reference', targetTypeId: milestoneType.id });
  const [assigneeProperty, milestoneProperty] = workType.propertyIds as [string, string];
  for (let index = 0; index < 205; index++) f.objects.createObject({ typeId: PAGE_TYPE_ID, title: `Crowd ${index}`, body: '', properties: {} });
  f.objects.db.query('UPDATE objects SET updated_at = ? WHERE type_id = ?').run('2099-01-01T00:00:00Z', PAGE_TYPE_ID);
  const retained = f.objects.createObject({ typeId: personType.id, title: 'Retained assignee', body: '', properties: {} });
  const trashed = f.objects.createObject({ typeId: personType.id, title: 'Former assignee', body: '', properties: {} });
  for (let index = 0; index < 205; index++) f.objects.createObject({ typeId: personType.id, title: `Person ${index}`, body: '', properties: {} });
  const milestone = f.objects.createObject({ typeId: milestoneType.id, title: 'Beta', body: '', properties: {} });
  f.objects.db.query('UPDATE objects SET updated_at = ? WHERE id IN (?, ?)').run('2000-01-01T00:00:00Z', retained.id, trashed.id);
  const activePeople = f.objects.listObjects({ typeId: personType.id, limit: 200 }).map(item => item.id);
  assert.equal(activePeople.length, 200);
  assert.ok(!activePeople.includes(retained.id));
  assert.ok(!activePeople.includes(trashed.id));
  const retainedWork = f.objects.createObject({ typeId: workType.id, title: 'Retained work', body: '', properties: { [assigneeProperty]: retained.id, [milestoneProperty]: milestone.id } });
  f.objects.createObject({ typeId: workType.id, title: 'Former work', body: '', properties: { [assigneeProperty]: trashed.id, [milestoneProperty]: milestone.id } });
  f.objects.setTrashed(trashed.id, trashed.revision, true);
  const draft = f.views.create({ model: 'fixture/contract', spec: {
    title: 'Reference board',
    blocks: [{ title: 'Assignments', component: 'board', editable: true, columns: [{ role: 'milestone', label: 'Milestone' }], sources: [{ typeId: workType.id, bindings: { group: assigneeProperty, milestone: milestoneProperty } }] }],
  } }, 'Show assignments');
  const view = f.views.publish(draft.id, draft.revision);
  const response = await f.get(`/views/${view.id}`);
  assert.equal(response.status, 200);
  const markup = await response.text();
  const choices = selectOptions(markup, 'value');
  const choiceIds = choices.map(option => option.id);
  const uniqueChoiceIds = [...new Set(choiceIds)];
  assert.equal(uniqueChoiceIds.length, 202);
  assert.deepEqual(uniqueChoiceIds.filter(id => activePeople.includes(id)).sort(), activePeople.sort());
  assert.ok(uniqueChoiceIds.includes(retained.id));
  assert.ok(uniqueChoiceIds.includes(trashed.id));
  assert.ok(!uniqueChoiceIds.includes(milestone.id));
  assert.deepEqual(choices.filter(option => option.selected).map(option => option.id).sort(), [retained.id, trashed.id].sort());
  const target = activePeople[0]!;
  assert.equal((await f.post(`/views/${view.id}/act`, {
    revision: String(view.revision), objectId: retainedWork.id, objectRevision: String(retainedWork.revision), blockIndex: '0', role: 'group', value: target,
  })).status, 303);
  assert.equal(f.objects.getObject(retainedWork.id).properties[assigneeProperty], target);
  assert.equal(f.objects.getObject(retainedWork.id).properties[milestoneProperty], milestone.id);
  assert.equal((await f.post(`/views/${view.id}/act`, {
    revision: String(view.revision), objectId: retainedWork.id, objectRevision: String(retainedWork.revision), blockIndex: '0', role: 'group', value: activePeople[1]!,
  })).status, 409);
});

test('view reference candidate lookup rethrows unexpected selected-link failures', async t => {
  const f = await setup(t, async () => { throw new Error('Not used'); });
  const personType = f.objects.createType('Failure people');
  let workType = f.objects.createType('Failure work');
  workType = f.objects.addProperty(workType.id, workType.revision, { label: 'Assignee', kind: 'reference', targetTypeId: personType.id });
  const assigneeProperty = workType.propertyIds[0]!;
  const retained = f.objects.createObject({ typeId: personType.id, title: 'Retained assignee', body: '', properties: {} });
  for (let index = 0; index < 205; index++) f.objects.createObject({ typeId: personType.id, title: `Candidate ${index}`, body: '', properties: {} });
  f.objects.db.query('UPDATE objects SET updated_at = ? WHERE id = ?').run('2000-01-01T00:00:00Z', retained.id);
  assert.ok(!f.objects.listObjects({ typeId: personType.id, limit: 200 }).some(record => record.id === retained.id));
  f.objects.createObject({ typeId: workType.id, title: 'Retained work', body: '', properties: { [assigneeProperty]: retained.id } });
  const draft = f.views.create({ model: 'fixture/contract', spec: {
    title: 'Failure board',
    blocks: [{ title: 'Assignments', component: 'board', editable: true, sources: [{ typeId: workType.id, bindings: { group: assigneeProperty } }] }],
  } }, 'Show assignments');
  const view = f.views.publish(draft.id, draft.revision);
  const original = f.objects.getObjectSummary.bind(f.objects);
  f.objects.getObjectSummary = (id: string) => {
    if (id === retained.id) throw new AppError(503, 'Selected reference lookup failed.');
    return original(id);
  };
  const response = await f.get(`/views/${view.id}`);
  assert.equal(response.status, 503);
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
  const f = await setup(t, async prompt => ({
    model: 'fixture/contract', spec: { title: prompt, blocks: [{ title: 'Pages', component: 'list', sources: [{ typeId: PAGE_TYPE_ID, bindings: {} }] }] },
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
  const f = await setup(t, async () => {
    calls++;
    if (unavailable) throw new AppError(503, 'Provider unavailable');
    return { model: 'fixture/contract', spec: { title: 'Pages', blocks: [{ title: 'Pages', component: 'list', sources: [{ typeId: PAGE_TYPE_ID, bindings: {} }] }] } };
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
  const f = await setup(t, async () => ({
    model: 'fixture/contract', spec: { title: 'Pages', blocks: [{ title: 'Pages', component: 'list', sources: [{ typeId: PAGE_TYPE_ID, bindings: {} }] }] },
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

test('daily journal HTTP opening is idempotent and conflicts retain native writing', async t => {
  const f = await setup(t, async () => { throw new Error('Not used'); });
  const day = '2026-09-25';
  const page = await f.get(`/journal?date=${day}`);
  assert.equal(page.status, 200);
  assert.deepEqual(f.objects.listObjects({ typeId: JOURNAL_TYPE_ID }), []);
  const opened = await Promise.all([
    f.post('/journal/open', { date: day }),
    f.post('/journal/open', { date: day }),
  ]);
  assert.ok(opened.every(response => response.status === 303));
  const journals = f.objects.listObjects({ typeId: JOURNAL_TYPE_ID });
  assert.equal(journals.length, 1);
  const journal = journals[0]!;
  assert.ok(opened.every(response => response.headers.get('location')?.split('?')[0] === `/objects/${journal.id}`));
  const written = f.objects.updateObject(journal.id, journal.revision, { ...journal, body: 'Original daily writing' });
  const draft = { requestId: randomUUID(), typeId: JOURNAL_TYPE_ID, title: 'Keep my draft', body: 'Unsaved **different** writing', [`p:${JOURNAL_DATE_PROPERTY_ID}`]: day };
  const duplicate = await f.post('/objects/create', draft);
  assert.equal(duplicate.status, 409);
  const retained = nativeObjectFields(await duplicate.text());
  assert.equal(retained.title, draft.title);
  assert.equal(retained.body, draft.body);
  assert.equal(retained.requestId, draft.requestId);
  assert.deepEqual(f.objects.getObject(journal.id), written);
  const trashed = f.objects.setTrashed(written.id, written.revision, true);
  assert.equal((await f.post('/journal/open', { date: day })).status, 303);
  assert.deepEqual(f.objects.getObject(journal.id), trashed);
  assert.equal((await f.post(`/objects/${journal.id}/restore`, { revision: String(trashed.revision) })).status, 303);
  assert.equal(f.objects.getObject(journal.id).body, written.body);
  assert.equal((await f.post('/journal/open', { date: '2026-02-30' })).status, 422);
  assert.equal((await f.post('/journal/open', { date: day, csrf: 'wrong' })).status, 403);
});

test('Tasks shortcut follows the built-in identity after renaming and type copies stay independent', async t => {
  const f = await setup(t, async () => { throw new Error('Not used'); });
  const task = f.objects.getType(TASK_TYPE_ID);
  f.objects.renameType(task.id, task.revision, 'Actions');
  const other = f.objects.createType('Task');
  const canonical = f.objects.createObject({ typeId: TASK_TYPE_ID, title: 'Canonical action', body: '', properties: {} });
  const custom = f.objects.createObject({ typeId: other.id, title: 'Custom task', body: '', properties: {} });
  const browse = await (await f.get('/tasks')).text();
  assert.ok(browse.includes(`/objects/${canonical.id}`));
  assert.equal(browse.includes(`/objects/${custom.id}`), false);
  const copied = await f.post('/types/create', { name: 'Work item', basedOnTypeId: TASK_TYPE_ID });
  assert.equal(copied.status, 303);
  const typeId = copied.headers.get('location')!.split('?')[0]!.split('/').at(-1)!;
  const created = await f.post('/objects/create', { typeId, title: 'Uses the shared date', body: '', [`p:${TASK_DUE_PROPERTY_ID}`]: '2026-10-01' });
  assert.equal(created.status, 303);
  const objectId = created.headers.get('location')!.split('?')[0]!.split('/').at(-1)!;
  const date = f.objects.getProperty(TASK_DUE_PROPERTY_ID);
  f.objects.renameProperty(date.id, date.revision, 'Deadline');
  assert.equal(f.objects.getObject(objectId).properties[date.id], '2026-10-01');
});

test('native type switching retains multiple reference drafts until the selected type is saved', async t => {
  const f = await setup(t, async () => { throw new Error('Not used'); });
  let type = f.objects.createType('Reading session');
  type = f.objects.addProperty(type.id, type.revision, { label: 'Pages', kind: 'reference', targetTypeId: PAGE_TYPE_ID, multiple: true });
  const propertyId = type.propertyIds[0]!;
  const pages = ['First page', 'Second page'].map(title => f.objects.createObject({ typeId: PAGE_TYPE_ID, title, body: '', properties: {} }));
  for (let index = 0; index < 205; index++) f.objects.createObject({ typeId: TASK_TYPE_ID, title: `Unrelated ${index}`, body: '', properties: {} });
  f.objects.db.query('UPDATE objects SET updated_at = ? WHERE type_id = ?').run('2099-01-01T00:00:00Z', TASK_TYPE_ID);
  const draft = { title: 'Unfinished session', body: 'Keep both links and this writing.', requestId: randomUUID() };
  const send = (fields: URLSearchParams) => {
    fields.set('csrf', f.visitor.csrf);
    return fetch(f.origin + '/objects/create', { method: 'POST', headers: { Cookie: `taskdesk=${f.visitor.id}`, Origin: f.origin }, body: fields, redirect: 'manual' });
  };
  const away = new URLSearchParams({ ...draft, typeId: PAGE_TYPE_ID, intent: 'change-type' });
  for (const page of pages) away.append(`p:${propertyId}`, page.id);
  const changed = await send(away);
  assert.equal(changed.status, 200);
  const back = new URLSearchParams({ ...draft, typeId: type.id, intent: 'change-type' });
  await new HTMLRewriter().on('input[data-inactive-draft]', {
    element(element) { back.append(element.getAttribute('name')!, element.getAttribute('value')!); },
  }).transform(changed).text();
  const returned = await send(back);
  assert.equal(returned.status, 200);
  assert.deepEqual(new Set(f.objects.listObjects({ typeId: PAGE_TYPE_ID }).map(record => record.id)), new Set(pages.map(record => record.id)));
  const save = new URLSearchParams({ ...draft, typeId: type.id });
  await new HTMLRewriter().on(`select[name="p:${propertyId}"] option[selected]`, {
    element(element) { save.append(`p:${propertyId}`, element.getAttribute('value')!); },
  }).transform(returned).text();
  const created = await send(save);
  assert.equal(created.status, 303);
  const id = created.headers.get('location')!.split('?')[0]!.split('/').at(-1)!;
  const saved = f.objects.getObject(id);
  assert.deepEqual(new Set(saved.properties[propertyId] as string[]), new Set(pages.map(page => page.id)));
  assert.equal(saved.body, draft.body);
});

test('case-insensitive reference display uses canonical links and labels without rewriting stored values', async t => {
  const f = await setup(t, async () => { throw new Error('Not used'); });
  const targetType = f.objects.createType('Case targets');
  let sourceType = f.objects.createType('Case source');
  sourceType = f.objects.addProperty(sourceType.id, sourceType.revision, { label: 'Single', kind: 'reference', targetTypeId: targetType.id });
  sourceType = f.objects.addProperty(sourceType.id, sourceType.revision, { label: 'Multiple', kind: 'reference', targetTypeId: targetType.id, multiple: true });
  const [single, multiple] = sourceType.propertyIds as [string, string];
  const target = f.objects.createObject({ typeId: targetType.id, title: 'Uppercase Target', body: '', properties: {} });
  const outside = f.objects.createObject({ typeId: targetType.id, title: 'Old retained target', body: '', properties: {} });
  const upperTarget = target.id.toUpperCase();
  const upperOutside = outside.id.toUpperCase();
  const requestId = randomUUID();
  let source = f.objects.createObject({ typeId: sourceType.id, title: 'Source', body: '', properties: { [single]: upperTarget, [multiple]: [upperTarget, upperOutside] } }, requestId);
  source = f.objects.updateObject(source.id, source.revision, { typeId: source.typeId, title: source.title, body: source.body, properties: { [single]: upperTarget, [multiple]: [upperTarget, upperOutside] } });
  for (let index = 0; index < 205; index++) f.objects.createObject({ typeId: targetType.id, title: `New candidate ${index}`, body: '', properties: {} });
  f.objects.db.query('UPDATE objects SET updated_at = ? WHERE type_id = ? AND id != ?').run('2099-01-01T00:00:00Z', targetType.id, outside.id);
  f.objects.setTrashed(outside.id, outside.revision, true);

  const receiptBefore = f.objects.db.query<{ fingerprint: string; object_id: string }, [string]>('SELECT fingerprint, object_id FROM object_create_requests WHERE request_id = ?').get(requestId)!;
  const savedBefore = f.objects.getObject(source.id);
  const snapshotBefore = f.objects.db.query<{ snapshot_json: string }, [string]>('SELECT snapshot_json FROM object_revisions WHERE object_id = ? ORDER BY revision DESC LIMIT 1').get(source.id);
  assert.ok(snapshotBefore);
  assert.deepEqual(JSON.parse(snapshotBefore.snapshot_json).properties, { [single]: upperTarget, [multiple]: [upperTarget, upperOutside] });
  const objectMarkup = await (await f.get(`/objects/${source.id}`)).text();
  assert.deepEqual(f.objects.getObject(source.id), savedBefore);
  assert.deepEqual(f.objects.db.query<{ fingerprint: string; object_id: string }, [string]>('SELECT fingerprint, object_id FROM object_create_requests WHERE request_id = ?').get(requestId), receiptBefore);
  assert.deepEqual(f.objects.db.query<{ snapshot_json: string }, [string]>('SELECT snapshot_json FROM object_revisions WHERE object_id = ? ORDER BY revision DESC LIMIT 1').get(source.id), snapshotBefore);

  assert.equal((await f.get(`/objects/${target.id}`)).status, 200);
  assert.equal((await f.get(`/objects/${upperTarget}`)).status, 404);

  const singleOptions = referenceOptions(objectMarkup, single);
  assert.deepEqual(singleOptions.filter(option => option.id.toLowerCase() === target.id).map(option => option.id), [target.id]);
  assert.deepEqual(singleOptions.filter(option => option.selected).map(option => option.label), ['Uppercase Target · Case targets']);
  const multipleOptions = referenceOptions(objectMarkup, multiple);
  assert.deepEqual(multipleOptions.filter(option => option.id.toLowerCase() === target.id && option.selected).map(option => option.id), [target.id]);
  assert.deepEqual(multipleOptions.filter(option => option.id.toLowerCase() === outside.id && option.selected).map(option => option.label), ['Old retained target']);

  const saved = f.objects.getObject(source.id);
  const unchangedFields = new URLSearchParams({ csrf: f.visitor.csrf, title: saved.title, body: saved.body, revision: String(saved.revision), [`p:${single}`]: target.id });
  unchangedFields.append(`p:${multiple}`, target.id);
  unchangedFields.append(`p:${multiple}`, outside.id);
  const unchanged = await fetch(`${f.origin}/objects/${source.id}/update`, { method: 'POST', headers: { Cookie: `taskdesk=${f.visitor.id}`, Origin: f.origin }, body: unchangedFields, redirect: 'manual' });
  assert.equal(unchanged.status, 303);
  const updated = f.objects.getObject(source.id);
  assert.deepEqual(updated.properties[multiple], [target.id, outside.id]);

  const invalid = '<script>alert(1)</script>';
  const rejected = await f.post(`/objects/${source.id}/update`, { title: 'Draft', body: '', revision: String(updated.revision), [`p:${single}`]: invalid });
  assert.equal(rejected.status, 422);
  const rejectedMarkup = await rejected.text();
  assert.equal(rejectedMarkup.includes(invalid), false);
  assert.ok(referenceOptions(rejectedMarkup, single).some(option => option.id.includes('&lt;script&gt;') && option.selected && option.label.includes('Linked object &lt;script&gt;')));
  assert.equal(f.objects.getObject(source.id).properties[single], target.id);
});

test('published views render uppercase reference values as working object links', async t => {
  const f = await setup(t, async () => { throw new Error('Not used'); });
  const targetType = f.objects.createType('View targets');
  let sourceType = f.objects.createType('View source');
  sourceType = f.objects.addProperty(sourceType.id, sourceType.revision, { label: 'Linked', kind: 'reference', targetTypeId: targetType.id });
  const propertyId = sourceType.propertyIds[0]!;
  const target = f.objects.createObject({ typeId: targetType.id, title: 'Linked title', body: '', properties: {} });
  f.objects.createObject({ typeId: sourceType.id, title: 'Source row', body: '', properties: { [propertyId]: target.id.toUpperCase() } });
  const draft = f.views.create({ model: 'fixture/reference', spec: { title: 'Reference table', blocks: [{ title: 'Sources', component: 'table' as const, columns: [{ role: 'linked', label: 'Linked' }], sources: [{ typeId: sourceType.id, bindings: { linked: propertyId } }] }] } }, 'Fixture references');
  const view = f.views.publish(draft.id, draft.revision);
  const markup = await (await f.get(`/views/${view.id}`)).text();
  const links: string[] = [];
  let linkedText = '';
  new HTMLRewriter()
    .on('td .reference-values a', { element(element) { links.push(element.getAttribute('href') ?? ''); }, text(text) { linkedText += text.text; } })
    .transform(markup);
  assert.deepEqual(links, [`/objects/${target.id}`]);
  assert.equal(linkedText, 'Linked title');
  assert.equal((await f.get(links[0]!)).status, 200);
});

test('native assistant forms distinguish browsing, explicit targets, and rejected submissions', async t => {
  const f = await setup(t, async () => { throw new Error('Must not generate'); });
  const generated = { model: 'fixture/intent', spec: { title: 'View A', blocks: [{ title: 'Pages', component: 'list' as const, sources: [{ typeId: PAGE_TYPE_ID, bindings: {} }] }] } };
  const saved = new ViewConversationService(f.objects.db, f.views).save(f.visitor.id, 'Fixture prompt', generated, {});
  const inspect = async (response: Response) => {
    const result = { intent: '', fields: {} as Record<string, string>, newHref: '', prompt: '' };
    await new HTMLRewriter()
      .on('[data-ai-form]', { element(e) { result.intent = e.getAttribute('data-ai-intent') ?? ''; } })
      .on('[data-ai-form] input', { element(e) { result.fields[e.getAttribute('name')!] = e.getAttribute('value')!; } })
      .on('[data-ai-form] textarea', { text(chunk) { result.prompt += chunk.text; } })
      .on('#ai-panel a[aria-label="Start a new conversation"]', { element(e) { result.newHref = e.getAttribute('href')!; } })
      .transform(response).text();
    return result;
  };
  const path = `/views/${saved.view.id}`;
  const ordinary = await inspect(await f.get(path));
  assert.equal(ordinary.intent, 'browse');
  assert.equal(ordinary.fields.previousId, saved.view.id);
  const refine = await inspect(await f.get(path + '?ai=1'));
  assert.equal(refine.intent, 'explicit');
  assert.equal(refine.fields.previousId, saved.view.id);
  assert.equal(refine.newHref, '/views?ai=1');
  const fresh = await inspect(await f.get('/views?ai=1'));
  assert.equal(fresh.intent, 'explicit');
  assert.equal(fresh.fields.previousId, undefined);
  assert.equal(fresh.fields.conversationId, undefined);
  const thread = await inspect(await f.get(path + '?conversation=' + saved.conversation.id));
  assert.equal(thread.intent, 'explicit');
  assert.equal(thread.fields.conversationId, saved.conversation.id);
  assert.equal(thread.fields.previousId, undefined);
  for (const prompt of ['', '  ', '\n  ']) {
    const rejected = await f.post('/views/generate', { prompt, previousId: saved.view.id });
    assert.equal(rejected.status, 422);
    const form = await inspect(rejected);
    assert.equal(form.intent, 'submitted');
    // HTML parsing removes the textarea's first newline.
    assert.equal(form.prompt.replace(/^\n/, ''), prompt);
    assert.equal(form.fields.previousId, saved.view.id);
  }
});

function selectOptions(markup: string, name: string) {
  const options: { id: string; selected: boolean; label: string }[] = [];
  let current: { id: string; selected: boolean; label: string } | undefined;
  new HTMLRewriter().on(`select[name="${name}"] option`, {
    element(element) {
      const id = element.getAttribute('value');
      current = id ? { id, selected: element.hasAttribute('selected'), label: '' } : undefined;
      if (current) options.push(current);
    },
    text(text) { if (current) current.label += text.text; },
  }).transform(markup);
  return options;
}

function referenceOptions(markup: string, propertyId: string) {
  return selectOptions(markup, `p:${propertyId}`);
}

async function referenceSearchControls(markup: string) {
  const selects = new Map<string, string>();
  const buttons: { target: string; typeId: string; label: string }[] = [];
  await new HTMLRewriter()
    .on('select', { element(element) {
      const id = element.getAttribute('id');
      const name = element.getAttribute('name');
      if (id && name) selects.set(id, name);
    } })
    .on('button[data-reference-search]', { element(element) {
      buttons.push({ target: element.getAttribute('data-reference-target') ?? '', typeId: element.getAttribute('data-reference-type') ?? '', label: element.getAttribute('aria-label') ?? '' });
    } })
    .transform(new Response(markup)).text();
  return { selects, buttons };
}

test('reference pickers bound each target type across new, edit, rejected and type-switch forms', async t => {
  const f = await setup(t, async () => { throw new Error('Not used'); });
  const targetType = f.objects.createType('Reference targets');
  let sourceType = f.objects.createType('Reference source');
  sourceType = f.objects.addProperty(sourceType.id, sourceType.revision, { label: 'Single', kind: 'reference', targetTypeId: targetType.id });
  sourceType = f.objects.addProperty(sourceType.id, sourceType.revision, { label: 'Multiple', kind: 'reference', targetTypeId: targetType.id, multiple: true });
  const [single, multiple] = sourceType.propertyIds as [string, string];
  const make = (typeId: string, title: string) => f.objects.createObject({ typeId, title, body: '', properties: {} });
  const target = make(targetType.id, 'Wanted target');
  for (let index = 0; index < 205; index++) make(PAGE_TYPE_ID, `Unrelated ${index}`);
  // Deterministically place unrelated records ahead of targets in the global query.
  f.objects.db.query('UPDATE objects SET updated_at = ? WHERE type_id = ?').run('2099-01-01T00:00:00Z', PAGE_TYPE_ID);
  const record = f.objects.createObject({ typeId: sourceType.id, title: 'Source', body: '', properties: {} });
  for (const path of [`/objects/new?type=${sourceType.id}`, '/objects/new', `/objects/${record.id}`]) {
    const response = await f.get(path);
    assert.equal(response.status, 200);
    const markup = await response.text();
    for (const property of [single, multiple]) assert.deepEqual(referenceOptions(markup, property).map(option => option.id), [target.id]);
    const controls = await referenceSearchControls(markup);
    for (const property of [single, multiple]) {
      const button = controls.buttons.find(item => controls.selects.get(item.target) === `p:${property}`);
      assert.ok(button, `missing search button for ${property}`);
      assert.equal(button.typeId, targetType.id);
      assert.match(button.label, /Find object/);
    }
  }
  for (const path of ['/objects/create', `/objects/${record.id}/update`]) {
    for (const intent of ['', 'change-type']) {
      const response = await f.post(path, { typeId: sourceType.id, title: '', body: 'Draft', ...(path.endsWith('update') ? { revision: '1' } : { requestId: randomUUID() }), intent });
      assert.equal(response.status, intent ? 200 : 422);
      const markup = await response.text();
      for (const property of [single, multiple]) assert.deepEqual(referenceOptions(markup, property).map(option => option.id), [target.id]);
    }
  }
  for (let index = 0; index < 205; index++) make(targetType.id, `Candidate ${index}`);
  f.objects.db.query('UPDATE objects SET updated_at = ? WHERE id = ?').run('2000-01-01T00:00:00Z', target.id);
  const candidates = f.objects.listObjects({ typeId: targetType.id, limit: 200 }).map(item => item.id);
  assert.ok(!candidates.includes(target.id));
  const markup = await (await f.get(`/objects/new?type=${sourceType.id}`)).text();
  assert.deepEqual(referenceOptions(markup, single).map(option => option.id), candidates);
  const selected = f.objects.updateObject(record.id, record.revision, { typeId: PAGE_TYPE_ID, title: 'Retained properties', body: '', properties: { [single]: target.id, [multiple]: [target.id] } });
  const edit = await (await f.get(`/objects/${record.id}`)).text();
  for (const property of [single, multiple]) {
    const options = referenceOptions(edit, property);
    assert.equal(options.length, 201);
    assert.deepEqual(options.filter(option => option.selected).map(option => option.id), [target.id]);
  }
  f.objects.setTrashed(target.id, target.revision, true);
  const trashed = await (await f.get(`/objects/${record.id}`)).text();
  assert.deepEqual(referenceOptions(trashed, single).filter(option => option.selected).map(option => option.id), [target.id]);
  const invalid = randomUUID();
  const fields = new URLSearchParams({ csrf: f.visitor.csrf, typeId: sourceType.id, title: '', body: 'Raw draft', revision: '1', [`p:${single}`]: target.id });
  fields.append(`p:${multiple}`, target.id);
  fields.append(`p:${multiple}`, invalid);
  const rejected = await fetch(`${f.origin}/objects/${record.id}/update`, { method: 'POST', headers: { Cookie: `taskdesk=${f.visitor.id}`, Origin: f.origin }, body: fields });
  assert.equal(rejected.status, 409);
  const rejectedMarkup = await rejected.text();
  assert.equal(nativeObjectFields(rejectedMarkup).revision, '1');
  assert.deepEqual(referenceOptions(rejectedMarkup, multiple).filter(option => option.selected).map(option => option.id), [target.id, invalid]);
  assert.equal(referenceOptions(rejectedMarkup, multiple).length, 202);
  assert.equal(f.objects.getObject(record.id).revision, selected.revision);
  const invalidCreate = await f.post('/objects/create', { typeId: sourceType.id, title: 'Invalid new link', body: '', requestId: randomUUID(), [`p:${single}`]: target.id });
  assert.equal(invalidCreate.status, 422);
});

test('submitted out-of-window reference drafts keep known labels on rejection and type switch', async t => {
  const f = await setup(t, async () => { throw new Error('Not used'); });
  const targetType = f.objects.createType('Label targets');
  let sourceType = f.objects.createType('Label source');
  sourceType = f.objects.addProperty(sourceType.id, sourceType.revision, { label: 'Linked', kind: 'reference', targetTypeId: targetType.id });
  sourceType = f.objects.addProperty(sourceType.id, sourceType.revision, { label: 'Count', kind: 'number' });
  const [referenceId, numberId] = sourceType.propertyIds as [string, string];
  const oldTarget = f.objects.createObject({ typeId: targetType.id, title: 'OLD TARGET LABEL', body: '', properties: {} });
  f.objects.db.query('UPDATE objects SET updated_at = ? WHERE id = ?').run('2000-01-01T00:00:00Z', oldTarget.id);
  for (let index = 0; index < 205; index++) f.objects.createObject({ typeId: targetType.id, title: `New label target ${index}`, body: '', properties: {} });
  assert.ok(!f.objects.listObjects({ typeId: targetType.id, limit: 200 }).some(record => record.id === oldTarget.id));
  const saved = f.objects.createObject({ typeId: PAGE_TYPE_ID, title: 'Saved source', body: 'Saved body', properties: {} });
  const requestId = randomUUID();
  const draft = { typeId: sourceType.id, title: 'Draft title', body: 'Unsaved body', [`p:${referenceId}`]: oldTarget.id };

  const assertRetained = async (response: Response, expectedStatus: number, expected: Record<string, string>) => {
    assert.equal(response.status, expectedStatus);
    const markup = await response.text();
    const fields = nativeObjectFields(markup);
    for (const [name, value] of Object.entries(expected)) assert.equal(fields[name], value, name);
    const selected = referenceOptions(markup, referenceId).filter(option => option.selected);
    assert.deepEqual(selected.map(option => option.id), [oldTarget.id]);
    assert.equal(selected[0]!.label, 'OLD TARGET LABEL · Label targets');
  };

  await assertRetained(await f.post('/objects/create', { requestId, ...draft, [`p:${numberId}`]: 'not a number' }), 422, { title: draft.title, body: draft.body, requestId });
  await assertRetained(await f.post('/objects/create', { requestId, ...draft, intent: 'change-type' }), 200, { title: draft.title, body: draft.body, requestId });
  assert.equal(f.objects.listObjects({ typeId: sourceType.id }).length, 0);

  await assertRetained(await f.post(`/objects/${saved.id}/update`, { revision: String(saved.revision), ...draft, [`p:${numberId}`]: 'not a number' }), 422, { title: draft.title, body: draft.body, revision: String(saved.revision) });
  await assertRetained(await f.post(`/objects/${saved.id}/update`, { revision: String(saved.revision), ...draft, intent: 'change-type' }), 200, { title: draft.title, body: draft.body, revision: String(saved.revision) });
  assert.deepEqual(f.objects.getObject(saved.id), saved);
});

test('maximum Unicode prompts fit the generation envelope with either context field', async t => {
  const received: string[] = [];
  const f = await setup(t, async prompt => {
    received.push(prompt);
    return { model: 'fixture/contract', spec: { title: 'Fixture view', blocks: [{ title: 'Pages', component: 'list', sources: [{ typeId: PAGE_TYPE_ID, bindings: {} }] }] } };
  });
  const first = await f.post('/views/generate', { prompt: 'Seed' }, 'application/json');
  assert.equal(first.status, 200);
  const context = await first.json() as { viewId: string; conversation: ViewConversation };
  for (const prompt of ['a'.repeat(4000), '界'.repeat(4000), '😀'.repeat(2000), ` ${'界'.repeat(3998)} `]) {
    assert.equal(prompt.length, 4000);
    for (const field of ['previousId', 'conversationId']) {
      const response = await f.post('/views/generate', { prompt, [field]: field === 'previousId' ? context.viewId : context.conversation.id }, 'application/json');
      assert.equal(response.status, 200);
      assert.equal(received.at(-1), prompt.trim());
    }
  }
  const count = f.views.list().length;
  const calls = received.length;
  const prompt = '界'.repeat(4001);
  const rejected = await f.post('/views/generate', { prompt });
  assert.equal(rejected.status, 422);
  let draft = '';
  await new HTMLRewriter().on('textarea[name="prompt"]', { text(chunk) { draft += chunk.text; } }).transform(rejected).text();
  // HTML parsing removes exactly the textarea's initial newline sentinel.
  assert.equal(draft.replace(/^\n/, ''), prompt);
  const payload = new URLSearchParams({ csrf: f.visitor.csrf, prompt: 'x'.repeat(40_000) }).toString();
  assert.equal((await f.post('/views/generate', { prompt: 'x'.repeat(40_000) })).status, 413);
  const streamed = await fetch(f.origin + '/views/generate', {
    method: 'POST', headers: { Cookie: `taskdesk=${f.visitor.id}`, Origin: f.origin, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new ReadableStream({ start(controller) {
      const bytes = new TextEncoder().encode(payload);
      controller.enqueue(bytes.slice(0, 20_000));
      controller.enqueue(bytes.slice(20_000));
      controller.close();
    } }),
  });
  assert.equal(streamed.status, 413);
  assert.equal(received.length, calls);
  assert.equal(f.views.list().length, count);
  const unchanged = await (await f.get(`/views/conversations/${context.conversation.id}`)).json() as ViewConversation;
  assert.equal(unchanged.turns.length, 5);
});

test('native history opens historical snapshots as same-object drafts without mutating until explicit save', async t => {
  const f = await setup(t, async () => { throw new Error('Not used'); });
  const holder = f.objects.createType('Historical property holder');
  const type = f.objects.addProperty(holder.id, holder.revision, { label: 'Historical note', kind: 'text' });
  const propertyId = type.propertyIds.at(-1)!;
  const before = f.objects.createObject({ typeId: PAGE_TYPE_ID, title: 'Before', properties: { [propertyId]: 'old value' }, body: 'Line 1\r\n\r\n**Keep source**.' });
  const current = f.objects.updateObject(before.id, before.revision, { typeId: PAGE_TYPE_ID, title: 'After', properties: {}, body: 'Current body' });
  const history = await f.get(`/objects/${before.id}/history?revision=${before.revision}`);
  assert.equal(history.status, 200);
  const historyMarkup = await history.text();
  assert.ok(historyMarkup.includes('Read-only history'));
  assert.ok(historyMarkup.includes('Exact Markdown source'));
  assert.ok(historyMarkup.includes('old value'));
  assert.ok(historyMarkup.includes('Open unsaved draft from revision 1'));
  assert.deepEqual(f.objects.getObject(before.id), current);
  const noCsrf = await f.post(`/objects/${before.id}/history/draft`, { csrf: 'bad', revision: String(before.revision), currentRevision: String(current.revision) });
  assert.equal(noCsrf.status, 403);
  assert.deepEqual(f.objects.getObject(before.id), current);
  const draft = await f.post(`/objects/${before.id}/history/draft`, { revision: String(before.revision), currentRevision: String(current.revision) });
  assert.equal(draft.status, 200);
  const fields = nativeObjectFields(await draft.text());
  assert.equal(fields.title, 'Before');
  assert.equal(fields.body, before.body);
  assert.equal(fields.revision, String(current.revision));
  assert.equal(fields.historyRevision, String(before.revision));
  assert.equal(fields[`p:${propertyId}`], 'old value');
  assert.deepEqual(f.objects.getObject(before.id), current);
  const emptyType = f.objects.createType('Empty target type');
  const switched = await f.post(`/objects/${before.id}/update`, {
    revision: fields.revision,
    historyRevision: fields.historyRevision,
    intent: 'change-type',
    typeId: emptyType.id,
    title: fields.title!,
    body: fields.body!,
    [`p:${propertyId}`]: fields[`p:${propertyId}`]!,
  });
  assert.equal(switched.status, 200);
  const switchedFields = nativeObjectFields(await switched.text());
  assert.equal(switchedFields.historyRevision, String(before.revision));
  assert.equal(switchedFields[`p:${propertyId}`], 'old value');
  assert.deepEqual(f.objects.getObject(before.id), current);
  const saved = await f.post(`/objects/${before.id}/update`, {
    revision: fields.revision,
    historyRevision: fields.historyRevision,
    typeId: PAGE_TYPE_ID,
    title: 'Recovered title',
    body: fields.body,
    [`p:${propertyId}`]: 'restored value',
  });
  assert.equal(saved.status, 303);
  const recovered = f.objects.getObject(before.id);
  assert.equal(recovered.id, before.id);
  assert.equal(recovered.revision, current.revision + 1);
  assert.equal(recovered.title, 'Recovered title');
  assert.equal(recovered.body, before.body);
  assert.equal(recovered.properties[propertyId], 'restored value');
  assert.equal(recovered.trashed, false);
});

test('history drafts keep stale expected revisions and reject forged history context', async t => {
  const f = await setup(t, async () => { throw new Error('Not used'); });
  const holder = f.objects.createType('Past property holder');
  const type = f.objects.addProperty(holder.id, holder.revision, { label: 'Past field', kind: 'text' });
  const propertyId = type.propertyIds.at(-1)!;
  const before = f.objects.createObject({ typeId: PAGE_TYPE_ID, title: 'Before', properties: { [propertyId]: 'past' }, body: 'Past body' });
  const current = f.objects.updateObject(before.id, before.revision, { typeId: PAGE_TYPE_ID, title: 'Current', properties: {}, body: 'Current body' });
  const other = f.objects.createObject({ typeId: PAGE_TYPE_ID, title: 'Other', properties: { [propertyId]: 'other' }, body: '' });
  const otherChanged = f.objects.updateObject(other.id, other.revision, { ...other, title: 'Other changed' });
  const otherCurrent = f.objects.updateObject(otherChanged.id, otherChanged.revision, { ...otherChanged, title: 'Other changed again' });
  const concurrent = f.objects.updateObject(current.id, current.revision, { ...current, title: 'Concurrent' });
  const staleDraft = await f.post(`/objects/${before.id}/history/draft`, { revision: String(before.revision), currentRevision: String(current.revision) });
  assert.equal(staleDraft.status, 200);
  const staleMarkup = await staleDraft.text();
  assert.ok(staleMarkup.includes('Compare before saving'));
  const staleFields = nativeObjectFields(staleMarkup);
  assert.equal(staleFields.revision, String(current.revision));
  assert.equal(staleFields.historyRevision, String(before.revision));
  assert.equal(staleFields[`p:${propertyId}`], 'past');
  assert.deepEqual(f.objects.getObject(before.id), concurrent);
  const rejected = await f.post(`/objects/${before.id}/update`, {
    revision: staleFields.revision!,
    historyRevision: staleFields.historyRevision!,
    typeId: PAGE_TYPE_ID,
    title: staleFields.title!,
    body: staleFields.body!,
    [`p:${propertyId}`]: staleFields[`p:${propertyId}`]!,
  });
  assert.equal(rejected.status, 409);
  const rejectedMarkup = await rejected.text();
  assert.ok(rejectedMarkup.includes('Compare before saving'));
  assert.ok(rejectedMarkup.includes('past'));
  assert.deepEqual(f.objects.getObject(before.id), concurrent);
  const forged = await f.post(`/objects/${before.id}/update`, {
    revision: String(concurrent.revision),
    historyRevision: String(otherCurrent.revision),
    typeId: PAGE_TYPE_ID,
    title: 'Forged',
    body: '',
    [`p:${propertyId}`]: 'forged',
  });
  assert.equal(forged.status, 404);
  assert.deepEqual(f.objects.getObject(before.id), concurrent);
  assert.deepEqual(f.objects.getObject(other.id), otherCurrent);
});

test('history recovery uses current reference and journal validation with atomic backlinks', async t => {
  const f = await setup(t, async () => { throw new Error('Not used'); });
  const people = f.objects.createType('History person');
  const ada = f.objects.createObject({ typeId: people.id, title: 'Ada', properties: {}, body: '' });
  const grace = f.objects.createObject({ typeId: people.id, title: 'Grace', properties: {}, body: '' });
  const holder = f.objects.createType('Reference holder');
  const withReference = f.objects.addProperty(holder.id, holder.revision, { label: 'Historical people', kind: 'reference', targetTypeId: people.id, multiple: true });
  const referenceId = withReference.propertyIds.at(-1)!;
  const before = f.objects.createObject({ typeId: PAGE_TYPE_ID, title: 'Referenced past', properties: { [referenceId]: [ada.id] }, body: '' });
  const current = f.objects.updateObject(before.id, before.revision, { ...before, properties: {} });
  assert.equal(f.objects.backlinks(ada.id).links.length, 0);
  f.objects.setTrashed(grace.id, grace.revision, true);
  const invalid = await f.post(`/objects/${before.id}/update`, {
    revision: String(current.revision),
    historyRevision: String(before.revision),
    typeId: PAGE_TYPE_ID,
    title: 'Invalid reference restore',
    body: '',
    [`p:${referenceId}`]: grace.id,
  });
  assert.equal(invalid.status, 422);
  assert.equal(f.objects.getObject(before.id).revision, current.revision);
  assert.equal(f.objects.backlinks(grace.id).links.length, 0);
  const valid = await f.post(`/objects/${before.id}/update`, {
    revision: String(current.revision),
    historyRevision: String(before.revision),
    typeId: PAGE_TYPE_ID,
    title: 'Valid reference restore',
    body: '',
    [`p:${referenceId}`]: ada.id,
  });
  assert.equal(valid.status, 303);
  const recovered = f.objects.getObject(before.id);
  assert.deepEqual(recovered.properties[referenceId], [ada.id]);
  assert.equal(f.objects.backlinks(ada.id).links.length, 1);

  const first = f.objects.openJournal('2026-09-25');
  const second = f.objects.openJournal('2026-09-26');
  const firstEdited = f.objects.updateObject(first.id, first.revision, { ...first, title: 'Past journal' });
  const firstCurrent = f.objects.updateObject(firstEdited.id, firstEdited.revision, { ...firstEdited, properties: { [JOURNAL_DATE_PROPERTY_ID]: '2026-09-27' } });
  const conflict = await f.post(`/objects/${first.id}/update`, {
    revision: String(firstCurrent.revision),
    historyRevision: String(firstEdited.revision),
    typeId: JOURNAL_TYPE_ID,
    title: 'Restore occupied day',
    body: firstEdited.body,
    [`p:${JOURNAL_DATE_PROPERTY_ID}`]: second.properties[JOURNAL_DATE_PROPERTY_ID] as string,
  });
  assert.equal(conflict.status, 409);
  assert.equal(f.objects.getObject(first.id).revision, firstCurrent.revision);
});

test('history refuses multiline historical text values without lossy drafts or mutations', async t => {
  const f = await setup(t, async () => { throw new Error('Not used'); });
  const holder = f.objects.createType('Multiline history holder');
  const withProperty = f.objects.addProperty(holder.id, holder.revision, { label: 'Historical text', kind: 'text' });
  const propertyId = withProperty.propertyIds.at(-1)!;
  const emptyType = f.objects.createType('Empty multiline target');
  const snapshots = () => f.objects.db.query('SELECT * FROM object_revisions ORDER BY object_id, revision').all();
  const receipts = () => f.objects.db.query('SELECT * FROM object_create_requests ORDER BY request_id').all();

  for (const value of ['first\nsecond', 'first\r\nsecond']) {
    const before = f.objects.createObject({ typeId: PAGE_TYPE_ID, title: `Has multiline ${value.length}`, properties: { [propertyId]: value }, body: 'copy multiline source' }, randomUUID());
    const current = f.objects.updateObject(before.id, before.revision, { ...before, properties: {}, body: 'current multiline' });
    const beforeSnapshots = snapshots();
    const beforeReceipts = receipts();
    const beforeBacklinks = f.objects.backlinks(before.id);

    const history = await f.get(`/objects/${before.id}/history?revision=${before.revision}`);
    assert.equal(history.status, 200);
    const historyMarkup = await history.text();
    assert.ok(historyMarkup.includes('Historical text'));
    assert.ok(historyMarkup.includes('copy multiline source'));
    assert.ok(historyMarkup.includes('will not open a lossy restore draft'));
    assert.equal(historyMarkup.includes('Open unsaved draft'), false);

    const draft = await f.post(`/objects/${before.id}/history/draft`, { revision: String(before.revision), currentRevision: String(current.revision) });
    assert.equal(draft.status, 422);
    const draftMarkup = await draft.text();
    assert.ok(draftMarkup.includes('copy multiline source'));
    assert.ok(draftMarkup.includes('will not open a lossy restore draft'));
    assert.equal(draftMarkup.includes('data-object-editor'), false);

    const switched = await f.post(`/objects/${before.id}/update`, {
      revision: String(current.revision),
      historyRevision: String(before.revision),
      intent: 'change-type',
      typeId: emptyType.id,
      title: 'Switch refused',
      body: 'draft body',
      [`p:${propertyId}`]: value,
    });
    assert.equal(switched.status, 422);
    assert.ok((await switched.text()).includes('will not open a lossy restore draft'));

    const saved = await f.post(`/objects/${before.id}/update`, {
      revision: String(current.revision),
      historyRevision: String(before.revision),
      typeId: PAGE_TYPE_ID,
      title: 'Save refused',
      body: 'draft body',
      [`p:${propertyId}`]: value.replace(/\r?\n/g, ''),
    });
    assert.equal(saved.status, 422);
    assert.ok((await saved.text()).includes('will not open a lossy restore draft'));
    assert.deepEqual(f.objects.getObject(before.id), current);
    assert.deepEqual(snapshots(), beforeSnapshots);
    assert.deepEqual(receipts(), beforeReceipts);
    assert.deepEqual(f.objects.backlinks(before.id), beforeBacklinks);
  }
});

test('history refuses unavailable historical schemas without lossy drafts or mutations', async t => {
  const f = await setup(t, async () => { throw new Error('Not used'); });
  const holder = f.objects.createType('Unavailable property holder');
  const withProperty = f.objects.addProperty(holder.id, holder.revision, { label: 'Removed later', kind: 'text' });
  const propertyId = withProperty.propertyIds.at(-1)!;
  const before = f.objects.createObject({ typeId: PAGE_TYPE_ID, title: 'Has removed field', properties: { [propertyId]: 'copy me' }, body: 'copy source' });
  const current = f.objects.updateObject(before.id, before.revision, { ...before, properties: {}, body: 'current' });
  const beforeRows = f.objects.db.query('SELECT * FROM object_revisions ORDER BY revision').all();
  f.objects.db.query('DELETE FROM object_properties WHERE id = ?').run(propertyId);

  const history = await f.get(`/objects/${before.id}/history?revision=${before.revision}`);
  assert.equal(history.status, 200);
  const historyMarkup = await history.text();
  assert.ok(historyMarkup.includes('Unavailable property'));
  assert.ok(historyMarkup.includes('copy me'));
  assert.ok(historyMarkup.includes('copy source'));
  assert.ok(historyMarkup.includes('will not open a lossy restore draft'));
  assert.equal(historyMarkup.includes('Open unsaved draft'), false);

  const draft = await f.post(`/objects/${before.id}/history/draft`, { revision: String(before.revision), currentRevision: String(current.revision) });
  assert.equal(draft.status, 422);
  const draftMarkup = await draft.text();
  assert.ok(draftMarkup.includes('copy me'));
  assert.ok(draftMarkup.includes('will not open a lossy restore draft'));
  assert.equal(draftMarkup.includes('data-object-editor'), false);
  assert.deepEqual(f.objects.getObject(before.id), current);
  assert.deepEqual(f.objects.db.query('SELECT * FROM object_revisions ORDER BY revision').all(), beforeRows);

  const type = f.objects.createType('Removed historical type');
  const typed = f.objects.createObject({ typeId: type.id, title: 'Old type', properties: {}, body: 'typed source' });
  const typedCurrent = f.objects.updateObject(typed.id, typed.revision, { ...typed, typeId: PAGE_TYPE_ID });
  f.objects.db.query('DELETE FROM object_types WHERE id = ?').run(type.id);
  const typedHistory = await f.get(`/objects/${typed.id}/history?revision=${typed.revision}`);
  assert.equal(typedHistory.status, 200);
  const typedMarkup = await typedHistory.text();
  assert.ok(typedMarkup.includes('Unavailable type'));
  assert.ok(typedMarkup.includes('typed source'));
  assert.equal(typedMarkup.includes('Open unsaved draft'), false);
  const typedDraft = await f.post(`/objects/${typed.id}/history/draft`, { revision: String(typed.revision), currentRevision: String(typedCurrent.revision) });
  assert.equal(typedDraft.status, 422);
  assert.deepEqual(f.objects.getObject(typed.id), typedCurrent);

  const kindHolder = f.objects.createType('Changed kind holder');
  const withText = f.objects.addProperty(kindHolder.id, kindHolder.revision, { label: 'Changed kind', kind: 'text' });
  const changedKindId = withText.propertyIds.at(-1)!;
  const kindBefore = f.objects.createObject({ typeId: PAGE_TYPE_ID, title: 'Changed kind before', properties: { [changedKindId]: 'Unrepresentable text' }, body: 'changed kind source' });
  const kindCurrent = f.objects.updateObject(kindBefore.id, kindBefore.revision, { ...kindBefore, properties: {} });
  f.objects.db.query('UPDATE object_properties SET kind = ? WHERE id = ?').run('number', changedKindId);
  const kindHistory = await f.get(`/objects/${kindBefore.id}/history?revision=${kindBefore.revision}`);
  assert.equal(kindHistory.status, 200);
  const kindMarkup = await kindHistory.text();
  assert.ok(kindMarkup.includes('Unrepresentable text'));
  assert.ok(kindMarkup.includes('changed kind source'));
  assert.ok(kindMarkup.includes('will not open a lossy restore draft'));
  const kindDraft = await f.post(`/objects/${kindBefore.id}/history/draft`, { revision: String(kindBefore.revision), currentRevision: String(kindCurrent.revision) });
  assert.equal(kindDraft.status, 422);
  assert.deepEqual(f.objects.getObject(kindBefore.id), kindCurrent);

  const selectHolder = f.objects.createType('Removed option holder');
  const withSelect = f.objects.addProperty(selectHolder.id, selectHolder.revision, { label: 'Removed option', kind: 'select', options: ['Keep', 'Remove'] });
  const selectPropertyId = withSelect.propertyIds.at(-1)!;
  const removedOption = f.objects.getProperty(selectPropertyId).options!.find(option => option.label === 'Remove')!;
  const keepOption = f.objects.getProperty(selectPropertyId).options!.find(option => option.label === 'Keep')!;
  const selectBefore = f.objects.createObject({ typeId: PAGE_TYPE_ID, title: 'Removed option before', properties: { [selectPropertyId]: removedOption.id }, body: 'removed option source' });
  const selectCurrent = f.objects.updateObject(selectBefore.id, selectBefore.revision, { ...selectBefore, properties: {} });
  f.objects.db.query('UPDATE object_properties SET options_json = ? WHERE id = ?').run(JSON.stringify([keepOption]), selectPropertyId);
  const selectHistory = await f.get(`/objects/${selectBefore.id}/history?revision=${selectBefore.revision}`);
  assert.equal(selectHistory.status, 200);
  const selectMarkup = await selectHistory.text();
  assert.ok(selectMarkup.includes(removedOption.id));
  assert.ok(selectMarkup.includes('removed option source'));
  assert.ok(selectMarkup.includes('will not open a lossy restore draft'));
  const selectDraft = await f.post(`/objects/${selectBefore.id}/history/draft`, { revision: String(selectBefore.revision), currentRevision: String(selectCurrent.revision) });
  assert.equal(selectDraft.status, 422);
  assert.deepEqual(f.objects.getObject(selectBefore.id), selectCurrent);
});

test('history HTTP boundaries reject unsupported query and forged draft context', async t => {
  const f = await setup(t, async () => { throw new Error('Not used'); });
  const holder = f.objects.createType('Boundary holder');
  const withProperty = f.objects.addProperty(holder.id, holder.revision, { label: 'Boundary field', kind: 'text' });
  const propertyId = withProperty.propertyIds.at(-1)!;
  const before = f.objects.createObject({ typeId: PAGE_TYPE_ID, title: 'Boundary before', properties: { [propertyId]: 'past' }, body: '' });
  const current = f.objects.updateObject(before.id, before.revision, { ...before, properties: {} });
  const other = f.objects.createObject({ typeId: PAGE_TYPE_ID, title: 'Other boundary', properties: { [propertyId]: 'other' }, body: '' });
  const otherCurrent = f.objects.updateObject(other.id, other.revision, { ...other, title: 'Other changed' });

  assert.equal((await f.get(`/objects/${before.id}/history?unknown=1`)).status, 422);
  assert.equal((await f.get(`/objects/${before.id}/history?offset=0&offset=1`)).status, 422);
  assert.equal((await f.get(`/objects/${before.id}/history?offset=-1`)).status, 422);
  assert.equal((await f.get(`/objects/${before.id}/history?revision=0`)).status, 422);
  assert.equal((await f.post(`/objects/${before.id}/history/draft`, { revision: String(before.revision), currentRevision: '0' })).status, 422);

  const emptyMarker = await f.post(`/objects/${before.id}/update`, {
    revision: String(current.revision), historyRevision: '', intent: 'change-type', typeId: PAGE_TYPE_ID, title: 'Empty marker', body: '',
  });
  assert.equal(emptyMarker.status, 422);
  const foreignMarker = await f.post(`/objects/${before.id}/update`, {
    revision: String(current.revision), historyRevision: String(otherCurrent.revision), intent: 'change-type', typeId: PAGE_TYPE_ID, title: 'Foreign marker', body: '',
  });
  assert.equal(foreignMarker.status, 404);
  const ordinaryExtra = await f.post(`/objects/${before.id}/update`, {
    revision: String(current.revision), typeId: PAGE_TYPE_ID, title: 'No marker', body: '', [`p:${propertyId}`]: 'forged',
  });
  assert.equal(ordinaryExtra.status, 422);

  const cleared = await f.post(`/objects/${before.id}/update`, {
    revision: String(current.revision), historyRevision: String(before.revision), typeId: PAGE_TYPE_ID, title: 'Cleared history field', body: '',
  });
  assert.equal(cleared.status, 303);
  assert.equal(f.objects.getObject(before.id).properties[propertyId], undefined);
  assert.deepEqual(f.objects.getObject(other.id), otherCurrent);
});

test('historical extra reference selections survive draft open, type switch and parse rejection', async t => {
  const f = await setup(t, async () => { throw new Error('Not used'); });
  const people = f.objects.createType('History reference person');
  const ada = f.objects.createObject({ typeId: people.id, title: 'Ada Selected', properties: {}, body: '' });
  const grace = f.objects.createObject({ typeId: people.id, title: 'Grace Modified', properties: {}, body: '' });
  for (let index = 0; index < 205; index++) {
    f.objects.createObject({ typeId: people.id, title: `Newer candidate ${index}`, properties: {}, body: '' });
  }
  const holder = f.objects.createType('History reference holder');
  const withRef = f.objects.addProperty(holder.id, holder.revision, { label: 'Past person', kind: 'reference', targetTypeId: people.id });
  const withNumber = f.objects.addProperty(holder.id, withRef.revision, { label: 'Past score', kind: 'number' });
  const referenceId = withRef.propertyIds[0]!;
  const numberId = withNumber.propertyIds[1]!;
  const before = f.objects.createObject({ typeId: PAGE_TYPE_ID, title: 'Reference before', properties: { [referenceId]: ada.id.toUpperCase(), [numberId]: 1 }, body: '' });
  const current = f.objects.updateObject(before.id, before.revision, { ...before, properties: {} });
  f.objects.setTrashed(ada.id, ada.revision, true);

  const history = await f.get(`/objects/${before.id}/history?revision=${before.revision}`);
  assert.equal(history.status, 200);
  const historyMarkup = await history.text();
  assert.ok(historyMarkup.includes('Ada Selected'));

  const draft = await f.post(`/objects/${before.id}/history/draft`, { revision: String(before.revision), currentRevision: String(current.revision) });
  assert.equal(draft.status, 200);
  const draftMarkup = await draft.text();
  assert.ok(draftMarkup.includes('Ada Selected'));
  assert.ok(/<option[^>]*selected[^>]*>Ada Selected/.test(draftMarkup));

  const switched = await f.post(`/objects/${before.id}/update`, {
    revision: String(current.revision), historyRevision: String(before.revision), intent: 'change-type', typeId: PAGE_TYPE_ID, title: 'Switch', body: '', [`p:${referenceId}`]: ada.id, [`p:${numberId}`]: '1',
  });
  assert.equal(switched.status, 200);
  const switchedMarkup = await switched.text();
  assert.ok(/<option[^>]*selected[^>]*>Ada Selected/.test(switchedMarkup));

  const rejected = await f.post(`/objects/${before.id}/update`, {
    revision: String(current.revision), historyRevision: String(before.revision), typeId: PAGE_TYPE_ID, title: 'Rejected modified extra', body: '', [`p:${referenceId}`]: grace.id, [`p:${numberId}`]: 'not-a-number',
  });
  assert.equal(rejected.status, 422);
  const rejectedMarkup = await rejected.text();
  assert.ok(rejectedMarkup.includes('Past score must be a finite number.'));
  assert.ok(/<option[^>]*selected[^>]*>Grace Modified/.test(rejectedMarkup));
  assert.ok(rejectedMarkup.includes('value="not-a-number"'));
  assert.deepEqual(f.objects.getObject(before.id), current);
});

test('object backlinks use bounded native pages and reject invalid offsets without losing drafts', async t => {
  const f = await setup(t, async () => { throw new Error('Not used'); });
  const target = f.objects.createObject({ typeId: PAGE_TYPE_ID, title: 'Target', properties: {}, body: '' });
  for (let index = 0; index < 54; index++) {
    f.objects.createObject({ typeId: PAGE_TYPE_ID, title: `Source ${String(index).padStart(2, '0')}`, properties: {}, body: `[Target](/objects/${target.id})` });
  }
  const first = await f.get(`/objects/${target.id}`);
  assert.equal(first.status, 200);
  const firstMarkup = await first.text();
  assert.ok(firstMarkup.includes('aria-label="Backlink pages"'));
  assert.ok(firstMarkup.includes(`backlinksOffset=50#object-backlinks`));
  assert.ok(!firstMarkup.includes('No other objects link here yet.'));
  const second = await f.get(`/objects/${target.id}?backlinksOffset=50#object-backlinks`);
  assert.equal(second.status, 200);
  const secondMarkup = await second.text();
  assert.ok(secondMarkup.includes('>Previous</a>'));
  assert.ok(!secondMarkup.includes('>Next</a>'));
  assert.equal((secondMarkup.match(/Source /g) ?? []).length, 4);
  const invalid = await f.get(`/objects/${target.id}?backlinksOffset=-1`);
  assert.equal(invalid.status, 422);
  const repeated = await f.get(`/objects/${target.id}?backlinksOffset=0&backlinksOffset=50`);
  assert.equal(repeated.status, 422);
  const concurrent = f.objects.updateObject(target.id, target.revision, { ...target, title: 'Target changed' });
  const stale = await f.post(`/objects/${target.id}/update?backlinksOffset=50`, {
    revision: String(target.revision),
    typeId: PAGE_TYPE_ID,
    title: 'Unsaved target draft',
    body: 'Unsaved body',
  });
  assert.equal(stale.status, 409);
  const staleMarkup = await stale.text();
  assert.ok(staleMarkup.includes('Unsaved target draft'));
  assert.ok(staleMarkup.includes(`backlinksOffset=0#object-backlinks`));
  assert.equal(f.objects.getObject(target.id).title, concurrent.title);
});
