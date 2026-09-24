import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createTurnContext, decideReceipt, executeReceipt, runDemoTurn, undoLayout, visibleResources } from '../src/conversation.js';
import { demoComposition } from '../src/composer.js';
import { applyAction, issueResolver } from '../src/issues.js';
import { Store, type ChatTurn, type Receipt } from '../src/store.js';
import { openDatabase } from '../src/database.js';
import { VaultRuntime } from '../src/vault/runtime.js';
import { fileURLToPath } from 'node:url';

function setup(task = 'triage', store = new Store()) {
  const visitor = store.create();
  const workspace = store.workspace(visitor, task, demoComposition(task, issueResolver(visitor.issues)));
  const controller = new AbortController();
  const turn: ChatTurn = { id: randomUUID(), message: 'Assign both issues to me', engine: 'demo', focus: '', visible: visibleResources(workspace, visitor).map(r => r.href), selected: [], response: '', status: 'running', created: new Date().toISOString() };
  workspace.conversation.turns.push(turn);
  const context = createTurnContext(store, visitor, workspace, turn, controller.signal, () => {});
  return { store, visitor, workspace, turn, controller, context };
}

test('both resolves to the two visible issues; assignments do not change the layout', async () => {
  const f = setup();
  const before = structuredClone(f.workspace.plan);
  await runDemoTurn(f.context);
  assert.equal(f.visitor.issues.find(i => i.id === 'ISS-101')!.owner, 'alex');
  assert.equal(f.visitor.issues.find(i => i.id === 'ISS-105')!.owner, 'alex');
  assert.deepEqual(f.workspace.plan, before);
  assert.equal(f.workspace.revision, 1);
  assert.equal(f.workspace.conversation.receipts.length, 2);
  assert.ok(f.workspace.conversation.receipts.every(r => r.status === 'applied'));
});

test('ambiguous both asks instead of changing six issues; explicit selection wins', async () => {
  const f = setup('all');
  await runDemoTurn(f.context);
  assert.match(f.turn.response, /Which issues/);
  assert.equal(f.workspace.conversation.receipts.length, 0);
  f.turn.selected = ['/issues/ISS-101', '/issues/ISS-105'];
  f.turn.response = '';
  await runDemoTurn(f.context);
  assert.equal(f.workspace.conversation.receipts.length, 2);
});

test('act requires fresh explicit discovery, validates fields and cannot inject authority', () => {
  const { context, visitor, workspace } = setup();
  assert.throws(() => context.act('/issues/ISS-101', 'assign', { owner: 'me' }), /inspect/);
  context.inspect('/issues');
  assert.throws(() => context.act('/issues/ISS-101', 'assign', { owner: 'me' }), /inspect/);
  context.inspect('/issues/ISS-101');
  for (const fields of [{ owner: 'root' }, { owner: 'alex', version: '900' }, { owner: 'alex', csrf: 'x' }, { owner: 'alex', workspace: 'foreign' }, { owner: 'alex', confirmed: 'true' }] as Record<string, string>[]) {
    assert.throws(() => context.act('/issues/ISS-101', 'assign', fields));
  }
  assert.throws(() => context.act('/issues/ISS-101', 'delete', {}), /not advertised/);
  assert.throws(() => context.inspect('https://evil.example'), /discovered/);
  assert.equal(visitor.issues[0]!.version, 1);
  assert.equal(workspace.conversation.receipts.length, 0);
});

test('visible records are inspectable directly but do not bypass fresh-read or discovery checks', () => {
  const { context, visitor } = setup();
  assert.throws(() => context.act('/issues/ISS-101', 'assign', { owner: 'me' }), /inspect/);
  assert.throws(() => context.inspect('/issues/ISS-102'), /discovered/);
  const record = context.inspect('/issues/ISS-101');
  assert.equal(context.act(record.href, 'assign', { owner: 'me' }).status, 'applied');
  assert.equal(visitor.issues.find(issue => issue.id === 'ISS-101')!.owner, 'alex');
});

test('retries replay the same server-generated receipt, including after re-inspection', () => {
  const f = setup();
  f.context.inspect('/issues');
  f.context.inspect('/issues/ISS-101');
  const first = f.context.act('/issues/ISS-101', 'assign', { owner: 'me' });
  f.context.inspect('/issues/ISS-101');
  const second = f.context.act('/issues/ISS-101', 'assign', { owner: 'alex' });
  assert.deepEqual(first, second);
  assert.equal(f.visitor.issues[0]!.version, 2);
  assert.equal(f.workspace.conversation.receipts.length, 1);
});

