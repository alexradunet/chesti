import { escapeHtml as e, type Resource, type Resolve, type ViewPlan } from './core.js';
import type { Visitor, Workspace } from './store.js';

// HERO: the task sentence becomes the heading of a working issue desk,
// not another message in a chat transcript.
const hidden = (name: string, value: string | number) => `<input type="hidden" name="${e(name)}" value="${e(value)}">`;
const resourceLink = (href: string, workspace?: string) => workspace ? `${href}${href.includes('?') ? '&' : '?'}workspace=${encodeURIComponent(workspace)}` : href;

export function page(title: string, body: string): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${e(title)} · Taskdesk</title><link rel="stylesheet" href="/style.css"><meta name="color-scheme" content="light"></head>
<body><a class="skip" href="#main">Skip to content</a>
<header class="masthead"><a class="brand" href="/" aria-label="Taskdesk home"><span class="mark" aria-hidden="true">T/</span> taskdesk<span class="edition">EXPERIMENT 001</span></a>
<nav aria-label="Main"><a href="/">New task</a><a href="/issues">Issue register <span aria-hidden="true">↗</span></a></nav></header>
<main id="main">${body}</main>
<footer><span>HTML is the interface. The server owns the rules.</span><span>LOCAL SANDBOX / ALEX</span></footer>
</body></html>`;
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
<aside class="notes"><span class="eyebrow">A SMALL, OPINIONATED EXPERIMENT</span><ol><li><strong>The task chooses the view.</strong><p>Compare a queue. Focus on one issue. Keep the next action close.</p></li><li><strong>The server sets the boundaries.</strong><p>Real links and forms. Available actions come from current state.</p></li><li><strong>The browser does the rest.</strong><p>No generated scripts. No chat history to navigate. No model call for a button click.</p></li></ol></aside></section>
${visitor.workspaces.length ? `<section class="recent"><h2>Your workspaces</h2><ul>${visitor.workspaces.slice(-6).reverse().map(w => `<li><a href="/workspaces/${e(w.id)}">${e(w.plan.title)}</a><span class="tag">${e(w.engine)}</span><span class="fine">${e(w.task)}</span></li>`).join('')}</ul></section>` : ''}`);
}

function collection(resource: Resource, view: string, workspace?: string): string {
  const items = resource.items ?? [];
  const heading = `<div class="section-heading"><div><p class="eyebrow">COLLECTION / ${items.length} ISSUES</p><h2>${e(resource.title)}</h2></div><a class="quiet-link" href="${e(resourceLink(resource.href, workspace))}" aria-label="Open ${e(resource.title)}">↗</a></div><p class="section-description">${e(resource.description)}</p>`;
  if (!items.length) return `${heading}<div class="empty"><h3>Nothing in this queue.</h3><p>The current filter has no matching issues. Your saved composition is unchanged.</p><a href="/issues">Browse all issues →</a></div>`;
  if (view === 'list') return `${heading}<ol class="issue-list">${items.map((item, index) => `<li><span class="rank">${String(index + 1).padStart(2, '0')}</span><div><div class="issue-meta"><span>${e(item.facts.ID)}</span><span class="priority ${e(item.facts.Priority)}">${e(item.facts.Priority)}</span><span>${e(item.facts.Status)}</span></div><h3><a href="${e(resourceLink(item.href, workspace))}">${e(item.title)}</a></h3><p>${e(item.description)}</p></div></li>`).join('')}</ol>`;
  return `${heading}<div class="table-scroll" tabindex="0" role="region" aria-label="${e(resource.title)} table"><table><caption class="sr-only">${e(resource.title)}, highest priority first</caption><thead><tr><th scope="col">Issue</th><th scope="col">Priority</th><th scope="col">Owner</th><th scope="col">Status</th></tr></thead><tbody>${items.map(item => `<tr><th scope="row"><span class="issue-id">${e(item.facts.ID)}</span><a href="${e(resourceLink(item.href, workspace))}">${e(item.title)}</a></th><td><span class="priority ${e(item.facts.Priority)}">${e(item.facts.Priority)}</span></td><td>${e(item.facts.Assignee)}</td><td>${e(item.facts.Status)}</td></tr>`).join('')}</tbody></table></div>`;
}

function detail(resource: Resource): string {
  return `<p class="eyebrow">IN FOCUS / ${e(resource.facts.ID)}</p><h2>${e(resource.title)}</h2><p class="description">${e(resource.description)}</p><dl class="facts">${Object.entries(resource.facts).map(([key, value]) => `<div><dt>${e(key)}</dt><dd>${e(value)}</dd></div>`).join('')}</dl>`;
}

