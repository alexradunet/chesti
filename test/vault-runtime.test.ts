import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { stringify } from 'yaml';
import { AppError } from '../src/core.js';
import { openDatabase } from '../src/database.js';
import { parseMarkdown } from '../src/vault/markdown.js';
import { VaultRuntime, type VaultMutation } from '../src/vault/runtime.js';
import type { AppDefinition } from '../src/vault/schema.js';

const sample = resolve('examples/life-vault');
const taskPath = 'Projects/Website/Tasks/Publish homepage.md';
function fixture(t: TestContext, prepare?: (root: string) => void) {
  const home = mkdtempSync(join(tmpdir(), 'lifeapps-runtime-'));
  const root = join(home, 'vault');
  const file = join(home, 'taskdesk.sqlite');
  cpSync(sample, root, { recursive: true });
  const db = openDatabase(file);
  const connections = [db];
  t.after(() => { for (const connection of connections) connection.close(); rmSync(home, { recursive: true, force: true }); });
  prepare?.(root);
  return { home, root, db, runtime: new VaultRuntime(db, { importRoot: root }), reopen: () => {
    const connection = openDatabase(file); connections.push(connection); return new VaultRuntime(connection);
  } };
}
function approveAll(runtime: VaultRuntime) {
  runtime.approve(runtime.reviews().map(app => ({ app: app.id, revision: app.revision, permissions: app.permissions })));
}
function request(runtime: VaultRuntime, path: string, action: string, fields: Record<string, unknown> = {}, id = crypto.randomUUID()): VaultMutation {
  const record = runtime.snapshot().documents.find(document => document.file.path === path)!;
  const [app, type] = String(record.file.frontmatter.type).split('.') as [string, string];
  return { id, app, type, action, record: String(record.file.frontmatter.id), revision: record.file.revision, definitionRevision: runtime.reviews().find(review => review.id === app)!.revision, fields };
}
function create(runtime: VaultRuntime, app: string, type: string, fields: Record<string, unknown>, id = crypto.randomUUID()): VaultMutation {
  const review = runtime.reviews().find(review => review.id === app)!;
  return { id, app, type, action: 'create', revision: review.revision, definitionRevision: review.revision, fields };
}
function put(root: string, path: string, source: string) {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), source);
}
function document(runtime: VaultRuntime, path = taskPath) {
  return runtime.snapshot().documents.find(document => document.file.path === path)!.file;
}

test('approval independently gates reads, writes and plain notes and survives reopening', t => {
  const { root, runtime, reopen } = fixture(t);
  assert.equal(runtime.reviews().every(app => app.status === 'pending'), true);
  assert.deepEqual(runtime.snapshot().documents, []);
  const denied = runtime.execute(create(runtime, 'tasks', 'task', { title: 'Denied' }));
  assert.equal(denied.errorStatus, 403);
  const tasks = runtime.reviews().find(app => app.id === 'tasks')!;
  assert.throws(() => runtime.approve([{ app: 'tasks', revision: tasks.revision, permissions: ['notes:read'] }]), AppError);
  runtime.approve([{ app: 'tasks', revision: tasks.revision, permissions: ['create:tasks.task'] }]);
  const made = runtime.execute(create(runtime, 'tasks', 'task', { title: 'No implicit read' }));
  assert.equal(made.status, 'applied');
  assert.deepEqual(runtime.snapshot().documents, []);
  assert.equal(existsSync(join(root, made.path!)), false);
  runtime.approve([{ app: 'tasks', revision: tasks.revision, permissions: ['read:tasks.task'] }]);
  const parsed = document(runtime, made.path!);
  assert.equal(parsed.frontmatter.status, 'open');
  assert.equal(parsed.frontmatter.type, 'tasks.task');
  assert.equal(parsed.frontmatter.schema, 1);
  assert.equal(parsed.title, 'No implicit read');
  assert.equal(made.path, `Inbox/Tasks/${String(parsed.frontmatter.id)}.md`);
  assert.equal(runtime.execute(request(runtime, made.path!, 'complete')).errorStatus, 403);
  const wiki = runtime.reviews().find(app => app.id === 'wiki')!;
  runtime.approve([{ app: 'wiki', revision: wiki.revision, permissions: ['read:wiki.page'] }]);
  assert.equal(runtime.snapshot().documents.some(doc => doc.kind === 'note'), false);
  runtime.approve([{ app: 'wiki', revision: wiki.revision, permissions: ['notes:read'] }]);
  assert.equal(runtime.snapshot().documents.filter(doc => doc.kind === 'note').length, 3);
  const restarted = reopen();
  assert.deepEqual(restarted.reviews().find(app => app.id === 'wiki')!.granted, ['notes:read']);
  assert.deepEqual(restarted.receipt(denied.id), denied);
});

