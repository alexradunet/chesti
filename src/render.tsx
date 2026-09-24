import { randomUUID } from 'node:crypto';
import { fromMarkdown } from 'mdast-util-from-markdown';
import { raw } from 'hono/html';
import type { JSX } from 'hono/jsx/jsx-runtime';
import type { Action, Field, Resource, Resolve, ViewPlan } from './core.js';
import type { Receipt, Visitor, Workspace } from './store.js';

const resourceLink = (href: string, workspace?: string) => workspace ? `${href}${href.includes('?') ? '&' : '?'}workspace=${encodeURIComponent(workspace)}` : href;
const Hidden = ({ name, value }: { name: string; value: string | number }) => <input type="hidden" name={name} value={value} />;

/** The body is a trusted fragment returned by this application's server renderers. */
export function page(title: string, body: string, interactive = false): string {
  return '<!doctype html>' + (<html lang="en">
    <head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>{title} · Taskdesk</title><link rel="stylesheet" href="/style.css" /><meta name="color-scheme" content="light" /></head>
    <body class={interactive ? 'workbench-page' : undefined}>
      <a class="skip" href="#main">Skip to content</a>
      <header class="masthead"><a class="brand" href="/" aria-label="Taskdesk home"><span class="mark" aria-hidden="true">T/</span> taskdesk<span class="edition">EXPERIMENT 001</span></a>
        <nav aria-label="Main"><a href="/">Today</a><a href="/vault/apps">App review</a><a href="/issues/new">Issue desk</a><a href="/issues">Issue register <span aria-hidden="true">↗</span></a></nav></header>
      <main id="main">{raw(body)}</main>
      <footer><span>HTML is the interface. The server owns the rules.</span><span>LOCAL SANDBOX / ALEX</span></footer>
      {interactive && <script type="module" src="/workspace.js"></script>}
    </body>
  </html>).toString();
}

function TaskForm({ visitor, mode, task = '' }: { visitor: Visitor; mode: 'demo' | 'pi'; task?: string }) {
  return <form class="task-form" method="post" action="/workspaces">
    <Hidden name="csrf" value={visitor.csrf} />
    <label for="task">Describe the task, not the layout</label>
    <textarea id="task" name="task" rows={2} required maxlength={500} placeholder="Help me triage the unassigned issues…">{task}</textarea>
    <div class="compose-controls"><label for="engine">Composer <select id="engine" name="engine"><option value="demo" selected={mode === 'demo'}>Deterministic demo</option><option value="pi" selected={mode === 'pi'}>Pi SDK · configured model</option></select></label>
      <button class="primary" type="submit">Assemble workspace <span aria-hidden="true">↗</span></button></div>
    <p class="fine">Demo uses local rules. Pi sends your task and inspected issue data to your configured model provider; allow up to 45 seconds.</p>
  </form>;
}

export function issueHome(visitor: Visitor, mode: 'demo' | 'pi'): string {
  const open = visitor.issues.filter(i => i.status !== 'closed').length;
  const unassigned = visitor.issues.filter(i => i.status !== 'closed' && i.owner === 'unassigned').length;
  return page('Issue desk', (<>
    <section class="intro"><div><p class="eyebrow">ISSUE DESK / SAVED WORKSPACES</p>
      <h1>A view for<br /><em>your issue work.</em></h1><p class="lead">Compose a focused workspace from the issue register.<br />Your Markdown content and daily journal are in <a href="/">Today</a>.</p></div>
      <aside class="register-stamp"><strong>{String(open).padStart(2, '0')}</strong><span>OPEN ISSUES</span><p>{unassigned} waiting for an owner</p></aside></section>
    <section class="start-grid"><div><TaskForm visitor={visitor} mode={mode} />
      <div class="examples"><span class="eyebrow">TRY A TASK</span>{['Help me triage unassigned issues', 'What should I work on next?'].map(task => <form method="post" action="/workspaces"><Hidden name="csrf" value={visitor.csrf} /><Hidden name="engine" value={mode} /><button class="text-button" name="task" value={task}>{task} <span aria-hidden="true">→</span></button></form>)}</div></div>
      <aside class="notes"><span class="eyebrow">A SMALL, OPINIONATED EXPERIMENT</span><ol><li><strong>The task chooses the view.</strong><p>Compare a queue. Focus on one issue. Keep the next action close.</p></li><li><strong>The server sets the boundaries.</strong><p>Real links and forms. Available actions come from current state.</p></li><li><strong>The browser does the rest.</strong><p>Talk to Pi beside your workspace. Use forms or ask it to act. No model call for a button click.</p></li></ol></aside></section>
    {visitor.workspaces.length > 0 && <section class="recent"><h2>Your workspaces</h2><ul>{visitor.workspaces.slice(-6).reverse().map(w => <li><a href={`/workspaces/${w.id}`}>{w.plan.title}</a><span class="tag">{w.engine}</span><span class="fine">{w.task}</span></li>)}</ul></section>}
  </>).toString());
}

