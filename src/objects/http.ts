import { Value } from 'typebox/value';
import { AppError } from '../core.js';
import type { Visitor } from '../visitors.js';
import { validateMarkdown } from './markdown.js';
import { valueError } from './values.js';
import { IdSchema, JOURNAL_DATE_PROPERTY_ID, JOURNAL_TYPE_ID, PAGE_TYPE_ID, TASK_TYPE_ID } from './model.js';
import type { EvaluatedView, ObjectLookupResult, ObjectPageModel, ObjectRecord, ObjectSummary, ObjectWrite, PropertyDefinition, PropertyKind, PropertyValue, SavedView, ViewConversation, ViewGenerator } from './model.js';
import type { ObjectRuntime } from './runtime.js';
import { ViewService } from './views.js';
import { generateView } from './generator.js';
import { ViewConversationService } from './conversations.js';
import { renderObjectWorkspace } from './render.js';

function revision(fields: URLSearchParams, name = 'revision'): number {
  const value = fields.get(name) ?? '';
  if (!/^[1-9][0-9]*$/.test(value) || !Number.isSafeInteger(Number(value))) throw new AppError(422, 'A current revision is required. Reload and try again.');
  return Number(value);
}
function positiveInteger(value: string | null, message: string): number {
  if (!value || !/^[1-9][0-9]*$/.test(value) || !Number.isSafeInteger(Number(value))) throw new AppError(422, message);
  return Number(value);
}
function requireFields(fields: URLSearchParams, allowed: string[], properties = false): void {
  for (const name of fields.keys()) {
    if (!allowed.includes(name) && !(properties && /^(?:draft:)?p:[a-f0-9-]{36}(?::(?:start|end|timeZone))?$/.test(name))) throw new AppError(422, 'Unexpected form field.');
    if ((!properties || !/^(?:draft:)?p:/.test(name)) && fields.getAll(name).length !== 1) throw new AppError(422, 'Repeated form field.');
  }
}
function formValue(property: PropertyDefinition, fields: URLSearchParams, prefix: string): PropertyValue | null {
  const values = fields.getAll(prefix);
  if (property.kind === 'reference' && property.multiple) return values.filter(Boolean).length ? values.filter(Boolean) : null;
  if (values.length > 1) throw new AppError(422, `Repeated value for ${property.label}.`);
  if (property.kind === 'date-range' || property.kind === 'time-range') {
    // JSON is accepted for programmatic/native clients; the normal UI has named range inputs.
    if (values[0]) {
      try { return JSON.parse(values[0]) as PropertyValue; } catch { throw new AppError(422, `Invalid range for ${property.label}.`); }
    }
    const start = fields.get(`${prefix}:start`) ?? '';
    const end = fields.get(`${prefix}:end`) ?? '';
    for (const suffix of ['start', 'end', 'timeZone']) if (fields.getAll(`${prefix}:${suffix}`).length > 1) throw new AppError(422, 'Repeated range field.');
    if (!start && !end) return null;
    return { start, end, ...(property.kind === 'time-range' ? { timeZone: fields.get(`${prefix}:timeZone`) ?? '' } : {}) };
  }
  const value = values[0] ?? '';
  if (property.kind === 'boolean') {
    if (!['', 'false', 'true', 'on'].includes(value)) throw new AppError(422, `Invalid checkbox for ${property.label}.`);
    return value === 'true' || value === 'on';
  }
  if (!value) return null;
  if (property.kind === 'number') {
    if (!value.trim() || !Number.isFinite(Number(value))) throw new AppError(422, `${property.label} must be a finite number.`);
    return Number(value);
  }
  return value;
}

