import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase } from '../src/database.js';
import { ObjectRuntime } from '../src/objects/runtime.js';
import { PAGE_TYPE_ID } from '../src/objects/model.js';

test('SQLite backup restores fixed-domain objects, history and writing backlinks', () => {
  const dir = mkdtempSync(join(tmpdir(), 'taskdesk-backup-test-'));
  try {
    const sourcePath = join(dir, 'source.sqlite');
    const backupPath = join(dir, 'backup.sqlite');
    const source = openDatabase(sourcePath);
    const runtime = new ObjectRuntime(source);
    const target = runtime.createObject({ typeId: PAGE_TYPE_ID, title: 'Target', properties: {}, body: '' });
    const sourceObject = runtime.createObject({ typeId: PAGE_TYPE_ID, title: 'Source', properties: {}, body: `[Target](/objects/${target.id})` });
    runtime.updateObject(sourceObject.id, sourceObject.revision, { ...sourceObject, title: 'Source updated' });
    source.exec(`VACUUM INTO '${backupPath.replaceAll("'", "''")}'`);
    source.close();

    const restored = openDatabase(backupPath);
    const restoredRuntime = new ObjectRuntime(restored);
    assert.equal(restoredRuntime.getObject(target.id).title, 'Target');
    assert.equal(restoredRuntime.backlinks(target.id).links[0]?.object.id, sourceObject.id);
    assert.equal(restoredRuntime.listObjectHistory(sourceObject.id).revisions.length, 1);
    restored.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
