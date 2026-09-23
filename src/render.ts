import { randomUUID } from 'node:crypto';
import { fromMarkdown } from 'mdast-util-from-markdown';
import { escapeHtml as e, type Action, type Field, type Resource, type Resolve, type ViewPlan } from './core.js';
import type { Receipt, Visitor, Workspace } from './store.js';

// HERO: the task sentence becomes the heading of a working issue desk,
// not another message in a chat transcript.
const hidden = (name: string, value: string | number) => `<input type="hidden" name="${e(name)}" value="${e(value)}">`;
const resourceLink = (href: string, workspace?: string) => workspace ? `${href}${href.includes('?') ? '&' : '?'}workspace=${encodeURIComponent(workspace)}` : href;

export function page(title: string, body: string, interactive = false): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${e(title)} · Taskdesk</title><link rel="stylesheet" href="/style.css"><meta name="color-scheme" content="light"></head>
<body${interactive ? ' class="workbench-page"' : ''}><a class="skip" href="#main">Skip to content</a>
<header class="masthead"><a class="brand" href="/" aria-label="Taskdesk home"><span class="mark" aria-hidden="true">T/</span> taskdesk<span class="edition">EXPERIMENT 001</span></a>
<nav aria-label="Main"><a href="/today">Today</a><a href="/vault/apps">App review</a><a href="/">New task</a><a href="/issues">Issues <span aria-hidden="true">↗</span></a></nav></header>
<main id="main">${body}</main>
<footer><span>HTML is the interface. The server owns the rules.</span><span>LOCAL SANDBOX / ALEX</span></footer>
${interactive ? '<script type="module" src="/workspace.js"></script>' : ''}</body></html>`;
}

function taskForm(visitor: Visitor, mode: 'demo' | 'pi', task = ''): string {
  return `<form class="task-form" method="post" action="/workspaces">
${hidden('csrf', visitor.csrf)}
<label for="task">Describe the task, not the layout</label>
<textarea id="task" name="task" rows="2" required maxlength="500" placeholder="Help me triage the unassigned issues…">${e(task)}</textarea>
<div class="compose-controls"><label for="engine">Composer <select id="engine" name="engine"><option value="demo"${mode === 'demo' ? ' selected' : ''}>Deterministic demo</option><option value="pi"${mode === 'pi' ? ' selected' : ''}>Pi SDK · configured model</option></select></label>
<button class="primary" type="submit">Assemble workspace <span aria-hidden="true">↗</span></button></div>
<p class="fine">Demo uses local rules. Pi sends your task and inspected issue data to your configured model provider; allow up to 45 seconds.</p>
</form>`;
}

export function home(visitor: Visitor, mode: 'demo' | 'pi'): string {
  const open = visitor.issues.filter(i => i.status !== 'closed').length;
  const unassigned = visitor.issues.filter(i => i.status !== 'closed' && i.owner === 'unassigned').length;
  return page('A workspace for the task', `<section class="intro"><div><p class="eyebrow">TASK-FIRST / HYPERMEDIA-NATIVE</p>
