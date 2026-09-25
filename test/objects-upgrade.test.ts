import { test } from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import type { Database } from 'bun:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openDatabase } from '../src/database.js';
import { PAGE_TYPE_ID } from '../src/objects/model.js';
import { markdownReferences, markdownText } from '../src/objects/markdown.js';
import { ObjectRuntime } from '../src/objects/runtime.js';

const sourceId = '11111111-1111-4111-8111-111111111111';
const targetId = '22222222-2222-4222-8222-222222222222';
const propertyId = '33333333-3333-4333-8333-333333333333';
const requestId = '44444444-4444-4444-8444-444444444444';
const timestamp = '2026-08-01T12:00:00.000Z';
const literal = (text: string, marks?: unknown[]) => ({ type: 'text', text, ...(marks ? { marks } : {}) });
const paragraph = (...content: unknown[]) => ({ type: 'paragraph', attrs: { blockId: crypto.randomUUID() }, ...(content.length ? { content } : {}) });
const document = (...content: unknown[]) => ({ type: 'doc', content });

function legacyDatabase(db: Database): void {
  db.exec(`
    CREATE TABLE object_metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT;
    INSERT INTO object_metadata VALUES ('schema_version', '1');
    CREATE TABLE object_types (id TEXT PRIMARY KEY, name TEXT NOT NULL, property_ids_json TEXT NOT NULL CHECK(json_valid(property_ids_json)), revision INTEGER NOT NULL CHECK(revision > 0)) STRICT;
    CREATE TABLE object_properties (id TEXT PRIMARY KEY, label TEXT NOT NULL, kind TEXT NOT NULL, options_json TEXT CHECK(options_json IS NULL OR json_valid(options_json)), target_type_id TEXT REFERENCES object_types(id), multiple INTEGER NOT NULL DEFAULT 0 CHECK(multiple IN (0,1)), revision INTEGER NOT NULL CHECK(revision > 0)) STRICT;
    CREATE TABLE objects (
      id TEXT PRIMARY KEY COLLATE NOCASE, type_id TEXT NOT NULL REFERENCES object_types(id), title TEXT NOT NULL,
      properties_json TEXT NOT NULL CHECK(json_valid(properties_json)), document_json TEXT NOT NULL CHECK(json_valid(document_json)),
      revision INTEGER NOT NULL CHECK(revision > 0), created_at TEXT NOT NULL, updated_at TEXT NOT NULL, trashed INTEGER NOT NULL CHECK(trashed IN (0,1)), document_text TEXT NOT NULL
    ) STRICT;
    CREATE INDEX objects_browse ON objects(trashed, updated_at DESC, id);
    CREATE INDEX objects_type_browse ON objects(type_id, trashed, updated_at DESC, id);
    CREATE TABLE object_references (
      source_id TEXT NOT NULL COLLATE NOCASE REFERENCES objects(id), target_id TEXT NOT NULL COLLATE NOCASE REFERENCES objects(id),
      property_id TEXT NOT NULL DEFAULT '', block_id TEXT NOT NULL DEFAULT '', PRIMARY KEY(source_id, target_id, property_id, block_id)
    ) STRICT;
    CREATE INDEX object_references_target ON object_references(target_id);
    CREATE TABLE object_revisions (object_id TEXT NOT NULL COLLATE NOCASE REFERENCES objects(id), revision INTEGER NOT NULL, snapshot_json TEXT NOT NULL CHECK(json_valid(snapshot_json)), recorded_at TEXT NOT NULL, PRIMARY KEY(object_id, revision)) STRICT;
    CREATE TABLE object_create_requests (request_id TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, object_id TEXT NOT NULL COLLATE NOCASE REFERENCES objects(id)) STRICT;
    CREATE TABLE visitor_state (id TEXT PRIMARY KEY, selected_view TEXT, draft_json TEXT) STRICT;
    INSERT INTO visitor_state VALUES ('visitor', 'saved-view', '{"title":"Unsaved draft"}');
    CREATE TABLE saved_views (id TEXT PRIMARY KEY, revision INTEGER NOT NULL, spec_json TEXT NOT NULL) STRICT;
    INSERT INTO saved_views VALUES ('saved-view', 3, '{"name":"Pinned view"}');
  `);
  db.query('INSERT INTO object_types VALUES (?, ?, ?, 1)').run(PAGE_TYPE_ID, 'Page', JSON.stringify([propertyId]));
  db.query("INSERT INTO object_properties VALUES (?, 'Related', 'reference', NULL, ?, 0, 1)").run(propertyId, PAGE_TYPE_ID);
}
function insert(db: Database, id: string, writing: unknown, revision = 1, properties = {}, title = 'Writing') {
  const value = { id, typeId: PAGE_TYPE_ID, title, properties, document: writing, revision, createdAt: timestamp, updatedAt: timestamp, trashed: false };
  db.query('INSERT INTO objects VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?)').run(id, PAGE_TYPE_ID, title, JSON.stringify(properties), JSON.stringify(writing), revision, timestamp, timestamp, 'Old search text');
  return value;
}
function fixture(t: TestContext): Database {
  const db = openDatabase();
  t.after(() => db.close());
  legacyDatabase(db);
  return db;
}

