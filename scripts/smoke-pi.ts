// Opt-in: calls your configured provider against an isolated, temporary sandbox.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../src/server.js';
import { Store } from '../src/store.js';

const directory = mkdtempSync(join(tmpdir(), 'taskdesk-pi-smoke-'));
const file = join(directory, 'state.json');
let store = new Store(file);
let server = createApp({ store, mode: 'demo' });
async function listen() {
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  return `http://127.0.0.1:${address.port}`;
}
async function close() { await new Promise<void>(resolve => { server.close(() => resolve()); server.closeAllConnections(); }); }
let base = await listen();
try {
  const home = await fetch(base);
  const cookie = home.headers.get('set-cookie')!.split(';')[0]!;
  const csrf = /name="csrf" value="([^"]+)"/.exec(await home.text())![1]!;
  const post = (path: string, values: Record<string, string>) => fetch(base + path, { method: 'POST', headers: { Cookie: cookie, Origin: base }, body: new URLSearchParams({ csrf, ...values }), redirect: 'manual' });
  const response = await post('/workspaces', { task: 'Help me triage unassigned issues', engine: 'demo' });
  const path = response.headers.get('location')!;
  const visitorId = cookie.slice('taskdesk='.length);
  const getWorkspace = () => store.get(visitorId)!.workspaces[0]!;
  const originalPlan = structuredClone(getWorkspace().plan);
  async function turn(message: string) {
    const response = await post(`${path}/messages`, { message, engine: 'pi', requestId: randomUUID(), revision: String(getWorkspace().revision) });
    assert.equal(response.status, 303, await response.text());
    const last = getWorkspace().conversation.turns.at(-1)!;
    console.log(JSON.stringify({ request: message, status: last.status, response: last.response, notice: last.notice }, null, 2));
    assert.equal(last.status, 'done');
  }
  await turn('Assign both issues to me. Keep the current layout.');
  const receipts = getWorkspace().conversation.receipts;
  assert.equal(receipts.length, 2);
  assert.ok(receipts.every(r => r.action === 'assign' && r.status === 'applied' && r.fields.owner === 'alex'));
  assert.deepEqual(receipts.map(r => r.resource).sort(), ['/issues/ISS-101', '/issues/ISS-105']);
  assert.deepEqual(getWorkspace().plan, originalPlan);
  assert.ok(getWorkspace().conversation.entries.length > 0);
  const issuesAfter = structuredClone(store.get(visitorId)!.issues);
  // A new HTTP server AND a new store/session restore; no live agent is reused.
  await close();
  store = new Store(file);
  server = createApp({ store, mode: 'demo' });
  base = await listen();
  await turn('Which two issues did you just assign, and to whom? Do not change the layout or data.');
  assert.match(getWorkspace().conversation.turns.at(-1)!.response, /ISS-101/);
  assert.match(getWorkspace().conversation.turns.at(-1)!.response, /ISS-105/);
  assert.deepEqual(getWorkspace().plan, originalPlan);
  await turn('Show my unfinished work as a list, with details for ISS-101. Do not change any issue data.');
  assert.ok(getWorkspace().revision > 1);
  assert.ok(getWorkspace().plan.blocks.some(b => b.resource === '/issues?scope=mine' && b.view === 'list'));
  assert.deepEqual(store.get(visitorId)!.issues, issuesAfter);
  assert.equal(getWorkspace().conversation.receipts.length, 2);
  console.log('PASS: real Pi assignments, restart/context restoration, conversation-only reply, and layout composition.');
} finally {
  await close();
  rmSync(directory, { recursive: true, force: true });
}
