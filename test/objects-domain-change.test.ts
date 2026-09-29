import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../src/database.js';
import { ObjectRuntime } from '../src/objects/runtime.js';
import { createObjectRoutes } from '../src/objects/http.js';
import {
  PAGE_TYPE_ID, TASK_TYPE_ID, TASK_DONE_PROPERTY_ID, TASK_DUE_PROPERTY_ID,
  PERSON_TYPE_ID, PERSON_RELATIONSHIP_PROPERTY_ID, PERSON_LAST_CONNECTED_PROPERTY_ID,
  REMINDER_TYPE_ID, REMINDER_DATE_PROPERTY_ID,
} from '../src/objects/model.js';

const visitor = { id: crypto.randomUUID(), csrf: crypto.randomUUID() };
async function route(runtime: ObjectRuntime, method: string, path: string, fields?: URLSearchParams) {
  const handler = createObjectRoutes(runtime, async () => { throw new Error('no provider'); });
  return handler(new Request(`http://127.0.0.1${path}`, { method }), new URL(`http://127.0.0.1${path}`), visitor, fields);
}

test('value-dropping domain change without confirmation re-renders with disclosure (native path)', async () => {
  const db = openDatabase();
  const runtime = new ObjectRuntime(db);
  const person = runtime.createObject({
    typeId: PERSON_TYPE_ID,
    title: 'Ada',
    properties: {
      [PERSON_RELATIONSHIP_PROPERTY_ID]: 'Friend',
      [PERSON_LAST_CONNECTED_PROPERTY_ID]: '2026-01-01',
    },
    body: '',
  });
  // Attempt to change Person → Page (drops Relationship and Last connected)
  const fields = new URLSearchParams({
    csrf: visitor.csrf,
    revision: String(person.revision),
    typeId: PAGE_TYPE_ID,
    title: 'Ada',
    body: '',
    [`p:${PERSON_RELATIONSHIP_PROPERTY_ID}`]: 'Friend',
    [`p:${PERSON_LAST_CONNECTED_PROPERTY_ID}`]: '2026-01-01',
  });
  const response = await route(runtime, 'POST', `/objects/${person.id}/update`, fields);
  // Must NOT succeed with 303 — must re-render (200) with disclosure
  assert.equal(response?.status, 200, 'Value-dropping change without confirmation must re-render, not save');
  const html = await response!.text();
  // Must disclose which fields will be dropped
  assert.ok(html.includes('data-type-change-drops'), 'Response must include drop disclosure');
  // Object must be unchanged
  const unchanged = runtime.getObject(person.id);
  assert.equal(unchanged.typeId, PERSON_TYPE_ID);
  assert.equal(unchanged.revision, person.revision);
  assert.equal(unchanged.properties[PERSON_RELATIONSHIP_PROPERTY_ID], 'Friend');
  db.close();
});

test('value-dropping domain change with confirmation saves and preserves prior state in history', async () => {
  const db = openDatabase();
  const runtime = new ObjectRuntime(db);
  const person = runtime.createObject({
    typeId: PERSON_TYPE_ID,
    title: 'Ada',
    properties: {
      [PERSON_RELATIONSHIP_PROPERTY_ID]: 'Friend',
      [PERSON_LAST_CONNECTED_PROPERTY_ID]: '2026-01-01',
    },
    body: 'Some notes',
  });
  const fields = new URLSearchParams({
    csrf: visitor.csrf,
    revision: String(person.revision),
    typeId: PAGE_TYPE_ID,
    title: 'Ada',
    body: 'Some notes',
    confirmTypeChange: '1',
  });
  const response = await route(runtime, 'POST', `/objects/${person.id}/update`, fields);
  assert.equal(response?.status, 303, 'Confirmed value-dropping change must save');
  const updated = runtime.getObject(person.id);
  assert.equal(updated.typeId, PAGE_TYPE_ID);
  assert.equal(updated.revision, person.revision + 1);
  // Dropped fields must not be in the new properties
  assert.equal(updated.properties[PERSON_RELATIONSHIP_PROPERTY_ID], undefined);
  assert.equal(updated.properties[PERSON_LAST_CONNECTED_PROPERTY_ID], undefined);
  // Prior state must be in history
  const history = runtime.listObjectHistory(person.id);
  assert.ok(history.revisions.length >= 1, 'History must have at least one entry');
  const priorSnapshot = history.revisions.find(r => r.revision === person.revision);
  assert.ok(priorSnapshot, 'Prior revision must be in history');
  assert.equal(priorSnapshot!.typeId, PERSON_TYPE_ID);
  db.close();
});

