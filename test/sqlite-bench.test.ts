import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Database } from 'bun:sqlite';
import { dirname } from 'node:path';
import { buildSyntheticFixture, normalizeSyntheticFixtureOptions } from '../scripts/sqlite-fixture.js';
import { assertSameIds, collectBenchmarkReport, collectOne, parseArgs, propertyIndexScenario, referenceScenario, searchCases, searchScenario } from '../scripts/sqlite-bench.js';
import { PAGE_TYPE_ID } from '../src/objects/model.js';
import { ObjectRuntime } from '../src/objects/runtime.js';

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

test('semantic mismatches fail visibly instead of producing comparable timing claims', () => {
  assert.throws(() => assertSameIds('forced mismatch', ['a', 'b'], ['a', 'c']), /semantic mismatch/);
});

test('property index benchmark compares one state to view evaluation and reports repeated writes', () => {
  const fixture = buildSyntheticFixture({ objects: 36, bodyBytes: 48, revisions: 0, referenceEvery: 2, benchmarkProperties: true });
  try {
    const result = propertyIndexScenario(fixture, 0, 1);
    assert.equal(result.equivalent, true);
    assert.ok(result.baseline.ids.length > 0);
    assert.deepEqual(result.baseline.ids, result.candidate.ids);
    assert.match(String(result.metadata.projection), /ViewService/);
    assert.match(String(result.metadata.readIndexDdl), new RegExp(String(result.metadata.propertyId)));
    assert.match(String(result.metadata.writeIndexDdl), new RegExp(String(result.metadata.writeFixturePropertyId)));
    assert.doesNotMatch(String(result.metadata.writeIndexDdl), new RegExp(String(result.metadata.propertyId)));
    assert.equal(result.write.insertBaselineSamples, 1);
    assert.equal(result.write.insertCandidateSamples, 1);
    assert.equal(result.write.updateBaselineSamples, 1);
    assert.equal(result.write.updateCandidateSamples, 1);
  } finally {
    fixture.cleanup();
  }
});

test('reference benchmark excludes writing edges and reports existing-index and composite paths', () => {
  const fixture = buildSyntheticFixture({ objects: 48, bodyBytes: 96, revisions: 0, referenceEvery: 2, benchmarkProperties: true });
  try {
    const target = fixture.db.query<{ target_id: string }, [string]>('SELECT target_id FROM object_references WHERE property_id = ? LIMIT 1').get(fixture.multiReferencePropertyId)!.target_id;
    const unrelated = fixture.runtime.getObject(fixture.ids.find(id => fixture.runtime.getObject(id).typeId === PAGE_TYPE_ID && id !== target)!);
    fixture.runtime.updateObject(unrelated.id, unrelated.revision, { typeId: unrelated.typeId, title: unrelated.title, properties: unrelated.properties, body: `${unrelated.body}\n\n[writing only](/objects/${target.toUpperCase()})` });
    const result = referenceScenario(fixture, 0, 1);
    assert.equal(result.equivalent, true);
    assert.deepEqual(result.baseline.ids, result.candidate.ids);
    assert.equal(result.candidate.ids.includes(unrelated.id), false);
    assert.equal((result.metadata.existingIndexRequiresExtraSchema), false);
    assert.ok((result.storage.candidateIndexBytes ?? 0) > 0);
    assert.equal(result.write.insertBaselineSamples, 1);
    assert.equal(result.write.insertCandidateSamples, 1);
  } finally {
    fixture.cleanup();
  }
});

test('reference scenario fails visibly when derived edge state diverges from JSON authority', () => {
  const fixture = buildSyntheticFixture({ objects: 48, bodyBytes: 16, revisions: 0, referenceEvery: 1, benchmarkProperties: true });
  try {
    const edge = fixture.db.query<{ source_id: string; target_id: string }, [string]>('SELECT source_id, target_id FROM object_references WHERE property_id = ? LIMIT 1').get(fixture.multiReferencePropertyId)!;
    fixture.db.query('DELETE FROM object_references WHERE source_id = ? AND target_id = ? AND property_id = ?').run(edge.source_id, edge.target_id, fixture.multiReferencePropertyId);
    assert.throws(() => referenceScenario(fixture, 0, 1), /semantic mismatch/);
  } finally {
    fixture.cleanup();
  }
});

