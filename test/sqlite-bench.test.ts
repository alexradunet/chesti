import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { Database } from 'bun:sqlite';
import { buildSyntheticFixture, normalizeSyntheticFixtureOptions } from '../scripts/sqlite-fixture.js';
import { candidateSearchIds, collectBenchmarkReport, collectOne, createSearchTables, insertSearchObject, parseArgs, propertyIndexScenario, propertyIndexSql, referenceScenario, searchScenario, syncSearchObject, writeComparison } from '../scripts/sqlite-bench.js';
import { PAGE_TYPE_ID } from '../src/objects/model.js';
import type { ObjectWrite } from '../src/objects/model.js';
import { ObjectRuntime } from '../src/objects/runtime.js';
import { ViewService } from '../src/objects/views.js';

const small = { objects: 24, bodyBytes: 64, revisions: 0, referenceEvery: 2, benchmarkProperties: true };

test('sqlite benchmark CLI parsing is bounded and rejects database paths', () => {
  assert.deepEqual(parseArgs(['--objects=12', '--large-objects=20', '--body-bytes=64', '--revisions=0', '--reference-every=2', '--repetitions=1', '--warmups=0']), { objects: 12, largeObjects: 20, bodyBytes: 64, revisions: 0, referenceEvery: 2, repetitions: 1, warmups: 0 });
  assert.throws(() => parseArgs(['--objects=10001']), /objects must be/);
  assert.throws(() => parseArgs(['--db=/tmp/live.sqlite']), /temporary synthetic databases/);
  assert.throws(() => parseArgs(['--objects=6=bad']), /Unknown or incomplete flag/);
});

test('owning property index DDL indexes real dates and changes after canonical update', () => {
  for (let iteration = 0; iteration < 2; iteration++) {
    const f = buildSyntheticFixture(small);
    try {
      f.db.exec(propertyIndexSql(f));
      const ddl = f.db.query<{ sql: string }, []>("SELECT sql FROM sqlite_schema WHERE name='bench_property_scheduled'").get()!.sql;
      assert.ok(ddl.includes(f.scheduledPropertyId));
      const object = f.runtime.createObject({ typeId: PAGE_TYPE_ID, title: 'index probe', properties: { [f.scheduledPropertyId]: '2026-11-14' }, body: '' });
      const read = () => f.db.query<{ value: string }, [string]>(`SELECT json_extract(properties_json, '$."${f.scheduledPropertyId}"') AS value FROM objects INDEXED BY bench_property_scheduled WHERE id=?`).get(object.id)!.value;
      assert.equal(read(), '2026-11-14');
      f.runtime.patchProperties(object.id, object.revision, { [f.scheduledPropertyId]: '2026-11-28' });
      assert.equal(read(), '2026-11-28');
    } finally { f.cleanup(); }
  }
});

