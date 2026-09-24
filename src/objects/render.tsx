import type { JSX } from 'hono/jsx/jsx-runtime';
import { raw } from 'hono/html';
import { renderMarkdown } from './markdown.js';
import type { EvaluatedBlock, ObjectPageModel, ObjectRecord, PropertyDefinition, PropertyValue, SavedView, ViewRow } from './model.js';

const Hidden = ({ name, value }: { name: string; value: string | number }) => <input type="hidden" name={name} value={value} />;
const Token = ({ model }: { model: ObjectPageModel }) => <Hidden name="csrf" value={model.csrf} />;
const State = () => <p class="form-state" data-form-state="" role="status" aria-live="polite"></p>;
const titleOf = (record: ObjectRecord) => record.title || 'Untitled';
const objectUrl = (id: string) => `/objects/${encodeURIComponent(id)}`;
const typeName = (model: ObjectPageModel, id: string) => model.catalog.types.find(type => type.id === id)?.name ?? 'Unknown type';
const propertyOf = (model: ObjectPageModel, id: string) => model.catalog.properties.find(property => property.id === id);
const isRange = (value: PropertyValue | undefined | null): value is { start: string; end: string; timeZone?: string } => Boolean(value && typeof value === 'object' && !Array.isArray(value));

type IconName = 'plus' | 'search' | 'calendar' | 'tasks' | 'objects' | 'views' | 'type' | 'settings' | 'trash' | 'ai' | 'menu' | 'close' | 'pin';
  const paths: Record<IconName, string> = {
    plus: 'M12 5v14M5 12h14',
    search: 'M21 21l-5-5M19 10.5a8.5 8.5 0 1 1-17 0 8.5 8.5 0 0 1 17 0',
    calendar: 'M8 3v4M16 3v4M4 10h16M5 5h14a1 1 0 0 1 1 1v14H4V6a1 1 0 0 1 1-1M8 14h2M14 14h2M8 17h2',
    tasks: 'M9 6h11M9 12h11M9 18h11M3 6l1 1 2-3M3 12l1 1 2-3M3 18l1 1 2-3',
    objects: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z',
    views: 'M3 5h18v14H3zM3 10h18M9 10v9',
    type: 'M12 3l9 5v9l-9 5-9-5V8zM3 8l9 5 9-5M12 13v9',
    settings: 'M4 6h16M4 12h16M4 18h16M8 3v6M16 9v6M10 15v6',
    trash: 'M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7',
    ai: 'M12 3l2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5z',
    menu: 'M4 6h16M4 12h16M4 18h16',
    close: 'M6 6l12 12M18 6L6 18',
    pin: 'M9 3h6l-1 7 4 4H6l4-4zM12 14v7',
  };
function Icon({ name }: { name: IconName }) {
  return <svg class="icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d={paths[name]} /></svg>;
}

function WorkspaceNav({ model }: { model: ObjectPageModel }) {
  const browsing = model.screen === 'objects' && !model.section && !model.trashed;
  const currentType = model.selectedTypeId ?? model.object?.typeId;
  const links: { href: string; label: string; icon: IconName; active: boolean }[] = [
    { href: '/?focus=search', label: 'Search', icon: 'search', active: browsing && Boolean(model.search) },
    { href: '/calendar', label: 'Calendar', icon: 'calendar', active: model.section === 'calendar' },
    { href: '/tasks', label: 'Tasks', icon: 'tasks', active: model.section === 'tasks' },
    { href: '/', label: 'All objects', icon: 'objects', active: browsing && !currentType && !model.search },
    { href: '/views', label: 'Views', icon: 'views', active: !model.section && (model.screen === 'views' || model.screen === 'view') },
  ];
  return <nav id="workspace-nav" class="workspace-nav" aria-label="Workspace">
    <div class="nav-brand"><a class="brand" href="/"><span class="brand-mark"><Icon name="objects" /></span>Taskdesk</a><button class="icon-button js-only nav-close" type="button" data-nav-close="" aria-label="Close navigation"><Icon name="close" /></button></div>
    <a class="nav-new" href="/objects/new" aria-current={model.screen === 'new-object' ? 'page' : undefined}><Icon name="plus" />New content</a>
    <div class="nav-links">{links.map(link => <a href={link.href} aria-current={link.active ? 'page' : undefined}><Icon name={link.icon} /><span>{link.label}</span></a>)}</div>
    <section class="nav-section js-only" aria-labelledby="pinned-heading"><h2 id="pinned-heading">Pinned views</h2><p class="nav-hint" data-pins-empty="">Pin a view to keep it here.</p><div class="nav-links">{model.views.map(view => <a href={`/views/${view.id}`} data-pinned-view="" data-view-id={view.id} hidden aria-current={model.evaluatedView?.view.id === view.id ? 'page' : undefined}><Icon name="pin" /><span>{view.spec.title}</span></a>)}</div></section>
    <section class="nav-section" aria-labelledby="object-types-heading"><h2 id="object-types-heading">Object types</h2><div class="nav-links">{model.catalog.types.map((type, index) => <a href={`/?type=${encodeURIComponent(type.id)}`} aria-current={!model.section && !model.trashed && currentType === type.id ? 'page' : undefined}><span class={`type-icon type-accent-${index % 5}`}><Icon name="type" /></span><span>{type.name}</span></a>)}<a class="nav-manage" href="/types" aria-current={model.screen === 'types' || model.screen === 'type' ? 'page' : undefined}><Icon name="settings" /><span>Manage types</span></a></div></section>
    <div class="nav-bottom nav-links"><a href="/?trash=1" aria-current={model.trashed ? 'page' : undefined}><Icon name="trash" /><span>Trash</span></a><p class="nav-hint">Your objects. Your workspace.</p></div>
  </nav>;
}

