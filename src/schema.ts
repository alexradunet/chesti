import type { Database } from 'bun:sqlite';
import { fingerprint } from './objects/fingerprint.js';
import { BUILTIN_PROPERTIES, BUILTIN_TYPES, JOURNAL_DATE_PROPERTY_ID, JOURNAL_TYPE_ID, TASK_SCHEDULED_PROPERTY_ID, TASK_TYPE_ID } from './objects/model.js';
import { upgradeObjectMarkdown } from './objects/upgrade-markdown.js';

interface TypeRow { id: string; property_ids_json: string; revision: number }
interface PropertyRow { id: string; kind: string; options_json: string | null; target_type_id: string | null; multiple: number }

const ID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const JOURNAL_DATE_PATH = `$."${JOURNAL_DATE_PROPERTY_ID}"`;
const PROPERTY_KINDS = `'text','number','boolean','date','datetime','select','reference','date-range','time-range'`;
const POSITIVE_INTEGER_REVISION = `typeof(revision) = 'integer' AND revision > 0`;

function tableExists(db: Database, name: string): boolean {
  return Boolean(db.query<{ value: number }, [string]>("SELECT 1 AS value FROM sqlite_schema WHERE type = 'table' AND name = ?").get(name));
}

function structuralConstraints(): string {
  return `
    CONSTRAINT object_types_property_ids_array CHECK(json_valid(property_ids_json) AND json_type(property_ids_json) = 'array')`;
}

