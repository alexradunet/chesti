import { basename, dirname, normalize } from 'node:path/posix';
import { AppError, type Action, type Field, type Link, type Resolve, type Resource } from '../core.js';
import type { AppCandidate } from './definition.js';
import { isObject } from './markdown.js';
import { hasErrors, type VaultDocument } from './records.js';
import type { VaultRuntime, VaultMutation } from './runtime.js';
import type { DocumentType, FieldDefinition, Predicate } from './schema.js';
import { builtinFields, own, UUID, validDate, valueError } from './values.js';

export function localDate(offset = 0): string {
  const date = new Date();
  date.setDate(date.getDate() + offset);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
const label = (name: string) => name.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, c => c.toUpperCase());
const stringValue = (value: unknown): string => value === undefined ? '' : typeof value === 'string' ? value : JSON.stringify(value);
const hrefFor = (doc: VaultDocument) => doc.kind === 'record' ? `/vault/records/${doc.file.frontmatter.id}` : `/vault/notes?path=${encodeURIComponent(doc.file.path)}`;
const nav: Link[] = [
  { rel: 'home', href: '/vault', title: 'Apps' }, { rel: 'today', href: '/vault/today', title: 'Today' },
  { rel: 'collection', href: '/vault/tasks', title: 'Tasks' }, { rel: 'collection', href: '/vault/calendar', title: 'Calendar' },
  { rel: 'collection', href: '/vault/journal', title: 'Journal' }, { rel: 'collection', href: '/vault/para', title: 'PARA' },
];
function fieldValue(doc: VaultDocument, name: string): unknown {
  return name === 'title' ? doc.file.title : name === 'body' ? doc.file.body : doc.file.frontmatter[name];
}
function comparable(value: unknown, field?: FieldDefinition): unknown {
  if (typeof value !== 'string') return value;
  return field?.type === 'datetime' || field?.type === 'time-range' ? Date.parse(value) : field?.type === 'reference' ? value.toLowerCase() : value;
}
function matches(doc: VaultDocument, predicate?: Predicate): boolean {
  if (!predicate) return true;
  const field = own(doc.type?.fields ?? {}, predicate.field) ?? own(builtinFields, predicate.field);
  const value = comparable(fieldValue(doc, predicate.field), field);
  return ('equals' in predicate ? [predicate.equals] : predicate.in).some(expected => comparable(expected, field) === value);
}
function formField(name: string, definition: FieldDefinition, value: unknown, documents: VaultDocument[], creating: boolean): Field {
  const input: Field['input'] = name === 'body' ? 'textarea' : definition.type === 'date' ? 'date' : definition.type === 'number' ? 'number' : definition.type === 'boolean' ? 'checkbox' : ['date-range', 'time-range'].includes(definition.type) ? 'json' : 'text';
  const options = definition.type === 'enum' && 'values' in definition ? definition.values.map(value => ({ value, label: value }))
    : definition.type === 'reference' && 'target' in definition ? documents.filter(doc => doc.file.frontmatter.type === definition.target).map(doc => ({ value: String(doc.file.frontmatter.id), label: doc.file.title })) : [];
  if (options.length && !definition.required) options.unshift({ value: '', label: 'None' });
  return { name, label: name === 'body' ? 'Content' : `${label(name)}${definition.type === 'datetime' ? ' (ISO date-time with timezone)' : definition.type === 'reference' && !options.length ? ' (record UUID)' : ''}`, value: stringValue(value), options, input, valueType: definition.type, required: name === 'title' ? creating : Boolean(definition.required) };
}

