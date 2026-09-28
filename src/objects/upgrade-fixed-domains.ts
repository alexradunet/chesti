import type { Database, Statement } from 'bun:sqlite';
import {
  BUILTIN_PROPERTIES, BUILTIN_TYPES,
  EVENT_DATES_PROPERTY_ID, EVENT_TIME_PROPERTY_ID, EVENT_TYPE_ID,
  JOURNAL_DATE_PROPERTY_ID, JOURNAL_TYPE_ID,
  PAGE_TYPE_ID,
  PERSON_BIRTHDAY_PROPERTY_ID, PERSON_FAVORITE_ARTISTS_PROPERTY_ID, PERSON_JOB_TITLE_PROPERTY_ID,
  PERSON_LAST_CONNECTED_PROPERTY_ID, PERSON_PHONE_PROPERTY_ID, PERSON_RECONNECT_EVERY_PROPERTY_ID, PERSON_RELATIONSHIP_PROPERTY_ID, PERSON_TYPE_ID,
  REMINDER_DATE_PROPERTY_ID, REMINDER_TIME_PROPERTY_ID, REMINDER_TYPE_ID,
  TASK_DONE_PROPERTY_ID, TASK_DUE_PROPERTY_ID, TASK_SCHEDULED_PROPERTY_ID, TASK_TYPE_ID,
  ViewSpecSchema,
  type PropertyKind,
  type PropertyValue,
} from './model.js';
import { validDate, validDateTime, valueError } from './values.js';
import { Value } from 'typebox/value';

export type FixedDomainPreflightStatus = 'compatible' | 'blocked' | 'upgrade-required';

export interface FixedDomainBlockerSample { id: string; reason: string }
export interface FixedDomainBlocker { category: string; count: number; samples: FixedDomainBlockerSample[]; truncated: boolean }
export interface FixedDomainPreflightReport {
  status: FixedDomainPreflightStatus;
  schemaVersion?: number;
  counts: Record<string, number>;
  blockers: FixedDomainBlocker[];
}

interface TableInfoRow { name: string; type: string; sql: string | null }
interface MetadataRow { value: string }
interface TypeRow { id: string; name: string; property_ids_json: string; revision: number }
interface PropertyRow { id: string; label: string; kind: string; options_json: string | null; target_type_id: string | null; multiple: number; revision: number }
interface ObjectRow { id: string; type_id: string; properties_json: string }
interface RevisionRow { object_id: string; revision: number; snapshot_json: string }
interface ViewRow { id: string; revision?: number; spec_json: string; schema_json: string }

const SAMPLE_LIMIT = 5;
const BATCH_SIZE = 500;
const builtinTypes = new Map(BUILTIN_TYPES.map(type => [type.id, type]));
const builtinProperties = new Map(BUILTIN_PROPERTIES.map(property => [property.id, property]));
const allowedByType = new Map(BUILTIN_TYPES.map(type => [type.id, new Set(type.propertyIds)]));
const fixedPropertyKinds = new Map(BUILTIN_PROPERTIES.map(property => [property.id, property.kind]));
const knownApplicationTables = new Set([
  'object_metadata', 'object_types', 'object_properties', 'objects', 'object_references', 'object_revisions', 'object_create_requests', 'object_favorites',
  'object_views', 'object_view_revisions', 'object_view_conversations', 'object_view_conversation_turns', 'browser_visitors',
]);
const knownApplicationSchemaObjects = new Set([
  ...knownApplicationTables,
  'objects_browse', 'objects_type_browse', 'object_references_target', 'objects_journal_date',
  'object_view_history_no_update', 'object_view_history_no_delete', 'objects_journal_date_insert', 'objects_journal_date_update',
  ...BUILTIN_TYPES.flatMap((_, index) => [`object_builtin_type_${index}_insert`, `object_builtin_type_${index}_update`, `object_builtin_type_${index}_delete`]),
  ...BUILTIN_PROPERTIES.flatMap((_, index) => [`object_builtin_property_${index}_insert`, `object_builtin_property_${index}_update`, `object_builtin_property_${index}_delete`]),
]);
const requiredColumns: Record<string, readonly string[]> = {
  object_metadata: ['key', 'value'],
  object_types: ['id', 'name', 'property_ids_json', 'revision'],
  object_properties: ['id', 'label', 'kind', 'options_json', 'target_type_id', 'multiple', 'revision'],
  objects: ['id', 'type_id', 'title', 'properties_json', 'body', 'revision', 'created_at', 'updated_at', 'trashed', 'body_text'],
  object_references: ['source_id', 'target_id', 'property_id'],
  object_revisions: ['object_id', 'revision', 'snapshot_json', 'recorded_at'],
  object_create_requests: ['request_id', 'fingerprint', 'object_id'],
  object_favorites: ['object_id', 'created_at'],
  object_views: ['id', 'revision', 'status', 'spec_json', 'prompt', 'model', 'schema_json', 'created_at', 'updated_at', 'deleted'],
  object_view_revisions: ['id', 'revision', 'status', 'spec_json', 'prompt', 'model', 'schema_json', 'created_at', 'updated_at', 'deleted'],
  object_view_conversations: ['id', 'visitor_id', 'previous_id', 'context_title'],
  object_view_conversation_turns: ['conversation_id', 'position', 'prompt', 'view_id', 'title', 'description', 'model'],
  browser_visitors: ['id', 'csrf'],
};