test('paired write samples capture equal bounded inputs history and actual indexed updates', () => {
  for (const kind of ['property', 'reference', 'search'] as const) {
    const f = buildSyntheticFixture({ ...small, revisions: 2 });
    const originalCreate = ObjectRuntime.prototype.createObject;
    const originalUpdate = ObjectRuntime.prototype.updateObject;
    const captured: { candidate: boolean; operation: string; input: ObjectWrite; revision?: number; history?: number; initialBody?: string }[] = [];
    const indexName = kind === 'property' ? 'bench_property_scheduled' : kind === 'reference' ? 'bench_refs_property_target_source' : 'bench_search_key';
    const isCandidate = () => !!f.db.query('SELECT name FROM sqlite_schema WHERE name=?').get(indexName);
    ObjectRuntime.prototype.createObject = function (...args) {
      if (args[0].title === 'Measured changed title') captured.push({ candidate: isCandidate(), operation: 'insert', input: structuredClone(args[0]) });
      return originalCreate.apply(this, args);
    };
    ObjectRuntime.prototype.updateObject = function (...args) {
      if (args[2].title === 'Measured changed title') {
        captured.push({ candidate: isCandidate(), operation: 'update', input: structuredClone(args[2]), revision: args[1], history: this.db.query<{ n: number }, [string]>('SELECT COUNT(*) AS n FROM object_revisions WHERE object_id=?').get(args[0])!.n, initialBody: this.getObject(args[0]).body });
      }
      const result = originalUpdate.apply(this, args);
      if (kind === 'property' && isCandidate() && args[2].title === 'Measured changed title') {
        const indexed = this.db.query<{ value: string }, [string]>(`SELECT json_extract(properties_json, '$."${f.scheduledPropertyId}"') AS value FROM objects INDEXED BY bench_property_scheduled WHERE id=?`).get(result.id)!;
        assert.equal(indexed.value, '2026-11-28');
      }
      return result;
    };
    try {
      const result = writeComparison(f, kind, 20, 50);
      const baseline = captured.filter(c => !c.candidate).map(({ candidate, ...record }) => record);
      const candidate = captured.filter(c => c.candidate).map(({ candidate, ...record }) => record);
      assert.deepEqual(candidate, baseline);
      assert.equal(baseline.length, 140);
      for (const record of baseline) {
        assert.equal(Buffer.byteLength(record.input.body), 64);
        assert.equal(record.input.title, 'Measured changed title');
        if (record.operation === 'update') {
          assert.equal(record.revision, 3);
          assert.equal(record.history, 2);
          assert.equal(Buffer.byteLength(record.initialBody!), 64);
        }
      }
      for (const side of [result.baseline, result.candidate]) {
        assert.equal(side.insert.timing.samples, 50);
        assert.equal(side.update.timing.samples, 50);
        assert.equal(side.update.observed, '2026-11-28');
      }
      assert.equal(f.db.query('SELECT name FROM sqlite_schema WHERE name=?').get(indexName), null);
      assert.equal(f.db.query<{ n: number }, []>('SELECT COUNT(*) AS n FROM objects').get()!.n, small.objects + 2);
    } finally {
      ObjectRuntime.prototype.createObject = originalCreate;
      ObjectRuntime.prototype.updateObject = originalUpdate;
      f.cleanup();
    }
  }
});

test('date views and candidate have exact missing boundary before after trash and ordering semantics', () => {
  const f = buildSyntheticFixture({ ...small, objects: 1 });
  try {
    const make = (title: string, day?: string) => f.runtime.createObject({ typeId: PAGE_TYPE_ID, title, properties: day ? { [f.scheduledPropertyId]: day } : {}, body: '' });
    make('missing');
    make('boundary', '2026-11-14');
    make('before', '2026-11-13');
    const afterB = make('beta', '2026-11-15');
    const afterA = make('Alpha', '2026-11-15');
    const afterATie = make('alpha', '2026-11-15');
    const later = make('earlier title later day', '2026-11-28');
    const trash = make('trash', '2026-11-16');
    f.runtime.setTrashed(trash.id, trash.revision, true);
    const result = propertyIndexScenario(f, 0, 1);
    const common = result.cases[0]!;
    assert.deepEqual(common.ids, [...[afterA.id, afterATie.id].sort(), afterB.id, later.id]);
    assert.deepEqual(common.view.displayed, common.ids);
    assert.deepEqual(common.candidate.ids, common.ids);
    assert.equal(common.view.truncated, false);
    assert.deepEqual(result.cases[1]!.ids, [later.id]);
  } finally { f.cleanup(); }
});

