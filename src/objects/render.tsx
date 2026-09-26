import type { JSX } from 'hono/jsx/jsx-runtime';
import { raw } from 'hono/html';
import { renderMarkdown } from './markdown.js';
import { Badge, Button, ButtonLink, EmptyState, Icon, PageHeading, type IconName } from './ui.js';
import { BUILTIN_PROPERTIES, BUILTIN_TYPES, EVENT_DATES_PROPERTY_ID, EVENT_TIME_PROPERTY_ID, EVENT_TYPE_ID, JOURNAL_DATE_PROPERTY_ID, JOURNAL_TYPE_ID, PAGE_TYPE_ID, REMINDER_DATE_PROPERTY_ID, REMINDER_TIME_PROPERTY_ID, REMINDER_TYPE_ID, TASK_DONE_PROPERTY_ID, TASK_DUE_PROPERTY_ID, TASK_TYPE_ID } from './model.js';
import type { EvaluatedBlock, ObjectPageModel, ObjectRecord, PropertyDefinition, PropertyValue, SavedView, ViewRow } from './model.js';

const Hidden = ({ name, value }: { name: string; value: string | number }) => <input type="hidden" name={name} value={value} />;
const Token = ({ model }: { model: ObjectPageModel }) => <Hidden name="csrf" value={model.csrf} />;
const State = ({ message, error = false }: { message?: string; error?: boolean }) => <p class={`form-state${error ? ' error' : ''}`} data-form-state="" role={error ? 'alert' : 'status'} aria-live={error ? 'assertive' : 'polite'}>{message}</p>;
const titleOf = (record: ObjectRecord) => record.title || 'Untitled';
const objectUrl = (id: string) => `/objects/${encodeURIComponent(id)}`;
const typeName = (model: ObjectPageModel, id: string) => model.catalog.types.find(type => type.id === id)?.name ?? 'Unknown type';
const propertyOf = (model: ObjectPageModel, id: string) => model.catalog.properties.find(property => property.id === id);
const isRange = (value: PropertyValue | undefined | null): value is { start: string; end: string; timeZone?: string } => Boolean(value && typeof value === 'object' && !Array.isArray(value));

function typeIcon(typeId: string): IconName {
  switch (typeId) {
    case PAGE_TYPE_ID: return 'page';
    case TASK_TYPE_ID: return 'tasks';
    case EVENT_TYPE_ID: return 'calendar';
    case JOURNAL_TYPE_ID: return 'journal';
    case REMINDER_TYPE_ID: return 'reminder';
    default: return 'type';
  }
}

function WorkspaceNav({ model }: { model: ObjectPageModel }) {
  const browsing = model.screen === 'objects' && !model.section && !model.trashed;
  const currentType = model.selectedTypeId ?? model.object?.typeId;
  const links: { href: string; label: string; icon: IconName; active: boolean }[] = [
    { href: '/', label: 'Objects', icon: 'objects', active: model.screen === 'home' && !model.trashed },
    { href: '/?focus=search', label: 'Search', icon: 'search', active: browsing && !currentType },
    { href: '/calendar', label: 'Calendar', icon: 'calendar', active: model.section === 'calendar' },
    { href: '/tasks', label: 'Tasks', icon: 'tasks', active: model.section === 'tasks' },
    { href: '/journal', label: 'Journal', icon: 'calendar', active: model.screen === 'journal' },
    { href: '/views', label: 'Views', icon: 'views', active: !model.section && (model.screen === 'views' || model.screen === 'view') },
  ];
  return <nav id="workspace-nav" class="workspace-nav" aria-label="Workspace">
    <div class="nav-brand"><a class="brand" href="/"><span class="brand-mark"><Icon name="objects" /></span>Taskdesk</a><Button class="icon-button js-only nav-close" type="button" data-nav-close="" aria-label="Close navigation"><Icon name="close" /></Button></div>
    <ButtonLink variant="primary" class="nav-new" href="/objects/new" aria-current={model.screen === 'new-object' ? 'page' : undefined}><Icon name="plus" />New content</ButtonLink>
    <div class="nav-links">{links.map(link => <a href={link.href} data-object-search={link.icon === 'search' ? '' : undefined} aria-keyshortcuts={link.icon === 'search' ? 'Control+k Meta+k' : undefined} aria-current={link.active ? 'page' : undefined}><Icon name={link.icon} /><span>{link.label}</span>{link.icon === 'search' && <kbd class="js-only">Ctrl/⌘ K</kbd>}</a>)}</div>
    <section class="nav-section js-only" aria-labelledby="pinned-heading"><h2 id="pinned-heading">Pinned views</h2><p class="nav-hint" data-pins-empty="">Pin a view to keep it here.</p><div class="nav-links">{model.views.map(view => <a href={`/views/${view.id}`} data-pinned-view="" data-view-id={view.id} hidden aria-current={model.evaluatedView?.view.id === view.id ? 'page' : undefined}><Icon name="pin" /><span>{view.spec.title}</span></a>)}</div></section>
    <section class="nav-section" aria-labelledby="object-types-heading"><h2 id="object-types-heading">Object types</h2><div class="nav-links">{model.catalog.types.map((type, index) => <a href={`/?type=${encodeURIComponent(type.id)}`} aria-current={!model.section && !model.trashed && currentType === type.id ? 'page' : undefined}><span class={`type-icon type-accent-${index % 5}`}><Icon name={typeIcon(type.id)} /></span><span>{type.name}</span></a>)}<a class="nav-manage" href="/types" aria-current={model.screen === 'types' || model.screen === 'type' ? 'page' : undefined}><Icon name="settings" /><span>Manage types</span></a></div></section>
    <div class="nav-bottom nav-links"><a href="/?trash=1" aria-current={model.trashed ? 'page' : undefined}><Icon name="trash" /><span>Trash</span></a><p class="nav-hint">Your objects. Your workspace.</p></div>
  </nav>;
}

function AiEmpty({ model }: { model: ObjectPageModel }) {
  const available = (id: string) => model.catalog.types.some(type => type.id === id);
  return <div class="ai-empty">
    <span class="ai-empty-icon"><Icon name="ai" /></span>
    <h3>A new perspective on your objects</h3>
    <p data-ai-empty-description="">Describe a list, table, calendar, or board. This AI assistant generates and refines views—it cannot write or change your objects.</p>
    <div class="ai-suggestions js-only" data-ai-suggestions="" hidden>
      <span class="fine">Start with an idea</span>
      {available(TASK_TYPE_ID) && <Button class="ai-suggestion" data-ai-suggestion="Create a board of Task objects grouped by Done, showing their Due dates."><Icon name="tasks" />A task board<Icon name="arrow" /></Button>}
      {available(EVENT_TYPE_ID) && <Button class="ai-suggestion" data-ai-suggestion="Create an upcoming calendar of Event objects. Use separate calendar blocks for All-day dates and Event time, filtering out empty values in each."><Icon name="calendar" />An upcoming calendar<Icon name="arrow" /></Button>}
      {available(PAGE_TYPE_ID) && <Button class="ai-suggestion" data-ai-suggestion="Create a list of Page objects as a page library."><Icon name="page" />A page library<Icon name="arrow" /></Button>}
    </div>
    <p class="fine native-only">Try “Show my projects grouped by status.”</p>
  </div>;
}

