import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../src/database.js';
import { ObjectRuntime } from '../src/objects/runtime.js';
import { createObjectRoutes } from '../src/objects/http.js';
import { PAGE_TYPE_ID, TASK_TYPE_ID, TASK_DUE_PROPERTY_ID } from '../src/objects/model.js';

const visitor = { id: crypto.randomUUID(), csrf: crypto.randomUUID() };
async function route(runtime: ObjectRuntime, method: string, path: string, fields?: URLSearchParams) {
  const handler = createObjectRoutes(runtime, async () => { throw new Error('no provider'); });
  return handler(new Request(`http://127.0.0.1${path}`, { method }), new URL(`http://127.0.0.1${path}`), visitor, fields);
}

test('HTTP creates fixed-domain objects and rejects schema mutation routes', async () => {
  const db = openDatabase();
  const runtime = new ObjectRuntime(db);
  const fields = new URLSearchParams({ csrf: visitor.csrf, requestId: crypto.randomUUID(), typeId: TASK_TYPE_ID, title: 'Task', body: '', [`p:${TASK_DUE_PROPERTY_ID}`]: '2026-01-01' });
  const created = await route(runtime, 'POST', '/objects/create', fields);
  assert.equal(created?.status, 303);
  assert.equal(runtime.listObjectSummaries({ typeId: TASK_TYPE_ID }).length, 1);
  const retired = await route(runtime, 'POST', '/types/create', new URLSearchParams({ csrf: visitor.csrf, name: 'Custom' }));
  assert.equal(retired?.status, 404);
  db.close();
});

test('the home dashboard is the calendar day workspace and the object browse screen lives at /objects', async () => {
  const db = openDatabase();
  const runtime = new ObjectRuntime(db);
  const home = await route(runtime, 'GET', '/');
  assert.equal(home?.status, 200);
  const homeMarkup = await home!.text();
  assert.match(homeMarkup, /day-journal/);
  assert.match(homeMarkup, /Daily page/);
  const browse = await route(runtime, 'GET', '/objects');
  assert.equal(browse?.status, 200);
  const browseMarkup = await browse!.text();
  assert.match(browseMarkup, /type-browser/);
  assert.doesNotMatch(browseMarkup, /day-journal/);
  db.close();
});

test('lookup and preview stay bounded and nonmutating', async () => {
  const db = openDatabase();
  const runtime = new ObjectRuntime(db);
  runtime.createObject({ typeId: PAGE_TYPE_ID, title: 'Needle', properties: {}, body: 'safe **markdown**' });
  const lookup = await route(runtime, 'GET', '/objects/lookup?q=Needle');
  assert.equal(lookup?.status, 200);
  assert.equal((await lookup!.json()).items[0].title, 'Needle');
  const before = runtime.listObjectSummaries().length;
  const preview = await route(runtime, 'POST', '/objects/preview', new URLSearchParams({ csrf: visitor.csrf, body: '<b>x</b>' }));
  assert.equal(preview?.status, 200);
  assert.equal(runtime.listObjectSummaries().length, before);
  db.close();
});
