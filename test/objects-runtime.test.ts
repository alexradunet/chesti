import { test } from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { AppError } from '../src/core.js';
import { openDatabase } from '../src/database.js';
import {
  BUILTIN_TYPES, PAGE_TYPE_ID, TASK_TYPE_ID, TASK_DUE_PROPERTY_ID,
  EVENT_TYPE_ID, EVENT_DATES_PROPERTY_ID, EVENT_TIME_PROPERTY_ID,
  REMINDER_TYPE_ID, REMINDER_DATE_PROPERTY_ID, REMINDER_TIME_PROPERTY_ID,
  JOURNAL_TYPE_ID, JOURNAL_DATE_PROPERTY_ID,
} from '../src/objects/model.js';
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
  const backlinks = runtime.backlinks(person.id).links;
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
  assert.equal(runtime.backlinks(person.id).links.length, 2);
  assert.throws(() => runtime.createObject(input(page.id, 'New forbidden reference', { [references]: [person.id] })), status(422));
  assert.throws(() => runtime.createObject({ ...input(page.id, 'New forbidden mention'), body: mention }), status(422));
  assert.equal(runtime.listObjects().some(object => object.id === person.id), false);
  assert.deepEqual(runtime.listObjects({ trashed: true }).map(object => object.id), [person.id]);
  const restored = runtime.setTrashed(person.id, trashed.revision, false);
  assert.equal(restored.id, person.id);
  assert.equal(restored.typeId, people.id);
  assert.equal(runtime.backlinks(person.id).links.length, 2);
  const removed = runtime.patchProperties(edited.id, edited.revision, { [references]: null });
  assert.equal(removed.properties[references], undefined);
  assert.equal(runtime.backlinks(person.id).links.length, 1);
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
  db.query("UPDATE object_metadata SET value = '999' WHERE key = 'schema_version'").run();
  assert.throws(() => new ObjectRuntime(db), /Unsupported object database schema/);
  assert.deepEqual(runtime.getObject(object.id), object);
  assert.equal(db.query<{ value: string }, []>("SELECT value FROM object_metadata WHERE key = 'schema_version'").get()!.value, '999');
});

test('daily journals reuse saved and trashed writing across connections without creating duplicates', t => {
  const directory = mkdtempSync(join(tmpdir(), 'daily-journal-'));
  const file = join(directory, 'workspace.sqlite');
  const db = openDatabase(file);
  const first = new ObjectRuntime(db);
  const otherDb = openDatabase(file);
  const other = new ObjectRuntime(otherDb);
  t.after(() => { otherDb.close(); db.close(); rmSync(directory, { recursive: true, force: true }); });
  const date = '2026-09-25';
  const made = first.openJournal(date);
  const written = first.updateObject(made.id, made.revision, { ...made, title: 'A memorable day', body: '# Keep this\n\nMy writing.' });
  assert.deepEqual(other.openJournal(date), written);
  assert.throws(() => other.createObject(input(JOURNAL_TYPE_ID, 'Duplicate', { [JOURNAL_DATE_PROPERTY_ID]: date }, 'Different writing')), status(409));
  const trashed = other.setTrashed(written.id, written.revision, true);
  assert.deepEqual(first.openJournal(date), trashed);
  assert.throws(() => first.createObject(input(JOURNAL_TYPE_ID, 'Replacement', { [JOURNAL_DATE_PROPERTY_ID]: date })), status(409));
  const restored = first.setTrashed(trashed.id, trashed.revision, false);
  assert.equal(restored.body, written.body);
  assert.deepEqual(other.listObjects({ typeId: JOURNAL_TYPE_ID }), [restored]);
  assert.throws(() => db.query(`INSERT INTO objects SELECT ?, type_id, title, properties_json, body, revision, created_at, updated_at, trashed, body_text FROM objects WHERE id = ?`).run(crypto.randomUUID(), made.id));
});

