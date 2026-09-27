import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Badge, Button, ButtonLink, Dialog, Field, Icon, Input, Panel, Select, Status, Textarea } from '../src/ui/index.js';
import { renderDesignSystem, renderFailure } from '../src/ui/specimen.js';

async function attributes(markup: string, selector: string, names: string[]) {
  const elements: Record<string, string | null>[] = [];
  await new HTMLRewriter().on(selector, {
    element(element) {
      elements.push(Object.fromEntries(names.map(name => [name, element.getAttribute(name)])));
    },
  }).transform(new Response(markup)).text();
  return elements;
}

test('action atoms preserve native intent, accessible names, and form overrides', async () => {
  const markup = String(Button({ children: 'Open search', 'aria-label': 'Find an object', 'data-search': '' }))
    + String(Button({ type: 'submit', variant: 'primary', name: 'reviewedRevision', value: '4', formnovalidate: true, children: 'Save <draft>' }))
    + String(ButtonLink({ href: '/objects/new', children: 'New page' }));
  const buttons = await attributes(markup, 'button', ['type', 'aria-label', 'data-search', 'name', 'value', 'formnovalidate']);
  assert.equal(buttons[0]?.type, 'button');
  assert.equal(buttons[0]?.['aria-label'], 'Find an object');
  assert.equal(buttons[0]?.['data-search'], '');
  assert.equal(buttons[1]?.type, 'submit');
  assert.equal(buttons[1]?.name, 'reviewedRevision');
  assert.equal(buttons[1]?.value, '4');
  assert.notEqual(buttons[1]?.formnovalidate, null);
  assert.equal((await attributes(markup, 'a', ['href']))[0]?.href, '/objects/new');
  assert.match(markup, /Save &lt;draft&gt;/);
  assert.doesNotMatch(markup, /<draft>/);
});

test('field atoms retain labels, validation, selections, and exact escaped source', async () => {
  const markup = String(Field({ for: 'title', label: 'Title', children: Input({ id: 'title', name: 'title', required: true, value: '<draft>', 'aria-describedby': 'help', 'data-journal-date': '' }) }))
    + String(Select({ name: 'refs', multiple: true, size: 4, children: 'Choices' }))
    + String(Textarea({ name: 'body', class: 'markdown-source', children: '\n\n# <source> & text\n' }));
  assert.equal((await attributes(markup, 'label', ['for']))[0]?.for, 'title');
  const input = (await attributes(markup, 'input', ['id', 'name', 'required', 'aria-describedby', 'data-journal-date']))[0]!;
  assert.equal(input.id, 'title');
  assert.equal(input.name, 'title');
  assert.notEqual(input.required, null);
  assert.equal(input['aria-describedby'], 'help');
  assert.equal(input['data-journal-date'], '');
  assert.notEqual((await attributes(markup, 'select', ['multiple']))[0]?.multiple, null);
  assert.match(markup, />\n\n# &lt;source&gt; &amp; text\n<\/textarea>/);
});

test('surfaces and feedback keep native semantics, hooks, and escaped untrusted text', async () => {
  const markup = String(Dialog({ id: 'search', 'aria-labelledby': 'search-heading', 'data-object-search': '', children: 'Search' }))
    + String(Panel({ as: 'aside', 'aria-label': 'Latest saved revision', children: '<script>not trusted</script>' }))
    + String(Status({ error: true, message: '<bad input>', 'data-form-state': '' }))
    + String(Badge({ class: 'custom', 'data-property-count': '', children: '3' }));
  assert.equal((await attributes(markup, 'dialog', ['aria-labelledby']))[0]?.['aria-labelledby'], 'search-heading');
  assert.equal((await attributes(markup, 'aside', ['aria-label']))[0]?.['aria-label'], 'Latest saved revision');
  const status = (await attributes(markup, 'p', ['role', 'aria-live', 'data-form-state']))[0]!;
  assert.equal(status.role, 'alert');
  assert.equal(status['aria-live'], 'assertive');
  assert.equal(status['data-form-state'], '');
  assert.match(markup, /tag-neutral custom/);
  assert.doesNotMatch(markup, /<script>|<bad input>/);
  assert.match(String(Icon({ name: 'search' })), /alt="" aria-hidden="true"/);
});

test('reference and failure pages use the shared native UI without executing content', () => {
  const specimen = renderDesignSystem();
  assert.match(specimen, /href="\/ui.css"/);
  assert.match(specimen, /<dialog[^>]*open/);
  assert.doesNotMatch(specimen, /<script|style="|https:\/\//);
  const failure = renderFailure(422, '<img src=x onerror=alert(1)>');
  assert.match(failure, /&lt;img/);
  assert.doesNotMatch(failure, /<img src=x/);
  assert.match(failure, /Return to Taskdesk/);
});
