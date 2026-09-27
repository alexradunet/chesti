import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildSyntheticFixture } from '../scripts/sqlite-fixture.js';
import { collectBenchmarkReport, parseArgs, propertyIndexScenario, referenceScenario, searchScenario } from '../scripts/sqlite-bench.js';
import { PAGE_TYPE_ID } from '../src/objects/model.js';

test('sqlite benchmark CLI parsing is bounded and rejects database paths', () => {
  assert.deepEqual(parseArgs(['--objects=12', '--large-objects=20', '--body-bytes=64', '--revisions=0', '--reference-every=2', '--repetitions=1', '--warmups=0']), {
    objects: 12,
    largeObjects: 20,
    bodyBytes: 64,
    revisions: 0,
    referenceEvery: 2,
    repetitions: 1,
    warmups: 0,
  });
  assert.throws(() => parseArgs(['--objects=10001']), /objects must be/);
  assert.throws(() => parseArgs(['--db=/tmp/live.sqlite']), /temporary synthetic databases/);
  assert.throws(() => parseArgs(['--objects=6=bad']), /Unknown or incomplete flag/);
});

test('property index benchmark keeps result identity and order equal to view evaluation', () => {
  const fixture = buildSyntheticFixture({ objects: 36, bodyBytes: 48, revisions: 0, referenceEvery: 2 });
  try {
    const result = propertyIndexScenario(fixture, 0, 1);
    assert.equal(result.equivalent, true);
    assert.ok(result.baseline.ids.length > 0);
    assert.deepEqual(result.baseline.ids, result.candidate.ids);
    assert.ok((result.storage.databaseBytesAfter ?? 0) >= (result.storage.databaseBytesBefore ?? 0));
    assert.ok((result.write.insertAfterIndexMs ?? -1) >= 0);
  } finally {
    fixture.cleanup();
  }
});

test('reference benchmark excludes writing edges and matches multiple-reference contains semantics', () => {
  const fixture = buildSyntheticFixture({ objects: 48, bodyBytes: 96, revisions: 0, referenceEvery: 2 });
  try {
    const target = fixture.db.query<{ target_id: string }, [string]>('SELECT target_id FROM object_references WHERE property_id = ? LIMIT 1').get(fixture.multiReferencePropertyId)!.target_id;
    const unrelated = fixture.runtime.getObject(fixture.ids.find(id => fixture.runtime.getObject(id).typeId === PAGE_TYPE_ID && id !== target)!);
    fixture.runtime.updateObject(unrelated.id, unrelated.revision, { typeId: unrelated.typeId, title: unrelated.title, properties: unrelated.properties, body: `${unrelated.body}\n\n[writing only](/objects/${target.toUpperCase()})` });
    const result = referenceScenario(fixture, 0, 1);
    assert.equal(result.equivalent, true);
    assert.deepEqual(result.baseline.ids, result.candidate.ids);
    assert.equal(result.candidate.ids.includes(unrelated.id), false);
    assert.ok((result.storage.candidateIndexBytes ?? 0) > 0);
  } finally {
    fixture.cleanup();
  }
});

test('search benchmark keeps literal LIKE as authority and synchronizes fixture updates', () => {
  const fixture = buildSyntheticFixture({ objects: 24, bodyBytes: 80, revisions: 0, referenceEvery: 2 });
  try {
    const result = searchScenario(fixture, 0, 1);
    assert.equal(result.equivalent, true);
    assert.deepEqual(result.baseline.ids, result.candidate.ids);
    assert.equal(result.metadata.mutationSynchronized, true);
    assert.ok((result.storage.ftsBytes ?? 0) > 0);
  } finally {
    fixture.cleanup();
  }
});

test('benchmark report uses only owned temp fixtures and does not read DATABASE_PATH', () => {
  const directory = mkdtempSync(join(tmpdir(), 'taskdesk-sqlite-bench-env-'));
  const sentinel = join(directory, 'sentinel.sqlite');
  const previousDatabasePath = process.env.DATABASE_PATH;
  process.env.DATABASE_PATH = sentinel;
  try {
    const report = collectBenchmarkReport({ objects: 24, largeObjects: 30, bodyBytes: 48, revisions: 0, referenceEvery: 2, repetitions: 1, warmups: 0 });
    assert.equal(report.scales.length, 2);
    assert.equal(report.scales[0]!.scenarios.every(scenario => scenario.equivalent), true);
    assert.equal(existsSync(sentinel), false);
  } finally {
    if (previousDatabasePath === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = previousDatabasePath;
    rmSync(directory, { recursive: true, force: true });
  }
});

test('sqlite:bench command prints JSON and rejects caller-selected database paths', async () => {
  const success = Bun.spawn([process.execPath, 'run', 'sqlite:bench', '--', '--objects=18', '--large-objects=20', '--body-bytes=32', '--revisions=0', '--reference-every=2', '--repetitions=1', '--warmups=0'], { stdout: 'pipe', stderr: 'pipe' });
  assert.equal(await success.exited, 0, await new Response(success.stderr).text());
  const output = JSON.parse(await new Response(success.stdout).text()) as { scales: unknown[] };
  assert.equal(output.scales.length, 2);

  const failure = Bun.spawn([process.execPath, 'run', 'sqlite:bench', '--', '--database=/tmp/nope.sqlite'], { stdout: 'pipe', stderr: 'pipe' });
  assert.notEqual(await failure.exited, 0);
  assert.match(await new Response(failure.stderr).text(), /temporary synthetic databases/);
});