test('reference semantics retain live uppercase provenance mutations trashed targets and exact lookahead', () => {
  const f = buildSyntheticFixture({ ...small, objects: 1 });
  try {
    const make = (title: string, properties: ObjectWrite['properties'] = {}, body = '') => f.runtime.createObject({ typeId: PAGE_TYPE_ID, title, properties, body });
    const target = make('target');
    const other = make('replacement target');
    const refs = (id: string) => ({ [f.multiReferencePropertyId]: [id] });
    const uppercase = make('000 uppercase', refs(target.id.toUpperCase()));
    const sameTargetProperties = make('001 two properties', { ...refs(target.id), [f.referencePropertyId]: target.id });
    const negatives = [make('empty', { [f.multiReferencePropertyId]: [] }), make('missing'), make('other property only', { [f.referencePropertyId]: target.id }), make('writing only', {}, `[link](/objects/${target.id})`)];
    let changed = make('changed', refs(other.id));
    changed = f.runtime.patchProperties(changed.id, changed.revision, refs(target.id));
    assert.ok(referenceScenario(f, 0, 1, [target.id]).cases[0]!.ids.includes(changed.id));
    changed = f.runtime.patchProperties(changed.id, changed.revision, { [f.multiReferencePropertyId]: null });
    negatives.push(changed);
    let replaced = make('replaced', refs(target.id));
    replaced = f.runtime.patchProperties(replaced.id, replaced.revision, refs(other.id));
    negatives.push(replaced);
    const trash = make('trashed source', refs(target.id));
    f.runtime.setTrashed(trash.id, trash.revision, true);
    negatives.push(trash);
    const expected = [uppercase.id, sameTargetProperties.id];
    const before = referenceScenario(f, 0, 1, [target.id]).cases[0]!;
    assert.deepEqual(before.ids, expected);
    for (const negative of negatives) assert.equal(before.ids.includes(negative.id), false);
    const many: string[] = [];
    for (let i = 0; i < 110; i++) many.push(make(`source ${String(i).padStart(3, '0')}`, refs(target.id)).id);
    f.runtime.setTrashed(target.id, target.revision, true);
    // Retaining is allowed, and must not rewrite uppercase stored identity.
    f.runtime.patchProperties(uppercase.id, uppercase.revision, { [f.scheduledPropertyId]: '2026-11-28' });
    const result = referenceScenario(f, 0, 1, [target.id]).cases[0]!;
    assert.deepEqual(result.ids, [...expected, ...many].slice(0, 101));
    assert.deepEqual(result.view.displayed, [...expected, ...many].slice(0, 100));
    assert.equal(result.ids.length, 101);
    assert.equal(result.view.displayed.length, 100);
    assert.equal(result.view.truncated, true);
    assert.equal(f.runtime.getObject(target.id).trashed, true);
    assert.deepEqual(result.targetFirst.ids, result.ids);
    assert.equal(typeof result.targetFirst.usesExistingTargetIndex, 'boolean');
    assert.deepEqual(result.composite.ids, result.ids);
    assert.equal(writeComparison(f, 'reference', 0, 1).candidate.update.observed, '2026-11-28');
  } finally { f.cleanup(); }
});

test('reference scenario throws on an actual missing derived edge rather than reporting equivalent costs', () => {
  const f = buildSyntheticFixture(small);
  try {
    const edge = f.db.query<{ source_id: string; target_id: string }, [string]>('SELECT source_id,target_id FROM object_references WHERE property_id=? LIMIT 1').get(f.multiReferencePropertyId)!;
    f.db.query('DELETE FROM object_references WHERE source_id=? AND target_id=? AND property_id=?').run(edge.source_id, edge.target_id, f.multiReferencePropertyId);
    assert.throws(() => referenceScenario(f, 0, 1, [edge.target_id]), /semantic mismatch/);
  } finally { f.cleanup(); }
});

