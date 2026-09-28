import type { Database, Statement } from 'bun:sqlite';
import { Value } from 'typebox/value';
import { fingerprint } from './fingerprint.js';
import { markdownReferences, markdownText, validateMarkdown } from './markdown.js';
import {
  EVENT_DATES_PROPERTY_ID, EVENT_TIME_PROPERTY_ID, EVENT_TYPE_ID,
  JOURNAL_DATE_PROPERTY_ID, JOURNAL_TYPE_ID,
  PAGE_TYPE_ID,
  PERSON_RECONNECT_EVERY_PROPERTY_ID, PERSON_TYPE_ID,
  REMINDER_DATE_PROPERTY_ID, REMINDER_TIME_PROPERTY_ID, REMINDER_TYPE_ID,
  TASK_DONE_PROPERTY_ID, TASK_TYPE_ID,
  ViewSpecSchema,
  type Catalog,
  type ObjectWrite,
  type PropertyDefinition,
  type PropertyKind,
  type ViewSpec,
} from './model.js';
import { validDate, validDateTime, valueError } from './values.js';
import { validateViewSpec } from './views.js';

export type FixedDomainPreflightStatus = 'compatible' | 'blocked' | 'upgrade-required';

export interface FixedDomainBlockerSample { id: string; reason: string }
export interface FixedDomainBlocker { category: string; count: number; samples: FixedDomainBlockerSample[]; truncated: boolean }
export interface FixedDomainPreflightReport {
  status: FixedDomainPreflightStatus;
  schemaVersion?: number;
  counts: Record<string, number>;
  blockers: FixedDomainBlocker[];
}

interface SchemaRow { name: string; type: string; sql: string | null }
interface MetadataRow { value: string }
interface TypeRow { id: string; name: string; property_ids_json: string; revision: number }
interface PropertyRow { id: string; label: string; kind: string; options_json: string | null; target_type_id: string | null; multiple: number; revision: number }
interface ObjectRow { id: string; type_id: string; title: string; properties_json: string; body: string; revision: number; created_at: string; updated_at: string; trashed: number; body_text: string }
interface RevisionRow { object_id: string; revision: number; snapshot_json: string }
interface ViewRow { id: string; revision?: number; spec_json: string; schema_json: string }
interface ReferenceRow { source_id: string; target_id: string; property_id: string }
interface ReceiptRow { request_id: string; fingerprint: string; object_id: string }

const SAMPLE_LIMIT = 5;
const BATCH_SIZE = 500;
const ID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const SHA256 = /^[a-f0-9]{64}$/;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;

