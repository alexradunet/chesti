import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Database } from 'bun:sqlite';
import { existsSync, mkdtempSync, rmSync, statSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openDatabase } from '../src/database.js';
import { ObjectRuntime } from '../src/objects/runtime.js';
import { ViewService } from '../src/objects/views.js';
import { ViewConversationService } from '../src/objects/conversations.js';
import { VisitorStore } from '../src/visitors.js';
import { PAGE_TYPE_ID } from '../src/objects/model.js';
import type { GeneratedView, ObjectRecord, ViewSpec } from '../src/objects/model.js';

function integrity(db: Database): void {
  assert.equal(db.query<{ integrity_check: string }, []>('PRAGMA integrity_check').get()!.integrity_check, 'ok');
  assert.deepEqual(db.query<{ table: string; rowid: number; parent: string; fkid: number }, []>('PRAGMA foreign_key_check').all(), []);
}

function ids(records: ObjectRecord[]): string[] {
  return records.map(record => record.id).sort();
}

test('VACUUM INTO snapshot restores committed object, view, visitor, conversation, receipt, and WAL state', () => {
  const directory = mkdtempSync(join(tmpdir(), 'taskdesk-backup-'));
  const sourceFile = join(directory, 'source.sqlite');
  const snapshotFile = join(directory, 'snapshot.sqlite');
  const existingFile = join(directory, 'existing.sqlite');
  let source: Database | undefined;
  let readOnly: Database | undefined;
  let restored: Database | undefined;
  try {
    source = openDatabase(sourceFile);
    source.exec('PRAGMA wal_autocheckpoint = 0');
    const runtime = new ObjectRuntime(source);
    const views = new ViewService(runtime);
    const conversations = new ViewConversationService(source, views);
    const visitors = new VisitorStore(source);

    let project = runtime.createType('Project');
    project = runtime.addProperty(project.id, project.revision, { label: 'Related page', kind: 'reference', targetTypeId: PAGE_TYPE_ID });
    const referenceProperty = project.propertyIds[0]!;
    const target = runtime.createObject({ typeId: PAGE_TYPE_ID, title: 'Target α', properties: {}, body: 'Linked target.' });
    const requestId = crypto.randomUUID();
    const originalBody = '# Snapshot body\r\n\r\nUnicode café ☕ and [target](/objects/' + target.id.toUpperCase() + ').\r\n';
    const created = runtime.createObject({ typeId: project.id, title: 'Original title', properties: { [referenceProperty]: target.id }, body: originalBody }, requestId);
    const edited = runtime.updateObject(created.id, created.revision, { ...created, title: 'Edited title', body: originalBody + '\r\nSecond paragraph.' });
    const trashed = runtime.setTrashed(target.id, target.revision, true);
    const replayBeforeSnapshot = runtime.createObject({ typeId: project.id, title: 'Original title', properties: { [referenceProperty]: target.id }, body: originalBody }, requestId);
    assert.equal(replayBeforeSnapshot.id, edited.id);

    const spec: ViewSpec = { title: 'Projects', blocks: [{ title: 'Project list', component: 'list', sources: [{ typeId: project.id, bindings: {} }] }] };
    const draft = views.create({ spec, model: 'fixture/model' }, 'List projects');
    const published = views.publish(draft.id, draft.revision);
    const visitor = visitors.create();
    const generated: GeneratedView = { model: 'fixture/model', spec: { title: 'Pages', blocks: [{ title: 'Pages', component: 'list', sources: [{ typeId: PAGE_TYPE_ID, bindings: {} }] }] } };
    const saved = conversations.save(visitor.id, 'Remember pages', generated, {});

    const expectedObjects = ids(runtime.listObjects().concat(runtime.listObjects({ trashed: true })));
    const expectedReferences = source.query('SELECT source_id, target_id, property_id FROM object_references ORDER BY source_id, target_id, property_id').all();
    const expectedHistory = source.query('SELECT object_id, revision, snapshot_json FROM object_revisions ORDER BY object_id, revision').all();
    const expectedViewHistory = source.query('SELECT id, revision, status, deleted FROM object_view_revisions ORDER BY id, revision').all();
    assert.ok(existsSync(`${sourceFile}-wal`));
    assert.ok(statSync(`${sourceFile}-wal`).size > 32, 'setup should leave committed changes beyond the WAL header');

    writeFileSync(existingFile, 'do not overwrite');
    assert.throws(() => source!.query('VACUUM INTO ?').run(existingFile));
    assert.equal(readFileSync(existingFile, 'utf8'), 'do not overwrite');
    integrity(source);

    source.query('VACUUM INTO ?').run(snapshotFile);
    assert.ok(existsSync(snapshotFile));
    assert.ok(statSync(snapshotFile).size > 0);

    const afterSnapshot = runtime.createObject({ typeId: PAGE_TYPE_ID, title: 'After snapshot', properties: {}, body: 'This must not appear in the snapshot.' });
    const afterEdit = runtime.updateObject(edited.id, edited.revision, { ...edited, title: 'Source-only edit' });
    assert.equal(runtime.getObject(edited.id).title, 'Source-only edit');

    readOnly = new Database(snapshotFile, { readonly: true, strict: true });
    readOnly.exec('PRAGMA foreign_keys = ON');
    integrity(readOnly);
    assert.deepEqual(readOnly.query('SELECT id FROM objects ORDER BY id').all(), source.query('SELECT id FROM objects WHERE id != ? ORDER BY id').all(afterSnapshot.id));
    assert.throws(
      () => readOnly!.query('INSERT INTO object_metadata(key, value) VALUES (?, ?)').run('readonly', 'true'),
      error => error instanceof Error && 'code' in error && error.code === 'SQLITE_READONLY',
    );
    readOnly.close();
    readOnly = undefined;

    restored = openDatabase(snapshotFile);
    const restoredRuntime = new ObjectRuntime(restored);
    const restoredViews = new ViewService(restoredRuntime);
    const restoredConversations = new ViewConversationService(restored, restoredViews);
    const restoredVisitors = new VisitorStore(restored);
    integrity(restored);
    assert.deepEqual(ids(restoredRuntime.listObjects().concat(restoredRuntime.listObjects({ trashed: true }))), expectedObjects);
    assert.equal(restoredRuntime.getObject(edited.id).title, 'Edited title');
    assert.equal(restoredRuntime.getObject(edited.id).body, edited.body);
    assert.deepEqual(restoredRuntime.getObject(edited.id).properties, edited.properties);
    assert.deepEqual(restoredRuntime.getObject(trashed.id), trashed);
    assert.equal(restoredRuntime.listObjects().some(object => object.id === afterSnapshot.id), false);
    assert.equal(restoredRuntime.getObjectRevision(created.id, created.revision).body, originalBody);
    assert.deepEqual(restored.query('SELECT source_id, target_id, property_id FROM object_references ORDER BY source_id, target_id, property_id').all(), expectedReferences);
    assert.deepEqual(restored.query('SELECT object_id, revision, snapshot_json FROM object_revisions ORDER BY object_id, revision').all(), expectedHistory);
    assert.deepEqual(restored.query('SELECT id, revision, status, deleted FROM object_view_revisions ORDER BY id, revision').all(), expectedViewHistory);
    assert.deepEqual(restoredViews.get(published.id), published);
    assert.deepEqual(restoredViews.evaluate(published.id).blocks[0]!.rows.map(row => row.object.id), [edited.id]);
    assert.deepEqual(restoredVisitors.get(visitor.id), visitor);
    assert.deepEqual(restoredConversations.get(visitor.id, saved.conversation.id), saved.conversation);
    assert.deepEqual(restoredRuntime.createObject({ typeId: project.id, title: 'Original title', properties: { [referenceProperty]: target.id }, body: originalBody }, requestId), edited);
    assert.throws(() => restoredRuntime.createObject({ typeId: project.id, title: 'Different receipt use', properties: { [referenceProperty]: target.id }, body: originalBody }, requestId), /different content/);

    assert.equal(runtime.getObject(edited.id).title, 'Source-only edit');
    assert.deepEqual(runtime.createObject({ typeId: project.id, title: 'Original title', properties: { [referenceProperty]: target.id }, body: originalBody }, requestId), afterEdit);
    integrity(source);
  } finally {
    if (readOnly) readOnly.close();
    if (restored) restored.close();
    if (source) source.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