<h1>Less interface.<br><em>More intent.</em></h1><p class="lead">Tell the desk what you’re working on.<br>Get the resources and actions that belong together.</p></div>
<aside class="register-stamp"><strong>${String(open).padStart(2, '0')}</strong><span>OPEN ISSUES</span><p>${unassigned} waiting for an owner</p></aside></section>
<section class="start-grid"><div>${taskForm(visitor, mode)}
<div class="examples"><span class="eyebrow">TRY A TASK</span>${['Help me triage unassigned issues', 'What should I work on next?'].map(task => `<form method="post" action="/workspaces">${hidden('csrf', visitor.csrf)}${hidden('engine', mode)}<button class="text-button" name="task" value="${e(task)}">${e(task)} <span aria-hidden="true">→</span></button></form>`).join('')}</div></div>
<aside class="notes"><span class="eyebrow">A SMALL, OPINIONATED EXPERIMENT</span><ol><li><strong>The task chooses the view.</strong><p>Compare a queue. Focus on one issue. Keep the next action close.</p></li><li><strong>The server sets the boundaries.</strong><p>Real links and forms. Available actions come from current state.</p></li><li><strong>The browser does the rest.</strong><p>Talk to Pi beside your workspace. Use forms or ask it to act. No model call for a button click.</p></li></ol></aside></section>
${visitor.workspaces.length ? `<section class="recent"><h2>Your workspaces</h2><ul>${visitor.workspaces.slice(-6).reverse().map(w => `<li><a href="/workspaces/${e(w.id)}">${e(w.plan.title)}</a><span class="tag">${e(w.engine)}</span><span class="fine">${e(w.task)}</span></li>`).join('')}</ul></section>` : ''}`);
}

function pick(resource: Resource, workspace?: string): string {
  return workspace ? `<label class="pick"><input type="checkbox" name="selected" form="chat-send" value="${e(resource.href)}" aria-label="Select ${e(resource.title)}"><span class="sr-only">Select ${e(resource.title)}</span></label>` : '';
}

function collection(resource: Resource, view: string, workspace?: string): string {
  const items = resource.items ?? [];
  if (resource.href.startsWith('/vault')) {
    const create = resource.links.filter(link => link.rel === 'create');
    const columns = [...new Set(items.flatMap(item => Object.keys(item.facts)))].filter(key => !['ID', 'Revision', 'DefinitionRevision', 'Path', 'Calendar sort', 'Calendar value', 'Calendar end', 'Calendar field'].includes(key)).slice(0, 6);
    const heading = `<div class="section-heading"><div><p class="eyebrow">VAULT / ${items.length} RECORDS</p><h2>${e(resource.title)}</h2></div></div><p class="section-description">${e(resource.description)}</p>${create.length ? `<nav class="create-links" aria-label="Create records">${create.map(link => `<a class="button-link" href="${e(resourceLink(link.href, workspace))}">${e(link.title)} +</a>`).join('')}</nav>` : ''}`;
    if (!items.length) return `${heading}<p class="empty fine">No approved records match this collection.</p>`;
    if (resource.facts.Presentation === 'calendar') {
      const days = new Map<string, Resource[]>();
      for (const item of items) {
        const day = item.facts['Calendar date']!;
        const group = days.get(day) ?? [];
        group.push(item);
        days.set(day, group);
      }
      return `${heading}<div class="calendar-agenda">${[...days].map(([day, entries]) => `<section><h3>${e(new Date(`${day}T12:00:00`).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' }))}</h3><ul class="day-schedule">${entries.map(item => `<li>${pick(item, workspace)}<span class="schedule-time">${e(item.facts.Time ?? 'All day')}</span><div><a href="${e(resourceLink(item.href, workspace))}">${e(item.title)}</a><span class="fine">${e(item.facts['Calendar field'])} · ${e(item.facts.Type)}${item.facts['Calendar end'] && item.facts['Calendar end'] !== day ? ` · until ${e(item.facts['Calendar end'])} (exclusive)` : ''}</span></div></li>`).join('')}</ul></section>`).join('')}</div>`;
    }
    if (view === 'list') return `${heading}<ul class="vault-records">${items.map(item => `<li>${pick(item, workspace)}<a href="${e(resourceLink(item.href, workspace))}">${e(item.title)}</a><p class="fine">${e([item.facts['Calendar date'], item.facts.Time, item.facts.status, item.facts.Path].filter(Boolean).join(' · '))}</p></li>`).join('')}</ul>`;
    return `${heading}<div class="table-scroll" tabindex="0" role="region" aria-label="${e(resource.title)} table"><table><thead><tr><th scope="col">Record</th>${columns.map(key => `<th scope="col">${e(key)}</th>`).join('')}</tr></thead><tbody>${items.map(item => `<tr><th scope="row">${pick(item, workspace)}<a href="${e(resourceLink(item.href, workspace))}">${e(item.title)}</a><span class="fine">${e(item.facts.Path ?? '')}</span></th>${columns.map(key => `<td>${e(item.facts[key] ?? '—')}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
  }
  const heading = `<div class="section-heading"><div><p class="eyebrow">COLLECTION / ${items.length} ISSUES</p><h2>${e(resource.title)}</h2></div><a class="quiet-link" href="${e(resourceLink(resource.href, workspace))}" aria-label="Open ${e(resource.title)}">↗</a></div><p class="section-description">${e(resource.description)}</p>`;
  if (!items.length) return `${heading}<div class="empty"><h3>Nothing in this queue.</h3><p>The current filter has no matching issues. Your saved composition is unchanged.</p><a href="/issues">Browse all issues →</a></div>`;
  if (view === 'list') return `${heading}<ol class="issue-list">${items.map((item, index) => `<li><span class="rank">${pick(item, workspace)}${String(index + 1).padStart(2, '0')}</span><div><div class="issue-meta"><span>${e(item.facts.ID)}</span><span class="priority ${e(item.facts.Priority)}">${e(item.facts.Priority)}</span><span>${e(item.facts.Status)}</span></div><h3><a href="${e(resourceLink(item.href, workspace))}">${e(item.title)}</a></h3><p>${e(item.description)}</p></div></li>`).join('')}</ol>`;
  return `${heading}<div class="table-scroll" tabindex="0" role="region" aria-label="${e(resource.title)} table"><table><caption class="sr-only">${e(resource.title)}, highest priority first</caption><thead><tr><th scope="col">Issue</th><th scope="col">Priority</th><th scope="col">Owner</th><th scope="col">Status</th></tr></thead><tbody>${items.map(item => `<tr><th scope="row">${pick(item, workspace)}<span class="issue-id">${e(item.facts.ID)}</span><a href="${e(resourceLink(item.href, workspace))}">${e(item.title)}</a></th><td><span class="priority ${e(item.facts.Priority)}">${e(item.facts.Priority)}</span></td><td>${e(item.facts.Assignee)}</td><td>${e(item.facts.Status)}</td></tr>`).join('')}</tbody></table></div>`;
}

