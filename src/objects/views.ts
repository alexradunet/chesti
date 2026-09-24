import { Value } from 'typebox/value';
import { AppError } from '../core.js';
import { validDate, validDateTime } from './values.js';
import { ViewSpecSchema } from './model.js';
import type { Catalog, EvaluatedBlock, EvaluatedView, ObjectRecord, PropertyDefinition, PropertyValue, SavedView, ViewSource, ViewSpec } from './model.js';
import type { ObjectRuntime } from './runtime.js';

type Filter = NonNullable<ViewSource['where']>[number];
type SqlValue = string | number;
interface ViewRowData {
  id: string; revision: number; status: 'draft' | 'published'; spec_json: string;
  prompt: string; model: string; schema_json: string; created_at: string; updated_at: string; deleted: number;
}
interface ObjectRowData {
  id: string; type_id: string; title: string; properties_json: string; document_json: string;
  revision: number; created_at: string; updated_at: string; trashed: number; source_index: number;
}
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const dateKinds: Record<string, true> = { date: true, datetime: true, 'date-range': true, 'time-range': true };
const groupKinds: Record<string, true> = { select: true, boolean: true, reference: true, text: true };
const invalid = (message: string): never => { throw new AppError(422, message); };
const isInput = (value: Filter['value']): value is { input: true } => typeof value === 'object' && value !== null && value.input === true;

function temporal(value: unknown, kind: PropertyDefinition['kind']): string {
  if (typeof value !== 'string') return invalid('Date filters require a date or timestamp.');
  if (kind === 'date' || kind === 'date-range') {
    if (!validDate(value)) return invalid('Date filters require a real YYYY-MM-DD date.');
    return value;
  }
  if (!validDateTime(value)) return invalid('Time filters require an ISO timestamp with seconds and an explicit time zone.');
  return new Date(value).toISOString();
}

function validateFilter(filter: Filter, property: PropertyDefinition, spec: ViewSpec): void {
  const { operator, value } = filter;
  if (operator === 'empty' || operator === 'notEmpty') {
    if (value !== undefined) invalid('Empty filters do not take a value.');
    return;
  }
  if (value === undefined) invalid('This filter requires a value.');
  if (isInput(value)) {
    if (!spec.input || property.kind !== 'reference' || (property.targetTypeId && property.targetTypeId !== spec.input.typeId)) invalid('Input filters must reference the declared input type.');
    if (property.multiple ? operator !== 'contains' : operator !== 'equals' && operator !== 'notEquals') invalid('Input filters require reference equality or multiple-reference membership.');
    return;
  }
  if (operator === 'before' || operator === 'after') {
    if (!Object.hasOwn(dateKinds, property.kind)) invalid('Before and after require a date, timestamp, or range property.');
    filter.value = temporal(value, property.kind);
    return;
  }
  if (operator === 'contains') {
    if (property.kind !== 'text' && !(property.kind === 'reference' && property.multiple)) invalid('Contains requires text or a multiple-reference property.');
  } else if (property.kind === 'date-range' || property.kind === 'time-range' || property.multiple) {
    invalid('Ranges support before/after; multiple references support contains, empty, and notEmpty.');
  }
  switch (property.kind) {
    case 'text': if (typeof value !== 'string') invalid('Text filters require text.'); break;
    case 'number': if (typeof value !== 'number' || !Number.isFinite(value) || (Number.isInteger(value) && !Number.isSafeInteger(value))) invalid('Number filters require a finite number in the safe integer range.'); break;
    case 'boolean': if (typeof value !== 'boolean') invalid('Boolean filters require true or false.'); break;
    case 'select': if (typeof value !== 'string' || !property.options?.some(option => option.id === value)) invalid('Select filters require a current option ID, not its label.'); break;
    case 'reference': if (typeof value !== 'string' || !uuid.test(value)) invalid('Reference filters require an object ID.'); break;
    case 'date': case 'datetime': filter.value = temporal(value, property.kind); break;
  }
}