function AiPanel({ model }: { model: ObjectPageModel }) {
  const previous = model.screen === 'view' ? model.evaluatedView?.view : undefined;
  const previousId = model.aiPreviousId ?? previous?.id;
  return <aside id="ai-panel" class="ai-panel" hidden={!model.aiOpen} aria-labelledby="ai-heading">
    <div class="ai-resize js-only" data-ai-resize="" role="separator" tabindex={0} aria-label="Resize AI panel" aria-orientation="vertical" aria-valuemin={320} aria-valuemax={560} aria-valuenow={380}></div>
    <header class="ai-header"><div><Icon name="ai" /><h2 id="ai-heading">View assistant</h2></div><div class="ai-header-actions"><button class="icon-button js-only" type="button" data-ai-new="" aria-label="Start a new conversation" title="New conversation"><Icon name="plus" /></button><button class="icon-button js-only" type="button" data-ai-close="" aria-label="Close view assistant"><Icon name="close" /></button><a class="icon-button native-only" href={previous ? `/views/${previous.id}` : '/views'} aria-label="Close view assistant"><Icon name="close" /></a></div></header>
    <div class="ai-context"><span class="fine">Working on</span><span class="context-chip" data-ai-context-label="">{model.aiContextTitle ?? previous?.spec.title ?? 'New view'}</span></div>
    <div class="ai-turns" data-ai-turns="" aria-live="polite" aria-relevant="additions text"><div class="ai-empty"><span class="ai-empty-icon"><Icon name="ai" /></span><h3>A new perspective on your objects</h3><p>Describe a list, table, calendar, or board. This AI assistant generates and refines views—it cannot write or change your objects.</p><p class="fine">Try “Show my projects grouped by status.”</p></div></div>
    <div class="ai-composer"><form data-ai-form="" method="post" action="/views/generate"><Token model={model} />{model.aiConversationId ? <Hidden name="conversationId" value={model.aiConversationId} /> : previousId && <Hidden name="previousId" value={previousId} />}<label for="ai-prompt">Describe your view<textarea id="ai-prompt" name="prompt" rows={4} required maxlength={4000} placeholder="What would you like to see?">{model.prompt ?? ''}</textarea></label><div class="ai-submit-row"><span class="fine">Creates a draft to review</span><button type="submit" class="primary"><Icon name="ai" />Generate view</button></div><p class={`form-state${model.error ? ' error' : ''}`} data-ai-status="" role="status">{model.aiOpen ? model.error : undefined}</p></form><details class="ai-privacy"><summary>What is shared with AI?</summary><p>Your prompt, conversation prompts, type and property schema, and any previous view specification go to your configured model provider. Object titles, property values, and note bodies are not sent. Successful prompts and view results are saved in this workspace.</p></details></div>
  </aside>;
}

function PropertyControl({ model, property, value, name = `p:${property.id}` }: { model: ObjectPageModel; property: PropertyDefinition; value?: PropertyValue | null; name?: string }) {
  const id = `field-${crypto.randomUUID()}`;
  const scalar = typeof value === 'string' || typeof value === 'number' ? String(value) : '';
  if (property.kind === 'boolean') return <label class="check"><input type="checkbox" name={name} value="true" checked={value === true} />{property.label}</label>;
  if (property.kind === 'date-range' || property.kind === 'time-range') {
    const range = isRange(value) ? value : undefined;
    return <fieldset class="range-field"><legend>{property.label}</legend><div class="range-inputs">
      <label>Start<input name={`${name}:start`} type={property.kind === 'date-range' ? 'date' : 'text'} value={range?.start ?? ''} aria-describedby={`${id}-help`} /></label>
      <label>End<input name={`${name}:end`} type={property.kind === 'date-range' ? 'date' : 'text'} value={range?.end ?? ''} aria-describedby={`${id}-help`} /></label>
      {property.kind === 'time-range' && <label>Time zone<input name={`${name}:timeZone`} type="text" value={range?.timeZone ?? ''} placeholder="Europe/London" /></label>}
    </div><small id={`${id}-help`}>{property.kind === 'time-range' ? 'ISO timestamps with offsets, for example 2026-09-24T09:00:00+01:00.' : 'Both dates are required for a range. Clear both to leave unset.'}</small></fieldset>;
  }
  if (property.kind === 'select') return <label>{property.label}<select name={name}><option value="" selected={!scalar}>Not set</option>{property.options?.map(option => <option value={option.id} selected={scalar === option.id}>{option.label}</option>)}</select></label>;
  if (property.kind === 'reference') {
    const selected = Array.isArray(value) ? value : typeof value === 'string' ? [value] : [];
    const candidates = model.objects.filter(record => (!property.targetTypeId || record.typeId === property.targetTypeId) && !record.trashed);
    const missing = selected.filter(item => !candidates.some(record => record.id === item));
    return <label>{property.label}<select name={name} multiple={property.multiple} size={property.multiple ? 4 : undefined}>
      {!property.multiple && <option value="" selected={!selected.length}>Not set</option>}
      {candidates.map(record => <option value={record.id} selected={selected.includes(record.id)}>{titleOf(record)} · {typeName(model, record.typeId)}</option>)}
      {missing.map(item => <option value={item} selected>{model.objects.find(record => record.id === item)?.title || `Linked object ${item}`}</option>)}
    </select>{property.multiple && <small>Choose multiple with Ctrl or Command. Clear the selection to remove all links.</small>}</label>;
  }
  return <label>{property.label}<input name={name} type={property.kind === 'number' ? 'number' : property.kind === 'date' ? 'date' : 'text'} step={property.kind === 'number' ? 'any' : undefined} value={scalar} aria-describedby={property.kind === 'datetime' ? `${id}-help` : undefined} />{property.kind === 'datetime' && <small id={`${id}-help`}>ISO timestamp with offset, for example 2026-09-24T09:00:00+01:00.</small>}</label>;
}