function detail(resource: Resource, workspace?: string): string {
  return `${pick(resource, workspace)}<p class="eyebrow">IN FOCUS / ${e(resource.facts.Type ?? resource.facts.ID ?? '')}</p><h2>${e(resource.title)}</h2><p class="description">${e(resource.description)}</p>${resource.body !== undefined ? `<div class="markdown-body">${renderMarkdown(resource.body, resource, workspace)}</div>` : ''}<dl class="facts">${Object.entries(resource.facts).map(([key, value]) => `<div><dt>${e(key)}</dt><dd>${e(value)}</dd></div>`).join('')}</dl>`;
}

export function renderAction(resource: Resource, action: Action, visitor: Visitor, id: string, workspace?: string): string {
  const control = (field: Field) => {
    const name = e(field.name), fieldId = `${id}-${name}`, required = field.required ? ' required' : '';
    const options = field.options.length ? field.options : field.input === 'checkbox' ? [...(!field.required ? [{ value: '', label: 'Not set' }] : []), { value: 'true', label: 'Yes' }, { value: 'false', label: 'No' }] : [];
    if (field.valueType === 'time-range' || field.valueType === 'date-range') {
      let range: { start?: string; end?: string; timeZone?: string } = {};
      try { range = field.value ? JSON.parse(field.value) : {}; } catch { /* advanced editor retains the original value */ }
      const timed = field.valueType === 'time-range';
      return `<fieldset class="range-field" data-range-kind="${field.valueType}"><legend>${e(field.label)}${field.required ? ' *' : ''}</legend><div class="range-controls"><label>Start<input type="${timed ? 'datetime-local' : 'date'}" data-range-part="start" value="${e(range.start?.slice(0, timed ? 16 : 10) ?? '')}"></label><label>End (exclusive)<input type="${timed ? 'datetime-local' : 'date'}" data-range-part="end" value="${e(range.end?.slice(0, timed ? 16 : 10) ?? '')}"></label>${timed ? `<label>Timezone (IANA)<input type="text" data-range-part="timeZone" value="${e(range.timeZone ?? '')}" placeholder="Europe/Paris"></label>` : ''}</div><p class="fine range-error" role="status"></p><details class="range-advanced" open><summary>Advanced JSON / exact timezone offsets</summary><label for="${fieldId}" class="sr-only">${e(field.label)} JSON</label><textarea id="${fieldId}" name="${name}" rows="3" class="json-input" spellcheck="false"${required}>${e(field.value)}</textarea><p class="fine">Empty removes an optional range. End must follow start. Timezone offsets are validated by the server.</p></details></fieldset>`;
    }
    const input = options.length
      ? `<select id="${fieldId}" name="${name}"${required}>${options.map(option => `<option value="${e(option.value)}"${option.value === field.value ? ' selected' : ''}>${e(option.label)}</option>`).join('')}</select>`
      : field.input === 'textarea' || field.input === 'json'
        ? `<textarea id="${fieldId}" name="${name}" rows="${field.input === 'textarea' ? 8 : 3}"${required}${field.input === 'json' ? ' spellcheck="false" class="json-input"' : ''}>${e(field.value)}</textarea>`
        : `<input id="${fieldId}" name="${name}" type="${field.input === 'date' || field.input === 'datetime-local' || field.input === 'number' ? field.input : 'text'}" value="${e(field.value)}"${required}${field.input === 'number' ? ' step="any"' : ''}>`;
    return `<div class="action-field"><label for="${fieldId}">${e(field.label)}${field.required ? ' *' : ''}</label>${input}</div>`;
  };
  return `<form id="${e(id)}" class="resource-action${resource.href.startsWith('/vault') ? ' vault-action' : ''}" method="${action.method}" action="${e(action.href)}">${hidden('csrf', visitor.csrf)}${hidden('version', String(resource.version ?? ''))}${workspace ? hidden('workspace', workspace) : ''}${action.href === '/vault/act' ? hidden('resource', resource.href) + hidden('action', action.id) + hidden('definitionRevision', resource.facts.DefinitionRevision ?? '') : ''}${action.fields.map(control).join('')}<button type="submit"${action.id === 'close' ? ' class="subtle-danger"' : ''}>${e(action.title)}</button>${action.requiresConfirmation ? '<span class="fine">This action requires confirmation.</span>' : ''}</form>`;
}