test('journal date changes and type changes cannot erase a date or overwrite another day', t => {
  const { db, runtime } = fixture(t);
  const first = runtime.openJournal('2026-09-25');
  const second = runtime.openJournal('2026-09-26');
  const beforeHistory = db.query('SELECT * FROM object_revisions').all();
  assert.throws(() => runtime.patchProperties(first.id, first.revision, { [JOURNAL_DATE_PROPERTY_ID]: '2026-09-26' }), status(409));
  assert.throws(() => runtime.patchProperties(first.id, first.revision, { [JOURNAL_DATE_PROPERTY_ID]: null }), status(422));
  assert.throws(() => runtime.patchProperties(first.id, first.revision, { [JOURNAL_DATE_PROPERTY_ID]: '2026-02-30' }), status(422));
  assert.deepEqual(runtime.getObject(first.id), first);
  assert.deepEqual(runtime.getObject(second.id), second);
  assert.deepEqual(db.query('SELECT * FROM object_revisions').all(), beforeHistory);
  assert.throws(() => db.query('UPDATE objects SET properties_json = ? WHERE id = ?').run('{}', first.id));
  const page = runtime.createObject(input(PAGE_TYPE_ID, 'Not yet a journal'));
  assert.throws(() => runtime.updateObject(page.id, page.revision, { ...page, typeId: JOURNAL_TYPE_ID }), status(422));
  assert.throws(() => runtime.updateObject(page.id, page.revision, { ...page, typeId: JOURNAL_TYPE_ID, properties: { [JOURNAL_DATE_PROPERTY_ID]: '2026-09-26' } }), status(409));
  const moved = runtime.patchProperties(first.id, first.revision, { [JOURNAL_DATE_PROPERTY_ID]: '2026-09-24' });
  assert.equal(runtime.getJournal('2026-09-25'), undefined);
  assert.equal(runtime.getJournal('2026-09-24')?.id, moved.id);
  assert.throws(() => runtime.patchProperties(first.id, first.revision, { [JOURNAL_DATE_PROPERTY_ID]: '2026-09-23' }), status(409));
});

test('built-in identities and core fields are protected while customizations survive reopening', t => {
  const { db, runtime } = fixture(t);
  let task = runtime.getType(TASK_TYPE_ID);
  task = runtime.renameType(task.id, task.revision, 'Actions');
  task = runtime.addProperty(task.id, task.revision, { label: 'Energy', kind: 'number' });
  const due = runtime.getProperty(TASK_DUE_PROPERTY_ID);
  runtime.renameProperty(due.id, due.revision, 'Deadline');
  for (const type of BUILTIN_TYPES) {
    assert.throws(() => db.query('DELETE FROM object_types WHERE id = ?').run(type.id));
  }
  assert.throws(() => db.query('UPDATE object_types SET property_ids_json = ? WHERE id = ?').run('[]', TASK_TYPE_ID));
  assert.throws(() => db.query('DELETE FROM object_properties WHERE id = ?').run(TASK_DUE_PROPERTY_ID));
  assert.throws(() => db.query('UPDATE object_properties SET kind = ? WHERE id = ?').run('text', TASK_DUE_PROPERTY_ID));
  const record = runtime.createObject(input(TASK_TYPE_ID, 'A real action', { [TASK_DUE_PROPERTY_ID]: '2026-10-01', [task.propertyIds.at(-1)!]: 3 }));
  const catalog = runtime.catalog();
  const reopened = new ObjectRuntime(db);
  assert.deepEqual(reopened.catalog(), catalog);
  assert.deepEqual(reopened.getObject(record.id), record);
});

test('types based on built-ins share properties but not lifecycle rules or later field additions', t => {
  const { runtime } = fixture(t);
  const diary = runtime.createType('Travel entry', JOURNAL_TYPE_ID);
  const date = '2026-09-25';
  runtime.openJournal(date);
  const a = runtime.createObject(input(diary.id, 'Morning', { [JOURNAL_DATE_PROPERTY_ID]: date }));
  const b = runtime.createObject(input(diary.id, 'Evening', { [JOURNAL_DATE_PROPERTY_ID]: date }));
  const undated = runtime.createObject(input(diary.id, 'Unscheduled writing'));
  const property = runtime.getProperty(JOURNAL_DATE_PROPERTY_ID);
  runtime.renameProperty(property.id, property.revision, 'Entry day');
  const journal = runtime.getType(JOURNAL_TYPE_ID);
  const extended = runtime.addProperty(journal.id, journal.revision, { label: 'Mood', kind: 'text' });
  assert.equal(runtime.getType(diary.id).propertyIds.includes(extended.propertyIds.at(-1)!), false);
  assert.equal(runtime.getProperty(runtime.getType(diary.id).propertyIds[0]!).label, 'Entry day');
  assert.deepEqual(new Set(runtime.listObjects({ typeId: diary.id }).map(record => record.id)), new Set([a.id, b.id, undated.id]));
});

