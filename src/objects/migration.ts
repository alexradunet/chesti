import type { Database } from 'bun:sqlite';
import { randomUUID } from 'node:crypto';
import { basename, dirname, extname, join, normalize } from 'node:path/posix';
import { valueError } from '../vault/values.js';
import { documentFromMarkdown, documentReferences, documentText, validateDocument } from './document.js';
import { PAGE_TYPE_ID } from './model.js';
import type { DocumentNode, ObjectRecord, PropertyDefinition, PropertyKind, PropertyValue } from './model.js';

interface LegacyRecord { id: string; path: string; kind: string; type: string | null; fields_json: string; title: string; body: string }
interface LegacyField { type: string; values?: string[]; target?: string }
interface ImportedType { id: string; qualified: string; fields: Record<string, LegacyField>; properties: Map<string, ImportedProperty> }
interface ImportedProperty { definition: PropertyDefinition; encoding: 'value' | 'json' }
const SIMPLE_KINDS: Record<string, true> = { text: true, number: true, boolean: true, date: true, datetime: true, 'date-range': true, 'time-range': true };
const ID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function parse(source: string, description: string): unknown {
  let value: unknown;
  try { value = JSON.parse(source); } catch { throw new Error(`Cannot migrate ${description}: invalid JSON.`); }
  const pending = [value];
  while (pending.length) {
    const item = pending.pop();
    if (typeof item === 'number' && (!Number.isFinite(item) || (Number.isInteger(item) && !Number.isSafeInteger(item)))) throw new Error(`Cannot migrate ${description}: unsafe numeric metadata.`);
    if (Array.isArray(item)) pending.push(...item);
    else if (record(item)) pending.push(...Object.values(item));
  }
  return value;
}

/** Called inside the schema transaction. Reads only authoritative legacy SQL;
 * archived source, grants, and app runtime/file snapshots are never mutated. */
