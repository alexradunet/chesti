import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../src/database.js';
import { AppError } from '../src/core.js';
import { ObjectRuntime } from '../src/objects/runtime.js';
import { ViewService } from '../src/objects/views.js';
import { TASK_TYPE_ID, TASK_DONE_PROPERTY_ID, TASK_DUE_PROPERTY_ID, PAGE_TYPE_ID } from '../src/objects/model.js';

const status = (code: number) => (error: unknown) => error instanceof AppError && error.status === code;

test('fixed-field views validate, publish, evaluate and act through canonical commands', () => {
  const db = openDatabase();
  const runtime = new ObjectRuntime(db);
  const views = new ViewService(runtime);
  const task = runtime.createObject({ typeId: TASK_TYPE_ID, title: 'Task', properties: { [TASK_DONE_PROPERTY_ID]: false, [TASK_DUE_PROPERTY_ID]: '2026-01-01' }, body: 'body' });
  const draft = views.create({ model: 'test', spec: { title: 'Tasks', blocks: [{ title: 'Board', component: 'board', editable: true, columns: [{ role: 'due', label: 'Due' }], sources: [{ typeId: TASK_TYPE_ID, bindings: { group: TASK_DONE_PROPERTY_ID, due: TASK_DUE_PROPERTY_ID } }] }] } }, 'prompt');
  assert.equal(views.evaluate(draft.id).blocks[0]!.rows.length, 1);
  const published = views.publish(draft.id, draft.revision);
  views.act(published.id, published.revision, 0, task.id, task.revision, 'group', true);
  assert.equal(runtime.getObject(task.id).properties[TASK_DONE_PROPERTY_ID], true);
  db.close();
});

test('retired input/reference/select view shapes are rejected', () => {
  const db = openDatabase();
  const runtime = new ObjectRuntime(db);
  const views = new ViewService(runtime);
  assert.throws(() => views.create({ model: 'test', spec: { title: 'Input', input: { label: 'Page', typeId: PAGE_TYPE_ID }, blocks: [{ title: 'List', component: 'list', sources: [{ typeId: TASK_TYPE_ID, bindings: {}, where: [{ propertyId: TASK_DUE_PROPERTY_ID, operator: 'equals', value: { input: true } }] }] }] } as never }, 'prompt'), status(422));
  db.close();
});