/** Every resolution is a fresh approved snapshot, never the unreviewed reader output. */
export function vaultResolver(runtime: VaultRuntime): Resolve {
  return href => {
    const url = new URL(href, 'http://vault.local');
    if (url.origin !== 'http://vault.local' || !url.pathname.startsWith('/vault')) throw new AppError(404, 'App resource not found.');
    const path = url.pathname;
    const snapshot = runtime.snapshot();
    const reviews = new Map(runtime.reviews().filter(review => review.status === 'active').map(review => [review.id, review]));
    const apps = snapshot.apps.filter(app => app.definition && reviews.get(app.definition.id)?.revision === app.file.revision);
    const documents = snapshot.documents.filter(doc => !hasErrors(doc.diagnostics) && (doc.kind === 'note' ? reviews.get('wiki')?.granted.includes('notes:read') : reviews.get(String(doc.file.frontmatter.type).split('.')[0]!)?.granted.includes(`read:${doc.file.frontmatter.type}`)));
    const allowed = (app: string, permission: string) => reviews.get(app)?.granted.includes(permission) ?? false;
    const appFor = (qualified: string) => apps.find(app => app.definition?.id === qualified.split('.')[0]);
    const wikiLinks = (doc: VaultDocument): Link[] => doc.file.links.flatMap(link => {
      const target = link.target.split('#')[0]!.trim();
      if (!target || /^[a-z]+:/i.test(target) || target.startsWith('/') || /[\\\u0000-\u001f\u007f]/.test(target)) return [];
      const candidate = normalize(target.startsWith('.') ? `${dirname(doc.file.path)}/${target}` : target);
      if (candidate.split('/').some(part => part.startsWith('.'))) return [];
      let found = documents.filter(other => other.file.path === candidate || other.file.path.replace(/\.md$/i, '') === candidate);
      if (!found.length && !target.includes('/')) found = documents.filter(other => basename(other.file.path) === target || basename(other.file.path).replace(/\.md$/i, '') === target);
      return found.length === 1 ? [{ rel: 'wiki', href: hrefFor(found[0]!), title: link.target }] : [];
    });
    const actionResources = (app: AppCandidate, typeName: string, type: DocumentType, doc?: VaultDocument): Action[] => {
      const qualified = `${app.definition!.id}.${typeName}`;
      return Object.entries(type.actions).flatMap(([id, action]) => {
        const creating = action.operation === 'record.create';
        if (creating === Boolean(doc) || !allowed(app.definition!.id, `${creating ? 'create' : 'update'}:${qualified}`) || (!creating && !matches(doc!, action.when))) return [];
        const names = creating ? ['title', 'body', ...Object.keys(type.fields)] : action.fields ?? [];
        return [{ id, title: action.label ?? `${label(id)} ${typeName}`, href: '/vault/act', method: 'post' as const,
          requiresConfirmation: action.requiresConfirmation,
          fields: names.map(name => {
            const field = own(type.fields, name) ?? own(builtinFields, name)!;
            return formField(name, field, doc ? fieldValue(doc, name) : field.default, documents, creating);
          }),
        }];
      });
    };
    const record = (doc: VaultDocument): Resource => {
      const qualified = String(doc.file.frontmatter.type ?? 'note');
      const app = appFor(qualified);
      const typeName = qualified.split('.')[1]!;
      const facts: Record<string, string> = { ID: String(doc.file.frontmatter.id ?? doc.file.path), Type: qualified, Path: doc.file.path, Revision: doc.file.revision };
      if (app) facts.DefinitionRevision = app.file.revision;
      for (const [name] of Object.entries(doc.type?.fields ?? {})) if (Object.hasOwn(doc.file.frontmatter, name)) facts[name] = stringValue(doc.file.frontmatter[name]);
      return { href: hrefFor(doc), kind: 'record', title: doc.file.title, description: doc.kind === 'note' ? 'Note · read only' : `${app?.definition?.name ?? qualified} · saved record`,
        facts, body: doc.file.body, version: doc.file.revision,
        links: [...nav, ...(app ? [{ rel: 'type', href: `/vault/types/${qualified}`, title: `New ${typeName}` }] : []), ...wikiLinks(doc)],
        actions: app && doc.type ? actionResources(app, typeName, doc.type, doc) : [] };
    };
    const typeResource = (app: AppCandidate, name: string): Resource => {
      const qualified = `${app.definition!.id}.${name}`;
      const type = app.definition!.types[name]!;
      return { href: `/vault/types/${qualified}`, kind: 'record', title: `New ${name}`, description: `Create a ${qualified} record in SQLite. Only explicitly approved actions are available.`,
        facts: { Type: qualified, Revision: app.file.revision, DefinitionRevision: app.file.revision, Folder: type.storage.defaultFolder, ...(type.rules ? { Rules: type.rules.map(rule => `Exactly one of: ${rule.fields.join(', ')}`).join('; ') } : {}) },
        version: app.file.revision, links: nav, actions: actionResources(app, name, type) };
    };
    const typeLinks = (subset = apps): Link[] => subset.flatMap(app => Object.keys(app.definition!.types).filter(name => allowed(app.definition!.id, `create:${app.definition!.id}.${name}`)).map(name => ({ rel: 'create', href: `/vault/types/${app.definition!.id}.${name}`, title: `New ${name}` })));
    const collection = (resourceHref: string, title: string, description: string, docs: VaultDocument[], links: Link[] = []): Resource => ({ href: resourceHref, kind: 'collection', title, description, facts: { Count: String(docs.length) }, items: docs.map(record), links: [...nav, ...links], actions: [] });
    const query = (app: AppCandidate, name: string): VaultDocument[] => {
      const definition = app.definition!.collections[name]!;
      const result = documents.filter(doc => doc.file.frontmatter.type === `${app.definition!.id}.${definition.type}` && matches(doc, definition.where));
      return result.sort((a, b) => {
        for (const order of definition.orderBy ?? []) {
          const field = a.type?.fields[order.field] ?? builtinFields[order.field];
          let av = fieldValue(a, order.field), bv = fieldValue(b, order.field);
          if (av === undefined || bv === undefined) {
            if (av === bv) continue;
            return (av === undefined ? -1 : 1) * (order.missing === 'first' ? 1 : -1);
          }
          if (isObject(av)) av = av.start;
          if (isObject(bv)) bv = bv.start;
          av = comparable(av, field); bv = comparable(bv, field);
          const comparison = typeof av === 'number' && typeof bv === 'number' ? av - bv : String(av).localeCompare(String(bv));
          if (comparison) return comparison * (order.direction === 'descending' ? -1 : 1);
        }
        return a.file.path.localeCompare(b.file.path);
      });
    };
    const appCollection = (id: string, title: string): Resource => {
      const app = apps.find(app => app.definition!.id === id);
      const names = app ? id === 'tasks' && own(app.definition!.collections, 'unfinished') ? ['unfinished'] : Object.keys(app.definition!.collections) : [];
      const docs = [...new Map(names.flatMap(name => query(app!, name)).map(doc => [doc.file.path, doc])).values()];
      return collection(href, title, app?.definition?.description ?? 'No approved readable app is available. Review app permissions to get started.', docs, typeLinks(app ? [app] : []));
    };
    const calendar = (date?: string, selectedView?: { app: string; name: string }): Resource => {
      const projected = new Map<string, Resource>();
      for (const app of apps) for (const [name, view] of Object.entries(app.definition!.views)) {
        if (view.presentation !== 'calendar' || (selectedView && (selectedView.app !== app.definition!.id || selectedView.name !== name))) continue;
        for (const doc of query(app, view.collection)) {
          const field = doc.type?.fields[view.mapping.date];
          const value = fieldValue(doc, view.mapping.date);
          if (!field || value === undefined) continue;
          const range = isObject(value) ? value : undefined;
          const start = String(range?.start ?? value);
          const end = String(range?.end ?? start);
          const timed = field.type === 'datetime' || field.type === 'time-range';
          const dateOf = (value: string) => {
            if (!timed) return value;
            const instant = new Date(value);
            return `${instant.getFullYear()}-${String(instant.getMonth() + 1).padStart(2, '0')}-${String(instant.getDate()).padStart(2, '0')}`;
          };
          const startDate = dateOf(start), endDate = dateOf(end);
          const day = date ?? localDate();
          const dayStart = new Date(`${day}T00:00:00`);
          const dayEnd = new Date(dayStart); dayEnd.setDate(dayEnd.getDate() + 1);
          const overlaps = timed ? (range ? Date.parse(start) < +dayEnd && Date.parse(end) > +dayStart : Date.parse(start) >= +dayStart && Date.parse(start) < +dayEnd)
            : startDate <= day && (range ? endDate > day : endDate === day);
          if (!selectedView && (date ? !overlaps : (range ? timed ? Date.parse(end) <= +dayStart : endDate <= day : startDate < day))) continue;
          const resource = record(doc);
          resource.title = String(fieldValue(doc, view.mapping.label) ?? doc.file.title);
          resource.facts['Calendar date'] = startDate;
          resource.facts['Calendar field'] = view.mapping.date;
          resource.facts['Calendar value'] = stringValue(value);
          resource.facts['Calendar sort'] = timed ? start : `${start}T00:00:00`;
          if (range) resource.facts['Calendar end'] = endDate;
          if (timed) resource.facts.Time = new Date(start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + (range ? `–${new Date(end).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : '');
          projected.set(`${resource.href}:${view.mapping.date}`, resource);
        }
      }
      const items = [...projected.values()].sort((a, b) => Date.parse(a.facts['Calendar sort']!) - Date.parse(b.facts['Calendar sort']!) || a.title.localeCompare(b.title));
      const adjacent = [-1, 1].map(offset => {
        const next = new Date(`${date ?? localDate()}T12:00:00`); next.setDate(next.getDate() + offset);
        const day = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}-${String(next.getDate()).padStart(2, '0')}`;
        return { rel: 'day', href: `/vault/calendar?date=${day}`, title: `${offset < 0 ? '←' : '→'} ${day}` };
      });
      return { href, kind: 'collection', title: date ? `Calendar · ${date}` : 'Upcoming calendar', description: 'Events, deadlines, and scheduled work from your saved records. Times use the server’s local timezone.', facts: { Date: date ?? localDate(), Count: String(items.length), Presentation: 'calendar' }, items, actions: [], links: [...nav, ...adjacent, ...typeLinks(apps.filter(app => app.definition!.id === 'calendar'))] };
    };
    if (path === '/vault') {
      const links = apps.flatMap(app => [
        ...Object.keys(app.definition!.collections).map(name => ({ rel: 'collection', href: `/vault/collections/${app.definition!.id}/${name}`, title: `${app.definition!.name} · ${label(name)}` })),
        ...Object.keys(app.definition!.types).map(name => ({ rel: 'type', href: `/vault/types/${app.definition!.id}.${name}`, title: `${app.definition!.name} · ${name}` })),
        ...Object.keys(app.definition!.views).map(name => ({ rel: 'view', href: `/vault/views/${app.definition!.id}/${name}`, title: `${app.definition!.name} · ${label(name)}` })),
      ]);
      const resource = collection('/vault', 'Your apps', 'Approved app definitions and readable records from your SQLite database. App review is a separate browser-only screen.', documents, links);
      resource.facts.Errors = String(snapshot.report.counts.errors);
      resource.facts.Warnings = String(snapshot.report.counts.warnings);
      resource.facts.Diagnostics = snapshot.report.diagnostics.map(issue => `${issue.severity} · ${issue.code} · ${issue.file}:${issue.line}:${issue.column} — ${issue.message}`).join('\n');
      return resource;
    }
    if (path === '/vault/today') return { ...calendar(localDate()), title: 'Today', description: `Scheduled records for ${localDate()}, in your local timezone.` };
    if (path === '/vault/calendar') {
      const date = url.searchParams.get('date') ?? undefined;
      if (date && !validDate(date)) throw new AppError(422, 'Choose a real calendar date.');
      return calendar(date);
    }
    if (path === '/vault/tasks') return appCollection('tasks', 'Unfinished tasks');
    if (path === '/vault/journal') return appCollection('journal', 'Daily journal');
    if (path === '/vault/para') return collection(href, 'PARA', 'Projects, Areas, Resources, and Archives group your saved records by their organizational aliases. Only approved readable records appear.', documents.filter(doc => /^(Projects|Areas|Resources|Archives)\//.test(doc.file.path)), typeLinks(apps.filter(app => app.definition!.id === 'wiki')));
    const match = /^\/vault\/(collections|views)\/([a-z][a-z0-9-]*)\/([a-z][a-zA-Z0-9_]*)$/.exec(path);
    if (match) {
      const app = apps.find(app => app.definition!.id === match[2]);
      const view = match[1] === 'views' && app ? own(app.definition!.views, match[3]!) : undefined;
      const name = view ? view.collection : match[3]!;
      if (!app || (match[1] === 'views' && !view) || !own(app.definition!.collections, name)) throw new AppError(404, 'Approved collection not found.');
      const result = view?.presentation === 'calendar' ? calendar(undefined, { app: app.definition!.id, name: match[3]! }) : collection(href, `${app.definition!.name} · ${label(match[3]!)}`, app.definition!.description ?? '', query(app, name), typeLinks([app]));
      result.title = `${app.definition!.name} · ${label(match[3]!)}`;
      if (view) result.facts.Presentation = view.presentation;
      return result;
    }
    if (path.startsWith('/vault/types/')) {
      const qualified = path.slice('/vault/types/'.length);
      const app = appFor(qualified), name = qualified.split('.')[1];
      if (!app || !name || !own(app.definition!.types, name)) throw new AppError(404, 'Approved document type not found.');
      return typeResource(app, name);
    }
    const doc = documents.find(doc => path.startsWith('/vault/records/') ? doc.kind === 'record' && String(doc.file.frontmatter.id).toLowerCase() === path.slice('/vault/records/'.length).toLowerCase() : path === '/vault/notes' && doc.kind === 'note' && doc.file.path === url.searchParams.get('path'));
    if (doc) return record(doc);
    throw new AppError(404, 'Approved readable app resource not found.');
  };
}

/** Convert only advertised fields; the runtime independently checks schema and permissions. */
export function mutationFor(resource: Resource, actionId: string, fields: Record<string, string>, id: string): VaultMutation {
  const action = resource.actions.find(action => action.id === actionId && action.href === '/vault/act');
  if (!action) throw new AppError(409, 'This app action is no longer available.');
  const qualified = resource.facts.Type;
  const parts = qualified?.split('.');
  if (!parts || parts.length !== 2 || !parts[0] || !parts[1] || resource.version === undefined) throw new AppError(422, 'This is not an actionable app resource.');
  const updating = resource.href.startsWith('/vault/records/');
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(fields)) if (!action.fields.some(field => field.name === key)) throw new AppError(422, `Unexpected action field: ${key}.`);
  for (const field of action.fields) {
    if (!Object.hasOwn(fields, field.name)) continue;
    const value = fields[field.name]!;
    if (value === '' && !field.required && !['title', 'body'].includes(field.name)) { if (updating) result[field.name] = null; continue; }
    let converted: unknown = value;
    if (field.valueType === 'boolean') {
      if (!['true', 'false'].includes(value)) throw new AppError(422, `${field.label} must be true or false.`);
      converted = value === 'true';
    } else if (field.valueType === 'number') {
      if (!value.trim()) throw new AppError(422, `${field.label} needs a number.`);
      converted = Number(value);
    } else if (field.valueType === 'date-range' || field.valueType === 'time-range') {
      try { converted = JSON.parse(value); } catch { throw new AppError(422, `${field.label} needs a valid JSON range.`); }
    }
    const schema = { type: field.valueType ?? 'text', ...(field.options.length && field.valueType === 'enum' ? { values: field.options.map(option => option.value) } : {}) } as FieldDefinition;
    const error = valueError(schema, converted);
    if (error) throw new AppError(422, `${field.label}: ${error}`);
    result[field.name] = converted;
  }
  const record = updating ? resource.href.slice('/vault/records/'.length) : undefined;
  if (record && !UUID.test(record)) throw new AppError(422, 'Invalid record identity.');
  return { id, app: parts[0], type: parts[1], action: actionId, ...(record ? { record } : {}), revision: String(resource.version), definitionRevision: resource.facts.DefinitionRevision, fields: result };
}