test('definition revisions suspend grants and stale actions remain stale after reapproval', t => {
  const { runtime } = fixture(t); approveAll(runtime);
  const before = document(runtime).source;
  const action = request(runtime, taskPath, 'complete');
  const tasks = runtime.reviews().find(app => app.id === 'tasks')!;
  runtime.updateDefinition(tasks.path, tasks.source.replace('set: {status: done}', 'set: {status: active}'));
  assert.equal(runtime.reviews().find(app => app.id === 'tasks')!.status, 'pending');
  assert.equal(runtime.snapshot().documents.some(doc => doc.file.frontmatter.type === 'tasks.task'), false);
  assert.equal(runtime.execute(action).errorStatus, 403);
  const review = runtime.reviews().find(app => app.id === 'tasks')!;
  assert.throws(() => runtime.approve([{ app: 'tasks', revision: action.definitionRevision!, permissions: review.permissions }]), AppError);
  runtime.approve([{ app: 'tasks', revision: review.revision, permissions: review.permissions }]);
  assert.equal(runtime.execute({ ...action, id: crypto.randomUUID() }).errorStatus, 409);
  assert.equal(document(runtime).source, before);
  runtime.updateDefinition(tasks.path, tasks.source);
  assert.equal(runtime.reviews().find(app => app.id === 'tasks')!.status, 'pending');
});

test('bulk approval rejects stale batches atomically and excludes later definitions', t => {
  const { runtime, reopen } = fixture(t);
  const reviews = runtime.reviews();
  const approvals = reviews.map(app => ({ app: app.id, revision: app.revision, permissions: app.permissions }));
  const last = reviews.at(-1)!;
  runtime.updateDefinition(last.path, last.source + '\nChanged after review.\n');
  assert.throws(() => runtime.approve(approvals), (error: unknown) => error instanceof AppError && error.status === 409);
  assert.deepEqual(runtime.snapshot().documents, []);
  assert.ok(reopen().reviews().every(app => app.status === 'pending' && app.granted.length === 0));
  runtime.updateDefinition(last.path, last.source);
  runtime.updateDefinition('.apps/Later.md', reviews.find(app => app.id === 'tasks')!.source.replace('id: tasks', 'id: later'));
  runtime.approve(approvals);
  const restarted = reopen();
  assert.equal(restarted.reviews().find(app => app.id === 'later')!.status, 'pending');
  assert.equal(restarted.execute(create(restarted, 'tasks', 'task', { title: 'Bulk-approved task' })).status, 'applied');
  assert.equal(restarted.snapshot().documents.filter(document => document.kind === 'note').length, 3);
});

test('content revisions, fixed sets, field allowlists and predicates are authoritative', t => {
  const { runtime } = fixture(t); approveAll(runtime);
  const stale = request(runtime, taskPath, 'complete');
  assert.equal(runtime.execute(request(runtime, taskPath, 'edit', { title: 'Changed in database' })).status, 'applied');
  assert.equal(runtime.execute(stale).errorStatus, 409);
  assert.equal(document(runtime).title, 'Changed in database');
  assert.equal(runtime.execute(request(runtime, taskPath, 'complete', { status: 'open' })).errorStatus, 422);
  assert.equal(runtime.execute(request(runtime, taskPath, 'complete')).status, 'applied');
  assert.equal(document(runtime).frontmatter.status, 'done');
  assert.equal(runtime.execute(request(runtime, taskPath, 'complete')).errorStatus, 409);
  assert.equal(runtime.execute(request(runtime, taskPath, 'edit', { path: '../../elsewhere.md' })).errorStatus, 422);
});