function Pick({ resource, workspace }: { resource: Resource; workspace?: string }) {
  return <>{workspace && <label class="pick"><input type="checkbox" name="selected" form="chat-send" value={resource.href} aria-label={`Select ${resource.title}`} /><span class="sr-only">Select {resource.title}</span></label>}</>;
}

function Collection({ resource, view, workspace }: { resource: Resource; view: string; workspace?: string }) {
  const items = resource.items ?? [];
  if (resource.href.startsWith('/vault')) {
    const create = resource.links.filter(link => link.rel === 'create');
    const columns = [...new Set(items.flatMap(item => Object.keys(item.facts)))].filter(key => !['ID', 'Revision', 'DefinitionRevision', 'Path', 'Calendar sort', 'Calendar value', 'Calendar end', 'Calendar field'].includes(key)).slice(0, 6);
    const heading = <><div class="section-heading"><div><p class="eyebrow">VAULT / {items.length} RECORDS</p><h2>{resource.title}</h2></div></div><p class="section-description">{resource.description}</p>{create.length > 0 && <nav class="create-links" aria-label="Create records">{create.map(link => <a class="button-link" href={resourceLink(link.href, workspace)}>{link.title} +</a>)}</nav>}</>;
    if (!items.length) return <>{heading}<p class="empty fine">No approved records match this collection.</p></>;
    if (resource.facts.Presentation === 'calendar') {
      const days = new Map<string, Resource[]>();
      for (const item of items) {
        const day = item.facts['Calendar date']!;
        const group = days.get(day) ?? [];
        group.push(item);
        days.set(day, group);
      }
      return <>{heading}<div class="calendar-agenda">{[...days].map(([day, entries]) => <section><h3>{new Date(`${day}T12:00:00`).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}</h3><ul class="day-schedule">{entries.map(item => <li><Pick resource={item} workspace={workspace} /><span class="schedule-time">{item.facts.Time ?? 'All day'}</span><div><a href={resourceLink(item.href, workspace)}>{item.title}</a><span class="fine">{item.facts['Calendar field']} · {item.facts.Type}{item.facts['Calendar end'] && item.facts['Calendar end'] !== day ? ` · until ${item.facts['Calendar end']} (exclusive)` : ''}</span></div></li>)}</ul></section>)}</div></>;
    }
    if (view === 'list') return <>{heading}<ul class="vault-records">{items.map(item => <li><Pick resource={item} workspace={workspace} /><a href={resourceLink(item.href, workspace)}>{item.title}</a><p class="fine">{[item.facts['Calendar date'], item.facts.Time, item.facts.status, item.facts.Path].filter(Boolean).join(' · ')}</p></li>)}</ul></>;
    return <>{heading}<div class="table-scroll" tabindex={0} role="region" aria-label={`${resource.title} table`}><table><thead><tr><th scope="col">Record</th>{columns.map(key => <th scope="col">{key}</th>)}</tr></thead><tbody>{items.map(item => <tr><th scope="row"><Pick resource={item} workspace={workspace} /><a href={resourceLink(item.href, workspace)}>{item.title}</a><span class="fine">{item.facts.Path ?? ''}</span></th>{columns.map(key => <td>{item.facts[key] ?? '—'}</td>)}</tr>)}</tbody></table></div></>;
  }
  const heading = <><div class="section-heading"><div><p class="eyebrow">COLLECTION / {items.length} ISSUES</p><h2>{resource.title}</h2></div><a class="quiet-link" href={resourceLink(resource.href, workspace)} aria-label={`Open ${resource.title}`}>↗</a></div><p class="section-description">{resource.description}</p></>;
  if (!items.length) return <>{heading}<div class="empty"><h3>Nothing in this queue.</h3><p>The current filter has no matching issues. Your saved composition is unchanged.</p><a href="/issues">Browse all issues →</a></div></>;
  if (view === 'list') return <>{heading}<ol class="issue-list">{items.map((item, index) => <li><span class="rank"><Pick resource={item} workspace={workspace} />{String(index + 1).padStart(2, '0')}</span><div><div class="issue-meta"><span>{item.facts.ID}</span><span class={`priority ${item.facts.Priority}`}>{item.facts.Priority}</span><span>{item.facts.Status}</span></div><h3><a href={resourceLink(item.href, workspace)}>{item.title}</a></h3><p>{item.description}</p></div></li>)}</ol></>;
  return <>{heading}<div class="table-scroll" tabindex={0} role="region" aria-label={`${resource.title} table`}><table><caption class="sr-only">{resource.title}, highest priority first</caption><thead><tr><th scope="col">Issue</th><th scope="col">Priority</th><th scope="col">Owner</th><th scope="col">Status</th></tr></thead><tbody>{items.map(item => <tr><th scope="row"><Pick resource={item} workspace={workspace} /><span class="issue-id">{item.facts.ID}</span><a href={resourceLink(item.href, workspace)}>{item.title}</a></th><td><span class={`priority ${item.facts.Priority}`}>{item.facts.Priority}</span></td><td>{item.facts.Assignee}</td><td>{item.facts.Status}</td></tr>)}</tbody></table></div></>;
}