function Value({ model, propertyId, value }: { model: ObjectPageModel; propertyId: string; value: PropertyValue | undefined }): JSX.Element {
  const property = propertyOf(model, propertyId);
  if (value === undefined || value === '' || (Array.isArray(value) && !value.length)) return <span class="muted">Not set</span>;
  if (isRange(value)) return <span class="range-value"><span>{value.start}</span><span> to </span><span>{value.end}</span>{value.timeZone && <small> ({value.timeZone})</small>}</span>;
  if (property?.kind === 'reference') return <span class="reference-values">{(Array.isArray(value) ? value : [String(value)]).map(id => <a href={objectUrl(id)}>{model.objects.find(record => record.id === id)?.title || `Linked object ${id}`}</a>)}</span>;
  if (property?.kind === 'select') return <span>{property.options?.find(option => option.id === value)?.label ?? String(value)}</span>;
  return <span>{typeof value === 'boolean' ? value ? 'Yes' : 'No' : Array.isArray(value) ? value.join(', ') : String(value)}</span>;
}

function Objects({ model }: { model: ObjectPageModel }) {
  if (model.section === 'tasks' && !model.selectedTypeId) return <><div class="page-heading"><div><h1>Tasks</h1><p class="muted">A focused place for the work you want to do.</p></div></div><section class="empty setup-empty"><Icon name="tasks" /><h2>Start with a task type</h2><p>This workspace does not have a type named “Task” or “Tasks” yet. Create one in Manage types, then add objects to see them here.</p><a class="button" href="/types">Manage types</a></section><p class="fine">The view assistant can organize existing objects. It does not create types or tasks for you.</p></>;
  const query = (offset: number, trash = model.trashed) => `${model.section === 'tasks' ? '/tasks' : '/'}?${new URLSearchParams({ ...(model.selectedTypeId && model.section !== 'tasks' ? { type: model.selectedTypeId } : {}), ...(model.search ? { q: model.search } : {}), ...(trash ? { trash: '1' } : {}), offset: String(offset) })}`;
  return <><div class="page-heading"><div><h1>{model.trashed ? 'Trash' : model.section === 'tasks' ? 'Tasks' : model.selectedTypeId ? typeName(model, model.selectedTypeId) : 'All objects'}</h1><p class="muted">{model.section === 'tasks' ? 'Your task objects, together in one place.' : 'One home for your writing and structured information.'}</p></div><a class="button primary" href={`/objects/new${model.selectedTypeId ? `?type=${encodeURIComponent(model.selectedTypeId)}` : ''}`}><Icon name="plus" />{model.section === 'tasks' ? 'New task' : 'New object'}</a></div>
    <form class="filter-bar" method="get" action={model.section === 'tasks' ? '/tasks' : '/'}><label>Search<input type="search" name="q" value={model.search ?? ''} maxlength={200} /></label>{model.section !== 'tasks' && <label>Type<select name="type"><option value="">All types</option>{model.catalog.types.map(type => <option value={type.id} selected={type.id === model.selectedTypeId}>{type.name}</option>)}</select></label>}{model.trashed && <Hidden name="trash" value="1" />}<button type="submit">Filter</button><a href={query(0, !model.trashed)}>{model.trashed ? 'Back to objects' : 'Trash'}</a></form>
    {model.objects.length ? <ul class="object-index">{model.objects.map(record => <li><a href={objectUrl(record.id)}><strong>{titleOf(record)}</strong><span>{typeName(model, record.typeId)}</span></a><time datetime={record.updatedAt}>{record.updatedAt.slice(0, 10)}</time></li>)}</ul> : <p class="empty">{model.trashed ? 'Nothing in the trash.' : model.search || model.selectedTypeId ? 'No objects match these filters.' : 'No objects yet. Create one to start writing.'}</p>}
    {model.section === 'tasks' && <div class="view-invitation"><Icon name="ai" /><div><strong>See your tasks differently</strong><p>Generate a board or list using your existing task properties.</p></div><a class="button" href="/views?ai=1" data-ai-start="">Create task view</a></div>}
    <nav class="pagination" aria-label="Object pages">{(model.offset ?? 0) > 0 && <a href={query(Math.max(0, (model.offset ?? 0) - 50))}>Previous</a>}{model.hasMore && <a href={query((model.offset ?? 0) + 50)}>Next</a>}</nav></>;
}