function actions(resource: Resource, visitor: Visitor, prefix: string, workspace?: string): string {
  return `<div class="section-heading"><h2>Available actions</h2></div><p class="section-description">Server-owned forms · stale revisions are rejected. Only currently permitted actions are shown.</p><div class="actions">${resource.actions.map((action, index) => `<div class="action-row">${renderAction(resource, action, visitor, `${prefix}-form-${index}`, workspace)}</div>`).join('') || '<p class="fine">No actions are currently available for this resource.</p>'}</div>`;
}

/** Render a small safe Markdown vocabulary. Raw HTML and images are never executed. */
export function renderMarkdown(body: string, resource: Resource, workspace?: string): string {
  type Node = { type: string; value?: string; url?: string; alt?: string | null; depth?: number; ordered?: boolean | null; start?: number | null; children?: Node[] };
  const wiki = new Map(resource.links.filter(link => link.rel === 'wiki').map(link => [link.title, link.href]));
  const text = (value: string) => {
    let result = '', cursor = 0;
    for (const match of value.matchAll(/\[\[([^\]\r\n]+)\]\]/g)) {
      result += e(value.slice(cursor, match.index));
      const [target, ...alias] = match[1]!.split('|'), href = wiki.get(target!.trim());
      result += href ? `<a class="wiki-link" href="${e(resourceLink(href, workspace))}">${e(alias.join('|') || target)}</a>` : `<span class="unresolved-link" title="Not available in approved readable documents">${e(match[0])}</span>`;
      cursor = match.index + match[0].length;
    }
    return result + e(value.slice(cursor));
  };
  const render = (node: Node): string => {
    const children = () => (node.children ?? []).map(render).join('');
    switch (node.type) {
      case 'root': return children();
      case 'text': return text(node.value ?? '');
      case 'paragraph': return `<p>${children()}</p>`;
      case 'heading': { const depth = Math.max(2, Math.min(6, node.depth ?? 2)); return `<h${depth}>${children()}</h${depth}>`; }
      case 'strong': return `<strong>${children()}</strong>`;
      case 'emphasis': return `<em>${children()}</em>`;
      case 'blockquote': return `<blockquote>${children()}</blockquote>`;
      case 'list': return node.ordered ? `<ol start="${Number(node.start) || 1}">${children()}</ol>` : `<ul>${children()}</ul>`;
      case 'listItem': return `<li>${children()}</li>`;
      case 'code': return `<pre><code>${e(node.value ?? '')}</code></pre>`;
      case 'inlineCode': return `<code>${e(node.value ?? '')}</code>`;
      case 'break': return '<br>';
      case 'thematicBreak': return '<hr>';
      case 'html': return e(node.value ?? '');
      case 'image': case 'imageReference': return `<span>${e(node.alt ?? '')}</span>`;
      case 'link': {
        const url = node.url ?? '';
        return /^(https?:\/\/|mailto:)/i.test(url) && !/[\u0000-\u0020\u007f]/.test(url)
          ? `<a href="${e(url)}" rel="noreferrer noopener">${children()}</a>` : children();
      }
      case 'definition': return '';
      default: return node.children ? children() : e(node.value ?? '');
    }
  };
  return render(fromMarkdown(body));
}