test('search dispatch has known positives negatives fallbacks and canonical mutation identity consistency', () => {
  const f = buildSyntheticFixture({ ...small, bodyBytes: 0 });
  try {
    const make = (title: string, body: string) => f.runtime.createObject({ typeId: PAGE_TYPE_ID, title, body, properties: {} });
    let title = make('title-only-needle abc two words', '');
    let body = make('body holder', 'body-only-needle Café 😀a 100% under_score_ back\\slash "quoted" OR operator');
    const negative = make('nonmatching', 'plain');
    createSearchTables(f.db);
    const check = (query: string, expected: string[], fallback: boolean) => {
      const result = candidateSearchIds(f.db, query);
      assert.equal(result.fallback, fallback, query);
      assert.deepEqual(result.ids, expected, query);
      assert.deepEqual(result.ids, f.runtime.listObjectSummaries({ search: query, limit: 50 }).map(row => row.id));
      assert.equal(result.ids.includes(negative.id), false);
    };
    check('title-only-needle', [title.id], false);
    check('abc', [title.id], false);
    check('two words', [title.id], false);
    check('body-only-needle', [body.id], false);
    for (const query of ['Café', '😀a', '100%', 'under_score_', 'back\\slash', '"quoted"', 'OR ']) check(query, [body.id], true);
    for (const query of ['', 'a', 'ab']) {
      assert.equal(candidateSearchIds(f.db, query).fallback, true);
      assert.deepEqual(candidateSearchIds(f.db, query).ids, f.runtime.listObjectSummaries({ search: query, limit: 50 }).map(row => row.id));
    }
    const inserted = make('insert-mutation-needle', '');
    insertSearchObject(f.db, inserted.id);
    check('insert-mutation-needle', [inserted.id], false);
    title = f.runtime.updateObject(title.id, title.revision, { typeId: title.typeId, title: 'replacement-mutation-needle', properties: title.properties, body: '' });
    syncSearchObject(f.db, title.id);
    check('title-only-needle', [], false);
    check('replacement-mutation-needle', [title.id], false);
    body = f.runtime.setTrashed(body.id, body.revision, true);
    syncSearchObject(f.db, body.id);
    check('body-only-needle', [], false);
    body = f.runtime.setTrashed(body.id, body.revision, false);
    syncSearchObject(f.db, body.id);
    check('body-only-needle', [body.id], false);
    body = f.runtime.updateObject(body.id, body.revision, { typeId: body.typeId, title: body.title, properties: body.properties, body: '' });
    syncSearchObject(f.db, body.id);
    check('body-only-needle', [], false);
    const keys = f.db.query<{ search_key: number; object_id: string; rowid: number; fts_id: string }, []>('SELECT k.search_key,k.object_id,s.rowid,s.object_id AS fts_id FROM bench_search_key k JOIN bench_object_search s ON s.rowid=k.search_key').all();
    assert.equal(keys.length, f.ids.length + 4);
    for (const key of keys) {
      assert.equal(key.search_key, key.rowid);
      assert.equal(key.object_id, key.fts_id);
      assert.equal(Number.isInteger(key.search_key), true);
    }
  } finally { f.cleanup(); }
});

test('original thirty-repetition search repro and maximum report stay bounded with real selectivity matrix', () => {
  const f = buildSyntheticFixture(small);
  try {
    const result = searchScenario(f, 0, 30);
    assert.equal(result.reads[0]!.reads.baseline.samples, 30);
    assert.ok(result.storageObjects.includes('sqlite_autoindex_bench_search_key_1'));
  } finally { f.cleanup(); }
  const report = collectBenchmarkReport({ ...small, largeObjects: 30, repetitions: 50, warmups: 20 });
  for (const scale of report.scales) {
    assert.equal(scale.scenarios.property.cases.length, 3);
    assert.ok(scale.scenarios.property.cases[2]!.matchCount > 0);
    for (const c of scale.scenarios.property.cases) {
      assert.ok(c.matchCount > 0);
      assert.equal(c.baseline.read.samples, 50);
      assert.equal(c.candidate.read.samples, 50);
    }
    assert.equal(scale.scenarios.reference.cases.length, 2);
    for (const c of scale.scenarios.reference.cases) {
      assert.ok(c.matchCount > 0);
      assert.equal(c.existing.reads.baseline.samples, 50);
      assert.equal(c.existing.reads.candidate.samples, 50);
      assert.equal(c.composite.reads.candidate.samples, 50);
    }
  }
  const sparse = report.scales[0]!.distribution.arrays as { length: number }[];
  const dense = report.scales[1]!.distribution.arrays as { length: number }[];
  assert.ok(sparse.some(row => row.length === 2));
  assert.equal(sparse.some(row => row.length > 2), false);
  assert.ok(dense.some(row => row.length === 12));
});

