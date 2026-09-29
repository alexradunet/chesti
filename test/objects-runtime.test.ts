import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../src/database.js';
import { AppError } from '../src/core.js';
import { ObjectRuntime } from '../src/objects/runtime.js';
import { PAGE_TYPE_ID, TASK_TYPE_ID, TASK_DONE_PROPERTY_ID, TASK_DUE_PROPERTY_ID, EVENT_TYPE_ID, EVENT_DATES_PROPERTY_ID, EVENT_TIME_PROPERTY_ID, PAGE_DATE_PROPERTY_ID, PERSON_TYPE_ID, PERSON_RECONNECT_EVERY_PROPERTY_ID } from '../src/objects/model.js';

const status = (code: number) => (error: unknown) => error instanceof AppError && error.status === code;

test('catalog is fixed and schema mutation APIs do not exist', () => {
  const db = openDatabase();
  const runtime = new ObjectRuntime(db);
  assert.deepEqual(runtime.catalog().types.map(type => type.name), ['Page', 'Task', 'Event', 'Person']);
  assert.equal('createType' in runtime, false);
  assert.equal('addProperty' in runtime, false);
  assert.equal(db.query("SELECT name FROM sqlite_schema WHERE name = 'object_types'").get(), null);
  db.close();
});

test('fixed-domain writes validate field membership, rules, history, receipts and writing backlinks', () => {
  const db = openDatabase();
  const runtime = new ObjectRuntime(db);
  const page = runtime.createObject({ typeId: PAGE_TYPE_ID, title: 'Page', properties: {}, body: 'hello' }, crypto.randomUUID());
  assert.throws(() => runtime.createObject({ typeId: PAGE_TYPE_ID, title: 'Bad', properties: { [TASK_DUE_PROPERTY_ID]: '2026-01-01' }, body: '' }), status(422));
  const taskRequest = crypto.randomUUID();
  const task = runtime.createObject({ typeId: TASK_TYPE_ID, title: 'Task', properties: { [TASK_DUE_PROPERTY_ID]: '2026-01-02' }, body: `[Page](/objects/${page.id.toUpperCase()})` }, taskRequest);
  assert.equal(task.properties[TASK_DONE_PROPERTY_ID], false);
  assert.equal(runtime.createObject({ typeId: TASK_TYPE_ID, title: 'Task', properties: { [TASK_DUE_PROPERTY_ID]: '2026-01-02' }, body: `[Page](/objects/${page.id.toUpperCase()})` }, taskRequest).id, task.id);
  assert.equal(runtime.backlinks(page.id).links[0]?.object.id, task.id);
  const updated = runtime.updateObject(task.id, task.revision, { ...task, title: 'Task updated' });
  assert.equal(runtime.listObjectHistory(task.id).revisions[0]?.revision, task.revision);
  assert.throws(() => runtime.updateObject(task.id, task.revision, { ...updated, title: 'stale' }), status(409));
  db.close();
});

test('domain-specific rules are enforced for events, day pages and people', () => {
  const db = openDatabase();
  const runtime = new ObjectRuntime(db);
  assert.throws(() => runtime.createObject({ typeId: EVENT_TYPE_ID, title: 'Bad event', properties: { [EVENT_DATES_PROPERTY_ID]: { start: '2026-01-01', end: '2026-01-02' }, [EVENT_TIME_PROPERTY_ID]: { start: '2026-01-01T10:00:00Z', end: '2026-01-01T11:00:00Z', timeZone: 'UTC' } }, body: '' }), status(422));
  // Several pages can share one date; the daily page is the one titled with the date.
  const dated = runtime.createObject({ typeId: PAGE_TYPE_ID, title: 'Lace notes', properties: { [PAGE_DATE_PROPERTY_ID]: '2026-02-03' }, body: '' });
  const dayPage = runtime.openDayPage('2026-02-03');
  assert.equal(runtime.openDayPage('2026-02-03').id, dayPage.id);
  assert.equal(dayPage.title, '2026-02-03');
  assert.deepEqual(new Set(runtime.listDayPages('2026-02-03').items.map(record => record.id)), new Set([dayPage.id, dated.id]));
  assert.equal(runtime.findDayPage('2026-02-03')?.id, dayPage.id);
  assert.equal(runtime.findDayPage('2026-02-04'), undefined);
  // Saving through the day flow enforces the date title and rejects stale revisions.
  const saved = runtime.saveDayPage({ date: '2026-02-03', body: 'Writing', objectId: dayPage.id, revision: dayPage.revision });
  assert.equal(saved.title, '2026-02-03');
  assert.throws(() => runtime.saveDayPage({ date: '2026-02-03', body: 'Stale', objectId: dayPage.id, revision: dayPage.revision }), status(409));
  const otherDay = runtime.createObject({ typeId: PAGE_TYPE_ID, title: 'Other day', properties: { [PAGE_DATE_PROPERTY_ID]: '2026-02-04' }, body: '' });
  assert.throws(() => runtime.saveDayPage({ date: '2026-02-03', body: 'Wrong day', objectId: otherDay.id, revision: otherDay.revision }), status(409));
  assert.throws(() => runtime.saveDayPage({ date: '2026-02-03', body: '   ', requestId: crypto.randomUUID() }), status(422));
  assert.throws(() => runtime.createObject({ typeId: PERSON_TYPE_ID, title: 'Person', properties: { [PERSON_RECONNECT_EVERY_PROPERTY_ID]: 121 }, body: '' }), status(422));
  db.close();
});