function Detail({ resource, workspace }: { resource: Resource; workspace?: string }) {
  return <><Pick resource={resource} workspace={workspace} /><p class="eyebrow">IN FOCUS / {resource.facts.Type ?? resource.facts.ID ?? ''}</p><h2>{resource.title}</h2><p class="description">{resource.description}</p>{resource.body !== undefined && <div class="markdown-body"><Markdown body={resource.body} resource={resource} workspace={workspace} /></div>}<dl class="facts">{Object.entries(resource.facts).map(([key, value]) => <div><dt>{key}</dt><dd>{value}</dd></div>)}</dl></>;
}

function ActionControl({ field, id }: { field: Field; id: string }) {
  const fieldId = `${id}-${field.name}`;
  const options = field.options.length ? field.options : field.input === 'checkbox' ? [...(!field.required ? [{ value: '', label: 'Not set' }] : []), { value: 'true', label: 'Yes' }, { value: 'false', label: 'No' }] : [];
  if (field.valueType === 'time-range' || field.valueType === 'date-range') {
    let range: { start?: string; end?: string; timeZone?: string } = {};
    try { range = field.value ? JSON.parse(field.value) : {}; } catch { /* advanced editor retains the original value */ }
    const timed = field.valueType === 'time-range';
    return <fieldset class="range-field" data-range-kind={field.valueType}><legend>{field.label}{field.required ? ' *' : ''}</legend><div class="range-controls"><label>Start<input type={timed ? 'datetime-local' : 'date'} data-range-part="start" value={range.start?.slice(0, timed ? 16 : 10) ?? ''} /></label><label>End (exclusive)<input type={timed ? 'datetime-local' : 'date'} data-range-part="end" value={range.end?.slice(0, timed ? 16 : 10) ?? ''} /></label>{timed && <label>Timezone (IANA)<input type="text" data-range-part="timeZone" value={range.timeZone ?? ''} placeholder="Europe/Paris" /></label>}</div><p class="fine range-error" role="status"></p><details class="range-advanced" open><summary>Advanced JSON / exact timezone offsets</summary><label for={fieldId} class="sr-only">{field.label} JSON</label><textarea id={fieldId} name={field.name} rows={3} class="json-input" spellcheck={false} required={field.required}>{field.value}</textarea><p class="fine">Empty removes an optional range. End must follow start. Timezone offsets are validated by the server.</p></details></fieldset>;
  }
  const input = options.length
    ? <select id={fieldId} name={field.name} required={field.required}>{options.map(option => <option value={option.value} selected={option.value === field.value}>{option.label}</option>)}</select>
    : field.input === 'textarea' || field.input === 'json'
      ? <textarea id={fieldId} name={field.name} rows={field.input === 'textarea' ? 8 : 3} required={field.required} spellcheck={field.input === 'json' ? false : undefined} class={field.input === 'json' ? 'json-input' : undefined}>{field.value}</textarea>
      : <input id={fieldId} name={field.name} type={field.input === 'date' || field.input === 'datetime-local' || field.input === 'number' ? field.input : 'text'} value={field.value} required={field.required} step={field.input === 'number' ? 'any' : undefined} />;
  return <div class="action-field"><label for={fieldId}>{field.label}{field.required ? ' *' : ''}</label>{input}</div>;
}