function AiPanel({ model }: { model: ObjectPageModel }) {
  const previous = model.screen === 'view' ? model.evaluatedView?.view : undefined;
  const previousId = model.aiPreviousId ?? previous?.id;
  return <aside id="ai-panel" class="ai-panel" hidden={!model.aiOpen} aria-labelledby="ai-heading">
    <div class="ai-resize js-only" data-ai-resize="" role="separator" tabindex={0} aria-label="Resize AI panel" aria-orientation="vertical" aria-valuemin={320} aria-valuemax={560} aria-valuenow={380}></div>
    <header class="ai-header"><div><Icon name="ai" /><h2 id="ai-heading">View assistant</h2></div><div class="ai-header-actions"><Button class="icon-button js-only" type="button" data-ai-new="" aria-label="Start a new conversation" title="New conversation"><Icon name="plus" /></Button><Button class="icon-button js-only" type="button" data-ai-close="" aria-label="Close view assistant"><Icon name="close" /></Button><ButtonLink variant="ghost" class="icon-button native-only" href={previous ? `/views/${previous.id}` : '/views'} aria-label="Close view assistant"><Icon name="close" /></ButtonLink></div></header>
    <div class="ai-context"><span class="fine">Working on</span><span class="context-chip" data-ai-context-label="">{model.aiContextTitle ?? previous?.spec.title ?? 'New view'}</span></div>
    <div class="ai-turns" data-ai-turns="" aria-live="polite" aria-relevant="additions text"><AiEmpty model={model} /></div>
    <template data-ai-empty-template=""><AiEmpty model={model} /></template>
    <div class="ai-composer"><form data-ai-form="" method="post" action="/views/generate"><Token model={model} />{model.aiConversationId ? <Hidden name="conversationId" value={model.aiConversationId} /> : previousId && <Hidden name="previousId" value={previousId} />}<label for="ai-prompt">Describe your view<textarea id="ai-prompt" name="prompt" rows={4} required maxlength={4000} placeholder="What would you like to see?">{model.prompt ?? ''}</textarea></label><div class="ai-submit-row"><span class="fine">Creates a draft to review</span><Button type="submit" variant="primary"><Icon name="ai" />Generate view</Button></div><p class={`form-state${model.error ? ' error' : ''}`} data-ai-status="" role="status">{model.aiOpen ? model.error : undefined}</p></form><details class="ai-privacy"><summary>What is shared with AI?</summary><p>Your prompt, conversation prompts, type and property schema, and any previous view specification go to your configured model provider. Object titles, property values, and note bodies are not sent. Successful prompts and view results are saved in this workspace.</p></details></div>
  </aside>;
}

function PropertyControl({ model, property, value, name = `p:${property.id}`, required = false }: { model: ObjectPageModel; property: PropertyDefinition; value?: PropertyValue | null; name?: string; required?: boolean }) {
  const id = `field-${crypto.randomUUID()}`;
  const fields = name.startsWith('p:') ? model.objectDraft?.fields : undefined;
  const scalar = fields?.[name]?.[0] ?? (typeof value === 'string' || typeof value === 'number' ? String(value) : '');
  if (property.kind === 'boolean') return <label class="check"><input type="checkbox" name={name} value="true" checked={fields?.[name] ? ['true', 'on'].includes(fields[name]?.[0] ?? '') : value === true} />{property.label}</label>;
  if (property.kind === 'date-range' || property.kind === 'time-range') {
    const range = isRange(value) ? value : undefined;
    return <fieldset class="range-field"><legend>{property.label}</legend><div class="range-inputs">
      <label>Start<input name={`${name}:start`} type={property.kind === 'date-range' ? 'date' : 'text'} value={fields?.[`${name}:start`]?.[0] ?? range?.start ?? ''} aria-describedby={`${id}-help`} /></label>
      <label>End<input name={`${name}:end`} type={property.kind === 'date-range' ? 'date' : 'text'} value={fields?.[`${name}:end`]?.[0] ?? range?.end ?? ''} aria-describedby={`${id}-help`} /></label>
      {property.kind === 'time-range' && <label>Time zone<input name={`${name}:timeZone`} type="text" value={fields?.[`${name}:timeZone`]?.[0] ?? range?.timeZone ?? ''} placeholder="Europe/London" /></label>}
    </div><small id={`${id}-help`}>{property.kind === 'time-range' ? 'ISO timestamps with offsets, for example 2026-09-24T09:00:00+01:00.' : 'End is exclusive: for one all-day event on September 24, use September 24 to September 25. Fill both dates, or clear both to leave unset.'}</small></fieldset>;
  }
  if (property.kind === 'select') return <label>{property.label}<select name={name}><option value="" selected={!scalar}>Not set</option>{property.options?.map(option => <option value={option.id} selected={scalar === option.id}>{option.label}</option>)}</select></label>;
  if (property.kind === 'reference') {
    const selected = fields?.[name]?.filter(Boolean) ?? (Array.isArray(value) ? value : typeof value === 'string' ? [value] : []);
    const candidates = model.objects.filter(record => (!property.targetTypeId || record.typeId === property.targetTypeId) && !record.trashed);
    const missing = selected.filter(item => !candidates.some(record => record.id === item));
    return <label>{property.label}<select name={name} multiple={property.multiple} size={property.multiple ? 4 : undefined}>
      {!property.multiple && <option value="" selected={!selected.length}>Not set</option>}
      {candidates.map(record => <option value={record.id} selected={selected.includes(record.id)}>{titleOf(record)} · {typeName(model, record.typeId)}</option>)}
      {missing.map(item => <option value={item} selected>{model.objects.find(record => record.id === item)?.title || `Linked object ${item}`}</option>)}
    </select>{property.multiple && <small>Choose multiple with Ctrl or Command. Clear the selection to remove all links.</small>}</label>;
  }
  return <label>{property.label}<input name={name} type={property.kind === 'number' ? 'number' : property.kind === 'date' ? 'date' : 'text'} step={property.kind === 'number' ? 'any' : undefined} value={scalar} required={required} data-journal-date={property.id === JOURNAL_DATE_PROPERTY_ID ? '' : undefined} aria-describedby={property.kind === 'datetime' ? `${id}-help` : undefined} />{property.kind === 'datetime' && <small id={`${id}-help`}>ISO timestamp with offset, for example 2026-09-24T09:00:00+01:00.</small>}</label>;
}