test('stale action fails while another succeeds: receipts expose partial success', () => {
  const f = setup();
  f.context.inspect('/issues');
  f.context.inspect('/issues/ISS-101');
  f.context.inspect('/issues/ISS-105');
  applyAction(f.visitor.issues, 'ISS-101', 'assign', new URLSearchParams({ version: '1', owner: 'sam' }));
  const failed = f.context.act('/issues/ISS-101', 'assign', { owner: 'me' });
  const applied = f.context.act('/issues/ISS-105', 'assign', { owner: 'me' });
  assert.equal(failed.status, 'failed');
  assert.equal(applied.status, 'applied');
  assert.equal(f.visitor.issues[0]!.owner, 'sam');
  f.context.inspect('/issues/ISS-101');
  assert.equal(f.context.act('/issues/ISS-101', 'assign', { owner: 'me' }).status, 'failed');
  assert.equal(f.visitor.issues[0]!.owner, 'sam');
});

test('closing creates confirmation; only bound user confirmation executes, once', () => {
  const f = setup();
  f.context.inspect('/issues');
  f.context.inspect('/issues/ISS-101');
  const receipt = f.context.act('/issues/ISS-101', 'close', {});
  assert.equal(receipt.status, 'pending');
  assert.equal(f.visitor.issues[0]!.status, 'open');
  assert.throws(() => f.context.act('/issues/ISS-101', 'close', { confirmed: 'true' }), /Unexpected/);
  assert.throws(() => decideReceipt(f.store, f.visitor, f.workspace, randomUUID(), 'confirm'), /not found/);
  assert.equal(decideReceipt(f.store, f.visitor, f.workspace, receipt.id, 'confirm').status, 'applied');
  decideReceipt(f.store, f.visitor, f.workspace, receipt.id, 'confirm');
  assert.equal(f.visitor.issues[0]!.version, 2);
  assert.equal(f.visitor.issues[0]!.status, 'closed');
});

test('stale and cancelled confirmations cannot apply later', () => {
  const f = setup();
  f.context.inspect('/issues');
  f.context.inspect('/issues/ISS-101');
  f.context.inspect('/issues/ISS-105');
  const stale = f.context.act('/issues/ISS-101', 'close', {});
  const cancelled = f.context.act('/issues/ISS-105', 'close', {});
  applyAction(f.visitor.issues, 'ISS-101', 'start', new URLSearchParams({ version: '1' }));
  assert.equal(decideReceipt(f.store, f.visitor, f.workspace, stale.id, 'confirm').status, 'failed');
  decideReceipt(f.store, f.visitor, f.workspace, cancelled.id, 'cancel');
  assert.equal(decideReceipt(f.store, f.visitor, f.workspace, cancelled.id, 'confirm').status, 'cancelled');
  assert.equal(f.visitor.issues.find(i => i.id === 'ISS-105')!.status, 'open');
});

test('stop prevents later tools without rolling back earlier actions', () => {
  const f = setup();
  f.context.inspect('/issues');
  f.context.inspect('/issues/ISS-101');
  f.context.inspect('/issues/ISS-105');
  f.context.act('/issues/ISS-101', 'assign', { owner: 'me' });
  f.controller.abort();
  assert.throws(() => f.context.act('/issues/ISS-105', 'assign', { owner: 'me' }));
  assert.throws(() => f.context.present(f.workspace.plan));
  assert.equal(f.visitor.issues[0]!.owner, 'alex');
  assert.equal(f.visitor.issues.find(i => i.id === 'ISS-105')!.owner, 'unassigned');
});

test('present is optional, validated and undo restores only layout, not mutations', () => {
  const f = setup();
  const original = structuredClone(f.workspace.plan);
  f.context.inspect('/issues');
  f.context.inspect('/issues/ISS-101');
  f.context.act('/issues/ISS-101', 'assign', { owner: 'me' });
  f.context.present({ title: 'All issues', layout: 'stack', blocks: [{ resource: '/issues', view: 'table' }] });
  assert.equal(f.workspace.revision, 2);
  assert.throws(() => f.context.present(original), /Only one/);
  undoLayout(f.store, f.workspace);
  assert.deepEqual(f.workspace.plan, original);
  assert.equal(f.workspace.revision, 3);
  assert.equal(f.visitor.issues[0]!.owner, 'alex');
  assert.throws(() => undoLayout(f.store, f.workspace), /no previous/);
});