test('setup measures construction with a controlled clock and removes its exact owned directory after failures', () => {
  const originalCreate = ObjectRuntime.prototype.createObject;
  const originalView = ViewService.prototype.create;
  const originalNow = Object.getOwnPropertyDescriptor(performance, 'now');
  let clock = 100;
  let directory = '';
  let database: Database | undefined;
  Object.defineProperty(performance, 'now', { configurable: true, value: () => clock });
  ObjectRuntime.prototype.createObject = function (...args) {
    if (args[0].title.includes('ynthetic object')) clock += 7;
    database = this.db;
    directory = dirname(this.db.query<{ file: string }, []>('PRAGMA database_list').all().find(row => row.file.endsWith('workspace.sqlite'))!.file);
    return originalCreate.apply(this, args);
  };
  try {
    const report = collectOne('clock', normalizeSyntheticFixtureOptions(small), { repetitions: 1, warmups: 0 });
    assert.equal(report.setupMs, 24 * 7);
    assert.equal(existsSync(directory), false);
    ViewService.prototype.create = function () { throw new Error('forced post-construction failure'); };
    assert.throws(() => collectOne('failure', normalizeSyntheticFixtureOptions(small), { repetitions: 1, warmups: 0 }), /forced post-construction failure/);
    assert.ok(directory);
    assert.equal(existsSync(directory), false);
    assert.throws(() => database!.query('SELECT 1').get(), /closed/i);
  } finally {
    ObjectRuntime.prototype.createObject = originalCreate;
    ViewService.prototype.create = originalView;
    if (originalNow) Object.defineProperty(performance, 'now', originalNow);
    else Reflect.deleteProperty(performance, 'now');
  }
});

test('a later profile construction failure removes exactly both acquired profile directories', () => {
  const original = ObjectRuntime.prototype.createObject;
  const directories: string[] = [];
  ObjectRuntime.prototype.createObject = function (...args) {
    if (args[0].title === 'Synthetic object 00000') {
      const directory = dirname(this.db.query<{ file: string }, []>('PRAGMA database_list').all().find(row => row.file.endsWith('workspace.sqlite'))!.file);
      directories.push(directory);
      if (directories.length === 2) {
        assert.equal(existsSync(directories[0]!), false);
        throw new Error('forced second profile construction failure');
      }
    }
    return original.apply(this, args);
  };
  try {
    assert.throws(() => collectBenchmarkReport({ ...small, largeObjects: 30, repetitions: 1, warmups: 0 }), /forced second profile construction failure/);
    assert.equal(directories.length, 2);
    for (const directory of directories) assert.equal(existsSync(directory), false);
  } finally { ObjectRuntime.prototype.createObject = original; }
});

test('measurement failures rollback candidate state and remove the acquired report fixture', () => {
  const original = ObjectRuntime.prototype.updateObject;
  let directory = '';
  ObjectRuntime.prototype.updateObject = function (...args) {
    if (args[2].title === 'Measured changed title' && this.db.query("SELECT name FROM sqlite_schema WHERE name='bench_property_scheduled'").get()) {
      directory = dirname(this.db.query<{ file: string }, []>('PRAGMA database_list').all().find(row => row.file.endsWith('workspace.sqlite'))!.file);
      throw new Error('forced write measurement failure');
    }
    return original.apply(this, args);
  };
  try {
    assert.throws(() => collectOne('failure', normalizeSyntheticFixtureOptions(small), { repetitions: 1, warmups: 0 }), /forced write measurement failure/);
    assert.ok(directory);
    assert.equal(existsSync(directory), false);
  } finally { ObjectRuntime.prototype.updateObject = original; }
});

test('sqlite:bench prints JSON and ignores environment database paths while rejecting CLI paths', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'taskdesk-bench-env-'));
  const sentinel = join(directory, 'sentinel.sqlite');
  try {
    const success = Bun.spawn([process.execPath, 'run', 'sqlite:bench', '--', '--objects=24', '--large-objects=30', '--body-bytes=32', '--revisions=0', '--reference-every=2', '--repetitions=1', '--warmups=0'], { env: { ...process.env, DATABASE_PATH: sentinel }, stdout: 'pipe', stderr: 'pipe' });
    const output = await new Response(success.stdout).text();
    assert.equal(await success.exited, 0, await new Response(success.stderr).text());
    assert.equal(JSON.parse(output).scales.length, 2);
    assert.equal(existsSync(sentinel), false);
    const failure = Bun.spawn([process.execPath, 'run', 'sqlite:bench', '--', '--database=/tmp/nope.sqlite'], { stdout: 'pipe', stderr: 'pipe' });
    assert.notEqual(await failure.exited, 0);
    assert.match(await new Response(failure.stderr).text(), /temporary synthetic databases/);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
