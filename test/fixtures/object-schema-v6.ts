import type { Database } from 'bun:sqlite';
import { fingerprint } from '../../src/objects/fingerprint.js';
import {
  BUILTIN_PROPERTIES, BUILTIN_TYPES,
  EVENT_DATES_PROPERTY_ID, EVENT_TIME_PROPERTY_ID, EVENT_TYPE_ID,
  JOURNAL_DATE_PROPERTY_ID, JOURNAL_TYPE_ID,
  PAGE_TYPE_ID,
  PERSON_BIRTHDAY_PROPERTY_ID, PERSON_FAVORITE_ARTISTS_PROPERTY_ID, PERSON_JOB_TITLE_PROPERTY_ID,
  PERSON_LAST_CONNECTED_PROPERTY_ID, PERSON_PHONE_PROPERTY_ID, PERSON_RECONNECT_EVERY_PROPERTY_ID, PERSON_RELATIONSHIP_PROPERTY_ID, PERSON_TYPE_ID,
  REMINDER_DATE_PROPERTY_ID, REMINDER_TIME_PROPERTY_ID, REMINDER_TYPE_ID,
  TASK_DONE_PROPERTY_ID, TASK_DUE_PROPERTY_ID, TASK_SCHEDULED_PROPERTY_ID, TASK_TYPE_ID,
  type ObjectWrite,
} from '../../src/objects/model.js';
import { markdownText } from '../../src/objects/markdown.js';

export const ids = {
  page: '10000000-0000-4000-8000-000000000001',
  task: '10000000-0000-4000-8000-000000000002',
  journal: '10000000-0000-4000-8000-000000000003',
  person: '10000000-0000-4000-8000-000000000004',
  eventAllDay: '10000000-0000-4000-8000-000000000005',
  eventTimed: '10000000-0000-4000-8000-000000000006',
  reminderDate: '10000000-0000-4000-8000-000000000007',
  reminderTime: '10000000-0000-4000-8000-000000000008',
  trash: '10000000-0000-4000-8000-000000000009',
  changedKind: '10000000-0000-4000-8000-000000000010',
  view: '20000000-0000-4000-8000-000000000001',
  draftView: '20000000-0000-4000-8000-000000000002',
  deletedView: '20000000-0000-4000-8000-000000000003',
  conversation: '30000000-0000-4000-8000-000000000001',
  visitor: '40000000-0000-4000-8000-000000000001',
};

const now = '2026-09-28T12:00:00.000Z';

function q(id: string): string { return JSON.stringify(id); }
function j(value: unknown): string { return JSON.stringify(value); }