const frozenTypes = [
  { id: PAGE_TYPE_ID, name: 'Page', propertyIds: [] },
  { id: TASK_TYPE_ID, name: 'Task', propertyIds: [TASK_DONE_PROPERTY_ID, '00000000-0000-4000-8000-000000000102', '00000000-0000-4000-8000-000000000103'] },
  { id: EVENT_TYPE_ID, name: 'Event', propertyIds: [EVENT_DATES_PROPERTY_ID, EVENT_TIME_PROPERTY_ID] },
  { id: REMINDER_TYPE_ID, name: 'Reminder', propertyIds: [REMINDER_DATE_PROPERTY_ID, REMINDER_TIME_PROPERTY_ID] },
  { id: JOURNAL_TYPE_ID, name: 'Journal', propertyIds: [JOURNAL_DATE_PROPERTY_ID] },
  { id: PERSON_TYPE_ID, name: 'Person', propertyIds: [
    '00000000-0000-4000-8000-000000000501', '00000000-0000-4000-8000-000000000502', '00000000-0000-4000-8000-000000000503',
    '00000000-0000-4000-8000-000000000504', '00000000-0000-4000-8000-000000000505', PERSON_RECONNECT_EVERY_PROPERTY_ID, '00000000-0000-4000-8000-000000000507',
  ] },
] as const;
const frozenProperties: readonly Omit<PropertyDefinition, 'revision'>[] = [
  { id: TASK_DONE_PROPERTY_ID, label: 'Done', kind: 'boolean' },
  { id: '00000000-0000-4000-8000-000000000102', label: 'Due date', kind: 'date' },
  { id: EVENT_DATES_PROPERTY_ID, label: 'All-day dates', kind: 'date-range' },
  { id: EVENT_TIME_PROPERTY_ID, label: 'Event time', kind: 'time-range' },
  { id: REMINDER_DATE_PROPERTY_ID, label: 'Reminder date', kind: 'date' },
  { id: REMINDER_TIME_PROPERTY_ID, label: 'Reminder time', kind: 'datetime' },
  { id: JOURNAL_DATE_PROPERTY_ID, label: 'Journal date', kind: 'date' },
  { id: '00000000-0000-4000-8000-000000000103', label: 'Scheduled date', kind: 'date' },
  { id: '00000000-0000-4000-8000-000000000501', label: 'Relationship', kind: 'text' },
  { id: '00000000-0000-4000-8000-000000000502', label: 'Birthday', kind: 'date' },
  { id: '00000000-0000-4000-8000-000000000503', label: 'Phone number', kind: 'text' },
  { id: '00000000-0000-4000-8000-000000000504', label: 'Job title', kind: 'text' },
  { id: '00000000-0000-4000-8000-000000000505', label: 'Favorite artists', kind: 'text' },
  { id: PERSON_RECONNECT_EVERY_PROPERTY_ID, label: 'Reconnect every (months)', kind: 'number' },
  { id: '00000000-0000-4000-8000-000000000507', label: 'Last connected', kind: 'date' },
];
const fixedCatalog: Catalog = {
  types: frozenTypes.map(type => ({ id: type.id, name: type.name, propertyIds: [...type.propertyIds], revision: 1 })),
  properties: frozenProperties.map(property => ({ ...property, revision: 1 })),
};
const builtinTypes: Map<string, typeof frozenTypes[number]> = new Map(frozenTypes.map(type => [type.id, type]));
const builtinProperties = new Map(frozenProperties.map(property => [property.id, property]));
const allowedByType: Map<string, Set<string>> = new Map(frozenTypes.map(type => [type.id, new Set<string>(type.propertyIds)]));
const fixedPropertyKinds = new Map(frozenProperties.map(property => [property.id, property.kind]));
const knownApplicationTables = new Set([
  'object_metadata', 'object_types', 'object_properties', 'objects', 'object_references', 'object_revisions', 'object_create_requests', 'object_favorites',
  'object_views', 'object_view_revisions', 'object_view_conversations', 'object_view_conversation_turns', 'browser_visitors',
]);
const requiredColumns: Record<string, readonly string[]> = {
  object_metadata: ['key', 'value'], object_types: ['id', 'name', 'property_ids_json', 'revision'],
  object_properties: ['id', 'label', 'kind', 'options_json', 'target_type_id', 'multiple', 'revision'],
  objects: ['id', 'type_id', 'title', 'properties_json', 'body', 'revision', 'created_at', 'updated_at', 'trashed', 'body_text'],
  object_references: ['source_id', 'target_id', 'property_id'], object_revisions: ['object_id', 'revision', 'snapshot_json', 'recorded_at'],
  object_create_requests: ['request_id', 'fingerprint', 'object_id'], object_favorites: ['object_id', 'created_at'],
  object_views: ['id', 'revision', 'status', 'spec_json', 'prompt', 'model', 'schema_json', 'created_at', 'updated_at', 'deleted'],
  object_view_revisions: ['id', 'revision', 'status', 'spec_json', 'prompt', 'model', 'schema_json', 'created_at', 'updated_at', 'deleted'],
  object_view_conversations: ['id', 'visitor_id', 'previous_id', 'context_title'],
  object_view_conversation_turns: ['conversation_id', 'position', 'prompt', 'view_id', 'title', 'description', 'model'], browser_visitors: ['id', 'csrf'],
};
const knownTriggers = new Set([
  'object_view_history_no_update', 'object_view_history_no_delete', 'objects_journal_date_insert', 'objects_journal_date_update',
  ...frozenTypes.flatMap((_, index) => [`object_builtin_type_${index}_insert`, `object_builtin_type_${index}_update`, `object_builtin_type_${index}_delete`]),
  ...frozenProperties.flatMap((_, index) => [`object_builtin_property_${index}_insert`, `object_builtin_property_${index}_update`, `object_builtin_property_${index}_delete`]),
]);

