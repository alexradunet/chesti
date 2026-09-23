import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, linkSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { stringify } from 'yaml';
import { AppError } from '../src/core.js';
import { parseMarkdown } from '../src/vault/markdown.js';
import { VaultRuntime, type VaultMutation } from '../src/vault/runtime.js';
import type { AppDefinition } from '../src/vault/schema.js';

const sample = resolve('examples/life-vault');
const taskPath = 'Projects/Website/Tasks/Publish homepage.md';
function fixture(t: TestContext) {
  const root = mkdtempSync(join(tmpdir(), 'lifeapps-runtime-'));
  cpSync(sample, root, { recursive: true });
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return { root, runtime: new VaultRuntime(root) };
}
function approveAll(runtime: VaultRuntime) {
  for (const app of runtime.reviews()) runtime.approve(app.id, app.revision, app.permissions);
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

test('approval binds exact source and grants independently gate reads, writes and plain notes', t => {
  const { root, runtime } = fixture(t);
  assert.equal(runtime.reviews().every(app => app.status === 'pending'), true);
  assert.deepEqual(runtime.snapshot().documents, []);
  const denied = runtime.execute(create(runtime, 'tasks', 'task', { title: 'Denied' }));
  assert.equal(denied.errorStatus, 403);
  const tasks = runtime.reviews().find(app => app.id === 'tasks')!;
  assert.throws(() => runtime.approve('tasks', tasks.revision, ['notes:read']), AppError);
  runtime.approve('tasks', tasks.revision, ['create:tasks.task']);
  const made = runtime.execute(create(runtime, 'tasks', 'task', { title: 'No implicit read' }));
  assert.equal(made.status, 'applied');
  assert.deepEqual(runtime.snapshot().documents, []);
  assert.equal(runtime.snapshot().apps.some(app => app.definition?.id === 'tasks'), true);
  const parsed = parseMarkdown(made.path!, readFileSync(join(root, made.path!), 'utf8'));
  assert.equal(parsed.frontmatter.status, 'open');
  assert.equal(parsed.frontmatter.type, 'tasks.task');
  assert.equal(parsed.frontmatter.schema, 1);
  assert.equal(parsed.title, 'No implicit read');
  assert.equal(made.path, `Inbox/Tasks/${String(parsed.frontmatter.id)}.md`);
  runtime.approve('tasks', tasks.revision, ['read:tasks.task']);
  assert.equal(runtime.snapshot().documents.some(doc => doc.file.path === made.path), true);
  assert.equal(runtime.execute(request(runtime, made.path!, 'complete')).errorStatus, 403);
  const wiki = runtime.reviews().find(app => app.id === 'wiki')!;
  runtime.approve('wiki', wiki.revision, ['read:wiki.page']);
  assert.equal(runtime.snapshot().documents.some(doc => doc.kind === 'note'), false);
  runtime.approve('wiki', wiki.revision, ['notes:read']);
  assert.equal(runtime.snapshot().documents.filter(doc => doc.kind === 'note').length, 3);
  const restart = new VaultRuntime(root);
  assert.deepEqual(restart.reviews().find(app => app.id === 'wiki')!.granted, ['notes:read']);
  assert.deepEqual(restart.receipt(denied.id), denied);
});

test('definition edits suspend apps and old confirmed actions remain stale after reapproval', t => {
  const { root, runtime } = fixture(t); approveAll(runtime);
  const before = readFileSync(join(root, taskPath), 'utf8');
  const action = request(runtime, taskPath, 'complete');
  const appFile = join(root, '.apps/Tasks.md');
  writeFileSync(appFile, readFileSync(appFile, 'utf8').replace('set: {status: done}', 'set: {status: active}'));
  assert.equal(runtime.reviews().find(app => app.id === 'tasks')!.status, 'pending');
  assert.equal(runtime.snapshot().documents.some(doc => doc.file.frontmatter.type === 'tasks.task'), false);
  assert.equal(runtime.execute(action).errorStatus, 403);
  const review = runtime.reviews().find(app => app.id === 'tasks')!;
  assert.throws(() => runtime.approve('tasks', action.definitionRevision!, review.permissions), AppError);
  runtime.approve('tasks', review.revision, review.permissions);
  assert.equal(runtime.execute({ ...action, id: crypto.randomUUID() }).errorStatus, 409);
  assert.equal(readFileSync(join(root, taskPath), 'utf8'), before);
});

test('content revisions, fixed sets, field allowlists and action predicates are authoritative', t => {
  const { root, runtime } = fixture(t); approveAll(runtime);
  const source = readFileSync(join(root, taskPath), 'utf8');
  const stale = request(runtime, taskPath, 'complete');
  writeFileSync(join(root, taskPath), source + '\nExternal text.\n');
  assert.equal(runtime.execute(stale).errorStatus, 409);
  assert.equal(readFileSync(join(root, taskPath), 'utf8'), source + '\nExternal text.\n');
  assert.equal(runtime.execute(request(runtime, taskPath, 'complete', { status: 'open' })).errorStatus, 422);
  const result = runtime.execute(request(runtime, taskPath, 'complete'));
  assert.equal(result.status, 'applied');
  assert.equal(runtime.snapshot().documents.find(doc => doc.file.path === taskPath)!.file.frontmatter.status, 'done');
  assert.equal(runtime.execute(request(runtime, taskPath, 'complete')).errorStatus, 409);
  assert.equal(runtime.execute(request(runtime, taskPath, 'edit', { path: '../../elsewhere.md' })).errorStatus, 422);
});

test('updates preserve BOM, CRLF, untouched YAML, inline comments and Markdown byte-for-byte', t => {
  const { root, runtime } = fixture(t); approveAll(runtime);
  const old = parseMarkdown(taskPath, readFileSync(join(root, taskPath), 'utf8'));
  const source = `\uFEFF---\r\n# envelope comment\r\nid: ${String(old.frontmatter.id)}\r\ntype: tasks.task\r\nschema: 1\r\nstatus: open   # keep status comment\r\ndue: 2026-09-24 # keep date comment\r\ncustom: | # keep block header\r\n  untouched line\r\n  another line\r\n---\r\n# Original **heading**\r\n\r\nBody  with spaces.\r\n\r\n<!-- keep HTML as inert text -->\r\n`;
  put(root, taskPath, source);
  assert.equal(runtime.execute(request(runtime, taskPath, 'complete')).status, 'applied');
  const completed = source.replace('status: open', 'status: "done"');
  assert.equal(readFileSync(join(root, taskPath), 'utf8'), completed);
  assert.equal(runtime.execute(request(runtime, taskPath, 'edit', { title: 'Literal *title*' })).status, 'applied');
  const renamed = completed.replace('# Original **heading**', '# Literal \\*title\\*');
  assert.equal(readFileSync(join(root, taskPath), 'utf8'), renamed);
  assert.equal(runtime.execute(request(runtime, taskPath, 'edit', { due: null })).status, 'applied');
  const cleared = readFileSync(join(root, taskPath), 'utf8');
  assert.equal(parseMarkdown(taskPath, cleared).frontmatter.due, undefined);
  assert.match(cleared, /# keep date comment\r\n/);
  assert.equal(cleared.slice(cleared.indexOf('custom:')), renamed.slice(renamed.indexOf('custom:')));
});

test('flow metadata, multiline scalar comments, structured values and heading-less bodies remain editable', t => {
  const { root, runtime } = fixture(t); approveAll(runtime);
  const old = parseMarkdown(taskPath, readFileSync(join(root, taskPath), 'utf8'));
  put(root, taskPath, `---\n{ id: ${String(old.frontmatter.id)}, type: tasks.task, schema: 1, status: open, due: 2026-09-24 } # map comment\n---\nPlain body.\n`);
  assert.equal(runtime.execute(request(runtime, taskPath, 'edit', { due: null, title: 'New heading' })).status, 'applied');
  let file = parseMarkdown(taskPath, readFileSync(join(root, taskPath), 'utf8'));
  assert.equal(file.frontmatter.due, undefined); assert.equal(file.title, 'New heading');
  assert.equal(file.body, '# New heading\n\nPlain body.\n'); assert.match(file.source, /# map comment\n/);
  const scheduled = { start: '2026-09-23T10:00:00Z', end: '2026-09-23T11:00:00Z', timeZone: 'UTC' };
  put(root, taskPath, `---\nid: ${String(old.frontmatter.id)}\ntype: tasks.task\nschema: 1\nstatus: open\nscheduled:\n  start: ${scheduled.start} # start retained\n  end: ${scheduled.end} # end retained\n  timeZone: UTC\n---\n# Meeting\n`);
  assert.equal(runtime.execute(request(runtime, taskPath, 'edit', { scheduled: { ...scheduled, end: '2026-09-23T12:00:00Z' } })).status, 'applied');
  file = parseMarkdown(taskPath, readFileSync(join(root, taskPath), 'utf8'));
  assert.match(file.source, /start: 2026-09-23T10:00:00Z # start retained\n/);
  assert.match(file.source, /end: "2026-09-23T12:00:00Z" # end retained\n/);
  assert.match(file.source, /timeZone: UTC\n/);
});

test('changing a block scalar keeps its header comment and every neighboring byte', t => {
  const { root, runtime } = fixture(t);
  const appPath = '.apps/Tasks.md';
  const app = parseMarkdown(appPath, readFileSync(join(root, appPath), 'utf8'));
  const definition = app.frontmatter as unknown as AppDefinition;
  definition.types.task!.fields.summary = { type: 'text' };
  const edit = definition.types.task!.actions.edit!;
  if (edit.operation === 'record.update') edit.fields!.push('summary');
  put(root, appPath, `---\n${stringify(definition)}---\n${app.body}`);
  approveAll(runtime);
  const original = parseMarkdown(taskPath, readFileSync(join(root, taskPath), 'utf8'));
  const source = `---\nid: ${String(original.frontmatter.id)}\ntype: tasks.task\nschema: 1\nstatus: open\nsummary: | # header stays\n  old summary\ncustom: 'do not touch' # neighbor stays\n---\n# Original\n\nBody stays.\n`;
  put(root, taskPath, source);
  assert.equal(runtime.execute(request(runtime, taskPath, 'edit', { summary: 'New summary' })).status, 'applied');
  assert.equal(readFileSync(join(root, taskPath), 'utf8'), source.replace('summary: | # header stays\n  old summary\n', 'summary: "New summary" # header stays\n'));
});

test('prospective validation rejects bad types, unresolved references and duplicate journal dates without record writes', t => {
  const { root, runtime } = fixture(t); approveAll(runtime);
  const source = readFileSync(join(root, taskPath), 'utf8');
  for (const fields of [{ due: '2026-02-30' }, { due: 123 }, { project: crypto.randomUUID() }, { scheduled: { start: '2026-09-23T11:00:00Z', end: '2026-09-23T10:00:00Z', timeZone: 'UTC' } }]) {
    assert.equal(runtime.execute(request(runtime, taskPath, 'edit', fields)).errorStatus, 422);
    assert.equal(readFileSync(join(root, taskPath), 'utf8'), source);
  }
  assert.equal(runtime.execute(create(runtime, 'journal', 'entry', { date: '2026-09-23', body: 'Duplicate' })).errorStatus, 422);
  const made = runtime.execute(create(runtime, 'journal', 'entry', { date: '2026-09-24', body: 'A new day.\n' }));
  assert.equal(made.status, 'applied');
  const before = readFileSync(join(root, made.path!), 'utf8');
  assert.equal(runtime.execute(request(runtime, made.path!, 'edit', { date: '2026-09-23' })).errorStatus, 422);
  assert.equal(runtime.execute(request(runtime, made.path!, 'edit', { date: null })).errorStatus, 422);
  assert.equal(readFileSync(join(root, made.path!), 'utf8'), before);
  assert.equal(runtime.execute(create(runtime, 'tasks', 'task', { title: 'Bad\nheading' })).errorStatus, 422);
  assert.equal(runtime.execute(create(runtime, 'tasks', 'task', { body: 'x'.repeat(1_048_576) })).errorStatus, 413);
});

test('snapshot revalidates references against approved definitions, never merely candidate definitions', t => {
  const { runtime } = fixture(t);
  const tasks = runtime.reviews().find(app => app.id === 'tasks')!;
  runtime.approve('tasks', tasks.revision, ['read:tasks.task']);
  assert.equal(runtime.snapshot().documents.some(doc => doc.file.path === taskPath), false);
  const wiki = runtime.reviews().find(app => app.id === 'wiki')!;
  runtime.approve('wiki', wiki.revision, []);
  assert.equal(runtime.snapshot().documents.some(doc => doc.file.path === taskPath), true);
  assert.equal(runtime.snapshot().documents.some(doc => doc.file.frontmatter.type === 'wiki.page'), false);
});

test('externally invalid approved records remain diagnosable but are never actionable', t => {
  const { root, runtime } = fixture(t); approveAll(runtime);
  const original = readFileSync(join(root, taskPath), 'utf8');
  writeFileSync(join(root, taskPath), original.replace('status: open', 'status: impossible'));
  const snapshot = runtime.snapshot();
  assert.equal(snapshot.report.valid, false);
  assert.equal(snapshot.documents.some(doc => doc.file.path === taskPath), false);
  assert.equal(snapshot.report.diagnostics.some(item => item.file === taskPath && item.code === 'FIELD_VALUE'), true);
});

test('idempotent successes and failures survive restart; conflicting ID reuse cannot overwrite a receipt', t => {
  const { root, runtime } = fixture(t); approveAll(runtime);
  const mutation = create(runtime, 'tasks', 'task', { title: 'Exactly once' });
  const result = runtime.execute(mutation);
  assert.equal(result.status, 'applied');
  const restarted = new VaultRuntime(root);
  assert.deepEqual(restarted.execute(mutation), result);
  assert.equal(restarted.snapshot().documents.filter(doc => doc.file.title === 'Exactly once').length, 1);
  assert.equal(restarted.execute({ ...mutation, fields: { title: 'Different' } }).errorStatus, 409);
  assert.deepEqual(new VaultRuntime(root).receipt(mutation.id), result);
  const invalid = create(restarted, 'journal', 'entry', { date: 'bad-date' });
  const failed = restarted.execute(invalid);
  assert.equal(failed.status, 'failed');
  assert.deepEqual(new VaultRuntime(root).execute(invalid), failed);
});

function interrupt(root: string, mutation: VaultMutation, phase: 'before' | 'after' | 'linked') {
  const code = `
    import fs from 'node:fs';
    import { syncBuiltinESMExports } from 'node:module';
    import { VaultRuntime } from ${JSON.stringify(new URL('../src/vault/runtime.ts', import.meta.url).href)};
    const runtime = new VaultRuntime(process.env.VAULT_ROOT);
    const phase = process.env.INTERRUPT_PHASE;
    const originalOpen = fs.openSync, originalRename = fs.renameSync, originalLink = fs.linkSync;
    fs.openSync = function(path, ...args) {
      if (phase === 'before' && /\\.lifeapps-[a-f0-9-]+\\.tmp$/.test(String(path))) process.exit(75);
      return originalOpen.call(this, path, ...args);
    };
    fs.renameSync = function(from, to) {
      const result = originalRename.call(this, from, to);
      if (phase === 'after' && String(to).endsWith('.md')) process.exit(75);
      return result;
    };
    fs.linkSync = function(from, to) {
      const result = originalLink.call(this, from, to);
      if (phase === 'linked' && String(to).endsWith('.md')) process.exit(75);
      return result;
    };
    syncBuiltinESMExports();
    runtime.execute(JSON.parse(process.env.VAULT_MUTATION));
  `;
  const child = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '--eval', code], { env: { ...process.env, VAULT_ROOT: root, VAULT_MUTATION: JSON.stringify(mutation), INTERRUPT_PHASE: phase }, encoding: 'utf8', timeout: 20_000 });
  assert.equal(child.status, 75, child.stderr);
}

test('restart recovers a published update receipt and does not perform it twice', t => {
  const { root, runtime } = fixture(t); approveAll(runtime);
  const mutation = request(runtime, taskPath, 'complete');
  interrupt(root, mutation, 'after');
  const published = readFileSync(join(root, taskPath), 'utf8');
  assert.equal(parseMarkdown(taskPath, published).frontmatter.status, 'done');
  const restarted = new VaultRuntime(root);
  assert.equal(restarted.receipt(mutation.id)!.status, 'applied');
  assert.deepEqual(restarted.execute(mutation), restarted.receipt(mutation.id));
  assert.equal(readFileSync(join(root, taskPath), 'utf8'), published);
});

test('restart aborts unpublished work and never rolls forward over an external edit', t => {
  const { root, runtime } = fixture(t); approveAll(runtime);
  const mutation = request(runtime, taskPath, 'complete');
  const before = readFileSync(join(root, taskPath), 'utf8');
  interrupt(root, mutation, 'before');
  writeFileSync(join(root, taskPath), before + '\nExternal edit after interruption.\n');
  const restarted = new VaultRuntime(root);
  assert.equal(restarted.receipt(mutation.id)!.status, 'failed');
  assert.equal(restarted.execute(mutation).status, 'failed');
  assert.equal(readFileSync(join(root, taskPath), 'utf8'), before + '\nExternal edit after interruption.\n');
});

test('restart resolves interrupted no-clobber create publication with its temporary hard link', t => {
  const { root, runtime } = fixture(t); approveAll(runtime);
  const mutation = create(runtime, 'tasks', 'task', { title: 'Linked once' });
  interrupt(root, mutation, 'linked');
  const restarted = new VaultRuntime(root);
  const result = restarted.receipt(mutation.id)!;
  assert.equal(result.status, 'applied');
  assert.equal(restarted.snapshot().documents.filter(doc => doc.file.title === 'Linked once').length, 1);
  assert.deepEqual(restarted.execute(mutation), result);
});

test('symlink, hardlink and visible-state hazards fail closed without modifying their targets', t => {
  const { root, runtime } = fixture(t); approveAll(runtime);
  assert.throws(() => new VaultRuntime(root, join(root, 'runtime.json')), AppError);
  const original = readFileSync(join(root, taskPath), 'utf8');
  const mutation = request(runtime, taskPath, 'complete');
  linkSync(join(root, taskPath), join(root, '.private-hardlink.md'));
  assert.equal(runtime.execute(mutation).status, 'failed');
  assert.equal(readFileSync(join(root, '.private-hardlink.md'), 'utf8'), original);
  const state = join(root, '.lifeapps/runtime.json');
  const saved = readFileSync(state, 'utf8');
  writeFileSync(join(root, '.authority.json'), saved);
  rmSync(state);
  symlinkSync(join(root, '.authority.json'), state);
  assert.throws(() => new VaultRuntime(root));
  assert.equal(readFileSync(join(root, '.authority.json'), 'utf8'), saved);
});

test('a symlinked storage folder cannot redirect a declared create outside the vault', t => {
  const { root, runtime } = fixture(t); approveAll(runtime);
  const outside = mkdtempSync(join(tmpdir(), 'lifeapps-outside-'));
  t.after(() => rmSync(outside, { recursive: true, force: true }));
  mkdirSync(join(root, 'Inbox'), { recursive: true });
  rmSync(join(root, 'Inbox/Tasks'), { recursive: true });
  symlinkSync(outside, join(root, 'Inbox/Tasks'));
  const result = runtime.execute(create(runtime, 'tasks', 'task', { title: 'Never outside' }));
  assert.equal(result.status, 'failed');
  assert.equal(runtime.snapshot().report.valid, false);
  assert.equal(runtime.snapshot().report.diagnostics.some(item => item.code === 'VAULT_SYMLINK'), true);
});