export function migrateVault(db: Database): boolean {
  const tables = new Set(db.query<{ name: string }, []>("SELECT name FROM sqlite_master WHERE type = 'table'").all().map(row => row.name));
  if (!tables.has('vault_records') && !tables.has('vault_apps')) return false;
  if (!tables.has('vault_records') || !tables.has('vault_apps') || !tables.has('vault_app_revisions')) throw new Error('Cannot migrate an incomplete vault database.');
  if (tables.has('vault_metadata')) {
    const version = db.query<{ value: string }, []>("SELECT value FROM vault_metadata WHERE key = 'schema_version'").get();
    if (version && version.value !== '1') throw new Error('Unsupported source vault database schema.');
  }
  const legacyRecords = db.query<LegacyRecord, []>('SELECT id, path, kind, type, fields_json, title, body FROM vault_records ORDER BY path').all();
  const definitions = db.query<{ id: string; definition_json: string | null }, []>(`SELECT a.id, r.definition_json FROM vault_apps a LEFT JOIN vault_app_revisions r ON r.app_id = a.id AND r.revision = a.current_revision ORDER BY a.id`).all();
  if (!legacyRecords.length && !definitions.length) return false;
  db.exec(`
    CREATE TABLE object_legacy_types (qualified_name TEXT PRIMARY KEY, type_id TEXT NOT NULL REFERENCES object_types(id)) STRICT;
    CREATE TABLE object_legacy_properties (qualified_type TEXT NOT NULL, field_name TEXT NOT NULL, property_id TEXT NOT NULL REFERENCES object_properties(id), encoding TEXT NOT NULL CHECK(encoding IN ('value', 'json')), PRIMARY KEY(qualified_type, field_name)) STRICT;
    CREATE TABLE object_legacy_aliases (alias TEXT NOT NULL, object_id TEXT NOT NULL COLLATE NOCASE REFERENCES objects(id), PRIMARY KEY(alias, object_id)) STRICT;
  `);
  const types = new Map<string, ImportedType>();
  for (const row of definitions) {
    if (row.definition_json === null) throw new Error(`Cannot migrate ${row.id}: current app definition is missing.`);
    const definition = parse(row.definition_json, row.id);
    if (!record(definition) || definition.id !== row.id || !record(definition.types)) throw new Error(`Cannot migrate ${row.id}: malformed app definition.`);
    for (const [name, candidate] of Object.entries(definition.types)) {
      const qualified = `${row.id}.${name}`;
      if (!record(candidate) || !record(candidate.fields)) throw new Error(`Cannot migrate ${qualified}: malformed type definition.`);
      const fields: Record<string, LegacyField> = Object.create(null);
      for (const [fieldName, field] of Object.entries(candidate.fields)) {
        if (!record(field) || typeof field.type !== 'string') throw new Error(`Cannot migrate ${qualified}.${fieldName}: malformed property definition.`);
        if (!Object.hasOwn(SIMPLE_KINDS, field.type) && field.type !== 'enum' && field.type !== 'reference') throw new Error(`Cannot migrate ${qualified}.${fieldName}: unsupported property kind.`);
        if (field.type === 'enum' && (!Array.isArray(field.values) || !field.values.length || field.values.length > 100 || field.values.some(value => typeof value !== 'string' || !value) || new Set(field.values).size !== field.values.length)) throw new Error(`Cannot migrate ${qualified}.${fieldName}: invalid enum options.`);
        if (field.type === 'reference' && typeof field.target !== 'string') throw new Error(`Cannot migrate ${qualified}.${fieldName}: missing reference target type.`);
        fields[fieldName] = field as unknown as LegacyField;
      }
      types.set(qualified, { id: randomUUID(), qualified, fields, properties: new Map() });
    }
  }
  if (legacyRecords.some(row => row.kind === 'note')) types.set('$page', { id: PAGE_TYPE_ID, qualified: '$page', fields: {}, properties: new Map() });
  const insertType = db.query('INSERT INTO object_types(id, name, property_ids_json, revision) VALUES (?, CAST(? AS TEXT), ?, 1)');
  const insertTypeAlias = db.query('INSERT INTO object_legacy_types(qualified_name, type_id) VALUES (?, ?)');
  for (const type of types.values()) {
    insertType.run(type.id, Buffer.from(type.qualified === '$page' ? 'Page' : type.qualified), '[]');
    insertTypeAlias.run(type.qualified, type.id);
  }
  // Allocate every type before resolving reference targets, including forward and
  // cyclic definitions. Qualified property identity is not inferred from labels.
  for (const type of types.values()) {
    for (const [name, field] of Object.entries(type.fields)) {
      const definition: PropertyDefinition = { id: randomUUID(), label: name, kind: field.type === 'enum' ? 'select' : field.type as PropertyKind, revision: 1 };
      if (field.type === 'enum') definition.options = field.values!.map(label => ({ id: randomUUID(), label }));
      if (field.type === 'reference') {
        const target = types.get(field.target!);
        if (!target) throw new Error(`Cannot migrate ${type.qualified}.${name}: target type ${field.target} is missing.`);
        definition.targetTypeId = target.id;
        definition.multiple = false;
      }
      type.properties.set(name, { definition, encoding: 'value' });
    }
  }
  const prepared: { row: LegacyRecord; type: ImportedType; fields: Record<string, unknown> }[] = [];
  const unknown = new Map<ImportedType, Map<string, unknown[]>>();
  const identities = new Map<string, { id: string; typeId: string }>();
  for (const row of legacyRecords) {
    if (!ID.test(row.id) || identities.has(row.id.toLowerCase())) throw new Error(`Cannot migrate ${row.path}: object identity is invalid or ambiguous.`);
    if (row.kind !== 'note' && row.kind !== 'record') throw new Error(`Cannot migrate ${row.path}: unsupported object kind.`);
    const type = types.get(row.kind === 'note' ? '$page' : row.type ?? '');
    if (!type) throw new Error(`Cannot migrate ${row.path}: object type ${row.type} is missing.`);
    const fields = parse(row.fields_json, row.path);
    if (!record(fields) || Object.keys(fields).length > 256) throw new Error(`Cannot migrate ${row.path}: unsupported metadata structure.`);
    prepared.push({ row, type, fields });
    identities.set(row.id.toLowerCase(), { id: row.id, typeId: type.id });
    for (const [name, value] of Object.entries(fields)) {
      if (type.properties.has(name)) continue;
      let byName = unknown.get(type);
      if (!byName) { byName = new Map(); unknown.set(type, byName); }
      const values = byName.get(name) ?? [];
      values.push(value);
      byName.set(name, values);
    }
  }
  for (const [type, fields] of unknown) {
    for (const [name, values] of fields) {
      let kind: PropertyKind = 'text';
      let encoding: ImportedProperty['encoding'] = 'value';
      if (values.every(value => typeof value === 'string')) kind = 'text';
      else if (values.every(value => typeof value === 'number')) kind = 'number';
      else if (values.every(value => typeof value === 'boolean')) kind = 'boolean';
      else if (values.every(value => !valueError({ type: 'date-range' }, value))) kind = 'date-range';
      else if (values.every(value => !valueError({ type: 'time-range' }, value))) kind = 'time-range';
      else encoding = 'json';
      // JSON-only metadata has no native property kind. Preserve it reversibly as
      // text, with explicit encoding in the migration map; never stringify lossily.
      type.properties.set(name, { definition: { id: randomUUID(), label: name, kind, revision: 1 }, encoding });
    }
  }
  const insertProperty = db.query('INSERT INTO object_properties(id, label, kind, options_json, target_type_id, multiple, revision) VALUES (?, CAST(? AS TEXT), ?, ?, ?, ?, 1)');
  const insertPropertyAlias = db.query('INSERT INTO object_legacy_properties(qualified_type, field_name, property_id, encoding) VALUES (?, ?, ?, ?)');
  for (const type of types.values()) {
    for (const [name, { definition, encoding }] of type.properties) {
      insertProperty.run(definition.id, Buffer.from(definition.label), definition.kind, definition.options ? JSON.stringify(definition.options) : null, definition.targetTypeId ?? null, definition.multiple ? 1 : 0);
      insertPropertyAlias.run(type.qualified, name, definition.id, encoding);
    }
    db.query('UPDATE object_types SET property_ids_json = ? WHERE id = ?').run(JSON.stringify([...type.properties.values()].map(property => property.definition.id)), type.id);
  }
  const aliases = new Map<string, Set<string>>();
  const addAlias = (alias: string, id: string): void => {
    const key = alias.trim().toLowerCase();
    if (!key) return;
    const matches = aliases.get(key) ?? new Set<string>();
    matches.add(id);
    aliases.set(key, matches);
  };
  for (const { row, fields } of prepared) {
    for (const alias of [row.id, row.path, row.path.replace(/\.md$/i, ''), basename(row.path), basename(row.path, extname(row.path)), row.title]) addAlias(alias, row.id);
    const metadataAliases = fields.aliases;
    if (typeof metadataAliases === 'string') addAlias(metadataAliases, row.id);
    else if (Array.isArray(metadataAliases)) for (const alias of metadataAliases) if (typeof alias === 'string') addAlias(alias, row.id);
  }
  const resolve = (target: string, path: string): string | undefined => {
    const name = target.split('#', 1)[0]!.trim();
    if (!name) return undefined;
    // Relative paths outrank global basename/title aliases; ambiguity never picks
    // an arbitrary winner, so an unresolved link remains readable prose.
    const relative = normalize(join(dirname(path), name)).toLowerCase();
    for (const key of [relative, name.replace(/^\//, '').toLowerCase()]) {
      const matches = aliases.get(key);
      if (matches?.size === 1) return [...matches][0];
      if (matches && matches.size > 1) return undefined;
    }
    return undefined;
  };
  const objects: ObjectRecord[] = [];
  const now = new Date().toISOString();
  const insertObject = db.query(`INSERT INTO objects(id, type_id, title, properties_json, document_json, revision, created_at, updated_at, trashed, document_text) VALUES (?, ?, CAST(? AS TEXT), ?, ?, 1, ?, ?, 0, CAST(? AS TEXT))`);
  for (const { row, type, fields } of prepared) {
    const properties: Record<string, PropertyValue> = {};
    for (const [name, value] of Object.entries(fields)) {
      const { definition, encoding } = type.properties.get(name)!;
      let normalized: PropertyValue;
      if (encoding === 'json') normalized = JSON.stringify(value);
      else if (definition.kind === 'select') {
        const option = definition.options!.find(option => option.label === value);
        if (!option) throw new Error(`Cannot migrate ${row.path}.${name}: enum value is not declared.`);
        normalized = option.id;
      } else if (definition.kind === 'reference') {
        const target = typeof value === 'string' ? identities.get(value.toLowerCase()) : undefined;
        if (!target || target.typeId !== definition.targetTypeId) throw new Error(`Cannot migrate ${row.path}.${name}: reference is missing or has the wrong type.`);
        normalized = target.id;
      } else {
        const error = valueError({ type: definition.kind }, value);
        if (error) throw new Error(`Cannot migrate ${row.path}.${name}: ${error}`);
        normalized = value as PropertyValue;
      }
      properties[definition.id] = normalized;
    }
    let document = documentFromMarkdown(row.body);
    const linkWikiReferences = (node: DocumentNode): void => {
      if (node.type === 'code_block' || !node.content) return;
      const content: DocumentNode[] = [];
      for (const child of node.content) {
        if (child.type !== 'text' || child.marks?.some(mark => mark.type === 'code' || mark.type === 'link')) {
          linkWikiReferences(child);
          content.push(child);
          continue;
        }
        const text = child.text ?? '';
        let offset = 0;
        for (const match of text.matchAll(/\[\[([^\]\n]+)\]\]/g)) {
          const separator = match[1]!.indexOf('|');
          const target = separator < 0 ? match[1]! : match[1]!.slice(0, separator);
          const targetId = resolve(target, row.path);
          const label = separator < 0 ? target : match[1]!.slice(separator + 1);
          if (!targetId || label.length > 500) continue;
          if (match.index! > offset) content.push({ ...child, text: text.slice(offset, match.index) });
          content.push({ type: 'object_link', attrs: { objectId: targetId.toLowerCase(), label }, ...(child.marks ? { marks: child.marks } : {}) });
          offset = match.index! + match[0].length;
        }
        if (offset < text.length) content.push({ ...child, text: text.slice(offset) });
      }
      node.content = content;
    };
    linkWikiReferences(document);
    document = validateDocument(document);
    const object: ObjectRecord = { id: row.id, typeId: type.id, title: row.title, properties, document, revision: 1, createdAt: now, updatedAt: now, trashed: false };
    insertObject.run(object.id, object.typeId, Buffer.from(object.title), JSON.stringify(properties), JSON.stringify(document), now, now, Buffer.from(documentText(document)));
    objects.push(object);
  }
  const insertReference = db.query('INSERT OR IGNORE INTO object_references(source_id, target_id, property_id, block_id) VALUES (?, ?, ?, ?)');
  const propertiesById = new Map([...types.values()].flatMap(type => [...type.properties.values()].map(property => [property.definition.id, property.definition] as const)));
  for (const object of objects) {
    for (const [propertyId, value] of Object.entries(object.properties)) {
      if (propertiesById.get(propertyId)!.kind === 'reference') insertReference.run(object.id, String(value), propertyId, '');
    }
    for (const reference of documentReferences(object.document)) insertReference.run(object.id, reference.targetId, '', reference.blockId);
  }
  const insertAlias = db.query('INSERT INTO object_legacy_aliases(alias, object_id) VALUES (CAST(? AS TEXT), ?)');
  for (const [alias, ids] of aliases) for (const id of ids) insertAlias.run(Buffer.from(alias), id);
  db.query("INSERT INTO object_metadata(key, value) VALUES ('vault_migrated', '1')").run();
  return true;
}