/** Validate the same metadata-only contract at AI submission and at every use. */
export function validateViewSpec(input: unknown, catalog: Catalog): ViewSpec {
  if (!Value.Check(ViewSpecSchema, input)) invalid('Invalid saved view structure.');
  const spec = structuredClone(input as ViewSpec);
  const types = new Map(catalog.types.map(type => [type.id, type]));
  const properties = new Map(catalog.properties.map(property => [property.id, property]));
  if (!spec.title.trim() || spec.blocks.some(block => !block.title.trim())) invalid('Views and blocks need a title.');
  if (spec.input && (!spec.input.label.trim() || !types.has(spec.input.typeId))) invalid('Choose an existing input type and a nonempty label.');
  for (const block of spec.blocks) {
    if (block.component === 'table' && !block.columns?.length) invalid('Tables require explicit columns.');
    if (block.editable && block.component !== 'calendar' && block.component !== 'board') invalid('Only calendars and boards expose property actions.');
    const required = block.component === 'calendar' ? 'date' : block.component === 'board' ? 'group' : undefined;
    const roles = new Set<string>();
    for (const column of block.columns ?? []) {
      if (roles.has(column.role) || !column.label.trim()) invalid('Columns need distinct roles and nonempty labels.');
      roles.add(column.role);
    }
    if (required) roles.add(required);
    const sourceTypes = new Set<string>();
    for (const source of block.sources) {
      const type = types.get(source.typeId);
      if (!type) invalid('A view source type no longer exists.');
      if (sourceTypes.has(source.typeId)) invalid('Each type may appear once per block. Use separate blocks for different projections.');
      sourceTypes.add(source.typeId);
      const propertyFor = (id: string): PropertyDefinition => {
        const property = properties.get(id);
        if (!property || !type!.propertyIds.includes(id)) return invalid('Every binding, filter, and ordering must use a property assigned to its source type.');
        return property;
      };
      if (Object.keys(source.bindings).length !== roles.size || [...roles].some(role => !Object.hasOwn(source.bindings, role))) invalid('Each source must bind exactly the exposed component and column roles.');
      for (const [role, id] of Object.entries(source.bindings)) {
        const property = propertyFor(id);
        if (required === role && (role === 'date' ? !Object.hasOwn(dateKinds, property.kind) : !Object.hasOwn(groupKinds, property.kind) || property.multiple)) invalid(`The ${role} binding is incompatible with this component.`);
      }
      for (const filter of source.where ?? []) validateFilter(filter, propertyFor(filter.propertyId), spec);
      if (spec.input && !source.where?.some(filter => isInput(filter.value))) invalid('Every source in an input view must be scoped to that input.');
      if (source.orderBy && propertyFor(source.orderBy.propertyId).multiple) invalid('Ordering requires a single-valued property.');
    }
  }
  return spec;
}

function schemaSignature(spec: ViewSpec, catalog: Catalog): string {
  const used = new Set<string>();
  for (const block of spec.blocks) for (const source of block.sources) {
    for (const id of Object.values(source.bindings)) used.add(id);
    for (const filter of source.where ?? []) used.add(filter.propertyId);
    if (source.orderBy) used.add(source.orderBy.propertyId);
  }
  const properties = new Map(catalog.properties.map(property => [property.id, property]));
  return JSON.stringify([...used].sort().map(id => {
    const property = properties.get(id)!;
    return [id, property.kind, Boolean(property.multiple), property.targetTypeId ?? null];
  }));
}