const propertyKinds = [
  { value: 'text', label: 'Text', help: 'Short notes, names, URLs, or other written details.' },
  { value: 'number', label: 'Number', help: 'Amounts, ratings, or measurements. Decimals are welcome.' },
  { value: 'boolean', label: 'Checkbox', help: 'A simple yes or no, such as Done or Reviewed.' },
  { value: 'date', label: 'Date', help: 'A day without a time, such as a due date or birthday.' },
  { value: 'datetime', label: 'Date & time', help: 'An exact moment, including its time-zone offset.' },
  { value: 'select', label: 'Select', help: 'One choice from a list you define, such as a status or priority.' },
  { value: 'reference', label: 'Object link', help: 'Connect to an object of another type, such as a project or person.' },
  { value: 'date-range', label: 'Date range', help: 'A start and end date, such as a trip or project schedule.' },
  { value: 'time-range', label: 'Time range', help: 'Start and end timestamps with a time zone, such as a meeting.' },
] as const;
const kindLabel = (property: PropertyDefinition) => propertyKinds.find(kind => kind.value === property.kind)?.label ?? property.kind;

function Types({ model }: { model: ObjectPageModel }) {
  return <><div class="page-heading"><div><span class="eyebrow">Shape your workspace</span><h1>Object types</h1><p class="muted">A little structure for the things you collect, plan, and write.</p></div><a class="button" href="#create-type"><Icon name="plus" />New type</a></div>
    <div class="type-cards">{model.catalog.types.map((type, index) => <article class="type-card"><span class={`type-card-icon type-accent-${index % 5}`}><Icon name="type" /></span><h2><a href={`/types/${type.id}`}>{type.name}</a></h2><p class="muted">{type.propertyIds.length ? type.propertyIds.map(id => propertyOf(model, id)?.label).filter(Boolean).join(' · ') : 'A title and space to write. No extra properties yet.'}</p><div class="type-card-footer"><span class="fine">{type.propertyIds.length} optional {type.propertyIds.length === 1 ? 'property' : 'properties'}</span><a href={`/objects/new?type=${type.id}`} aria-label={`New ${type.name}`}>Create object →</a></div></article>)}</div>
    <section class="creation-panel" id="create-type"><div><span class="eyebrow">Make it your own</span><h2>Create a type</h2><p class="muted">Start with a name. Then add the details you want to keep track of.</p><p class="fine">Every object already has a title and writing space. Properties are optional, and can be shared between types.</p></div><form method="post" action="/types/create" data-enhance="" data-type-create=""><Token model={model} /><label>Type name<input name="name" required maxlength={100} placeholder="e.g. Book, Project, or Person" autocomplete="off" aria-describedby="type-name-help" /></label><small id="type-name-help">Name one thing, like “Book”, rather than a collection.</small><div class="type-name-preview" aria-hidden="true"><span class="type-card-icon"><Icon name="type" /></span><div><strong data-type-name-preview="">Your new type</strong><small>Title · Writing · Your properties</small></div></div><button class="primary" type="submit">Create type &amp; add properties</button><State /></form></section></>;
}

function TypeEditor({ model }: { model: ObjectPageModel }) {
  const type = model.objectType;
  if (!type) return <p class="empty">Type not found.</p>;
  const available = model.catalog.properties.filter(property => !type.propertyIds.includes(property.id));
  return <><a class="back-link" href="/types">← All types</a><div class="page-heading"><div><span class="eyebrow">Type setup</span><h1>{type.name}</h1><p class="muted">Choose the details that make a {type.name} useful to you.</p></div><a class="button primary" href={`/objects/new?type=${type.id}`}><Icon name="plus" />Create object</a></div>
    <details class="type-settings"><summary>Rename type</summary><form class="inline-form" method="post" action={`/types/${type.id}/update`} data-enhance=""><Token model={model} /><Hidden name="revision" value={type.revision} /><label>Type name<input name="name" value={type.name} required maxlength={100} /></label><button type="submit">Save name</button><State /></form></details>
    <section class="type-properties"><div class="section-heading"><h2>Object properties</h2><span class="tag">{type.propertyIds.length} custom</span></div><p class="muted">These fields appear when you create an object. Fill in only what you need.</p><div class="built-in-properties"><span>Title <small>Built in</small></span><span>Writing <small>Built in</small></span></div>
      {type.propertyIds.length ? <ul class="property-list property-cards">{type.propertyIds.map(id => { const property = propertyOf(model, id); const sharedWith = model.catalog.types.filter(item => item.id !== type.id && item.propertyIds.includes(id)); return property && <li><div class="property-card-heading"><strong>{property.label}</strong><span class="tag">{kindLabel(property)}</span></div>{property.options?.length ? <div class="option-chips">{property.options.map(option => <span class="tag">{option.label}</span>)}</div> : null}{property.targetTypeId && <p class="muted">Links to {typeName(model, property.targetTypeId)}{property.multiple ? ' · multiple links' : ''}</p>}<details><summary>Rename property</summary><p class="fine">{sharedWith.length ? `Shared with ${sharedWith.map(item => item.name).join(', ')}. Renaming changes the label there too.` : 'Renaming keeps existing values and views connected.'}</p><form class="inline-form" method="post" action={`/properties/${id}/update`} data-enhance=""><Token model={model} /><Hidden name="revision" value={property.revision} /><label>Property label<input name="label" value={property.label} required maxlength={100} /></label><button type="submit">Save label</button><State /></form></details></li>; })}</ul> : <div class="empty property-empty"><Icon name="type" /><div><strong>Start simple. Add structure when you need it.</strong><p>You can create objects now, or add a property below. Existing objects keep their writing.</p></div></div>}</section>
    <div class="two-columns property-builders"><section class="panel"><h2>Add a property</h2><p class="muted">What would you like to keep track of?</p><form method="post" action={`/types/${type.id}/properties`} data-enhance=""><Token model={model} /><Hidden name="revision" value={type.revision} /><label>Property label<input name="label" required maxlength={100} placeholder="e.g. Status, Due date, or Author" /></label><label>Property format<select name="kind" data-property-kind="" aria-describedby="property-kind-help">{propertyKinds.map(kind => <option value={kind.value} data-help={kind.help}>{kind.label}</option>)}</select></label><p class="kind-help fine" id="property-kind-help" data-kind-help="">{propertyKinds[0].help}</p><div data-kind-options="select"><label>Choices<textarea name="options" rows={4} placeholder={'Not started\nIn progress\nDone'}></textarea></label><small>One choice per line. Required for a Select property.</small></div><div data-kind-options="reference"><label>Link to type<select name="targetTypeId"><option value="">Choose a type</option>{model.catalog.types.map(item => <option value={item.id}>{item.name}</option>)}</select></label><label class="check"><input type="checkbox" name="multiple" value="true" />Allow multiple object links</label><small>Only objects of this type can be linked.</small></div><button class="primary" type="submit"><Icon name="plus" />Add property</button><State /></form></section>
    <section class="panel reuse-property"><span class="eyebrow">Keep things connected</span><h2>Use an existing property</h2><p class="muted">Already tracking this elsewhere? Reuse the same property so views can bring your objects together.</p>{available.length ? <form method="post" action={`/types/${type.id}/properties`} data-enhance=""><Token model={model} /><Hidden name="revision" value={type.revision} /><label>Shared property<select name="propertyId" required><option value="" selected>Choose a property</option>{available.map(property => <option value={property.id}>{property.label} · {kindLabel(property)}</option>)}</select></label><p class="fine">Labels and choices are shared. Each object keeps its own value.</p><button type="submit">Use property</button><State /></form> : <p class="fine">No other properties to reuse yet. New properties you add will be available to other types.</p>}</section></div></>;
}