function installCoreTables(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS object_types (
      id TEXT PRIMARY KEY, name TEXT NOT NULL,
      property_ids_json TEXT NOT NULL CHECK(json_valid(property_ids_json)) ${structuralConstraints()},
      revision INTEGER NOT NULL CHECK(${POSITIVE_INTEGER_REVISION})
    ) STRICT;
    CREATE TABLE IF NOT EXISTS object_properties (
      id TEXT PRIMARY KEY, label TEXT NOT NULL,
      kind TEXT NOT NULL CONSTRAINT object_properties_kind_supported CHECK(kind IN (${PROPERTY_KINDS})),
      options_json TEXT CHECK(options_json IS NULL OR json_valid(options_json))
        CONSTRAINT object_properties_select_options CHECK((kind = 'select' AND options_json IS NOT NULL AND json_valid(options_json) AND json_type(options_json) = 'array') OR (kind != 'select' AND options_json IS NULL)),
      target_type_id TEXT REFERENCES object_types(id)
        CONSTRAINT object_properties_reference_target CHECK((kind = 'reference' AND target_type_id IS NOT NULL) OR (kind != 'reference' AND target_type_id IS NULL)),
      multiple INTEGER NOT NULL DEFAULT 0 CHECK(multiple IN (0, 1))
        CONSTRAINT object_properties_reference_multiple CHECK((kind = 'reference' AND multiple IN (0, 1)) OR (kind != 'reference' AND multiple = 0)),
      revision INTEGER NOT NULL CHECK(${POSITIVE_INTEGER_REVISION})
    ) STRICT;
    CREATE TABLE IF NOT EXISTS objects (
      id TEXT PRIMARY KEY COLLATE NOCASE, type_id TEXT NOT NULL REFERENCES object_types(id), title TEXT NOT NULL,
      properties_json TEXT NOT NULL CHECK(json_valid(properties_json))
        CONSTRAINT objects_properties_object CHECK(json_valid(properties_json) AND json_type(properties_json) = 'object'),
      body TEXT NOT NULL DEFAULT '', revision INTEGER NOT NULL CHECK(${POSITIVE_INTEGER_REVISION}),
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL, trashed INTEGER NOT NULL CHECK(trashed IN (0, 1)),
      body_text TEXT NOT NULL
    ) STRICT;
    CREATE INDEX IF NOT EXISTS objects_browse ON objects(trashed, updated_at DESC, id);
    CREATE INDEX IF NOT EXISTS objects_type_browse ON objects(type_id, trashed, updated_at DESC, id);
    CREATE TABLE IF NOT EXISTS object_references (
      source_id TEXT NOT NULL COLLATE NOCASE REFERENCES objects(id), target_id TEXT NOT NULL COLLATE NOCASE REFERENCES objects(id),
      property_id TEXT NOT NULL DEFAULT '', PRIMARY KEY(source_id, target_id, property_id)
    ) STRICT;
    CREATE INDEX IF NOT EXISTS object_references_target ON object_references(target_id);
    CREATE TABLE IF NOT EXISTS object_revisions (
      object_id TEXT NOT NULL COLLATE NOCASE REFERENCES objects(id),
      revision INTEGER NOT NULL CONSTRAINT object_revisions_revision_positive CHECK(${POSITIVE_INTEGER_REVISION}),
      snapshot_json TEXT NOT NULL CHECK(json_valid(snapshot_json))
        CONSTRAINT object_revisions_snapshot_object CHECK(json_valid(snapshot_json) AND json_type(snapshot_json) = 'object'),
      recorded_at TEXT NOT NULL, PRIMARY KEY(object_id, revision)
    ) STRICT;
    CREATE TABLE IF NOT EXISTS object_create_requests (
      request_id TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, object_id TEXT NOT NULL COLLATE NOCASE REFERENCES objects(id)
    ) STRICT;
    CREATE TABLE IF NOT EXISTS object_favorites (
      object_id TEXT PRIMARY KEY COLLATE NOCASE REFERENCES objects(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL
    ) STRICT;
  `);
}

function installViewTables(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS object_views (
      id TEXT PRIMARY KEY,
      revision INTEGER NOT NULL CONSTRAINT object_views_revision_positive CHECK(${POSITIVE_INTEGER_REVISION}),
      status TEXT NOT NULL CHECK(status IN ('draft','published')),
      spec_json TEXT NOT NULL CONSTRAINT object_views_spec_object CHECK(json_valid(spec_json) AND json_type(spec_json) = 'object'),
      prompt TEXT NOT NULL, model TEXT NOT NULL,
      schema_json TEXT NOT NULL CONSTRAINT object_views_schema_array CHECK(json_valid(schema_json) AND json_type(schema_json) = 'array'),
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      deleted INTEGER NOT NULL DEFAULT 0 CHECK(deleted IN (0,1))
    );
    CREATE TABLE IF NOT EXISTS object_view_revisions (
      id TEXT NOT NULL,
      revision INTEGER NOT NULL CONSTRAINT object_view_revisions_revision_positive CHECK(${POSITIVE_INTEGER_REVISION}),
      status TEXT NOT NULL CONSTRAINT object_view_revisions_status_closed CHECK(status IN ('draft','published')),
      spec_json TEXT NOT NULL CONSTRAINT object_view_revisions_spec_object CHECK(json_valid(spec_json) AND json_type(spec_json) = 'object'),
      prompt TEXT NOT NULL, model TEXT NOT NULL,
      schema_json TEXT NOT NULL CONSTRAINT object_view_revisions_schema_array CHECK(json_valid(schema_json) AND json_type(schema_json) = 'array'),
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      deleted INTEGER NOT NULL CONSTRAINT object_view_revisions_deleted_closed CHECK(deleted IN (0,1)),
      PRIMARY KEY(id,revision)
    );
    CREATE TRIGGER IF NOT EXISTS object_view_history_no_update BEFORE UPDATE ON object_view_revisions
      BEGIN SELECT RAISE(ABORT, 'View revision history is immutable'); END;
    CREATE TRIGGER IF NOT EXISTS object_view_history_no_delete BEFORE DELETE ON object_view_revisions
      BEGIN SELECT RAISE(ABORT, 'View revision history is immutable'); END;
  `);
}