function ActionForm({ resource, action, visitor, id, workspace }: { resource: Resource; action: Action; visitor: Visitor; id: string; workspace?: string }) {
  return <form id={id} class={`resource-action${resource.href.startsWith('/vault') ? ' vault-action' : ''}`} method={action.method} action={action.href}>
    <Hidden name="csrf" value={visitor.csrf} /><Hidden name="version" value={String(resource.version ?? '')} />{workspace && <Hidden name="workspace" value={workspace} />}
    {action.href === '/vault/act' && <><Hidden name="resource" value={resource.href} /><Hidden name="action" value={action.id} /><Hidden name="definitionRevision" value={resource.facts.DefinitionRevision ?? ''} /></>}
    {action.fields.map(field => <ActionControl field={field} id={id} />)}<button type="submit" class={action.id === 'close' ? 'subtle-danger' : undefined}>{action.title}</button>{action.requiresConfirmation && <span class="fine">This action requires confirmation.</span>}
  </form>;
}

export function renderAction(resource: Resource, action: Action, visitor: Visitor, id: string, workspace?: string): string {
  return (<ActionForm resource={resource} action={action} visitor={visitor} id={id} workspace={workspace} />).toString();
}

function Actions({ resource, visitor, prefix, workspace }: { resource: Resource; visitor: Visitor; prefix: string; workspace?: string }) {
  return <><div class="section-heading"><h2>Available actions</h2></div><p class="section-description">Server-owned forms · stale revisions are rejected. Only currently permitted actions are shown.</p><div class="actions">{resource.actions.length ? resource.actions.map((action, index) => <div class="action-row"><ActionForm resource={resource} action={action} visitor={visitor} id={`${prefix}-form-${index}`} workspace={workspace} /></div>) : <p class="fine">No actions are currently available for this resource.</p>}</div></>;
}

/** Render only a safe Markdown vocabulary; raw HTML remains text and images never load. */
function Markdown({ body, resource, workspace }: { body: string; resource: Resource; workspace?: string }) {
  type Node = { type: string; value?: string; url?: string; alt?: string | null; depth?: number; ordered?: boolean | null; start?: number | null; children?: Node[] };
  const wiki = new Map(resource.links.filter(link => link.rel === 'wiki').map(link => [link.title, link.href]));
  const text = (value: string) => {
    const result: (string | JSX.Element)[] = [];
    let cursor = 0;
    for (const match of value.matchAll(/\[\[([^\]\r\n]+)\]\]/g)) {
      result.push(value.slice(cursor, match.index));
      const [target, ...alias] = match[1]!.split('|'), href = wiki.get(target!.trim());
      result.push(href ? <a class="wiki-link" href={resourceLink(href, workspace)}>{alias.join('|') || target}</a> : <span class="unresolved-link" title="Not available in approved readable documents">{match[0]}</span>);
      cursor = match.index + match[0].length;
    }
    result.push(value.slice(cursor));
    return <>{result}</>;
  };
  const render = (node: Node): JSX.Element => {
    const children = () => (node.children ?? []).map(render);
    switch (node.type) {
      case 'root': return <>{children()}</>;
      case 'text': return text(node.value ?? '');
      case 'paragraph': return <p>{children()}</p>;
      case 'heading': { const Heading = `h${Math.max(2, Math.min(6, node.depth ?? 2))}` as 'h2' | 'h3' | 'h4' | 'h5' | 'h6'; return <Heading>{children()}</Heading>; }
      case 'strong': return <strong>{children()}</strong>;
      case 'emphasis': return <em>{children()}</em>;
      case 'blockquote': return <blockquote>{children()}</blockquote>;
      case 'list': return node.ordered ? <ol start={Number(node.start) || 1}>{children()}</ol> : <ul>{children()}</ul>;
      case 'listItem': return <li>{children()}</li>;
      case 'code': return <pre><code>{node.value ?? ''}</code></pre>;
      case 'inlineCode': return <code>{node.value ?? ''}</code>;
      case 'break': return <br />;
      case 'thematicBreak': return <hr />;
      case 'html': return <>{node.value ?? ''}</>;
      case 'image': case 'imageReference': return <span>{node.alt ?? ''}</span>;
      case 'link': {
        const url = node.url ?? '';
        return /^(https?:\/\/|mailto:)/i.test(url) && !/[\u0000-\u0020\u007f]/.test(url)
          ? <a href={url} rel="noreferrer noopener">{children()}</a> : <>{children()}</>;
      }
      case 'definition': return <></>;
      default: return <>{node.children ? children() : node.value ?? ''}</>;
    }
  };
  return render(fromMarkdown(body));
}