function actions(resource: Resource, visitor: Visitor, prefix: string, workspace?: string): string {
  return `<div class="section-heading"><h2>Available actions</h2><button type="button" class="help" popovertarget="${prefix}-help" aria-label="About available actions">?</button></div>
<aside id="${prefix}-help" popover><h3>State decides what’s possible.</h3><p>These forms come from the server, not the model. Closing an issue replaces its editing actions with a reopen action. A stale form is rejected.</p><button type="button" popovertarget="${prefix}-help" popovertargetaction="hide">Got it</button></aside>
<p class="section-description">${e(resource.facts.ID)} · applied directly, without inference.</p>
<div class="actions">${resource.actions.map((action, index) => {
    const id = `${prefix}-form-${index}`;
    return `<div class="action-row"><form id="${id}" method="${action.method}" action="${e(action.href)}">${hidden('csrf', visitor.csrf)}${hidden('version', resource.version!)}${workspace ? hidden('workspace', workspace) : ''}
${action.fields.map(field => `<label for="${id}-${e(field.name)}">${e(field.label)}</label><select id="${id}-${e(field.name)}" name="${e(field.name)}" required>${field.options.map(option => `<option value="${e(option.value)}"${option.value === field.value ? ' selected' : ''}>${e(option.label)}</option>`).join('')}</select>`).join('')}</form>
<button type="submit" form="${id}"${action.id === 'close' ? ' class="subtle-danger"' : ''}>${e(action.title)}</button></div>`;
  }).join('')}</div>`;
}

export function renderPlan(plan: ViewPlan, resolve: Resolve, visitor: Visitor, workspace?: string): string {
  return `<div class="workspace ${e(plan.layout)}">${plan.blocks.map((block, index) => {
    const resource = resolve(block.resource);
    const content = block.view === 'table' || block.view === 'list' ? collection(resource, block.view, workspace)
      : block.view === 'detail' ? detail(resource) : actions(resource, visitor, `block-${index}`, workspace);
    return `<section class="panel ${e(block.view)}">${content}</section>`;
  }).join('')}</div>`;
}

export function workspacePage(workspace: Workspace, visitor: Visitor, resolve: Resolve): string {
  return page(workspace.plan.title, `<div class="workspace-heading"><div><p class="eyebrow">YOUR TASK / A SAVED WORKSPACE</p><h1>${e(workspace.plan.title)}</h1><p class="lead task-quote">“${e(workspace.task)}”</p></div><span class="engine-badge">${workspace.engine === 'pi' ? 'PI COMPOSED' : workspace.engine === 'demo' ? 'DEMO · NO AI' : 'FALLBACK · NO AI VIEW'}</span></div>
<p class="composition-note">${e(workspace.note)}</p>
${renderPlan(workspace.plan, resolve, visitor, workspace.id)}
<details class="inspector"><summary>Under the hood <span>composition, not application code</span></summary><div class="inspector-grid"><div><h3>Accepted view plan</h3><pre>${e(JSON.stringify(workspace.plan, null, 2))}</pre></div><div><h3>Composition receipt</h3><dl><dt>Engine</dt><dd>${e(workspace.engine)}</dd><dt>Model</dt><dd>${e(workspace.model ?? 'None')}</dd><dt>Composition time</dt><dd>${(workspace.elapsedMs / 1000).toFixed(1)}s</dd><dt>Inspected resources</dt><dd><ul>${workspace.inspected.map(ref => `<li><code>${e(ref)}</code></li>`).join('')}</ul></dd></dl><p class="fine">The plan is saved. Resource values and forms are resolved again on every request. Refreshing this URL does not call a model.</p></div></div></details>
<details class="refine"><summary>Start another task</summary>${taskForm(visitor, workspace.engine === 'pi' ? 'pi' : 'demo', workspace.task)}</details>`);
}

export function resourcePage(resource: Resource, visitor: Visitor, workspace?: Workspace, saved = false): string {
  const plan: ViewPlan = resource.kind === 'collection'
    ? { title: resource.title, layout: 'stack', blocks: [{ resource: resource.href, view: 'table' }] }
    : { title: resource.title, layout: 'split', blocks: [{ resource: resource.href, view: 'detail' }, { resource: resource.href, view: 'actions' }] };
  return page(resource.title, `<div class="resource-top"><a href="${workspace ? `/workspaces/${e(workspace.id)}` : '/'}">← ${workspace ? 'Back to your workspace' : 'Back to the desk'}</a><span class="eyebrow">SERVER-RENDERED / NO INFERENCE</span></div>
${saved ? '<p class="notice" role="status">Saved. The actions below reflect the current state.</p>' : ''}
${resource.kind === 'collection' ? `<nav class="scope-nav" aria-label="Issue collections">${resource.links.map(l => `<a href="${e(resourceLink(l.href, workspace?.id))}"${l.href === resource.href ? ' aria-current="page"' : ''}>${e(l.title)}</a>`).join('')}</nav>` : ''}
${renderPlan(plan, () => resource, visitor, workspace?.id)}`);
}

export function errorPage(status: number, message: string): string {
  return page('Unable to complete request', `<section class="error"><p class="eyebrow">REQUEST / ${status}</p><h1>Let’s try that again.</h1><p class="lead">${e(message)}</p><a href="/issues">Reload the issue register →</a><p><a href="/">Start a new task</a></p></section>`);
}
