import { raw } from 'hono/html';
import type { JSX } from 'hono/jsx/jsx-runtime';
import type { Action, Resource } from '../core.js';
import { conversationPanel, page, renderAction, renderMarkdown, renderPlan } from '../render.js';
import type { Visitor, Workspace } from '../store.js';
import { localDate, vaultResolver } from './resources.js';
import type { AppReview, VaultRuntime } from './runtime.js';

function QuickApprovalForm({ visitor, apps }: { visitor: Visitor; apps: AppReview[] }) {
  const valid = apps.filter(app => app.status !== 'invalid');
  if (!valid.some(app => app.status !== 'active' || app.permissions.some(permission => !app.granted.includes(permission)))) return <></>;
  const approvals = valid.map(app => ({ app: app.id, revision: app.revision, permissions: app.permissions }));
  const notes = valid.some(app => app.permissions.includes('notes:read'));
  return <form class="notice review-notice quick-approval" method="post" action="/vault/approve"><input type="hidden" name="csrf" value={visitor.csrf} /><input type="hidden" name="approvals" value={JSON.stringify(approvals)} /><div><h2>Quick setup</h2><p>Enable {valid.map(app => app.name).join(', ')} with all declared read, create and update permissions{notes ? ', including access to ordinary vault notes' : ''}.</p><p class="fine">Only these exact revisions are approved. Future definition changes still need approval.{valid.length < apps.length ? ' Invalid definitions are excluded.' : ''} <a href="/vault/apps">Review permissions individually</a></p></div><button class="primary">Approve all {valid.length} apps</button></form>;
}

function Selected({ record }: { record: Resource }) {
  return <label class="pick"><input type="checkbox" name="selected" form="chat-send" value={record.href} aria-label={`Select ${record.title}`} /><span class="sr-only">Select {record.title}</span></label>;
}

