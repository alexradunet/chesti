import { test } from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase } from '../src/database.js';
import { BUILTIN_PROPERTIES, BUILTIN_TYPES, EVENT_DATES_PROPERTY_ID, EVENT_TIME_PROPERTY_ID, EVENT_TYPE_ID, JOURNAL_DATE_PROPERTY_ID, JOURNAL_TYPE_ID, PAGE_TYPE_ID, REMINDER_DATE_PROPERTY_ID, REMINDER_TIME_PROPERTY_ID, REMINDER_TYPE_ID, TASK_DONE_PROPERTY_ID, TASK_DUE_PROPERTY_ID, TASK_SCHEDULED_PROPERTY_ID, TASK_TYPE_ID } from '../src/objects/model.js';
import { ObjectRuntime } from '../src/objects/runtime.js';
import { ViewService } from '../src/objects/views.js';

const customType = '11111111-1111-4111-8111-111111111111';
const textProperty = '22222222-2222-4222-8222-222222222222';
const selectProperty = '33333333-3333-4333-8333-333333333333';
const page = '44444444-4444-4444-8444-444444444444';
const task = '55555555-5555-4555-8555-555555555555';
const trashed = '66666666-6666-4666-8666-666666666666';
const viewId = '77777777-7777-4777-8777-777777777777';
const deletedViewId = '88888888-8888-4888-8888-888888888888';
const conversationId = '99999999-9999-4999-8999-999999999999';
const timestamp = '2026-09-27T12:34:56.000Z';
const LEGACY_BUILTIN_PROPERTIES = BUILTIN_PROPERTIES.filter(property => property.id !== TASK_SCHEDULED_PROPERTY_ID);
const LEGACY_BUILTIN_TYPES = BUILTIN_TYPES.map(type => type.id === TASK_TYPE_ID
  ? { ...type, description: 'Work with a completion state and an optional due date.', propertyIds: [TASK_DONE_PROPERTY_ID, TASK_DUE_PROPERTY_ID] }
  : type);