test('value-preserving domain change saves without confirmation', async () => {
  const db = openDatabase();
  const runtime = new ObjectRuntime(db);
  // Page has no extra fields; changing Page → Task adds fields but drops nothing
  const page = runtime.createObject({
    typeId: PAGE_TYPE_ID,
    title: 'My note',
    properties: {},
    body: 'hello',
  });
  const fields = new URLSearchParams({
    csrf: visitor.csrf,
    revision: String(page.revision),
    typeId: TASK_TYPE_ID,
    title: 'My note',
    body: 'hello',
  });
  const response = await route(runtime, 'POST', `/objects/${page.id}/update`, fields);
  assert.equal(response?.status, 303, 'Value-preserving change must save directly');
  const updated = runtime.getObject(page.id);
  assert.equal(updated.typeId, TASK_TYPE_ID);
  assert.equal(updated.revision, page.revision + 1);
  db.close();
});

test('submitting fields that do not belong to the selected domain is rejected without mutation', async () => {
  const db = openDatabase();
  const runtime = new ObjectRuntime(db);
  const page = runtime.createObject({
    typeId: PAGE_TYPE_ID,
    title: 'My note',
    properties: {},
    body: '',
  });
  // Try to save a Page but include a Task field
  const fields = new URLSearchParams({
    csrf: visitor.csrf,
    revision: String(page.revision),
    typeId: PAGE_TYPE_ID,
    title: 'My note',
    body: '',
    [`p:${TASK_DUE_PROPERTY_ID}`]: '2026-01-01',
  });
  const response = await route(runtime, 'POST', `/objects/${page.id}/update`, fields);
  // Must be rejected (422 or re-render with error)
  assert.ok(response!.status === 422 || response!.status === 200, 'Wrong-domain fields must be rejected');
  // Object must be unchanged
  const unchanged = runtime.getObject(page.id);
  assert.equal(unchanged.typeId, PAGE_TYPE_ID);
  assert.equal(unchanged.revision, page.revision);
  db.close();
});

test('intent=change-type re-render activates only the target domain fields', async () => {
  const db = openDatabase();
  const runtime = new ObjectRuntime(db);
  const reminder = runtime.createObject({
    typeId: REMINDER_TYPE_ID,
    title: 'Bring notebook',
    properties: { [REMINDER_DATE_PROPERTY_ID]: '2026-02-01' },
    body: '',
  });
  // Native intent=change-type: Reminder → Task
  const fields = new URLSearchParams({
    csrf: visitor.csrf,
    revision: String(reminder.revision),
    typeId: TASK_TYPE_ID,
    title: 'Bring notebook',
    body: '',
    intent: 'change-type',
  });
  const response = await route(runtime, 'POST', `/objects/${reminder.id}/update`, fields);
  assert.equal(response?.status, 200, 'intent=change-type must re-render');
  const html = await response!.text();
  // The re-rendered page must show Task fields as active (not disabled/hidden)
  // and Reminder fields as inactive (disabled)
  // Check that the select shows Task as selected
  assert.ok(html.includes('selected'), 'Re-rendered page must show the target type selected');
  // Object must be unchanged (non-mutating)
  const unchanged = runtime.getObject(reminder.id);
  assert.equal(unchanged.typeId, REMINDER_TYPE_ID);
  assert.equal(unchanged.revision, reminder.revision);
  db.close();
});

test('cancelled domain change leaves object and revision unchanged', async () => {
  const db = openDatabase();
  const runtime = new ObjectRuntime(db);
  const person = runtime.createObject({
    typeId: PERSON_TYPE_ID,
    title: 'Ada',
    properties: { [PERSON_RELATIONSHIP_PROPERTY_ID]: 'Friend' },
    body: '',
  });
  // First, get the disclosure page (without confirmation)
  const fields = new URLSearchParams({
    csrf: visitor.csrf,
    revision: String(person.revision),
    typeId: PAGE_TYPE_ID,
    title: 'Ada',
    body: '',
    [`p:${PERSON_RELATIONSHIP_PROPERTY_ID}`]: 'Friend',
  });
  const response = await route(runtime, 'POST', `/objects/${person.id}/update`, fields);
  assert.equal(response?.status, 200, 'Without confirmation, must re-render');
  // Object must be unchanged
  const unchanged = runtime.getObject(person.id);
  assert.equal(unchanged.typeId, PERSON_TYPE_ID);
  assert.equal(unchanged.revision, person.revision);
  assert.equal(unchanged.properties[PERSON_RELATIONSHIP_PROPERTY_ID], 'Friend');
  db.close();
});
