import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../src/database.js';
import { ObjectRuntime } from '../src/objects/runtime.js';
import { seedDemo } from '../src/objects/demo.js';
import { PERSON_TYPE_ID, TASK_TYPE_ID } from '../src/objects/model.js';
import { ViewService } from '../src/objects/views.js';

test('demo seeds only fixed domains, writing links and published views', () => {
  const db = openDatabase();
  const runtime = new ObjectRuntime(db);
  seedDemo(runtime);
  assert.equal(runtime.listObjectSummaries({ typeId: PERSON_TYPE_ID }).length, 1);
  assert.ok(runtime.listObjectSummaries({ typeId: TASK_TYPE_ID }).length >= 1);
  const views = new ViewService(runtime).list();
  assert.equal(views.every(view => view.status === 'published' && view.model === 'built-in/demo'), true);
  assert.equal(runtime.catalog().types.length, 4);
  db.close();
});