export function renderPlan(plan: ViewPlan, resolve: Resolve, visitor: Visitor, workspace?: string): string {
  return `<div class="workspace ${e(plan.layout)}">${plan.blocks.map((block, index) => {
    const resource = resolve(block.resource);
    const content = block.view === 'table' || block.view === 'list' ? collection(resource, block.view, workspace)
      : block.view === 'detail' ? detail(resource, workspace) : actions(resource, visitor, `block-${index}`, workspace);
    return `<section class="panel ${e(block.view)}">${content}</section>`;
  }).join('')}</div>`;
}

export function workspaceCanvas(workspace: Workspace, visitor: Visitor, resolve: Resolve): string {
  return `<div id="canvas" tabindex="-1" data-revision="${workspace.revision}" data-focus=""><div class="workspace-heading"><div><p class="eyebrow">YOUR TASK / A SAVED WORKSPACE</p><h1>${e(workspace.plan.title)}</h1><p class="lead task-quote">“${e(workspace.task)}”</p></div><span class="engine-badge">${workspace.engine === 'pi' ? 'PI COMPOSED' : workspace.engine === 'demo' ? 'DEMO · NO AI' : 'FALLBACK · NO AI VIEW'}</span></div>
<p class="composition-note">${e(workspace.note)}</p>
${renderPlan(workspace.plan, resolve, visitor, workspace.id)}
<details class="inspector"><summary>Under the hood <span>composition, not application code</span></summary><div class="inspector-grid"><div><h3>Accepted view plan</h3><pre>${e(JSON.stringify(workspace.plan, null, 2))}</pre></div><div><h3>Composition receipt</h3><dl><dt>Engine</dt><dd>${e(workspace.engine)}</dd><dt>Model</dt><dd>${e(workspace.model ?? 'None')}</dd><dt>Composition time</dt><dd>${(workspace.elapsedMs / 1000).toFixed(1)}s</dd><dt>Inspected resources</dt><dd><ul>${workspace.inspected.map(ref => `<li><code>${e(ref)}</code></li>`).join('')}</ul></dd></dl><p class="fine">The plan is saved. Resource values and forms are resolved again on every request. Refreshing this URL does not call a model.</p></div></div></details>
${workspace.previousPlan ? `<form class="undo-layout" method="post" action="/workspaces/${workspace.id}/undo">${hidden('csrf', visitor.csrf)}${hidden('revision', workspace.revision)}<button>Undo last layout change</button><span class="fine">Does not undo issue actions.</span></form>` : ''}</div>`;
}

