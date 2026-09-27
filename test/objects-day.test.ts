import { test } from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { AppError } from '../src/core.js';
import { openDatabase } from '../src/database.js';
import { PAGE_TYPE_ID, TASK_DONE_PROPERTY_ID, TASK_DUE_PROPERTY_ID, TASK_SCHEDULED_PROPERTY_ID, TASK_TYPE_ID } from '../src/objects/model.js';
import type { ObjectWrite, PropertyValue } from '../src/objects/model.js';
import { ObjectRuntime } from '../src/objects/runtime.js';

function fixture(t: TestContext) {
  const db = openDatabase();
  t.after(() => db.close());
  return { db, runtime: new ObjectRuntime(db) };
}
function input(typeId = PAGE_TYPE_ID, title = 'Object', properties: Record<string, PropertyValue> = {}, body = ''): ObjectWrite {
  return { typeId, title, properties, body };
}
function status(code: number): (error: unknown) => boolean {
  return error => error instanceof AppError && error.status === code;
}

test('day task query returns scheduled or due tasks once without reading Markdown bodies', t => {
  const { runtime } = fixture(t);
  const due = runtime.createObject(input(TASK_TYPE_ID, 'B due', { [TASK_DUE_PROPERTY_ID]: '2026-09-27' }, 'body that should not project'));
  const scheduled = runtime.createObject(input(TASK_TYPE_ID, 'A scheduled', { [TASK_SCHEDULED_PROPERTY_ID]: '2026-09-27' }));
  const both = runtime.createObject(input(TASK_TYPE_ID, 'C both', { [TASK_DUE_PROPERTY_ID]: '2026-09-27', [TASK_SCHEDULED_PROPERTY_ID]: '2026-09-27', [TASK_DONE_PROPERTY_ID]: true }));
  runtime.createObject(input(TASK_TYPE_ID, 'Wrong day', { [TASK_DUE_PROPERTY_ID]: '2026-09-28', [TASK_SCHEDULED_PROPERTY_ID]: '2026-09-26' }));
  runtime.createObject(input(TASK_TYPE_ID, 'No date'));
  const trashed = runtime.createObject(input(TASK_TYPE_ID, 'Trashed', { [TASK_DUE_PROPERTY_ID]: '2026-09-27' }));
  runtime.setTrashed(trashed.id, trashed.revision, true);
  runtime.createObject(input(PAGE_TYPE_ID, 'Page with date-shaped property', { [TASK_DUE_PROPERTY_ID]: '2026-09-27' }));

  const page = runtime.listDayTasks('2026-09-27');
  assert.deepEqual(page.items.map(item => item.id), [scheduled.id, due.id, both.id]);
  assert.deepEqual(page.items.map(item => ({ title: item.title, due: item.matchesDue, scheduled: item.matchesScheduled, done: item.done })), [
    { title: 'A scheduled', due: false, scheduled: true, done: false },
    { title: 'B due', due: true, scheduled: false, done: false },
    { title: 'C both', due: true, scheduled: true, done: true },
  ]);
  assert.equal('body' in page.items[0]!, false);
  assert.equal(page.hasMore, false);
  assert.throws(() => runtime.listDayTasks('2026-02-29'), status(422));
});

test('created-on query uses local calendar bounds and bounded deterministic pages', t => {
  const previousTZ = process.env.TZ;
  process.env.TZ = 'America/New_York';
  try {
    const { db, runtime } = fixture(t);
    const before = runtime.createObject(input(PAGE_TYPE_ID, 'Before'));
    const first = runtime.createObject(input(PAGE_TYPE_ID, 'First'));
    const last = runtime.createObject(input(PAGE_TYPE_ID, 'Last'));
    const after = runtime.createObject(input(PAGE_TYPE_ID, 'After'));
    db.query('UPDATE objects SET created_at = ? WHERE id = ?').run('2026-03-08T04:59:59.999Z', before.id);
    db.query('UPDATE objects SET created_at = ? WHERE id = ?').run('2026-03-08T05:00:00.000Z', first.id);
    db.query('UPDATE objects SET created_at = ? WHERE id = ?').run('2026-03-09T03:59:59.999Z', last.id);
    db.query('UPDATE objects SET created_at = ? WHERE id = ?').run('2026-03-09T04:00:00.000Z', after.id);
    const page = runtime.listObjectsCreatedOn('2026-03-08');
    assert.deepEqual(page.items.map(item => item.id), [first.id, last.id]);
    assert.equal(page.hasMore, false);
  } finally {
    if (previousTZ === undefined) delete process.env.TZ; else process.env.TZ = previousTZ;
  }
});

test('favorites are idempotent shared metadata and hide trashed members', t => {
  const { runtime } = fixture(t);
  const object = runtime.createObject(input(PAGE_TYPE_ID, 'Favorite'));
  runtime.setFavorite(object.id.toUpperCase(), true);
  runtime.setFavorite(object.id, true);
  assert.equal(runtime.isFavorite(object.id), true);
  assert.deepEqual(runtime.listFavoriteObjects().items.map(item => item.id), [object.id]);
  const renamed = runtime.updateObject(object.id, object.revision, { ...object, title: 'Renamed favorite' });
  assert.equal(runtime.listFavoriteObjects().items[0]!.title, 'Renamed favorite');
  runtime.setTrashed(renamed.id, renamed.revision, true);
  assert.deepEqual(runtime.listFavoriteObjects().items, []);
  const trashed = runtime.getObject(renamed.id);
  const restored = runtime.setTrashed(trashed.id, trashed.revision, false);
  assert.deepEqual(runtime.listFavoriteObjects().items.map(item => item.id), [restored.id]);
  const revision = restored.revision;
  runtime.setFavorite(restored.id, false);
  runtime.setFavorite(restored.id, false);
  assert.equal(runtime.getObject(restored.id).revision, revision);
  assert.equal(runtime.isFavorite(restored.id), false);
  runtime.setTrashed(restored.id, revision, true);
  assert.throws(() => runtime.setFavorite(restored.id, true), status(409));
  assert.throws(() => runtime.setFavorite(crypto.randomUUID(), true), status(404));
});