export function renderMarkdown(body: string, resource: Resource, workspace?: string): string {
  return (<Markdown body={body} resource={resource} workspace={workspace} />).toString();
}

function Plan({ plan, resolve, visitor, workspace }: { plan: ViewPlan; resolve: Resolve; visitor: Visitor; workspace?: string }) {
  return <div class={`workspace ${plan.layout}`}>{plan.blocks.map((block, index) => {
    const resource = resolve(block.resource);
    const content = block.view === 'table' || block.view === 'list' ? <Collection resource={resource} view={block.view} workspace={workspace} />
      : block.view === 'detail' ? <Detail resource={resource} workspace={workspace} /> : <Actions resource={resource} visitor={visitor} prefix={`block-${index}`} workspace={workspace} />;
    return <section class={`panel ${block.view}`}>{content}</section>;
  })}</div>;
}

export function renderPlan(plan: ViewPlan, resolve: Resolve, visitor: Visitor, workspace?: string): string {
  return (<Plan plan={plan} resolve={resolve} visitor={visitor} workspace={workspace} />).toString();
}

export function workspaceCanvas(workspace: Workspace, visitor: Visitor, resolve: Resolve): string {
  return (<div id="canvas" tabindex={-1} data-revision={workspace.revision} data-focus=""><div class="workspace-heading"><div><p class="eyebrow">YOUR TASK / A SAVED WORKSPACE</p><h1>{workspace.plan.title}</h1><p class="lead task-quote">“{workspace.task}”</p></div><span class="engine-badge">{workspace.engine === 'pi' ? 'PI COMPOSED' : workspace.engine === 'demo' ? 'DEMO · NO AI' : 'FALLBACK · NO AI VIEW'}</span></div>
    <p class="composition-note">{workspace.note}</p>
    <Plan plan={workspace.plan} resolve={resolve} visitor={visitor} workspace={workspace.id} />
    <details class="inspector"><summary>Under the hood <span>composition, not application code</span></summary><div class="inspector-grid"><div><h3>Accepted view plan</h3><pre>{JSON.stringify(workspace.plan, null, 2)}</pre></div><div><h3>Composition receipt</h3><dl><dt>Engine</dt><dd>{workspace.engine}</dd><dt>Model</dt><dd>{workspace.model ?? 'None'}</dd><dt>Composition time</dt><dd>{(workspace.elapsedMs / 1000).toFixed(1)}s</dd><dt>Inspected resources</dt><dd><ul>{workspace.inspected.map(ref => <li><code>{ref}</code></li>)}</ul></dd></dl><p class="fine">The plan is saved. Resource values and forms are resolved again on every request. Refreshing this URL does not call a model.</p></div></div></details>
    {workspace.previousPlan && <form class="undo-layout" method="post" action={`/workspaces/${workspace.id}/undo`}><Hidden name="csrf" value={visitor.csrf} /><Hidden name="revision" value={workspace.revision} /><button>Undo last layout change</button><span class="fine">Does not undo issue actions.</span></form>}
  </div>).toString();
}