class Builder {
  readonly counts: Record<string, number> = {};
  private readonly blockers = new Map<string, FixedDomainBlocker>();

  add(category: string, id: string, reason: string): void {
    const blocker = this.blockers.get(category) ?? { category, count: 0, samples: [], truncated: false };
    blocker.count += 1;
    if (blocker.samples.length < SAMPLE_LIMIT) blocker.samples.push({ id, reason });
    else blocker.truncated = true;
    this.blockers.set(category, blocker);
  }

  report(status: FixedDomainPreflightStatus, schemaVersion?: number): FixedDomainPreflightReport {
    return { status, schemaVersion, counts: this.counts, blockers: [...this.blockers.values()] };
  }
}

function safeJson(text: string): unknown {
  return JSON.parse(text) as unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function count(db: Database, table: string): number {
  return db.query<{ count: number }, []>(`SELECT COUNT(*) AS count FROM ${table}`).get()!.count;
}

function tableColumns(db: Database, table: string): Set<string> {
  return new Set(db.query<{ name: string }, []>(`PRAGMA table_info(${table})`).all().map(row => row.name));
}

function validScalar(kind: PropertyKind, value: unknown): boolean {
  return valueError(kind as Exclude<PropertyKind, 'select' | 'reference'>, value) === undefined;
}

function validateProperties(builder: Builder, category: string, id: string, typeId: string, properties: unknown): void {
  if (!builtinTypes.has(typeId)) {
    builder.add(category, id, `unknown type ${typeId}`);
    return;
  }
  if (!isRecord(properties)) {
    builder.add(category, id, 'properties are not a JSON object');
    return;
  }
  const allowed = allowedByType.get(typeId)!;
  for (const key of Object.keys(properties)) {
    if (!fixedPropertyKinds.has(key)) {
      builder.add(category, id, `unknown property ${key}`);
      continue;
    }
    if (!allowed.has(key)) {
      builder.add(category, id, `property ${key} is not permitted for this built-in kind`);
      continue;
    }
    const kind = fixedPropertyKinds.get(key)!;
    if (!validScalar(kind, properties[key])) builder.add(category, id, `invalid ${kind} value for ${key}`);
    if (key === PERSON_RECONNECT_EVERY_PROPERTY_ID && !(typeof properties[key] === 'number' && Number.isInteger(properties[key]) && properties[key] >= 1 && properties[key] <= 120)) {
      builder.add(category, id, 'Person reconnect interval must be an integer from 1 to 120');
    }
  }
  if (typeId === TASK_TYPE_ID && properties[TASK_DONE_PROPERTY_ID] !== undefined && typeof properties[TASK_DONE_PROPERTY_ID] !== 'boolean') builder.add(category, id, 'Task Done must be boolean when present');
  if (typeId === JOURNAL_TYPE_ID && !validDate(properties[JOURNAL_DATE_PROPERTY_ID])) builder.add(category, id, 'Journal date is required and must be real');
  if (typeId === EVENT_TYPE_ID) {
    const hasDates = properties[EVENT_DATES_PROPERTY_ID] !== undefined;
    const hasTime = properties[EVENT_TIME_PROPERTY_ID] !== undefined;
    if (hasDates === hasTime) builder.add(category, id, 'Event requires exactly one all-day date range or timed range');
  }
  if (typeId === REMINDER_TYPE_ID) {
    const hasDate = properties[REMINDER_DATE_PROPERTY_ID] !== undefined;
    const hasTime = properties[REMINDER_TIME_PROPERTY_ID] !== undefined;
    if (hasDate === hasTime) builder.add(category, id, 'Reminder requires exactly one date or timestamp');
    if (hasTime && !validDateTime(properties[REMINDER_TIME_PROPERTY_ID])) builder.add(category, id, 'Reminder timestamp must include a valid explicit offset');
  }
}

function validateView(builder: Builder, category: string, row: ViewRow): void {
  let spec: unknown;
  let schema: unknown;
  try {
    spec = safeJson(row.spec_json);
    schema = safeJson(row.schema_json);
  } catch {
    builder.add(category, row.id, 'view JSON is malformed');
    return;
  }
  if (!Array.isArray(schema)) builder.add(category, row.id, 'schema signature is not an array');
  if (!Value.Check(ViewSpecSchema, spec)) {
    builder.add(category, row.id, 'view spec does not match the supported shape');
    return;
  }
  const checked = spec as { input?: unknown; blocks: Array<{ sources: Array<{ typeId: string; bindings: Record<string, string>; where?: Array<{ propertyId: string; value?: unknown }>; orderBy?: { propertyId: string } }> }> };
  if (checked.input !== undefined) builder.add(category, row.id, 'input-scoped views are not compatible with fixed domains');
  for (const [blockIndex, block] of checked.blocks.entries()) {
    for (const [sourceIndex, source] of block.sources.entries()) {
      const sampleId = `${row.id}#${blockIndex}.${sourceIndex}`;
      if (!builtinTypes.has(source.typeId)) {
        builder.add(category, sampleId, `unknown source type ${source.typeId}`);
        continue;
      }
      const allowed = allowedByType.get(source.typeId)!;
      for (const propertyId of Object.values(source.bindings)) {
        if (!allowed.has(propertyId)) builder.add(category, sampleId, `binding ${propertyId} is not a fixed field for source kind`);
        if (fixedPropertyKinds.get(propertyId) === 'reference') builder.add(category, sampleId, 'reference bindings are not compatible');
      }
      for (const filter of source.where ?? []) {
        if (!allowed.has(filter.propertyId)) builder.add(category, sampleId, `filter ${filter.propertyId} is not a fixed field for source kind`);
        if (isRecord(filter.value) && filter.value.input === true) builder.add(category, sampleId, 'input-bound filters are not compatible');
      }
      if (source.orderBy && !allowed.has(source.orderBy.propertyId)) builder.add(category, sampleId, `order ${source.orderBy.propertyId} is not a fixed field for source kind`);
    }
  }
}

function validateDefinitions(db: Database, builder: Builder): void {
  for (const row of db.query<TypeRow, []>('SELECT id, name, property_ids_json, revision FROM object_types ORDER BY id').all()) {
    const expected = builtinTypes.get(row.id);
    if (!expected) {
      builder.add('definitions', row.id, 'custom object type is not fixed-domain compatible');
      continue;
    }
    if (row.name !== expected.name) builder.add('definitions', row.id, 'built-in type display label was changed');
    let propertyIds: unknown;
    try { propertyIds = safeJson(row.property_ids_json); } catch { propertyIds = undefined; }
    if (!Array.isArray(propertyIds) || propertyIds.length !== expected.propertyIds.length || expected.propertyIds.some((id, index) => propertyIds[index] !== id)) {
      builder.add('definitions', row.id, 'built-in type field attachment/order changed');
    }
  }
  for (const expected of BUILTIN_TYPES) {
    if (!db.query<{ id: string }, [string]>('SELECT id FROM object_types WHERE id = ?').get(expected.id)) builder.add('definitions', expected.id, 'built-in type is missing');
  }
  for (const row of db.query<PropertyRow, []>('SELECT id, label, kind, options_json, target_type_id, multiple, revision FROM object_properties ORDER BY id').all()) {
    const expected = builtinProperties.get(row.id);
    if (!expected) {
      builder.add('definitions', row.id, 'custom property definition is not fixed-domain compatible');
      continue;
    }
    if (row.label !== expected.label) builder.add('definitions', row.id, 'built-in property display label was changed');
    if (row.kind !== expected.kind || row.options_json !== null || row.target_type_id !== null || row.multiple !== 0) builder.add('definitions', row.id, 'built-in property structure changed');
  }
  for (const expected of BUILTIN_PROPERTIES) {
    if (!db.query<{ id: string }, [string]>('SELECT id FROM object_properties WHERE id = ?').get(expected.id)) builder.add('definitions', expected.id, 'built-in property is missing');
  }
}

function scanRows<Row>(statement: Statement<Row, [number, number]>, handle: (row: Row) => void): void {
  for (let offset = 0;; offset += BATCH_SIZE) {
    const rows = statement.all(BATCH_SIZE, offset);
    for (const row of rows) handle(row);
    if (rows.length < BATCH_SIZE) break;
  }
}

function validateApplicationShape(db: Database, builder: Builder): boolean {
  const schema = db.query<TableInfoRow, []>("SELECT name, type, sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name").all();
  const existingTables = new Set(schema.filter(row => row.type === 'table').map(row => row.name));
  let ok = true;
  for (const [table, columns] of Object.entries(requiredColumns)) {
    if (!existingTables.has(table)) {
      builder.add('application-shape', table, 'required table is missing');
      ok = false;
      continue;
    }
    const present = tableColumns(db, table);
    for (const column of columns) if (!present.has(column)) { builder.add('application-shape', `${table}.${column}`, 'required column is missing'); ok = false; }
  }
  for (const row of schema) {
    if ((row.type === 'trigger' || row.type === 'view') && !knownApplicationSchemaObjects.has(row.name) && /\bobject(s|_|$)|\bbrowser_visitors\b/i.test(row.sql ?? '')) {
      builder.add('application-shape', row.name, `custom ${row.type} depends on application tables`);
    }
  }
  return ok;
}

export function analyzeFixedDomainPreflight(db: Database): FixedDomainPreflightReport {
  const builder = new Builder();
  let report: FixedDomainPreflightReport | undefined;
  db.exec('PRAGMA query_only = ON; PRAGMA foreign_keys = ON;');
  db.transaction(() => {
    const integrity = db.query<{ integrity_check: string }, []>('PRAGMA integrity_check').all();
    if (integrity.length !== 1 || integrity[0]!.integrity_check !== 'ok') {
      for (const row of integrity.slice(0, SAMPLE_LIMIT)) builder.add('sqlite-integrity', 'integrity_check', row.integrity_check);
    }
    for (const row of db.query<Record<string, unknown>, []>('PRAGMA foreign_key_check').all().slice(0, SAMPLE_LIMIT)) {
      builder.add('sqlite-integrity', String(row.table ?? 'foreign_key_check'), JSON.stringify(row));
    }
    const versionText = db.query<MetadataRow, []>("SELECT value FROM object_metadata WHERE key = 'schema_version'").get()?.value;
    const schemaVersion = versionText === undefined ? undefined : Number(versionText);
    if (!Number.isInteger(schemaVersion)) {
      builder.add('schema-version', 'object_metadata.schema_version', 'missing or non-integer schema version');
      report = builder.report('blocked');
      return;
    }
    const version = schemaVersion as number;
    if (version >= 1 && version <= 5) {
      builder.add('schema-version', String(version), 'run the old application preserving upgrade to schema version 6 on a disposable backup before fixed-domain preflight');
      report = builder.report('upgrade-required', version);
      return;
    }
    if (version !== 6) {
      builder.add('schema-version', String(version), 'unsupported object database schema version');
      report = builder.report('blocked', version);
      return;
    }
    if (!validateApplicationShape(db, builder)) {
      report = builder.report('blocked', version);
      return;
    }
    for (const table of Object.keys(requiredColumns)) builder.counts[table] = count(db, table);
    validateDefinitions(db, builder);
    scanRows(db.query<ObjectRow, [number, number]>('SELECT id, type_id, properties_json FROM objects ORDER BY id LIMIT ? OFFSET ?'), row => {
      let properties: unknown;
      try { properties = safeJson(row.properties_json); } catch { builder.add('objects', row.id, 'properties JSON is malformed'); return; }
      validateProperties(builder, 'objects', row.id, row.type_id, properties);
    });
    scanRows(db.query<RevisionRow, [number, number]>('SELECT object_id, revision, snapshot_json FROM object_revisions ORDER BY object_id, revision LIMIT ? OFFSET ?'), row => {
      let snapshot: unknown;
      try { snapshot = safeJson(row.snapshot_json); } catch { builder.add('history', `${row.object_id}@${row.revision}`, 'snapshot JSON is malformed'); return; }
      if (!isRecord(snapshot) || typeof snapshot.typeId !== 'string' || !isRecord(snapshot.properties)) {
        builder.add('history', `${row.object_id}@${row.revision}`, 'snapshot is not a legacy object record');
        return;
      }
      validateProperties(builder, 'history', `${row.object_id}@${row.revision}`, snapshot.typeId, snapshot.properties);
    });
    const structuredReferences = db.query<{ count: number }, []>("SELECT COUNT(*) AS count FROM object_references WHERE property_id != ''").get()!.count;
    if (structuredReferences) {
      builder.add('structured-references', 'object_references', `${structuredReferences} property/reference edge(s) are not Markdown links`);
    }
    scanRows(db.query<ViewRow, [number, number]>('SELECT id, revision, spec_json, schema_json FROM object_views ORDER BY id LIMIT ? OFFSET ?'), row => validateView(builder, 'views', row));
    scanRows(db.query<ViewRow, [number, number]>('SELECT id, revision, spec_json, schema_json FROM object_view_revisions ORDER BY id, revision LIMIT ? OFFSET ?'), row => validateView(builder, 'view-history', row));
    report = builder.report(builder.report('blocked', version).blockers.length ? 'blocked' : 'compatible', version);
  }).deferred();
  return report ?? builder.report('blocked');
}