function Value({ model, propertyId, value }: { model: ObjectPageModel; propertyId: string; value: PropertyValue | undefined }): JSX.Element {
  const property = propertyOf(model, propertyId);
  if (value === undefined || value === '' || (Array.isArray(value) && !value.length)) return <span class="muted">Not set</span>;
  if (isRange(value)) return <span class="range-value"><span>{value.start}</span><span> to </span><span>{value.end}</span>{value.timeZone && <small> ({value.timeZone})</small>}</span>;
  if (property?.kind === 'reference') return <span class="reference-values">{(Array.isArray(value) ? value : [String(value)]).map(id => <a href={objectUrl(id)}>{model.objects.find(record => record.id === id)?.title || `Linked object ${id}`}</a>)}</span>;
  if (property?.kind === 'select') return <span>{property.options?.find(option => option.id === value)?.label ?? String(value)}</span>;
  return <span>{typeof value === 'boolean' ? value ? 'Yes' : 'No' : Array.isArray(value) ? value.join(', ') : String(value)}</span>;
}

function ObjectHome({ model }: { model: ObjectPageModel }) {
  const objectCount = Object.values(model.typeCounts ?? {}).reduce((total, count) => total + count, 0);
  return <>
    <div class="workspace-intro">
    <PageHeading eyebrow={model.trashed ? 'Your workspace, recoverable' : 'Your personal workspace'} title={model.trashed ? 'Trash' : 'Objects'} description={model.trashed ? 'Choose a type to find objects you can restore.' : 'A place for your thoughts, plans, and everyday details.'}>
      {!model.trashed && <><ButtonLink href="/types#create-type"><Icon name="plus" />New type</ButtonLink><ButtonLink variant="primary" href="/objects/new"><Icon name="plus" />New content</ButtonLink></>}
    </PageHeading>
    <dl class="workspace-summary" aria-label="Workspace summary">
      <div><dt>{model.trashed ? 'Objects in trash' : 'Objects'}</dt><dd>{objectCount}</dd></div>
      <div><dt>Object types</dt><dd>{model.catalog.types.length}</dd></div>
      {!model.trashed && <div><dt>Saved views</dt><dd>{model.views.length}</dd></div>}
    </dl>
    </div>
    <div class="browse-heading"><h2>Browse by type</h2><p class="fine">Everything in its own place.</p></div>
    <div class="type-cards type-browser">
      {model.catalog.types.map((type, index) => {
        const count = model.typeCounts?.[type.id] ?? 0;
        const builtin = BUILTIN_TYPES.find(item => item.id === type.id);
        const description = builtin?.description ?? (type.propertyIds.length ? type.propertyIds.map(id => propertyOf(model, id)?.label).filter(Boolean).join(' · ') : 'A title and space to write. Make it your own.');
        const query = new URLSearchParams({ type: type.id, ...(model.trashed ? { trash: '1' } : {}) });
        return <a class={`type-card type-browse-card type-accent-${index % 5}`} href={`/?${query}`}>
          <div class="type-card-top"><span class={`type-card-icon type-accent-${index % 5}`}><Icon name={typeIcon(type.id)} /></span><Badge>{count} {count === 1 ? 'object' : 'objects'}</Badge></div>
          <h2>{type.name}</h2>
          <p class="muted">{description}</p>
          <span class="type-card-footer"><span>Browse {type.name}</span><Icon name="arrow" /></span>
        </a>;
      })}
    </div>
  </>;
}