function temporaryWorkspace(t: TestContext): string {
  const directory = mkdtempSync(join(tmpdir(), 'taskdesk-schema-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return join(directory, 'workspace.sqlite');
}

function oldViewSpec(): string {
  return JSON.stringify({
    title: 'Legacy task board',
    blocks: [{
      title: 'Tasks', component: 'board', editable: true,
      sources: [{ typeId: TASK_TYPE_ID, bindings: { group: TASK_DONE_PROPERTY_ID } }],
    }],
  });
}

function oldSchemaSignature(): string {
  return JSON.stringify([[TASK_DONE_PROPERTY_ID, 'boolean', false, null]]);
}

function installV3Fixture(file: string): { schema: unknown[]; rows: Record<string, unknown[]> } {
  const db = openDatabase(file);
  db.exec(`
    CREATE TABLE object_metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT;
    INSERT INTO object_metadata VALUES ('schema_version', '3');
    CREATE TABLE object_types (id TEXT PRIMARY KEY, name TEXT NOT NULL, property_ids_json TEXT NOT NULL CHECK(json_valid(property_ids_json)), revision INTEGER NOT NULL CHECK(revision > 0)) STRICT;
    CREATE TABLE object_properties (id TEXT PRIMARY KEY, label TEXT NOT NULL, kind TEXT NOT NULL, options_json TEXT CHECK(options_json IS NULL OR json_valid(options_json)), target_type_id TEXT REFERENCES object_types(id), multiple INTEGER NOT NULL DEFAULT 0 CHECK(multiple IN (0,1)), revision INTEGER NOT NULL CHECK(revision > 0)) STRICT;
    CREATE TABLE objects (
      id TEXT PRIMARY KEY COLLATE NOCASE, type_id TEXT NOT NULL REFERENCES object_types(id), title TEXT NOT NULL,
      properties_json TEXT NOT NULL CHECK(json_valid(properties_json)), body TEXT NOT NULL DEFAULT '',
      revision INTEGER NOT NULL CHECK(revision > 0), created_at TEXT NOT NULL, updated_at TEXT NOT NULL, trashed INTEGER NOT NULL CHECK(trashed IN (0,1)), body_text TEXT NOT NULL
    ) STRICT;
    CREATE INDEX objects_browse ON objects(trashed, updated_at DESC, id);
    CREATE INDEX objects_type_browse ON objects(type_id, trashed, updated_at DESC, id);
    CREATE TABLE object_references (source_id TEXT NOT NULL COLLATE NOCASE REFERENCES objects(id), target_id TEXT NOT NULL COLLATE NOCASE REFERENCES objects(id), property_id TEXT NOT NULL DEFAULT '', PRIMARY KEY(source_id,target_id,property_id)) STRICT;
    CREATE INDEX object_references_target ON object_references(target_id);
    CREATE TABLE object_revisions (object_id TEXT NOT NULL COLLATE NOCASE REFERENCES objects(id), revision INTEGER NOT NULL, snapshot_json TEXT NOT NULL CHECK(json_valid(snapshot_json)), recorded_at TEXT NOT NULL, PRIMARY KEY(object_id,revision)) STRICT;
    CREATE TABLE object_create_requests (request_id TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, object_id TEXT NOT NULL COLLATE NOCASE REFERENCES objects(id)) STRICT;
    CREATE TABLE object_views (id TEXT PRIMARY KEY, revision INTEGER NOT NULL, status TEXT NOT NULL CHECK(status IN ('draft','published')), spec_json TEXT NOT NULL, prompt TEXT NOT NULL, model TEXT NOT NULL, schema_json TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted INTEGER NOT NULL DEFAULT 0 CHECK(deleted IN (0,1)));
    CREATE TABLE object_view_revisions (id TEXT NOT NULL, revision INTEGER NOT NULL, status TEXT NOT NULL, spec_json TEXT NOT NULL, prompt TEXT NOT NULL, model TEXT NOT NULL, schema_json TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted INTEGER NOT NULL, PRIMARY KEY(id,revision));
    CREATE TRIGGER object_view_history_no_update BEFORE UPDATE ON object_view_revisions BEGIN SELECT RAISE(ABORT, 'View revision history is immutable'); END;
    CREATE TRIGGER object_view_history_no_delete BEFORE DELETE ON object_view_revisions BEGIN SELECT RAISE(ABORT, 'View revision history is immutable'); END;
    CREATE TABLE object_view_conversations (id TEXT PRIMARY KEY, visitor_id TEXT NOT NULL, previous_id TEXT REFERENCES object_views(id), context_title TEXT NOT NULL) STRICT;
    CREATE TABLE object_view_conversation_turns (conversation_id TEXT NOT NULL REFERENCES object_view_conversations(id), position INTEGER NOT NULL CHECK(position >= 0), prompt TEXT NOT NULL, view_id TEXT NOT NULL REFERENCES object_views(id), title TEXT NOT NULL, description TEXT, model TEXT NOT NULL, PRIMARY KEY(conversation_id, position)) STRICT;
    CREATE TABLE browser_visitors (id TEXT PRIMARY KEY, csrf TEXT NOT NULL);
    CREATE TABLE unrelated (value TEXT) STRICT;
  `);
  for (const property of LEGACY_BUILTIN_PROPERTIES) {
    db.query('INSERT INTO object_properties VALUES (?, ?, ?, NULL, NULL, 0, 1)').run(property.id, property.label, property.kind);
  }
  for (const type of LEGACY_BUILTIN_TYPES) {
    const name = type.id === PAGE_TYPE_ID ? 'Renamed Page' : type.id === TASK_TYPE_ID ? 'Renamed Task' : type.name;
    const ids = type.id === PAGE_TYPE_ID ? [textProperty, selectProperty] : type.id === TASK_TYPE_ID ? [...type.propertyIds, textProperty] : type.propertyIds;
    db.query('INSERT INTO object_types VALUES (?, ?, ?, ?)').run(type.id, name, JSON.stringify(ids), type.id === PAGE_TYPE_ID ? 7 : type.id === TASK_TYPE_ID ? 5 : 1);
  }
  db.query('INSERT INTO object_types VALUES (?, ?, ?, 1)').run(customType, 'Custom 🧪', JSON.stringify([selectProperty]));
  db.query('INSERT INTO object_properties VALUES (?, ?, ?, NULL, NULL, 0, 2)').run(textProperty, 'Notes', 'text');
  db.query('INSERT INTO object_properties VALUES (?, ?, ?, ?, NULL, 0, 1)').run(selectProperty, 'Choice', 'select', JSON.stringify([{ id: 'option-a', label: 'A' }]));
  const live = { id: page, typeId: PAGE_TYPE_ID, title: 'Unicode 🚀', properties: { [textProperty]: 'snowman ☃' }, body: 'Exact **Markdown**\n\nEmoji 🚀', revision: 2, createdAt: timestamp, updatedAt: timestamp, trashed: false };
  db.query('INSERT INTO objects VALUES (?, ?, ?, ?, ?, 2, ?, ?, 0, ?)').run(page, PAGE_TYPE_ID, live.title, JSON.stringify(live.properties), live.body, timestamp, timestamp, 'Exact Markdown Emoji');
  db.query('INSERT INTO objects VALUES (?, ?, ?, ?, ?, 1, ?, ?, 0, ?)').run(task, TASK_TYPE_ID, 'Task row', JSON.stringify({ [TASK_DONE_PROPERTY_ID]: false }), '', timestamp, timestamp, 'Task row');
  db.query('INSERT INTO objects VALUES (?, ?, ?, ?, ?, 1, ?, ?, 1, ?)').run(trashed, customType, 'Trashed row', JSON.stringify({ [selectProperty]: 'option-a' }), 'Trash', timestamp, timestamp, 'Trash');
  db.query('INSERT INTO object_revisions VALUES (?, 1, ?, ?)').run(page, JSON.stringify({ ...live, title: 'Before', revision: 1 }), timestamp);
  db.query('INSERT INTO object_create_requests VALUES (?, ?, ?)').run('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'legacy-digest', page);
  db.query('INSERT INTO object_references VALUES (?, ?, ?)').run(page, task, '');
  db.query('INSERT INTO object_views VALUES (?, 2, ?, ?, ?, ?, ?, ?, ?, 0)').run(viewId, 'published', oldViewSpec(), 'prompt', 'model', oldSchemaSignature(), timestamp, timestamp);
  db.query('INSERT INTO object_views VALUES (?, 3, ?, ?, ?, ?, ?, ?, ?, 1)').run(deletedViewId, 'draft', oldViewSpec(), 'deleted prompt', 'model', oldSchemaSignature(), timestamp, timestamp);
  db.query('INSERT INTO object_view_revisions VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?, 0)').run(viewId, 'draft', oldViewSpec(), 'prompt', 'model', oldSchemaSignature(), timestamp, timestamp);
  db.query('INSERT INTO object_view_revisions VALUES (?, 2, ?, ?, ?, ?, ?, ?, ?, 0)').run(viewId, 'published', oldViewSpec(), 'prompt', 'model', oldSchemaSignature(), timestamp, timestamp);
  db.query('INSERT INTO object_view_conversations VALUES (?, ?, ?, ?)').run(conversationId, 'visitor', viewId, 'Legacy task board');
  db.query('INSERT INTO object_view_conversation_turns VALUES (?, 0, ?, ?, ?, NULL, ?)').run(conversationId, 'prompt', viewId, 'Legacy task board', 'model');
  db.query('INSERT INTO browser_visitors VALUES (?, ?)').run('visitor', 'csrf');
  db.query("INSERT INTO unrelated VALUES ('preserve')").run();
  const schema = db.query('SELECT type, name, tbl_name, sql FROM sqlite_schema ORDER BY type, name').all();
  const rows = captureRows(db);
  db.close();
  return { schema, rows };
}

function captureRows(db: ReturnType<typeof openDatabase>): Record<string, unknown[]> {
  const tables = ['object_metadata', 'object_types', 'object_properties', 'objects', 'object_references', 'object_revisions', 'object_create_requests', 'object_favorites', 'object_views', 'object_view_revisions', 'object_view_conversations', 'object_view_conversation_turns', 'browser_visitors', 'unrelated'];
  return Object.fromEntries(tables.filter(table => db.query<{ present: number }, [string]>("SELECT 1 AS present FROM sqlite_schema WHERE type = 'table' AND name = ?").get(table))
    .map(table => [table, db.query(`SELECT * FROM ${table} ORDER BY 1`).all()]));
}

function assertVersion4StructuralGuards(db: ReturnType<typeof openDatabase>): void {
  let next = 0;
  const id = (prefix: string): string => `${prefix}-${++next}`;
  const validSpec = oldViewSpec();
  const validSchema = oldSchemaSignature();
  db.query('INSERT INTO object_views VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?, 0)').run(id('valid-view'), 'draft', validSpec, 'prompt', 'model', validSchema, timestamp, timestamp);
  db.query('INSERT INTO object_view_revisions VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?, 0)').run(id('valid-history'), 'draft', validSpec, 'prompt', 'model', validSchema, timestamp, timestamp);

  const badRevisions: Array<string | number | Uint8Array | null> = [0, -1, 1.5, 'oops', new Uint8Array([1]), null];
  for (const revision of badRevisions) {
    assert.throws(() => db.query('INSERT INTO object_views VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)').run(id('bad-view'), revision, 'draft', validSpec, 'prompt', 'model', validSchema, timestamp, timestamp));
    assert.throws(() => db.query('UPDATE object_views SET revision = ? WHERE id = ?').run(revision, 'valid-view-1'));
    assert.throws(() => db.query('INSERT INTO object_view_revisions VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)').run(id('bad-history'), revision, 'draft', validSpec, 'prompt', 'model', validSchema, timestamp, timestamp));
  }
  db.query('INSERT INTO object_views VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)').run(id('string-integer-view'), '2', 'draft', validSpec, 'prompt', 'model', validSchema, timestamp, timestamp);
  db.query('INSERT INTO object_view_revisions VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)').run(id('string-integer-history'), '2', 'draft', validSpec, 'prompt', 'model', validSchema, timestamp, timestamp);

  const typeJsonCases = ['{}', 'null', '"id"', 'not json'];
  for (const value of typeJsonCases) {
    assert.throws(() => db.query('INSERT INTO object_types VALUES (?, ?, ?, 1)').run(crypto.randomUUID(), 'Bad', value), /object_types_property_ids_array|json_valid/);
  }
  const propertyJsonCases = ['[]', 'null', '"text"', 'not json'];
  for (const value of propertyJsonCases) {
    assert.throws(() => db.query('INSERT INTO objects VALUES (?, ?, ?, ?, ?, 1, ?, ?, 0, ?)').run(crypto.randomUUID(), PAGE_TYPE_ID, 'Bad', value, '', timestamp, timestamp, ''), /objects_properties_object|json_valid/);
    assert.throws(() => db.query('INSERT INTO object_revisions VALUES (?, 1, ?, ?)').run(page, value, timestamp), /object_revisions_snapshot_object|malformed JSON|json_valid/);
    assert.throws(() => db.query('INSERT INTO object_views VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?, 0)').run(id('bad-spec'), 'draft', value, 'prompt', 'model', validSchema, timestamp, timestamp), /object_views_spec_object|malformed JSON|json_valid/);
    assert.throws(() => db.query('INSERT INTO object_view_revisions VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?, 0)').run(id('bad-history-spec'), 'draft', value, 'prompt', 'model', validSchema, timestamp, timestamp), /object_view_revisions_spec_object|malformed JSON|json_valid/);
  }
  const schemaJsonCases = ['{}', 'null', '"schema"', 'not json'];
  for (const value of schemaJsonCases) {
    assert.throws(() => db.query('INSERT INTO object_views VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?, 0)').run(id('bad-schema'), 'draft', validSpec, 'prompt', 'model', value, timestamp, timestamp), /object_views_schema_array|malformed JSON|json_valid/);
    assert.throws(() => db.query('INSERT INTO object_view_revisions VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?, 0)').run(id('bad-history-schema'), 'draft', validSpec, 'prompt', 'model', value, timestamp, timestamp), /object_view_revisions_schema_array|malformed JSON|json_valid/);
  }

  assert.throws(() => db.query('INSERT INTO object_properties VALUES (?, ?, ?, NULL, NULL, 0, 1)').run(crypto.randomUUID(), 'Bad', 'bogus'), /object_properties_kind_supported/);
  assert.throws(() => db.query('INSERT INTO object_properties VALUES (?, ?, ?, NULL, NULL, 0, 1)').run(crypto.randomUUID(), 'Bad', 'select'), /object_properties_select_options/);
  assert.throws(() => db.query('INSERT INTO object_properties VALUES (?, ?, ?, ?, NULL, 0, 1)').run(crypto.randomUUID(), 'Bad', 'text', '[]'), /object_properties_select_options/);
  assert.throws(() => db.query('INSERT INTO object_properties VALUES (?, ?, ?, NULL, NULL, 0, 1)').run(crypto.randomUUID(), 'Bad', 'reference'), /object_properties_reference_target/);
  assert.throws(() => db.query('INSERT INTO object_properties VALUES (?, ?, ?, NULL, ?, 0, 1)').run(crypto.randomUUID(), 'Bad', 'text', PAGE_TYPE_ID), /object_properties_reference_target/);
  assert.throws(() => db.query('INSERT INTO object_properties VALUES (?, ?, ?, NULL, NULL, 1, 1)').run(crypto.randomUUID(), 'Bad', 'text'), /object_properties_reference_multiple/);
  assert.throws(() => db.query('INSERT INTO object_views VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?, 0)').run(id('bad-status'), 'deleted', validSpec, 'prompt', 'model', validSchema, timestamp, timestamp), /CHECK constraint failed/);
  assert.throws(() => db.query('INSERT INTO object_views VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?, 2)').run(id('bad-deleted'), 'draft', validSpec, 'prompt', 'model', validSchema, timestamp, timestamp), /CHECK constraint failed/);
  assert.throws(() => db.query('INSERT INTO object_view_revisions VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?, 0)').run(id('bad-history-status'), 'deleted', validSpec, 'prompt', 'model', validSchema, timestamp, timestamp), /object_view_revisions_status_closed/);
  assert.throws(() => db.query('INSERT INTO object_view_revisions VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?, 2)').run(id('bad-history-deleted'), 'draft', validSpec, 'prompt', 'model', validSchema, timestamp, timestamp), /object_view_revisions_deleted_closed/);
}

test('version-3 application schema upgrades to version 5 without changing object data', t => {
  const file = temporaryWorkspace(t);
  const before = installV3Fixture(file);
  let db = openDatabase(file);
  const runtime = new ObjectRuntime(db);
  assert.equal(db.query<{ value: string }, []>("SELECT value FROM object_metadata WHERE key = 'schema_version'").get()!.value, '5');
  assert.equal(runtime.getObject(page).body, 'Exact **Markdown**\n\nEmoji 🚀');
  assert.deepEqual(runtime.getObject(page), {
    id: page,
    typeId: PAGE_TYPE_ID,
    title: 'Unicode 🚀',
    properties: { [textProperty]: 'snowman ☃' },
    body: 'Exact **Markdown**\n\nEmoji 🚀',
    revision: 2,
    createdAt: timestamp,
    updatedAt: timestamp,
    trashed: false,
  });
  assert.deepEqual(runtime.getType(TASK_TYPE_ID).propertyIds, [TASK_DONE_PROPERTY_ID, TASK_DUE_PROPERTY_ID, textProperty, TASK_SCHEDULED_PROPERTY_ID]);
  assert.equal(runtime.getType(TASK_TYPE_ID).revision, 6);
  const expectedRows = structuredClone(before.rows) as Record<string, any[]>;
  expectedRows.object_metadata = [{ key: 'schema_version', value: '5' }];
  expectedRows.object_favorites = [];
  expectedRows.object_properties = [...expectedRows.object_properties!, { id: TASK_SCHEDULED_PROPERTY_ID, label: 'Scheduled date', kind: 'date', options_json: null, target_type_id: null, multiple: 0, revision: 1 }]
    .sort((left, right) => String(left.id).localeCompare(String(right.id)));
  expectedRows.object_types = expectedRows.object_types!.map(row => row.id === TASK_TYPE_ID
    ? { ...row, property_ids_json: JSON.stringify([TASK_DONE_PROPERTY_ID, TASK_DUE_PROPERTY_ID, textProperty, TASK_SCHEDULED_PROPERTY_ID]), revision: 6 }
    : row);
  assert.deepEqual(captureRows(db), expectedRows);
  assert.deepEqual(db.query<Record<string, string>, []>('PRAGMA integrity_check').all(), [{ integrity_check: 'ok' }]);
  assert.deepEqual(db.query('PRAGMA foreign_key_check').all(), []);
  assertVersion4StructuralGuards(db);
  const upgradedPage = runtime.getObject(page);
  db.close();

  db = openDatabase(file);
  const reopened = new ObjectRuntime(db);
  assert.deepEqual(reopened.getObject(page), upgradedPage);
  db.close();
});

test('explicit unsupported schema versions are rejected without changing existing data', t => {
  for (const version of ['', ' ', '6']) {
    const file = temporaryWorkspace(t);
    let db = openDatabase(file);
    db.exec('CREATE TABLE object_metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT; CREATE TABLE sentinel (value TEXT) STRICT;');
    db.query("INSERT INTO object_metadata VALUES ('schema_version', ?)").run(version);
    db.query("INSERT INTO sentinel VALUES ('preserve')").run();
    const schema = db.query('SELECT type, name, tbl_name, sql FROM sqlite_schema ORDER BY type, name').all();
    const rows = captureRows(db);
    const sentinel = db.query('SELECT * FROM sentinel').all();
    db.close();

    db = openDatabase(file);
    try {
      assert.throws(() => new ObjectRuntime(db), /Unsupported object database schema/);
    } finally {
      db.close();
    }
    db = openDatabase(file);
    assert.deepEqual(db.query('SELECT type, name, tbl_name, sql FROM sqlite_schema ORDER BY type, name').all(), schema);
    assert.deepEqual(captureRows(db), rows);
    assert.deepEqual(db.query('SELECT * FROM sentinel').all(), sentinel);
    assert.equal(db.query<{ value: string }, []>("SELECT value FROM object_metadata WHERE key = 'schema_version'").get()!.value, version);
    db.close();
  }
});

test('version-3 workspaces without optional service tables gain them during upgrade', t => {
  const file = temporaryWorkspace(t);
  const db = openDatabase(file);
  db.exec(`
    CREATE TABLE object_metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT;
    INSERT INTO object_metadata VALUES ('schema_version', '3');
    CREATE TABLE object_types (id TEXT PRIMARY KEY, name TEXT NOT NULL, property_ids_json TEXT NOT NULL CHECK(json_valid(property_ids_json)), revision INTEGER NOT NULL CHECK(revision > 0)) STRICT;
    CREATE TABLE object_properties (id TEXT PRIMARY KEY, label TEXT NOT NULL, kind TEXT NOT NULL, options_json TEXT CHECK(options_json IS NULL OR json_valid(options_json)), target_type_id TEXT REFERENCES object_types(id), multiple INTEGER NOT NULL DEFAULT 0 CHECK(multiple IN (0,1)), revision INTEGER NOT NULL CHECK(revision > 0)) STRICT;
    CREATE TABLE objects (id TEXT PRIMARY KEY COLLATE NOCASE, type_id TEXT NOT NULL REFERENCES object_types(id), title TEXT NOT NULL, properties_json TEXT NOT NULL CHECK(json_valid(properties_json)), body TEXT NOT NULL DEFAULT '', revision INTEGER NOT NULL CHECK(revision > 0), created_at TEXT NOT NULL, updated_at TEXT NOT NULL, trashed INTEGER NOT NULL CHECK(trashed IN (0,1)), body_text TEXT NOT NULL) STRICT;
    CREATE TABLE object_references (source_id TEXT NOT NULL COLLATE NOCASE REFERENCES objects(id), target_id TEXT NOT NULL COLLATE NOCASE REFERENCES objects(id), property_id TEXT NOT NULL DEFAULT '', PRIMARY KEY(source_id,target_id,property_id)) STRICT;
    CREATE TABLE object_revisions (object_id TEXT NOT NULL COLLATE NOCASE REFERENCES objects(id), revision INTEGER NOT NULL, snapshot_json TEXT NOT NULL CHECK(json_valid(snapshot_json)), recorded_at TEXT NOT NULL, PRIMARY KEY(object_id,revision)) STRICT;
    CREATE TABLE object_create_requests (request_id TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, object_id TEXT NOT NULL COLLATE NOCASE REFERENCES objects(id)) STRICT;
  `);
  db.close();
  const runtime = new ObjectRuntime(openDatabase(file));
  t.after(() => runtime.db.close());
  for (const table of ['object_views', 'object_view_revisions', 'object_view_conversations', 'object_view_conversation_turns', 'browser_visitors']) {
    assert.ok(runtime.db.query("SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = ?").get(table));
  }
});

test('version-4 structural checks reject invalid direct SQL on every connection', t => {
  const file = temporaryWorkspace(t);
  const first = new ObjectRuntime(openDatabase(file));
  const second = openDatabase(file);
  t.after(() => { first.db.close(); second.close(); });
  assertVersion4StructuralGuards(second);

  const type = first.createType('Boundary');
  const withReference = first.addProperty(type.id, type.revision, { label: 'Related', kind: 'reference', targetTypeId: PAGE_TYPE_ID, multiple: true });
  assert.equal(first.getProperty(withReference.propertyIds[0]!).multiple, true);
  const views = new ViewService(first);
  assert.equal(views.list().length, 2);
});

test('invalid existing structural data rolls back the version-4 upgrade completely', t => {
  const cases: { name: string; mutate: (db: ReturnType<typeof openDatabase>) => void; message: RegExp }[] = [
    { name: 'type properties must be an array', mutate: db => db.query('UPDATE object_types SET property_ids_json = ? WHERE id = ?').run('{}', customType), message: /object_types_property_ids_array/ },
    { name: 'property kind must be supported', mutate: db => db.query('UPDATE object_properties SET kind = ? WHERE id = ?').run('bogus', textProperty), message: /object_properties_kind_supported/ },
    { name: 'select properties require array options', mutate: db => db.query('UPDATE object_properties SET options_json = NULL WHERE id = ?').run(selectProperty), message: /object_properties_select_options/ },
    { name: 'reference properties require a target', mutate: db => db.query('INSERT INTO object_properties VALUES (?, ?, ?, NULL, NULL, 0, 1)').run(crypto.randomUUID(), 'Broken reference', 'reference'), message: /object_properties_reference_target/ },
    { name: 'non-reference properties cannot be multiple', mutate: db => db.query('UPDATE object_properties SET multiple = 1 WHERE id = ?').run(textProperty), message: /object_properties_reference_multiple/ },
    { name: 'object properties must be an object', mutate: db => db.query('UPDATE objects SET properties_json = ? WHERE id = ?').run('[]', page), message: /objects_properties_object/ },
    { name: 'history snapshots must be objects', mutate: db => db.query('UPDATE object_revisions SET snapshot_json = ? WHERE object_id = ?').run('[]', page), message: /object_revisions_snapshot_object/ },
    { name: 'view revisions must be stored as integers', mutate: db => db.query('UPDATE object_views SET revision = ? WHERE id = ?').run('oops', viewId), message: /object_views_revision_positive/ },
    { name: 'view specs must be valid JSON objects', mutate: db => db.query('UPDATE object_views SET spec_json = ? WHERE id = ?').run('not json', viewId), message: /object_views_spec_object/ },
    { name: 'view schemas must be arrays', mutate: db => db.query('UPDATE object_views SET schema_json = ? WHERE id = ?').run('{}', viewId), message: /object_views_schema_array/ },
    { name: 'history statuses are closed', mutate: db => db.query('INSERT INTO object_view_revisions VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?, 0)').run('invalid-history-status', 'deleted', oldViewSpec(), 'prompt', 'model', oldSchemaSignature(), timestamp, timestamp), message: /object_view_revisions_status_closed/ },
    { name: 'history specs must be objects', mutate: db => db.query('INSERT INTO object_view_revisions VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?, 0)').run('invalid-history-spec', 'draft', '[]', 'prompt', 'model', oldSchemaSignature(), timestamp, timestamp), message: /object_view_revisions_spec_object/ },
    { name: 'history schemas must be arrays', mutate: db => db.query('INSERT INTO object_view_revisions VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?, 0)').run('invalid-history-schema', 'draft', oldViewSpec(), 'prompt', 'model', '{}', timestamp, timestamp), message: /object_view_revisions_schema_array/ },
    { name: 'history deleted is closed', mutate: db => db.query('INSERT INTO object_view_revisions VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?, 2)').run('invalid-history-deleted', 'draft', oldViewSpec(), 'prompt', 'model', oldSchemaSignature(), timestamp, timestamp), message: /object_view_revisions_deleted_closed/ },
    { name: 'history revisions must be stored as integers', mutate: db => db.query('INSERT INTO object_view_revisions VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)').run('invalid-history-revision', new Uint8Array([1]), 'draft', oldViewSpec(), 'prompt', 'model', oldSchemaSignature(), timestamp, timestamp), message: /object_view_revisions_revision_positive/ },
  ];
  for (const value of cases) {
    const file = temporaryWorkspace(t);
    const before = installV3Fixture(file);
    let db = openDatabase(file);
    value.mutate(db);
    const rows = captureRows(db);
    db.close();

    db = openDatabase(file);
    try {
      assert.throws(() => new ObjectRuntime(db), value.message, value.name);
    } finally {
      db.close();
    }
    db = openDatabase(file);
    assert.deepEqual(db.query('SELECT type, name, tbl_name, sql FROM sqlite_schema ORDER BY type, name').all(), before.schema, value.name);
    assert.deepEqual(captureRows(db), rows, value.name);
    assert.equal(db.query<{ value: string }, []>("SELECT value FROM object_metadata WHERE key = 'schema_version'").get()!.value, '3', value.name);
    db.close();
  }
});