test('save failure rolls back action and receipt in memory', () => {
  const f = setup();
  f.context.inspect('/issues');
  f.context.inspect('/issues/ISS-101');
  f.store.save = () => { throw new Error('Disk full'); };
  assert.throws(() => f.context.act('/issues/ISS-101', 'assign', { owner: 'me' }), /Disk full/);
  assert.equal(f.visitor.issues[0]!.owner, 'unassigned');
  assert.equal(f.visitor.issues[0]!.version, 1);
  assert.equal(f.workspace.conversation.receipts.length, 0);
});

test('conversation, receipts and pending confirmations survive restart; in-flight work is never rerun', () => {
  const directory = mkdtempSync(join(tmpdir(), 'taskdesk-chat-'));
  try {
    const path = join(directory, 'taskdesk.sqlite');
    const f = setup('triage', new Store(openDatabase(path)));
    f.context.inspect('/issues'); f.context.inspect('/issues/ISS-101');
    f.context.act('/issues/ISS-101', 'assign', { owner: 'me' });
    f.context.inspect('/issues/ISS-101');
    f.context.act('/issues/ISS-101', 'close', {});
    f.turn.response = 'One assignment completed.';
    f.store.save();
    f.store.db.close();
    const reopenedStore = new Store(openDatabase(path));
    const reopened = reopenedStore.get(f.visitor.id)!;
    assert.equal(reopened.issues[0]!.owner, 'alex');
    assert.equal(reopened.issues[0]!.status, 'open');
    assert.equal(reopened.workspaces[0]!.conversation.turns[0]!.status, 'stopped');
    assert.equal(reopened.workspaces[0]!.conversation.receipts[1]!.status, 'pending');
    assert.equal(reopened.workspaces[0]!.conversation.turns[0]!.response, 'One assignment completed.');
    reopenedStore.db.close();
    const legacyVisitor = structuredClone(f.visitor);
    const legacyWorkspace = legacyVisitor.workspaces[0]! as Partial<typeof f.workspace>;
    delete legacyWorkspace.conversation;
    delete legacyWorkspace.revision;
    const legacyPath = join(directory, 'state.json');
    writeFileSync(legacyPath, JSON.stringify({ version: 1, visitors: [legacyVisitor] }));
    const importedStore = new Store();
    importedStore.importLegacy(legacyPath);
    const migrated = importedStore.get(f.visitor.id)!;
    assert.equal(migrated.workspaces[0]!.revision, 1);
    assert.deepEqual(migrated.workspaces[0]!.conversation.turns, []);
    assert.equal(migrated.issues[0]!.owner, 'alex');
    importedStore.db.close();
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('a conversation save failure rolls back the app record and both receipts together', () => {
  const store = new Store();
  try {
    const runtime = store.vault = new VaultRuntime(store.db, { importRoot: fileURLToPath(new URL('../examples/life-vault', import.meta.url)) });
    runtime.approve(runtime.reviews().map(app => ({ app: app.id, revision: app.revision, permissions: app.permissions })));
    const visitor = store.create();
    const workspace = store.workspace(visitor, 'triage', demoComposition('triage', issueResolver(visitor.issues)));
    const app = runtime.reviews().find(app => app.id === 'tasks')!;
    const definition = runtime.snapshot().apps.find(app => app.definition?.id === 'tasks')!.definition!;
    const action = Object.entries(definition.types.task!.actions).find(([, action]) => action.operation === 'record.create')![0];
    const id = randomUUID();
    const receipt: Receipt = {
      id, source: 'form', resource: '/vault/types/tasks.task', action, fields: { title: 'Atomic receipt regression' },
      version: app.revision, status: 'pending', message: '', created: new Date().toISOString(),
      vaultRequest: { id, app: 'tasks', type: 'task', action, revision: app.revision, fields: { title: 'Atomic receipt regression' } },
    };
    workspace.conversation.receipts.push(receipt);
    const save = store.save.bind(store);
    store.save = () => { throw new Error('Disk full'); };
    assert.throws(() => executeReceipt(store, visitor, receipt), /Disk full/);
    assert.equal(runtime.receipt(id), undefined);
    assert.equal(runtime.snapshot().documents.some(doc => doc.file.title === 'Atomic receipt regression'), false);
    assert.equal(receipt.status, 'pending');
    assert.equal(receipt.executionStarted, undefined);
    store.save = save;
    executeReceipt(store, visitor, receipt);
    assert.equal(receipt.status, 'applied');
    assert.equal(runtime.receipt(id)?.status, 'applied');
    assert.equal(runtime.snapshot().documents.filter(doc => doc.file.title === 'Atomic receipt regression').length, 1);
    const restored = new Store(store.db).get(visitor.id)!;
    assert.equal(restored.workspaces[0]!.conversation.receipts[0]!.status, 'applied');
  } finally { store.db.close(); }
});
