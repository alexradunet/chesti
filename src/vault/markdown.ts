import { createHash } from 'node:crypto';
import { basename } from 'node:path/posix';
import { fromMarkdown } from 'mdast-util-from-markdown';
import { isAlias, isMap, isScalar, LineCounter, parseDocument, visit } from 'yaml';

export interface Diagnostic {
  code: string;
  severity: 'error' | 'warning';
  file: string;
  line: number;
  column: number;
  field?: string;
  message: string;
  related?: string[];
}
export interface WikiLink { target: string; line: number; column: number }
export interface MarkdownFile {
  path: string;
  source: string;
  body: string;
  title: string;
  revision: string;
  frontmatter: Record<string, unknown>;
  hasFrontmatter: boolean;
  links: WikiLink[];
  diagnostics: Diagnostic[];
  at: (path?: readonly (string | number)[]) => { line: number; column: number };
}
export function diagnostic(file: MarkdownFile, code: string, message: string, path: readonly (string | number)[] = [], severity: Diagnostic['severity'] = 'error'): Diagnostic {
  return { code, severity, file: file.path, ...file.at(path), ...(path.length ? { field: `frontmatter.${path.join('.')}` } : {}), message };
}
export function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** No evaluation, coercion, normalization or writes. Original bytes (as UTF-8) remain available. */
export function parseMarkdown(path: string, source: string): MarkdownFile {
  const result: MarkdownFile = {
    path, source, body: source, title: basename(path).replace(/\.md$/i, ''),
    revision: createHash('sha256').update(source).digest('hex'),
    frontmatter: {}, hasFrontmatter: false, links: [], diagnostics: [], at: () => ({ line: 1, column: 1 }),
  };
  let bodyOffset = 0;
  const lineStarts = [0];
  for (let i = 0; i < source.length; i++) if (source[i] === '\n') lineStarts.push(i + 1);
  const position = (offset: number) => {
    let lo = 0, hi = lineStarts.length;
    while (lo + 1 < hi) { const mid = (lo + hi) >>> 1; if (lineStarts[mid]! <= offset) lo = mid; else hi = mid; }
    return { line: lo + 1, column: offset - lineStarts[lo]! + 1 };
  };
  const start = /^(?:\uFEFF)?---[ \t]*(?:\r?\n|$)/.exec(source);
  if (start) {
    result.hasFrontmatter = true;
    const end = /^---[ \t]*\r?$/m.exec(source.slice(start[0].length));
    if (!end) {
      result.diagnostics.push(diagnostic(result, 'FRONTMATTER_UNCLOSED', 'Opening frontmatter delimiter needs a closing --- line.'));
      return result;
    }
    const yamlOffset = start[0].length;
    const yamlSource = source.slice(yamlOffset, yamlOffset + end.index);
    bodyOffset = yamlOffset + end.index + end[0].length;
    if (source[bodyOffset] === '\n') bodyOffset++;
    result.body = source.slice(bodyOffset);
    const counter = new LineCounter();
    const doc = parseDocument(yamlSource, { version: '1.2', schema: 'core', strict: true, uniqueKeys: true, lineCounter: counter });
    result.at = (parts = []) => {
      for (let count = parts.length; count > 0; count--) {
        try {
          const node: unknown = doc.getIn(parts.slice(0, count), true);
          if (node && typeof node === 'object' && 'range' in node && Array.isArray(node.range)) return position(yamlOffset + Number(node.range[0]));
        } catch { /* malformed document: fall back to the frontmatter start */ }
      }
      return position(yamlOffset);
    };
    for (const error of [...doc.errors, ...doc.warnings]) result.diagnostics.push({
      code: 'YAML_SYNTAX', severity: 'error', file: path, ...position(yamlOffset + error.pos[0]),
      message: error.message.split('\n')[0]!,
    });
    const unsupported = (offset: number, message: string) => result.diagnostics.push({ code: 'YAML_UNSUPPORTED', severity: 'error', file: path, ...position(yamlOffset + offset), message });
    // Do not expand aliases; do not permit custom types, complex keys or object-prototype keys.
    visit(doc, {
      Node(_key, node) {
        if (isAlias(node) || node.anchor || node.tag) unsupported(node.range?.[0] ?? 0, 'Aliases, anchors and explicit YAML tags are not supported.');
        if (isScalar(node) && typeof node.value === 'number' && (!Number.isFinite(node.value) || (Number.isInteger(node.value) && !Number.isSafeInteger(node.value)))) unsupported(node.range?.[0] ?? 0, 'Numbers must be finite; integers outside the safe JavaScript range must be strings.');
        if (isMap(node)) for (const pair of node.items) {
          if (!isScalar(pair.key) || typeof pair.key.value !== 'string') unsupported(node.range?.[0] ?? 0, 'Mapping keys must be strings.');
          else if (['__proto__', 'prototype', 'constructor', '<<'].includes(pair.key.value)) unsupported(pair.key.range?.[0] ?? 0, `Reserved mapping key: ${pair.key.value}.`);
        }
      },
    });
    if (result.diagnostics.length === 0) {
      try {
        const data: unknown = doc.toJS({ maxAliasCount: 0 });
        if (data === null) result.frontmatter = {};
        else if (isObject(data)) result.frontmatter = data;
        else result.diagnostics.push(diagnostic(result, 'FRONTMATTER_SHAPE', 'Frontmatter must be a mapping of field names to values.'));
      } catch { result.diagnostics.push(diagnostic(result, 'YAML_SYNTAX', 'Frontmatter could not be read safely.')); }
    }
  }
  const tree = fromMarkdown(result.body);
  type Node = { type: string; value?: string; children?: Node[]; position?: { start: { offset?: number }; end: { offset?: number } } };
  const text = (node: Node): string => node.value ?? node.children?.map(text).join('') ?? '';
  const heading = tree.children.find(node => node.type === 'heading' && node.depth === 1);
  if (heading) result.title = text(heading).trim() || result.title;
  const walk = (node: Node) => {
    if (['code', 'inlineCode', 'html', 'link', 'image', 'definition'].includes(node.type)) return;
    if (node.type === 'text' && node.position) {
      const begin = node.position.start.offset ?? 0;
      const raw = result.body.slice(begin, node.position.end.offset);
      for (const match of raw.matchAll(/(?<!\\)\[\[([^\]\r\n]+)\]\]/g)) {
        const target = match[1]!.split('|')[0]!.trim();
        result.links.push({ target, ...position(bodyOffset + begin + match.index) });
      }
    }
    for (const child of node.children ?? []) walk(child);
  };
  walk(tree);
  return result;
}