const formatted = document(
  { type: 'heading', attrs: { level: 2, blockId: sourceId }, content: [literal('Heading')] },
  paragraph(literal('Bold', [{ type: 'strong' }]), literal(' and '), literal('both', [{ type: 'strong' }, { type: 'em' }]), literal(' '), literal('a`b', [{ type: 'strong' }, { type: 'code' }]), { type: 'hard_break' }, literal('<tag> & *literal* [brackets]')),
  paragraph({ type: 'object_link', attrs: { objectId: targetId, label: 'A [person]' } }, literal(' and '), literal('same person', [{ type: 'link', attrs: { href: `/objects/${targetId}`, title: 'A "title"' } }])),
  { type: 'ordered_list', attrs: { order: 3, tight: false }, content: [
    { type: 'list_item', content: [paragraph(literal('Third')), { type: 'bullet_list', attrs: { tight: true }, content: [{ type: 'list_item', content: [paragraph(literal('Nested'))] }] }] },
    { type: 'list_item', content: [paragraph(literal('Fourth')), { type: 'code_block', attrs: { params: 'js' }, content: [literal('const fence = "```";\nnext();')] }] },
  ] },
  { type: 'blockquote', content: [paragraph(literal('Quoted')), paragraph(literal('Second quoted paragraph'))] },
  { type: 'horizontal_rule' },
  paragraph({ type: 'image', attrs: { src: 'https://example.com/a(b).png?a=1&b=2', alt: 'Picture [one]', title: 'Caption "quoted"' } }),
  paragraph(literal('Safe URL', [{ type: 'link', attrs: { href: 'https://example.com/a(b)?a=1&b=2', title: 'A title' } }])),
);

