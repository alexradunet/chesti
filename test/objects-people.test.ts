import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../src/database.js';
import { ObjectRuntime } from '../src/objects/runtime.js';
import { createObjectRoutes } from '../src/objects/http.js';
import { reconnectDate } from '../src/objects/people.js';
import { BUILTIN_PROPERTIES, BUILTIN_TYPES, PAGE_TYPE_ID, PERSON_TYPE_ID, PERSON_LAST_CONNECTED_PROPERTY_ID as last, PERSON_RECONNECT_EVERY_PROPERTY_ID as every, PERSON_RELATIONSHIP_PROPERTY_ID as relationship } from '../src/objects/model.js';

const input = (title: string, properties = {}) => ({ typeId: PERSON_TYPE_ID, title, properties, body: '' });

test('reconnect dates use calendar months, clamp month ends, and do not invent missing dates', () => {
  const due = (date: string, months: number) => reconnectDate({ [last]: date, [every]: months });
  assert.equal(due('2024-01-31', 1), '2024-02-29');
  assert.equal(due('2025-01-31', 1), '2025-02-28');
  assert.equal(due('2024-02-29', 12), '2025-02-28');
  assert.equal(due('2025-11-30', 3), '2026-02-28');
  assert.equal(due('0099-12-31', 1), '0100-01-31');
  assert.equal(due('9999-12-31', 1), undefined);
  assert.equal(reconnectDate({ [every]: 3 }), undefined);
  assert.equal(reconnectDate({ [last]: '2024-01-01' }), undefined);
});

test('people writes validate frequencies and recalculate without storing derived data or losing revisions', t => {
  const db = openDatabase(); t.after(() => db.close());
  const runtime = new ObjectRuntime(db);
  for (const months of [0, -1, 1.5, 121]) assert.throws(() => runtime.createObject(input('Invalid', { [every]: months })), /whole number/);
  let person = runtime.createObject(input('Ester', { [last]: '2025-01-31', [every]: 1 }));
  assert.equal(reconnectDate(person.properties), '2025-02-28');
  person = runtime.patchProperties(person.id, person.revision, { [every]: 3 });
  assert.equal(reconnectDate(person.properties), '2025-04-30');
  assert.throws(() => runtime.patchProperties(person.id, 1, { [last]: '2025-02-01' }), /changed/);
  assert.deepEqual(runtime.getObject(person.id), person);
  person = runtime.patchProperties(person.id, person.revision, { [last]: null });
  assert.equal(reconnectDate(person.properties), undefined);
  assert.deepEqual(Object.keys(person.properties), [every]);
});

test('People HTTP screen is bounded, escaped, selectable, and excludes trash and other types', async t => {
  const db = openDatabase(); t.after(() => db.close());
  const runtime = new ObjectRuntime(db);
  const routes = createObjectRoutes(runtime);
  const get = async (path: string) => {
    const url = new URL(path, 'http://localhost');
    return (await routes(new Request(url), url, { id: 'visitor', csrf: 'token' }))!;
  };
  const person = runtime.createObject(input('<Ester>', { [relationship]: '<Friends>', [last]: '2024-01-31', [every]: 1 }));
  const before = runtime.getObject(person.id);
  const html = await (await get(`/people?person=${person.id}`)).text();
  assert.match(html, /&lt;Ester&gt;/);
  assert.match(html, /&lt;Friends&gt;/);
  assert.match(html, /2024-02-29/);
  assert.match(html, /Edit person/);
  assert.deepEqual(runtime.getObject(person.id), before);
  const page = runtime.createObject({ ...input('Page'), typeId: PAGE_TYPE_ID });
  assert.equal((await get(`/people?person=${page.id}`)).status, 404);
  runtime.setTrashed(person.id, person.revision, true);
  assert.equal((await get(`/people?person=${person.id}`)).status, 404);
  for (let i = 0; i < 51; i++) runtime.createObject(input(`Person ${String(i).padStart(2, '0')}`));
  const listed = runtime.listPeople();
  assert.equal(listed.items.length, 50);
  assert.equal(listed.hasMore, true);
  assert.equal('body' in listed.items[0]!, false);
  assert.equal(runtime.listPeople('', 50).items.length, 1);
  assert.match(await (await get('/people')).text(), />Next<\/a>/);
  assert.equal((await get('/people?offset=1000001')).status, 422);
  assert.equal((await get('/people?q=a&q=b')).status, 422);
});

test('version 5 gains protected Person definitions without rewriting existing content or same-named types', t => {
  const db = openDatabase(); t.after(() => db.close());
  const runtime = new ObjectRuntime(db);
  const custom = runtime.createType('Person');
  const existing = runtime.createObject({ ...input('Untouched'), typeId: custom.id, body: 'Exact\r\nMarkdown' });
  const personType = BUILTIN_TYPES.find(type => type.id === PERSON_TYPE_ID)!;
  for (const [index, type] of BUILTIN_TYPES.entries()) if (type.id === PERSON_TYPE_ID) {
    for (const suffix of ['insert', 'update', 'delete']) db.exec(`DROP TRIGGER object_builtin_type_${index}_${suffix}`);
    db.query('DELETE FROM object_types WHERE id = ?').run(type.id);
  }
  for (const [index, property] of BUILTIN_PROPERTIES.entries()) if (personType.propertyIds.includes(property.id)) {
    for (const suffix of ['insert', 'update', 'delete']) db.exec(`DROP TRIGGER object_builtin_property_${index}_${suffix}`);
    db.query('DELETE FROM object_properties WHERE id = ?').run(property.id);
  }
  db.query("UPDATE object_metadata SET value = '5' WHERE key = 'schema_version'").run();
  const upgraded = new ObjectRuntime(db);
  assert.deepEqual(upgraded.getObject(existing.id), existing);
  assert.deepEqual(upgraded.getType(custom.id), custom);
  assert.equal(upgraded.getType(PERSON_TYPE_ID).name, 'Person');
  assert.throws(() => db.query('DELETE FROM object_types WHERE id = ?').run(PERSON_TYPE_ID), /cannot be deleted/);
  assert.throws(() => db.query('UPDATE object_properties SET kind = ? WHERE id = ?').run('text', every), /protected/);
  const renamed = upgraded.renameType(PERSON_TYPE_ID, 1, 'Contacts');
  assert.deepEqual(new ObjectRuntime(db).getType(PERSON_TYPE_ID), renamed);
});
