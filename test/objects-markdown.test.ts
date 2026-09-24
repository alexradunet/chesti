import { test } from 'node:test';
import assert from 'node:assert/strict';
import { markdownReferences, markdownText, renderMarkdown, validateMarkdown } from '../src/objects/markdown.js';

const target = 'eb227f83-14b4-4e77-a3f2-bda7bc4e5d84';
const ignored = '97dbba21-0d4e-46f2-b672-f5af81997ac0';

test('Markdown source is preserved exactly and bounded by UTF-8 bytes', () => {
  const source = '\r\n# Writing\r\n\r\n**Source** with  trailing spaces  \r\n[ref][target]\r\n\r\n[target]: https://example.com\r\n';
  assert.equal(validateMarkdown(source), source);
  assert.equal(validateMarkdown('é'.repeat(131_072)).length, 131_072);
  assert.throws(() => validateMarkdown('é'.repeat(131_072) + 'a'));
  assert.throws(() => validateMarkdown({ type: 'doc', content: [] }));
});

test('backlinks come from real Markdown links, not code, images, escaped syntax or HTML', () => {
  const source = [
    `[Person](/objects/${target}) and [again][person]`,
    `[person]: /objects/${target.toUpperCase()}`,
    `\`[code](/objects/${ignored})\``,
    '```md', `[fenced](/objects/${ignored})`, '```',
    `![image](/objects/${ignored})`,
    `\\[escaped](/objects/${ignored})`,
    `<a href="/objects/${ignored}">HTML</a>`,
    `[external](https://example.com/objects/${ignored})`,
  ].join('\n\n');
  assert.deepEqual(markdownReferences(source), [target]);
  assert.deepEqual(markdownReferences('    [indented](/objects/' + ignored + ')'), []);
});

test('reading Markdown preserves formatting without executable HTML, unsafe links or remote images', () => {
  const source = [
    '# Reading', 'A **bold** word and *emphasis*.', 'First  \nsecond',
    '[allowed](https://example.com/?a=1&b=2)', '[email](mailto:person@example.com)',
    `[object](/objects/${target})`, '[script](javascript:alert%281%29)',
    '[entity](java&#x73;cript:alert%281%29)', '[data](data:text/html,test)',
    '<script>alert(1)</script>', '<img src=x onerror=alert(1)>',
    '![<script>alert(2)</script>](https://example.com/image.png)',
    '```html\n<img src=x onerror=alert(3)>\n```',
    '| A | B |\n| - | - |\n| 1 | 2 |', '- [x] Finished',
  ].join('\n\n');
  const tags: string[] = [];
  const links: string[] = [];
  const output = renderMarkdown(source);
  new HTMLRewriter().on('*', { element(element) {
    tags.push(element.tagName);
    for (const [name] of element.attributes) assert.equal(/^on/i.test(name), false);
    if (element.tagName === 'a') {
      links.push(element.getAttribute('href')!);
      assert.equal(element.getAttribute('rel'), 'noreferrer');
    }
    if (element.tagName === 'input') assert.equal(element.hasAttribute('disabled'), true);
  } }).transform(output);
  for (const tag of ['h1', 'strong', 'em', 'br', 'pre', 'code', 'table']) assert.ok(tags.includes(tag), tag);
  for (const tag of ['script', 'img', 'iframe', 'svg']) assert.equal(tags.includes(tag), false, tag);
  assert.equal(links.length, 3);
  assert.ok(links.includes(`/objects/${target}`));
});

test('search text includes readable Markdown content without formatting delimiters', () => {
  const source = '# Heading\n\nA **bold** word &amp; a [person](https://example.com).\n\n```txt\ncode example\n```';
  const text = markdownText(source);
  assert.ok(text.includes('Heading'));
  assert.ok(text.includes('A bold word & a person.'));
  assert.ok(text.includes('code example'));
  assert.equal(text.includes('**'), false);
  assert.equal(text.includes('https://example.com'), false);
});
