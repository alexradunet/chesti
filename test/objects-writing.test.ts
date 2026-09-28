import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatMarkdown, markdownLink, writingSource } from '../src/objects/writing-commands.js';
import { markdownReferences, markdownText, renderMarkdown } from '../src/objects/markdown.js';
import { WritingFields } from '../src/objects/writing-fields.js';

test('writing icons keep named non-submit actions and native editing before enhancement', async () => {
  const body = '\n# Draft <script> & text\r\n';
  const markup = String(WritingFields({ body, textareaId: 'journal-source' }));
  const commands: string[] = [];
  let icons = 0;
  let source = '';
  await new HTMLRewriter()
    .on('[data-writing-command]', { element(element) {
      assert.equal(element.getAttribute('type'), 'button');
      assert.ok(element.getAttribute('aria-label'));
      assert.equal(element.getAttribute('title'), element.getAttribute('aria-label'));
      commands.push(element.getAttribute('data-writing-command')!);
    } })
    .on('[data-writing-command] svg', { element(element) {
      assert.equal(element.getAttribute('aria-hidden'), 'true');
      assert.equal(element.getAttribute('focusable'), 'false');
      icons++;
    } })
    .on('[data-writing-toolbar], [data-writing-modes], [data-writing-preview]', { element(element) {
      assert.notEqual(element.getAttribute('hidden'), null);
    } })
    .on('[data-writing-edit]', { element(element) {
      assert.equal(element.getAttribute('aria-controls'), 'journal-source');
      assert.equal(element.getAttribute('aria-pressed'), 'true');
    } })
    .on('[data-writing-show-preview]', { element(element) {
      assert.equal(element.getAttribute('aria-controls'), 'journal-source-preview');
      assert.equal(element.getAttribute('aria-pressed'), 'false');
    } })
    .on('textarea[name="body"]', {
      element(element) {
        assert.equal(element.getAttribute('hidden'), null);
        assert.equal(element.getAttribute('disabled'), null);
        assert.equal(element.getAttribute('data-writing-source'), '&quot;\\n# Draft &lt;script&gt; &amp; text\\r\\n&quot;');
      },
      text(chunk) { source += chunk.text; },
    })
    .transform(new Response(markup)).text();
  assert.deepEqual(commands, ['bold', 'italic', 'strike', 'bullet', 'ordered', 'task', 'quote', 'code', 'code-block', 'link', 'undo', 'redo']);
  assert.equal(icons, commands.length);
  assert.equal(source, '\n\n# Draft &lt;script&gt; &amp; text\r\n');
  assert.doesNotMatch(markup, /<script>/);
});

function format(source: string, from: number, to: number, command: string) {
  const edit = formatMarkdown(source, from, to, command)!;
  assert.ok(edit);
  const result = source.slice(0, edit.from) + edit.text + source.slice(edit.to);
  assert.ok(edit.start >= 0 && edit.end >= edit.start && edit.end <= result.length);
  return { source: result, selection: result.slice(edit.start, edit.end) };
}

test('inline formatting edits only selected source and leaves boundary whitespace outside emphasis', () => {
  const source = '[unused]: /untouched\n\nBefore hello after\n';
  const from = source.indexOf('hello');
  for (const [command, marker] of [['bold', '**'], ['italic', '*'], ['strike', '~~']]) {
    const result = format(source, from - 1, from + 6, command!);
    assert.equal(result.source, source.replace('hello', `${marker}hello${marker}`));
    assert.equal(result.selection, 'hello');
    assert.equal(markdownText(result.source), 'Before hello after');
  }
  assert.deepEqual(format('Before ', 7, 7, 'bold'), { source: 'Before **bold text**', selection: 'bold text' });
  assert.equal(formatMarkdown('unchanged', 0, 9, 'unknown'), undefined);
});

test('line formatting includes partial lines but excludes the next line at a selection boundary', () => {
  const source = 'Before\nfirst\nsecond\nAfter\n';
  const result = format(source, 8, source.indexOf('After'), 'ordered');
  assert.equal(result.source, 'Before\n1. first\n2. second\nAfter\n');
  assert.equal(result.selection, '1. first\n2. second');
  assert.equal(format('### Title\nkeep', 5, 5, 'heading-1').source, '# Title\nkeep');
  assert.equal(format('# Title\nkeep', 0, 0, 'paragraph').source, 'Title\nkeep');
  assert.equal(format('\nkeep', 0, 0, 'heading-2').source, '## \nkeep');
  assert.equal(format('a\n', 2, 2, 'bullet').source, 'a\n- ');
  assert.equal(format('1. a\n- [x] b', 0, 12, 'task').source, '- [ ] a\n- [ ] b');
  assert.equal(format('a\nb', 0, 3, 'quote').source, '> a\n> b');
});

test('inline and fenced code commands contain existing backticks without dropping selected content', () => {
  for (const source of ['a`b', '`code`', ' a ', '   ']) {
    const result = format(source, 0, source.length, 'code');
    assert.equal(result.selection, source);
    assert.ok(renderMarkdown(result.source).includes('<code>'));
  }
  assert.equal(format('a`b', 0, 3, 'code').source, '``a`b``');
  assert.equal(format('`code`', 0, 6, 'code').source, '`` `code` ``');
  const source = 'before selected ``` fence after';
  const result = format(source, 7, 25, 'code-block');
  assert.equal(result.selection, source.slice(7, 25));
  assert.equal(result.source, 'before \n````\nselected ``` fence\n````\n after');
  // Many short runs must not overflow the JavaScript argument stack.
  const large = '` '.repeat(100_000);
  assert.equal(format(large, 0, large.length, 'code').selection, large);
});

test('inserted links escape Markdown labels and keep safe destinations including parentheses and encoded spaces', () => {
  const target = '/objects/12345678-1234-4234-8234-123456789abc';
  const label = '*not emphasis* [label] & <tag>\nnext';
  const source = markdownLink(label, target);
  assert.deepEqual(markdownReferences(source), [target.slice('/objects/'.length)]);
  assert.equal(markdownText(source), label.replace('\n', ' '));
  const html = renderMarkdown(markdownLink('website', 'https://example.com/a(b)%20with%20space'));
  assert.match(html, /<a href="https:\/\/example.com\/a\(b\)%20with%20space"/);
  for (const href of ['javascript:alert(1)', 'data:text/html,test', '//evil.example', 'https://example.com/raw space', '']) {
    assert.throws(() => markdownLink('bad', href), /Use an http/);
  }
});

test('source-only saves and undo to the initial textarea value retain exact original line endings and definitions', () => {
  const source = '\r\n# Title\r\n\r\n[unused]: <https://example.com>\r\n';
  const normalized = source.replaceAll('\r\n', '\n');
  const textarea = { value: normalized, defaultValue: normalized, dataset: { writingSource: JSON.stringify(source) } };
  assert.equal(writingSource(textarea), source);
  textarea.value += 'New writing';
  assert.equal(writingSource(textarea), normalized + 'New writing');
  textarea.value = normalized;
  assert.equal(writingSource(textarea), source);
});