test('version-1 upgrade preserves writing formats, UUID links, revisions and unrelated state', t => {
  const db = fixture(t);
  insert(db, targetId, document(paragraph()), 1, {}, 'Person');
  const current = insert(db, sourceId, formatted, 2, { [propertyId]: targetId }, 'Edited');
  const original = { ...current, title: 'Original', revision: 1, document: document(paragraph(literal('Original writing'))) };
  db.query('INSERT INTO object_revisions VALUES (?, 1, ?, ?)').run(sourceId, JSON.stringify(original), timestamp);
  db.query('INSERT INTO object_create_requests VALUES (?, ?, ?)').run(requestId, 'legacy-digest', sourceId);
  db.query('INSERT INTO object_references VALUES (?, ?, ?, ?)').run(sourceId, targetId, propertyId, '');
  db.query('INSERT INTO object_references VALUES (?, ?, ?, ?)').run(sourceId, targetId, '', 'old-block-one');
  db.query('INSERT INTO object_references VALUES (?, ?, ?, ?)').run(sourceId, targetId, '', 'old-block-two');
  const visitor = db.query('SELECT * FROM visitor_state').all();
  const views = db.query('SELECT * FROM saved_views').all();
  const runtime = new ObjectRuntime(db);
  const converted = runtime.getObject(sourceId);
  const { document: _document, ...metadata } = current;
  assert.deepEqual({ ...converted, body: undefined }, { ...metadata, body: undefined });
  const html = Bun.markdown.html(converted.body, { noHtmlBlocks: true, noHtmlSpans: true });
  assert.match(html, /<h2>Heading<\/h2>/);
  assert.match(html, /<strong>Bold<\/strong>/);
  assert.match(html, /<strong><em>both<\/em><\/strong>|<em><strong>both<\/strong><\/em>/);
  assert.match(html, /<strong><code>a`b<\/code><\/strong>/);
  assert.match(html, /<br\s*\/?>(?:\n)?&lt;tag&gt; &amp; \*literal\* \[brackets\]/);
  assert.match(html, /<ol start="3">/);
  assert.match(html, /<ul>\s*<li>Nested<\/li>\s*<\/ul>/);
  assert.match(html, /<code class="language-js">const fence = &quot;```&quot;;\nnext\(\);\n<\/code>/);
  assert.match(html, /<blockquote>\s*<p>Quoted<\/p>\s*<p>Second quoted paragraph<\/p>\s*<\/blockquote>/);
  assert.match(html, /<hr\s*\/?>/);
  assert.match(html, /src="https:\/\/example.com\/a\(b\).png\?a=1&amp;b=2" alt="Picture \[one\]" title="Caption &quot;quoted&quot;"/);
  assert.match(html, /href="https:\/\/example.com\/a\(b\)\?a=1&amp;b=2" title="A title"/);
  assert.deepEqual(markdownReferences(converted.body), [targetId]);
  assert.deepEqual(runtime.backlinks(targetId).map(link => link.propertyId ?? 'writing').sort(), [propertyId, 'writing'].sort());
  assert.ok(runtime.listObjects({ search: 'Second quoted paragraph' }).some(object => object.id === sourceId));
  assert.ok(markdownText(converted.body).includes('A [person]'));
  const history = db.query<{ snapshot_json: string; recorded_at: string }, []>('SELECT snapshot_json, recorded_at FROM object_revisions').get()!;
  assert.deepEqual(JSON.parse(history.snapshot_json), { ...metadata, title: 'Original', revision: 1, body: 'Original writing' });
  assert.equal(history.recorded_at, timestamp);
  assert.deepEqual(db.query('SELECT * FROM visitor_state').all(), visitor);
  assert.deepEqual(db.query('SELECT * FROM saved_views').all(), views);
  const retry = runtime.createObject({ typeId: original.typeId, title: original.title, properties: original.properties, body: 'Original writing' }, requestId);
  assert.deepEqual(retry, converted);
  assert.throws(() => runtime.createObject(converted, requestId), /different content/);
  assert.deepEqual(new ObjectRuntime(db).getObject(sourceId), converted);
});

