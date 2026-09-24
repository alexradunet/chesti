import { test } from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { AppError } from '../src/core.js';
import { openDatabase } from '../src/database.js';
import { PAGE_TYPE_ID } from '../src/objects/model.js';
import type { ObjectWrite, PropertyValue } from '../src/objects/model.js';
import { ObjectRuntime } from '../src/objects/runtime.js';
import { valueError, validDate, validDateTime } from '../src/objects/values.js';

function fixture(t: TestContext) {
  const db = openDatabase();
  t.after(() => db.close());
  return { db, runtime: new ObjectRuntime(db) };
}
function input(typeId = PAGE_TYPE_ID, title = 'Object', properties: Record<string, PropertyValue> = {}, markdown = ''): ObjectWrite {
  return { typeId, title, properties, body: markdown };
}
function status(code: number): (error: unknown) => boolean {
  return error => error instanceof AppError && error.status === code;
}

test('shared property identity and existing values survive global label renames', t => {
  const { runtime } = fixture(t);
  let tasks = runtime.createType('Task');
  const projects = runtime.createType('Project');
  tasks = runtime.addProperty(tasks.id, tasks.revision, { label: 'State', kind: 'select', options: ['Open', 'Done'] });
  const property = runtime.getProperty(tasks.propertyIds[0]!);
  const shared = runtime.addProperty(projects.id, projects.revision, { propertyId: property.id });
  const option = property.options![0]!.id;
  const task = runtime.createObject(input(tasks.id, 'Task', { [property.id]: option }));
  const project = runtime.createObject(input(shared.id, 'Project', { [property.id]: option }));
  const page = runtime.createObject(input(PAGE_TYPE_ID, 'Extra registered property', { [property.id]: option }));
  const renamed = runtime.renameProperty(property.id, property.revision, 'Progress');
  assert.equal(renamed.id, property.id);
  assert.deepEqual(renamed.options, property.options);
  assert.deepEqual(runtime.getType(tasks.id).propertyIds, [property.id]);
  assert.deepEqual(runtime.getType(projects.id).propertyIds, [property.id]);
  for (const object of [task, project, page]) assert.equal(runtime.getObject(object.id).properties[renamed.id], option);
  assert.throws(() => runtime.renameProperty(property.id, property.revision, 'Stale'), status(409));
  assert.throws(() => runtime.addProperty(shared.id, shared.revision, { propertyId: property.id }), status(409));
  assert.equal(runtime.createObject(input(tasks.id, 'Optional')).properties[property.id], undefined);
  assert.throws(() => runtime.createObject(input(tasks.id, 'Label is not identity', { [property.id]: 'Open' })), status(422));
});

test('object revisions reject stale writes and preserve recoverable pre-change content', t => {
  const { db, runtime } = fixture(t);
  const made = runtime.createObject(input(PAGE_TYPE_ID, 'Before', {}, '# Body\n\nKeep **formatting**.'));
  const renamed = runtime.updateObject(made.id, made.revision, { ...made, title: 'After' });
  assert.equal(renamed.id, made.id);
  assert.equal(renamed.body, made.body);
  assert.throws(() => runtime.updateObject(made.id, made.revision, { ...made, title: 'Lost update' }), status(409));
  assert.throws(() => runtime.patchProperties(made.id, made.revision, {}), status(409));
  assert.throws(() => runtime.setTrashed(made.id, made.revision, true), status(409));
  const snapshot = db.query<{ snapshot_json: string }, [string, number]>('SELECT snapshot_json FROM object_revisions WHERE object_id = ? AND revision = ?').get(made.id, made.revision)!;
  assert.deepEqual(JSON.parse(snapshot.snapshot_json), made);
  const otherType = runtime.createType('Reading');
  const changed = runtime.updateObject(made.id, renamed.revision, { ...renamed, typeId: otherType.id });
  assert.equal(changed.id, made.id);
  assert.equal(changed.body, made.body);
  assert.equal(changed.createdAt, made.createdAt);
  assert.equal(runtime.getObject(made.id).title, 'After');
});

