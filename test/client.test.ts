// DOM behavior tests, NOT screenshot/layout/browser verification.
import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { createApp } from '../src/server.js';
import { Store } from '../src/store.js';
import type { ChatRunner } from '../src/conversation.js';

async function waitFor(check: () => boolean, message: string) {
  const end = Date.now() + 5000;
  while (!check()) {
    if (Date.now() > end) throw new Error(`Timed out: ${message}`);
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}
async function setup(t: TestContext, chatRunner?: ChatRunner) {
  const server = createApp({ store: new Store(), mode: 'demo', chatRunner });
  const origin = server.url.origin;
  const home = await fetch(`${origin}/issues/new`);
  const cookie = home.headers.get('set-cookie')!.split(';')[0]!;
  const csrf = /name="csrf" value="([^"]+)"/.exec(await home.text())![1]!;
  const create = await fetch(origin + '/workspaces', { method: 'POST', headers: { Cookie: cookie }, body: new URLSearchParams({ csrf, task: 'triage', engine: 'demo' }), redirect: 'manual' });
  const path = create.headers.get('location')!;
  const page = await fetch(origin + path, { headers: { Cookie: cookie } });
  const dom = new JSDOM(await page.text(), { url: origin + path, runScripts: 'outside-only' });
  t.after(async () => { dom.window.close(); await server.stop(true); });
  const { window } = dom;
  const errors: string[] = [];
  window.addEventListener('error', event => errors.push(event.message));
  window.TextDecoder = TextDecoder;
  window.URLSearchParams = URLSearchParams;
  window.fetch = (input, init) => fetch(new URL(String(input), window.location.href), { ...init, headers: { ...Object.fromEntries(new Headers(init?.headers)), Cookie: cookie, Origin: origin } });
  window.confirm = () => true;
  window.eval(readFileSync(new URL('../public/workspace.js', import.meta.url), 'utf8'));
  const query = <T extends Element = HTMLElement>(selector: string) => window.document.querySelector<T>(selector)!;
  const send = (text: string) => {
    query<HTMLTextAreaElement>('#message').value = text;
    query<HTMLFormElement>('#chat-send').requestSubmit(query<HTMLButtonElement>('#chat-send button'));
  };
  const ready = () => query('#conversation').getAttribute('data-busy') === 'false';
  return { window, query, send, ready, errors, path };
}

test('client streams a turn, renders receipts, refreshes data and re-enables input', async t => {
  const f = await setup(t);
  f.send('Assign both issues to me');
  await waitFor(() => f.ready() && f.query('#transcript').textContent!.includes('owner: alex'), 'completed conversation');
  assert.match(f.query('#canvas').textContent!, /Nothing in this queue/);
  assert.equal(f.query<HTMLTextAreaElement>('#message').disabled, false);
  assert.equal(f.query('#pending-update').hidden, true);
  assert.deepEqual(f.errors, []);
});

test('unfinished form survives a layout change until explicit discard-and-refresh', async t => {
  const f = await setup(t);
  const owner = f.query<HTMLSelectElement>('#canvas select[name="owner"]');
  owner.value = 'sam'; owner.dispatchEvent(new f.window.Event('input', { bubbles: true }));
  f.send('show my work');
  await waitFor(() => !f.query('#pending-update').hidden, 'deferred layout');
  assert.equal(f.query<HTMLSelectElement>('#canvas select[name="owner"]').value, 'sam');
  assert.match(f.query('#canvas').textContent!, /Triage queue/);
  assert.equal(f.query<HTMLButtonElement>('#chat-send button').disabled, true);
  f.query<HTMLButtonElement>('#apply-update').click();
  await waitFor(() => f.query('#pending-update').hidden && f.query('#canvas').textContent!.includes('Your next work'), 'accepted layout');
  assert.equal(f.query<HTMLButtonElement>('#chat-send button').disabled, false);
  assert.deepEqual(f.errors, []);
});

test('native action buttons work through enhancement and preserve an unsent chat draft', async t => {
  const f = await setup(t);
  const message = f.query<HTMLTextAreaElement>('#message');
  message.value = 'What should I do next?'; message.dispatchEvent(new f.window.Event('input', { bubbles: true }));
  const select = f.query<HTMLSelectElement>('#canvas select[name="owner"]');
  select.value = 'alex'; select.dispatchEvent(new f.window.Event('input', { bubbles: true }));
  const form = select.form!;
  form.requestSubmit([...form.elements].find(element => element.tagName === 'BUTTON') as HTMLButtonElement);
  await waitFor(() => f.query('#transcript').textContent!.includes('owner: alex'), 'form receipt');
  assert.equal(f.query<HTMLTextAreaElement>('#message').value, 'What should I do next?');
  assert.match(f.query('#canvas').textContent!, /Alex \(you\)/);
  assert.deepEqual(f.errors, []);
});

test('following an issue link keeps the conversation and live stream intact', async t => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const f = await setup(t, async c => {
    c.text('Working.');
    await Promise.race([gate, new Promise<void>(resolve => c.signal.addEventListener('abort', () => resolve(), { once: true }))]);
    c.text(' Still here.');
  });
  f.send('Explain this queue');
  await waitFor(() => f.query('#live-response p').textContent!.includes('Working.'), 'live response');
  const originalConversation = f.query('#conversation');
  f.query<HTMLAnchorElement>('a[href^="/issues/ISS-101?workspace="]').click();
  await waitFor(() => f.window.location.pathname === '/issues/ISS-101', 'in-workspace navigation');
  assert.equal(f.query('#conversation'), originalConversation);
  assert.match(f.query('#live-response p').textContent!, /Working/);
  release();
  await waitFor(() => f.ready() && f.query('#transcript').textContent!.includes('Still here.'), 'stream completed after navigation');
  assert.equal(f.query('#canvas').getAttribute('data-focus'), '/issues/ISS-101');
  assert.deepEqual(f.errors, []);
});

test('streamed model text is text, not executable markup', async t => {
  const f = await setup(t, async c => { c.text('<img src=x onerror="window.pwned=true">'); });
  f.send('Hello');
  await waitFor(() => f.ready() && f.query('#transcript').textContent!.includes('window.pwned'), 'escaped model text');
  assert.equal(f.window.document.querySelector('#transcript img'), null);
  assert.equal(f.window.document.querySelectorAll('script').length, 1);
  assert.deepEqual(f.errors, []);
});
