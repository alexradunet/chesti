import { AppError, type Action, type Resolve, type Resource } from './core.js';

export interface Issue {
  id: string;
  title: string;
  summary: string;
  priority: 'P1' | 'P2' | 'P3';
  status: 'open' | 'active' | 'closed';
  owner: 'unassigned' | 'alex' | 'sam' | 'jo';
  version: number;
}
export const owners = [
  { value: 'unassigned', label: 'Unassigned' },
  { value: 'alex', label: 'Alex (you)' },
  { value: 'sam', label: 'Sam' },
  { value: 'jo', label: 'Jo' },
];
const priorities = [
  { value: 'P1', label: 'P1 · Critical' },
  { value: 'P2', label: 'P2 · Important' },
  { value: 'P3', label: 'P3 · Routine' },
];
const statuses = { open: 'Open', active: 'In progress', closed: 'Closed' };

export function seedIssues(): Issue[] {
  return [
    { id: 'ISS-101', title: 'Checkout stalls on slow connections', summary: 'The payment step remains pending when the network drops during confirmation. Reproduce with network throttling before changing retry behavior.', priority: 'P1', status: 'open', owner: 'unassigned', version: 1 },
    { id: 'ISS-102', title: 'Keyboard focus escapes the search dialog', summary: 'Tab moves behind the overlay after selecting a result. Keep keyboard navigation inside the modal and restore focus when it closes.', priority: 'P2', status: 'active', owner: 'alex', version: 1 },
    { id: 'ISS-103', title: 'CSV export omits the final row', summary: 'Exports with more than one page are missing the last record. Compare the export cursor against the collection pagination boundary.', priority: 'P1', status: 'open', owner: 'alex', version: 1 },
    { id: 'ISS-104', title: 'Make empty projects feel intentional', summary: 'A project without issues currently shows a blank table. Add a useful explanation and a clear next action.', priority: 'P3', status: 'open', owner: 'jo', version: 1 },
    { id: 'ISS-105', title: 'Invitation links expire without explanation', summary: 'Expired invitations return a generic error. Explain the expiry and expose the appropriate recovery action.', priority: 'P2', status: 'open', owner: 'unassigned', version: 1 },
    { id: 'ISS-106', title: 'Respect reduced-motion preferences', summary: 'Navigation transitions now opt out when the operating system requests reduced motion.', priority: 'P3', status: 'closed', owner: 'sam', version: 1 },
  ];
}

export function issueResource(issue: Issue): Resource {
  const href = `/issues/${issue.id}`;
  const action = (id: string, title: string, fields: Action['fields'] = []): Action => ({ id, title, href: `${href}/${id}`, method: 'post', fields });
  const actions = issue.status === 'closed'
    ? [action('reopen', 'Reopen issue')]
    : [
        action('assign', 'Update assignee', [{ name: 'owner', label: 'Assignee', value: issue.owner, options: owners }]),
        action('prioritize', 'Update priority', [{ name: 'priority', label: 'Priority', value: issue.priority, options: priorities }]),
        ...(issue.status === 'open' ? [action('start', 'Start work')] : []),
        action('close', 'Close issue'),
      ];
  return {
    href, kind: 'record', title: issue.title, description: issue.summary, version: issue.version,
    facts: { ID: issue.id, Priority: issue.priority, Status: statuses[issue.status], Assignee: owners.find(o => o.value === issue.owner)!.label },
    links: [{ rel: 'collection', href: '/issues', title: 'All issues' }], actions,
  };
}

const scopes: Record<string, { title: string; description: string; test: (issue: Issue) => boolean }> = {
  all: { title: 'All issues', description: 'The complete issue register, ordered by priority.', test: () => true },
  triage: { title: 'Triage queue', description: 'Open, unassigned issues. Highest priority first.', test: i => i.status !== 'closed' && i.owner === 'unassigned' },
  mine: { title: 'Your next work', description: 'Unfinished issues assigned to Alex, ordered by priority.', test: i => i.status !== 'closed' && i.owner === 'alex' },
  open: { title: 'Open work', description: 'All unfinished work across the team, ordered by priority.', test: i => i.status !== 'closed' },
};

export function issueResolver(issues: Issue[]): Resolve {
  return (href: string): Resource => {
    // Exact advertised routes, not a general-purpose URL fetcher.
    const item = issues.find(i => href === `/issues/${i.id}`);
    if (item) return issueResource(item);
    const scope = href === '/issues' ? 'all' : Object.keys(scopes).find(s => href === `/issues?scope=${s}`);
    if (!scope || !scopes[scope]) throw new AppError(404, 'Resource not found.');
    const definition = scopes[scope];
    return {
      href, kind: 'collection', title: definition.title, description: definition.description, facts: {}, actions: [],
      links: Object.entries(scopes).map(([key, value]) => ({ rel: key, href: key === 'all' ? '/issues' : `/issues?scope=${key}`, title: value.title })),
      items: issues.filter(definition.test).toSorted((a, b) => a.priority.localeCompare(b.priority) || a.id.localeCompare(b.id)).map(issueResource),
    };
  };
}

export function applyAction(issues: Issue[], id: string, actionId: string, fields: URLSearchParams): void {
  const issue = issues.find(i => i.id === id);
  if (!issue) throw new AppError(404, 'Issue not found.');
  if (fields.get('version') !== String(issue.version)) throw new AppError(409, 'This issue changed since you opened it. Reload before submitting again.');
  const action = issueResource(issue).actions.find(a => a.id === actionId);
  if (!action) throw new AppError(409, 'This action is no longer available. Reload to see the current actions.');
  const allowed = new Set(['csrf', 'version', 'workspace', ...action.fields.map(f => f.name)]);
  for (const [key] of fields) {
    if (!allowed.has(key) || fields.getAll(key).length !== 1) throw new AppError(422, 'Unexpected or repeated form field.');
  }
  for (const field of action.fields) {
    if (!field.options.some(o => o.value === fields.get(field.name))) throw new AppError(422, `Choose a valid ${field.label.toLowerCase()}.`);
  }
  switch (actionId) {
    case 'assign': issue.owner = fields.get('owner') as Issue['owner']; break;
    case 'prioritize': issue.priority = fields.get('priority') as Issue['priority']; break;
    case 'start': issue.status = 'active'; break;
    case 'close': issue.status = 'closed'; break;
    case 'reopen': issue.status = 'open'; break;
    default: throw new AppError(404, 'Action not found.');
  }
  issue.version++;
}
