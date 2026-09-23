import { Value } from 'typebox/value';
import { AppDefinitionSchema, type AppDefinition, type DocumentType, type FieldDefinition, type Predicate } from './schema.js';
import { diagnostic, type Diagnostic, type MarkdownFile } from './markdown.js';
import { builtinFields, own, RESERVED_FIELDS, safeFolder, TEMPORAL_FIELDS, valueError } from './values.js';

export interface AppCandidate { file: MarkdownFile; definition?: AppDefinition; diagnostics: Diagnostic[] }
/** Valid means structurally/semantically eligible for review, NEVER installed or granted authority. */
export function validateDefinition(file: MarkdownFile): AppCandidate {
  const diagnostics = [...file.diagnostics];
  const result: AppCandidate = { file, diagnostics };
  if (diagnostics.some(d => d.severity === 'error')) return result;
  if (!file.hasFrontmatter) { diagnostics.push(diagnostic(file, 'APP_FRONTMATTER', 'An app definition requires YAML frontmatter.')); return result; }
  if (!Value.Check(AppDefinitionSchema, file.frontmatter)) {
    for (const error of Value.Errors(AppDefinitionSchema, file.frontmatter).slice(0, 40)) {
      const path = error.instancePath.split('/').slice(1).map(p => p.replace(/~1/g, '/').replace(/~0/g, '~'));
      diagnostics.push(diagnostic(file, 'APP_SCHEMA', error.message, path));
    }
    return result;
  }
  const app = file.frontmatter as AppDefinition;
  result.definition = app;
  const report = (code: string, message: string, path: (string | number)[]) => diagnostics.push(diagnostic(file, code, message, path));
  const getField = (type: DocumentType, field: string, path: (string | number)[]): FieldDefinition | undefined => {
    const found = own(type.fields, field) ?? own(builtinFields, field);
    if (!found) report('APP_FIELD_UNKNOWN', `Unknown field: ${field}.`, path);
    return found;
  };
  const checkValue = (field: FieldDefinition, value: unknown, path: (string | number)[]) => {
    const error = valueError(field, value);
    if (error) report('APP_VALUE', error, path);
  };
  const checkPredicate = (type: DocumentType, predicate: Predicate, path: (string | number)[]) => {
    const field = getField(type, predicate.field, [...path, 'field']);
    if (!field) return;
    if (['time-range', 'date-range'].includes(field.type)) { report('APP_PREDICATE', 'Range equality predicates are not supported in v1.', path); return; }
    if ('equals' in predicate) checkValue(field, predicate.equals, [...path, 'equals']);
    else predicate.in.forEach((value, index) => checkValue(field, value, [...path, 'in', index]));
  };
  for (const [name, type] of Object.entries(app.types)) {
    const path = ['types', name];
    if (!safeFolder(type.storage.defaultFolder)) report('APP_PATH', 'Use a relative, visible vault folder: no dot segments, hidden folders, backslashes or absolute paths.', [...path, 'storage', 'defaultFolder']);
    for (const [name, field] of Object.entries(type.fields)) {
      if (RESERVED_FIELDS.has(name)) report('APP_FIELD_RESERVED', `${name} is reserved by the document envelope/runtime.`, [...path, 'fields', name]);
      if (Object.hasOwn(field, 'default')) checkValue(field, field.default, [...path, 'fields', name, 'default']);
    }
    for (const [name, action] of Object.entries(type.actions)) {
      if (action.operation !== 'record.update') continue;
      const at = [...path, 'actions', name];
      if (!action.fields?.length && !Object.keys(action.set ?? {}).length) report('APP_ACTION', 'An update must declare editable fields or fixed values.', at);
      for (const field of action.fields ?? []) {
        getField(type, field, [...at, 'fields']);
        if (Object.hasOwn(action.set ?? {}, field)) report('APP_ACTION', `A field cannot be both editable and fixed: ${field}.`, at);
      }
      for (const [name, value] of Object.entries(action.set ?? {})) {
        const field = getField(type, name, [...at, 'set', name]);
        if (field) checkValue(field, value, [...at, 'set', name]);
      }
      if (action.when) checkPredicate(type, action.when, [...at, 'when']);
    }
    for (const [index, group] of (type.uniqueBy ?? []).entries()) for (const name of group) {
      const field = getField(type, name, [...path, 'uniqueBy', index]);
      if (field && (field.required !== true || ['date-range', 'time-range'].includes(field.type))) report('APP_UNIQUENESS', 'Uniqueness keys must be required, scalar document fields.', [...path, 'uniqueBy', index]);
    }
    for (const [index, rule] of (type.rules ?? []).entries()) for (const name of rule.fields) {
      if (!own(type.fields, name)) report('APP_FIELD_UNKNOWN', `Unknown document field: ${name}.`, [...path, 'rules', index]);
      else if (type.fields[name]!.required) report('APP_RULE', 'Fields in exactlyOne must be optional individually.', [...path, 'rules', index]);
    }
  }
  for (const [name, collection] of Object.entries(app.collections)) {
    const path = ['collections', name];
    const type = own(app.types, collection.type);
    if (!type) { report('APP_TYPE_UNKNOWN', `Unknown local document type: ${collection.type}.`, [...path, 'type']); continue; }
    if (collection.where) checkPredicate(type, collection.where, [...path, 'where']);
    for (const [index, order] of (collection.orderBy ?? []).entries()) {
      const field = getField(type, order.field, [...path, 'orderBy', index, 'field']);
      if (field && ['date-range', 'time-range'].includes(field.type)) report('APP_ORDER', 'Range ordering is not supported in v1.', [...path, 'orderBy', index]);
    }
  }
  for (const [name, view] of Object.entries(app.views)) {
    const path = ['views', name];
    const collection = own(app.collections, view.collection);
    if (!collection) { report('APP_COLLECTION_UNKNOWN', `Unknown collection: ${view.collection}.`, [...path, 'collection']); continue; }
    const type = own(app.types, collection.type);
    if (!type || view.presentation !== 'calendar') continue;
    const date = getField(type, view.mapping.date, [...path, 'mapping', 'date']);
    const label = getField(type, view.mapping.label, [...path, 'mapping', 'label']);
    if (date && !TEMPORAL_FIELDS.has(date.type)) report('APP_CALENDAR', 'A calendar date mapping must refer to a temporal field.', [...path, 'mapping', 'date']);
    if (label && !['text', 'enum'].includes(label.type)) report('APP_CALENDAR', 'A calendar label must refer to text or an enum.', [...path, 'mapping', 'label']);
  }
  return result;
}