export function resourceCanvas(resource: Resource, visitor: Visitor, workspace?: Workspace, saved = false): string {
  const plan: ViewPlan = resource.kind === 'collection'
    ? { title: resource.title, layout: 'stack', blocks: [{ resource: resource.href, view: 'table' }] }
    : { title: resource.title, layout: 'split', blocks: [{ resource: resource.href, view: 'detail' }, { resource: resource.href, view: 'actions' }] };
  return (<div id="canvas" tabindex={-1} data-focus={resource.href} data-revision={workspace?.revision ?? 0}><div class="resource-top"><a href={workspace ? `/workspaces/${workspace.id}` : resource.href.startsWith('/vault') ? '/' : '/issues/new'}>← {workspace ? 'Back to your workspace' : resource.href.startsWith('/vault') ? 'Back to Today' : 'Back to the issue desk'}</a><span class="eyebrow">SERVER-RENDERED / NO INFERENCE</span></div>
    {saved && <p class="notice" role="status">Saved. The actions below reflect the current state.</p>}
    {(resource.kind === 'collection' || resource.href.startsWith('/vault')) && <nav class="scope-nav" aria-label="Resource navigation">{resource.links.filter(link => link.rel !== 'wiki').map(l => <a href={resourceLink(l.href, workspace?.id)} aria-current={l.href === resource.href ? 'page' : undefined}>{l.title}</a>)}</nav>}
    <Plan plan={plan} resolve={() => resource} visitor={visitor} workspace={workspace?.id} />
  </div>).toString();
}

function ReceiptItem({ receipt, workspace, visitor }: { receipt: Receipt; workspace: Workspace; visitor: Visitor }) {
  return <li class={`receipt ${receipt.status}`}><div><span class="receipt-status">{receipt.status}</span> <a href={resourceLink(receipt.resource, workspace.id)}>{receipt.resource.split('/').at(-1)}</a> · {receipt.action}</div><p>{receipt.message}</p>{receipt.status === 'pending' && <form class="receipt-form" method="post" action={`/workspaces/${workspace.id}/receipts/${receipt.id}`}><Hidden name="csrf" value={visitor.csrf} /><button name="decision" value="confirm">Confirm {receipt.action}</button><button name="decision" value="cancel">Cancel</button></form>}</li>;
}

