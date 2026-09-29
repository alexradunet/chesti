import type { Database } from 'bun:sqlite';
import { FIXED_TYPE_IDS, JOURNAL_DATE_PROPERTY_ID, JOURNAL_TYPE_ID } from './objects/model.js';

export const APPLICATION_SCHEMA_VERSION = '7';

const JOURNAL_DATE_PATH = `$."${JOURNAL_DATE_PROPERTY_ID}"`;
const POSITIVE_INTEGER_REVISION = `typeof(revision) = 'integer' AND revision > 0`;
const TYPE_CHECK = [...FIXED_TYPE_IDS].map(id => `'${id}'`).join(',');

function tableExists(db: Database, name: string): boolean {
  return Boolean(db.query<{ value: number }, [string]>("SELECT 1 AS value FROM sqlite_schema WHERE type = 'table' AND name = ?").get(name));
}

function applicationTables(db: Database): string[] {
  return db.query<{ name: string }, []>("SELECT name FROM sqlite_schema WHERE type='table' AND name GLOB 'object*' ORDER BY name").all().map(row => row.name);
}

function unsupported(message = 'Unsupported object database schema. Choose a new DATABASE_PATH for a fresh fixed-domain workspace.'): never {
  throw new Error(message);
}

export function rejectUnsupportedApplicationSchema(db: Database): void {
  const metadata = tableExists(db, 'object_metadata');
  const objectTables = applicationTables(db);
  if (!metadata && objectTables.length === 0) return;
  if (!metadata) unsupported();
  const version = db.query<{ value: string }, []>("SELECT value FROM object_metadata WHERE key = 'schema_version'").get()?.value;
  if (version !== APPLICATION_SCHEMA_VERSION) unsupported();
}