test('typed references and mentions retain provenance through trash and restore without view ownership', t => {
  const { runtime } = fixture(t);
  const people = runtime.createType('Person');
  const person = runtime.createObject(input(people.id, 'Ada'));
  const another = runtime.createObject(input(people.id, 'Grace'));
  let page = runtime.getType(PAGE_TYPE_ID);
  page = runtime.addProperty(page.id, page.revision, { label: 'People', kind: 'reference', targetTypeId: people.id, multiple: true });
  const references = page.propertyIds[0]!;
  page = runtime.addProperty(page.id, page.revision, { label: 'Comment', kind: 'text' });
  const comment = page.propertyIds[1]!;
  const mention = `People: [${person.title}](/objects/${person.id})\n\n[Again](/objects/${person.id})`;
  const note = runtime.createObject({ ...input(page.id, 'Meeting', { [references]: [person.id, another.id] }), body: mention });
  const backlinks = runtime.backlinks(person.id);
  assert.equal(backlinks.length, 2);
  assert.ok(backlinks.some(link => link.object.id === note.id && link.propertyId === references));
  assert.ok(backlinks.some(link => link.object.id === note.id && link.propertyId === undefined));
  assert.throws(() => runtime.patchProperties(note.id, note.revision, { [references]: person.id }), status(422));
  assert.throws(() => runtime.patchProperties(note.id, note.revision, { [references]: [person.id, person.id] }), status(422));
  assert.throws(() => runtime.patchProperties(note.id, note.revision, { [references]: [note.id] }), status(422));
  assert.throws(() => runtime.updateObject(person.id, person.revision, { ...person, typeId: page.id }), status(409));
  const trashed = runtime.setTrashed(person.id, person.revision, true);
  const edited = runtime.patchProperties(note.id, note.revision, { [comment]: 'Still editable' });
  assert.deepEqual(edited.properties[references], [person.id, another.id]);
  assert.equal(runtime.backlinks(person.id).length, 2);
  assert.throws(() => runtime.createObject(input(page.id, 'New forbidden reference', { [references]: [person.id] })), status(422));
  assert.throws(() => runtime.createObject({ ...input(page.id, 'New forbidden mention'), body: mention }), status(422));
  assert.equal(runtime.listObjects().some(object => object.id === person.id), false);
  assert.deepEqual(runtime.listObjects({ trashed: true }).map(object => object.id), [person.id]);
  const restored = runtime.setTrashed(person.id, trashed.revision, false);
  assert.equal(restored.id, person.id);
  assert.equal(restored.typeId, people.id);
  assert.equal(runtime.backlinks(person.id).length, 2);
  const removed = runtime.patchProperties(edited.id, edited.revision, { [references]: null });
  assert.equal(removed.properties[references], undefined);
  assert.equal(runtime.backlinks(person.id).length, 1);
});

test('idempotent creation fingerprints exact Markdown source and rejects mismatched requests', t => {
  const { runtime } = fixture(t);
  const requestId = crypto.randomUUID();
  const first = runtime.createObject(input(PAGE_TYPE_ID, 'Once', {}, 'A paragraph.'), requestId);
  const retry = runtime.createObject(input(PAGE_TYPE_ID, 'Once', {}, 'A paragraph.'), requestId);
  assert.equal(retry.id, first.id);
  assert.equal(runtime.listObjects().length, 1);
  assert.throws(() => runtime.createObject(input(PAGE_TYPE_ID, 'Different', {}, 'A paragraph.'), requestId), status(409));
  assert.throws(() => runtime.createObject(input(PAGE_TYPE_ID, 'Once', {}, 'A paragraph.\n'), requestId), status(409));
  const trashed = runtime.setTrashed(first.id, first.revision, true);
  assert.deepEqual(runtime.createObject(input(PAGE_TYPE_ID, 'Once', {}, 'A paragraph.'), requestId), trashed);
});

test('browse is bounded, literal-searchable, and isolates trash state', t => {
  const { runtime } = fixture(t);
  for (let index = 0; index < 52; index++) runtime.createObject(input(PAGE_TYPE_ID, `Item ${index}`));
  const percent = runtime.createObject(input(PAGE_TYPE_ID, '100% complete', {}, 'An unusual needle.'));
  assert.equal(runtime.listObjects().length, 50);
  assert.equal(runtime.listObjects({ offset: 50 }).length, 3);
  assert.deepEqual(runtime.listObjects({ search: '%' }).map(object => object.id), [percent.id]);
  assert.deepEqual(runtime.listObjects({ search: 'unusual needle' }).map(object => object.id), [percent.id]);
  runtime.setTrashed(percent.id, percent.revision, true);
  assert.deepEqual(runtime.listObjects({ search: '%' }), []);
  assert.deepEqual(runtime.listObjects({ search: '%', trashed: true }).map(object => object.id), [percent.id]);
  assert.throws(() => runtime.listObjects({ limit: 201 }), status(422));
  assert.throws(() => runtime.listObjects({ offset: -1 }), status(422));
});