function installV6Schema(db: Database, version = '6'): void {
  db.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE object_metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT;
    INSERT INTO object_metadata(key, value) VALUES ('schema_version', '${version}');
    CREATE TABLE object_types (id TEXT PRIMARY KEY, name TEXT NOT NULL, property_ids_json TEXT NOT NULL CHECK(json_valid(property_ids_json)), revision INTEGER NOT NULL CHECK(revision > 0)) STRICT;
    CREATE TABLE object_properties (id TEXT PRIMARY KEY, label TEXT NOT NULL, kind TEXT NOT NULL, options_json TEXT CHECK(options_json IS NULL OR json_valid(options_json)), target_type_id TEXT REFERENCES object_types(id), multiple INTEGER NOT NULL DEFAULT 0 CHECK(multiple IN (0, 1)), revision INTEGER NOT NULL CHECK(revision > 0)) STRICT;
    CREATE TABLE objects (id TEXT PRIMARY KEY COLLATE NOCASE, type_id TEXT NOT NULL REFERENCES object_types(id), title TEXT NOT NULL, properties_json TEXT NOT NULL CHECK(json_valid(properties_json)), body TEXT NOT NULL DEFAULT '', revision INTEGER NOT NULL CHECK(revision > 0), created_at TEXT NOT NULL, updated_at TEXT NOT NULL, trashed INTEGER NOT NULL CHECK(trashed IN (0, 1)), body_text TEXT NOT NULL) STRICT;
    CREATE INDEX objects_browse ON objects(trashed, updated_at DESC, id);
    CREATE INDEX objects_type_browse ON objects(type_id, trashed, updated_at DESC, id);
    CREATE TABLE object_references (source_id TEXT NOT NULL COLLATE NOCASE REFERENCES objects(id), target_id TEXT NOT NULL COLLATE NOCASE REFERENCES objects(id), property_id TEXT NOT NULL DEFAULT '', PRIMARY KEY(source_id, target_id, property_id)) STRICT;
    CREATE INDEX object_references_target ON object_references(target_id);
    CREATE TABLE object_revisions (object_id TEXT NOT NULL COLLATE NOCASE REFERENCES objects(id), revision INTEGER NOT NULL CHECK(revision > 0), snapshot_json TEXT NOT NULL CHECK(json_valid(snapshot_json)), recorded_at TEXT NOT NULL, PRIMARY KEY(object_id, revision)) STRICT;
    CREATE TABLE object_create_requests (request_id TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, object_id TEXT NOT NULL COLLATE NOCASE REFERENCES objects(id)) STRICT;
    CREATE TABLE object_favorites (object_id TEXT PRIMARY KEY COLLATE NOCASE REFERENCES objects(id) ON DELETE CASCADE, created_at TEXT NOT NULL) STRICT;
    CREATE TABLE object_views (id TEXT PRIMARY KEY, revision INTEGER NOT NULL CHECK(revision > 0), status TEXT NOT NULL CHECK(status IN ('draft','published')), spec_json TEXT NOT NULL CHECK(json_valid(spec_json)), prompt TEXT NOT NULL, model TEXT NOT NULL, schema_json TEXT NOT NULL CHECK(json_valid(schema_json)), created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted INTEGER NOT NULL DEFAULT 0 CHECK(deleted IN (0,1)));
    CREATE TABLE object_view_revisions (id TEXT NOT NULL, revision INTEGER NOT NULL CHECK(revision > 0), status TEXT NOT NULL CHECK(status IN ('draft','published')), spec_json TEXT NOT NULL CHECK(json_valid(spec_json)), prompt TEXT NOT NULL, model TEXT NOT NULL, schema_json TEXT NOT NULL CHECK(json_valid(schema_json)), created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted INTEGER NOT NULL CHECK(deleted IN (0,1)), PRIMARY KEY(id,revision));
    CREATE TRIGGER object_view_history_no_update BEFORE UPDATE ON object_view_revisions BEGIN SELECT RAISE(ABORT, 'View revision history is immutable'); END;
    CREATE TRIGGER object_view_history_no_delete BEFORE DELETE ON object_view_revisions BEGIN SELECT RAISE(ABORT, 'View revision history is immutable'); END;
    CREATE TABLE object_view_conversations (id TEXT PRIMARY KEY, visitor_id TEXT NOT NULL, previous_id TEXT REFERENCES object_views(id), context_title TEXT NOT NULL) STRICT;
    CREATE TABLE object_view_conversation_turns (conversation_id TEXT NOT NULL REFERENCES object_view_conversations(id), position INTEGER NOT NULL CHECK(position >= 0), prompt TEXT NOT NULL, view_id TEXT NOT NULL REFERENCES object_views(id), title TEXT NOT NULL, description TEXT, model TEXT NOT NULL, PRIMARY KEY(conversation_id, position)) STRICT;
    CREATE TABLE browser_visitors (id TEXT PRIMARY KEY, csrf TEXT NOT NULL) STRICT;
    CREATE TABLE unrelated_sentinel (id TEXT PRIMARY KEY, note TEXT NOT NULL) STRICT;
    INSERT INTO unrelated_sentinel(id, note) VALUES ('sentinel', 'must survive later migrations');
  `);
}

function installDefinitions(db: Database): void {
  for (const type of BUILTIN_TYPES) db.query('INSERT INTO object_types(id, name, property_ids_json, revision) VALUES (?, ?, ?, 1)').run(type.id, type.name, j(type.propertyIds));
  for (const property of BUILTIN_PROPERTIES) db.query('INSERT INTO object_properties(id, label, kind, options_json, target_type_id, multiple, revision) VALUES (?, ?, ?, NULL, NULL, 0, 1)').run(property.id, property.label, property.kind);
}

function insertObject(db: Database, id: string, typeId: string, title: string, properties: Record<string, unknown>, body: string, revision = 1, trashed = false): void {
  db.query('INSERT INTO objects(id, type_id, title, properties_json, body, revision, created_at, updated_at, trashed, body_text) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, typeId, title, j(properties), body, revision, now, now, trashed ? 1 : 0, markdownText(body));
}

function snapshot(id: string, typeId: string, title: string, properties: Record<string, unknown>, body: string, revision: number, trashed = false): Record<string, unknown> {
  return { id, typeId, title, properties, body, revision, createdAt: now, updatedAt: now, trashed };
}

function insertRevision(db: Database, objectId: string, revision: number, row: Record<string, unknown>): void {
  db.query('INSERT INTO object_revisions(object_id, revision, snapshot_json, recorded_at) VALUES (?, ?, ?, ?)').run(objectId, revision, j(row), now);
}

function insertView(db: Database, id: string, spec: Record<string, unknown>, status: 'draft' | 'published', deleted = false): void {
  const schema = [{ source: TASK_TYPE_ID, property: TASK_DONE_PROPERTY_ID, kind: 'boolean' }];
  db.query('INSERT INTO object_views(id, revision, status, spec_json, prompt, model, schema_json, created_at, updated_at, deleted) VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, status, j(spec), 'fixture prompt redacted by preflight', 'fixture/model', j(schema), now, now, deleted ? 1 : 0);
  db.query('INSERT INTO object_view_revisions(id, revision, status, spec_json, prompt, model, schema_json, created_at, updated_at, deleted) VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, status, j(spec), 'fixture prompt redacted by preflight', 'fixture/model', j(schema), now, now, deleted ? 1 : 0);
}

export function createCompatibleV6Fixture(db: Database): void {
  installV6Schema(db);
  installDefinitions(db);
  const unicodeBody = `Line one\r\nLine two with café and 🐉\r\n\r\nSee [task](/objects/${ids.task}).`;
  insertObject(db, ids.page, PAGE_TYPE_ID, 'Page fixture', {}, unicodeBody);
  insertObject(db, ids.task, TASK_TYPE_ID, 'Task fixture', { [TASK_DONE_PROPERTY_ID]: false, [TASK_DUE_PROPERTY_ID]: '2026-10-02', [TASK_SCHEDULED_PROPERTY_ID]: '2026-10-01' }, 'Task body', 2);
  insertObject(db, ids.journal, JOURNAL_TYPE_ID, 'Journal fixture', { [JOURNAL_DATE_PROPERTY_ID]: '2026-09-28' }, 'Journal body');
  insertObject(db, ids.person, PERSON_TYPE_ID, 'Person fixture', { [PERSON_RELATIONSHIP_PROPERTY_ID]: '', [PERSON_BIRTHDAY_PROPERTY_ID]: '1980-02-29', [PERSON_PHONE_PROPERTY_ID]: '+1 555 0100', [PERSON_JOB_TITLE_PROPERTY_ID]: 'Librarian', [PERSON_FAVORITE_ARTISTS_PROPERTY_ID]: 'Björk', [PERSON_RECONNECT_EVERY_PROPERTY_ID]: 3, [PERSON_LAST_CONNECTED_PROPERTY_ID]: '2026-08-31' }, 'Person body');
  insertObject(db, ids.eventAllDay, EVENT_TYPE_ID, 'All-day event fixture', { [EVENT_DATES_PROPERTY_ID]: { start: '2026-10-03', end: '2026-10-04' } }, 'Event body');
  insertObject(db, ids.eventTimed, EVENT_TYPE_ID, 'Timed event fixture', { [EVENT_TIME_PROPERTY_ID]: { start: '2026-10-03T10:00:00Z', end: '2026-10-03T11:00:00Z', timeZone: 'UTC' } }, 'Timed body');
  insertObject(db, ids.reminderDate, REMINDER_TYPE_ID, 'Date reminder fixture', { [REMINDER_DATE_PROPERTY_ID]: '2026-10-05' }, 'Reminder body');
  insertObject(db, ids.reminderTime, REMINDER_TYPE_ID, 'Time reminder fixture', { [REMINDER_TIME_PROPERTY_ID]: '2026-10-05T09:30:00+02:00' }, 'Reminder time body');
  insertObject(db, ids.trash, TASK_TYPE_ID, 'Trashed fixture', { [TASK_DONE_PROPERTY_ID]: true }, 'Trashed body', 1, true);
  insertObject(db, ids.changedKind, PAGE_TYPE_ID, 'Changed kind fixture', {}, 'Current page body', 2);
  insertRevision(db, ids.task, 1, snapshot(ids.task, TASK_TYPE_ID, 'Task before edit', { [TASK_DONE_PROPERTY_ID]: false, [TASK_DUE_PROPERTY_ID]: '2026-10-02' }, 'Old task body', 1));
  insertRevision(db, ids.changedKind, 1, snapshot(ids.changedKind, TASK_TYPE_ID, 'Former task', { [TASK_DONE_PROPERTY_ID]: true }, 'Historical different known kind', 1));
  db.query('INSERT INTO object_references(source_id, target_id, property_id) VALUES (?, ?, ?)').run(ids.page, ids.task, '');
  db.query('INSERT INTO object_references(source_id, target_id, property_id) VALUES (?, ?, ?)').run(ids.page.toUpperCase(), ids.page, '');
  db.query('INSERT INTO object_favorites(object_id, created_at) VALUES (?, ?)').run(ids.page, now);
  const createInput: ObjectWrite = { typeId: TASK_TYPE_ID, title: 'Task fixture', properties: { [TASK_DUE_PROPERTY_ID]: '2026-10-02', [TASK_SCHEDULED_PROPERTY_ID]: '2026-10-01' }, body: 'Task body' };
  db.query('INSERT INTO object_create_requests(request_id, fingerprint, object_id) VALUES (?, ?, ?)').run('50000000-0000-4000-8000-000000000001', fingerprint(createInput), ids.task);
  const view = { title: 'Task board', blocks: [{ title: 'By done', component: 'board', editable: true, sources: [{ typeId: TASK_TYPE_ID, bindings: { group: TASK_DONE_PROPERTY_ID }, where: [{ propertyId: TASK_DONE_PROPERTY_ID, operator: 'notEmpty' }] }] }] };
  const calendar = { title: 'Calendar', blocks: [{ title: 'Due', component: 'calendar', editable: true, sources: [{ typeId: TASK_TYPE_ID, bindings: { date: TASK_DUE_PROPERTY_ID } }, { typeId: JOURNAL_TYPE_ID, bindings: { date: JOURNAL_DATE_PROPERTY_ID } }, { typeId: EVENT_TYPE_ID, bindings: { date: EVENT_DATES_PROPERTY_ID } }, { typeId: EVENT_TYPE_ID, bindings: { date: EVENT_TIME_PROPERTY_ID } }, { typeId: REMINDER_TYPE_ID, bindings: { date: REMINDER_DATE_PROPERTY_ID } }, { typeId: REMINDER_TYPE_ID, bindings: { date: REMINDER_TIME_PROPERTY_ID } }] }] };
  insertView(db, ids.view, view, 'published');
  insertView(db, ids.draftView, calendar, 'draft');
  insertView(db, ids.deletedView, { title: 'People', blocks: [{ title: 'People', component: 'table', columns: [{ role: 'relationship', label: 'Relationship' }], sources: [{ typeId: PERSON_TYPE_ID, bindings: { relationship: PERSON_RELATIONSHIP_PROPERTY_ID } }] }] }, 'published', true);
  db.query('INSERT INTO browser_visitors(id, csrf) VALUES (?, ?)').run(ids.visitor, 'csrf-secret-not-reported');
  db.query('INSERT INTO object_view_conversations(id, visitor_id, previous_id, context_title) VALUES (?, ?, ?, ?)').run(ids.conversation, ids.visitor, ids.view, 'Fixture conversation');
  db.query('INSERT INTO object_view_conversation_turns(conversation_id, position, prompt, view_id, title, description, model) VALUES (?, 0, ?, ?, ?, ?, ?)').run(ids.conversation, 'conversation prompt not reported', ids.view, 'Task board', null, 'fixture/model');
}

export function createCustomDefinitionFixture(db: Database): void {
  createCompatibleV6Fixture(db);
  db.query('INSERT INTO object_types(id, name, property_ids_json, revision) VALUES (?, ?, ?, 1)').run('60000000-0000-4000-8000-000000000001', 'Custom', '[]');
}

export function createRenamedDefinitionFixture(db: Database): void {
  createCompatibleV6Fixture(db);
  db.query('UPDATE object_types SET name = ? WHERE id = ?').run('Renamed Page', PAGE_TYPE_ID);
}

export function createWrongKindFieldFixture(db: Database): void {
  createCompatibleV6Fixture(db);
  db.query('UPDATE objects SET properties_json = ? WHERE id = ?').run(j({ [JOURNAL_DATE_PROPERTY_ID]: '2026-12-01' }), ids.page);
}

export function createStructuredReferenceFixture(db: Database): void {
  createCompatibleV6Fixture(db);
  db.query('INSERT INTO object_references(source_id, target_id, property_id) VALUES (?, ?, ?)').run(ids.task, ids.page, '60000000-0000-4000-8000-000000000002');
}

export function createOldDemoSemanticsFixture(db: Database): void {
  createCompatibleV6Fixture(db);
  const context = '60000000-0000-4000-8000-000000000003';
  db.query('INSERT INTO object_properties(id, label, kind, options_json, target_type_id, multiple, revision) VALUES (?, ?, ?, NULL, ?, 0, 1)').run(context, 'Context', 'reference', PAGE_TYPE_ID);
  const task = JSON.parse(db.query<{ properties_json: string }, [string]>('SELECT properties_json FROM objects WHERE id = ?').get(ids.task)!.properties_json) as Record<string, unknown>;
  task[context] = ids.page;
  db.query('UPDATE objects SET properties_json = ? WHERE id = ?').run(j(task), ids.task);
  db.query('INSERT INTO object_references(source_id, target_id, property_id) VALUES (?, ?, ?)').run(ids.task, ids.page, context);
}

export function createCustomHistoryFixture(db: Database): void {
  createCompatibleV6Fixture(db);
  insertRevision(db, ids.page, 2, snapshot(ids.page, '60000000-0000-4000-8000-000000000004', 'Custom old row', { custom: 'value' }, 'Custom history', 2));
}

export function createInputViewFixture(db: Database): void {
  createCompatibleV6Fixture(db);
  const inputView = { title: 'Input view', input: { label: 'Project', typeId: PAGE_TYPE_ID }, blocks: [{ title: 'Scoped', component: 'list', sources: [{ typeId: TASK_TYPE_ID, bindings: { title: TASK_DONE_PROPERTY_ID }, where: [{ propertyId: TASK_DONE_PROPERTY_ID, operator: 'equals', value: { input: true } }] }] }] };
  db.query('UPDATE object_views SET spec_json = ? WHERE id = ?').run(j(inputView), ids.view);
}

export function createMalformedDataFixture(db: Database): void {
  createCompatibleV6Fixture(db);
  db.query('UPDATE objects SET properties_json = ? WHERE id = ?').run(j({ [JOURNAL_DATE_PROPERTY_ID]: '2026-02-30' }), ids.journal);
}

export function createUnknownVersionFixture(db: Database): void {
  installV6Schema(db, '99');
  installDefinitions(db);
}

export function createVersionFiveFixture(db: Database): void {
  installV6Schema(db, '5');
  installDefinitions(db);
}