class Builder {
  readonly counts: Record<string, number> = {};
  private readonly blockers = new Map<string, FixedDomainBlocker>();
  add(category: string, id: string, reason: string): void {
    const blocker = this.blockers.get(category) ?? { category, count: 0, samples: [], truncated: false };
    blocker.count += 1;
    if (blocker.samples.length < SAMPLE_LIMIT) blocker.samples.push({ id: safeId(id), reason: safeReason(reason) });
    else blocker.truncated = true;
    this.blockers.set(category, blocker);
  }
  report(status: FixedDomainPreflightStatus, schemaVersion?: number): FixedDomainPreflightReport {
    return { status, schemaVersion, counts: this.counts, blockers: [...this.blockers.values()] };
  }
}

function safeId(id: string): string {
  if (ID.test(id) || /^[-_.:@#a-zA-Z0-9]{1,120}$/.test(id)) return id;
  return '[redacted]';
}
function safeReason(reason: string): string {
  return reason.replace(/[\p{L}\p{N}_ .:/-]{121,}/gu, '[redacted]').slice(0, 240);
}
function safeJson(text: string): unknown { return JSON.parse(text) as unknown; }
function isRecord(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function count(db: Database, table: string): number { return db.query<{ count: number }, []>(`SELECT COUNT(*) AS count FROM ${table}`).get()!.count; }
function validScalar(kind: PropertyKind, value: unknown): boolean { return valueError(kind as Exclude<PropertyKind, 'select' | 'reference'>, value) === undefined; }
function scanRows<Row>(statement: Statement<Row, [number, number]>, handle: (row: Row) => void): void {
  for (let offset = 0;; offset += BATCH_SIZE) {
    const rows = statement.all(BATCH_SIZE, offset);
    for (const row of rows) handle(row);
    if (rows.length < BATCH_SIZE) break;
  }
}

function schemaSignature(spec: ViewSpec): string {
  const used = new Set<string>();
  for (const block of spec.blocks) for (const source of block.sources) {
    for (const id of Object.values(source.bindings)) used.add(id);
    for (const filter of source.where ?? []) used.add(filter.propertyId);
    if (source.orderBy) used.add(source.orderBy.propertyId);
  }
  const properties = new Map(fixedCatalog.properties.map(property => [property.id, property]));
  return JSON.stringify([...used].sort().map(id => {
    const property = properties.get(id)!;
    return [id, property.kind, Boolean(property.multiple), property.targetTypeId ?? null];
  }));
}

function validateProperties(builder: Builder, category: string, id: string, typeId: string, properties: unknown): void {
  if (!builtinTypes.has(typeId)) { builder.add(category, id, `unknown type ${safeId(typeId)}`); return; }
  if (!isRecord(properties)) { builder.add(category, id, 'properties are not a JSON object'); return; }
  const allowed = allowedByType.get(typeId)!;
  for (const key of Object.keys(properties)) {
    if (!fixedPropertyKinds.has(key)) { builder.add(category, id, `unknown property ${safeId(key)}`); continue; }
    if (!allowed.has(key)) { builder.add(category, id, `property ${key} is not permitted for this built-in kind`); continue; }
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

function validateObjectRow(builder: Builder, row: ObjectRow): void {
  if (!ID.test(row.id)) builder.add('objects', row.id, 'object id is not a UUID');
  if (typeof row.title !== 'string' || row.title.length === 0 || row.title.length > 500) builder.add('objects', row.id, 'title is invalid');
  try { validateMarkdown(row.body); } catch { builder.add('objects', row.id, 'Markdown body is invalid or too large'); }
  if (!Number.isInteger(row.revision) || row.revision <= 0) builder.add('objects', row.id, 'revision must be positive');
  if (!ISO.test(row.created_at) || !ISO.test(row.updated_at)) builder.add('objects', row.id, 'timestamps must be ISO UTC strings');
  if (row.trashed !== 0 && row.trashed !== 1) builder.add('objects', row.id, 'trash flag must be 0 or 1');
  if (row.body_text !== markdownText(row.body)) builder.add('objects', row.id, 'stored search text does not match Markdown body');
  let properties: unknown;
  try { properties = safeJson(row.properties_json); } catch { builder.add('objects', row.id, 'properties JSON is malformed'); return; }
  validateProperties(builder, 'objects', row.id, row.type_id, properties);
}

function validateSnapshot(builder: Builder, row: RevisionRow): void {
  let snapshot: unknown;
  try { snapshot = safeJson(row.snapshot_json); } catch { builder.add('history', `${row.object_id}@${row.revision}`, 'snapshot JSON is malformed'); return; }
  if (!isRecord(snapshot)) { builder.add('history', `${row.object_id}@${row.revision}`, 'snapshot is not an object'); return; }
  if (snapshot.id !== row.object_id) builder.add('history', `${row.object_id}@${row.revision}`, 'snapshot id does not match row object');
  if (snapshot.revision !== row.revision) builder.add('history', `${row.object_id}@${row.revision}`, 'snapshot revision does not match row revision');
  if (typeof snapshot.typeId !== 'string' || typeof snapshot.title !== 'string' || typeof snapshot.body !== 'string' || typeof snapshot.createdAt !== 'string' || typeof snapshot.updatedAt !== 'string' || typeof snapshot.trashed !== 'boolean' || !isRecord(snapshot.properties)) {
    builder.add('history', `${row.object_id}@${row.revision}`, 'snapshot is not a complete legacy object record');
    return;
  }
  try { validateMarkdown(snapshot.body); } catch { builder.add('history', `${row.object_id}@${row.revision}`, 'historical Markdown body is invalid or too large'); }
  validateProperties(builder, 'history', `${row.object_id}@${row.revision}`, snapshot.typeId, snapshot.properties);
}

function validateView(builder: Builder, category: string, row: ViewRow): void {
  let spec: unknown;
  let schema: unknown;
  try { spec = safeJson(row.spec_json); schema = safeJson(row.schema_json); } catch { builder.add(category, row.id, 'view JSON is malformed'); return; }
  if (!Value.Check(ViewSpecSchema, spec)) { builder.add(category, row.id, 'view spec does not match the supported shape'); return; }
  const checked = spec as ViewSpec;
  if (checked.input !== undefined) builder.add(category, row.id, 'input-scoped views are not compatible with fixed domains');
  for (const block of checked.blocks) for (const source of block.sources) {
    for (const id of Object.values(source.bindings)) if (fixedPropertyKinds.get(id) === 'reference') builder.add(category, row.id, 'reference bindings are not compatible');
    for (const filter of source.where ?? []) if (isRecord(filter.value) && filter.value.input === true) builder.add(category, row.id, 'input-bound filters are not compatible');
  }
  try { validateViewSpec(checked, fixedCatalog); } catch { builder.add(category, row.id, 'view spec is not semantically compatible with fixed fields'); return; }
  if (JSON.stringify(schema) !== schemaSignature(checked)) builder.add(category, row.id, 'schema signature does not match fixed field shapes');
}

function validateDefinitions(db: Database, builder: Builder): void {
  scanRows(db.query<TypeRow, [number, number]>('SELECT id, name, property_ids_json, revision FROM object_types ORDER BY id LIMIT ? OFFSET ?'), row => {
    const expected = builtinTypes.get(row.id);
    if (!expected) { builder.add('definitions', row.id, 'custom object type is not fixed-domain compatible'); return; }
    if (row.name !== expected.name) builder.add('definitions', row.id, 'built-in type display label was changed');
    let propertyIds: unknown;
    try { propertyIds = safeJson(row.property_ids_json); } catch { propertyIds = undefined; }
    if (!Array.isArray(propertyIds) || propertyIds.length !== expected.propertyIds.length || expected.propertyIds.some((id, index) => propertyIds[index] !== id)) builder.add('definitions', row.id, 'built-in type field attachment/order changed');
  });
  for (const expected of frozenTypes) if (!db.query<{ id: string }, [string]>('SELECT id FROM object_types WHERE id = ?').get(expected.id)) builder.add('definitions', expected.id, 'built-in type is missing');
  scanRows(db.query<PropertyRow, [number, number]>('SELECT id, label, kind, options_json, target_type_id, multiple, revision FROM object_properties ORDER BY id LIMIT ? OFFSET ?'), row => {
    const expected = builtinProperties.get(row.id);
    if (!expected) { builder.add('definitions', row.id, 'custom property definition is not fixed-domain compatible'); return; }
    if (row.label !== expected.label) builder.add('definitions', row.id, 'built-in property display label was changed');
    if (row.kind !== expected.kind || row.options_json !== null || row.target_type_id !== null || row.multiple !== 0) builder.add('definitions', row.id, 'built-in property structure changed');
  });
  for (const expected of frozenProperties) if (!db.query<{ id: string }, [string]>('SELECT id FROM object_properties WHERE id = ?').get(expected.id)) builder.add('definitions', expected.id, 'built-in property is missing');
}

function validateApplicationShape(db: Database, builder: Builder): boolean {
  const schema = db.query<SchemaRow, []>("SELECT name, type, sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name").all();
  const existingTables = new Set(schema.filter(row => row.type === 'table').map(row => row.name));
  let ok = true;
  for (const [table, columns] of Object.entries(requiredColumns)) {
    if (!existingTables.has(table)) { builder.add('application-shape', table, 'required table is missing'); ok = false; continue; }
    const present = db.query<{ name: string }, []>(`PRAGMA table_xinfo(${table})`).all().map(row => row.name);
    for (const column of columns) if (!present.includes(column)) { builder.add('application-shape', `${table}.${column}`, 'required column is missing'); ok = false; }
    for (const column of present) if (!columns.includes(column)) { builder.add('application-shape', `${table}.${column}`, 'unsupported extra application column'); ok = false; }
  }
  for (const table of existingTables) {
    for (const fk of db.query<{ table: string }, []>(`PRAGMA foreign_key_list(${table})`).all()) {
      if (!knownApplicationTables.has(table) && knownApplicationTables.has(fk.table)) builder.add('application-shape', table, `unrelated table references application table ${fk.table}`);
    }
  }
  for (const row of schema) {
    if ((row.type === 'view' || row.type === 'trigger') && !knownTriggers.has(row.name)) {
      if (/\bobject(s|_|$)|\bobject_types\b|\bobject_properties\b|\bbrowser_visitors\b/i.test(row.sql ?? '')) builder.add('application-shape', row.name, `custom ${row.type} depends on application tables`);
    }
    if (row.name.startsWith('object_view_history_') && !String(row.sql ?? '').includes('View revision history is immutable')) builder.add('application-shape', row.name, 'known trigger definition changed');
  }
  return ok;
}

function validateReceipts(db: Database, builder: Builder): void {
  scanRows(db.query<ReceiptRow, [number, number]>('SELECT request_id, fingerprint, object_id FROM object_create_requests ORDER BY request_id LIMIT ? OFFSET ?'), row => {
    if (!ID.test(row.request_id)) builder.add('receipts', row.request_id, 'request id is not a UUID');
    if (!SHA256.test(row.fingerprint)) builder.add('receipts', row.request_id, 'fingerprint is not a SHA-256 hex digest');
    if (!ID.test(row.object_id)) builder.add('receipts', row.request_id, 'target object id is not a UUID');
  });
}

function validateWritingEdges(db: Database, builder: Builder): void {
  const expected = new Map<string, Set<string>>();
  scanRows(db.query<{ id: string; body: string }, [number, number]>('SELECT id, body FROM objects ORDER BY id LIMIT ? OFFSET ?'), row => expected.set(row.id.toLowerCase(), new Set(markdownReferences(row.body))));
  const actual = new Map<string, Set<string>>();
  scanRows(db.query<ReferenceRow, [number, number]>("SELECT source_id, target_id, property_id FROM object_references WHERE property_id = '' ORDER BY source_id, target_id LIMIT ? OFFSET ?"), row => {
    const source = row.source_id.toLowerCase();
    const target = row.target_id.toLowerCase();
    if (!actual.has(source)) actual.set(source, new Set());
    actual.get(source)!.add(target);
  });
  for (const [source, targets] of expected) for (const target of targets) if (!actual.get(source)?.has(target)) builder.add('writing-links', source, `missing Markdown edge to ${target}`);
  for (const [source, targets] of actual) for (const target of targets) if (!expected.get(source)?.has(target)) builder.add('writing-links', source, `stored Markdown edge to ${target} is not present in body`);
}

function integrityCheck(db: Database, builder: Builder): void {
  const integrity = db.query<{ integrity_check: string }, []>('PRAGMA integrity_check').all();
  if (integrity.length !== 1 || integrity[0]!.integrity_check !== 'ok') for (const row of integrity.slice(0, SAMPLE_LIMIT)) builder.add('sqlite-integrity', 'integrity_check', row.integrity_check);
  const fkRows = db.query<Record<string, unknown>, []>('PRAGMA foreign_key_check').all();
  for (const row of fkRows.slice(0, SAMPLE_LIMIT)) builder.add('sqlite-integrity', String(row.table ?? 'foreign_key_check'), 'foreign key check failed');
  if (fkRows.length > SAMPLE_LIMIT) for (let index = SAMPLE_LIMIT; index < fkRows.length; index += 1) builder.add('sqlite-integrity', 'foreign_key_check', 'foreign key check failed');
}

export function fixedDomainFingerprint(input: ObjectWrite): string { return fingerprint(input); }

export function analyzeFixedDomainPreflight(db: Database): FixedDomainPreflightReport {
  const builder = new Builder();
  let report: FixedDomainPreflightReport | undefined;
  const run = (): void => {
    integrityCheck(db, builder);
    const versionText = db.query<MetadataRow, []>("SELECT value FROM object_metadata WHERE key = 'schema_version'").get()?.value;
    const schemaVersion = versionText === undefined ? undefined : Number(versionText);
    if (!Number.isInteger(schemaVersion)) { builder.add('schema-version', 'object_metadata.schema_version', 'missing or non-integer schema version'); report = builder.report('blocked'); return; }
    const version = schemaVersion as number;
    if (version >= 1 && version <= 5) { builder.add('schema-version', String(version), 'run the old application preserving upgrade to schema version 6 on a disposable backup before fixed-domain preflight'); report = builder.report('upgrade-required', version); return; }
    if (version !== 6) { builder.add('schema-version', String(version), 'unsupported object database schema version'); report = builder.report('blocked', version); return; }
    if (!validateApplicationShape(db, builder)) { report = builder.report('blocked', version); return; }
    for (const table of Object.keys(requiredColumns)) builder.counts[table] = count(db, table);
    validateDefinitions(db, builder);
    scanRows(db.query<ObjectRow, [number, number]>('SELECT id, type_id, title, properties_json, body, revision, created_at, updated_at, trashed, body_text FROM objects ORDER BY id LIMIT ? OFFSET ?'), row => validateObjectRow(builder, row));
    scanRows(db.query<RevisionRow, [number, number]>('SELECT object_id, revision, snapshot_json FROM object_revisions ORDER BY object_id, revision LIMIT ? OFFSET ?'), row => validateSnapshot(builder, row));
    const structuredReferences = db.query<{ count: number }, []>("SELECT COUNT(*) AS count FROM object_references WHERE property_id != ''").get()!.count;
    if (structuredReferences) for (let i = 0; i < structuredReferences; i += 1) builder.add('structured-references', 'object_references', 'property/reference edge is not a Markdown link');
    validateWritingEdges(db, builder);
    validateReceipts(db, builder);
    scanRows(db.query<ViewRow, [number, number]>('SELECT id, revision, spec_json, schema_json FROM object_views ORDER BY id LIMIT ? OFFSET ?'), row => validateView(builder, 'views', row));
    scanRows(db.query<ViewRow, [number, number]>('SELECT id, revision, spec_json, schema_json FROM object_view_revisions ORDER BY id, revision LIMIT ? OFFSET ?'), row => validateView(builder, 'view-history', row));
    report = builder.report(builder.report('blocked', version).blockers.length ? 'blocked' : 'compatible', version);
  };
  if (db.inTransaction) run();
  else db.transaction(run).deferred();
  return report ?? builder.report('blocked');
}