function saved(row: ViewRowData): SavedView {
  return { id: row.id, revision: row.revision, status: row.status, spec: JSON.parse(row.spec_json) as ViewSpec,
    prompt: row.prompt, model: row.model, createdAt: row.created_at, updatedAt: row.updated_at };
}
function objectRecord(row: ObjectRowData): ObjectRecord {
  return { id: row.id, typeId: row.type_id, title: row.title, properties: JSON.parse(row.properties_json), document: JSON.parse(row.document_json),
    revision: row.revision, createdAt: row.created_at, updatedAt: row.updated_at, trashed: Boolean(row.trashed) };
}
// Only validated UUIDs enter these JSON paths; all comparison values are bound parameters.
const expression = (id: string, member = ''): string => `json_extract(o.properties_json, '$."${id}"${member}')`;
function emptyExpression(property: PropertyDefinition): string {
  const value = expression(property.id);
  return `(${value} IS NULL OR ${value} = ''${property.multiple ? ` OR json_array_length(${value}) = 0` : ''})`;
}
function comparable(property: PropertyDefinition): string {
  const value = expression(property.id, property.kind.endsWith('-range') ? '.start' : '');
  if (property.kind === 'reference') return `${value} COLLATE NOCASE`;
  return property.kind === 'datetime' || property.kind === 'time-range' ? `julianday(${value})` : value;
}
function sourcePredicate(source: ViewSource, properties: Map<string, PropertyDefinition>, inputId?: string): { sql: string; values: SqlValue[] } {
  const predicates = ['o.trashed = 0', 'o.type_id = ?'];
  const values: SqlValue[] = [source.typeId];
  for (const filter of source.where ?? []) {
    const property = properties.get(filter.propertyId)!;
    const empty = emptyExpression(property);
    if (filter.operator === 'empty' || filter.operator === 'notEmpty') {
      predicates.push(filter.operator === 'empty' ? empty : `NOT ${empty}`);
      continue;
    }
    const value = isInput(filter.value) ? inputId : filter.value;
    if (value === undefined || typeof value === 'object') invalid('Choose the required input before querying this view.');
    values.push(typeof value === 'boolean' ? Number(value) : value as SqlValue);
    const field = comparable(property);
    const parameter = property.kind === 'datetime' || property.kind === 'time-range' ? 'julianday(?)' : '?';
    switch (filter.operator) {
      case 'equals': predicates.push(`NOT ${empty} AND ${field} = ${parameter}`); break;
      case 'notEquals': predicates.push(`NOT ${empty} AND ${field} != ${parameter}`); break;
      case 'before': predicates.push(`${field} < ${parameter}`); break;
      case 'after': predicates.push(`${field} > ${parameter}`); break;
      case 'contains': predicates.push(property.multiple
        ? `EXISTS (SELECT 1 FROM json_each(${expression(property.id)}) AS member WHERE member.value COLLATE NOCASE = ?)`
        : `NOT ${empty} AND instr(${expression(property.id)}, ?) > 0`); break;
    }
  }
  return { sql: predicates.map(predicate => `(${predicate})`).join(' AND '), values };
}

export class ViewService {
  constructor(private readonly objects: ObjectRuntime) {
    objects.db.exec(`
      CREATE TABLE IF NOT EXISTS object_views (
        id TEXT PRIMARY KEY, revision INTEGER NOT NULL, status TEXT NOT NULL CHECK(status IN ('draft','published')),
        spec_json TEXT NOT NULL, prompt TEXT NOT NULL, model TEXT NOT NULL, schema_json TEXT NOT NULL,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted INTEGER NOT NULL DEFAULT 0 CHECK(deleted IN (0,1))
      );
      CREATE TABLE IF NOT EXISTS object_view_revisions (
        id TEXT NOT NULL, revision INTEGER NOT NULL, status TEXT NOT NULL, spec_json TEXT NOT NULL,
        prompt TEXT NOT NULL, model TEXT NOT NULL, schema_json TEXT NOT NULL, created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL, deleted INTEGER NOT NULL, PRIMARY KEY(id,revision)
      );
      CREATE TRIGGER IF NOT EXISTS object_view_history_no_update BEFORE UPDATE ON object_view_revisions
        BEGIN SELECT RAISE(ABORT, 'View revision history is immutable'); END;
      CREATE TRIGGER IF NOT EXISTS object_view_history_no_delete BEFORE DELETE ON object_view_revisions
        BEGIN SELECT RAISE(ABORT, 'View revision history is immutable'); END;
    `);
  }

