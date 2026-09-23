import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createApp } from '../src/server.js';
import { Store } from '../src/store.js';
import { VaultRuntime } from '../src/vault/runtime.js';
import { localDate } from '../src/vault/resources.js';
import type { Resource } from '../src/core.js';
import { parseMarkdown } from '../src/vault/markdown.js';
import { JSDOM } from 'jsdom';
import { EventEmitter, once } from 'node:events';

test('Today conversation and forms write real Markdown and survive server restart', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'today-http-'));
  const root = join(directory, 'vault');
  cpSync(new URL('../examples/life-vault', import.meta.url), root, { recursive: true });
  const state = join(directory, 'state.json');
  let runtime = new VaultRuntime(root);
  let store = new Store(state);
  let server = createApp({ store, vault: runtime, mode: 'demo' });
  const listen = async () => {
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address(); assert.ok(address && typeof address !== 'string');
    return `http://127.0.0.1:${address.port}`;
  };
  const close = () => new Promise<void>(resolve => { server.close(() => resolve()); server.closeAllConnections(); });
  t.after(async () => { await close(); rmSync(directory, { recursive: true, force: true }); });
  let origin = await listen();
  const home = await fetch(origin);
  const cookie = home.headers.get('set-cookie')!.split(';')[0]!;
  const visitor = store.get(cookie.slice('taskdesk='.length))!;
  const csrf = visitor.csrf;
  const post = async (path: string, fields: Record<string, string> | URLSearchParams) => {
    const body = new URLSearchParams(fields); body.set('csrf', csrf);
    return fetch(origin + path, { method: 'POST', headers: { Cookie: cookie, Origin: origin }, body, redirect: 'manual' });
  };
  const get = (path: string, json = false) => fetch(origin + path, { headers: { Cookie: cookie, ...(json ? { Accept: 'application/vnd.taskdesk.resource+json' } : {}) }, redirect: 'manual' });
  assert.equal((await get('/today')).status, 303);
  const workspace = visitor.workspaces.find(w => w.kind === 'today')!;
  const send = () => post(`/workspaces/${workspace.id}/messages`, { message: 'Create a task to finish the homepage tomorrow.', engine: 'demo', requestId: randomUUID(), revision: String(workspace.revision) });
  await send();
  assert.equal(runtime.snapshot().documents.length, 0, 'Unapproved vault contents are not exposed');
  for (const review of runtime.reviews()) {
    const fields = new URLSearchParams({ app: review.id, revision: review.revision });
    for (const permission of review.permissions) fields.append('permissions', permission);
    assert.equal((await post('/vault/approve', fields)).status, 303);
  }
  assert.equal((await send()).status, 303);
  const created = runtime.snapshot().documents.find(d => d.file.title === 'finish the homepage')!;
  assert.ok(created, workspace.conversation.turns.at(-1)?.response);
  const path = created.file.path;
  assert.match(readFileSync(join(root, path), 'utf8'), new RegExp(`due: ['"]?${localDate(1)}`));
  const href = `/vault/records/${created.file.frontmatter.id}`;
  const record = async () => await (await get(href, true)).json() as Resource;
  const act = async (resource: Resource, action: string, fields: Record<string, string> = {}) => post('/vault/act', { workspace: workspace.id, resource: resource.href, action, version: String(resource.version), definitionRevision: resource.facts.DefinitionRevision!, ...fields });
  const initial = await record();
  const scheduled = { start: `${localDate(1)}T09:00:00Z`, end: `${localDate(1)}T10:00:00Z`, timeZone: 'UTC' };
  // Exercise the actual enhancement: a named "action" control must not shadow
  // HTMLFormElement.action and send the mutation to the wrong URL.
  const dom = new JSDOM(await (await get(`${href}?workspace=${workspace.id}`)).text(), { url: `${origin}${href}?workspace=${workspace.id}`, runScripts: 'outside-only' });
  const { window } = dom;
  window.TextDecoder = TextDecoder;
  window.URLSearchParams = URLSearchParams;
  window.fetch = (input, init) => fetch(new URL(String(input), window.location.href), { ...init, headers: { ...Object.fromEntries(new Headers(init?.headers)), Cookie: cookie, Origin: origin } });
  window.eval(readFileSync(new URL('../public/workspace.js', import.meta.url), 'utf8'));
  const scheduledInput = window.document.querySelector<HTMLTextAreaElement>('textarea[name="scheduled"]')!;
  scheduledInput.value = JSON.stringify(scheduled);
  scheduledInput.dispatchEvent(new window.Event('input', { bubbles: true }));
  const completion = new EventEmitter();
  const finished = once(completion, 'done');
  const observer = new window.MutationObserver(() => {
    if (window.document.querySelector('#transcript')?.textContent?.includes('Record updated.')) completion.emit('done');
    const status = window.document.querySelector('#chat-status')?.textContent ?? '';
    if (status && !/^(Ready|Saved)/.test(status)) completion.emit('error', new Error(status));
  });
  observer.observe(window.document.querySelector('.workbench')!, { childList: true, subtree: true, characterData: true });
  scheduledInput.form!.requestSubmit(scheduledInput.form!.querySelector<HTMLButtonElement>('button')!);
  try { await finished; } finally { observer.disconnect(); window.close(); }
  assert.deepEqual(parseMarkdown(path, readFileSync(join(root, path), 'utf8')).frontmatter.scheduled, scheduled);
  const calendar = await (await get(`/vault/calendar?date=${localDate(1)}`, true)).json() as Resource;
  assert.ok(calendar.items?.some(item => item.href === href), 'Scheduled task appears on calendar');
  assert.equal((await act(initial, 'complete')).status, 409, 'Stale form cannot overwrite scheduling');
  assert.equal((await act(await record(), 'complete')).status, 303);
  const completed = readFileSync(join(root, path), 'utf8');
  assert.equal(parseMarkdown(path, completed).frontmatter.status, 'done');
  const journalType = await (await get('/vault/types/journal.entry', true)).json() as Resource;
  const body = `# ${localDate()}\n\nFinished the homepage.\n\n[[${path.replace(/\.md$/, '')}|Homepage task]]\n`;
  const existingJournal = runtime.snapshot().documents.find(d => d.file.frontmatter.type === 'journal.entry' && d.file.frontmatter.date === localDate());
  const journalResource = existingJournal ? await (await get(`/vault/records/${existingJournal.file.frontmatter.id}`, true)).json() as Resource : journalType;
  assert.equal((await act(journalResource, existingJournal ? 'edit' : 'create', { title: localDate(), date: localDate(), body })).status, 303);
  const journal = runtime.snapshot().documents.find(d => d.file.frontmatter.type === 'journal.entry' && d.file.frontmatter.date === localDate())!;
  assert.equal(journal.file.body, body);
  const journalBytes = readFileSync(join(root, journal.file.path), 'utf8');
  const workspaceUrl = `/workspaces/${workspace.id}`;
  assert.match(await (await get(workspaceUrl)).text(), /Finished the homepage/);
  await close();
  runtime = new VaultRuntime(root); store = new Store(state);
  server = createApp({ store, vault: runtime, mode: 'demo' }); origin = await listen();
  assert.equal(readFileSync(join(root, path), 'utf8'), completed);
  assert.equal(readFileSync(join(root, journal.file.path), 'utf8'), journalBytes);
  const restored = store.get(visitor.id)!.workspaces.find(w => w.id === workspace.id)!;
  assert.ok(restored.conversation.receipts.filter(r => r.status === 'applied').length >= 4);
  assert.match(await (await get(workspaceUrl)).text(), /Create a task to finish the homepage tomorrow/);
  const para = await (await get('/vault/para', true)).json() as Resource;
  assert.ok(para.items?.some(item => item.title), 'Approved PARA pages are navigable');
});