function installTables(db: Database): void {
  db.exec(`
    CREATE TABLE object_metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT;
    CREATE TABLE objects (
      id TEXT PRIMARY KEY COLLATE NOCASE,
      type_id TEXT NOT NULL CHECK(type_id IN (${TYPE_CHECK})),
      title TEXT NOT NULL,
      properties_json TEXT NOT NULL CHECK(json_valid(properties_json))
        CONSTRAINT objects_properties_object CHECK(json_type(properties_json) = 'object'),
      body TEXT NOT NULL DEFAULT '',
      revision INTEGER NOT NULL CHECK(${POSITIVE_INTEGER_REVISION}),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      trashed INTEGER NOT NULL CHECK(trashed IN (0, 1)),
      body_text TEXT NOT NULL
    ) STRICT;
    CREATE INDEX objects_browse ON objects(trashed, updated_at DESC, id);
    CREATE INDEX objects_type_browse ON objects(type_id, trashed, updated_at DESC, id);
    CREATE TABLE object_references (
      source_id TEXT NOT NULL COLLATE NOCASE REFERENCES objects(id),
      target_id TEXT NOT NULL COLLATE NOCASE REFERENCES objects(id),
      PRIMARY KEY(source_id, target_id)
    ) STRICT;
    CREATE INDEX object_references_target ON object_references(target_id);
    CREATE TABLE object_revisions (
      object_id TEXT NOT NULL COLLATE NOCASE REFERENCES objects(id),
      revision INTEGER NOT NULL CONSTRAINT object_revisions_revision_positive CHECK(${POSITIVE_INTEGER_REVISION}),
      snapshot_json TEXT NOT NULL CHECK(json_valid(snapshot_json))
        CONSTRAINT object_revisions_snapshot_object CHECK(json_type(snapshot_json) = 'object'),
      recorded_at TEXT NOT NULL,
      PRIMARY KEY(object_id, revision)
    ) STRICT;
    CREATE TABLE object_create_requests (
      request_id TEXT PRIMARY KEY,
      fingerprint TEXT NOT NULL,
      object_id TEXT NOT NULL COLLATE NOCASE REFERENCES objects(id)
    ) STRICT;
    CREATE TABLE object_favorites (
      object_id TEXT PRIMARY KEY COLLATE NOCASE REFERENCES objects(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL
    ) STRICT;
    CREATE TABLE object_views (
      id TEXT PRIMARY KEY,
      revision INTEGER NOT NULL CONSTRAINT object_views_revision_positive CHECK(${POSITIVE_INTEGER_REVISION}),
      status TEXT NOT NULL CHECK(status IN ('draft','published')),
      spec_json TEXT NOT NULL CONSTRAINT object_views_spec_object CHECK(json_valid(spec_json) AND json_type(spec_json) = 'object'),
      prompt TEXT NOT NULL,
      model TEXT NOT NULL,
      schema_json TEXT NOT NULL CONSTRAINT object_views_schema_array CHECK(json_valid(schema_json) AND json_type(schema_json) = 'array'),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted INTEGER NOT NULL DEFAULT 0 CHECK(deleted IN (0,1))
    ) STRICT;
    CREATE TABLE object_view_revisions (
      id TEXT NOT NULL,
      revision INTEGER NOT NULL CONSTRAINT object_view_revisions_revision_positive CHECK(${POSITIVE_INTEGER_REVISION}),
      status TEXT NOT NULL CONSTRAINT object_view_revisions_status_closed CHECK(status IN ('draft','published')),
      spec_json TEXT NOT NULL CONSTRAINT object_view_revisions_spec_object CHECK(json_valid(spec_json) AND json_type(spec_json) = 'object'),
      prompt TEXT NOT NULL,
      model TEXT NOT NULL,
      schema_json TEXT NOT NULL CONSTRAINT object_view_revisions_schema_array CHECK(json_valid(schema_json) AND json_type(schema_json) = 'array'),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted INTEGER NOT NULL CONSTRAINT object_view_revisions_deleted_closed CHECK(deleted IN (0,1)),
      PRIMARY KEY(id,revision)
    ) STRICT;
    CREATE TRIGGER object_view_history_no_update BEFORE UPDATE ON object_view_revisions
      BEGIN SELECT RAISE(ABORT, 'View revision history is immutable'); END;
    CREATE TRIGGER object_view_history_no_delete BEFORE DELETE ON object_view_revisions
      BEGIN SELECT RAISE(ABORT, 'View revision history is immutable'); END;
    CREATE TABLE object_view_conversations (
      id TEXT PRIMARY KEY,
      visitor_id TEXT NOT NULL,
      previous_id TEXT REFERENCES object_views(id),
      context_title TEXT NOT NULL
    ) STRICT;
    CREATE TABLE object_view_conversation_turns (
      conversation_id TEXT NOT NULL REFERENCES object_view_conversations(id),
      position INTEGER NOT NULL CHECK(position >= 0),
      prompt TEXT NOT NULL,
      view_id TEXT NOT NULL REFERENCES object_views(id),
      title TEXT NOT NULL,
      description TEXT,
      model TEXT NOT NULL,
      PRIMARY KEY(conversation_id, position)
    ) STRICT;
    CREATE TABLE browser_visitors (id TEXT PRIMARY KEY, csrf TEXT NOT NULL) STRICT;
  `);
  const date = `json_extract(NEW.properties_json, '${JOURNAL_DATE_PATH}')`;
  const invalidDate = `json_type(NEW.properties_json) IS NOT 'object'
    OR (SELECT COUNT(*) FROM json_each(NEW.properties_json) WHERE key = '${JOURNAL_DATE_PROPERTY_ID}') != 1
    OR json_type(NEW.properties_json, '${JOURNAL_DATE_PATH}') IS NOT 'text'
    OR ${date} NOT GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
    OR substr(${date}, 1, 4) = '0000' OR date(${date}, '+0 days') IS NOT ${date}`;
  db.exec(`
    CREATE UNIQUE INDEX objects_journal_date
    ON objects(json_extract(properties_json, '${JOURNAL_DATE_PATH}')) WHERE type_id = '${JOURNAL_TYPE_ID}';
    CREATE TRIGGER objects_journal_date_insert BEFORE INSERT ON objects
    WHEN NEW.type_id = '${JOURNAL_TYPE_ID}' AND (${invalidDate})
    BEGIN SELECT RAISE(ABORT, 'Daily Page requires a real calendar date.'); END;
    CREATE TRIGGER objects_journal_date_update BEFORE UPDATE ON objects
    WHEN NEW.type_id = '${JOURNAL_TYPE_ID}' AND (${invalidDate})
    BEGIN SELECT RAISE(ABORT, 'Daily Page requires a real calendar date.'); END;
  `);
}

export function initializeApplicationSchema(db: Database): void {
  db.transaction(() => {
    rejectUnsupportedApplicationSchema(db);
    if (!tableExists(db, 'object_metadata')) {
      installTables(db);
      db.query("INSERT INTO object_metadata(key, value) VALUES ('schema_version', ?)").run(APPLICATION_SCHEMA_VERSION);
      return;
    }
    for (const required of ['objects', 'object_references', 'object_revisions', 'object_views', 'browser_visitors']) {
      if (!tableExists(db, required)) unsupported('Current object database is incomplete. Choose a new DATABASE_PATH for a fresh fixed-domain workspace.');
    }
  }).immediate();
}