test('canonical objects, property identities, snapshots and create receipts persist across reopening', t => {
  const directory = mkdtempSync(join(tmpdir(), 'object-runtime-'));
  const file = join(directory, 'workspace.sqlite');
  let db = openDatabase(file);
  t.after(() => { db.close(); rmSync(directory, { recursive: true, force: true }); });
  const runtime = new ObjectRuntime(db);
  let task = runtime.createType('Task');
  task = runtime.addProperty(task.id, task.revision, { label: 'State', kind: 'select', options: ['Open', 'Done'] });
  const state = runtime.getProperty(task.propertyIds[0]!);
  const requestId = crypto.randomUUID();
  const properties = { [state.id]: state.options![0]!.id };
  const before = runtime.createObject(input(task.id, 'Before', properties, 'Saved **body**.'), requestId);
  const edited = runtime.updateObject(before.id, before.revision, { ...before, title: 'After' });
  const trashed = runtime.setTrashed(edited.id, edited.revision, true);
  runtime.renameProperty(state.id, state.revision, 'Progress');
  const catalog = runtime.catalog();
  db.close();
  db = openDatabase(file);
  const reopened = new ObjectRuntime(db);
  assert.deepEqual(reopened.catalog(), catalog);
  assert.deepEqual(reopened.getObject(before.id), trashed);
  assert.deepEqual(reopened.listObjects({ trashed: true }), [trashed]);
  assert.deepEqual(reopened.createObject(input(task.id, 'Before', properties, 'Saved **body**.'), requestId), trashed);
  assert.throws(() => reopened.createObject(input(task.id, 'Different', properties, 'Saved **body**.'), requestId), status(409));
  const snapshot = db.query<{ snapshot_json: string }, [string, number]>('SELECT snapshot_json FROM object_revisions WHERE object_id = ? AND revision = ?').get(before.id, before.revision)!;
  assert.deepEqual(JSON.parse(snapshot.snapshot_json), before);
});

test('calendar dates and timestamps are strict, leap-aware, and never locale/timezone guessed', () => {
  for (const date of ['2024-02-29', '2000-02-29', '0001-01-01', '9999-12-31']) assert.ok(validDate(date), date);
  for (const date of ['2026-02-30', '1900-02-29', '0000-01-01', '2026-9-01', '2026-13-01', 'tomorrow', '2026-01-01T00:00:00Z']) assert.equal(validDate(date), false, date);
  for (const date of ['2026-09-23T12:00:00Z', '2026-09-23T12:00:00.123+01:00']) assert.ok(validDateTime(date), date);
  for (const date of ['2026-02-30T12:00:00Z', '2026-09-23T24:00:00Z', '2026-09-23T12:00:00', '2026-09-23T12:00:00+14:30', '2026-09-23T12:00:00-00:00']) assert.equal(validDateTime(date), false, date);
  assert.ok(valueError('boolean', 'true')); assert.ok(valueError('number', Infinity)); assert.ok(valueError('number', Number.MAX_SAFE_INTEGER + 1));
});

test('time ranges validate ordering, zone offsets and DST at both endpoints; all-day ranges have exclusive ends', () => {
  const good = { start: '2026-10-25T01:30:00+01:00', end: '2026-10-25T01:30:00+00:00', timeZone: 'Europe/London' };
  assert.equal(valueError('time-range', good), undefined);
  for (const bad of [{ ...good, timeZone: 'Invalid/Zone' }, { ...good, end: good.start }, { ...good, start: '2026-10-25T01:30:00+02:00' }, { ...good, extra: true }]) assert.ok(valueError('time-range', bad));
  assert.equal(valueError('date-range', { start: '2026-09-23', end: '2026-09-24' }), undefined);
  assert.ok(valueError('date-range', { start: '2026-09-23', end: '2026-09-23' }));
});

test('schema version guard does not modify newer object databases', t => {
  const { db, runtime } = fixture(t);
  const object = runtime.createObject(input());
  db.query("UPDATE object_metadata SET value = '3' WHERE key = 'schema_version'").run();
  assert.throws(() => new ObjectRuntime(db), /Unsupported object database schema/);
  assert.deepEqual(runtime.getObject(object.id), object);
  assert.equal(db.query<{ value: string }, []>("SELECT value FROM object_metadata WHERE key = 'schema_version'").get()!.value, '3');
});
