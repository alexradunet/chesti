import type { Database } from 'bun:sqlite';
import { markdownReferences, markdownText, validateMarkdown } from './markdown.js';
import type { ObjectRecord, ObjectWrite } from './model.js';

// This is a read-only decoder for the finite version-1 storage vocabulary, not
// another document model or write path. Reject anything we cannot preserve.
interface LegacyMark { type: string; attrs: Record<string, unknown> }
interface LegacyNode { type: string; attrs: Record<string, unknown>; content: LegacyNode[]; marks: LegacyMark[]; text?: string }
const blockAttrs: Record<string, string[]> = {
  doc: [], paragraph: ['blockId'], heading: ['blockId', 'level'], blockquote: ['blockId'],
  code_block: ['blockId', 'params'], horizontal_rule: ['blockId'],
  ordered_list: ['blockId', 'order', 'tight'], bullet_list: ['blockId', 'tight'], list_item: ['blockId'],
};
const inlineAttrs: Record<string, string[]> = { text: [], hard_break: [], image: ['src', 'alt', 'title'], object_link: ['objectId', 'label'] };
const markAttrs: Record<string, string[]> = { em: [], strong: [], code: [], link: ['href', 'title'] };
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
function fail(reason: string): never { throw new Error(`Cannot upgrade version-1 writing: ${reason}.`); }
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
function keys(value: Record<string, unknown>, allowed: string[], description: string): void {
  for (const key of Object.keys(value)) if (!allowed.includes(key)) fail(`unknown ${description} ${key}`);
}
function attributes(value: unknown, allowed: string[], description: string): Record<string, unknown> {
  if (value === undefined) return {};
  if (!record(value)) fail(`invalid ${description} attributes`);
  keys(value, allowed, `${description} attribute`);
  if ('blockId' in value && value.blockId !== null && typeof value.blockId !== 'string') fail('invalid block ID');
  return value;
}
function string(value: unknown, description: string): string {
  if (typeof value !== 'string' || /[\u0000\r]|[\uD800-\uDFFF]/u.test(value)) fail(`invalid ${description}`);
  return value;
}
function optionalString(value: unknown, description: string): string | undefined {
  return value === undefined || value === null ? undefined : string(value, description);
}
function decode(input: unknown): LegacyNode {
  let count = 0;
  const visit = (value: unknown, depth: number): LegacyNode => {
    if (++count > 10_000 || depth > 32 || !record(value) || typeof value.type !== 'string') fail('malformed or excessively complex document');
    keys(value, ['type', 'attrs', 'content', 'marks', 'text'], 'node field');
    const allowed = blockAttrs[value.type] ?? inlineAttrs[value.type];
    if (!allowed) fail(`unknown node ${value.type}`);
    const attrs = attributes(value.attrs, allowed, value.type);
    if (value.content !== undefined && !Array.isArray(value.content)) fail('invalid content');
    if (value.marks !== undefined && !Array.isArray(value.marks)) fail('invalid marks');
    const marks: LegacyMark[] = [];
    for (const mark of value.marks ?? []) {
      if (!record(mark) || typeof mark.type !== 'string' || !Object.hasOwn(markAttrs, mark.type)) fail('unknown or malformed mark');
      keys(mark, ['type', 'attrs'], 'mark field');
      if (marks.some(previous => previous.type === mark.type)) fail('duplicate mark');
      const attrs = attributes(mark.attrs, markAttrs[mark.type]!, mark.type);
      if (mark.type === 'link') {
        string(attrs.href, 'link address');
        optionalString(attrs.title, 'link title');
      }
      marks.push({ type: mark.type, attrs });
    }
    if (Object.hasOwn(blockAttrs, value.type) && marks.length) fail('marks on a block');
    const content = (value.content ?? []).map((child: unknown) => visit(child, depth + 1));
    const node: LegacyNode = { type: value.type, attrs, content, marks };
    if (value.type === 'text') {
      node.text = string(value.text, 'text');
      if (!node.text || content.length) fail('invalid text node');
    } else if (value.text !== undefined) fail('text on a non-text node');
    if (Object.hasOwn(inlineAttrs, value.type) && content.length) fail('content on an inline leaf');
    switch (value.type) {
      case 'doc': case 'blockquote': case 'list_item':
        if (!content.length || content.some(child => !Object.hasOwn(blockAttrs, child.type) || child.type === 'doc' || child.type === 'list_item')) fail(`invalid ${value.type} children`);
        break;
      case 'paragraph': case 'heading':
        if (content.some(child => !Object.hasOwn(inlineAttrs, child.type))) fail(`invalid ${value.type} children`);
        if (value.type === 'heading' && (!Number.isInteger(attrs.level ?? 1) || Number(attrs.level ?? 1) < 1 || Number(attrs.level ?? 1) > 6)) fail('invalid heading level');
        if (value.type === 'heading' && content.some(child => child.type !== 'text' && child.type !== 'image')) fail('invalid heading children');
        if (content.at(-1)?.type === 'hard_break') fail('trailing hard break cannot be represented in Markdown');
        break;
      case 'code_block':
        if (content.some(child => child.type !== 'text' || child.marks.length)) fail('invalid code block children');
        if (attrs.params !== undefined && typeof attrs.params !== 'string') fail('invalid code block language');
        if (/[\r\n]/.test(String(attrs.params ?? ''))) fail('multiline code block language');
        break;
      case 'ordered_list': case 'bullet_list':
        if (!content.length || content.some(child => child.type !== 'list_item')) fail('invalid list children');
        if (attrs.tight !== undefined && typeof attrs.tight !== 'boolean') fail('invalid list tightness');
        if (value.type === 'ordered_list' && (!Number.isInteger(attrs.order ?? 1) || Number(attrs.order ?? 1) < 0 || Number(attrs.order ?? 1) + content.length - 1 > 999_999_999)) fail('unrepresentable list order');
        break;
      case 'horizontal_rule': if (content.length) fail('content on a horizontal rule'); break;
      case 'image':
        string(attrs.src, 'image address'); optionalString(attrs.alt, 'image alternative text'); optionalString(attrs.title, 'image title');
        break;
      case 'object_link':
        if (typeof attrs.objectId !== 'string' || !uuid.test(attrs.objectId)) fail('invalid object link UUID');
        string(attrs.label ?? 'Linked object', 'object link label');
        if (marks.some(mark => mark.type === 'link')) fail('nested object link');
        break;
    }
    return node;
  };
  const node = visit(input, 0);
  if (node.type !== 'doc') fail('expected a document');
  return node;
}