function Objects({ model }: { model: ObjectPageModel }) {
  const layout = model.browseLayout ?? 'list';
  const offset = model.offset ?? 0;
  const selectedType = model.selectedTypeId ? typeName(model, model.selectedTypeId) : undefined;
  const path = model.section === 'tasks' ? '/tasks' : '/';
  const query = (pageOffset: number, selectedLayout = layout, trash = model.trashed) => `${path}?${new URLSearchParams({
    ...(model.selectedTypeId && model.section !== 'tasks' ? { type: model.selectedTypeId } : {}),
    ...(!model.selectedTypeId ? { focus: 'search' } : {}),
    ...(model.search ? { q: model.search } : {}),
    ...(trash ? { trash: '1' } : {}),
    layout: selectedLayout,
    offset: String(pageOffset),
  })}`;
  let heading = selectedType ?? 'Search';
  if (model.trashed) heading = selectedType ? `${selectedType} · Trash` : 'Search trash';
  let emptyMessage = 'Enter a title or phrase to search across types.';
  if (model.search?.trim()) emptyMessage = 'No objects match your search.';
  else if (model.trashed) emptyMessage = 'No objects of this type in the trash.';
  else if (selectedType) emptyMessage = `No ${selectedType} objects yet. Create one to get started.`;
  return <>
    {selectedType && <a class="back-link" href={model.trashed ? '/?trash=1' : '/'}>← Object types</a>}
    <PageHeading title={heading} description={!selectedType ? 'Find objects across your types.' : undefined}>
      {selectedType && !model.trashed && <ButtonLink variant="primary" href={`/objects/new?type=${encodeURIComponent(model.selectedTypeId!)}`}><Icon name="plus" />New object</ButtonLink>}
    </PageHeading>
    <div class="browse-toolbar">
      <form class="filter-bar" method="get" action={path}>
        <label>{selectedType ? `Search ${selectedType}` : 'Search'}<input type="search" name="q" value={model.search ?? ''} maxlength={200} /></label>
        {model.selectedTypeId ? model.section !== 'tasks' && <Hidden name="type" value={model.selectedTypeId} /> : <>
          <Hidden name="focus" value="search" />
          <label>Type<select name="type"><option value="">All types</option>{model.catalog.types.map(type => <option value={type.id}>{type.name}</option>)}</select></label>
        </>}
        <Hidden name="layout" value={layout} />
        {model.trashed && <Hidden name="trash" value="1" />}
        <Button type="submit">Search</Button>
      </form>
      {selectedType && <nav class="layout-switch" aria-label="Object layout">
        <a href={query(offset, 'list')} aria-current={layout === 'list' ? 'page' : undefined}><Icon name="tasks" />List</a>
        <a href={query(offset, 'gallery')} aria-current={layout === 'gallery' ? 'page' : undefined}><Icon name="objects" />Gallery</a>
      </nav>}
    </div>
    {model.objects.length ? <ul class={layout === 'gallery' ? 'object-gallery' : 'object-index'} aria-label={selectedType ? `${selectedType} objects` : 'Search results'} data-object-results="">
      {model.objects.map(record => <li>
        {layout === 'gallery' ? <a class="object-card" href={objectUrl(record.id)}>
          <div class="object-card-heading"><Icon name={typeIcon(record.typeId)} /><strong>{titleOf(record)}</strong></div>
          {!selectedType && <span class="fine">{typeName(model, record.typeId)}</span>}
          <p class="object-card-excerpt">{model.objectExcerpts?.[record.id] || 'No writing yet.'}</p>
          <time datetime={record.updatedAt}>Updated {record.updatedAt.slice(0, 10)}</time>
        </a> : <>
          <a href={objectUrl(record.id)}><strong>{titleOf(record)}</strong>{!selectedType && <span>{typeName(model, record.typeId)}</span>}</a>
          <time datetime={record.updatedAt} aria-label={`Updated ${record.updatedAt.slice(0, 10)}`}>{record.updatedAt.slice(0, 10)}</time>
        </>}
      </li>)}
    </ul> : <EmptyState icon={model.trashed ? 'trash' : 'objects'} title={model.search?.trim() ? 'No matches found' : model.trashed ? 'Nothing to restore here' : selectedType ? `Your ${selectedType} collection starts here` : 'Find something in your workspace'}><p>{emptyMessage}</p></EmptyState>}
    <div class="browse-footer">
      {selectedType && <a href={query(0, layout, !model.trashed)}>{model.trashed ? `Back to ${selectedType}` : `${selectedType} trash`}</a>}
      <nav class="pagination" aria-label="Object pages">
        {offset > 0 && <a href={query(Math.max(0, offset - 50))}>Previous</a>}
        {model.hasMore && <a href={query(offset + 50)}>Next</a>}
      </nav>
    </div>
    {model.section === 'tasks' && <div class="view-invitation"><Icon name="ai" /><div><strong>See your tasks differently</strong><p>Generate a board or calendar using your existing task properties.</p></div><ButtonLink href="/views?ai=1" data-ai-start="">Create task view</ButtonLink></div>}
  </>;
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
  const base = model.typeDraft?.basedOnTypeId ?? model.basedOnTypeId;
  return <>
    <PageHeading eyebrow="Shape your workspace" title="Object types" description="Built-in foundations and your own independent types."><ButtonLink href="#create-type"><Icon name="plus" />New type</ButtonLink></PageHeading>
    <div class="type-cards">{model.catalog.types.map((type, index) => {
      const builtin = BUILTIN_TYPES.find(item => item.id === type.id);
      return <article class="type-card"><span class={`type-card-icon type-accent-${index % 5}`}><Icon name={typeIcon(type.id)} /></span><h2><a href={`/types/${type.id}`}>{type.name}</a></h2>
        {builtin && <Badge>Protected {builtin.name} · customizable</Badge>}
        <p class="muted">{type.propertyIds.length ? type.propertyIds.map(id => propertyOf(model, id)?.label).filter(Boolean).join(' · ') : 'A title and space to write. No extra properties yet.'}</p>
        <div class="type-card-footer"><span class="fine">{type.propertyIds.length} {type.propertyIds.length === 1 ? 'property' : 'properties'}</span><a href={`/objects/new?type=${type.id}`} aria-label={`New ${type.name}`}>Create object →</a></div>
      </article>;
    })}</div>
    <section class="creation-panel" id="create-type">
      <div><span class="eyebrow">Make it your own</span><h2>Create a type</h2><p class="muted">Start empty or copy another type’s current properties.</p><p class="fine" id="based-on-help">Copied properties share their identities and labels; each object keeps its own values. Your new type is independent: it does not inherit built-in rules or future fields. A copy of Journal is not another daily journal.</p></div>
      <form method="post" action="/types/create" data-enhance="" data-type-create="" data-draft={model.typeDraft ? 'true' : undefined}>
        <Token model={model} /><label>Type name<input name="name" value={model.typeDraft?.name ?? ''} required maxlength={100} placeholder="e.g. Book, Project, or Person" autocomplete="off" aria-describedby="type-name-help" /></label>
        <small id="type-name-help">Name one thing, like “Book”, rather than a collection.</small>
        <label>Based on<select name="basedOnTypeId" aria-describedby="based-on-help"><option value="" selected={!base}>Empty type</option>{model.catalog.types.map(type => <option value={type.id} selected={base === type.id}>{type.name}</option>)}{base && !model.catalog.types.some(type => type.id === base) && <option value={base} selected>Unavailable type</option>}</select></label>
        <div class="type-name-preview" aria-hidden="true"><span class="type-card-icon"><Icon name="type" /></span><div><strong data-type-name-preview="">{model.typeDraft?.name || 'Your new type'}</strong><small>Title · Writing · Your properties</small></div></div>
        <Button variant="primary" type="submit">Create type &amp; add properties</Button><State />
      </form>
    </section>
  </>;
}