function localDate(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function draftFields(fields: URLSearchParams): Record<string, string[]> {
  const draft: Record<string, string[]> = {};
  for (const name of fields.keys()) if (name.startsWith('draft:p:')) draft[name.slice(6)] = fields.getAll(name);
  for (const name of fields.keys()) if (name.startsWith('p:')) draft[name] = fields.getAll(name);
  return draft;
}
function newPropertyDraft(fields: URLSearchParams) {
  return {
    label: fields.get('label') ?? '',
    kind: fields.get('kind') ?? '',
    options: fields.get('options') ?? '',
    targetTypeId: fields.get('targetTypeId') ?? '',
    multiple: fields.get('multiple') === 'on' || fields.get('multiple') === 'true',
    revision: fields.get('revision') ?? '',
  };
}

/** The native editor, enhanced editor, and generated view forms share the same commands. */
export function createObjectRoutes(objects: ObjectRuntime, generator: ViewGenerator = generateView) {
  const views = new ViewService(objects);
  const conversations = new ViewConversationService(objects.db, views);
  const generating = new Set<string>();
  return async (req: Request, url: URL, visitor: Visitor, fields?: URLSearchParams): Promise<Response | undefined> => {
    if (!(url.pathname === '/' || url.pathname === '/calendar' || url.pathname === '/tasks' || /^\/(?:journal|types|objects|properties|views)(?:\/|$)/.test(url.pathname))) return;
    const conversationRoute = url.pathname.startsWith('/views/conversations/');
    const lookupRoute = url.pathname === '/objects/lookup';
    const json = lookupRoute || conversationRoute || (url.pathname === '/views/generate' && req.headers.get('accept')?.includes('application/json'));
    const catalog = objects.catalog();
    const model: ObjectPageModel = {
      csrf: visitor.csrf, path: url.pathname, screen: 'objects', catalog, views: views.list(), objects: [],
      aiOpen: url.searchParams.get('ai') === '1',
      ...(url.searchParams.has('saved') ? { notice: 'Saved.' } : {}),
    };
    const page = (status = 200) => new Response(renderObjectWorkspace(model), { status, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
    const go = (path: string) => new Response(null, { status: 303, headers: { Location: path } });
    const backlinksOffset = () => {
      if (url.searchParams.getAll('backlinksOffset').length > 1) throw new AppError(422, 'Invalid backlinks page.');
      const value = url.searchParams.get('backlinksOffset') ?? '0';
      if (!/^\d{1,7}$/.test(value) || Number(value) > 1_000_000) throw new AppError(422, 'Invalid backlinks page.');
      return Number(value);
    };
    const loadBacklinks = (id: string, offset = backlinksOffset()) => {
      const page = objects.backlinks(id, offset);
      model.backlinks = page.links;
      model.backlinksPage = page;
    };
    const pickerObjects = (propertySets: (Record<string, PropertyValue> | undefined)[] = [model.object?.properties, model.objectDraft?.properties]) => {
      // ObjectEditor renders all type fields for enhanced switching, plus retained
      // properties on existing objects and historical drafts. Match that set,
      // querying each target once, then append selected references even when they
      // are trashed or outside the bounded picker window.
      const propertyIds = new Set([...catalog.types.flatMap(type => type.propertyIds)]);
      const selectedIds = new Map<string, string>();
      for (const properties of propertySets) {
        for (const [id, value] of Object.entries(properties ?? {})) {
          propertyIds.add(id);
          const property = catalog.properties.find(item => item.id === id);
          if (property?.kind !== 'reference') continue;
          for (const target of Array.isArray(value) ? value : [value]) {
            if (typeof target === 'string') selectedIds.set(target.toLowerCase(), target);
          }
        }
      }
      for (const [name, values] of Object.entries(model.objectDraft?.fields ?? {})) {
        const match = /^p:([a-f0-9-]{36})$/i.exec(name);
        if (!match) continue;
        const property = catalog.properties.find(item => item.id === match[1]);
        if (property?.kind !== 'reference') continue;
        propertyIds.add(property.id);
        for (const target of values) if (target) selectedIds.set(target.toLowerCase(), target);
      }
      const targetTypes = new Set<string>();
      for (const property of catalog.properties) {
        if (propertyIds.has(property.id) && property.kind === 'reference' && property.targetTypeId) targetTypes.add(property.targetTypeId);
      }
      const byId = new Map<string, ObjectSummary>();
      const add = (record: ObjectSummary) => byId.set(record.id.toLowerCase(), record);
      for (const typeId of targetTypes) for (const record of objects.listObjectSummaries({ typeId, limit: 200 })) add(record);
      for (const [key, id] of selectedIds) {
        if (byId.has(key)) continue;
        try {
          add(objects.getObjectSummary(id));
        } catch (error) {
          if (error instanceof AppError && error.status === 404) continue;
          throw error;
        }
      }
      return [...byId.values()];
    };
    const viewObjects = (evaluated: EvaluatedView) => {
      const byId = new Map<string, ObjectSummary>();
      const targetTypes = new Set<string>();
      const selectedIds = new Set<string>();
      const add = (record?: ObjectSummary) => {
        if (!record || byId.has(record.id)) return;
        byId.set(record.id, record);
      };
      const addValue = (value: PropertyValue | undefined) => {
        const ids = Array.isArray(value) ? value : typeof value === 'string' ? [value] : [];
        for (const id of ids) selectedIds.add(id);
      };
      if (evaluated.view.spec.input?.typeId) targetTypes.add(evaluated.view.spec.input.typeId);
      for (const block of evaluated.blocks) {
        for (const row of block.rows) {
          for (const propertyId of Object.values(row.bindings)) {
            const property = catalog.properties.find(item => item.id === propertyId);
            if (property?.kind !== 'reference') continue;
            if (property.targetTypeId) targetTypes.add(property.targetTypeId);
            addValue(row.object.properties[property.id]);
          }
        }
      }
      for (const typeId of targetTypes) {
        for (const record of objects.listObjectSummaries({ typeId, limit: 200 })) add(record);
      }
      add(evaluated.input);
      for (const id of selectedIds) {
        if (byId.has(id)) continue;
        try {
          add(objects.getObjectSummary(id));
        } catch (error) {
          if (error instanceof AppError && error.status === 404) continue;
          throw error;
        }
      }
      return [...byId.values()];
    };
    const unavailableHistoryMessage = 'This historical revision uses a type, property, or value that is no longer editable. Copy its source manually; Taskdesk will not open a lossy restore draft.';
    const historyAvailable = (snapshot: ObjectRecord): boolean => {
      if (!catalog.types.some(type => type.id === snapshot.typeId)) return false;
      for (const [propertyId, value] of Object.entries(snapshot.properties)) {
        const property = catalog.properties.find(item => item.id === propertyId);
        if (!property) return false;
        if (property.kind === 'text') {
          if (typeof value !== 'string' || /[\r\n]/.test(value)) return false;
        } else if (property.kind === 'select') {
          if (typeof value !== 'string' || !property.options?.some(option => option.id === value)) return false;
        } else if (property.kind === 'reference') {
          const ids = property.multiple ? value : [value];
          if (!Array.isArray(ids) || ids.length > 256) return false;
          if (ids.some(id => typeof id !== 'string' || !Value.Check(IdSchema, id.toLowerCase()))) return false;
          if (new Set(ids.map(id => String(id).toLowerCase())).size !== ids.length) return false;
        } else if (valueError(property.kind, value)) return false;
      }
      return true;
    };
    const historyFallbackPage = (current: ObjectRecord, snapshot: ObjectRecord, status = 422): Response => {
      model.screen = 'object-history';
      model.object = current;
      model.objectType = objects.getType(current.typeId);
      const listed = objects.listObjectHistory(current.id);
      model.history = { revisions: listed.revisions, selected: snapshot, offset: 0, hasMore: listed.hasMore };
      model.objects = pickerObjects([current.properties, snapshot.properties]);
      model.error = unavailableHistoryMessage;
      return page(status);
    };
    const readWrite = (data: URLSearchParams, current?: ObjectRecord): ObjectWrite => {
      const type = objects.getType(data.get('typeId') ?? current?.typeId ?? PAGE_TYPE_ID);
      const historyRevision = data.has('historyRevision') && current ? objects.getObjectRevision(current.id, positiveInteger(data.get('historyRevision'), 'Choose a historical revision.')) : undefined;
      const ids = new Set([...type.propertyIds, ...Object.keys(current?.properties ?? {}), ...Object.keys(historyRevision?.properties ?? {})]);
      for (const key of data.keys()) if (key.startsWith('p:') && !ids.has(key.split(':')[1]!)) throw new AppError(422, 'This property is not attached to the object or its type.');
      const properties: Record<string, PropertyValue> = historyRevision ? {} : { ...current?.properties };
      for (const id of ids) {
        const property = objects.getProperty(id);
        const value = formValue(property, data, `p:${id}`);
        if (value === null) delete properties[id]; else properties[id] = value;
      }
      const body = validateMarkdown(data.get('body') ?? current?.body ?? '');
      return { typeId: type.id, title: data.get('title') ?? '', properties, body };
    };
    try {
      if (req.method === 'GET') {
        if (lookupRoute) {
          requireFields(url.searchParams, ['q', 'typeId']);
          const search = url.searchParams.get('q') ?? '';
          const typeId = url.searchParams.get('typeId');
          if (search.length > 200) throw new AppError(422, 'Search must be at most 200 characters.');
          if (typeId !== null && !Value.Check(IdSchema, typeId)) throw new AppError(422, 'Invalid type filter.');
          if (typeId !== null) objects.getType(typeId);
          const rows = objects.listObjectSummaries({ search, typeId: typeId ?? undefined, limit: 51 });
          const result: ObjectLookupResult = {
            items: rows.slice(0, 50).map(record => ({ id: record.id, title: record.title, typeName: objects.getType(record.typeId).name })),
            truncated: rows.length > 50,
          };
          return Response.json(result, { headers: { 'Cache-Control': 'no-store' } });
        }
        if (url.searchParams.has('conversation')) {
          const conversation = conversations.get(visitor.id, url.searchParams.get('conversation')!);
          model.aiConversationId = conversation.id;
          model.aiContextTitle = conversation.turns.at(-1)?.title ?? conversation.contextTitle;
        }
        if (conversationRoute) {
          const match = /^\/views\/conversations\/([^/]+)$/.exec(url.pathname);
          if (!match) throw new AppError(404, 'View conversation not found.');
          return Response.json(conversations.get(visitor.id, match[1]!), { headers: { 'Cache-Control': 'no-store' } });
        }
        if (url.pathname === '/' || url.pathname === '/tasks') {
          if (url.pathname === '/tasks') {
            model.section = 'tasks';
            model.objectType = objects.getType(TASK_TYPE_ID);
          }
          model.search = url.searchParams.get('q') ?? '';
          if (model.search.length > 200) throw new AppError(422, 'Search must be at most 200 characters.');
          model.selectedTypeId = model.section === 'tasks' ? model.objectType?.id : url.searchParams.get('type') || undefined;
          if (model.selectedTypeId) objects.getType(model.selectedTypeId);
          model.trashed = url.searchParams.get('trash') === '1';
          const offset = url.searchParams.get('offset') ?? '0';
          if (!/^\d{1,7}$/.test(offset) || Number(offset) > 1_000_000) throw new AppError(422, 'Invalid page.');
          model.offset = Number(offset);
          const layout = url.searchParams.get('layout') ?? 'list';
          if (layout !== 'list' && layout !== 'gallery') throw new AppError(422, 'Choose List or Gallery.');
          model.browseLayout = layout;
          const searching = url.searchParams.has('q') || url.searchParams.get('focus') === 'search';
          if (!model.section && !model.selectedTypeId && !searching) {
            model.screen = 'home';
            model.typeCounts = objects.countObjectsByType(model.trashed);
          } else if (model.selectedTypeId || (!model.section && model.search.trim())) {
            const rows = objects.listObjectSummaries({ typeId: model.selectedTypeId, search: model.search, trashed: model.trashed, offset: model.offset, limit: 51 });
            model.hasMore = rows.length > 50;
            model.objects = rows.slice(0, 50);
            if (layout === 'gallery') model.objectExcerpts = objects.objectExcerpts(model.objects.map(record => record.id));
          }
        } else if (url.pathname === '/journal') {
          model.screen = 'journal';
          model.journalDateDefault = !url.searchParams.has('date');
          model.journalDate = url.searchParams.get('date') ?? localDate();
          model.journal = objects.getJournal(model.journalDate);
        } else if (url.pathname === '/types') {
          model.screen = 'types';
          model.basedOnTypeId = url.searchParams.get('basedOnTypeId') || undefined;
          if (model.basedOnTypeId) objects.getType(model.basedOnTypeId);
        }
        else if (url.pathname === '/objects/new') {
          model.screen = 'new-object';
          model.objectType = objects.getType(url.searchParams.get('type') ?? PAGE_TYPE_ID);
          model.objects = pickerObjects();
          model.journalDateDefault = !url.searchParams.has('date');
          model.journalDate = url.searchParams.get('date') ?? localDate();
          if (model.objectType.id === JOURNAL_TYPE_ID) model.journal = objects.getJournal(model.journalDate);
        } else if (url.pathname === '/views' || url.pathname === '/calendar') {
          model.screen = 'views';
          if (url.pathname === '/calendar') model.section = 'calendar';
        } else {
          const historyMatch = /^\/objects\/([a-f0-9-]{36})\/history$/.exec(url.pathname);
          if (historyMatch) {
            requireFields(url.searchParams, ['offset', 'revision']);
            model.screen = 'object-history';
            model.object = objects.getObject(historyMatch[1]!);
            model.objectType = objects.getType(model.object.typeId);
            const offsetValue = url.searchParams.get('offset') ?? '0';
            if (!/^\d{1,7}$/.test(offsetValue) || Number(offsetValue) > 1_000_000) throw new AppError(422, 'Invalid history page.');
            const listed = objects.listObjectHistory(model.object.id, Number(offsetValue));
            model.history = { revisions: listed.revisions, offset: Number(offsetValue), hasMore: listed.hasMore };
            if (url.searchParams.has('revision')) {
              model.history.selected = objects.getObjectRevision(model.object.id, positiveInteger(url.searchParams.get('revision'), 'Choose a historical revision.'));
              if (!historyAvailable(model.history.selected)) model.error = unavailableHistoryMessage;
            }
            model.objects = pickerObjects([model.object.properties, model.history.selected?.properties]);
            return page();
          }
          const match = /^\/(types|objects|views)\/([a-f0-9-]{36})$/.exec(url.pathname);
          if (!match) throw new AppError(404, 'Page not found.');
          if (match[1] === 'types') { model.screen = 'type'; model.objectType = objects.getType(match[2]!); }
          else if (match[1] === 'objects') {
            model.screen = 'object'; model.object = objects.getObject(match[2]!);
            model.objectType = objects.getType(model.object.typeId);
            model.objects = pickerObjects();
            loadBacklinks(model.object.id);
          } else {
            model.screen = 'view';
            model.evaluatedView = views.evaluate(match[2]!, url.searchParams.get('input') || undefined);
            model.objects = viewObjects(model.evaluatedView);
          }
        }
        return page();
      }
      if (!fields) throw new AppError(400, 'Submit a form.');
      if (url.pathname === '/journal/open') {
        model.screen = 'journal';
        model.journalDate = fields.get('date') ?? '';
        requireFields(fields, ['csrf', 'date']);
        const journal = objects.openJournal(model.journalDate);
        return go(`/objects/${journal.id}`);
      }
      if (url.pathname === '/types/create') {
        model.screen = 'types';
        model.typeDraft = { name: fields.get('name') ?? '', basedOnTypeId: fields.get('basedOnTypeId') || undefined };
        requireFields(fields, ['csrf', 'name', 'basedOnTypeId']);
        const type = objects.createType(model.typeDraft.name, model.typeDraft.basedOnTypeId);
        return go(`/types/${type.id}?saved=1`);
      }
      const typeMatch = /^\/types\/([a-f0-9-]{36})\/(update|properties)$/.exec(url.pathname);
      if (typeMatch) {
        model.screen = 'type'; model.objectType = objects.getType(typeMatch[1]!);
        if (typeMatch[2] === 'update') {
          requireFields(fields, ['csrf', 'name', 'revision']);
          objects.renameType(model.objectType.id, revision(fields), fields.get('name') ?? '');
        } else {
          requireFields(fields, ['csrf', 'revision', 'propertyId', 'label', 'kind', 'options', 'targetTypeId', 'multiple']);
          const propertyId = fields.get('propertyId');
          if (!propertyId) model.newPropertyDraft = newPropertyDraft(fields);
          objects.addProperty(model.objectType.id, revision(fields), propertyId ? { propertyId } : {
            label: fields.get('label') ?? '', kind: fields.get('kind') as PropertyKind,
            ...(fields.get('options') ? { options: fields.get('options')!.split(/\r?\n/).map(value => value.trim()).filter(Boolean) } : {}),
            ...(fields.get('targetTypeId') ? { targetTypeId: fields.get('targetTypeId')! } : {}),
            ...(fields.has('multiple') ? { multiple: fields.get('multiple') === 'on' || fields.get('multiple') === 'true' } : {}),
          });
        }
        return go(`/types/${model.objectType.id}?saved=1`);
      }
      const propertyMatch = /^\/properties\/([a-f0-9-]{36})\/update$/.exec(url.pathname);
      if (propertyMatch) {
        model.screen = 'types';
        requireFields(fields, ['csrf', 'label', 'revision']);
        objects.renameProperty(propertyMatch[1]!, revision(fields), fields.get('label') ?? '');
        const type = catalog.types.find(type => type.propertyIds.includes(propertyMatch[1]!));
        return go(type ? `/types/${type.id}?saved=1` : '/types?saved=1');
      }
      if (url.pathname === '/objects/create') {
        model.screen = 'new-object';
        model.objectDraft = { title: fields.get('title') ?? '', body: fields.get('body') ?? '', requestId: fields.get('requestId') ?? '', typeId: fields.get('typeId') ?? PAGE_TYPE_ID, fields: draftFields(fields) };
        model.objectType = objects.getType(model.objectDraft.typeId!);
        model.objects = pickerObjects();
        requireFields(fields, ['csrf', 'requestId', 'typeId', 'title', 'body', 'intent'], true);
        if (fields.get('intent') === 'change-type') {
          model.journalDate = localDate();
          return page();
        }
        const write = readWrite(fields);
        model.objectDraft.properties = write.properties;
        const record = objects.createObject(write, fields.get('requestId') || undefined);
        return go(`/objects/${record.id}?saved=1`);
      }
      const historyDraftMatch = /^\/objects\/([a-f0-9-]{36})\/history\/draft$/.exec(url.pathname);
      if (historyDraftMatch) {
        requireFields(fields, ['csrf', 'revision', 'currentRevision']);
        model.screen = 'object';
        model.object = objects.getObject(historyDraftMatch[1]!);
        const snapshot = objects.getObjectRevision(model.object.id, positiveInteger(fields.get('revision'), 'Choose a historical revision.'));
        if (!historyAvailable(snapshot)) return historyFallbackPage(model.object, snapshot);
        model.objectType = objects.getType(snapshot.typeId);
        const currentRevision = revision(fields, 'currentRevision');
        model.objectDraft = { title: snapshot.title, body: snapshot.body, revision: String(currentRevision), typeId: snapshot.typeId, properties: { ...snapshot.properties }, historyRevision: String(snapshot.revision) };
        model.objects = pickerObjects([model.object.properties, model.objectDraft.properties]);
        loadBacklinks(model.object.id, 0);
        return page();
      }
      const objectMatch = /^\/objects\/([a-f0-9-]{36})\/(update|trash|restore)$/.exec(url.pathname);
      if (objectMatch) {
        model.screen = 'object';
        model.object = objects.getObject(objectMatch[1]!);
        model.objectType = objects.getType(model.object.typeId);
        loadBacklinks(model.object.id);
        if (objectMatch[2] === 'update') {
          model.objectDraft = { title: fields.get('title') ?? '', body: fields.get('body') ?? model.object.body, revision: fields.get('reviewedRevision') ?? fields.get('revision') ?? '', typeId: fields.get('typeId') ?? model.object.typeId, fields: draftFields(fields), historyRevision: fields.has('historyRevision') ? fields.get('historyRevision') ?? '' : undefined };
          model.objects = pickerObjects();
          requireFields(fields, ['csrf', 'revision', 'reviewedRevision', 'typeId', 'title', 'body', 'intent', 'historyRevision'], true);
          if (model.objectDraft.historyRevision !== undefined) {
            const snapshot = objects.getObjectRevision(model.object.id, positiveInteger(model.objectDraft.historyRevision, 'Choose a historical revision.'));
            if (!historyAvailable(snapshot)) return historyFallbackPage(model.object, snapshot);
            model.objectDraft.properties = { ...snapshot.properties };
            model.objects = pickerObjects([model.object.properties, model.objectDraft.properties]);
          }
          if (fields.get('intent') === 'change-type') {
            objects.getType(model.objectDraft.typeId!);
            return page();
          }
          const write = readWrite(fields, model.object);
          model.objectDraft.properties = write.properties;
          const originalRevision = revision(fields);
          const expectedRevision = fields.has('reviewedRevision') ? revision(fields, 'reviewedRevision') : originalRevision;
          objects.updateObject(objectMatch[1]!, expectedRevision, write);
          return go(`/objects/${objectMatch[1]}?saved=1`);
        }
        model.objects = pickerObjects();
        requireFields(fields, ['csrf', 'revision']);
        objects.setTrashed(objectMatch[1]!, revision(fields), objectMatch[2] === 'trash');
        return go(objectMatch[2] === 'trash' ? '/?trash=1' : `/objects/${objectMatch[1]}?saved=1`);
      }
      if (url.pathname === '/views/generate') {
        model.screen = 'views'; model.prompt = fields.get('prompt') ?? ''; model.aiOpen = true;
        requireFields(fields, ['csrf', 'prompt', 'previousId', 'conversationId']);
        if (fields.has('conversationId') && fields.has('previousId')) throw new AppError(422, 'Choose a conversation or a previous view, not both.');
        let conversation: ViewConversation | undefined;
        let previous: SavedView | undefined;
        if (fields.has('conversationId')) {
          const id = fields.get('conversationId')!;
          if (!Value.Check(IdSchema, id)) throw new AppError(422, 'Invalid view conversation ID.');
          model.aiConversationId = id;
          conversation = conversations.get(visitor.id, id);
          model.aiContextTitle = conversation.turns.at(-1)?.title ?? conversation.contextTitle;
          previous = conversations.previous(conversation);
        } else if (fields.has('previousId')) {
          const id = fields.get('previousId')!;
          if (!Value.Check(IdSchema, id)) throw new AppError(422, 'Invalid previous view ID.');
          model.aiPreviousId = id;
          previous = views.get(id);
          model.aiContextTitle = previous.spec.title;
        }
        const prompt = model.prompt.trim();
        if (!prompt || model.prompt.length > 4000) throw new AppError(422, 'Describe a view in 1–4000 characters.');
        if (generating.has(visitor.id) || generating.size >= 3) throw new AppError(429, 'A view is already being generated. Wait for it to finish.');
        generating.add(visitor.id);
        try {
          const generated = await generator(prompt, catalog, { previous: previous?.spec, history: conversation?.turns.slice(-12).map(turn => turn.prompt), signal: AbortSignal.any([req.signal, AbortSignal.timeout(90_000)]) });
          req.signal.throwIfAborted();
          const result = conversations.save(visitor.id, prompt, generated, { conversation, previous });
          const path = `/views/${result.view.id}`;
          return json ? Response.json({ conversation: result.conversation, viewId: result.view.id, url: path }, { headers: { 'Cache-Control': 'no-store' } }) : go(`${path}?ai=1&conversation=${result.conversation.id}`);
        } catch (error) {
          if (error instanceof AppError) throw error;
          console.warn('View generation failed:', error instanceof Error ? error.message : 'Unknown error');
          throw new AppError(502, 'AI could not generate a valid view. No objects changed and no fallback view was created. Check Pi authentication or PI_MODEL, then try again.');
        } finally { generating.delete(visitor.id); }
      }
      const viewMatch = /^\/views\/([a-f0-9-]{36})\/(publish|delete|act)$/.exec(url.pathname);
      if (viewMatch) {
        model.screen = 'views';
        if (viewMatch[2] === 'act') {
          requireFields(fields, ['csrf', 'revision', 'blockIndex', 'objectId', 'objectRevision', 'role', 'value', 'value:start', 'value:end', 'value:timeZone', 'inputId']);
          const blockIndex = Number(fields.get('blockIndex'));
          if (!Number.isInteger(blockIndex) || blockIndex < 0 || blockIndex >= 6) throw new AppError(422, 'Invalid view block.');
          const record = objects.getObject(fields.get('objectId') ?? '');
          const block = views.get(viewMatch[1]!).spec.blocks[blockIndex];
          const role = fields.get('role') ?? '';
          const source = block?.sources.find(source => source.typeId === record.typeId && source.bindings[role]);
          if (!source) throw new AppError(422, 'This view does not expose that property.');
          const value = formValue(objects.getProperty(source.bindings[role]!), fields, 'value');
          views.act(viewMatch[1]!, revision(fields), blockIndex, record.id, revision(fields, 'objectRevision'), role, value, fields.get('inputId') || undefined);
          return go(`/views/${viewMatch[1]}?saved=1${fields.get('inputId') ? `&input=${encodeURIComponent(fields.get('inputId')!)}` : ''}`);
        }
        requireFields(fields, ['csrf', 'revision']);
        if (viewMatch[2] === 'publish') { views.publish(viewMatch[1]!, revision(fields)); return go(`/views/${viewMatch[1]}?saved=1`); }
        views.delete(viewMatch[1]!, revision(fields));
        return go('/views?saved=1');
      }
      throw new AppError(404, 'Action not found.');
    } catch (error) {
      if (!(error instanceof AppError)) throw error;
      if (json) return Response.json({ error: error.message }, { status: error.status, headers: { 'Cache-Control': 'no-store' } });
      model.error = error.message;
      if (model.objectDraft?.typeId === JOURNAL_TYPE_ID) {
        const date = model.objectDraft.fields?.[`p:${JOURNAL_DATE_PROPERTY_ID}`]?.[0];
        if (date) {
          try {
            const existing = objects.getJournal(date);
            if (existing?.id !== model.object?.id) model.journal = existing;
          } catch (lookupError) {
            if (!(lookupError instanceof AppError)) throw lookupError;
          }
        }
      }
      if (error.status === 409 && model.object && model.objectDraft?.revision && Number(model.objectDraft.revision) !== model.object.revision) {
        model.error = 'This object changed. Compare the latest saved version with your draft before saving.';
      }
      return page(error.status);
    }
  };
}