test('event and reminder schedules require one representation and switch atomically', t => {
  const { runtime } = fixture(t);
  assert.throws(() => runtime.createObject(input(EVENT_TYPE_ID)), status(422));
  const event = runtime.createObject(input(EVENT_TYPE_ID, 'Holiday', { [EVENT_DATES_PROPERTY_ID]: { start: '2026-09-25', end: '2026-09-26' } }));
  const time = { start: '2026-09-25T09:00:00Z', end: '2026-09-25T10:00:00Z', timeZone: 'UTC' };
  assert.throws(() => runtime.patchProperties(event.id, event.revision, { [EVENT_TIME_PROPERTY_ID]: time }), status(422));
  const timed = runtime.patchProperties(event.id, event.revision, { [EVENT_DATES_PROPERTY_ID]: null, [EVENT_TIME_PROPERTY_ID]: time });
  assert.equal(timed.properties[EVENT_DATES_PROPERTY_ID], undefined);
  assert.deepEqual(timed.properties[EVENT_TIME_PROPERTY_ID], time);
  assert.throws(() => runtime.createObject(input(REMINDER_TYPE_ID)), status(422));
  const reminder = runtime.createObject(input(REMINDER_TYPE_ID, 'Think about plans', { [REMINDER_DATE_PROPERTY_ID]: '2026-09-25' }));
  assert.throws(() => runtime.patchProperties(reminder.id, reminder.revision, { [REMINDER_TIME_PROPERTY_ID]: '2026-09-25T21:00:00Z' }), status(422));
  const precise = runtime.patchProperties(reminder.id, reminder.revision, { [REMINDER_DATE_PROPERTY_ID]: null, [REMINDER_TIME_PROPERTY_ID]: '2026-09-25T21:00:00Z' });
  assert.equal(precise.properties[REMINDER_DATE_PROPERTY_ID], undefined);
  assert.equal(precise.properties[REMINDER_TIME_PROPERTY_ID], '2026-09-25T21:00:00Z');
});

test('object history browsing is bounded, object-scoped and nonmutating', t => {
  const { db, runtime } = fixture(t);
  const first = runtime.createObject(input(PAGE_TYPE_ID, 'First', {}, 'Body 1'));
  let current = first;
  for (let index = 2; index <= 25; index++) current = runtime.updateObject(current.id, current.revision, { ...current, title: `Title ${index}`, body: `Body ${index}` });
  const other = runtime.createObject(input(PAGE_TYPE_ID, 'Other'));
  const trashed = runtime.setTrashed(current.id, current.revision, true);
  const before = {
    object: runtime.getObject(first.id),
    revisions: db.query('SELECT * FROM object_revisions ORDER BY object_id, revision').all(),
    refs: db.query('SELECT * FROM object_references').all(),
    receipts: db.query('SELECT * FROM object_create_requests').all(),
  };
  const page = runtime.listObjectHistory(first.id);
  assert.equal(page.revisions.length, 20);
  assert.equal(page.hasMore, true);
  assert.equal(page.revisions[0]!.revision, current.revision);
  assert.equal(page.revisions[0]!.trashed, false);
  const next = runtime.listObjectHistory(first.id, 20);
  assert.equal(next.revisions.length, 5);
  assert.equal(next.hasMore, false);
  assert.deepEqual(runtime.getObjectRevision(first.id, first.revision), first);
  assert.deepEqual(runtime.getObject(first.id), before.object);
  assert.deepEqual(db.query('SELECT * FROM object_revisions ORDER BY object_id, revision').all(), before.revisions);
  assert.deepEqual(db.query('SELECT * FROM object_references').all(), before.refs);
  assert.deepEqual(db.query('SELECT * FROM object_create_requests').all(), before.receipts);
  assert.deepEqual(runtime.listObjectHistory(other.id), { revisions: [], hasMore: false });
  assert.equal(runtime.getObject(first.id).trashed, true);
  assert.deepEqual(runtime.getObject(first.id), trashed);
  assert.throws(() => runtime.listObjectHistory('not-an-id'), status(422));
  assert.throws(() => runtime.listObjectHistory(first.id, -1), status(422));
  assert.throws(() => runtime.getObjectRevision(first.id, 0), status(422));
  assert.throws(() => runtime.getObjectRevision(first.id, 999), status(404));
  assert.throws(() => runtime.getObjectRevision(other.id, first.revision), status(404));
});