function installConversationTables(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS object_view_conversations (
      id TEXT PRIMARY KEY, visitor_id TEXT NOT NULL, previous_id TEXT REFERENCES object_views(id), context_title TEXT NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS object_view_conversation_turns (
      conversation_id TEXT NOT NULL REFERENCES object_view_conversations(id), position INTEGER NOT NULL CHECK(position >= 0),
      prompt TEXT NOT NULL, view_id TEXT NOT NULL REFERENCES object_views(id), title TEXT NOT NULL, description TEXT, model TEXT NOT NULL,
      PRIMARY KEY(conversation_id, position)
    ) STRICT;
  `);
}

function installVisitorTables(db: Database): void {
  db.exec('CREATE TABLE IF NOT EXISTS browser_visitors (id TEXT PRIMARY KEY, csrf TEXT NOT NULL) STRICT');
}

function addConstraint(db: Database, table: string, definition: string): void {
  db.exec(`ALTER TABLE ${table} ADD ${definition}`);
}

function assertNoRows(db: Database, sql: string, rule: string): void {
  if (db.query(sql).get()) throw new Error(rule);
}

function validateExistingVersion4Data(db: Database, existing: Set<string>): void {
  if (existing.has('object_types')) assertNoRows(db, "SELECT 1 FROM object_types WHERE NOT (json_valid(property_ids_json) AND json_type(property_ids_json) = 'array') LIMIT 1", 'object_types_property_ids_array');
  if (existing.has('object_properties')) {
    assertNoRows(db, `SELECT 1 FROM object_properties WHERE kind NOT IN (${PROPERTY_KINDS}) LIMIT 1`, 'object_properties_kind_supported');
    assertNoRows(db, "SELECT 1 FROM object_properties WHERE NOT ((kind = 'select' AND options_json IS NOT NULL AND json_valid(options_json) AND json_type(options_json) = 'array') OR (kind != 'select' AND options_json IS NULL)) LIMIT 1", 'object_properties_select_options');
    assertNoRows(db, "SELECT 1 FROM object_properties WHERE NOT ((kind = 'reference' AND target_type_id IS NOT NULL) OR (kind != 'reference' AND target_type_id IS NULL)) LIMIT 1", 'object_properties_reference_target');
    assertNoRows(db, "SELECT 1 FROM object_properties WHERE NOT ((kind = 'reference' AND multiple IN (0, 1)) OR (kind != 'reference' AND multiple = 0)) LIMIT 1", 'object_properties_reference_multiple');
  }
  if (existing.has('objects')) assertNoRows(db, "SELECT 1 FROM objects WHERE NOT (json_valid(properties_json) AND json_type(properties_json) = 'object') LIMIT 1", 'objects_properties_object');
  if (existing.has('object_revisions')) {
    assertNoRows(db, `SELECT 1 FROM object_revisions WHERE NOT (${POSITIVE_INTEGER_REVISION}) LIMIT 1`, 'object_revisions_revision_positive');
    assertNoRows(db, "SELECT 1 FROM object_revisions WHERE NOT (json_valid(snapshot_json) AND json_type(snapshot_json) = 'object') LIMIT 1", 'object_revisions_snapshot_object');
  }
  if (existing.has('object_views')) {
    assertNoRows(db, `SELECT 1 FROM object_views WHERE NOT (${POSITIVE_INTEGER_REVISION}) LIMIT 1`, 'object_views_revision_positive');
    assertNoRows(db, "SELECT 1 FROM object_views WHERE NOT (json_valid(spec_json) AND json_type(spec_json) = 'object') LIMIT 1", 'object_views_spec_object');
    assertNoRows(db, "SELECT 1 FROM object_views WHERE NOT (json_valid(schema_json) AND json_type(schema_json) = 'array') LIMIT 1", 'object_views_schema_array');
  }
  if (existing.has('object_view_revisions')) {
    assertNoRows(db, `SELECT 1 FROM object_view_revisions WHERE NOT (${POSITIVE_INTEGER_REVISION}) LIMIT 1`, 'object_view_revisions_revision_positive');
    assertNoRows(db, "SELECT 1 FROM object_view_revisions WHERE status NOT IN ('draft','published') LIMIT 1", 'object_view_revisions_status_closed');
    assertNoRows(db, "SELECT 1 FROM object_view_revisions WHERE NOT (json_valid(spec_json) AND json_type(spec_json) = 'object') LIMIT 1", 'object_view_revisions_spec_object');
    assertNoRows(db, "SELECT 1 FROM object_view_revisions WHERE NOT (json_valid(schema_json) AND json_type(schema_json) = 'array') LIMIT 1", 'object_view_revisions_schema_array');
    assertNoRows(db, 'SELECT 1 FROM object_view_revisions WHERE deleted NOT IN (0, 1) LIMIT 1', 'object_view_revisions_deleted_closed');
  }
}

function addVersion4Constraints(db: Database, existing: Set<string>): void {
  validateExistingVersion4Data(db, existing);
  if (existing.has('object_types')) addConstraint(db, 'object_types', `CONSTRAINT object_types_property_ids_array CHECK(json_valid(property_ids_json) AND json_type(property_ids_json) = 'array')`);
  if (existing.has('object_properties')) {
    addConstraint(db, 'object_properties', `CONSTRAINT object_properties_kind_supported CHECK(kind IN (${PROPERTY_KINDS}))`);
    addConstraint(db, 'object_properties', `CONSTRAINT object_properties_select_options CHECK((kind = 'select' AND options_json IS NOT NULL AND json_valid(options_json) AND json_type(options_json) = 'array') OR (kind != 'select' AND options_json IS NULL))`);
    addConstraint(db, 'object_properties', `CONSTRAINT object_properties_reference_target CHECK((kind = 'reference' AND target_type_id IS NOT NULL) OR (kind != 'reference' AND target_type_id IS NULL))`);
    addConstraint(db, 'object_properties', `CONSTRAINT object_properties_reference_multiple CHECK((kind = 'reference' AND multiple IN (0, 1)) OR (kind != 'reference' AND multiple = 0))`);
  }
  if (existing.has('objects')) addConstraint(db, 'objects', `CONSTRAINT objects_properties_object CHECK(json_valid(properties_json) AND json_type(properties_json) = 'object')`);
  if (existing.has('object_revisions')) {
    addConstraint(db, 'object_revisions', `CONSTRAINT object_revisions_revision_positive CHECK(${POSITIVE_INTEGER_REVISION})`);
    addConstraint(db, 'object_revisions', `CONSTRAINT object_revisions_snapshot_object CHECK(json_valid(snapshot_json) AND json_type(snapshot_json) = 'object')`);
  }
  if (existing.has('object_views')) {
    addConstraint(db, 'object_views', `CONSTRAINT object_views_revision_positive CHECK(${POSITIVE_INTEGER_REVISION})`);
    addConstraint(db, 'object_views', `CONSTRAINT object_views_spec_object CHECK(json_valid(spec_json) AND json_type(spec_json) = 'object')`);
    addConstraint(db, 'object_views', `CONSTRAINT object_views_schema_array CHECK(json_valid(schema_json) AND json_type(schema_json) = 'array')`);
  }
  if (existing.has('object_view_revisions')) {
    addConstraint(db, 'object_view_revisions', `CONSTRAINT object_view_revisions_revision_positive CHECK(${POSITIVE_INTEGER_REVISION})`);
    addConstraint(db, 'object_view_revisions', `CONSTRAINT object_view_revisions_status_closed CHECK(status IN ('draft','published'))`);
    addConstraint(db, 'object_view_revisions', `CONSTRAINT object_view_revisions_spec_object CHECK(json_valid(spec_json) AND json_type(spec_json) = 'object')`);
    addConstraint(db, 'object_view_revisions', `CONSTRAINT object_view_revisions_schema_array CHECK(json_valid(schema_json) AND json_type(schema_json) = 'array')`);
    addConstraint(db, 'object_view_revisions', `CONSTRAINT object_view_revisions_deleted_closed CHECK(deleted IN (0,1))`);
  }
}

function attachTaskScheduledProperty(db: Database): void {
  const scheduled = BUILTIN_PROPERTIES.find(property => property.id === TASK_SCHEDULED_PROPERTY_ID)!;
  const existingProperty = db.query<PropertyRow, [string]>('SELECT * FROM object_properties WHERE id = ?').get(TASK_SCHEDULED_PROPERTY_ID);
  if (existingProperty) {
    if (existingProperty.kind !== scheduled.kind || existingProperty.options_json !== null || existingProperty.target_type_id !== null || existingProperty.multiple !== 0) {
      throw new Error(`Reserved built-in property ${TASK_SCHEDULED_PROPERTY_ID} has an incompatible structure.`);
    }
  } else {
    db.query('INSERT INTO object_properties(id, label, kind, options_json, target_type_id, multiple, revision) VALUES (?, ?, ?, NULL, NULL, 0, 1)')
      .run(scheduled.id, scheduled.label, scheduled.kind);
  }
  const task = db.query<TypeRow, [string]>('SELECT * FROM object_types WHERE id = ?').get(TASK_TYPE_ID);
  if (!task) return;
  const ids: unknown = JSON.parse(task.property_ids_json);
  if (!Array.isArray(ids) || ids.some(id => typeof id !== 'string' || !ID.test(id)) || new Set(ids).size !== ids.length) {
    throw new Error(`Reserved built-in type ${TASK_TYPE_ID} has an incompatible structure.`);
  }
  if (!ids.includes(TASK_SCHEDULED_PROPERTY_ID)) {
    db.query('UPDATE object_types SET property_ids_json = ?, revision = revision + 1 WHERE id = ?')
      .run(JSON.stringify([...ids, TASK_SCHEDULED_PROPERTY_ID]), TASK_TYPE_ID);
  }
}

function refreshTaskBuiltInTriggers(db: Database): void {
  for (const suffix of ['insert', 'update', 'delete']) db.exec(`DROP TRIGGER IF EXISTS object_builtin_type_1_${suffix}`);
  db.exec('DROP TRIGGER IF EXISTS object_builtin_property_7_insert; DROP TRIGGER IF EXISTS object_builtin_property_7_update; DROP TRIGGER IF EXISTS object_builtin_property_7_delete;');
}

function installBuiltins(db: Database, refreshTaskTriggers = false): void {
  for (const [index, type] of BUILTIN_TYPES.entries()) {
    const existing = db.query<TypeRow, [string]>('SELECT * FROM object_types WHERE id = ?').get(type.id);
    if (existing) {
      const ids: unknown = JSON.parse(existing.property_ids_json);
      if (!Array.isArray(ids) || ids.some(id => typeof id !== 'string' || !ID.test(id)) ||
          new Set(ids).size !== ids.length || type.propertyIds.some(id => !ids.includes(id))) {
        throw new Error(`Reserved built-in type ${type.id} has an incompatible structure.`);
      }
    } else {
      db.query('INSERT INTO object_types(id, name, property_ids_json, revision) VALUES (?, ?, ?, 1)')
        .run(type.id, type.name, JSON.stringify(type.propertyIds));
    }
    if (type.id === TASK_TYPE_ID && refreshTaskTriggers) refreshTaskBuiltInTriggers(db);
    const invalid = [
      "json_type(NEW.property_ids_json) IS NOT 'array'",
      ...type.propertyIds.map(id => `(SELECT COUNT(*) FROM json_each(NEW.property_ids_json) WHERE type = 'text' AND value = '${id}') != 1`),
    ].join(' OR ');
    db.exec(`
      CREATE TRIGGER IF NOT EXISTS object_builtin_type_${index}_insert BEFORE INSERT ON object_types
      WHEN NEW.id = '${type.id}' AND (${invalid})
      BEGIN SELECT RAISE(ABORT, 'Built-in type core fields are protected.'); END;
      CREATE TRIGGER IF NOT EXISTS object_builtin_type_${index}_update BEFORE UPDATE ON object_types
      WHEN (OLD.id = '${type.id}' OR NEW.id = '${type.id}') AND (OLD.id != NEW.id OR ${invalid})
      BEGIN SELECT RAISE(ABORT, 'Built-in type identity and core fields are protected.'); END;
      CREATE TRIGGER IF NOT EXISTS object_builtin_type_${index}_delete BEFORE DELETE ON object_types
      WHEN OLD.id = '${type.id}'
      BEGIN SELECT RAISE(ABORT, 'Built-in types cannot be deleted.'); END;
    `);
  }
  for (const [index, property] of BUILTIN_PROPERTIES.entries()) {
    const existing = db.query<PropertyRow, [string]>('SELECT * FROM object_properties WHERE id = ?').get(property.id);
    if (existing) {
      if (existing.kind !== property.kind || existing.options_json !== null || existing.target_type_id !== null || existing.multiple !== 0) {
        throw new Error(`Reserved built-in property ${property.id} has an incompatible structure.`);
      }
    } else {
      db.query('INSERT INTO object_properties(id, label, kind, options_json, target_type_id, multiple, revision) VALUES (?, ?, ?, NULL, NULL, 0, 1)')
        .run(property.id, property.label, property.kind);
    }
    const invalid = `NEW.kind != '${property.kind}' OR NEW.options_json IS NOT NULL OR NEW.target_type_id IS NOT NULL OR NEW.multiple != 0`;
    db.exec(`
      CREATE TRIGGER IF NOT EXISTS object_builtin_property_${index}_insert BEFORE INSERT ON object_properties
      WHEN NEW.id = '${property.id}' AND (${invalid})
      BEGIN SELECT RAISE(ABORT, 'Built-in property structure is protected.'); END;
      CREATE TRIGGER IF NOT EXISTS object_builtin_property_${index}_update BEFORE UPDATE ON object_properties
      WHEN (OLD.id = '${property.id}' OR NEW.id = '${property.id}') AND (OLD.id != NEW.id OR ${invalid})
      BEGIN SELECT RAISE(ABORT, 'Built-in property identity and structure are protected.'); END;
      CREATE TRIGGER IF NOT EXISTS object_builtin_property_${index}_delete BEFORE DELETE ON object_properties
      WHEN OLD.id = '${property.id}'
      BEGIN SELECT RAISE(ABORT, 'Built-in properties cannot be deleted.'); END;
    `);
  }
  const date = `json_extract(NEW.properties_json, '${JOURNAL_DATE_PATH}')`;
  const invalidDate = `json_type(NEW.properties_json) IS NOT 'object'
    OR (SELECT COUNT(*) FROM json_each(NEW.properties_json) WHERE key = '${JOURNAL_DATE_PROPERTY_ID}') != 1
    OR json_type(NEW.properties_json, '${JOURNAL_DATE_PATH}') IS NOT 'text'
    OR ${date} NOT GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
    OR substr(${date}, 1, 4) = '0000' OR date(${date}, '+0 days') IS NOT ${date}`;
  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS objects_journal_date
    ON objects(json_extract(properties_json, '${JOURNAL_DATE_PATH}')) WHERE type_id = '${JOURNAL_TYPE_ID}';
    CREATE TRIGGER IF NOT EXISTS objects_journal_date_insert BEFORE INSERT ON objects
    WHEN NEW.type_id = '${JOURNAL_TYPE_ID}' AND (${invalidDate})
    BEGIN SELECT RAISE(ABORT, 'Journal requires a real calendar date.'); END;
    CREATE TRIGGER IF NOT EXISTS objects_journal_date_update BEFORE UPDATE ON objects
    WHEN NEW.type_id = '${JOURNAL_TYPE_ID}' AND (${invalidDate})
    BEGIN SELECT RAISE(ABORT, 'Journal requires a real calendar date.'); END;
  `);
  const invalidJournal = db.query<{ invalid: number }, [string]>(`
    SELECT 1 AS invalid FROM objects AS NEW WHERE NEW.type_id = ? AND (${invalidDate}) LIMIT 1
  `).get(JOURNAL_TYPE_ID);
  if (invalidJournal) throw new Error('Existing Journal has an invalid or missing date.');
}

export function initializeApplicationSchema(db: Database): void {
  db.transaction(() => {
    db.exec('CREATE TABLE IF NOT EXISTS object_metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT');
    let version = db.query<{ value: string }, []>("SELECT value FROM object_metadata WHERE key = 'schema_version'").get()?.value;
    if (version !== undefined && !['1', '2', '3', '4', '5', '6'].includes(version)) throw new Error('Unsupported object database schema.');
    const existing = new Set(['object_types', 'object_properties', 'objects', 'object_revisions', 'object_views', 'object_view_revisions'].filter(name => tableExists(db, name)));
    if (version === '1') {
      upgradeObjectMarkdown(db, fingerprint);
      version = '2';
    }
    installCoreTables(db);
    if (version !== undefined && version !== '5' && version !== '6') attachTaskScheduledProperty(db);
    installBuiltins(db, version !== undefined && version !== '5' && version !== '6');
    installViewTables(db);
    installConversationTables(db);
    installVisitorTables(db);
    if (version !== '4' && version !== '5' && version !== '6') addVersion4Constraints(db, existing);
    db.query("INSERT INTO object_metadata(key, value) VALUES ('schema_version', '6') ON CONFLICT(key) DO UPDATE SET value = excluded.value").run();
  }).immediate();
}