test('blank paragraphs preserve source boundaries without merging nested items or independent lists', t => {
  const db = fixture(t);
  insert(db, targetId, document(paragraph()), 1, {}, 'Person');
  const writing = document(
    paragraph(),
    paragraph(literal('Before', [{ type: 'strong' }, { type: 'em' }])),
    paragraph(),
    paragraph(),
    { type: 'blockquote', content: [
      paragraph(), paragraph(literal('Quoted')), paragraph(), paragraph(literal('Quote end')), paragraph(),
    ] },
    { type: 'bullet_list', attrs: { tight: true }, content: [
      { type: 'list_item', content: [
        paragraph(), paragraph(), paragraph(literal('First', [{ type: 'strong' }, { type: 'em' }])), paragraph(),
        { type: 'bullet_list', attrs: { tight: true }, content: [
          { type: 'list_item', content: [paragraph(), paragraph(literal('Nested')), paragraph()] },
          { type: 'list_item', content: [paragraph(literal('Nested sibling'))] },
        ] },
        paragraph(), paragraph(literal('First end')), paragraph(),
      ] },
      { type: 'list_item', content: [paragraph(), paragraph(literal('Second')), paragraph()] },
    ] },
    paragraph(),
    { type: 'bullet_list', content: [
      { type: 'list_item', content: [paragraph(literal('Independent'))] },
    ] },
    paragraph({ type: 'object_link', attrs: { objectId: targetId, label: 'Person' } }),
    paragraph(),
  );
  const current = insert(db, sourceId, writing, 2, { [propertyId]: targetId }, 'Edited');
  const original = { ...current, title: 'Created', revision: 1 };
  db.query('INSERT INTO object_revisions VALUES (?, 1, ?, ?)').run(sourceId, JSON.stringify(original), timestamp);
  db.query('INSERT INTO object_create_requests VALUES (?, ?, ?)').run(requestId, 'legacy-digest', sourceId);
  const runtime = new ObjectRuntime(db);
  const converted = runtime.getObject(sourceId);
  assert.ok(converted.body.startsWith('\n\n***Before***\n\n\n\n\n\n'));
  assert.ok(converted.body.endsWith(`[Person](/objects/${targetId})\n\n`));
  assert.match(converted.body, /> \n> \n> Quoted\n> \n> \n> \n> Quote end\n> \n> /);
  const html = Bun.markdown.html(converted.body, { noHtmlBlocks: true, noHtmlSpans: true });
  assert.match(html, /<strong><em>Before<\/em><\/strong>|<em><strong>Before<\/strong><\/em>/);
  assert.match(html, /<blockquote>\s*<p>Quoted<\/p>\s*<p>Quote end<\/p>\s*<\/blockquote>/);
  assert.match(html, /<li>\s*<p><(?:strong|em)>[\s\S]*?First[\s\S]*?<ul>\s*<li>\s*<p>Nested<\/p>\s*<\/li>\s*<li>\s*<p>Nested sibling<\/p>\s*<\/li>\s*<\/ul>\s*<p>First end<\/p>\s*<\/li>\s*<li>\s*<p>Second<\/p>\s*<\/li>\s*<\/ul>/);
  assert.match(html, /<\/ul>\s*<ul>\s*<li>Independent<\/li>\s*<\/ul>/);
  assert.equal(markdownText(converted.body).replace(/\s+/g, ' ').trim(), 'Before Quoted Quote end First Nested Nested sibling First end Second Independent Person');
  assert.deepEqual(markdownReferences(converted.body), [targetId]);
  assert.deepEqual(runtime.backlinks(targetId).map(link => link.object.id), [sourceId]);
  const { document: _currentDocument, ...metadata } = current;
  assert.deepEqual(converted, { ...metadata, body: converted.body });
  const { document: _originalDocument, ...originalMetadata } = original;
  const history = db.query<{ snapshot_json: string; recorded_at: string }, []>('SELECT snapshot_json, recorded_at FROM object_revisions').get()!;
  assert.deepEqual(JSON.parse(history.snapshot_json), { ...originalMetadata, body: converted.body });
  assert.equal(history.recorded_at, timestamp);
  assert.deepEqual(runtime.createObject({ ...originalMetadata, body: converted.body }, requestId), converted);
  assert.throws(() => runtime.createObject({ ...originalMetadata, body: converted.body.trim() }, requestId), /different content/);
  assert.deepEqual(new ObjectRuntime(db).getObject(sourceId), converted);
  assert.deepEqual(db.query('SELECT snapshot_json, recorded_at FROM object_revisions').get(), history);
  assert.equal(runtime.getObject(targetId).body, '\n\n');
});