// Entities preserve whitespace and literal HTML without enabling raw HTML. All
// Markdown punctuation is escaped, including extension delimiters and lists.
function text(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/[\\`*_{}\[\]()#+.!|~=-]/g, '\\$&').replace(/\n/g, '&#10;').replace(/\t/g, '&#9;')
    .replace(/^ +| +$/g, spaces => '&#32;'.repeat(spaces.length));
}
function destination(value: string): string {
  return `<${value.replace(/&/g, '&amp;').replace(/[<>\\\s]/g, character => encodeURIComponent(character))}>`;
}
function title(value: unknown): string {
  return value === undefined || value === null ? '' : ` "${text(string(value, 'link title')).replace(/"/g, '&quot;')}"`;
}
function code(value: string): string {
  if (/[\r\n]/.test(value)) fail('inline code containing a newline');
  const longest = Math.max(0, ...Array.from(value.matchAll(/`+/g), match => match[0].length));
  const fence = '`'.repeat(longest + 1);
  const pad = /^`|`$/.test(value) || (/^ .* $/.test(value) && /[^ ]/.test(value)) ? ' ' : '';
  return `${fence}${pad}${value}${pad}${fence}`;
}
function inline(nodes: LegacyNode[], level = 0): string {
  const order = ['link', 'strong', 'em', 'code'];
  if (level === order.length) return nodes.map(node => {
    if (node.type === 'text') return text(node.text!);
    if (node.type === 'hard_break') return '\\\n';
    if (node.type === 'object_link') return `[${text(String(node.attrs.label ?? 'Linked object'))}](/objects/${String(node.attrs.objectId).toLowerCase()})`;
    if (node.type === 'image') return `![${text(String(node.attrs.alt ?? ''))}](${destination(String(node.attrs.src))}${title(node.attrs.title)})`;
    return fail(`unexpected inline node ${node.type}`);
  }).join('');
  let result = '';
  for (let start = 0; start < nodes.length;) {
    const mark = nodes[start]!.marks.find(mark => mark.type === order[level]);
    const signature = mark ? JSON.stringify(mark.attrs) : undefined;
    let end = start + 1;
    while (end < nodes.length) {
      const next = nodes[end]!.marks.find(mark => mark.type === order[level]);
      if (Boolean(next) !== Boolean(mark) || (next && JSON.stringify(next.attrs) !== signature)) break;
      end++;
    }
    const group = nodes.slice(start, end);
    if (mark?.type === 'code') {
      if (group.some(node => node.type !== 'text')) fail('code mark on a non-text node');
      result += code(group.map(node => node.text!).join(''));
    } else {
      const content = inline(group, level + 1);
      if (!mark) result += content;
      else if (mark.type === 'link') result += `[${content}](${destination(String(mark.attrs.href))}${title(mark.attrs.title)})`;
      else {
        const delimiter = mark.type === 'strong' ? '**' : '*';
        result += `${delimiter}${content}${delimiter}`;
      }
    }
    start = end;
  }
  return result;
}
function blocks(nodes: LegacyNode[]): string {
  if (nodes.length > 1 && nodes.some(node => node.type === 'paragraph' && !node.content.length)) fail('empty paragraph between blocks cannot be represented in Markdown');
  // Alternating list delimiters keep adjacent independent lists from merging.
  return nodes.map((node, index) => block(node, index % 2 === 1)).join('\n\n');
}
function block(node: LegacyNode, alternate = false): string {
  switch (node.type) {
    case 'paragraph': return inline(node.content);
    case 'heading': return `${'#'.repeat(Number(node.attrs.level ?? 1))} ${inline(node.content)}`;
    case 'horizontal_rule': return '---';
    case 'blockquote': return blocks(node.content).split('\n').map(line => `> ${line}`).join('\n');
    case 'code_block': {
      const value = node.content.map(child => child.text!).join('');
      const params = String(node.attrs.params ?? '');
      const marker = params.includes('`') ? '~' : '`';
      const longest = Math.max(2, ...Array.from(value.matchAll(marker === '`' ? /`+/g : /~+/g), match => match[0].length));
      const fence = marker.repeat(longest + 1);
      return `${fence}${params}\n${value}\n${fence}`;
    }
    case 'ordered_list': case 'bullet_list':
      return node.content.map((item, index) => {
        const marker = node.type === 'bullet_list' ? (alternate ? '+ ' : '- ') : `${Number(node.attrs.order ?? 1) + index}${alternate ? ')' : '.'} `;
        const lines = blocks(item.content).split('\n');
        return marker + lines.map((line, index) => index ? `${' '.repeat(marker.length)}${line}` : line).join('\n');
      }).join(node.attrs.tight ? '\n' : '\n\n');
    default: return fail(`unexpected block ${node.type}`);
  }
}
function markdown(input: unknown): string { return validateMarkdown(blocks(decode(input).content)); }

interface LegacyRow { id: string; type_id: string; title: string; properties_json: string; document_json: string; revision: number; created_at: string; updated_at: string; trashed: number }
function snapshot(value: unknown): ObjectRecord {
  if (!record(value) || typeof value.id !== 'string' || !uuid.test(value.id) || typeof value.typeId !== 'string' || !uuid.test(value.typeId)
    || typeof value.title !== 'string' || !record(value.properties) || !Number.isSafeInteger(value.revision) || Number(value.revision) < 1
    || typeof value.createdAt !== 'string' || typeof value.updatedAt !== 'string' || typeof value.trashed !== 'boolean' || 'body' in value) fail('malformed revision snapshot');
  keys(value, ['id', 'typeId', 'title', 'properties', 'document', 'revision', 'createdAt', 'updatedAt', 'trashed'], 'snapshot field');
  const { document, ...rest } = value;
  return { ...rest, body: markdown(document) } as ObjectRecord;
}

/** Called only inside the constructor's transaction; every DDL and data write rolls back together. */
export function upgradeObjectMarkdown(db: Database, fingerprint: (write: ObjectWrite) => string): void {
  db.exec("ALTER TABLE objects ADD COLUMN body TEXT NOT NULL DEFAULT ''; ALTER TABLE objects RENAME COLUMN document_text TO body_text;");
  const update = db.query('UPDATE objects SET body = CAST(? AS TEXT), body_text = CAST(? AS TEXT) WHERE id = ?');
  for (const row of db.query<LegacyRow, []>('SELECT * FROM objects').all()) {
    const body = markdown(JSON.parse(row.document_json));
    update.run(Buffer.from(body), Buffer.from(markdownText(body)), row.id);
  }
  const revisionUpdate = db.query('UPDATE object_revisions SET snapshot_json = ? WHERE object_id = ? AND revision = ?');
  for (const row of db.query<{ object_id: string; revision: number; snapshot_json: string }, []>('SELECT object_id, revision, snapshot_json FROM object_revisions').all()) {
    const converted = snapshot(JSON.parse(row.snapshot_json));
    if (converted.id !== row.object_id || converted.revision !== row.revision) fail('revision identity mismatch');
    revisionUpdate.run(JSON.stringify(converted), row.object_id, row.revision);
  }
  for (const receipt of db.query<{ request_id: string; object_id: string }, []>('SELECT request_id, object_id FROM object_create_requests').all()) {
    const row = db.query<LegacyRow & { body: string }, [string]>('SELECT * FROM objects WHERE id = ?').get(receipt.object_id);
    if (!row) fail('creation receipt without an object');
    let original: ObjectWrite;
    if (row.revision === 1) original = { typeId: row.type_id, title: row.title, properties: JSON.parse(row.properties_json), body: row.body };
    else {
      const first = db.query<{ snapshot_json: string }, [string]>('SELECT snapshot_json FROM object_revisions WHERE object_id = ? AND revision = 1').get(row.id);
      if (!first) fail('creation receipt missing its original revision');
      original = JSON.parse(first.snapshot_json) as ObjectRecord;
    }
    db.query('UPDATE object_create_requests SET fingerprint = ? WHERE request_id = ?').run(fingerprint(original), receipt.request_id);
  }
  db.exec(`
    ALTER TABLE objects DROP COLUMN document_json;
    CREATE TABLE object_references_v2 (
      source_id TEXT NOT NULL COLLATE NOCASE REFERENCES objects(id), target_id TEXT NOT NULL COLLATE NOCASE REFERENCES objects(id),
      property_id TEXT NOT NULL DEFAULT '', PRIMARY KEY(source_id, target_id, property_id)
    ) STRICT;
    INSERT INTO object_references_v2(source_id, target_id, property_id)
      SELECT DISTINCT source_id, target_id, property_id FROM object_references WHERE property_id != '';
    DROP TABLE object_references;
    ALTER TABLE object_references_v2 RENAME TO object_references;
    CREATE INDEX object_references_target ON object_references(target_id);
  `);
  const reference = db.query("INSERT OR IGNORE INTO object_references(source_id, target_id, property_id) VALUES (?, ?, '')");
  for (const row of db.query<{ id: string; body: string }, []>('SELECT id, body FROM objects').all()) {
    for (const targetId of markdownReferences(row.body)) reference.run(row.id, targetId);
  }
  db.query("UPDATE object_metadata SET value = '2' WHERE key = 'schema_version'").run();
}