function ConversationPanel({ workspace, visitor, focus = '' }: { workspace: Workspace; visitor: Visitor; focus?: string }) {
  const { conversation } = workspace;
  const running = conversation.turns.find(t => t.status === 'running');
  const manual = conversation.receipts.filter(r => r.source === 'form').slice(-8);
  return <aside id="conversation" aria-label="Conversation with Pi" data-busy={String(Boolean(running))}><div class="conversation-heading"><div><span class="eyebrow">YOUR COLLABORATOR</span><h2>Pi <span class="presence" aria-hidden="true"></span></h2></div><a class="quiet-link" href={workspace.kind === 'today' ? '/vault/apps' : '/issues/new'}>{workspace.kind === 'today' ? 'App review' : 'New workspace'} ↗</a></div>
    <div id="transcript" tabindex={0} aria-label="Conversation history"><article class="message user"><span class="speaker">YOU / INITIAL TASK</span><p>{workspace.task}</p></article><article class="message desk"><span class="speaker">DESK</span><p>Workspace ready. Ask a question, change the view, or ask Pi to act on {workspace.kind === 'today' ? 'approved vault records' : 'issues'}. Select {workspace.kind === 'today' ? 'records' : 'issues'} to make “these” explicit.</p></article>
      {conversation.turns.map(turn => <><article class="message user"><span class="speaker">YOU</span><p>{turn.message}</p>{turn.selected.length > 0 && <span class="fine">Selected: {turn.selected.map(ref => ref.split('/').at(-1)).join(', ')}</span>}</article><article class="message assistant"><span class="speaker">{turn.engine === 'pi' ? 'PI' : 'DEMO · NO AI'}</span><p>{turn.response || (turn.status === 'running' ? 'Working…' : 'No response.')}</p>{turn.notice && <p class="turn-notice">{turn.notice}</p>}<ul class="receipts">{conversation.receipts.filter(r => r.turnId === turn.id).map(receipt => <ReceiptItem receipt={receipt} workspace={workspace} visitor={visitor} />)}</ul></article></>)}
      {manual.length > 0 && <details class="manual-receipts"><summary>Recent form actions</summary><ul class="receipts">{manual.map(receipt => <ReceiptItem receipt={receipt} workspace={workspace} visitor={visitor} />)}</ul></details>}<div id="live-response" class="message assistant" hidden><span class="speaker">RESPONSE</span><p></p><ul class="receipts"></ul></div></div>
    <div class="conversation-input"><p id="chat-status" role="status">{running ? 'Pi is working…' : 'Ready. Actions run as Alex in this sandbox.'}</p><p id="selection-status" class="fine">No selection · Pi can see the current view.</p>
      <form id="chat-send" method="post" action={`/workspaces/${workspace.id}/messages`}><Hidden name="csrf" value={visitor.csrf} /><Hidden name="requestId" value={randomUUID()} /><Hidden name="revision" value={workspace.revision} /><Hidden name="focus" value={focus} /><label class="sr-only" for="message">Message Pi</label><textarea id="message" name="message" rows={3} maxlength={2000} required placeholder={workspace.kind === 'today' ? 'Create a task to finish the homepage tomorrow…' : 'Assign both issues to me…'} disabled={Boolean(running)}></textarea><div class="chat-controls"><label class="sr-only" for="chat-engine">Conversation engine</label><select id="chat-engine" name="engine" disabled={Boolean(running)}><option value="pi" selected={conversation.engine === 'pi'}>Pi SDK</option><option value="demo" selected={conversation.engine === 'demo'}>Demo · no AI</option></select><button class="primary" disabled={Boolean(running)}>Send ↗</button></div></form>
      <form id="chat-stop" method="post" action={`/workspaces/${workspace.id}/stop`} hidden={!running}><Hidden name="csrf" value={visitor.csrf} /><Hidden name="turnId" value={running?.id ?? ''} /><button>Stop Pi</button><span class="fine">Applied actions remain.</span></form><p class="fine privacy-note">Pi sends conversation and inspected {workspace.kind === 'today' ? 'approved vault' : 'issue'} data to your model provider. Sensitive actions require confirmation.</p></div>
  </aside>;
}

export function conversationPanel(workspace: Workspace, visitor: Visitor, focus = ''): string {
  return (<ConversationPanel workspace={workspace} visitor={visitor} focus={focus} />).toString();
}

function workbench(workspace: Workspace, visitor: Visitor, canvas: string, focus = ''): string {
  return (<div class="workbench" data-workspace={workspace.id}><ConversationPanel workspace={workspace} visitor={visitor} focus={focus} /><section class="canvas-region" aria-label="Task workspace"><div id="pending-update" role="status" hidden>The workspace changed. Your unfinished form has been kept. <button type="button" id="apply-update">Discard form edits and refresh</button></div>{raw(canvas)}</section></div>).toString();
}

export function workspacePage(workspace: Workspace, visitor: Visitor, resolve: Resolve): string {
  return page(workspace.plan.title, workbench(workspace, visitor, workspaceCanvas(workspace, visitor, resolve)), true);
}

export function resourcePage(resource: Resource, visitor: Visitor, workspace?: Workspace, saved = false): string {
  const canvas = resourceCanvas(resource, visitor, workspace, saved);
  return page(resource.title, workspace ? workbench(workspace, visitor, canvas, resource.href) : canvas, Boolean(workspace) || resource.href.startsWith('/vault'));
}

export function errorPage(status: number, message: string): string {
  return page('Unable to complete request', (<section class="error"><p class="eyebrow">REQUEST / {status}</p><h1>Let’s try that again.</h1><p class="lead">{message}</p><a href="/">Back to Today →</a><p><a href="/issues/new">Open the issue desk</a></p></section>).toString());
}