function ObjectEditor({ model }: { model: ObjectPageModel }) {
  const record = model.object;
  const draft = model.objectDraft;
  const type = model.catalog.types.find(item => item.id === draft?.typeId) ?? (record ? model.catalog.types.find(item => item.id === record.typeId) : model.objectType ?? model.catalog.types.find(item => item.id === model.selectedTypeId) ?? model.catalog.types[0]);
  if (!type) return <p>Create a <a href="/types">type</a> before creating an object.</p>;
  const propertyIds = record ? [...new Set([...type.propertyIds, ...Object.keys(record.properties)])] : [...new Set(model.catalog.types.flatMap(item => item.propertyIds))];
  const body = draft?.body ?? record?.body ?? '';
  const mentions = model.objects.filter(item => !item.trashed).map(item => ({ id: item.id, title: titleOf(item), type: typeName(model, item.typeId) }));
  return <><a class="back-link" data-object-back="" href={`/?type=${type.id}`}>← {type.name} objects</a><div class="page-heading"><div><span class="eyebrow">{record ? type.name : 'Create something new'}</span><h1>{record ? 'Edit object' : 'New object'}</h1>{!record && <p class="muted">Choose a type, give it a title, and make it yours.</p>}</div>{record?.trashed && <span class="tag">In trash</span>}</div>
    {!record && <form class="object-type-picker" method="get" action="/objects/new"><label>Object type<select name="type" data-new-type="">{model.catalog.types.map(item => <option value={item.id} selected={item.id === type.id}>{item.name}</option>)}</select></label><button class="native-only" type="submit">Use type</button><a href="/types#create-type">Create a new type</a><p class="fine js-only">Switch types without losing your title or writing. Only the selected type’s properties are saved.</p></form>}
    <form class="object-editor" method="post" action={record ? `/objects/${record.id}/update` : '/objects/create'} data-enhance="" data-object-editor="" data-draft={draft ? 'true' : undefined}><Token model={model} />{record ? <Hidden name="revision" value={draft?.revision ?? record.revision} /> : <Hidden name="requestId" value={draft?.requestId ?? crypto.randomUUID()} />}
      <label class="title-field">Title<input name="title" value={draft?.title ?? record?.title ?? ''} required maxlength={500} autocomplete="off" placeholder="Give this object a name…" /></label>
      {record ? <label>Type<select name="typeId">{model.catalog.types.map(item => <option value={item.id} selected={item.id === type.id}>{item.name}</option>)}</select><small>Existing properties stay with this object when its type changes. Save to see the new type’s properties.</small></label> : <Hidden name="typeId" value={type.id} />}
      <details class="properties" open><summary>Details <span class="tag" data-property-count="">{record ? propertyIds.length : type.propertyIds.length}</span><span class="fine">Optional</span></summary><p class="fine" data-properties-empty="" hidden={record ? propertyIds.length > 0 : type.propertyIds.length > 0}>Just a title and writing for now. You can add properties in type setup later.</p><div class="property-grid">{propertyIds.map(id => { const property = propertyOf(model, id); return property && <fieldset class="object-property" data-type-ids={record ? undefined : model.catalog.types.filter(item => item.propertyIds.includes(id)).map(item => item.id).join(' ')} hidden={!record && !type.propertyIds.includes(id)} disabled={!record && !type.propertyIds.includes(id)}><legend class="sr-only">{property.label}</legend><PropertyControl model={model} property={property} value={(draft?.properties ?? record?.properties)?.[id]} /></fieldset>; })}</div></details>
      <section class="writing"><div class="writing-heading"><h2>Writing</h2><span class="fine">Notes, ideas, and everything in between. Optional.</span></div>
      <label>Body (Markdown)<textarea class="markdown-source" name="body" rows={16} aria-describedby="markdown-help" spellcheck={true}>{`\n${body}`}</textarea></label>
      <p class="fine" id="markdown-help">Use standard Markdown: # headings, **bold**, lists, and [label](https://example.com). Link an object with [label](/objects/OBJECT-ID). HTML is not rendered.</p>
      <div class="object-link-tools js-only"><label>Link object<select data-object-link-picker="" aria-label="Object to link"><option value="">Choose an object</option>{mentions.map(item => <option value={item.id} data-label={item.title}>{item.title} · {item.type}</option>)}</select></label><button type="button" data-insert-object-link="">Insert link</button></div>
      {record && <details class="markdown-preview"><summary>Read saved writing</summary><div class="markdown-content">{raw(renderMarkdown(record.body))}</div></details>}
      </section><div class="save-bar"><button type="submit" class="primary">{record ? 'Save changes' : 'Create object'}</button>{!record && <span class="fine">Nothing is saved until you create it.</span>}<State /></div>
    </form>
    {record && <><section class="backlinks"><h2>Linked from</h2>{model.backlinks?.length ? <ul>{model.backlinks.map(link => <li><a href={objectUrl(link.object.id)}>{titleOf(link.object)}</a>{link.propertyId && <span class="muted"> via {propertyOf(model, link.propertyId)?.label ?? 'property'}</span>}</li>)}</ul> : <p class="muted">No other objects link here yet.</p>}</section><form class="trash-form" method="post" action={`/objects/${record.id}/${record.trashed ? 'restore' : 'trash'}`} data-enhance=""><Token model={model} /><Hidden name="revision" value={record.revision} /><button type="submit">{record.trashed ? 'Restore object' : 'Move to trash'}</button><State /></form></>}
  </>;
}

