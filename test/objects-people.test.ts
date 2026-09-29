import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../src/database.js';
import { ObjectRuntime } from '../src/objects/runtime.js';
import { PERSON_TYPE_ID, PERSON_LAST_CONNECTED_PROPERTY_ID, PERSON_RECONNECT_EVERY_PROPERTY_ID, PERSON_RELATIONSHIP_PROPERTY_ID } from '../src/objects/model.js';
import { reconnectDate } from '../src/objects/people.js';

test('people use fixed Person fields and derive reconnect dates without writes', () => {
  const db = openDatabase();
  const runtime = new ObjectRuntime(db);
  const person = runtime.createObject({ typeId: PERSON_TYPE_ID, title: 'Ada', properties: { [PERSON_RELATIONSHIP_PROPERTY_ID]: 'Friend', [PERSON_LAST_CONNECTED_PROPERTY_ID]: '2026-01-31', [PERSON_RECONNECT_EVERY_PROPERTY_ID]: 1 }, body: '' });
  assert.equal(runtime.listPeople().items[0]!.id, person.id);
  assert.equal(reconnectDate(person.properties), '2026-02-28');
  assert.equal(runtime.getObject(person.id).revision, 1);
  db.close();
});
