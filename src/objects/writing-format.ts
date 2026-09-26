import type { Node as ProseNode } from '@milkdown/prose/model';

export interface MarkdownNode {
  type: string;
  children?: MarkdownNode[];
  value?: string;
  url?: string;
  title?: string | null;
  alt?: string | null;
  identifier?: string;
  label?: string;
  depth?: number;
  ordered?: boolean;
  start?: number | null;
  spread?: boolean;
  checked?: boolean | null;
  lang?: string | null;
  meta?: string | null;
  align?: (string | null)[];
  position?: { start: { offset?: number }; end: { offset?: number } };
}

const supported: Record<string, true> = { root: true, paragraph: true, heading: true, text: true, emphasis: true, strong: true, delete: true, link: true, image: true, linkReference: true, imageReference: true, definition: true, inlineCode: true, code: true, break: true, list: true, listItem: true, blockquote: true, thematicBreak: true, table: true, tableRow: true, tableCell: true, html: true };

/** Match the server's HTML-disabled Markdown dialect without inventing a parser. */
export function literalAutolinks(tree: MarkdownNode, source: string): void {
  if (tree.type === 'link') {
    const start = tree.position?.start.offset;
    const end = tree.position?.end.offset;
    if (start === undefined || end === undefined || source[start] !== '[') {
      tree.type = 'text';
      tree.value = start !== undefined && end !== undefined && source[start] === '<'
        ? source.slice(start, end)
        : (tree.children ?? []).map(child => child.value ?? '').join('');
      delete tree.children;
      delete tree.url;
      delete tree.title;
    }
  }
  for (const child of tree.children ?? []) literalAutolinks(child, source);
}

function walk(tree: MarkdownNode, visit: (node: MarkdownNode) => void): void {
  visit(tree);
  for (const child of tree.children ?? []) walk(child, visit);
}

/** References may become inline links, but definitions not used by a link stay data. */
export function unusedDefinitions(tree: MarkdownNode): MarkdownNode[] {
  const references = new Set<string>();
  walk(tree, node => {
    if (node.type === 'linkReference' || node.type === 'imageReference') references.add(node.identifier ?? '');
  });
  const definitions: MarkdownNode[] = [];
  const seen = new Set<string>();
  walk(tree, node => {
    if (node.type !== 'definition') return;
    const id = node.identifier ?? '';
    const keep = !references.has(id) || seen.has(id);
    seen.add(id);
    if (keep) definitions.push(node);
  });
  return definitions;
}

/** Compare parsed meaning, not delimiter choices, positions, or raw HTML strings. */
export function markdownMeaning(tree: MarkdownNode, source: string): string {
  literalAutolinks(tree, source);
  const definitions = new Map<string, MarkdownNode>();
  walk(tree, node => {
    if (!supported[node.type]) throw new Error(`This writing uses ${node.type}, which the formatted editor cannot preserve in the saved Markdown dialect.`);
    if (node.type === 'definition' && !definitions.has(node.identifier ?? '')) definitions.set(node.identifier ?? '', node);
  });
  const normalize = (node: MarkdownNode, parentType?: string): unknown => {
    if (node.type === 'html' && parentType && !['paragraph', 'heading', 'tableCell', 'emphasis', 'strong', 'delete', 'link'].includes(parentType)) {
      throw new Error('Block HTML can contain Markdown that the saved renderer interprets differently. Its exact source remains available in the native editor.');
    }
    if (node.type === 'definition') return undefined;
    let type = node.type;
    let target = node;
    if (type === 'linkReference' || type === 'imageReference') {
      target = definitions.get(node.identifier ?? '') ?? node;
      if (target === node) throw new Error('An unresolved reference could not be preserved.');
      type = type === 'linkReference' ? 'link' : 'image';
    }
    const children: unknown[] = [];
    for (const child of node.children ?? []) {
      const next = normalize(child, node.type);
      if (next !== undefined) {
        // Adjacent text nodes are a parser detail (not a document difference).
        const previous = children.at(-1) as { type?: string; value?: string } | undefined;
        const current = next as { type?: string; value?: string };
        if (previous?.type === 'text' && current.type === 'text') previous.value = (previous.value ?? '') + (current.value ?? '');
        else children.push(next);
      }
    }
    const result: Record<string, unknown> = { type };
    if (node.children) result.children = children;
    if (node.value !== undefined) result.value = node.value;
    if (type === 'link' || type === 'image') {
      result.url = target.url;
      result.title = target.title || null;
      if (type === 'image') result.alt = node.alt || '';
    }
    if (type === 'heading') result.depth = node.depth;
    if (type === 'code') { result.lang = node.lang || null; result.meta = node.meta || null; }
    if (type === 'list') { result.ordered = Boolean(node.ordered); result.start = node.ordered ? node.start ?? 1 : null; result.spread = Boolean(node.spread); }
    if (type === 'listItem') { result.checked = node.checked ?? null; result.spread = Boolean(node.spread); }
    if (type === 'table') result.align = node.align;
    return result;
  };
  return JSON.stringify(normalize(tree));
}

/** Ignore only layout/derived attributes that Markdown cannot retain. */
export function documentMeaning(doc: ProseNode): string {
  const normalize = (node: ProseNode): unknown => {
    const content: unknown[] = [];
    let end = node.childCount;
    if (node.type.name === 'paragraph' || node.type.name === 'heading') {
      while (end && node.child(end - 1).type.name === 'hardbreak') end--;
    }
    for (let index = 0; index < end; index++) {
      const child = normalize(node.child(index));
      if (child !== undefined) content.push(child);
    }
    if (node.type.name === 'paragraph' && !content.length) return undefined;
    const attrs = { ...node.attrs };
    for (const key of ['id', 'label', 'listType', 'spread', 'colwidth']) delete attrs[key];
    if ('title' in attrs) attrs.title ||= null;
    return { type: node.type.name, attrs, text: node.text, marks: node.marks.map(mark => mark.toJSON()), content };
  };
  return JSON.stringify(normalize(doc));
}