function Views({ model }: { model: ObjectPageModel }) {
  const calendar = model.section === 'calendar';
  const views = calendar ? model.views.filter(view => view.spec.blocks.some(block => block.component === 'calendar')) : model.views;
  return <><div class="page-heading"><div><h1>{calendar ? 'Calendar' : 'Views'}</h1><p class="muted">{calendar ? 'Your dated objects, seen together. Open a saved calendar or create your own.' : 'Different perspectives on the same objects. Nothing copied, nothing moved.'}</p></div><a class="button primary" href={calendar ? '/calendar?ai=1' : '/views?ai=1'} data-ai-start=""><Icon name="ai" />{calendar ? 'Create calendar' : 'Create view'}</a></div>
    <div class="view-invitation"><span class="invitation-icon"><Icon name={calendar ? 'calendar' : 'views'} /></span><div><strong>{calendar ? 'Make room for what’s coming up' : 'A view that fits the way you think'}</strong><p>{calendar ? 'Ask for a calendar using date properties already in your workspace.' : 'Describe a list, table, calendar, or board. The view assistant creates a draft you can review.'}</p></div></div>
    <h2 class="section-heading">{calendar ? 'Saved calendars' : 'Saved views'}<span class="tag">{views.length}</span></h2>{views.length ? <ul class="view-list">{views.map(view => <li><span class="view-list-icon"><Icon name={view.spec.blocks.some(block => block.component === 'calendar') ? 'calendar' : 'views'} /></span><div><a href={`/views/${view.id}`}>{view.spec.title}</a><p class="muted">{view.spec.description}</p></div><span class="tag">{view.status}</span><a class="button" href={`/views/${view.id}`}>{view.status === 'draft' ? 'Preview' : 'Open'}</a></li>)}</ul> : <div class="empty"><h3>{calendar ? 'No calendars yet' : 'A fresh perspective starts here'}</h3><p>{calendar ? 'No saved view includes a calendar. Create one to bring your dated objects into focus.' : 'Create your first view from the objects and properties in your workspace.'}</p><a href={calendar ? '/calendar?ai=1' : '/views?ai=1'} data-ai-start="">{calendar ? 'Describe a calendar' : 'Describe a view'}</a></div>}</>;
}

function InlineAction({ model, view, blockIndex, row, role }: { model: ObjectPageModel; view: SavedView; blockIndex: number; row: ViewRow; role: 'date' | 'group' }) {
  const propertyId = row.bindings[role];
  const property = propertyId ? propertyOf(model, propertyId) : undefined;
  if (!property || view.status !== 'published' || !view.spec.blocks[blockIndex]?.editable) return null;
  return <details class="inline-action"><summary>Edit {property.label}</summary><form method="post" action={`/views/${view.id}/act`} data-enhance=""><Token model={model} /><Hidden name="revision" value={view.revision} /><Hidden name="blockIndex" value={blockIndex} /><Hidden name="objectId" value={row.object.id} /><Hidden name="objectRevision" value={row.object.revision} /><Hidden name="role" value={role} />{model.evaluatedView?.input && <Hidden name="inputId" value={model.evaluatedView.input.id} />}<PropertyControl model={model} property={property} value={row.object.properties[property.id]} name="value" /><button type="submit">Save</button><State /></form></details>;
}