  validate(input: unknown): ViewSpec { return validateViewSpec(input, this.objects.catalog()); }

  list(): SavedView[] {
    return this.objects.db.query<ViewRowData, []>('SELECT * FROM object_views WHERE deleted = 0 ORDER BY updated_at DESC, id ASC').all().map(saved);
  }

  get(id: string): SavedView { return saved(this.row(id)); }

  create(generated: { spec: ViewSpec; model: string }, prompt: string): SavedView {
    if (typeof prompt !== 'string' || !prompt.trim() || prompt.length > 4000) invalid('Describe the view in 1–4000 characters.');
    if (typeof generated.model !== 'string' || !generated.model.trim() || generated.model.length > 300) invalid('Generated views require their provider/model metadata.');
    return this.objects.db.transaction(() => {
      const catalog = this.objects.catalog();
      const spec = validateViewSpec(generated.spec, catalog);
      const now = new Date().toISOString();
      const id = crypto.randomUUID();
      this.objects.db.query('INSERT INTO object_views (id,revision,status,spec_json,prompt,model,schema_json,created_at,updated_at,deleted) VALUES (?,1,\'draft\',?,?,?,?,?,?,0)')
        .run(id, JSON.stringify(spec), prompt, generated.model, schemaSignature(spec, catalog), now, now);
      this.archive(id);
      return this.get(id);
    }).immediate();
  }

  publish(id: string, revision: number): SavedView {
    return this.objects.db.transaction(() => {
      const row = this.row(id);
      this.checkRevision(row, revision);
      this.compatible(row);
      if (row.status !== 'draft') throw new AppError(409, 'This view is already published.');
      this.objects.db.query('UPDATE object_views SET revision = revision + 1, status = \'published\', updated_at = ? WHERE id = ? AND revision = ? AND deleted = 0')
        .run(new Date().toISOString(), id, revision);
      this.archive(id);
      return this.get(id);
    }).immediate();
  }

  delete(id: string, revision: number): void {
    this.objects.db.transaction(() => {
      const row = this.row(id);
      this.checkRevision(row, revision);
      this.objects.db.query('UPDATE object_views SET revision = revision + 1, deleted = 1, updated_at = ? WHERE id = ? AND revision = ? AND deleted = 0')
        .run(new Date().toISOString(), id, revision);
      this.archive(id);
    }).immediate();
  }

  evaluate(id: string, inputId?: string): EvaluatedView {
    return this.objects.db.transaction(() => {
      const row = this.row(id);
      const spec = this.compatible(row);
      const view = { ...saved(row), spec };
      const input = this.input(spec, inputId);
      if (spec.input && !input) return { view, blocks: spec.blocks.map(definition => ({ definition, rows: [], truncated: false, error: `Choose ${spec.input!.label} to see this view.` })) };
      const properties = new Map(this.objects.catalog().properties.map(property => [property.id, property]));
      const blocks: EvaluatedBlock[] = spec.blocks.map(definition => {
        const values: SqlValue[] = [];
        const sources = definition.sources.map((source, index) => {
          const predicate = sourcePredicate(source, properties, input?.id);
          values.push(...predicate.values);
          const order = source.orderBy;
          const property = order ? properties.get(order.propertyId)! : undefined;
          const sort = property ? comparable(property) : 'NULL';
          return `SELECT o.id, o.type_id, o.title, o.properties_json, o.document_json, o.revision, o.created_at, o.updated_at, o.trashed,
            ${index} AS source_index, ${property ? `CASE WHEN ${emptyExpression(property)} THEN 1 ELSE 0 END` : '0'} AS sort_missing,
            ${order?.direction === 'ascending' ? sort : 'NULL'} AS sort_ascending,
            ${order?.direction === 'descending' ? sort : 'NULL'} AS sort_descending
            FROM objects AS o WHERE ${predicate.sql}`;
        });
        const rows = this.objects.db.query<ObjectRowData, SqlValue[]>(`${sources.join(' UNION ALL ')} ORDER BY source_index ASC, sort_missing ASC, sort_ascending ASC, sort_descending DESC, title COLLATE NOCASE ASC, id ASC LIMIT 101`).all(...values);
        return { definition, truncated: rows.length > 100, rows: rows.slice(0, 100).map(result => ({ object: objectRecord(result), bindings: definition.sources[result.source_index]!.bindings })) };
      });
      return { view, blocks, ...(input ? { input } : {}) };
    })();
  }