test('typed browse summaries match full browse without loading bodies and use type index', t => {
  const { db, runtime } = fixture(t);
  const other = runtime.createType('Other');
  const typedIds: string[] = [];
  for (let index = 0; index < 12; index++) {
    const record = runtime.createObject(input(PAGE_TYPE_ID, `Typed ${index}`, {}, index === 3 ? 'literal 100%_\\ needle' : 'body'));
    typedIds.push(record.id);
  }
  for (let index = 0; index < 40; index++) runtime.createObject(input(other.id, `Other ${index}`, {}, 'needle'));
  const full = runtime.listObjects({ typeId: PAGE_TYPE_ID, search: '100%_\\ needle' });
  let capturedSql = '';
  let capturedValues: (string | number)[] = [];
  const originalQuery = db.query.bind(db);
  db.query = ((sql: string) => {
    const statement = originalQuery(sql);
    if (sql.includes('SELECT id, type_id, title, revision, created_at, updated_at, trashed FROM objects WHERE')) {
      capturedSql = sql;
      const originalAll = statement.all.bind(statement);
      statement.all = ((...values: (string | number)[]) => {
        capturedValues = values;
        return originalAll(...values);
      }) as typeof statement.all;
    }
    return statement;
  }) as typeof db.query;
  t.after(() => { db.query = originalQuery as typeof db.query; });
  const summaries = runtime.listObjectSummaries({ typeId: PAGE_TYPE_ID, search: '100%_\\ needle' });
  assert.deepEqual(summaries.map(object => object.id), full.map(object => object.id));
  assert.equal(full[0]?.body, 'literal 100%_\\ needle');
  assert.equal(Object.hasOwn(summaries[0] as object, 'body'), false);
  assert.equal(Object.hasOwn(summaries[0] as object, 'properties'), false);
  assert.ok(capturedSql);
  assert.deepEqual(capturedValues, [0, PAGE_TYPE_ID, '%100\\%\\_\\\\ needle%', '%100\\%\\_\\\\ needle%', 50, 0]);
  const plan = originalQuery<{ detail: string }, (string | number)[]>(`EXPLAIN QUERY PLAN ${capturedSql}`).all(...capturedValues).map(row => row.detail).join('\n');
  assert.match(plan, /objects_type_browse/);
  assert.deepEqual(runtime.listObjectSummaries({ typeId: PAGE_TYPE_ID, limit: 3, offset: 2 }).map(object => object.id), runtime.listObjects({ typeId: PAGE_TYPE_ID, limit: 3, offset: 2 }).map(object => object.id));
  assert.equal(runtime.listObjectSummaries({ search: 'needle' }).some(object => object.typeId === PAGE_TYPE_ID), true);
  assert.equal(runtime.listObjectSummaries({ search: 'needle' }).some(object => object.typeId === other.id), true);
  assert.deepEqual(runtime.listObjects({ trashed: false, limit: 3 }).map(object => Object.hasOwn(object, 'body')), [true, true, true]);
  assert.throws(() => runtime.listObjects({ typeId: '' }), status(422));
  assert.throws(() => runtime.listObjectSummaries({ typeId: '' }), status(422));
  assert.throws(() => runtime.listObjects({ typeId: 'not-a-uuid' }), status(422));
  assert.throws(() => runtime.listObjectSummaries({ typeId: 'not-a-uuid' }), status(422));
  assert.ok(typedIds.length);
});