test('imported formatting, unknown metadata and body survive mutation and exclusive export', t => {
  let source = '';
  const { home, root, runtime } = fixture(t, root => {
    const old = parseMarkdown(taskPath, readFileSync(join(root, taskPath), 'utf8'));
    source = `\uFEFF---\r\n# envelope comment\r\nid: ${String(old.frontmatter.id)}\r\ntype: tasks.task\r\nschema: 1\r\nstatus: open   # keep status comment\r\ndue: 2026-09-24 # keep date comment\r\ncustom: | # keep block header\r\n  untouched line\r\n  another line\r\n---\r\n# Original **heading**\r\n\r\nBody  with spaces.\r\n\r\n<!-- keep HTML as inert text -->\r\n`;
    put(root, taskPath, source);
  });
  approveAll(runtime);
  assert.equal(runtime.execute(request(runtime, taskPath, 'complete')).status, 'applied');
  const completed = source.replace('status: open', 'status: "done"');
  assert.equal(document(runtime).source, completed);
  assert.equal(runtime.execute(request(runtime, taskPath, 'edit', { title: 'Literal *title*', due: null })).status, 'applied');
  const changed = document(runtime);
  assert.equal(changed.frontmatter.due, undefined);
  assert.equal(changed.frontmatter.custom, 'untouched line\nanother line\n');
  assert.match(changed.source, /# keep date comment\r\n/);
  assert.equal(changed.title, 'Literal *title*');
  assert.equal(readFileSync(join(root, taskPath), 'utf8'), source);
  const destination = join(home, 'export');
  runtime.exportTo(destination);
  assert.equal(readFileSync(join(destination, taskPath), 'utf8'), changed.source);
  assert.throws(() => runtime.exportTo(root));
  assert.equal(readFileSync(join(root, taskPath), 'utf8'), source);
});

test('structured temporal values and heading-less Markdown remain editable', t => {
  const { runtime } = fixture(t, root => {
    const old = parseMarkdown(taskPath, readFileSync(join(root, taskPath), 'utf8'));
    put(root, taskPath, `---\n{ id: ${String(old.frontmatter.id)}, type: tasks.task, schema: 1, status: open, due: 2026-09-24 } # map comment\n---\nPlain body.\n`);
  });
  approveAll(runtime);
  const scheduled = { start: '2026-09-23T10:00:00Z', end: '2026-09-23T11:00:00Z', timeZone: 'UTC' };
  assert.equal(runtime.execute(request(runtime, taskPath, 'edit', { due: null, title: 'New heading', scheduled })).status, 'applied');
  const file = document(runtime);
  assert.equal(file.frontmatter.due, undefined);
  assert.deepEqual(file.frontmatter.scheduled, scheduled);
  assert.equal(file.title, 'New heading');
  assert.equal(file.body, '# New heading\n\nPlain body.\n');
  assert.match(file.source, /# map comment\n/);
});

test('custom app fields retain block-scalar neighbors when updated', t => {
  let source = '';
  const { runtime } = fixture(t, root => {
    const appPath = '.apps/Tasks.md';
    const app = parseMarkdown(appPath, readFileSync(join(root, appPath), 'utf8'));
    const definition = app.frontmatter as unknown as AppDefinition;
    definition.types.task!.fields.summary = { type: 'text' };
    const edit = definition.types.task!.actions.edit!;
    if (edit.operation === 'record.update') edit.fields!.push('summary');
    put(root, appPath, `---\n${stringify(definition)}---\n${app.body}`);
    const original = parseMarkdown(taskPath, readFileSync(join(root, taskPath), 'utf8'));
    source = `---\nid: ${String(original.frontmatter.id)}\ntype: tasks.task\nschema: 1\nstatus: open\nsummary: | # header stays\n  old summary\ncustom: 'do not touch' # neighbor stays\n---\n# Original\n\nBody stays.\n`;
    put(root, taskPath, source);
  });
  approveAll(runtime);
  assert.equal(runtime.execute(request(runtime, taskPath, 'edit', { summary: 'New summary' })).status, 'applied');
  assert.equal(document(runtime).source, source.replace('summary: | # header stays\n  old summary\n', 'summary: "New summary" # header stays\n'));
});

test('prospective validation rejects invalid fields, references and duplicate unique keys without record changes', t => {
  const { runtime } = fixture(t); approveAll(runtime);
  const before = document(runtime).source;
  for (const fields of [{ due: '2026-02-30' }, { due: 123 }, { project: crypto.randomUUID() }, { scheduled: { start: '2026-09-23T11:00:00Z', end: '2026-09-23T10:00:00Z', timeZone: 'UTC' } }]) {
    assert.equal(runtime.execute(request(runtime, taskPath, 'edit', fields)).errorStatus, 422);
    assert.equal(document(runtime).source, before);
  }
  assert.equal(runtime.execute(create(runtime, 'journal', 'entry', { date: '2026-09-23', body: 'Duplicate' })).errorStatus, 422);
  const made = runtime.execute(create(runtime, 'journal', 'entry', { date: '2026-09-24', body: 'A new day.\n' }));
  assert.equal(made.status, 'applied');
  const journal = document(runtime, made.path!).source;
  assert.equal(runtime.execute(request(runtime, made.path!, 'edit', { date: '2026-09-23' })).errorStatus, 422);
  assert.equal(runtime.execute(request(runtime, made.path!, 'edit', { date: null })).errorStatus, 422);
  assert.equal(document(runtime, made.path!).source, journal);
  assert.equal(runtime.execute(create(runtime, 'tasks', 'task', { title: 'Bad\nheading' })).errorStatus, 422);
  assert.equal(runtime.execute(create(runtime, 'tasks', 'task', { body: 'x'.repeat(1_048_576) })).errorStatus, 413);
});

test('references are validated against approved definitions without leaking unreadable targets', t => {
  const { runtime } = fixture(t);
  const tasks = runtime.reviews().find(app => app.id === 'tasks')!;
  runtime.approve([{ app: 'tasks', revision: tasks.revision, permissions: ['read:tasks.task'] }]);
  assert.equal(runtime.snapshot().documents.some(doc => doc.file.path === taskPath), false);
  assert.ok(runtime.snapshot().report.diagnostics.every(item => !item.related?.length));
  const wiki = runtime.reviews().find(app => app.id === 'wiki')!;
  runtime.approve([{ app: 'wiki', revision: wiki.revision, permissions: [] }]);
  assert.equal(runtime.snapshot().documents.some(doc => doc.file.path === taskPath), true);
  assert.equal(runtime.snapshot().documents.some(doc => doc.file.frontmatter.type === 'wiki.page'), false);
});

test('definition schema changes expose incompatible records as diagnostics, never actions', t => {
  const { runtime } = fixture(t); approveAll(runtime);
  const mutation = request(runtime, taskPath, 'complete');
  const tasks = runtime.reviews().find(app => app.id === 'tasks')!;
  const parsed = parseMarkdown(tasks.path, tasks.source);
  const definition = parsed.frontmatter as unknown as AppDefinition;
  definition.types.task!.version = 2;
  runtime.updateDefinition(tasks.path, `---\n${stringify(definition)}---\n${parsed.body}`);
  approveAll(runtime);
  const snapshot = runtime.snapshot();
  assert.equal(snapshot.report.valid, false);
  assert.equal(snapshot.documents.some(doc => doc.file.path === taskPath), false);
  assert.equal(snapshot.report.diagnostics.some(item => item.file === taskPath && item.code === 'RECORD_SCHEMA_VERSION'), true);
  assert.equal(runtime.execute({ ...mutation, definitionRevision: runtime.reviews().find(app => app.id === 'tasks')!.revision }).errorStatus, 422);
});

test('success and failure receipts survive reopening and conflicting IDs cannot replace them', t => {
  const { runtime, reopen } = fixture(t); approveAll(runtime);
  const mutation = create(runtime, 'tasks', 'task', { title: 'Exactly once' });
  const result = runtime.execute(mutation);
  assert.equal(result.status, 'applied');
  const restarted = reopen();
  assert.deepEqual(restarted.execute(mutation), result);
  assert.equal(restarted.snapshot().documents.filter(doc => doc.file.title === 'Exactly once').length, 1);
  assert.equal(restarted.execute({ ...mutation, fields: { title: 'Different' } }).errorStatus, 409);
  assert.deepEqual(reopen().receipt(mutation.id), result);
  const invalid = create(restarted, 'journal', 'entry', { date: 'bad-date' });
  const failed = restarted.execute(invalid);
  assert.equal(failed.status, 'failed');
  assert.deepEqual(reopen().execute(invalid), failed);
});

test('outer rollback couples records, grants and receipts without retaining cached authority', t => {
  const { db, runtime, reopen } = fixture(t);
  assert.throws(() => db.transaction(() => { approveAll(runtime); throw new Error('abort approval'); })());
  assert.equal(reopen().reviews().every(review => review.status === 'pending'), true);
  approveAll(runtime);
  const before = document(runtime).source;
  const mutation = request(runtime, taskPath, 'complete');
  assert.throws(() => db.transaction(() => {
    assert.equal(runtime.execute(mutation).status, 'applied');
    throw new Error('outer conversation commit failed');
  })());
  const restarted = reopen();
  assert.equal(restarted.receipt(mutation.id), undefined);
  assert.equal(document(runtime).source, before);
  assert.equal(document(restarted).source, before);
  const result = restarted.execute(mutation);
  assert.equal(result.status, 'applied');
  assert.deepEqual(reopen().execute(mutation), result);
});

test('receipt persistence failure rolls back the record and permits a clean retry', t => {
  const { db, runtime, reopen } = fixture(t); approveAll(runtime);
  const before = document(runtime).source;
  const mutation = request(runtime, taskPath, 'complete');
  db.exec("CREATE TRIGGER reject_receipt BEFORE INSERT ON vault_receipts BEGIN SELECT RAISE(ABORT, 'receipt unavailable'); END");
  assert.throws(() => runtime.execute(mutation));
  assert.equal(document(reopen()).source, before);
  assert.equal(runtime.receipt(mutation.id), undefined);
  db.exec('DROP TRIGGER reject_receipt');
  assert.equal(runtime.execute(mutation).status, 'applied');
});

test('import is once-only and subsequent reads and mutations ignore all filesystem changes', t => {
  const { root, runtime, reopen } = fixture(t); approveAll(runtime);
  const mutation = request(runtime, taskPath, 'complete');
  rmSync(root, { recursive: true });
  runtime.importRoot(root);
  assert.equal(runtime.execute(mutation).status, 'applied');
  const restarted = reopen();
  assert.equal(document(restarted).frontmatter.status, 'done');
  assert.equal(existsSync(root), false);
});

test('invalid or unsafe imports fail atomically, retain source files, and can be repaired explicitly', t => {
  const home = mkdtempSync(join(tmpdir(), 'lifeapps-import-'));
  const root = join(home, 'vault');
  cpSync(sample, root, { recursive: true });
  const db = openDatabase();
  t.after(() => { db.close(); rmSync(home, { recursive: true, force: true }); });
  const runtime = new VaultRuntime(db);
  const original = readFileSync(join(root, taskPath), 'utf8');
  writeFileSync(join(root, taskPath), original.replace('status: open', 'status: invalid'));
  assert.throws(() => runtime.importRoot(root), AppError);
  assert.deepEqual(runtime.reviews(), []);
  assert.equal(runtime.root, '');
  assert.match(readFileSync(join(root, taskPath), 'utf8'), /status: invalid/);
  writeFileSync(join(root, taskPath), original);
  symlinkSync(join(root, taskPath), join(root, 'Linked.md'));
  assert.throws(() => runtime.importRoot(root), AppError);
  rmSync(join(root, 'Linked.md'));
  linkSync(join(root, taskPath), join(home, 'outside.md'));
  assert.throws(() => runtime.importRoot(root), AppError);
  rmSync(join(home, 'outside.md'));
  writeFileSync(join(root, 'attachment.bin'), 'unsupported');
  assert.throws(() => runtime.importRoot(root), AppError);
  rmSync(join(root, 'attachment.bin'));
  put(root, '.lifeapps/runtime.json', '{');
  assert.throws(() => runtime.importRoot(root), AppError);
  assert.equal(readFileSync(join(root, '.lifeapps/runtime.json'), 'utf8'), '{');
  rmSync(join(root, '.lifeapps/runtime.json'));
  runtime.importRoot(root);
  assert.equal(runtime.reviews().every(review => review.status === 'pending'), true);
});

for (const phase of ['unpublished', 'published', 'linked'] as const) test(`legacy ${phase} journal is recognized without replaying or modifying input`, t => {
  const home = mkdtempSync(join(tmpdir(), 'lifeapps-journal-'));
  const root = join(home, 'vault');
  cpSync(sample, root, { recursive: true });
  const db = openDatabase();
  t.after(() => { db.close(); rmSync(home, { recursive: true, force: true }); });
  const source = readFileSync(join(root, taskPath), 'utf8');
  const after = phase === 'linked' ? source.replace(String(parseMarkdown(taskPath, source).frontmatter.id), crypto.randomUUID()) : source.replace('status: open', 'status: done');
  const target = phase === 'linked' ? 'Inbox/Tasks/Legacy.md' : taskPath;
  const temporary = `${dirname(target)}/.lifeapps-1234.tmp`;
  put(root, temporary, after);
  if (phase === 'published') put(root, target, after);
  if (phase === 'linked') linkSync(join(root, temporary), join(root, target));
  const revision = createHash('sha256').update(after).digest('hex');
  const result = { id: 'interrupted', status: 'applied', message: 'Record updated.', path: target, revision };
  const state = { version: 1, root, approvals: {}, receipts: {}, pending: { id: result.id, fingerprint: 'a'.repeat(64), path: target, temporary, ...(phase === 'linked' ? {} : { before: createHash('sha256').update(source).digest('hex') }), after: revision, result } };
  const encoded = JSON.stringify(state);
  put(root, '.lifeapps/runtime.json', encoded);
  const runtime = new VaultRuntime(db, { importRoot: root });
  assert.equal(runtime.receipt('interrupted')!.status, phase === 'unpublished' ? 'failed' : 'applied');
  assert.equal(readFileSync(join(root, temporary), 'utf8'), after);
  assert.equal(readFileSync(join(root, '.lifeapps/runtime.json'), 'utf8'), encoded);
  assert.equal(readFileSync(join(root, target), 'utf8'), phase === 'unpublished' ? source : after);
});
