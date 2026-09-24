import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createExplorer, validatePlan, escapeHtml } from '../src/core.js';
import { seedIssues, issueResolver, applyAction } from '../src/issues.js';
import { demoComposition } from '../src/composer.js';
import { Store } from '../src/store.js';
import { openDatabase } from '../src/database.js';
import { renderPlan } from '../src/render.js';

function fixture() {
  const issues = seedIssues();
  const resolve = issueResolver(issues);
  return { issues, resolve, explorer: createExplorer(resolve) };
}

test('discovery starts at one entry point and follows advertised links', () => {
  const { explorer } = fixture();
  assert.throws(() => explorer.inspect('/issues/ISS-101'), /discovered/);
  const root = explorer.inspect('/issues');
  assert.ok(root.links.some(l => l.rel === 'triage'));
  assert.equal(explorer.inspect('/issues?scope=triage').items?.length, 2);
  assert.equal(explorer.inspect('/issues/ISS-101').kind, 'record');
  assert.throws(() => explorer.inspect('https://evil.example'), /discovered/);
  assert.throws(() => explorer.inspect('/etc/passwd'), /discovered/);
  assert.throws(() => explorer.inspect('/issues/ISS-101/close'), /discovered/);
});

test('present requires explicit inspection, not just discovery', () => {
  const { explorer } = fixture();
  explorer.inspect('/issues');
  const plan = { title: 'Focus', layout: 'stack', blocks: [{ resource: '/issues/ISS-101', view: 'detail' }] };
  assert.throws(() => explorer.present(plan), /Inspect/);
  explorer.inspect('/issues/ISS-101');
  assert.deepEqual(explorer.present(plan), plan);
});

test('view validation rejects invented behavior, unknown views, duplicates and invalid shapes', () => {
  const { resolve } = fixture();
  const inspected = new Set(['/issues', '/issues/ISS-101']);
  const valid = { title: 'Desk', layout: 'split', blocks: [{ resource: '/issues', view: 'table' }] };
  assert.deepEqual(validatePlan(valid, resolve, inspected), valid);
  for (const invalid of [
    { ...valid, script: 'alert(1)' },
    { ...valid, blocks: [{ resource: '/issues', view: 'table', onclick: 'steal()' }] },
    { ...valid, blocks: [{ resource: '/issues', view: 'iframe' }] },
    { ...valid, blocks: [{ resource: '/issues', view: 'actions' }] },
    { ...valid, blocks: [{ resource: '/issues/ISS-101', view: 'table' }] },
    { ...valid, blocks: [...valid.blocks, ...valid.blocks] },
    { ...valid, blocks: [] },
    { ...valid, blocks: Array(6).fill(valid.blocks[0]) },
    { ...valid, title: 'x'.repeat(81) },
    { ...valid, layout: 'javascript:evil' },
  ]) assert.throws(() => validatePlan(invalid, resolve, inspected));
});

test('state owns action availability; stale and forged submissions do not mutate', () => {
  const { issues, resolve } = fixture();
  assert.ok(resolve('/issues/ISS-101').actions.some(a => a.id === 'close'));
  applyAction(issues, 'ISS-101', 'close', new URLSearchParams({ version: '1' }));
  assert.deepEqual(resolve('/issues/ISS-101').actions.map(a => a.id), ['reopen']);
  assert.throws(() => applyAction(issues, 'ISS-101', 'reopen', new URLSearchParams({ version: '1' })), /changed/);
  assert.throws(() => applyAction(issues, 'ISS-101', 'assign', new URLSearchParams({ version: '2', owner: 'alex' })), /no longer available/);
  applyAction(issues, 'ISS-101', 'reopen', new URLSearchParams({ version: '2' }));
  assert.equal(issues[0]!.status, 'open');
  assert.equal(issues[0]!.version, 3);
  assert.throws(() => applyAction(issues, 'ISS-101', 'assign', new URLSearchParams({ version: '3', owner: 'attacker' })), /valid assignee/);
  assert.throws(() => applyAction(issues, 'ISS-101', 'close', new URLSearchParams({ version: '3', title: 'Overwrite' })), /Unexpected/);
  assert.throws(() => applyAction(issues, 'ISS-101', 'close', new URLSearchParams('version=3&version=3')), /repeated/);
  assert.equal(issues[0]!.version, 3);
});

test('triage and next-work tasks actually compose different views', () => {
  const { resolve } = fixture();
  const triage = demoComposition('Help me triage unassigned issues', resolve);
  const next = demoComposition('What should I work on next?', resolve);
  assert.equal(triage.engine, 'demo');
  assert.equal(triage.plan.layout, 'split');
  assert.equal(triage.plan.blocks[0]!.resource, '/issues?scope=triage');
  assert.equal(next.plan.layout, 'stack');
  assert.equal(next.plan.blocks[0]!.view, 'list');
  assert.equal(next.plan.blocks[0]!.resource, '/issues?scope=mine');
  assert.equal(demoComposition('Task', resolve, true).engine, 'fallback');
});

test('saved composition resolves fresh facts and forms, without changing its plan', () => {
  const store = new Store();
  const visitor = store.create();
  const resolve = issueResolver(visitor.issues);
  const composition = demoComposition('triage', resolve);
  const beforePlan = JSON.stringify(composition.plan);
  const before = renderPlan(composition.plan, resolve, visitor);
  assert.match(before, /\/ISS-101\/close/);
  applyAction(visitor.issues, 'ISS-101', 'close', new URLSearchParams({ version: '1' }));
  const after = renderPlan(composition.plan, resolve, visitor);
  assert.doesNotMatch(after, /\/ISS-101\/close/);
  assert.match(after, /\/ISS-101\/reopen/);
  assert.equal(JSON.stringify(composition.plan), beforePlan);
});

test('empty collections still render a useful deterministic workspace', () => {
  const store = new Store();
  const visitor = store.create();
  for (const issue of visitor.issues) issue.status = 'closed';
  const resolve = issueResolver(visitor.issues);
  const composition = demoComposition('triage', resolve);
  assert.equal(composition.plan.blocks.length, 1);
  assert.match(renderPlan(composition.plan, resolve, visitor), /Nothing in this queue/);
});

test('authoritative and model text is escaped, not executable markup', () => {
  assert.equal(escapeHtml('<img src=x onerror="oops">'), '&lt;img src=x onerror=&quot;oops&quot;&gt;');
  const store = new Store();
  const visitor = store.create();
  visitor.issues[0]!.title = '<script>alert(1)</script>';
  const resolve = issueResolver(visitor.issues);
  const html = renderPlan(demoComposition('triage', resolve).plan, resolve, visitor);
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;script&gt;/);
});

test('browser sandboxes and accepted view plans survive a store restart', () => {
  const directory = mkdtempSync(join(tmpdir(), 'taskdesk-'));
  try {
    const path = join(directory, 'taskdesk.sqlite');
    const store = new Store(openDatabase(path));
    const first = store.create();
    const second = store.create();
    const workspace = store.workspace(first, 'triage', demoComposition('triage', issueResolver(first.issues)));
    applyAction(first.issues, 'ISS-101', 'close', new URLSearchParams({ version: '1' }));
    store.save();
    store.db.close();
    const reloaded = new Store(openDatabase(path));
    assert.equal(reloaded.get(first.id)!.issues[0]!.status, 'closed');
    assert.equal(reloaded.get(second.id)!.issues[0]!.status, 'open');
    assert.deepEqual(reloaded.get(first.id)!.workspaces[0], workspace);
    reloaded.db.close();
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