export function resourceCanvas(resource: Resource, visitor: Visitor, workspace?: Workspace, saved = false): string {
  const plan: ViewPlan = resource.kind === 'collection'
    ? { title: resource.title, layout: 'stack', blocks: [{ resource: resource.href, view: 'table' }] }
    : { title: resource.title, layout: 'split', blocks: [{ resource: resource.href, view: 'detail' }, { resource: resource.href, view: 'actions' }] };
  return `<div id="canvas" tabindex="-1" data-focus="${e(resource.href)}" data-revision="${workspace?.revision ?? 0}"><div class="resource-top"><a href="${workspace ? `/workspaces/${e(workspace.id)}` : '/'}">← ${workspace ? 'Back to your workspace' : 'Back to the desk'}</a><span class="eyebrow">SERVER-RENDERED / NO INFERENCE</span></div>
${saved ? '<p class="notice" role="status">Saved. The actions below reflect the current state.</p>' : ''}
${resource.kind === 'collection' || resource.href.startsWith('/vault') ? `<nav class="scope-nav" aria-label="Resource navigation">${resource.links.filter(link => link.rel !== 'wiki').map(l => `<a href="${e(resourceLink(l.href, workspace?.id))}"${l.href === resource.href ? ' aria-current="page"' : ''}>${e(l.title)}</a>`).join('')}</nav>` : ''}
${renderPlan(plan, () => resource, visitor, workspace?.id)}</div>`;
}

function receiptMarkup(receipt: Receipt, workspace: Workspace, visitor: Visitor): string {
  return `<li class="receipt ${receipt.status}"><div><span class="receipt-status">${e(receipt.status)}</span> <a href="${e(resourceLink(receipt.resource, workspace.id))}">${e(receipt.resource.split('/').at(-1))}</a> · ${e(receipt.action)}</div><p>${e(receipt.message)}</p>${receipt.status === 'pending' ? `<form class="receipt-form" method="post" action="/workspaces/${workspace.id}/receipts/${receipt.id}">${hidden('csrf', visitor.csrf)}<button name="decision" value="confirm">Confirm ${e(receipt.action)}</button><button name="decision" value="cancel">Cancel</button></form>` : ''}</li>`;
}

