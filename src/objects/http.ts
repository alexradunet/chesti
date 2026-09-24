import { Value } from 'typebox/value';
import { AppError } from '../core.js';
import type { Visitor } from '../store.js';
import { documentFromMarkdown, validateDocument } from './document.js';
import { IdSchema, PAGE_TYPE_ID } from './model.js';
import type { ObjectPageModel, ObjectRecord, ObjectWrite, PropertyDefinition, PropertyKind, PropertyValue, SavedView, ViewConversation, ViewGenerator } from './model.js';
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
function requireFields(fields: URLSearchParams, allowed: string[], properties = false): void {
  for (const name of fields.keys()) {
    if (!allowed.includes(name) && !(properties && /^p:[a-f0-9-]{36}(?::(?:start|end|timeZone))?$/.test(name))) throw new AppError(422, 'Unexpected form field.');
    if ((!properties || !name.startsWith('p:')) && fields.getAll(name).length !== 1) throw new AppError(422, 'Repeated form field.');
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

/** The native editor, enhanced editor, and generated view forms share the same commands. */
export function createObjectRoutes(objects: ObjectRuntime, generator: ViewGenerator = generateView) {
  const views = new ViewService(objects);
  const conversations = new ViewConversationService(objects.db, views);
  const generating = new Set<string>();
  return async (req: Request, url: URL, visitor: Visitor, fields?: URLSearchParams): Promise<Response | undefined> => {
    if (!(url.pathname === '/' || url.pathname === '/calendar' || url.pathname === '/tasks' || /^\/(?:types|objects|properties|views)(?:\/|$)/.test(url.pathname))) return;
    const conversationRoute = url.pathname.startsWith('/views/conversations/');
    const json = conversationRoute || (url.pathname === '/views/generate' && req.headers.get('accept')?.includes('application/json'));
    const catalog = objects.catalog();
    const model: ObjectPageModel = {
      csrf: visitor.csrf, path: url.pathname, screen: 'objects', catalog, views: views.list(), objects: [],
      aiOpen: url.searchParams.get('ai') === '1',
      ...(url.searchParams.has('saved') ? { notice: 'Saved.' } : {}),
    };
    const page = (status = 200) => new Response(renderObjectWorkspace(model), { status, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
    const go = (path: string) => new Response(null, { status: 303, headers: { Location: path } });
    const pickerObjects = () => objects.listObjects({ limit: 200 });
    const readWrite = (data: URLSearchParams, current?: ObjectRecord): ObjectWrite => {
      const type = objects.getType(data.get('typeId') ?? current?.typeId ?? PAGE_TYPE_ID);
      const ids = new Set([...type.propertyIds, ...Object.keys(current?.properties ?? {})]);
      for (const key of data.keys()) if (key.startsWith('p:') && !ids.has(key.split(':')[1]!)) throw new AppError(422, 'This property is not attached to the object or its type.');
      const properties: Record<string, PropertyValue> = { ...current?.properties };
      for (const id of ids) {
        const property = objects.getProperty(id);
        const value = formValue(property, data, `p:${id}`);
        if (value === null) delete properties[id]; else properties[id] = value;
      }
      let document;
      try {
        document = data.has('document') ? validateDocument(JSON.parse(data.get('document')!)) : data.has('body') ? documentFromMarkdown(data.get('body')!) : current?.document ?? documentFromMarkdown('');
      } catch (error) { throw new AppError(422, error instanceof Error ? error.message : 'Invalid document.'); }
      return { typeId: type.id, title: data.get('title') ?? '', properties, document };
    };
    try {
      if (req.method === 'GET') {
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
            model.objectType = catalog.types.find(type => /^tasks?$/i.test(type.name));
          }
          model.search = url.searchParams.get('q') ?? '';
          if (model.search.length > 200) throw new AppError(422, 'Search must be at most 200 characters.');
          model.selectedTypeId = model.section === 'tasks' ? model.objectType?.id : url.searchParams.get('type') || undefined;
          if (model.selectedTypeId) objects.getType(model.selectedTypeId);
          model.trashed = url.searchParams.get('trash') === '1';
          const offset = url.searchParams.get('offset') ?? '0';
          if (!/^\d{1,7}$/.test(offset) || Number(offset) > 1_000_000) throw new AppError(422, 'Invalid page.');
          model.offset = Number(offset);
          const rows = model.section === 'tasks' && !model.selectedTypeId ? [] : objects.listObjects({ typeId: model.selectedTypeId, search: model.search, trashed: model.trashed, offset: model.offset, limit: 51 });
          model.hasMore = rows.length > 50;
          model.objects = rows.slice(0, 50);
        } else if (url.pathname === '/types') model.screen = 'types';
        else if (url.pathname === '/objects/new') {
          model.screen = 'new-object';
          model.objectType = objects.getType(url.searchParams.get('type') ?? PAGE_TYPE_ID);
          model.objects = pickerObjects();
        } else if (url.pathname === '/views' || url.pathname === '/calendar') {
          model.screen = 'views';
          if (url.pathname === '/calendar') model.section = 'calendar';
        } else {
          const match = /^\/(types|objects|views)\/([a-f0-9-]{36})$/.exec(url.pathname);
          if (!match) throw new AppError(404, 'Page not found.');
          if (match[1] === 'types') { model.screen = 'type'; model.objectType = objects.getType(match[2]!); }
          else if (match[1] === 'objects') {
            model.screen = 'object'; model.object = objects.getObject(match[2]!);
            model.objectType = objects.getType(model.object.typeId);
            model.objects = pickerObjects();
            const selected = new Set<string>();
            for (const [id, value] of Object.entries(model.object.properties)) if (objects.getProperty(id).kind === 'reference') for (const target of Array.isArray(value) ? value : [value]) if (typeof target === 'string') selected.add(target);
            for (const id of selected) if (!model.objects.some(item => item.id === id)) { try { model.objects.push(objects.getObject(id)); } catch { /* An imported unresolved link remains in stored content. */ } }
            model.backlinks = objects.backlinks(model.object.id);
          } else {
            model.screen = 'view'; model.objects = pickerObjects();
            model.evaluatedView = views.evaluate(match[2]!, url.searchParams.get('input') || undefined);
            const inputType = model.evaluatedView.view.spec.input?.typeId;
            if (inputType) {
              model.objects = objects.listObjects({ typeId: inputType, limit: 200 });
              if (model.evaluatedView.input && !model.objects.some(record => record.id === model.evaluatedView!.input!.id)) model.objects.push(model.evaluatedView.input);
            }
          }
        }
        return page();
      }
      if (!fields) throw new AppError(400, 'Submit a form.');
      if (url.pathname === '/types/create') {
        model.screen = 'types';
        requireFields(fields, ['csrf', 'name']);
        const type = objects.createType(fields.get('name') ?? '');
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
          objects.addProperty(model.objectType.id, revision(fields), fields.get('propertyId') ? { propertyId: fields.get('propertyId')! } : {
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
        model.screen = 'new-object'; model.objectType = objects.getType(fields.get('typeId') ?? PAGE_TYPE_ID); model.objects = pickerObjects();
        requireFields(fields, ['csrf', 'requestId', 'typeId', 'title', 'document', 'body'], true);
        const write = readWrite(fields);
        const record = objects.createObject(write, fields.get('requestId') || undefined);
        return go(`/objects/${record.id}?saved=1`);
      }
      const objectMatch = /^\/objects\/([a-f0-9-]{36})\/(update|trash|restore)$/.exec(url.pathname);
      if (objectMatch) {
        model.screen = 'object'; model.object = objects.getObject(objectMatch[1]!); model.objectType = objects.getType(model.object.typeId); model.objects = pickerObjects();
        if (objectMatch[2] === 'update') {
          requireFields(fields, ['csrf', 'revision', 'typeId', 'title', 'document', 'body'], true);
          const write = readWrite(fields, model.object);
          // Native errors show the user's submitted draft too; enhanced forms never discard it.
          model.object = { ...model.object, ...write };
          objects.updateObject(objectMatch[1]!, revision(fields), write);
          return go(`/objects/${objectMatch[1]}?saved=1`);
        }
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
      return page(error.status);
    }
  };
}