function TodayCanvas({ workspace, visitor, runtime }: { workspace: Workspace; visitor: Visitor; runtime: VaultRuntime }) {
  const resolve = vaultResolver(runtime);
  const day = localDate();
  const root = resolve('/vault');
  const diagnosticNotice = Number(root.facts.Errors) > 0 && <aside class="notice review-notice" role="status"><strong>{root.facts.Errors} vault validation error(s).</strong> Invalid records are not shown or actionable. Correct the affected stored records or definitions; an empty collection may not mean there is no work.<details><summary>Validation details</summary><pre>{root.facts.Diagnostics ?? ''}</pre></details></aside>;
  const link = (href: string) => `${href}${href.includes('?') ? '&' : '?'}workspace=${encodeURIComponent(workspace.id)}`;
  const navigation = <nav class="scope-nav" aria-label="Vault"><a href="/" aria-current="page">Today</a>{[['/vault/tasks', 'Tasks'], ['/vault/calendar', 'Calendar'], ['/vault/journal', 'Journal'], ['/vault/para', 'PARA'], ['/vault', 'All resources']].map(([href, title]) => <a href={link(href!)}>{title}</a>)}<a href="/vault/apps">App review</a></nav>;
  const heading = <><div class="workspace-heading today-heading"><div><p class="eyebrow">YOUR DAY / MARKDOWN CONTENT</p><h1>{workspace.plan.title}</h1><p class="lead">{new Date(`${day}T12:00:00`).toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</p></div><span class="engine-badge">APPROVED APPS · SQLITE RECORDS</span></div>{navigation}{diagnosticNotice}</>;
  const defaults = ['/vault/today', '/vault/tasks', '/vault/journal', '/vault/para'];
  const defaultPlan = workspace.plan.layout === 'stack' && workspace.plan.blocks.length === defaults.length && workspace.plan.blocks.every((block, index) => block.resource === defaults[index] && block.view === 'list');
  const undo = workspace.previousPlan && <form class="undo-layout" method="post" action={`/workspaces/${workspace.id}/undo`}><input type="hidden" name="csrf" value={visitor.csrf} /><input type="hidden" name="revision" value={workspace.revision} /><button>Undo last layout change</button><span class="fine">Saved records remain unchanged.</span></form>;
  if (!defaultPlan) return <div id="canvas" tabindex={-1} data-revision={workspace.revision} data-focus="">{heading}<p class="composition-note">{workspace.note}</p>{raw(renderPlan(workspace.plan, resolve, visitor, workspace.id))}{undo}</div>;

  const tasks = resolve('/vault/tasks'), schedule = resolve('/vault/today'), journals = resolve('/vault/journal'), para = resolve('/vault/para');
  const upcoming = resolve('/vault/calendar');
  const journal = journals.items?.find(item => item.facts.date === day);
  const journalTypeLink = journals.links.find(item => item.rel === 'create');
  const journalType = !journal && journalTypeLink ? resolve(journalTypeLink.href) : undefined;
  const journalAction = journal?.actions.find(action => action.fields.some(field => field.name === 'body'));
  const canWriteJournal = Boolean(journalAction || journalType?.actions.length);
  const taskCards = (tasks.items ?? []).map((task, index) => {
    const dateAction = task.actions.find(action => action.fields.some(field => field.valueType === 'date'));
    const dateField = dateAction?.fields.find(field => field.name === 'due') ?? dateAction?.fields.find(field => field.valueType === 'date');
    const fixedActions = task.actions.filter(action => action.fields.length === 0);
    const wikiTarget = task.facts.Path?.replace(/\.md$/i, '');
    return <li class="task-card"><Selected record={task} /><div class="task-card-heading"><a href={link(task.href)}>{task.title}</a><span class="tag">{task.facts.status ?? task.facts.Type}</span></div><p class="fine">{task.facts.due ? `Due ${task.facts.due}${task.facts.due < day ? ' · overdue' : ''}` : 'No deadline'}{task.facts.scheduled ? ' · scheduled work session' : ''}</p><div class="task-card-actions">{fixedActions.map((action, actionIndex) => raw(renderAction(task, action, visitor, `task-${index}-${actionIndex}`, workspace.id)))}{canWriteJournal && wikiTarget && <button type="button" class="journal-insert" data-journal-link={`[[${wikiTarget}]]`}>Link in journal</button>}</div>{dateAction && dateField && <details class="schedule-task"><summary>Set a date</summary>{raw(renderAction(task, { ...dateAction, title: 'Save date', fields: [dateField] }, visitor, `task-date-${index}`, workspace.id))}<a class="fine" href={link(task.href)}>Edit Markdown or scheduled time range →</a></details>}</li>;
  });
  const createTask = tasks.links.find(item => item.rel === 'create');
  const taskType = createTask ? resolve(createTask.href) : undefined;
  const taskCreateForm = taskType?.actions[0] && <details class="quick-create"><summary>New task +</summary>{raw(renderAction(taskType, taskType.actions[0], visitor, 'today-create-task', workspace.id))}</details>;
  const scheduleItems = (schedule.items ?? []).filter(item => !item.facts.Type?.startsWith('journal.'));
  const scheduleRows = (items: Resource[]) => items.map(item => <li><Selected record={item} /><span class="schedule-time">{item.facts.Time ?? item.facts['Calendar date'] ?? 'All day'}</span><div><a href={link(item.href)}>{item.title}</a><span class="fine">{item.facts.Type} · {item.facts['Calendar field'] ?? ''}</span></div></li>);
  const nextItems = (upcoming.items ?? []).filter(item => item.facts['Calendar date']! > day && !item.facts.Type?.startsWith('journal.')).slice(0, 6);
  let journalContent: JSX.Element;
  if (journal && journalAction) {
    const bodyAction: Action = { ...journalAction, title: 'Save journal', fields: journalAction.fields.filter(field => field.name === 'body') };
    journalContent = <><p class="fine"><a href={link(journal.href)}>{journal.facts.Path}</a> · existing entry for {day}</p>{raw(renderAction(journal, bodyAction, visitor, 'today-journal', workspace.id))}<details class="journal-preview"><summary>Saved Markdown preview</summary><div class="markdown-body">{raw(renderMarkdown(journal.body ?? '', journal, workspace.id))}</div></details></>;
  } else if (journal) {
    journalContent = <><p class="fine">This entry is read only with the current permissions.</p><div class="markdown-body">{raw(renderMarkdown(journal.body ?? '', journal, workspace.id))}</div><a href={link(journal.href)}>Open journal entry →</a></>;
  } else if (journalType?.actions[0]) {
    const create: Action = { ...journalType.actions[0], title: 'Create today’s journal', fields: journalType.actions[0].fields.map(field => ({ ...field, value: field.name === 'date' ? day : field.name === 'title' ? day : field.value })) };
    journalContent = <><p class="fine">No entry exists for {day}. Write freely and explicitly create it below. Opening Today never creates a record.</p>{raw(renderAction(journalType, create, visitor, 'today-journal', workspace.id))}</>;
  } else {
    journalContent = <><p class="fine">No readable entry for today. Approve the journal’s read/create permissions to use your daily Markdown journal.</p><a href="/vault/apps">Review journal permissions →</a></>;
  }
  const groups = ['Projects', 'Areas', 'Resources', 'Archives'].map(folder => {
    const items = (para.items ?? []).filter(item => item.facts.Path?.startsWith(`${folder}/`));
    return <section class="para-group"><h3>{folder}</h3>{items.length ? <ul>{items.slice(0, 8).map(item => <li><a href={link(item.href)}>{item.title}</a></li>)}</ul> : <p class="fine">No approved readable notes.</p>}</section>;
  });
  const approvals = runtime.reviews();
  const pendingCount = approvals.filter(app => app.status !== 'active').length;
  const reviewNotice = <>{pendingCount > 0 && <p class="notice review-notice">{pendingCount} app definition{pendingCount === 1 ? '' : 's'} need review. No permissions are granted automatically. <a href="/vault/apps">Review exact sources and permissions →</a></p>}<QuickApprovalForm visitor={visitor} apps={approvals} /></>;
  return <div id="canvas" tabindex={-1} data-revision={workspace.revision} data-focus="">{heading}{reviewNotice}{!root.links.some(link => link.rel === 'type') && <p class="empty">Your vault is not active yet. Start with <a href="/vault/apps">App review</a>; only the permissions you explicitly select will be enabled.</p>}
    <div class="today-grid">
      <section class="panel today-schedule"><div class="section-heading"><div><p class="eyebrow">ON THE CALENDAR</p><h2>Today’s schedule</h2></div><a href={link('/vault/calendar')}>Calendar →</a></div>{scheduleItems.length ? <ul class="day-schedule">{scheduleRows(scheduleItems)}</ul> : <p class="fine">No approved events or scheduled tasks for today.</p>}<nav class="day-navigation" aria-label="Calendar days"><a href={link(`/vault/calendar?date=${localDate(-1)}`)}>← Yesterday</a><a href={link(`/vault/calendar?date=${localDate(1)}`)}>Tomorrow →</a></nav>{nextItems.length > 0 && <details class="upcoming" open><summary>Coming up</summary><ul class="day-schedule">{scheduleRows(nextItems)}</ul></details>}</section>
      <section class="panel today-tasks"><div class="section-heading"><div><p class="eyebrow">MOVE WORK FORWARD</p><h2>Unfinished tasks <span class="tag">{tasks.items?.length ?? 0}</span></h2></div><a href={link('/vault/tasks')}>All tasks →</a></div>{taskCreateForm}<ul class="today-task-list">{taskCards.length ? taskCards : <li class="fine empty">No unfinished tasks in the approved collection.</li>}</ul></section>
      <section class="panel today-journal"><div class="section-heading"><div><p class="eyebrow">ONE DAY / YOUR OWN WORDS</p><h2>Daily journal</h2></div><a href={link('/vault/journal')}>History →</a></div><p class="fine">Free-form Markdown. Use “Link in journal” beside a task to insert a wiki link, then save.</p>{journalContent}</section>
      <section class="panel today-para"><div class="section-heading"><div><p class="eyebrow">KEEP CONTEXT NEARBY</p><h2>PARA</h2></div><a href={link('/vault/para')}>Browse →</a></div><div class="para-grid">{groups}</div></section>
    </div>{undo}
  </div>;
}

export function todayCanvas(workspace: Workspace, visitor: Visitor, runtime: VaultRuntime): string {
  return (<TodayCanvas workspace={workspace} visitor={visitor} runtime={runtime} />).toString();
}

export function todayPage(workspace: Workspace, visitor: Visitor, runtime: VaultRuntime): string {
  return page(workspace.plan.title, (<div class="workbench today-workbench" data-workspace={workspace.id}>{raw(conversationPanel(workspace, visitor))}<section class="canvas-region" aria-label="Today workspace"><div id="pending-update" role="status" hidden>The workspace changed. Your unfinished form has been kept. <button type="button" id="apply-update">Discard form edits and refresh</button></div><TodayCanvas workspace={workspace} visitor={visitor} runtime={runtime} /></section></div>).toString(), true);
}

function AppReviewPanel({ app, index, visitor }: { app: AppReview; index: number; visitor: Visitor }) {
  return <article class="panel app-review"><div class="section-heading"><div><h2>{app.name}</h2><p class="fine">{app.path}</p></div><span class="tag">{app.status}</span></div><dl class="facts"><div><dt>App ID</dt><dd>{app.id}</dd></div><div><dt>Exact SHA-256 revision</dt><dd><code>{app.revision}</code></dd></div></dl>
    {app.diagnostics.length > 0 && <ul class="app-diagnostics">{app.diagnostics.map(diagnostic => <li><strong>{diagnostic.severity} · {diagnostic.code}</strong> {diagnostic.file}:{diagnostic.line}:{diagnostic.column} — {diagnostic.message}</li>)}</ul>}
    <details class="definition-source" open><summary>Exact definition source</summary><pre><code>{app.source}</code></pre></details>
    {app.status === 'invalid' ? <p class="notice">This definition is invalid and cannot be approved. Correct the stored definition, then reload this review.</p> : <form method="post" action="/vault/approve"><input type="hidden" name="csrf" value={visitor.csrf} /><input type="hidden" name="app" value={app.id} /><input type="hidden" name="revision" value={app.revision} /><fieldset><legend>Permissions for this exact revision</legend><p class="fine">Unchecked permissions are denied. Saving with no permissions revokes all access for this app. Existing grants are selected only for an active, unchanged revision.</p>{app.permissions.map((permission, permissionIndex) => <label class="permission" for={`permission-${index}-${permissionIndex}`}><input id={`permission-${index}-${permissionIndex}`} type="checkbox" name="permissions" value={permission} checked={app.status === 'active' && app.granted.includes(permission)} /><span><code>{permission}</code><small>{permission === 'notes:read' ? 'Read ordinary, untyped notes throughout the visible vault.' : permission.startsWith('read:') ? 'Read valid records of this document type.' : permission.startsWith('create:') ? 'Create records through declared actions.' : 'Update records through declared actions; no unrestricted database writes.'}</small></span></label>)}</fieldset><button class="primary">{app.status === 'active' ? 'Save exact permissions' : 'Approve selected permissions'}</button></form>}
  </article>;
}

export function approvalPage(visitor: Visitor, runtime: VaultRuntime): string {
  const apps = runtime.reviews();
  return page('Review vault apps', (<section class="approval-page"><p class="eyebrow">BROWSER-ONLY / EXPLICIT CONSENT</p><h1>Review your apps.</h1><p class="lead">Use quick setup to approve all current apps, or inspect the exact sources and select permissions individually. Approval applies only to these revisions; editing a stored definition suspends its permissions until you approve it again.</p><p><a href="/">← Back to Today</a></p><QuickApprovalForm visitor={visitor} apps={apps} />{apps.length ? apps.map((app, index) => <AppReviewPanel app={app} index={index} visitor={visitor} />) : <p class="empty">No app definitions have been imported into the database.</p>}</section>).toString());
}