  act(viewId: string, viewRevision: number, blockIndex: number, objectId: string, objectRevision: number, role: string, value: PropertyValue | null, inputId?: string): ObjectRecord {
    return this.objects.db.transaction(() => {
      const row = this.row(viewId);
      this.checkRevision(row, viewRevision);
      const spec = this.compatible(row);
      if (row.status !== 'published') throw new AppError(409, 'Publish this draft before using its actions.');
      const block = Number.isInteger(blockIndex) && blockIndex >= 0 ? spec.blocks[blockIndex] : undefined;
      if (!block?.editable || !((block.component === 'calendar' && role === 'date') || (block.component === 'board' && role === 'group'))) throw new AppError(403, 'This view does not expose that property action.');
      const input = this.input(spec, inputId);
      if (spec.input && !input) invalid('Choose the required input before acting.');
      const object = this.objects.getObject(objectId);
      if (object.revision !== objectRevision) throw new AppError(409, 'This object changed. Reload before trying again.');
      const properties = new Map(this.objects.catalog().properties.map(property => [property.id, property]));
      const source = block.sources.find(candidate => candidate.typeId === object.typeId);
      if (!source) throw new AppError(403, 'This object is not in a view source.');
      const predicate = sourcePredicate(source, properties, input?.id);
      const member = this.objects.db.query<{ id: string }, SqlValue[]>(`SELECT o.id FROM objects AS o WHERE o.id = ? AND ${predicate.sql} LIMIT 1`).get(objectId, ...predicate.values);
      if (!member) throw new AppError(403, 'This object is no longer in the view source, filter, or input scope.');
      return this.objects.patchProperties(objectId, objectRevision, { [source.bindings[role]!]: value });
    }).immediate();
  }

  private row(id: string): ViewRowData {
    const row = this.objects.db.query<ViewRowData, [string]>('SELECT * FROM object_views WHERE id = ? AND deleted = 0').get(id);
    if (!row) throw new AppError(404, 'Saved view not found.');
    return row;
  }
  private checkRevision(row: ViewRowData, revision: number): void {
    if (!Number.isSafeInteger(revision) || row.revision !== revision) throw new AppError(409, 'This view changed. Reload before trying again.');
  }
  private compatible(row: ViewRowData): ViewSpec {
    const catalog = this.objects.catalog();
    try {
      const spec = validateViewSpec(JSON.parse(row.spec_json), catalog);
      if (schemaSignature(spec, catalog) !== row.schema_json) throw new AppError(409, 'A bound property changed its kind or reference shape.');
      return spec;
    } catch (error) {
      if (!(error instanceof AppError)) throw error;
      throw new AppError(409, 'This saved view is incompatible with the current schema. Generate a revised view; the objects are unchanged.');
    }
  }
  private input(spec: ViewSpec, id?: string): ObjectRecord | undefined {
    if (!id) return undefined;
    if (!spec.input) invalid('This view does not accept an input object.');
    let object: ObjectRecord;
    try { object = this.objects.getObject(id); }
    catch (error) {
      if (error instanceof AppError && error.status === 404) return invalid('Choose an existing object of the input type.');
      throw error;
    }
    if (object.trashed || object.typeId !== spec.input!.typeId) invalid('Choose an active object of the input type.');
    return object;
  }
  private archive(id: string): void {
    this.objects.db.query('INSERT INTO object_view_revisions SELECT * FROM object_views WHERE id = ?').run(id);
  }
}
