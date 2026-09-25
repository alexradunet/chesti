import type { Database } from 'bun:sqlite';
import { AppError } from '../core.js';
import { validDate, valueError } from './values.js';
import { markdownReferences, markdownText, validateMarkdown } from './markdown.js';
import { upgradeObjectMarkdown } from './upgrade-markdown.js';
import { BUILTIN_PROPERTIES, BUILTIN_TYPES, EVENT_DATES_PROPERTY_ID, EVENT_TIME_PROPERTY_ID, EVENT_TYPE_ID, JOURNAL_DATE_PROPERTY_ID, JOURNAL_TYPE_ID, REMINDER_DATE_PROPERTY_ID, REMINDER_TIME_PROPERTY_ID, REMINDER_TYPE_ID, TASK_DONE_PROPERTY_ID, TASK_TYPE_ID } from './model.js';
import type { Backlink, Catalog, ObjectListOptions, ObjectRecord, ObjectType, ObjectWrite, PropertyDefinition, PropertyKind, PropertyValue } from './model.js';

const ID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const KINDS: Record<PropertyKind, true> = { text: true, number: true, boolean: true, date: true, datetime: true, select: true, reference: true, 'date-range': true, 'time-range': true };
interface TypeRow { id: string; name: string; property_ids_json: string; revision: number }
interface PropertyRow { id: string; label: string; kind: PropertyKind; options_json: string | null; target_type_id: string | null; multiple: number; revision: number }
interface ObjectRow { id: string; type_id: string; title: string; properties_json: string; body: string; revision: number; created_at: string; updated_at: string; trashed: number }

function objectRecord(row: ObjectRow): ObjectRecord {
  return { id: row.id, typeId: row.type_id, title: row.title, properties: JSON.parse(row.properties_json), body: row.body, revision: row.revision, createdAt: row.created_at, updatedAt: row.updated_at, trashed: row.trashed === 1 };
}
function objectType(row: TypeRow): ObjectType {
  return { id: row.id, name: row.name, propertyIds: JSON.parse(row.property_ids_json), revision: row.revision };
}
function propertyDefinition(row: PropertyRow): PropertyDefinition {
  return { id: row.id, label: row.label, kind: row.kind, revision: row.revision, ...(row.options_json === null ? {} : { options: JSON.parse(row.options_json) }), ...(row.target_type_id === null ? {} : { targetTypeId: row.target_type_id }), ...(row.kind === 'reference' ? { multiple: row.multiple === 1 } : {}) };
}
function label(value: unknown, name: string): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 200) throw new AppError(422, `${name} must contain 1–200 characters.`);
  return value.trim();
}
function revisionIs(current: number, supplied: number): void {
  if (!Number.isSafeInteger(supplied) || current !== supplied) throw new AppError(409, 'This item changed. Reload before saving.');
}
function plainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (plainObject(value)) return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
function fingerprint(input: ObjectWrite): string {
  return new Bun.CryptoHasher('sha256').update(canonical({ typeId: input.typeId, title: input.title, properties: input.properties, body: input.body })).digest('hex');
}

const JOURNAL_DATE_PATH = `$."${JOURNAL_DATE_PROPERTY_ID}"`;

