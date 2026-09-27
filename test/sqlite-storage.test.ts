import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { Database } from 'bun:sqlite';
import { buildSyntheticFixture, syntheticWriting } from '../scripts/sqlite-fixture.js';
import { ObjectRuntime } from '../src/objects/runtime.js';
import { collectSyntheticStorageReport, parseArgs } from '../scripts/sqlite-storage.js';

function count(db: Database, table: string): number {
  return db.query<{ count: number }, []>(`SELECT COUNT(*) AS count FROM ${table}`).get()!.count;
}

test('synthetic writing produces exact UTF-8 byte lengths without splitting characters', () => {
  const unicodeBoundary = Buffer.byteLength('# Synthetic note 0\n\nRevision 0. Caf', 'utf8') + 1;
  for (const bytes of [0, 1, 2, 3, 4, 5, unicodeBoundary, unicodeBoundary + 1, 64, 96, 256, 1024, 262_144]) {
    const writing = syntheticWriting(0, bytes);
    assert.equal(Buffer.byteLength(writing, 'utf8'), bytes);
    assert.equal(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.from(writing, 'utf8')), writing);
  }
  assert.equal(syntheticWriting(0, 64).includes('�'), false);
});

test('synthetic fixture creates bounded canonical objects, references, history, and exact writing', () => {
  const fixture = buildSyntheticFixture({ objects: 8, bodyBytes: 96, revisions: 2, referenceEvery: 3 });
  try {
    assert.equal(fixture.ids.length, 8);
    assert.equal(count(fixture.db, 'objects'), 8);
    assert.equal(count(fixture.db, 'object_revisions'), 16);
    assert.ok(count(fixture.db, 'object_references') >= 1);
    const first = fixture.runtime.getObject(fixture.ids[0]!);
    assert.equal(first.body, syntheticWriting(0, 96 + (2 % 3) * 17, 2));
    assert.equal(Buffer.byteLength(first.body, 'utf8'), 96 + (2 % 3) * 17);
    assert.equal(first.revision, 3);
    const secondSnapshot = fixture.runtime.getObjectRevision(first.id, 2);
    assert.equal(secondSnapshot.body, syntheticWriting(0, 96 + (1 % 3) * 17, 1));
    assert.equal(Buffer.byteLength(secondSnapshot.body, 'utf8'), 96 + (1 % 3) * 17);
  } finally {
    const directory = fixture.directory;
    fixture.cleanup();
    assert.equal(existsSync(directory), false);
  }
});

test('synthetic fixture validates limits before opening a database', () => {
  assert.throws(() => buildSyntheticFixture({ objects: 0 }), /objects must be/);
  assert.throws(() => buildSyntheticFixture({ objects: 10_001 }), /objects must be/);
  assert.throws(() => buildSyntheticFixture({ bodyBytes: 16_385 }), /bodyBytes must be/);
  assert.throws(() => buildSyntheticFixture({ revisions: 11 }), /revisions must be/);
  assert.throws(() => parseArgs(['--database=/tmp/live.sqlite']), /existing database paths are not accepted/);
  assert.throws(() => parseArgs(['--objects=6=bad']), /Unknown or incomplete flag/);
});

test('synthetic fixture cleans its owned temp database if generation fails', () => {
  const original = ObjectRuntime.prototype.createObject;
  let failedDirectory: string | undefined;
  let failedDb: Database | undefined;
  ObjectRuntime.prototype.createObject = function failCreateObject(...args: Parameters<ObjectRuntime['createObject']>) {
    if (args[0]?.title === 'Synthetic object 00000') {
      failedDb = this.db;
      const main = this.db.query<{ file: string }, []>('PRAGMA database_list').all().find(row => row.file.endsWith('workspace.sqlite'));
      assert.ok(main);
      failedDirectory = dirname(main.file);
      throw new Error('forced fixture failure');
    }
    return original.apply(this, args);
  };
  try {
    assert.throws(() => buildSyntheticFixture({ objects: 1 }), /forced fixture failure/);
  } finally {
    ObjectRuntime.prototype.createObject = original;
  }
  assert.ok(failedDirectory);
  assert.equal(existsSync(failedDirectory), false);
  assert.ok(failedDb);
  assert.throws(() => failedDb!.query('SELECT 1').get(), /closed/i);
});

test('storage report exposes nonnegative dbstat, page, and file measurements without user database paths', () => {
  const directory = mkdtempSync(join(tmpdir(), 'taskdesk-sqlite-storage-env-'));
  const sentinel = join(directory, 'sentinel.sqlite');
  const previousDatabasePath = process.env.DATABASE_PATH;
  process.env.DATABASE_PATH = sentinel;
  try {
    const { fixture, checkpoint } = parseArgs(['--objects=12', '--body-bytes=128', '--revisions=1', '--reference-every=4']);
    assert.equal(checkpoint, false);
    const report = collectSyntheticStorageReport(fixture, checkpoint);
    assert.deepEqual(report.fixture, fixture);
    assert.ok(report.engine.bunVersion);
    assert.ok(report.engine.sqliteVersion);
    assert.ok(report.page.pageSize > 0);
    assert.ok(report.page.pageCount > 0);
    assert.ok(report.page.freelistCount >= 0);
    assert.ok(report.page.allocatedBytes >= report.page.dbstatBytes);
    assert.ok(report.page.allocatedBytes - report.page.dbstatBytes <= report.page.pageSize * (report.page.freelistCount + 8));
    assert.ok(report.files.databaseBytes >= 0);
    assert.ok(report.files.walBytes >= 0);
    assert.ok(report.files.shmBytes >= 0);
    assert.ok(report.dbstat.some(row => row.name === 'objects' && row.bytes > 0 && row.pages > 0));
    assert.ok(report.dbstat.every(row => row.bytes >= 0 && row.pages >= 0));
    assert.equal(existsSync(sentinel), false);
  } finally {
    if (previousDatabasePath === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = previousDatabasePath;
    rmSync(directory, { recursive: true, force: true });
  }
});

test('sqlite:storage command prints JSON and rejects caller-selected database paths', async () => {
  const success = Bun.spawn([process.execPath, 'run', 'sqlite:storage', '--', '--objects=6', '--body-bytes=64', '--revisions=0'], { stdout: 'pipe', stderr: 'pipe' });
  assert.equal(await success.exited, 0, await new Response(success.stderr).text());
  const output = JSON.parse(await new Response(success.stdout).text()) as { fixture: { objects: number }; dbstat: unknown[] };
  assert.equal(output.fixture.objects, 6);
  assert.ok(Array.isArray(output.dbstat));

  const failure = Bun.spawn([process.execPath, 'run', 'sqlite:storage', '--', '--db=/tmp/nope.sqlite'], { stdout: 'pipe', stderr: 'pipe' });
  assert.notEqual(await failure.exited, 0);
  assert.match(await new Response(failure.stderr).text(), /existing database paths are not accepted/);

  const garbage = Bun.spawn([process.execPath, 'run', 'sqlite:storage', '--', '--objects=6=bad'], { stdout: 'pipe', stderr: 'pipe' });
  assert.notEqual(await garbage.exited, 0);
  assert.match(await new Response(garbage.stderr).text(), /Unknown or incomplete flag/);
});
