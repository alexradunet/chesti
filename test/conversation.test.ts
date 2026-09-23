import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createTurnContext, decideReceipt, runDemoTurn, undoLayout, visibleResources } from '../src/conversation.js';
import { demoComposition } from '../src/composer.js';
import { applyAction, issueResolver } from '../src/issues.js';
import { Store, type ChatTurn } from '../src/store.js';

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
    const path = join(directory, 'state.json');
    const f = setup('triage', new Store(path));
    f.context.inspect('/issues'); f.context.inspect('/issues/ISS-101');
    f.context.act('/issues/ISS-101', 'assign', { owner: 'me' });
    f.context.inspect('/issues/ISS-101');
    f.context.act('/issues/ISS-101', 'close', {});
    f.turn.response = 'One assignment completed.';
    f.store.save();
    const reopened = new Store(path).get(f.visitor.id)!;
    assert.equal(reopened.issues[0]!.owner, 'alex');
    assert.equal(reopened.issues[0]!.status, 'open');
    assert.equal(reopened.workspaces[0]!.conversation.turns[0]!.status, 'stopped');
    assert.equal(reopened.workspaces[0]!.conversation.receipts[1]!.status, 'pending');
    assert.equal(reopened.workspaces[0]!.conversation.turns[0]!.response, 'One assignment completed.');
    const legacy = JSON.parse(readFileSync(path, 'utf8'));
    legacy.version = 1;
    delete legacy.visitors[0].workspaces[0].conversation;
    delete legacy.visitors[0].workspaces[0].revision;
    writeFileSync(path, JSON.stringify(legacy));
    const migrated = new Store(path).get(f.visitor.id)!;
    assert.equal(migrated.workspaces[0]!.revision, 1);
    assert.deepEqual(migrated.workspaces[0]!.conversation.turns, []);
    assert.equal(migrated.issues[0]!.owner, 'alex');
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
