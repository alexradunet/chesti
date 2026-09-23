import { diagnostic, type Diagnostic, type MarkdownFile } from './markdown.js';
import type { DocumentType } from './schema.js';
import { own, RESERVED_FIELDS, UUID, valueError } from './values.js';

export interface VaultDocument { file: MarkdownFile; kind: 'note' | 'record'; type?: DocumentType; diagnostics: Diagnostic[] }
export function validateRecord(file: MarkdownFile, types: ReadonlyMap<string, DocumentType>): VaultDocument {
  const diagnostics = [...file.diagnostics];
  const record: VaultDocument = { file, kind: 'note', diagnostics };
  if (diagnostics.some(d => d.severity === 'error')) return record;
  const data = file.frontmatter;
  const report = (code: string, message: string, field: string, severity: Diagnostic['severity'] = 'error') => diagnostics.push(diagnostic(file, code, message, [field], severity));
  if (!Object.hasOwn(data, 'type')) {
    if (Object.hasOwn(data, 'id') || Object.hasOwn(data, 'schema')) report('RECORD_ENVELOPE', 'Managed id/schema metadata requires a namespaced type.', 'type');
    return record;
  }
  record.kind = 'record';
  if (typeof data.id !== 'string' || !UUID.test(data.id)) report('RECORD_ID', 'Managed documents need a UUID id.', 'id');
  const type = typeof data.type === 'string' ? types.get(data.type) : undefined;
  if (!type) { report('RECORD_TYPE', 'This document type has no valid candidate definition in the vault.', 'type'); return record; }
  record.type = type;
  if (data.schema !== type.version) report('RECORD_SCHEMA_VERSION', `Expected schema ${type.version}; migrations must be explicit.`, 'schema');
  for (const [name, field] of Object.entries(type.fields)) {
    if (!Object.hasOwn(data, name)) {
      if (field.required) report('FIELD_REQUIRED', 'Required field is missing. Defaults are not silently applied to existing files.', name);
    } else {
      const error = valueError(field, data[name]);
      if (error) report('FIELD_VALUE', error, name);
    }
  }
  for (const name of Object.keys(data)) {
    if (['id', 'type', 'schema'].includes(name) || own(type.fields, name)) continue;
    if (RESERVED_FIELDS.has(name)) report('FIELD_RESERVED', `${name} is computed by the runtime, not a frontmatter field.`, name);
    else report('FIELD_UNKNOWN', 'Undeclared metadata is preserved but has no app behavior. Check for a misspelled field name.', name, 'warning');
  }
  for (const rule of type.rules ?? []) {
    if (rule.fields.filter(name => Object.hasOwn(data, name)).length !== 1) report('FIELD_EXACTLY_ONE', `Supply exactly one of: ${rule.fields.join(', ')}.`, rule.fields[0]!);
  }
  return record;
}
export const hasErrors = (diagnostics: readonly Diagnostic[]) => diagnostics.some(d => d.severity === 'error');

export function validateRecordRelationships(documents: VaultDocument[]) {
  const byId = new Map<string, VaultDocument[]>();
  for (const doc of documents) {
    const id = doc.file.frontmatter.id;
    if (typeof id === 'string' && UUID.test(id)) {
      const group = byId.get(id.toLowerCase()) ?? []; group.push(doc); byId.set(id.toLowerCase(), group);
    }
  }
  const duplicates = (group: VaultDocument[], code: string, message: string, field: string) => {
    for (const doc of group) doc.diagnostics.push({ ...diagnostic(doc.file, code, message, [field]), related: group.filter(d => d !== doc).map(d => d.file.path).sort() });
  };
  for (const group of byId.values()) if (group.length > 1) duplicates(group, 'DUPLICATE_ID', 'Document identity is ambiguous; no file is chosen as the winner.', 'id');
  const unique = new Map<string, { docs: VaultDocument[]; fields: string[] }>();
  for (const doc of documents) {
    if (!doc.type || hasErrors(doc.diagnostics)) continue;
    for (const fields of doc.type.uniqueBy ?? []) {
      const values = fields.map(name => {
        const value = doc.file.frontmatter[name];
        if (doc.type!.fields[name]!.type === 'reference') return String(value).toLowerCase();
        if (doc.type!.fields[name]!.type === 'datetime') return Date.parse(String(value));
        return value;
      });
      const key = JSON.stringify([doc.file.frontmatter.type, fields, values]);
      const group = unique.get(key) ?? { docs: [], fields }; group.docs.push(doc); unique.set(key, group);
    }
  }
  for (const { docs, fields } of unique.values()) if (docs.length > 1) duplicates(docs, 'DUPLICATE_UNIQUE', `Duplicate unique key: ${fields.join(', ')}.`, fields[0]!);
  // Propagate invalid-target status until stable, including chains of references.
  const reported = new Set<string>();
  let changed = true;
  while (changed) {
    changed = false;
    for (const doc of documents) for (const [name, field] of Object.entries(doc.type?.fields ?? {})) {
      if (field.type !== 'reference' || !('target' in field)) continue;
      const value = doc.file.frontmatter[name];
      if (typeof value !== 'string' || !UUID.test(value)) continue;
      const key = `${doc.file.path}:${name}`;
      if (reported.has(key)) continue;
      const targets = byId.get(value.toLowerCase()) ?? [];
      let code: string | undefined;
      if (targets.length === 0) code = 'REFERENCE_MISSING';
      else if (targets.length > 1) code = 'REFERENCE_AMBIGUOUS';
      else if (targets[0]!.file.frontmatter.type !== field.target) code = 'REFERENCE_TYPE';
      else if (hasErrors(targets[0]!.diagnostics)) code = 'REFERENCE_INVALID';
      if (code) {
        doc.diagnostics.push({ ...diagnostic(doc.file, code, `Reference must resolve to one valid ${field.target} document.`, [name]), related: targets.map(d => d.file.path).sort() });
        reported.add(key); changed = true;
      }
    }
  }
}
