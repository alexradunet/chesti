import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../src/database.js';
import { ObjectRuntime } from '../src/objects/runtime.js';
import { PAGE_TYPE_ID, TASK_TYPE_ID, TASK_DUE_PROPERTY_ID, TASK_SCHEDULED_PROPERTY_ID } from '../src/objects/model.js';

test('day task query returns scheduled or due fixed-domain tasks once without bodies', () => {
  const db = openDatabase();
  const runtime = new ObjectRuntime(db);
  runtime.createObject({ typeId: TASK_TYPE_ID, title: 'Both', properties: { [TASK_DUE_PROPERTY_ID]: '2026-01-01', [TASK_SCHEDULED_PROPERTY_ID]: '2026-01-01' }, body: 'hidden' });
  runtime.createObject({ typeId: PAGE_TYPE_ID, title: 'Page', properties: {}, body: '2026-01-01' });
  const tasks = runtime.listDayTasks('2026-01-01');
  assert.equal(tasks.items.length, 1);
  assert.equal(tasks.items[0]!.matchesDue, true);
  assert.equal(tasks.items[0]!.matchesScheduled, true);
  db.close();
});