test('ending and consecutive hard breaks retain newlines outside nested marks in current and historical writing', t => {
  const db = fixture(t);
  insert(db, targetId, document(paragraph()));
  const marks = [{ type: 'strong' }, { type: 'em' }];
  const markedBreak = { type: 'hard_break', marks };
  const writing = document(
    paragraph(literal('One', marks), markedBreak, literal('Two', marks), markedBreak, markedBreak, literal('Three', marks), markedBreak),
    { type: 'blockquote', content: [
      paragraph(literal('Quote'), { type: 'hard_break' }, { type: 'hard_break' }),
    ] },
    { type: 'bullet_list', attrs: { tight: true }, content: [
      { type: 'list_item', content: [
        paragraph({ type: 'hard_break' }, { type: 'hard_break' }, literal('List'), { type: 'hard_break' }, { type: 'hard_break' }),
      ] },
      { type: 'list_item', content: [paragraph(literal('Sibling'), { type: 'hard_break' })] },
    ] },
    paragraph(
      literal('Linked', [{ type: 'link', attrs: { href: `/objects/${targetId}` } }, ...marks]),
      { type: 'hard_break', marks: [{ type: 'link', attrs: { href: `/objects/${targetId}` } }, ...marks] },
    ),
  );
  const current = insert(db, sourceId, writing, 2);
  const original = { ...current, revision: 1, title: 'Original breaks' };
  db.query('INSERT INTO object_revisions VALUES (?, 1, ?, ?)').run(sourceId, JSON.stringify(original), timestamp);
  db.query('INSERT INTO object_create_requests VALUES (?, ?, ?)').run(requestId, 'legacy-digest', sourceId);
  const runtime = new ObjectRuntime(db);
  const converted = runtime.getObject(sourceId);
  assert.ok(converted.body.startsWith('***One***  \n***Two***  \n  \n***Three***  \n\n\n'));
  assert.ok(converted.body.endsWith(`[***Linked***](</objects/${targetId}>)  \n`));
  assert.match(converted.body, /> Quote  \n>   \n> /);
  assert.match(converted.body, /  \n  \n- List  \n    \n  \n- Sibling  \n/);
  const html = Bun.markdown.html(converted.body, { noHtmlBlocks: true, noHtmlSpans: true });
  assert.match(html, /One<\/(?:em|strong)><\/(?:em|strong)><br\s*\/?>\n<(?:em|strong)><(?:em|strong)>Two/);
  assert.doesNotMatch(html, /\\|\*\*/);
  assert.match(html, /<li>\s*<p>List<\/p>\s*<\/li>\s*<li>\s*<p>Sibling<\/p>\s*<\/li>/);
  assert.equal(markdownText(converted.body).replace(/\s+/g, ' ').trim(), 'One Two Three Quote List Sibling Linked');
  assert.deepEqual(markdownReferences(converted.body), [targetId]);
  const { document: _document, ...metadata } = original;
  const history = db.query<{ snapshot_json: string }, []>('SELECT snapshot_json FROM object_revisions').get()!;
  assert.deepEqual(JSON.parse(history.snapshot_json), { ...metadata, body: converted.body });
  assert.deepEqual(runtime.createObject({ ...metadata, body: converted.body }, requestId), converted);
});

