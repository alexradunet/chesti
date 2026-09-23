import { fromMarkdown } from 'mdast-util-from-markdown';
import { CST, Parser, stringify } from 'yaml';
import { AppError } from '../core.js';
import type { MarkdownFile } from './markdown.js';

type Token = CST.Token;
type MapToken = CST.BlockMap | CST.FlowCollection;
const fail = (message: string): never => { throw new AppError(422, message); };
const scalar = (source: string): CST.FlowScalar => ({ type: 'scalar', offset: -1, indent: 0, source });
const punctuation = (type: CST.SourceToken['type'], source: string): CST.SourceToken => ({ type, offset: -1, indent: 0, source });

// CST serialization keeps every unmodified token verbatim, including CRLF and comments.
function comments(token: Token | undefined): CST.SourceToken[] {
  if (!token) return [];
  if (token.type === 'comment' || token.type === 'newline' || token.type === 'space') return [token];
  if (token.type === 'block-scalar') return token.props.flatMap(comments);
  if (token.type === 'block-map' || token.type === 'block-seq' || token.type === 'flow-collection') {
    return [...token.items.flatMap(item => [...item.start, ...(item.key ? comments(item.key) : []), ...(item.sep ?? []), ...comments(item.value)].flatMap(comments)), ...('end' in token ? token.end.flatMap(comments) : [])];
  }
  return 'end' in token && Array.isArray(token.end) ? token.end.flatMap(comments) : [];
}
function keyOf(item: CST.CollectionItem): string | undefined {
  const value = CST.resolveAsScalar(item.key)?.value;
  return typeof value === 'string' ? value : undefined;
}
function setValue(token: Token, value: unknown, eol: string, inFlow: boolean): void {
  if (typeof value === 'string' && CST.resolveAsScalar(token)?.value === value) return;
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    if (token.type !== 'block-map' && token.type !== 'flow-collection') fail('Cannot safely edit this structured YAML value.');
    for (const [name, entry] of Object.entries(value)) setEntry(token as MapToken, name, entry, eol);
    return;
  }
  const oldEnd = comments(token);
  if (typeof value === 'string') {
    // Quoting avoids implicit YAML coercion. A changed block scalar keeps its header comment.
    CST.setScalarValue(token, value, { inFlow, type: 'QUOTE_DOUBLE' });
  } else {
    const source = JSON.stringify(value);
    if (source === undefined) fail('Unsupported YAML value.');
    for (const name of Object.keys(token)) delete (token as unknown as Record<string, unknown>)[name];
    Object.assign(token, scalar(source), { end: oldEnd });
  }
}
function setEntry(map: MapToken, name: string, value: unknown, eol: string): void {
  const items = map.items as CST.CollectionItem[];
  const index = items.findIndex(item => keyOf(item) === name);
  if (value === null) {
    if (index < 0) return;
    const item = items[index]!;
    const keep = [...item.start, ...comments(item.key ?? undefined), ...(item.sep ?? []), ...comments(item.value)].flatMap(comments);
    if (map.type === 'block-map') {
      items[index] = { start: keep };
    } else {
      items.splice(index, 1);
      const next = items[index];
      if (next) next.start = [...keep, ...next.start];
      else map.end = [...keep, ...map.end];
      if (index === 0 && items[0]) items[0].start = items[0].start.filter(part => part.type !== 'comma');
    }
    return;
  }
  if (index >= 0) {
    const item = items[index]!;
    if (!item.value) fail('Cannot safely edit an empty YAML value.');
    setValue(item.value!, value, eol, map.type === 'flow-collection');
    return;
  }
  const encoded = JSON.stringify(value);
  if (encoded === undefined) fail('Unsupported YAML value.');
  const flow = map.type === 'flow-collection';
  const prefix: CST.SourceToken[] = flow
    ? (items.some(item => item.key) ? [punctuation('comma', ','), punctuation('space', ' ')] : [])
    : (CST.stringify(map).endsWith('\n') ? [] : [punctuation('newline', eol)]);
  items.push({ start: prefix, key: scalar(name), sep: [punctuation('map-value-ind', ':'), punctuation('space', ' ')], value: { ...scalar(encoded), ...(flow ? {} : { end: [punctuation('newline', eol)] }) } });
}
function titleBody(body: string, title: string, eol: string): string {
  if (!title.trim() || /[\r\n\u0000-\u001f\u007f]/.test(title) || title.length > 500) fail('Title must be nonempty single-line text of at most 500 characters.');
  const escaped = title.replace(/[\\`*_{}\[\]<>()!#&]/g, '\\$&');
  const heading = fromMarkdown(body).children.find(node => node.type === 'heading' && node.depth === 1);
  if (!heading?.position) return `# ${escaped}${eol}${eol}${body}`;
  return body.slice(0, heading.position.start.offset) + `# ${escaped}` + body.slice(heading.position.end.offset);
}

export function updateMarkdown(file: MarkdownFile, fields: Record<string, unknown>): string {
  const eol = file.source.includes('\r\n') ? '\r\n' : '\n';
  const start = /^(?:\uFEFF)?---[ \t]*(?:\r?\n|$)/.exec(file.source)!;
  const yamlEnd = file.source.length - file.body.length;
  const delimiter = /^---[ \t]*\r?$/m.exec(file.source.slice(start[0].length))!;
  const yamlSource = file.source.slice(start[0].length, start[0].length + delimiter.index);
  const tokens = [...new Parser().parse(yamlSource)];
  const document = tokens.find(token => token.type === 'document');
  const map = document?.type === 'document' ? document.value : undefined;
  if (!map || (map.type !== 'block-map' && map.type !== 'flow-collection')) fail('Frontmatter must be an editable YAML mapping.');
  for (const [name, value] of Object.entries(fields)) {
    if (name === 'title' || name === 'body') continue;
    if (JSON.stringify(file.frontmatter[name]) === JSON.stringify(value)) continue;
    setEntry(map as MapToken, name, value, eol);
  }
  let body = Object.hasOwn(fields, 'body') ? String(fields.body) : file.body;
  if (Object.hasOwn(fields, 'title') && (fields.title !== file.title || Object.hasOwn(fields, 'body'))) body = titleBody(body, String(fields.title), eol);
  return start[0] + tokens.map(token => CST.stringify(token)).join('') + file.source.slice(start[0].length + delimiter.index, yamlEnd) + body;
}
export function createMarkdown(data: Record<string, unknown>, fields: Record<string, unknown>): string {
  let body = typeof fields.body === 'string' ? fields.body : '';
  if (Object.hasOwn(fields, 'title')) body = titleBody(body, String(fields.title), '\n');
  return `---\n${stringify(data, { lineWidth: 0 })}---\n${body}`;
}