export function conversationPanel(workspace: Workspace, visitor: Visitor, focus = ''): string {
  const { conversation } = workspace;
  const running = conversation.turns.find(t => t.status === 'running');
  const manual = conversation.receipts.filter(r => r.source === 'form').slice(-8);
  return `<aside id="conversation" aria-label="Conversation with Pi" data-busy="${Boolean(running)}"><div class="conversation-heading"><div><span class="eyebrow">YOUR COLLABORATOR</span><h2>Pi <span class="presence" aria-hidden="true"></span></h2></div><a class="quiet-link" href="/">New task ↗</a></div>
<div id="transcript" tabindex="0" aria-label="Conversation history"><article class="message user"><span class="speaker">YOU / INITIAL TASK</span><p>${e(workspace.task)}</p></article><article class="message desk"><span class="speaker">DESK</span><p>Workspace ready. Ask a question, change the view, or ask Pi to act on ${workspace.kind === 'today' ? 'approved vault records' : 'issues'}. Select ${workspace.kind === 'today' ? 'records' : 'issues'} to make “these” explicit.</p></article>
${conversation.turns.map(turn => `<article class="message user"><span class="speaker">YOU</span><p>${e(turn.message)}</p>${turn.selected.length ? `<span class="fine">Selected: ${turn.selected.map(ref => e(ref.split('/').at(-1))).join(', ')}</span>` : ''}</article><article class="message assistant"><span class="speaker">${turn.engine === 'pi' ? 'PI' : 'DEMO · NO AI'}</span><p>${e(turn.response || (turn.status === 'running' ? 'Working…' : 'No response.'))}</p>${turn.notice ? `<p class="turn-notice">${e(turn.notice)}</p>` : ''}<ul class="receipts">${conversation.receipts.filter(r => r.turnId === turn.id).map(r => receiptMarkup(r, workspace, visitor)).join('')}</ul></article>`).join('')}
${manual.length ? `<details class="manual-receipts"><summary>Recent form actions</summary><ul class="receipts">${manual.map(r => receiptMarkup(r, workspace, visitor)).join('')}</ul></details>` : ''}<div id="live-response" class="message assistant" hidden><span class="speaker">RESPONSE</span><p></p><ul class="receipts"></ul></div></div>
<div class="conversation-input"><p id="chat-status" role="status">${running ? 'Pi is working…' : 'Ready. Actions run as Alex in this sandbox.'}</p><p id="selection-status" class="fine">No selection · Pi can see the current view.</p>
<form id="chat-send" method="post" action="/workspaces/${workspace.id}/messages">${hidden('csrf', visitor.csrf)}${hidden('requestId', randomUUID())}${hidden('revision', workspace.revision)}${hidden('focus', focus)}<label class="sr-only" for="message">Message Pi</label><textarea id="message" name="message" rows="3" maxlength="2000" required placeholder="${workspace.kind === 'today' ? 'Create a task to finish the homepage tomorrow…' : 'Assign both issues to me…'}"${running ? ' disabled' : ''}></textarea><div class="chat-controls"><label class="sr-only" for="chat-engine">Conversation engine</label><select id="chat-engine" name="engine"${running ? ' disabled' : ''}><option value="pi"${conversation.engine === 'pi' ? ' selected' : ''}>Pi SDK</option><option value="demo"${conversation.engine === 'demo' ? ' selected' : ''}>Demo · no AI</option></select><button class="primary"${running ? ' disabled' : ''}>Send ↗</button></div></form>
<form id="chat-stop" method="post" action="/workspaces/${workspace.id}/stop"${running ? '' : ' hidden'}>${hidden('csrf', visitor.csrf)}${hidden('turnId', running?.id ?? '')}<button>Stop Pi</button><span class="fine">Applied actions remain.</span></form><p class="fine privacy-note">Pi sends conversation and inspected ${workspace.kind === 'today' ? 'approved vault' : 'issue'} data to your model provider. Sensitive actions require confirmation.</p></div></aside>`;
}

function workbench(workspace: Workspace, visitor: Visitor, canvas: string, focus = ''): string {
  return `<div class="workbench" data-workspace="${workspace.id}">${conversationPanel(workspace, visitor, focus)}<section class="canvas-region" aria-label="Task workspace"><div id="pending-update" role="status" hidden>The workspace changed. Your unfinished form has been kept. <button type="button" id="apply-update">Discard form edits and refresh</button></div>${canvas}</section></div>`;
}

export function workspacePage(workspace: Workspace, visitor: Visitor, resolve: Resolve): string {
  return page(workspace.plan.title, workbench(workspace, visitor, workspaceCanvas(workspace, visitor, resolve)), true);
}

export function resourcePage(resource: Resource, visitor: Visitor, workspace?: Workspace, saved = false): string {
  const canvas = resourceCanvas(resource, visitor, workspace, saved);
  return page(resource.title, workspace ? workbench(workspace, visitor, canvas, resource.href) : canvas, Boolean(workspace) || resource.href.startsWith('/vault'));
}

export function errorPage(status: number, message: string): string {
  return page('Unable to complete request', `<section class="error"><p class="eyebrow">REQUEST / ${status}</p><h1>Let’s try that again.</h1><p class="lead">${e(message)}</p><a href="/issues">Reload the issue register →</a><p><a href="/">Start a new task</a></p></section>`);
}