test('upgraded creation receipts and historical source persist across reopening', t => {
  const directory = mkdtempSync(join(tmpdir(), 'object-upgrade-'));
  let db = openDatabase(join(directory, 'workspace.sqlite'));
  t.after(() => { db.close(); rmSync(directory, { recursive: true, force: true }); });
  legacyDatabase(db);
  const original = insert(db, sourceId, document(paragraph(), paragraph(literal('Created source'), { type: 'hard_break' }), paragraph()));
  db.query('INSERT INTO object_create_requests VALUES (?, ?, ?)').run(requestId, 'legacy-digest', sourceId);
  let runtime = new ObjectRuntime(db);
  const upgraded = runtime.getObject(sourceId);
  assert.equal(upgraded.body, '\n\nCreated source  \n\n\n');
  const edited = runtime.updateObject(sourceId, 1, { ...upgraded, body: '  # Raw source\r\n\nKeep  spaces\n' });
  db.close();
  db = openDatabase(join(directory, 'workspace.sqlite'));
  runtime = new ObjectRuntime(db);
  assert.deepEqual(runtime.getObject(sourceId), edited);
  assert.deepEqual(runtime.createObject({ typeId: original.typeId, title: original.title, properties: original.properties, body: upgraded.body }, requestId), edited);
  const history = db.query<{ snapshot_json: string }, []>('SELECT snapshot_json FROM object_revisions').get()!;
  assert.equal(JSON.parse(history.snapshot_json).body, upgraded.body);
});

test('an unknown historical node rolls back every schema and content change', t => {
  const db = fixture(t);
  const original = insert(db, sourceId, document(paragraph(), paragraph(literal('Preserve this source'), { type: 'hard_break' }), paragraph()), 2);
  db.query('INSERT INTO object_revisions VALUES (?, 1, ?, ?)').run(sourceId, JSON.stringify({ ...original, revision: 1, document: document({ type: 'unknown_widget', content: [literal('Do not drop')] }) }), timestamp);
  db.query('INSERT INTO object_create_requests VALUES (?, ?, ?)').run(requestId, 'original-receipt', sourceId);
  const tables = ['objects', 'object_revisions', 'object_create_requests', 'object_metadata', 'object_references', 'visitor_state', 'saved_views'];
  const before = tables.map(table => db.query(`SELECT * FROM ${table}`).all());
  const schema = db.query('SELECT type, name, sql FROM sqlite_master ORDER BY type, name').all();
  assert.throws(() => new ObjectRuntime(db), /unknown node unknown_widget/);
  assert.deepEqual(tables.map(table => db.query(`SELECT * FROM ${table}`).all()), before);
  assert.deepEqual(db.query('SELECT type, name, sql FROM sqlite_master ORDER BY type, name').all(), schema);
});

test('unknown marks, malformed lists, missing creation history and oversized conversions cannot be partially upgraded', t => {
  for (const writing of [
    document(paragraph(literal('Important', [{ type: 'unknown_style' }]))),
    document({ type: 'bullet_list', content: [paragraph(literal('Not an item'))] }),
    document(paragraph({ type: 'hard_break', marks: [{ type: 'code' }] })),
    document(paragraph({ type: 'hard_break', marks: [{ type: 'link', attrs: { href: `/objects/${targetId}` } }] })),
    document(paragraph(literal('unrepresentable\ncode', [{ type: 'code' }]))),
    document(paragraph(literal('é'.repeat(140_000)))),
  ]) {
    const db = fixture(t);
    insert(db, sourceId, writing);
    assert.throws(() => new ObjectRuntime(db));
    assert.equal(db.query<{ value: string }, []>("SELECT value FROM object_metadata WHERE key = 'schema_version'").get()!.value, '1');
    assert.deepEqual(JSON.parse(db.query<{ document_json: string }, []>('SELECT document_json FROM objects').get()!.document_json), writing);
  }
  const db = fixture(t);
  insert(db, sourceId, document(paragraph(literal('Edited'))), 2);
  db.query('INSERT INTO object_create_requests VALUES (?, ?, ?)').run(requestId, 'original-receipt', sourceId);
  assert.throws(() => new ObjectRuntime(db), /missing its original revision/);
  assert.equal(db.query<{ fingerprint: string }, []>('SELECT fingerprint FROM object_create_requests').get()!.fingerprint, 'original-receipt');
});