function BoundValues({ model, block, row }: { model: ObjectPageModel; block: EvaluatedBlock; row: ViewRow }) {
  return <dl class="bound-values">{block.definition.columns?.map(column => { const id = row.bindings[column.role]; return id && <div><dt>{propertyOf(model, id)?.label ?? column.label}</dt><dd><Value model={model} propertyId={id} value={row.object.properties[id]} /></dd></div>; })}</dl>;
}

function ViewBlockContent({ model, block, blockIndex, view }: { model: ObjectPageModel; block: EvaluatedBlock; blockIndex: number; view: SavedView }): JSX.Element {
  if (block.error) return <p role="alert">{block.error}</p>;
  const rows = block.rows;
  const component = block.definition.component;
  if (component === 'table') return <div class="table-scroll" tabindex={0} role="region" aria-label={block.definition.title}><table><thead><tr><th scope="col">Object</th>{block.definition.columns?.map(column => {
    const labels = [...new Set(block.definition.sources.map(source => source.bindings[column.role]).filter((id): id is string => Boolean(id)).map(id => propertyOf(model, id)?.label).filter(Boolean))];
    return <th scope="col">{labels.length ? labels.join(' / ') : column.label}</th>;
  })}</tr></thead><tbody>{rows.map(row => <tr><th scope="row"><a href={objectUrl(row.object.id)}>{titleOf(row.object)}</a><small>{typeName(model, row.object.typeId)}</small></th>{block.definition.columns?.map(column => { const id = row.bindings[column.role]; return <td>{id ? <Value model={model} propertyId={id} value={row.object.properties[id]} /> : <span class="muted">Not bound</span>}</td>; })}</tr>)}</tbody></table>{!rows.length && <p class="empty">No matching objects.</p>}</div>;
  if (component === 'list') return rows.length ? <ul class="generated-list">{rows.map(row => <li><a href={objectUrl(row.object.id)}>{titleOf(row.object)}</a><span class="muted">{typeName(model, row.object.typeId)}</span><BoundValues model={model} block={block} row={row} /></li>)}</ul> : <p class="empty">No matching objects.</p>;
  if (component === 'calendar') {
    const groups = new Map<string, ViewRow[]>();
    for (const row of rows) {
      const value = row.object.properties[row.bindings.date ?? ''];
      const start = isRange(value) ? value.start : typeof value === 'string' ? value : '';
      const date = start ? start.slice(0, 10) : '';
      const group = groups.get(date) ?? []; group.push(row); groups.set(date, group);
    }
    if (!groups.has('')) groups.set('', []);
    return <div class="calendar-groups">{[...groups.entries()].sort(([a], [b]) => !a ? 1 : !b ? -1 : a.localeCompare(b)).map(([date, items]) => <section class="calendar-day"><h3>{date || 'Unscheduled'}</h3>{items.length ? <ul>{items.map(row => <li><a href={objectUrl(row.object.id)}>{titleOf(row.object)}</a><div class="calendar-date"><span class="muted">{propertyOf(model, row.bindings.date ?? '')?.label}: </span><Value model={model} propertyId={row.bindings.date ?? ''} value={row.object.properties[row.bindings.date ?? '']} /></div><BoundValues model={model} block={block} row={row} /><InlineAction model={model} view={view} blockIndex={blockIndex} row={row} role="date" /></li>)}</ul> : <p class="muted">No unscheduled objects.</p>}</section>)}</div>;
  }
  const properties = [...new Set(block.definition.sources.map(source => source.bindings.group).filter((id): id is string => Boolean(id)))];
  return <div class="board-groups">{properties.map(propertyId => {
    const property = propertyOf(model, propertyId);
    const groups = new Map<string, { value: PropertyValue | undefined; rows: ViewRow[] }>();
    if (property?.kind === 'select') for (const option of property.options ?? []) groups.set(JSON.stringify(option.id), { value: option.id, rows: [] });
    if (property?.kind === 'boolean') for (const value of [false, true]) groups.set(JSON.stringify(value), { value, rows: [] });
    for (const row of rows.filter(item => item.bindings.group === propertyId)) {
      const value = row.object.properties[propertyId];
      const key = value === undefined || value === '' || Array.isArray(value) && !value.length ? '' : JSON.stringify(value);
      const group = groups.get(key) ?? { value, rows: [] }; group.rows.push(row); groups.set(key, group);
    }
    if (!groups.has('')) groups.set('', { value: undefined, rows: [] });
    return <section><h3>{property?.label ?? 'Groups'}</h3><div class="board-scroll" tabindex={0} role="region" aria-label={`${block.definition.title}: ${property?.label ?? 'Groups'}`}>{[...groups.entries()].map(([key, group]) => <section class="board-column"><h4>{key ? <Value model={model} propertyId={propertyId} value={group.value} /> : 'Ungrouped'} <span class="muted">{group.rows.length}</span></h4>{group.rows.length ? <ul>{group.rows.map(row => <li><a href={objectUrl(row.object.id)}>{titleOf(row.object)}</a><small>{typeName(model, row.object.typeId)}</small><BoundValues model={model} block={block} row={row} /><InlineAction model={model} view={view} blockIndex={blockIndex} row={row} role="group" /></li>)}</ul> : <p class="muted">No objects.</p>}</section>)}</div></section>;
  })}</div>;
}