test('backlinks are paginated deterministically without dropping edges or loading bodies', t => {
  const { db, runtime } = fixture(t);
  const people = runtime.createType('Person');
  const target = runtime.createObject(input(people.id, 'Ada'));
  let page = runtime.getType(PAGE_TYPE_ID);
  page = runtime.addProperty(page.id, page.revision, { label: 'Person', kind: 'reference', targetTypeId: people.id, multiple: false });
  const reference = page.propertyIds[0]!;
  const ids: string[] = [];
  for (let index = 0; index < 104; index++) {
    const source = runtime.createObject(input(page.id, `Source ${String(index).padStart(3, '0')}`, { [reference]: target.id }, `[Ada](/objects/${index === 0 ? target.id.toUpperCase() : target.id})`));
    ids.push(source.id);
  }
  const trashed = runtime.setTrashed(ids[1]!, runtime.getObject(ids[1]!).revision, true);
  assert.equal(trashed.trashed, true);
  db.query('UPDATE objects SET updated_at = ? WHERE id IN (SELECT source_id FROM object_references WHERE target_id = ?)').run('2026-01-01T00:00:00.000Z', target.id);
  const beforeHistory = db.query<{ count: number }, []>('SELECT COUNT(*) AS count FROM object_revisions').get()!.count;
  const beforeEdges = db.query<{ count: number }, []>('SELECT COUNT(*) AS count FROM object_references').get()!.count;
  const first = runtime.backlinks(target.id);
  const second = runtime.backlinks(target.id, 50);
  const third = runtime.backlinks(target.id, 100);
  const fourth = runtime.backlinks(target.id, 150);
  const fifth = runtime.backlinks(target.id, 200);
  assert.equal(first.links.length, 50);
  assert.equal(first.offset, 0);
  assert.equal(first.hasMore, true);
  assert.equal(second.links.length, 50);
  assert.equal(second.hasMore, true);
  assert.equal(third.links.length, 50);
  assert.equal(third.hasMore, true);
  assert.equal(fourth.links.length, 50);
  assert.equal(fourth.hasMore, true);
  assert.equal(fifth.links.length, 8);
  assert.equal(fifth.hasMore, false);
  assert.equal(runtime.backlinks(target.id, 250).links.length, 0);
  const allLinks = [...first.links, ...second.links, ...third.links, ...fourth.links, ...fifth.links];
  assert.ok(allLinks.some(link => link.object.trashed));
  assert.ok(allLinks.some(link => link.object.id === ids[0] && link.propertyId === reference));
  assert.ok(allLinks.some(link => link.object.id === ids[0] && link.propertyId === undefined));
  assert.deepEqual(allLinks.map(link => `${link.object.id}:${link.propertyId ?? ''}`), allLinks.map(link => `${link.object.id}:${link.propertyId ?? ''}`).sort());
  assert.equal(Object.hasOwn(first.links[0]!.object as object, 'body'), false);
  assert.throws(() => runtime.backlinks(target.id, -1), status(422));
  assert.throws(() => runtime.backlinks(target.id, 1_000_001), status(422));
  assert.equal(db.query<{ count: number }, []>('SELECT COUNT(*) AS count FROM object_revisions').get()!.count, beforeHistory);
  assert.equal(db.query<{ count: number }, []>('SELECT COUNT(*) AS count FROM object_references').get()!.count, beforeEdges);
});