function TypeEditor({ model }: { model: ObjectPageModel }) {
  const type = model.objectType;
  if (!type) return <p class="empty">Type not found.</p>;
  const available = model.catalog.properties.filter(property => !type.propertyIds.includes(property.id));
  const builtin = BUILTIN_TYPES.find(item => item.id === type.id);
  return <><a class="back-link" href="/types">← All types</a><PageHeading eyebrow="Type setup" title={type.name} description={`Choose the details that make a ${type.name} useful to you.`}><ButtonLink variant="primary" href={`/objects/new?type=${type.id}`}><Icon name="plus" />Create object</ButtonLink></PageHeading>
    {builtin && <p class="notice"><strong>Protected {builtin.name} · customizable.</strong> Its identity and core fields remain available. Rename this type, rename field labels, and add your own fields. {builtin.description}</p>}
    <p><a href={`/types?basedOnTypeId=${type.id}#create-type`}>Create an independent type based on {type.name}</a></p>
    <details class="type-settings"><summary>Rename type</summary><form class="inline-form" method="post" action={`/types/${type.id}/update`} data-enhance=""><Token model={model} /><Hidden name="revision" value={type.revision} /><label>Type name<input name="name" value={type.name} required maxlength={100} /></label><Button type="submit">Save name</Button><State /></form></details>
    <section class="type-properties"><div class="section-heading"><h2>Object properties</h2><Badge>{type.propertyIds.length} fields</Badge></div><p class="muted">Core field rules apply to built-in types. Additional fields are optional.</p><div class="built-in-properties"><span>Title <small>Built in</small></span><span>Writing <small>Built in</small></span></div>
      {type.propertyIds.length ? <ul class="property-list property-cards">{type.propertyIds.map(id => { const property = propertyOf(model, id); const sharedWith = model.catalog.types.filter(item => item.id !== type.id && item.propertyIds.includes(id)); return property && <li><div class="property-card-heading"><strong>{property.label}</strong><Badge>{kindLabel(property)}</Badge>{BUILTIN_PROPERTIES.some(item => item.id === id) && <Badge>Protected core field</Badge>}</div>{property.options?.length ? <div class="option-chips">{property.options.map(option => <Badge>{option.label}</Badge>)}</div> : null}{property.targetTypeId && <p class="muted">Links to {typeName(model, property.targetTypeId)}{property.multiple ? ' · multiple links' : ''}</p>}<details><summary>Rename property</summary><p class="fine">{sharedWith.length ? `Shared with ${sharedWith.map(item => item.name).join(', ')}. Renaming changes the label there too.` : 'Renaming keeps existing values and views connected.'}</p><form class="inline-form" method="post" action={`/properties/${id}/update`} data-enhance=""><Token model={model} /><Hidden name="revision" value={property.revision} /><label>Property label<input name="label" value={property.label} required maxlength={100} /></label><Button type="submit">Save label</Button><State /></form></details></li>; })}</ul> : <div class="empty property-empty"><Icon name="type" /><div><strong>Start simple. Add structure when you need it.</strong><p>You can create objects now, or add a property below. Existing objects keep their writing.</p></div></div>}</section>
    <div class="two-columns property-builders"><section class="panel"><h2>Add a property</h2><p class="muted">What would you like to keep track of?</p><form method="post" action={`/types/${type.id}/properties`} data-enhance=""><Token model={model} /><Hidden name="revision" value={type.revision} /><label>Property label<input name="label" required maxlength={100} placeholder="e.g. Status, Due date, or Author" /></label><label>Property format<select name="kind" data-property-kind="" aria-describedby="property-kind-help">{propertyKinds.map(kind => <option value={kind.value} data-help={kind.help}>{kind.label}</option>)}</select></label><p class="kind-help fine" id="property-kind-help" data-kind-help="">{propertyKinds[0].help}</p><div data-kind-options="select"><label>Choices<textarea name="options" rows={4} placeholder={'Not started\nIn progress\nDone'}></textarea></label><small>One choice per line. Required for a Select property.</small></div><div data-kind-options="reference"><label>Link to type<select name="targetTypeId"><option value="">Choose a type</option>{model.catalog.types.map(item => <option value={item.id}>{item.name}</option>)}</select></label><label class="check"><input type="checkbox" name="multiple" value="true" />Allow multiple object links</label><small>Only objects of this type can be linked.</small></div><Button variant="primary" type="submit"><Icon name="plus" />Add property</Button><State /></form></section>
    <section class="panel reuse-property"><span class="eyebrow">Keep things connected</span><h2>Use an existing property</h2><p class="muted">Already tracking this elsewhere? Reuse the same property so views can bring your objects together.</p>{available.length ? <form method="post" action={`/types/${type.id}/properties`} data-enhance=""><Token model={model} /><Hidden name="revision" value={type.revision} /><label>Shared property<select name="propertyId" required><option value="" selected>Choose a property</option>{available.map(property => <option value={property.id}>{property.label} · {kindLabel(property)}</option>)}</select></label><p class="fine">Labels and choices are shared. Each object keeps its own value.</p><Button type="submit">Use property</Button><State /></form> : <p class="fine">No other properties to reuse yet. New properties you add will be available to other types.</p>}</section></div></>;
}

function JournalDiscovery({ model }: { model: ObjectPageModel }) {
  return <div data-journal-discovery="" class="journal-discovery" hidden={!model.journal}>
    {model.journal && <p>This date already has a journal{model.journal.trashed ? ' in trash' : ''}. <a href={objectUrl(model.journal.id)}>{model.journal.trashed ? 'Open existing journal to restore it' : 'Open existing journal'}</a>. Your draft is not merged or discarded.</p>}
  </div>;
}

function Journal({ model }: { model: ObjectPageModel }) {
  return <>
    <PageHeading title="Journal" description="One journal per calendar date, including journals in trash." />
    <form class="filter-bar" method="get" action="/journal" data-journal-picker="" data-local-date-default={model.journalDateDefault ? 'true' : undefined}>
      <label>Journal date<input name="date" type="date" required value={model.journalDate ?? ''} /></label><Button type="submit">Find journal</Button><ButtonLink href="/journal" data-journal-today="">Today</ButtonLink>
    </form>
    <JournalDiscovery model={model} />
    <section class="panel">
      <h2>Open your daily journal</h2><p class="muted">Opening an existing day keeps its writing and revision. Opening a new day creates an empty journal. Journals in trash are never restored automatically.</p>
      <form method="post" action="/journal/open" data-enhance="" data-journal-open="">
        <Token model={model} /><Hidden name="date" value={model.journalDate ?? ''} /><Button variant="primary" type="submit">Open journal for <span data-journal-day="">{model.journalDate}</span></Button><State />
      </form>
      <p class="fine">Find a date above, then open it. Nothing is created by viewing this page.</p>
    </section>
  </>;
}

function BuiltinRules({ model, typeId }: { model: ObjectPageModel; typeId: string }) {
  const label = (id: string) => propertyOf(model, id)?.label ?? 'field';
  return <div class="builtin-rules">
    <p class="fine" data-builtin-rule={TASK_TYPE_ID} hidden={typeId !== TASK_TYPE_ID}>Use {label(TASK_DONE_PROPERTY_ID)} to mark completion; unchecked means not done. {label(TASK_DUE_PROPERTY_ID)} is optional.</p>
    <p class="fine" data-builtin-rule={EVENT_TYPE_ID} hidden={typeId !== EVENT_TYPE_ID}>Choose exactly one: {label(EVENT_DATES_PROPERTY_ID)} for all-day dates, or {label(EVENT_TIME_PROPERTY_ID)} for a timed event. Clear the other range. All-day end is exclusive: a one-day event ends on the following date.</p>
    <p class="fine" data-builtin-rule={REMINDER_TYPE_ID} hidden={typeId !== REMINDER_TYPE_ID}>Choose exactly one: {label(REMINDER_DATE_PROPERTY_ID)} or {label(REMINDER_TIME_PROPERTY_ID)}. Clear the other field. A Reminder is only a calendar item; it does not send notifications or repeat.</p>
    <p class="fine" data-builtin-rule={JOURNAL_TYPE_ID} hidden={typeId !== JOURNAL_TYPE_ID}>{label(JOURNAL_DATE_PROPERTY_ID)} requires a real calendar date. Each date has one canonical Journal, even in trash. Changing its date cannot overwrite another journal. <a href="/journal">Find a daily journal</a>.</p>
  </div>;
}

function ObjectSearch() {
  return <dialog class="object-search" id="object-search" aria-labelledby="object-search-heading">
    <header><h2 id="object-search-heading">Find an object</h2><Button variant="ghost" class="icon-button" type="button" data-search-close="" aria-label="Close search"><Icon name="close" /></Button></header>
    <form method="get" action="/" data-object-search-form="">
      <label>Search title or writing<input type="search" name="q" maxlength={200} autocomplete="off" autofocus /></label>
      <Button type="submit">Search</Button>
    </form>
    <p class="fine" data-search-status="" role="status">Press Enter to search. Use arrow keys or Tab to choose a result.</p>
    <ul class="object-index" data-search-results="" aria-label="Matching objects"></ul>
    <div class="search-hints" aria-hidden="true"><span><kbd>↑</kbd><kbd>↓</kbd> navigate</span><span><kbd>Enter</kbd> select</span><span><kbd>Esc</kbd> close</span></div>
  </dialog>;
}

