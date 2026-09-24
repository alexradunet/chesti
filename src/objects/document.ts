import { Schema } from 'prosemirror-model';
import { schema as markdownSchema, defaultMarkdownParser, MarkdownParser, MarkdownSerializer, defaultMarkdownSerializer } from 'prosemirror-markdown';
import type { DocumentNode } from './model.js';

// The editor and server share exactly one document vocabulary. Images are retained
// on import but rendered as text, never fetched from arbitrary remote URLs.
let nodes = markdownSchema.spec.nodes;
for (const name of ['paragraph', 'heading', 'blockquote', 'code_block', 'ordered_list', 'bullet_list', 'list_item', 'horizontal_rule']) {
  const spec = nodes.get(name)!;
  nodes = nodes.update(name, { ...spec, attrs: { ...spec.attrs, blockId: { default: null } } });
}
nodes = nodes.update('image', { ...nodes.get('image')!, toDOM: node => ['span', { class: 'document-image' }, `[Image: ${String(node.attrs.alt || node.attrs.src || '')}]`] });
nodes = nodes.addToEnd('object_link', {
  inline: true, group: 'inline', atom: true,
  attrs: { objectId: {}, label: { default: 'Linked object' } },
  toDOM: node => ['a', { href: `/objects/${encodeURIComponent(String(node.attrs.objectId))}`, 'data-object-link': node.attrs.objectId }, String(node.attrs.label)],
  parseDOM: [{ tag: 'a[data-object-link]', getAttrs: dom => ({ objectId: dom.getAttribute('data-object-link'), label: dom.textContent || 'Linked object' }) }],
});
const link = markdownSchema.spec.marks.get('link')!;
const marks = markdownSchema.spec.marks.update('link', {
  ...link,
  toDOM: mark => ['a', { href: safeLink(mark.attrs.href) ? mark.attrs.href : '#', rel: 'noreferrer' }, 0],
  parseDOM: [{ tag: 'a[href]', getAttrs: dom => safeLink(dom.getAttribute('href')) ? { href: dom.getAttribute('href'), title: dom.getAttribute('title') } : false }],
});
export const documentSchema = new Schema({ nodes, marks });
const parser = new MarkdownParser(documentSchema, defaultMarkdownParser.tokenizer, defaultMarkdownParser.tokens);
const serializer = new MarkdownSerializer({ ...defaultMarkdownSerializer.nodes,
  object_link: (state, node) => state.write(`[${String(node.attrs.label).replace(/[\\\[\]]/g, '\\$&')}](/objects/${node.attrs.objectId})`),
}, defaultMarkdownSerializer.marks);
const idPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
export function safeLink(href: unknown): boolean {
  return typeof href === 'string' && !/[\u0000-\u0020\u007f]/.test(href) && (/^https?:\/\//i.test(href) || /^mailto:/i.test(href) || /^\/objects\/[a-f0-9-]{36}$/.test(href));
}
export function validateDocument(input: unknown): DocumentNode {
  if (!input || typeof input !== 'object' || JSON.stringify(input).length > 262_144) throw new Error('Document must be a structured document smaller than 256 KB.');
  // Bound nesting before allowing the recursive editor parser to visit the tree.
  const queue: { value: unknown; depth: number }[] = [{ value: input, depth: 0 }];
  let count = 0;
  while (queue.length) {
    const { value, depth } = queue.pop()!;
    if (++count > 10_000 || depth > 32 || !value || typeof value !== 'object') throw new Error('Document is too complex.');
    const node = value as DocumentNode;
    if (node.content !== undefined) {
      if (!Array.isArray(node.content)) throw new Error('Invalid document content.');
      for (const child of node.content) queue.push({ value: child, depth: depth + 1 });
    }
    if (node.type === 'object_link' && (!idPattern.test(String(node.attrs?.objectId)) || typeof node.attrs?.label !== 'string' || node.attrs.label.length > 500)) throw new Error('Invalid object link.');
    for (const mark of node.marks ?? []) if (mark.type === 'link' && !safeLink(mark.attrs?.href)) throw new Error('Links must use http, https, mailto, or a local object address.');
  }
  const doc = documentSchema.nodeFromJSON(input);
  if (doc.type.name !== 'doc') throw new Error('Expected a document.');
  doc.check();
  const normalized = doc.toJSON() as DocumentNode;
  const seen = new Set<string>();
  const assign = (node: DocumentNode): void => {
    if (documentSchema.nodes[node.type]?.spec.attrs?.blockId) {
      let id = typeof node.attrs?.blockId === 'string' ? node.attrs.blockId : '';
      if (!idPattern.test(id) || seen.has(id)) id = crypto.randomUUID();
      seen.add(id);
      node.attrs = { ...node.attrs, blockId: id };
    }
    for (const child of node.content ?? []) assign(child);
  };
  assign(normalized);
  return normalized;
}
export function documentFromMarkdown(text: string): DocumentNode {
  const doc = parser.parse(text).toJSON() as DocumentNode;
  const clean = (node: DocumentNode): void => {
    node.marks = node.marks?.filter(mark => mark.type !== 'link' || safeLink(mark.attrs?.href));
    for (const child of node.content ?? []) clean(child);
  };
  clean(doc);
  return validateDocument(doc);
}
export function documentToMarkdown(document: DocumentNode): string {
  return serializer.serialize(documentSchema.nodeFromJSON(document));
}
export function documentText(document: DocumentNode): string {
  const node = documentSchema.nodeFromJSON(document);
  return node.textBetween(0, node.content.size, '\n', leaf => leaf.type.name === 'object_link' ? String(leaf.attrs.label) : '');
}
export function documentReferences(document: DocumentNode): { targetId: string; blockId: string }[] {
  const references: { targetId: string; blockId: string }[] = [];
  const walk = (node: DocumentNode, parentId: string): void => {
    const blockId = typeof node.attrs?.blockId === 'string' ? node.attrs.blockId : parentId;
    if (node.type === 'object_link') references.push({ targetId: String(node.attrs!.objectId), blockId });
    for (const mark of node.marks ?? []) {
      const target = mark.type === 'link' && /^\/objects\/([a-f0-9-]{36})$/.exec(String(mark.attrs?.href));
      if (target) references.push({ targetId: target[1]!, blockId });
    }
    for (const child of node.content ?? []) walk(child, blockId);
  };
  walk(document, '');
  return references;
}