function View({ model }: { model: ObjectPageModel }) {
  const evaluated = model.evaluatedView;
  if (!evaluated) return <p class="empty">View not found.</p>;
  const view = evaluated.view;
  const input = view.spec.input;
  return <><a class="back-link" href="/views">All views</a><div class="page-heading"><div><h1>{view.spec.title}</h1><p class="muted">{view.spec.description}</p></div><span class="tag">{view.status === 'draft' ? 'Draft preview' : 'Published'}</span></div>
    <div class="view-actions">{view.status === 'draft' && <form method="post" action={`/views/${view.id}/publish`} data-enhance=""><Token model={model} /><Hidden name="revision" value={view.revision} /><button type="submit" class="primary">Publish view</button><State /></form>}<a class="button" href={`/views/${view.id}?ai=1`} data-ai-context="" data-previous-id={view.id} data-context-title={view.spec.title}><Icon name="ai" />Refine with AI</a><button class="js-only" type="button" data-pin-view="" data-view-id={view.id} aria-pressed="false">Pin view</button><form method="post" action={`/views/${view.id}/delete`} data-enhance=""><Token model={model} /><Hidden name="revision" value={view.revision} /><button type="submit">Delete view</button><State /></form><p class="muted">Deleting a view does not delete its objects.</p></div>
    {input && <form class="filter-bar" method="get" action={`/views/${view.id}`}><label>{input.label}<select name="input" required><option value="">Choose an object</option>{model.objects.filter(record => record.typeId === input.typeId && !record.trashed).map(record => <option value={record.id} selected={record.id === evaluated.input?.id}>{titleOf(record)}</option>)}</select></label><button type="submit">Show view</button></form>}
    {input && !evaluated.input ? <p class="empty">Choose a {typeName(model, input.typeId)} above to show this view.</p> : evaluated.blocks.map((block, index) => <section class="view-block"><h2>{block.definition.title}</h2><ViewBlockContent model={model} block={block} blockIndex={index} view={view} />{block.truncated && <p class="muted">This section reached its result limit. Narrow the view by refining your prompt.</p>}</section>)}
    <p class="fine">Generated by {view.model}. Draft actions are read-only; object links always open the object editor.</p>
  </>;
}

export function renderObjectWorkspace(model: ObjectPageModel): string {
  const title = model.section === 'calendar' ? 'Calendar' : model.section === 'tasks' ? 'Tasks' : model.trashed ? 'Trash' : model.screen === 'object' ? model.object?.title || 'Object' : model.screen === 'new-object' ? 'New object' : model.screen === 'type' ? model.objectType?.name || 'Type' : model.screen === 'view' ? model.evaluatedView?.view.spec.title || 'View' : model.screen === 'objects' ? model.selectedTypeId ? typeName(model, model.selectedTypeId) : 'All objects' : model.screen[0]!.toUpperCase() + model.screen.slice(1);
  const currentView = model.screen === 'view' ? model.evaluatedView?.view : undefined;
  const suggestedPrompt = model.section === 'calendar' ? 'Create a calendar of my objects using their date properties.' : model.section === 'tasks' && model.selectedTypeId ? 'Create a view of my tasks using their existing properties.' : undefined;
  return '<!doctype html>' + (<html lang="en"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><meta name="color-scheme" content="light" /><title>{title} · Taskdesk</title><link rel="stylesheet" href="/objects.css" /></head><body class={`object-shell${model.aiOpen ? ' ai-open' : ''}`} data-ai-view-id={currentView?.id} data-ai-view-title={currentView?.spec.title} data-ai-context-title={model.aiContextTitle} data-ai-prompt={suggestedPrompt}>
    <a class="skip-link" href="#main">Skip to content</a><div class="workspace-layout"><WorkspaceNav model={model} />
    <div class="workspace-content"><header class="workspace-header"><div class="workspace-breadcrumb"><button class="icon-button js-only nav-toggle" type="button" data-nav-toggle="" aria-label="Open navigation" aria-controls="workspace-nav" aria-expanded="false"><Icon name="menu" /></button><a href="/">Workspace</a><span aria-hidden="true">/</span><span class="breadcrumb-title">{title}</span></div><a class="button ai-toggle" href="/views?ai=1" data-ai-toggle="" aria-controls="ai-panel" aria-expanded={model.aiOpen ? 'true' : 'false'}><Icon name="ai" /><span>View assistant</span></a></header>
    <main id="main" tabindex={-1}>{model.error && <div class="notice error" role="alert">{model.error}</div>}{model.notice && <div class="notice" role="status">{model.notice}</div>}{model.screen === 'objects' ? <Objects model={model} /> : model.screen === 'types' ? <Types model={model} /> : model.screen === 'type' ? <TypeEditor model={model} /> : model.screen === 'new-object' || model.screen === 'object' ? <ObjectEditor model={model} /> : model.screen === 'views' ? <Views model={model} /> : <View model={model} />}</main><footer class="workspace-footer">Objects are yours. Views are ways to see them.</footer></div>
    <button class="panel-backdrop" data-panel-backdrop="" type="button" aria-label="Close open panel" hidden></button><AiPanel model={model} /></div><script type="module" src="/objects-client.js"></script></body></html>).toString();
}