function SavedConflict({ model }: { model: ObjectPageModel }) {
  const record = model.object;
  if (!record) return null;
  const propertyIds = [...new Set([...(model.catalog.types.find(type => type.id === record.typeId)?.propertyIds ?? []), ...Object.keys(record.properties)])];
  return <>
    <h2 id="conflict-heading">Compare before saving</h2>
    <p>Your draft is still in the editor. Review the saved version below and reconcile your title, type, details, and writing. <strong>Save reconciled changes</strong> replaces this version; another concurrent change will still be rejected.</p>
    <h3>Latest saved version · revision {record.revision}</h3>
    <dl class="saved-details">
      <dt>Title</dt><dd>{titleOf(record)}</dd>
      <dt>Type</dt><dd>{typeName(model, record.typeId)}</dd>
      {propertyIds.map(id => <><dt>{propertyOf(model, id)?.label ?? id}</dt><dd><Value model={model} propertyId={id} value={record.properties[id]} /></dd></>)}
    </dl>
    <h3>Saved writing</h3>
    <div class="markdown-content">{raw(renderMarkdown(record.body))}</div>
    <details><summary>Saved Markdown source</summary><pre class="saved-source">{`\n${record.body}`}</pre></details>
    <p><a href="#writing-area">Back to your draft</a></p>
  </>;
}

function ObjectEditor({ model }: { model: ObjectPageModel }) {
  const record = model.object;
  const draft = model.objectDraft;
  const type = model.catalog.types.find(item => item.id === draft?.typeId) ?? (record ? model.catalog.types.find(item => item.id === record.typeId) : model.objectType ?? model.catalog.types.find(item => item.id === model.selectedTypeId) ?? model.catalog.types[0]);
  if (!type) return <p>Create a <a href="/types">type</a> before creating an object.</p>;
  const retainedIds = Object.keys(record?.properties ?? {});
  const propertyIds = [...new Set([...model.catalog.types.flatMap(item => item.propertyIds), ...retainedIds])];
  const activeIds = new Set([...type.propertyIds, ...retainedIds]);
  const body = draft?.body ?? record?.body ?? '';
  const propertyCount = activeIds.size;
  const journalDate = !record ? model.journalDate : undefined;
  let state = 'Not saved yet.';
  if (record) state = model.notice ? 'Saved. Further edits need saving.' : 'Save to apply edits.';
  if (draft) state = 'Unsaved changes';
  if (model.error) state = model.error;
  const conflict = Boolean(record && draft?.revision && Number(draft.revision) !== record.revision);
  return <><h1 class="sr-only">{record ? 'Edit object' : 'New object'}</h1><a class="back-link" data-object-back="" href={`/?type=${type.id}`}>← {type.name} objects</a>{record?.trashed && <Badge tone="warning">In trash</Badge>}
    {record && <nav class="object-sections" aria-label="Object sections"><a href="#writing-area">Writing</a><a href="#object-backlinks">Linked from</a></nav>}
    <div class={`object-editing${conflict ? ' has-conflict' : ''}`}>
    <form id="object-editor" class="object-editor" method="post" action={record ? `/objects/${record.id}/update` : '/objects/create'} data-enhance="" data-object-editor="" data-new-object={!record ? 'true' : undefined} data-local-date-default={!record && !draft && model.journalDateDefault ? 'true' : undefined} data-draft={draft ? 'true' : undefined}><Token model={model} />{record ? <Hidden name="revision" value={draft?.revision ?? record.revision} /> : <Hidden name="requestId" value={draft?.requestId ?? crypto.randomUUID()} />}
      <label class="title-field"><span class="sr-only">Title</span><input name="title" value={draft?.title ?? record?.title ?? (type.id === JOURNAL_TYPE_ID ? journalDate ?? '' : '')} data-journal-title-default={!record && !draft && type.id === JOURNAL_TYPE_ID ? 'true' : undefined} required maxlength={500} autocomplete="off" placeholder="Untitled" /></label>
      <section class="properties" aria-labelledby="object-properties-heading">
        <header class="properties-heading"><h2 id="object-properties-heading">Properties <Badge data-property-count="" hidden={!propertyCount}>{propertyCount}</Badge></h2><span class="fine" data-object-type-label="">{type.name}</span></header>
        <div class="object-type-picker">
          <label>Object type<select name="typeId" data-new-type="">{model.catalog.types.map(item => <option value={item.id} selected={item.id === type.id}>{item.name}</option>)}</select></label>
          {!record && <a href="/types#create-type">Create a new type</a>}
          <p class="fine">{record ? 'Changing type keeps existing values.' : 'Choose a type, then add its details.'}<span class="native-only"> Choose Use type below to load its fields without saving or losing your writing.</span></p>
        </div>
        <p class="fine" data-properties-empty="" hidden={propertyCount > 0}>No additional properties. <a href={`/types/${type.id}`} data-type-setup="">Manage type</a></p>
        <BuiltinRules model={model} typeId={type.id} />
        <div class="property-grid">{propertyIds.map(id => {
          const property = propertyOf(model, id);
          if (!property) return null;
          const active = activeIds.has(id);
          const fields = Object.entries(draft?.fields ?? {}).filter(([name]) => name === `p:${id}` || name.startsWith(`p:${id}:`));
          return <>
            {!active && fields.flatMap(([name, values]) => values.map(value => <input type="hidden" name={`draft:${name}`} value={value} data-inactive-draft="" />))}
            <fieldset class="object-property" data-type-ids={model.catalog.types.filter(item => item.propertyIds.includes(id)).map(item => item.id).join(' ')} data-retained={retainedIds.includes(id) ? 'true' : undefined} hidden={!active} disabled={!active}>
              <legend class="sr-only">{property.label}</legend>
              {property.kind === 'boolean' && <Hidden name={`draft:p:${id}`} value="false" />}
              {property.kind === 'reference' && property.multiple && <Hidden name={`draft:p:${id}`} value="" />}
              <PropertyControl model={model} property={property} required={id === JOURNAL_DATE_PROPERTY_ID && type.id === JOURNAL_TYPE_ID} value={(draft?.properties ?? record?.properties)?.[id] ?? (id === JOURNAL_DATE_PROPERTY_ID ? journalDate : undefined)} />
            </fieldset>
          </>;
        })}</div>
      </section>
      <JournalDiscovery model={model} />
      <section class="writing" id="writing-area" tabindex={-1}>
        <div class="writing-heading"><h2 id="writing-heading">Writing</h2><Button class="js-only" type="button" data-insert-object-link="">Insert object link</Button></div>
        <div class="writing-toolbar" role="toolbar" aria-label="Writing formatting" data-writing-toolbar="" hidden>
          <label class="sr-only" for="writing-block">Paragraph style</label>
          <select id="writing-block" data-writing-block="" aria-label="Paragraph style">
            <option value="paragraph">Paragraph</option>
            {[1, 2, 3, 4, 5, 6].map(level => <option value={`heading-${level}`}>Heading {level}</option>)}
          </select>
          {([['bold', 'Bold'], ['italic', 'Italic'], ['strike', 'Strikethrough'], ['bullet', 'Bulleted list'], ['ordered', 'Numbered list'], ['quote', 'Block quote'], ['code', 'Inline code'], ['code-block', 'Code block'], ['link', 'Link'], ['undo', 'Undo'], ['redo', 'Redo']] as const).map(([command, label]) => <Button type="button" variant="ghost" data-writing-command={command} aria-label={label} title={label}>{label}</Button>)}
        </div>
        <div data-writing-mount="" hidden></div>
        <label class="sr-only" for="markdown-body">Writing Markdown source</label>
        <textarea id="markdown-body" class="markdown-source" name="body" rows={14} aria-describedby="markdown-help" spellcheck={true} data-writing-source={JSON.stringify(body)}>{`\n${body}`}</textarea>
        <p class="fine" id="markdown-help">Use # headings, **bold**, and [label](url). Changes need saving.</p>
        <p class="fine" data-writing-status="" role="status" hidden></p>
        <dialog class="writing-link-dialog" data-writing-link-dialog="" aria-labelledby="writing-link-heading">
          <h2 id="writing-link-heading">Edit link</h2>
          <label>Link address<input data-writing-link-url="" type="text" inputmode="url" autocomplete="off" placeholder="https://example.com" /></label>
          <p class="fine">Use https, http, mailto, or an object link. Leave empty to remove a link.</p>
          <p data-writing-link-error="" role="alert"></p>
          <Button type="button" data-writing-link-apply="">Apply link</Button> <Button type="button" variant="ghost" data-writing-link-cancel="">Cancel</Button>
        </dialog>
      </section>
      <div class="save-bar">
        <span data-object-save-controls="">{conflict && record ? <Button type="submit" variant="primary" name="reviewedRevision" value={record.revision}>Save reconciled changes</Button> : <Button type="submit" variant="primary">{record ? 'Save changes' : 'Create object'}</Button>} <Button class="native-only" type="submit" name="intent" value="change-type" formnovalidate>Use type</Button></span>
        <State message={state} error={Boolean(model.error)} />
      </div>
    </form>
    <aside id="saved-conflict" class="saved-conflict" data-conflict-panel="" hidden={!conflict} tabindex={-1} aria-labelledby={conflict ? 'conflict-heading' : undefined}>{conflict && <SavedConflict model={model} />}</aside>
    </div>
    {record && <>
      {!conflict && <details class="markdown-preview" data-native-reading="">
        <summary>Read saved writing</summary>
        <div id="saved-writing" tabindex={-1}>
          <p class="fine">Saved revision {record.revision}. Unsaved edits are not shown here.</p>
          <div class="markdown-content">{raw(renderMarkdown(record.body))}</div>
          <a href="#writing-area">Back to editing</a>
        </div>
      </details>}
      <section id="object-backlinks" class="backlinks" tabindex={-1}>
        <h2>Linked from</h2>
        {model.backlinks?.length ? <ul>{model.backlinks.map(link => <li><a href={objectUrl(link.object.id)}>{titleOf(link.object)}</a>{link.propertyId && <span class="muted"> via {propertyOf(model, link.propertyId)?.label ?? 'property'}</span>}</li>)}</ul> : <p class="muted">No other objects link here yet.</p>}
      </section>
      <form class="trash-form" method="post" action={`/objects/${record.id}/${record.trashed ? 'restore' : 'trash'}`} data-enhance="">
        <Token model={model} /><Hidden name="revision" value={record.revision} />
        <Button type="submit" variant={record.trashed ? 'secondary' : 'danger'}>{record.trashed ? 'Restore object' : 'Move to trash'}</Button><State />
      </form>
    </>}
  </>;
}