function installBuiltins(db: Database): void {
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
  // The partial index deliberately includes Trash. These guards work on every
  // SQLite connection without depending on connection-local JavaScript functions.
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

export class ObjectRuntime {
  constructor(readonly db: Database) {
    db.transaction(() => {
      db.exec('CREATE TABLE IF NOT EXISTS object_metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT');
      const version = db.query<{ value: string }, []>("SELECT value FROM object_metadata WHERE key = 'schema_version'").get();
      if (version && !['1', '2', '3'].includes(version.value)) throw new Error('Unsupported object database schema.');
      if (version?.value === '1') upgradeObjectMarkdown(db, fingerprint);
      db.exec(`
        CREATE TABLE IF NOT EXISTS object_types (
          id TEXT PRIMARY KEY, name TEXT NOT NULL, property_ids_json TEXT NOT NULL CHECK(json_valid(property_ids_json)), revision INTEGER NOT NULL CHECK(revision > 0)
        ) STRICT;
        CREATE TABLE IF NOT EXISTS object_properties (
          id TEXT PRIMARY KEY, label TEXT NOT NULL, kind TEXT NOT NULL, options_json TEXT CHECK(options_json IS NULL OR json_valid(options_json)),
          target_type_id TEXT REFERENCES object_types(id), multiple INTEGER NOT NULL DEFAULT 0 CHECK(multiple IN (0, 1)), revision INTEGER NOT NULL CHECK(revision > 0)
        ) STRICT;
        CREATE TABLE IF NOT EXISTS objects (
          id TEXT PRIMARY KEY COLLATE NOCASE, type_id TEXT NOT NULL REFERENCES object_types(id), title TEXT NOT NULL,
          properties_json TEXT NOT NULL CHECK(json_valid(properties_json)), body TEXT NOT NULL DEFAULT '',
          revision INTEGER NOT NULL CHECK(revision > 0), created_at TEXT NOT NULL, updated_at TEXT NOT NULL, trashed INTEGER NOT NULL CHECK(trashed IN (0, 1)),
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
          object_id TEXT NOT NULL COLLATE NOCASE REFERENCES objects(id), revision INTEGER NOT NULL, snapshot_json TEXT NOT NULL CHECK(json_valid(snapshot_json)),
          recorded_at TEXT NOT NULL, PRIMARY KEY(object_id, revision)
        ) STRICT;
        CREATE TABLE IF NOT EXISTS object_create_requests (
          request_id TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, object_id TEXT NOT NULL COLLATE NOCASE REFERENCES objects(id)
        ) STRICT;
      `);
      installBuiltins(db);
      db.query("INSERT INTO object_metadata(key, value) VALUES ('schema_version', '3') ON CONFLICT(key) DO UPDATE SET value = excluded.value").run();
    }).immediate();
  }

  catalog(): Catalog {
    return {
      types: this.db.query<TypeRow, []>('SELECT * FROM object_types ORDER BY name COLLATE NOCASE, id').all().map(objectType),
      properties: this.db.query<PropertyRow, []>('SELECT * FROM object_properties ORDER BY label COLLATE NOCASE, id').all().map(propertyDefinition),
    };
  }
  getType(id: string): ObjectType {
    const row = this.db.query<TypeRow, [string]>('SELECT * FROM object_types WHERE id = ?').get(id);
    if (!row) throw new AppError(404, 'Object type not found.');
    return objectType(row);
  }
  getProperty(id: string): PropertyDefinition {
    const row = this.db.query<PropertyRow, [string]>('SELECT * FROM object_properties WHERE id = ?').get(id);
    if (!row) throw new AppError(404, 'Property not found.');
    return propertyDefinition(row);
  }
  createType(name: string, basedOnTypeId?: string): ObjectType {
    name = label(name, 'Type name');
    return this.db.transaction(() => {
      const propertyIds = basedOnTypeId === undefined ? [] : this.getType(basedOnTypeId).propertyIds;
      const id = crypto.randomUUID();
      this.db.query('INSERT INTO object_types(id, name, property_ids_json, revision) VALUES (?, CAST(? AS TEXT), ?, 1)').run(id, Buffer.from(name), JSON.stringify(propertyIds));
      return this.getType(id);
    })();
  }
  renameType(id: string, revision: number, name: string): ObjectType {
    name = label(name, 'Type name');
    return this.db.transaction(() => {
      revisionIs(this.getType(id).revision, revision);
      this.db.query('UPDATE object_types SET name = CAST(? AS TEXT), revision = revision + 1 WHERE id = ? AND revision = ?').run(Buffer.from(name), id, revision);
      return this.getType(id);
    })();
  }
  addProperty(typeId: string, revision: number, input: { propertyId?: string; label?: string; kind?: PropertyKind; options?: string[]; targetTypeId?: string; multiple?: boolean }): ObjectType {
    return this.db.transaction(() => {
      const type = this.getType(typeId);
      revisionIs(type.revision, revision);
      let propertyId = input.propertyId;
      if (propertyId !== undefined) {
        this.getProperty(propertyId);
        if (input.label !== undefined || input.kind !== undefined || input.options !== undefined || input.targetTypeId !== undefined || input.multiple !== undefined) throw new AppError(422, 'Reuse a property by ID without redefining it.');
      } else {
        const propertyLabel = label(input.label, 'Property label');
        if (!input.kind || !Object.hasOwn(KINDS, input.kind)) throw new AppError(422, 'Choose a supported property kind.');
        if (input.kind !== 'select' && input.options !== undefined) throw new AppError(422, 'Only select properties have options.');
        if (input.kind !== 'reference' && (input.targetTypeId !== undefined || input.multiple !== undefined)) throw new AppError(422, 'Only reference properties have a target type or multiple values.');
        let options: PropertyDefinition['options'];
        if (input.kind === 'select') {
          if (!Array.isArray(input.options) || !input.options.length || input.options.length > 100) throw new AppError(422, 'Select properties need 1–100 options.');
          const labels = input.options.map(option => label(option, 'Option'));
          if (new Set(labels).size !== labels.length) throw new AppError(422, 'Option labels must be unique.');
          options = labels.map(option => ({ id: crypto.randomUUID(), label: option }));
        }
        if (input.kind === 'reference') {
          if (!input.targetTypeId) throw new AppError(422, 'Reference properties need a target type.');
          this.getType(input.targetTypeId);
          if (input.multiple !== undefined && typeof input.multiple !== 'boolean') throw new AppError(422, 'Reference multiplicity must be true or false.');
        }
        propertyId = crypto.randomUUID();
        this.db.query('INSERT INTO object_properties(id, label, kind, options_json, target_type_id, multiple, revision) VALUES (?, CAST(? AS TEXT), ?, ?, ?, ?, 1)').run(propertyId, Buffer.from(propertyLabel), input.kind, options ? JSON.stringify(options) : null, input.targetTypeId ?? null, input.multiple ? 1 : 0);
      }
      if (type.propertyIds.includes(propertyId)) throw new AppError(409, 'This type already uses that property.');
      this.db.query('UPDATE object_types SET property_ids_json = ?, revision = revision + 1 WHERE id = ? AND revision = ?').run(JSON.stringify([...type.propertyIds, propertyId]), typeId, revision);
      return this.getType(typeId);
    })();
  }
  renameProperty(id: string, revision: number, name: string): PropertyDefinition {
    name = label(name, 'Property label');
    return this.db.transaction(() => {
      revisionIs(this.getProperty(id).revision, revision);
      this.db.query('UPDATE object_properties SET label = CAST(? AS TEXT), revision = revision + 1 WHERE id = ? AND revision = ?').run(Buffer.from(name), id, revision);
      return this.getProperty(id);
    })();
  }
  getObject(id: string): ObjectRecord {
    const row = this.db.query<ObjectRow, [string]>('SELECT * FROM objects WHERE id = ?').get(id);
    if (!row) throw new AppError(404, 'Object not found.');
    return objectRecord(row);
  }
  getJournal(date: string): ObjectRecord | undefined {
    if (!validDate(date)) throw new AppError(422, 'Choose a real calendar date in YYYY-MM-DD format.');
    const row = this.db.query<ObjectRow, [string]>(`SELECT * FROM objects
      WHERE type_id = '${JOURNAL_TYPE_ID}' AND json_extract(properties_json, '${JOURNAL_DATE_PATH}') = ?`).get(date);
    return row ? objectRecord(row) : undefined;
  }
  openJournal(date: string): ObjectRecord {
    return this.db.transaction(() => {
      const existing = this.getJournal(date);
      return existing ?? this.createObject({ typeId: JOURNAL_TYPE_ID, title: date, properties: { [JOURNAL_DATE_PROPERTY_ID]: date }, body: '' });
    }).immediate();
  }
  listObjects(options: ObjectListOptions = {}): ObjectRecord[] {
    const limit = options.limit ?? 50;
    const offset = options.offset ?? 0;
    if (!Number.isInteger(limit) || limit < 1 || limit > 200 || !Number.isInteger(offset) || offset < 0 || offset > 1_000_000) throw new AppError(422, 'Invalid browse limit or offset.');
    if (options.search !== undefined && (typeof options.search !== 'string' || options.search.length > 200)) throw new AppError(422, 'Search must be at most 200 characters.');
    if (options.trashed !== undefined && typeof options.trashed !== 'boolean') throw new AppError(422, 'Invalid trash filter.');
    if (options.typeId) this.getType(options.typeId);
    const pattern = `%${(options.search ?? '').replace(/[\\%_]/g, '\\$&')}%`;
    return this.db.query<ObjectRow, [number, string | null, string | null, string, string, number, number]>(`SELECT * FROM objects WHERE trashed = ? AND (? IS NULL OR type_id = ?)
      AND (title LIKE ? ESCAPE '\\' OR body_text LIKE ? ESCAPE '\\') ORDER BY updated_at DESC, id LIMIT ? OFFSET ?`).all(options.trashed ? 1 : 0, options.typeId ?? null, options.typeId ?? null, pattern, pattern, limit, offset).map(objectRecord);
  }
  countObjectsByType(trashed = false): Record<string, number> {
    const rows = this.db.query<{ type_id: string; count: number }, [number]>(
      'SELECT type_id, COUNT(*) AS count FROM objects WHERE trashed = ? GROUP BY type_id',
    ).all(trashed ? 1 : 0);
    return Object.fromEntries(rows.map(row => [row.type_id, row.count]));
  }
  objectExcerpts(ids: string[]): Record<string, string> {
    if (ids.length > 50 || ids.some(id => !ID.test(id))) throw new AppError(422, 'Invalid object selection.');
    if (!ids.length) return {};
    const rows = this.db.query<{ id: string; excerpt: string }, string[]>(`
      SELECT id, substr(body_text, 1, 240) || CASE WHEN length(body_text) > 240 THEN '…' ELSE '' END AS excerpt
      FROM objects WHERE id IN (${ids.map(() => '?').join(',')})
    `).all(...ids);
    return Object.fromEntries(rows.map(row => [row.id, row.excerpt]));
  }
  createObject(input: ObjectWrite, requestId?: string): ObjectRecord {
    if (requestId !== undefined && (typeof requestId !== 'string' || !ID.test(requestId))) throw new AppError(422, 'Creation request ID must be a UUID.');
    return this.db.transaction(() => {
      // Check the receipt before current target state: retrying an applied request
      // cannot become a new write. Markdown source participates without normalization.
      const write = this.validateShape(input);
      const digest = requestId === undefined ? undefined : fingerprint(write);
      if (requestId !== undefined) {
        const receipt = this.db.query<{ fingerprint: string; object_id: string }, [string]>('SELECT fingerprint, object_id FROM object_create_requests WHERE request_id = ?').get(requestId.toLowerCase());
        if (receipt) {
          if (receipt.fingerprint !== digest) throw new AppError(409, 'This creation request was already used for different content.');
          return this.getObject(receipt.object_id);
        }
      }
      this.validateValues(write);
      const now = new Date().toISOString();
      const id = crypto.randomUUID();
      this.db.query(`INSERT INTO objects(id, type_id, title, properties_json, body, revision, created_at, updated_at, trashed, body_text)
        VALUES (?, ?, CAST(? AS TEXT), ?, CAST(? AS TEXT), 1, ?, ?, 0, CAST(? AS TEXT))`).run(id, write.typeId, Buffer.from(write.title), JSON.stringify(write.properties), Buffer.from(write.body), now, now, Buffer.from(markdownText(write.body)));
      const object = this.getObject(id);
      this.indexReferences(object);
      if (requestId !== undefined) this.db.query('INSERT INTO object_create_requests(request_id, fingerprint, object_id) VALUES (?, ?, ?)').run(requestId.toLowerCase(), digest!, id);
      return object;
    }).immediate();
  }
  updateObject(id: string, revision: number, input: ObjectWrite): ObjectRecord {
    return this.db.transaction(() => {
      const previous = this.getObject(id);
      revisionIs(previous.revision, revision);
      const write = this.validateShape(input);
      this.validateValues(write, previous);
      if (write.typeId !== previous.typeId) {
        const incoming = this.db.query<{ property_id: string }, [string]>('SELECT DISTINCT property_id FROM object_references WHERE target_id = ? AND property_id != \'\'').all(id);
        for (const edge of incoming) {
          if (this.getProperty(edge.property_id).targetTypeId !== write.typeId) {
            const external = this.db.query<{ source_id: string }, [string, string, string]>('SELECT source_id FROM object_references WHERE target_id = ? AND property_id = ? AND source_id != ? LIMIT 1').get(id, edge.property_id, id);
            if (external) throw new AppError(409, 'This type change would invalidate an existing reference. Remove or change that reference first.');
          }
        }
      }
      this.remember(previous);
      this.db.query(`UPDATE objects SET type_id = ?, title = CAST(? AS TEXT), properties_json = ?, body = CAST(? AS TEXT), body_text = CAST(? AS TEXT), revision = revision + 1, updated_at = ? WHERE id = ? AND revision = ?`).run(write.typeId, Buffer.from(write.title), JSON.stringify(write.properties), Buffer.from(write.body), Buffer.from(markdownText(write.body)), new Date().toISOString(), id, revision);
      const object = this.getObject(id);
      this.indexReferences(object);
      return object;
    }).immediate();
  }
  patchProperties(id: string, revision: number, patch: Record<string, PropertyValue | null>): ObjectRecord {
    return this.db.transaction(() => {
      const previous = this.getObject(id);
      revisionIs(previous.revision, revision);
      if (!plainObject(patch) || Object.keys(patch).length > 256) throw new AppError(422, 'Invalid property patch.');
      const properties = { ...previous.properties };
      for (const [propertyId, value] of Object.entries(patch)) {
        this.getProperty(propertyId);
        if (value === null) delete properties[propertyId]; else properties[propertyId] = value;
      }
      return this.updateObject(id, revision, { typeId: previous.typeId, title: previous.title, properties, body: previous.body });
    }).immediate();
  }
  setTrashed(id: string, revision: number, trashed: boolean): ObjectRecord {
    if (typeof trashed !== 'boolean') throw new AppError(422, 'Invalid trash state.');
    return this.db.transaction(() => {
      const previous = this.getObject(id);
      revisionIs(previous.revision, revision);
      if (previous.trashed === trashed) return previous;
      const write = this.validateShape(previous);
      this.validateValues(write, previous);
      this.remember(previous);
      this.db.query('UPDATE objects SET properties_json = ?, trashed = ?, revision = revision + 1, updated_at = ? WHERE id = ? AND revision = ?').run(JSON.stringify(write.properties), trashed ? 1 : 0, new Date().toISOString(), id, revision);
      return this.getObject(id);
    }).immediate();
  }
  backlinks(id: string): Backlink[] {
    this.getObject(id);
    const rows = this.db.query<ObjectRow & { property_id: string }, [string]>(`SELECT o.*, r.property_id FROM object_references r JOIN objects o ON o.id = r.source_id WHERE r.target_id = ? ORDER BY o.updated_at DESC, o.id, r.property_id`).all(id);
    return rows.map(row => ({ object: objectRecord(row), ...(row.property_id ? { propertyId: row.property_id } : {}) }));
  }

  private validateShape(input: ObjectWrite): ObjectWrite {
    if (!plainObject(input) || typeof input.typeId !== 'string' || !ID.test(input.typeId)) throw new AppError(422, 'Choose an object type.');
    if (typeof input.title !== 'string' || !input.title.trim() || input.title.length > 500) throw new AppError(422, 'Title must contain 1–500 characters.');
    if (!plainObject(input.properties) || Object.keys(input.properties).length > 256 || JSON.stringify(input.properties).length > 262_144) throw new AppError(422, 'Invalid or oversized properties.');
    let body: string;
    try { body = validateMarkdown(input.body); } catch (error) { throw new AppError(422, error instanceof Error ? error.message : 'Invalid Markdown.'); }
    return { typeId: input.typeId, title: input.title, properties: structuredClone(input.properties) as Record<string, PropertyValue>, body };
  }
  private validateValues(write: ObjectWrite, previous?: ObjectRecord): void {
    this.getType(write.typeId);
    for (const [propertyId, value] of Object.entries(write.properties)) {
      const property = this.getProperty(propertyId);
      if (property.kind === 'select') {
        if (typeof value !== 'string' || !property.options?.some(option => option.id === value)) throw new AppError(422, `${property.label}: choose an option by its stable ID.`);
      } else if (property.kind === 'reference') {
        const ids = property.multiple ? value : [value];
        if (!Array.isArray(ids) || ids.length > 256 || ids.some(id => typeof id !== 'string' || !ID.test(id)) || new Set(ids.map(id => String(id).toLowerCase())).size !== ids.length) throw new AppError(422, `${property.label}: expected ${property.multiple ? 'unique object IDs' : 'one object ID'}.`);
        const oldValue = previous?.properties[propertyId];
        const retained = new Set((Array.isArray(oldValue) ? oldValue : typeof oldValue === 'string' ? [oldValue] : []).map(id => id.toLowerCase()));
        for (const targetId of ids as string[]) {
          const target = this.getObject(targetId);
          const targetType = previous && target.id.toLowerCase() === previous.id.toLowerCase() ? write.typeId : target.typeId;
          if (targetType !== property.targetTypeId) throw new AppError(422, `${property.label}: target has the wrong object type.`);
          if (target.trashed && !retained.has(target.id.toLowerCase())) throw new AppError(422, `${property.label}: cannot add a reference to a trashed object.`);
        }
      } else {
        const error = valueError(property.kind, value);
        if (error) throw new AppError(422, `${property.label}: ${error}`);
      }
    }
    const retained = new Set(previous ? markdownReferences(previous.body) : []);
    for (const targetId of markdownReferences(write.body)) {
      const target = this.getObject(targetId);
      if (target.trashed && !retained.has(target.id.toLowerCase())) throw new AppError(422, 'Cannot add a link to a trashed object.');
    }
    this.validateBuiltinValues(write, previous);
  }
  private validateBuiltinValues(write: ObjectWrite, previous?: ObjectRecord): void {
    const has = (id: string): boolean => Object.hasOwn(write.properties, id);
    if (write.typeId === TASK_TYPE_ID && !has(TASK_DONE_PROPERTY_ID)) {
      write.properties[TASK_DONE_PROPERTY_ID] = false;
      if (Object.keys(write.properties).length > 256 || JSON.stringify(write.properties).length > 262_144) throw new AppError(422, 'Invalid or oversized properties.');
    }
    if (write.typeId === EVENT_TYPE_ID && has(EVENT_DATES_PROPERTY_ID) === has(EVENT_TIME_PROPERTY_ID)) {
      throw new AppError(422, 'Event requires exactly one all-day date range or timed range.');
    }
    if (write.typeId === REMINDER_TYPE_ID && has(REMINDER_DATE_PROPERTY_ID) === has(REMINDER_TIME_PROPERTY_ID)) {
      throw new AppError(422, 'Reminder requires exactly one date or time.');
    }
    if (write.typeId === JOURNAL_TYPE_ID) {
      const date = write.properties[JOURNAL_DATE_PROPERTY_ID];
      if (!validDate(date)) throw new AppError(422, 'Journal requires a real calendar date in YYYY-MM-DD format.');
      const existing = this.getJournal(date);
      if (existing && existing.id !== previous?.id) throw new AppError(409, `A Journal already exists for ${date}, including in Trash. Open the existing Journal instead.`);
    }
  }
  private remember(object: ObjectRecord): void {
    this.db.query('INSERT INTO object_revisions(object_id, revision, snapshot_json, recorded_at) VALUES (?, ?, ?, ?)').run(object.id, object.revision, JSON.stringify(object), new Date().toISOString());
  }
  private indexReferences(object: ObjectRecord): void {
    this.db.query('DELETE FROM object_references WHERE source_id = ?').run(object.id);
    const insert = this.db.query('INSERT OR IGNORE INTO object_references(source_id, target_id, property_id) VALUES (?, ?, ?)');
    for (const [propertyId, value] of Object.entries(object.properties)) {
      if (this.getProperty(propertyId).kind !== 'reference') continue;
      for (const targetId of Array.isArray(value) ? value : [value]) insert.run(object.id, String(targetId), propertyId);
    }
    for (const targetId of markdownReferences(object.body)) insert.run(object.id, targetId, '');
  }
}