test('reference semantics cover uppercase values, missing/empty arrays, trashed source and retained target', () => {
  const fixture = buildSyntheticFixture({ objects: 140, bodyBytes: 16, revisions: 0, referenceEvery: 1, benchmarkProperties: true });
  try {
    const target = fixture.db.query<{ target_id: string }, [string]>('SELECT target_id FROM object_references WHERE property_id = ? GROUP BY target_id ORDER BY COUNT(*) DESC LIMIT 1').get(fixture.multiReferencePropertyId)!.target_id;
    const source = fixture.runtime.createObject({ typeId: PAGE_TYPE_ID, title: 'uppercase stored reference', properties: { [fixture.scheduledPropertyId]: '2026-11-20', [fixture.multiReferencePropertyId]: [target.toUpperCase()] }, body: '' });
    const empty = fixture.runtime.createObject({ typeId: PAGE_TYPE_ID, title: 'empty array reference', properties: { [fixture.scheduledPropertyId]: '2026-11-20', [fixture.multiReferencePropertyId]: [] }, body: '' });
    const missing = fixture.runtime.createObject({ typeId: PAGE_TYPE_ID, title: 'missing reference', properties: { [fixture.scheduledPropertyId]: '2026-11-20' }, body: '' });
    const twoProperties = fixture.runtime.createObject({ typeId: PAGE_TYPE_ID, title: 'aaa two properties same target', properties: { [fixture.scheduledPropertyId]: '2026-11-20', [fixture.referencePropertyId]: target, [fixture.multiReferencePropertyId]: [target] }, body: '' });
    const replacementTarget = fixture.ids.find(id => fixture.runtime.getObject(id).typeId === PAGE_TYPE_ID && id !== target)!;
    const replaceSource = fixture.runtime.createObject({ typeId: PAGE_TYPE_ID, title: 'replace reference source', properties: { [fixture.scheduledPropertyId]: '2026-11-20', [fixture.multiReferencePropertyId]: [target] }, body: '' });
    const replaced = fixture.runtime.updateObject(replaceSource.id, replaceSource.revision, { typeId: replaceSource.typeId, title: replaceSource.title, properties: { ...replaceSource.properties, [fixture.multiReferencePropertyId]: [replacementTarget] }, body: replaceSource.body });
    assert.equal(fixture.db.query<{ count: number }, [string, string, string]>('SELECT COUNT(*) AS count FROM object_references WHERE source_id = ? AND property_id = ? AND target_id = ?').get(replaced.id, fixture.multiReferencePropertyId, target)!.count, 0);
    assert.equal(fixture.db.query<{ count: number }, [string, string, string]>('SELECT COUNT(*) AS count FROM object_references WHERE source_id = ? AND property_id = ? AND target_id = ?').get(replaced.id, fixture.multiReferencePropertyId, replacementTarget)!.count, 1);
    const trashed = fixture.runtime.setTrashed(source.id, source.revision, true);
    assert.equal(trashed.trashed, true);
    for (let index = 0; index < 110; index++) {
      fixture.runtime.createObject({ typeId: PAGE_TYPE_ID, title: `popular live source ${String(index).padStart(3, '0')}`, properties: { [fixture.scheduledPropertyId]: '2026-11-20', [fixture.multiReferencePropertyId]: [target] }, body: '' });
    }
    const result = referenceScenario(fixture, 0, 1);
    assert.equal(result.equivalent, true);
    assert.equal(result.baseline.ids.includes(empty.id), false);
    assert.equal(result.baseline.ids.includes(missing.id), false);
    assert.equal(result.baseline.ids.includes(source.id), false);
    assert.equal(result.baseline.ids.includes(twoProperties.id), true);
    assert.equal(result.baseline.ids.includes(replaced.id), false);
    assert.ok(result.baseline.ids.length <= 101);
    assert.equal(result.metadata.viewTruncated, true);
  } finally {
    fixture.cleanup();
  }
});

test('search benchmark uses LIKE fallback for unsafe boundaries and synchronizes identity mapping', () => {
  const fixture = buildSyntheticFixture({ objects: 24, bodyBytes: 80, revisions: 0, referenceEvery: 2, benchmarkProperties: true });
  try {
    const result = searchScenario(fixture, 0, 1);
    assert.equal(result.equivalent, true);
    assert.deepEqual(result.baseline.ids, result.candidate.ids);
    assert.equal(result.metadata.mutationSynchronized, true);
    assert.equal(result.metadata.explicitIntegerKeyMismatches, 0);
    assert.ok((result.storage.ftsBytes ?? 0) > 0);
    const cases = result.metadata.cases as ReturnType<typeof searchCases>;
    assert.equal(cases.every(row => row.equivalent), true);
    for (const query of ['', 'a', 'ab', '100%', 'under_score_', 'back\\slash', '"quoted"', 'OR ', 'Café', '😀a']) {
      assert.equal(cases.find(row => row.query === query)?.fallback, true, query);
    }
    assert.equal(cases.find(row => row.query === 'abc')?.fallback, false);
    assert.equal(cases.find(row => row.query === 'Synthetic')?.fallback, false);
  } finally {
    fixture.cleanup();
  }
});

