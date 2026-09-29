import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Database } from 'bun:sqlite';
import { openDatabase } from '../src/database.js';
import { ObjectRuntime } from '../src/objects/runtime.js';
import { initializeApplicationSchema, rejectUnsupportedApplicationSchema } from '../src/schema.js';
import { PAGE_TYPE_ID } from '../src/objects/model.js';

test('fresh schema initializes version 7 without mutable definition tables', () => {
  const db = openDatabase();
  const runtime = new ObjectRuntime(db);
  assert.equal(db.query<{ value: string }, []>("SELECT value FROM object_metadata WHERE key='schema_version'").get()!.value, '7');
  assert.equal(db.query("SELECT 1 FROM sqlite_schema WHERE name='object_types'").get(), null);
  const object = runtime.createObject({ typeId: PAGE_TYPE_ID, title: 'Page', properties: {}, body: '' });
  assert.equal(runtime.getObject(object.id).title, 'Page');
  db.close();
});

test('old or incomplete application schemas are refused without conversion', () => {
  const old = new Database(':memory:', { strict: true });
  old.exec("CREATE TABLE object_metadata(key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT; INSERT INTO object_metadata VALUES('schema_version','6'); CREATE TABLE objects(id TEXT PRIMARY KEY) STRICT;");
  assert.throws(() => initializeApplicationSchema(old), /Unsupported object database schema/);
  old.close();
  const unrelated = new Database(':memory:', { strict: true });
  unrelated.exec('CREATE TABLE notes(id TEXT PRIMARY KEY) STRICT;');
  assert.doesNotThrow(() => rejectUnsupportedApplicationSchema(unrelated));
  unrelated.close();
});
