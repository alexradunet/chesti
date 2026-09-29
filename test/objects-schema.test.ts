import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Database } from 'bun:sqlite';
import { openDatabase } from '../src/database.js';
import { ObjectRuntime } from '../src/objects/runtime.js';
import { initializeApplicationSchema, rejectUnsupportedApplicationSchema } from '../src/schema.js';
import { PAGE_TYPE_ID } from '../src/objects/model.js';

test('fresh schema initializes version 8 without mutable definition tables', () => {
  const db = openDatabase();
  const runtime = new ObjectRuntime(db);
  assert.equal(db.query<{ value: string }, []>("SELECT value FROM object_metadata WHERE key='schema_version'").get()!.value, '8');
  assert.equal(db.query("SELECT 1 FROM sqlite_schema WHERE name='object_types'").get(), null);
  // Retired fixed domains (Reminder, Daily Page) are structurally refused, not just hidden.
  assert.equal(db.query("SELECT name FROM sqlite_schema WHERE name LIKE 'objects_journal_date%'").get(), null);
  assert.throws(() => db.query("INSERT INTO objects(id, type_id, title, properties_json, body, body_text, revision, trashed, created_at, updated_at) VALUES('x','00000000-0000-4000-8000-000000000004','t','{}','','',1,0,'2026-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z')").run(), /CHECK/);
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