test('benchmark setup timing is accounted structurally and partial initialization cleans owned fixtures', () => {
  const report = collectOne('accounting', normalizeSyntheticFixtureOptions({ objects: 8, bodyBytes: 16, revisions: 0, referenceEvery: 2, benchmarkProperties: true }), { repetitions: 1, warmups: 0 });
  assert.equal(report.totalSetupMs, report.setupMs + report.scenarioSetup.propertyMs! + report.scenarioSetup.referenceMs! + report.scenarioSetup.searchMs!);
  assert.match(report.setupScope, /Elapsed wall-clock construction/);

  const original = ObjectRuntime.prototype.createObject;
  const directories: string[] = [];
  let fixtureIndex = 0;
  ObjectRuntime.prototype.createObject = function failThirdFixture(...args: Parameters<ObjectRuntime['createObject']>) {
    if (args[0]?.title === 'Synthetic object 00000') {
      fixtureIndex += 1;
      const main = (this.db as Database).query<{ file: string }, []>('PRAGMA database_list').all().find(row => row.file.endsWith('workspace.sqlite'));
      assert.ok(main);
      directories.push(dirname(main.file));
      if (fixtureIndex === 3) throw new Error('forced collectOne fixture failure');
    }
    return original.apply(this, args);
  };
  try {
    assert.throws(() => collectOne('cleanup failure', normalizeSyntheticFixtureOptions({ objects: 8, bodyBytes: 16, revisions: 0, referenceEvery: 2, benchmarkProperties: true }), { repetitions: 1, warmups: 0 }), /forced collectOne fixture failure/);
  } finally {
    ObjectRuntime.prototype.createObject = original;
  }
  assert.ok(directories.length >= 3);
  for (const directory of directories) assert.equal(existsSync(directory), false, directory);
});

test('benchmark report uses only owned temp fixtures and records fixture matrix metadata', () => {
  const directory = mkdtempSync(join(tmpdir(), 'taskdesk-sqlite-bench-env-'));
  const sentinel = join(directory, 'sentinel.sqlite');
  const previousDatabasePath = process.env.DATABASE_PATH;
  process.env.DATABASE_PATH = sentinel;
  try {
    const report = collectBenchmarkReport({ objects: 24, largeObjects: 30, bodyBytes: 48, revisions: 0, referenceEvery: 2, repetitions: 1, warmups: 0 });
    assert.equal(report.scales.length, 2);
    assert.equal(report.scales[0]!.scenarios.every(scenario => scenario.equivalent), true);
    assert.match(report.scales[0]!.label, /sparse/);
    assert.match(report.scales[1]!.label, /dense/);
    assert.ok(report.scales[0]!.distribution.trashedRows > 0);
    assert.equal(existsSync(sentinel), false);
  } finally {
    if (previousDatabasePath === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = previousDatabasePath;
    rmSync(directory, { recursive: true, force: true });
  }
});

test('sqlite:bench command prints JSON and rejects caller-selected database paths', async () => {
  const success = Bun.spawn([process.execPath, 'run', 'sqlite:bench', '--', '--objects=24', '--large-objects=30', '--body-bytes=32', '--revisions=0', '--reference-every=2', '--repetitions=1', '--warmups=0'], { stdout: 'pipe', stderr: 'pipe' });
  assert.equal(await success.exited, 0, await new Response(success.stderr).text());
  const output = JSON.parse(await new Response(success.stdout).text()) as { scales: unknown[] };
  assert.equal(output.scales.length, 2);

  const failure = Bun.spawn([process.execPath, 'run', 'sqlite:bench', '--', '--database=/tmp/nope.sqlite'], { stdout: 'pipe', stderr: 'pipe' });
  assert.notEqual(await failure.exited, 0);
  assert.match(await new Response(failure.stderr).text(), /temporary synthetic databases/);
});