function Views({ model }: { model: ObjectPageModel }) {
  const calendar = model.section === 'calendar';
  const views = calendar ? model.views.filter(view => view.spec.blocks.some(block => block.component === 'calendar')) : model.views;
  return <><PageHeading title={calendar ? 'Calendar' : 'Views'} description={calendar ? 'Your dated objects, seen together. Open a saved calendar or create your own.' : 'Different perspectives on the same objects. Nothing copied, nothing moved.'}><ButtonLink variant="primary" href={calendar ? '/calendar?ai=1' : '/views?ai=1'} data-ai-start=""><Icon name="ai" />{calendar ? 'Create calendar' : 'Create view'}</ButtonLink></PageHeading>
    <div class="view-invitation"><span class="invitation-icon"><Icon name={calendar ? 'calendar' : 'views'} /></span><div><strong>{calendar ? 'Make room for what’s coming up' : 'A view that fits the way you think'}</strong><p>{calendar ? 'Ask for a calendar using date properties already in your workspace.' : 'Describe a list, table, calendar, or board. The view assistant creates a draft you can review.'}</p></div></div>
    {calendar && <p class="fine">For Events, include separate calendar blocks for all-day dates and timed ranges. For Reminders, include separate blocks for dates and exact times. Bind each block to the corresponding field and filter out empty values so both alternatives appear. Creating or opening objects never generates a view automatically.</p>}
    <h2 class="section-heading">{calendar ? 'Saved calendars' : 'Saved views'}<Badge>{views.length}</Badge></h2>{views.length ? <ul class="view-list">{views.map(view => <li><span class="view-list-icon"><Icon name={view.spec.blocks.some(block => block.component === 'calendar') ? 'calendar' : 'views'} /></span><div><a href={`/views/${view.id}`}>{view.spec.title}</a><p class="muted">{view.spec.description}</p></div><Badge tone={view.status === 'draft' ? 'warning' : 'success'}>{view.status}</Badge><ButtonLink href={`/views/${view.id}`}>{view.status === 'draft' ? 'Preview' : 'Open'}</ButtonLink></li>)}</ul> : <EmptyState icon={calendar ? 'calendar' : 'views'} title={calendar ? 'No calendars yet' : 'A fresh perspective starts here'}><p>{calendar ? 'No saved view includes a calendar. Create one to bring your dated objects into focus.' : 'Create your first view from the objects and properties in your workspace.'}</p><a href={calendar ? '/calendar?ai=1' : '/views?ai=1'} data-ai-start="">{calendar ? 'Describe a calendar' : 'Describe a view'}</a></EmptyState>}</>;
}