test('reference validation uses target summaries and unchanged writing derivations are preserved on property edits', t => {
  const { db, runtime } = fixture(t);
  const targetType = runtime.createType('Reference targets');
  const target = runtime.createObject(input(targetType.id, 'Large target', {}, 'x'.repeat(64 * 1024)));
  const other = runtime.createObject(input(targetType.id, 'Other large target', {}, 'y'.repeat(64 * 1024)));
  let page = runtime.getType(PAGE_TYPE_ID);
  page = runtime.addProperty(page.id, page.revision, { label: 'Targets', kind: 'reference', targetTypeId: targetType.id, multiple: true });
  page = runtime.addProperty(page.id, page.revision, { label: 'Note', kind: 'text' });
  const references = page.propertyIds[0]!;
  const note = page.propertyIds[1]!;
  const body = `[Large](/objects/${target.id})\n\n${'body '.repeat(200)}`;
  const source = runtime.createObject(input(page.id, 'Source', { [references]: [target.id] }, body));
  const sourceBodyText = db.query<{ body_text: string }, [string]>('SELECT body_text FROM objects WHERE id = ?').get(source.id)!.body_text;
  const sourceWritingEdges = db.query('SELECT target_id FROM object_references WHERE source_id = ? AND property_id = \'\' ORDER BY target_id').all(source.id);

  class SummaryOnlyRuntime extends ObjectRuntime {
    override getObject(id: string) {
      if (id.toLowerCase() === target.id.toLowerCase() || id.toLowerCase() === other.id.toLowerCase()) throw new Error('full target read');
      return super.getObject(id);
    }
  }
  const checked = new SummaryOnlyRuntime(db);
  db.exec(`CREATE TEMP TRIGGER unchanged_body_text BEFORE UPDATE OF body_text ON objects WHEN OLD.id = '${source.id}' BEGIN SELECT RAISE(ABORT, 'body_text changed'); END`);
  db.exec(`CREATE TEMP TRIGGER unchanged_writing_edges BEFORE DELETE ON object_references WHEN OLD.source_id = '${source.id}' AND OLD.property_id = '' BEGIN SELECT RAISE(ABORT, 'writing edge rewritten'); END`);

  const edited = checked.patchProperties(source.id, source.revision, { [note]: 'property only', [references]: [target.id, other.id] });
  assert.equal(edited.body, source.body);
  assert.equal(db.query<{ body_text: string }, [string]>('SELECT body_text FROM objects WHERE id = ?').get(source.id)!.body_text, sourceBodyText);
  assert.deepEqual(db.query('SELECT target_id FROM object_references WHERE source_id = ? AND property_id = \'\' ORDER BY target_id').all(source.id), sourceWritingEdges);
  assert.deepEqual(checked.backlinks(other.id).links.map(link => ({ id: link.object.id, propertyId: link.propertyId })), [{ id: source.id, propertyId: references }]);

  assert.throws(() => checked.patchProperties(edited.id, edited.revision, { [references]: [crypto.randomUUID()] }), status(404));
  assert.deepEqual(checked.getObject(source.id), edited);
});

test('writing edits refresh search text and writing backlinks while failures roll back', t => {
  const { db, runtime } = fixture(t);
  const first = runtime.createObject(input(PAGE_TYPE_ID, 'First target'));
  const second = runtime.createObject(input(PAGE_TYPE_ID, 'Second target'));
  const source = runtime.createObject(input(PAGE_TYPE_ID, 'Source', {}, `[First](/objects/${first.id})`));
  const edited = runtime.updateObject(source.id, source.revision, { ...source, body: `[Second](/objects/${second.id})\n\nneedle-text` });
  assert.equal(runtime.backlinks(first.id).links.length, 0);
  assert.deepEqual(runtime.backlinks(second.id).links.map(link => link.object.id), [source.id]);
  assert.equal(db.query<{ body_text: string }, [string]>('SELECT body_text FROM objects WHERE id = ?').get(source.id)!.body_text.includes('needle-text'), true);

  db.exec(`CREATE TEMP TRIGGER fail_changed_writing_edge BEFORE INSERT ON object_references WHEN NEW.source_id = '${source.id}' AND NEW.property_id = '' BEGIN SELECT RAISE(ABORT, 'edge failure'); END`);
  assert.throws(() => runtime.updateObject(edited.id, edited.revision, { ...edited, body: `[First](/objects/${first.id})` }), /edge failure/);
  assert.deepEqual(runtime.getObject(source.id), edited);
  assert.deepEqual(runtime.backlinks(second.id).links.map(link => link.object.id), [source.id]);
});