function InlineAction({ model, view, blockIndex, row, role }: { model: ObjectPageModel; view: SavedView; blockIndex: number; row: ViewRow; role: 'date' | 'group' }) {
  const propertyId = row.bindings[role];
  const property = propertyId ? propertyOf(model, propertyId) : undefined;
  if (!property || view.status !== 'published' || !view.spec.blocks[blockIndex]?.editable) return null;
  return <details class="inline-action"><summary>Edit {property.label}</summary><form method="post" action={`/views/${view.id}/act`} data-enhance=""><Token model={model} /><Hidden name="revision" value={view.revision} /><Hidden name="blockIndex" value={blockIndex} /><Hidden name="objectId" value={row.object.id} /><Hidden name="objectRevision" value={row.object.revision} /><Hidden name="role" value={role} />{model.evaluatedView?.input && <Hidden name="inputId" value={model.evaluatedView.input.id} />}<PropertyControl model={model} property={property} value={row.object.properties[property.id]} name="value" /><Button type="submit">Save</Button><State /></form></details>;
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
  return <><a class="back-link" href="/views">All views</a><PageHeading title={view.spec.title} description={view.spec.description}><Badge tone={view.status === 'draft' ? 'warning' : 'success'}>{view.status === 'draft' ? 'Draft preview' : 'Published'}</Badge></PageHeading>
    <div class="view-actions">{view.status === 'draft' && <form method="post" action={`/views/${view.id}/publish`} data-enhance=""><Token model={model} /><Hidden name="revision" value={view.revision} /><Button type="submit" variant="primary">Publish view</Button><State /></form>}<ButtonLink href={`/views/${view.id}?ai=1`} data-ai-context="" data-previous-id={view.id} data-context-title={view.spec.title}><Icon name="ai" />Refine with AI</ButtonLink><Button class="js-only" type="button" data-pin-view="" data-view-id={view.id} aria-pressed="false">Pin view</Button><form method="post" action={`/views/${view.id}/delete`} data-enhance=""><Token model={model} /><Hidden name="revision" value={view.revision} /><Button type="submit" variant="danger">Delete view</Button><State /></form><p class="muted">Deleting a view does not delete its objects.</p></div>
    {input && <form class="filter-bar" method="get" action={`/views/${view.id}`}><label>{input.label}<select name="input" required><option value="">Choose an object</option>{model.objects.filter(record => record.typeId === input.typeId && !record.trashed).map(record => <option value={record.id} selected={record.id === evaluated.input?.id}>{titleOf(record)}</option>)}</select></label><Button type="submit">Show view</Button></form>}
    {input && !evaluated.input ? <p class="empty">Choose a {typeName(model, input.typeId)} above to show this view.</p> : evaluated.blocks.map((block, index) => <section class="view-block"><h2>{block.definition.title}</h2><ViewBlockContent model={model} block={block} blockIndex={index} view={view} />{block.truncated && <p class="muted">This section reached its result limit. Narrow the view by refining your prompt.</p>}</section>)}
    <p class="fine">Source: {view.model}. Draft actions are read-only; object links always open the object editor.</p>
  </>;
}

export function renderObjectWorkspace(model: ObjectPageModel): string {
  let title = 'Objects';
  if (model.section === 'calendar') title = 'Calendar';
  else if (model.screen === 'journal') title = 'Journal';
  else if (model.trashed) title = model.selectedTypeId ? `${typeName(model, model.selectedTypeId)} · Trash` : 'Trash';
  else if (model.screen === 'object') title = model.object?.title || 'Object';
  else if (model.screen === 'new-object') title = 'New object';
  else if (model.screen === 'type') title = model.objectType?.name || 'Type';
  else if (model.screen === 'types') title = 'Manage types';
  else if (model.screen === 'view') title = model.evaluatedView?.view.spec.title || 'View';
  else if (model.screen === 'views') title = 'Views';
  else if (model.screen === 'objects') title = model.selectedTypeId ? typeName(model, model.selectedTypeId) : 'Search';
  const currentView = model.screen === 'view' ? model.evaluatedView?.view : undefined;
  const suggestedPrompt = model.section === 'calendar' ? 'Create a calendar of my objects using their date properties.' : model.section === 'tasks' && model.selectedTypeId ? 'Create a view of my tasks using their existing properties.' : undefined;
  const objectEditor = model.screen === 'new-object' || (model.screen === 'object' && Boolean(model.object));
  return '<!doctype html>' + (<html lang="en"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><meta name="color-scheme" content="light" /><title>{title} · Taskdesk</title><link rel="stylesheet" href="/tokens.css" /><link rel="stylesheet" href="/objects.css" />{objectEditor && <link rel="stylesheet" href="/writing.css" />}</head><body class={`object-shell${model.aiOpen ? ' ai-open' : ''}`} data-ai-view-id={currentView?.id} data-ai-view-title={currentView?.spec.title} data-ai-context-title={model.aiContextTitle} data-ai-prompt={suggestedPrompt}>
    <a class="skip-link" href="#main">Skip to content</a><div class="workspace-layout"><WorkspaceNav model={model} />
    <div class="workspace-content"><header class="workspace-header"><div class="workspace-breadcrumb"><Button class="icon-button js-only nav-toggle" type="button" data-nav-toggle="" aria-label="Open navigation" aria-controls="workspace-nav" aria-expanded="false"><Icon name="menu" /></Button><a href="/">Workspace</a><span aria-hidden="true">/</span><span class="breadcrumb-title">{title}</span></div><ButtonLink class="ai-toggle" href="/views?ai=1" data-ai-toggle="" aria-controls="ai-panel" aria-expanded={model.aiOpen ? 'true' : 'false'}><Icon name="ai" /><span>View assistant</span></ButtonLink></header>
    <main id="main" tabindex={-1}>{model.error && !objectEditor && <div class="notice error" role="alert">{model.error}</div>}{model.notice && !objectEditor && <div class="notice" role="status">{model.notice}</div>}{model.screen === 'journal' ? <Journal model={model} /> : model.screen === 'home' ? <ObjectHome model={model} /> : model.screen === 'objects' ? <Objects model={model} /> : model.screen === 'types' ? <Types model={model} /> : model.screen === 'type' ? <TypeEditor model={model} /> : model.screen === 'new-object' || model.screen === 'object' ? <ObjectEditor model={model} /> : model.screen === 'views' ? <Views model={model} /> : <View model={model} />}</main><footer class="workspace-footer">Objects are yours. Views are ways to see them.</footer></div>
    <button class="panel-backdrop" data-panel-backdrop="" type="button" aria-label="Close open panel" hidden></button><AiPanel model={model} /></div><ObjectSearch /><script type="module" src="/objects-client.js"></script></body></html>).toString();
}
