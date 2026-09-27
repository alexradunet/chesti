import type { Database } from 'bun:sqlite';
import { existsSync, statSync } from 'node:fs';
import { buildSyntheticFixture, normalizeSyntheticFixtureOptions } from './sqlite-fixture.js';
import type { SyntheticFixture, SyntheticFixtureOptions } from './sqlite-fixture.js';
import { PAGE_TYPE_ID } from '../src/objects/model.js';
import type { PropertyValue, ViewSpec } from '../src/objects/model.js';
import { ViewService } from '../src/objects/views.js';

type SqlBinding = string | number | null;
interface Timed<T> { value: T; milliseconds: number }
interface Measurement { medianMs: number; p95Ms: number; rangeMs: [number, number]; samples: number }
interface QueryRun { ids: string[]; plan: string[]; read: Measurement; notes?: string[] }
interface ScenarioResult {
  name: string;
  equivalent: boolean;
  metadata: Record<string, unknown>;
  baseline: QueryRun;
  candidate: QueryRun;
  storage: Record<string, number>;
  write: Record<string, number>;
}

export interface BenchmarkOptions {
  objects: number;
  largeObjects: number;
  bodyBytes: number;
  revisions: number;
  referenceEvery: number;
  repetitions: number;
  warmups: number;
}

const LIMITS = { objects: 10_000, largeObjects: 10_000, bodyBytes: 16_384, revisions: 10, referenceEvery: 1_000, repetitions: 50, warmups: 20 };

function parseInteger(text: string, flag: keyof typeof LIMITS, minimum: number): number {
  if (!/^\d+$/.test(text)) throw new Error(`${flag} expects a nonnegative integer.`);
  const value = Number(text);
  if (!Number.isInteger(value) || value < minimum || value > LIMITS[flag]) throw new Error(`${flag} must be an integer from ${minimum} to ${LIMITS[flag]}.`);
  return value;
}

export function parseArgs(args: string[]): BenchmarkOptions {
  const options: BenchmarkOptions = { objects: 1_000, largeObjects: 10_000, bodyBytes: 384, revisions: 1, referenceEvery: 7, repetitions: 9, warmups: 2 };
  for (const arg of args) {
    if (arg === '--help' || arg === '-h') throw new Error('Usage: bun run sqlite:bench -- [--objects=N] [--large-objects=N] [--body-bytes=N] [--revisions=N] [--reference-every=N] [--repetitions=N] [--warmups=N]');
    const match = /^(--[a-z-]+)=(\d+)$/.exec(arg);
    if (!match) {
      const flag = arg.includes('=') ? arg.slice(0, arg.indexOf('=')) : arg;
      if (['--database', '--db', '--path', '--database-path'].includes(flag)) throw new Error('sqlite:bench creates owned temporary synthetic databases only; existing database paths are not accepted.');
      throw new Error(`Unknown or incomplete flag: ${arg}`);
    }
    const flag = match[1]!;
    const value = match[2]!;
    if (flag === '--objects') options.objects = parseInteger(value, 'objects', 1);
    else if (flag === '--large-objects') options.largeObjects = parseInteger(value, 'largeObjects', 1);
    else if (flag === '--body-bytes') options.bodyBytes = parseInteger(value, 'bodyBytes', 0);
    else if (flag === '--revisions') options.revisions = parseInteger(value, 'revisions', 0);
    else if (flag === '--reference-every') options.referenceEvery = parseInteger(value, 'referenceEvery', 1);
    else if (flag === '--repetitions') options.repetitions = parseInteger(value, 'repetitions', 1);
    else if (flag === '--warmups') options.warmups = parseInteger(value, 'warmups', 0);
    else if (['--database', '--db', '--path', '--database-path'].includes(flag)) throw new Error('sqlite:bench creates owned temporary synthetic databases only; existing database paths are not accepted.');
    else throw new Error(`Unknown flag: ${flag}`);
  }
  return options;
}

function time<T>(fn: () => T): Timed<T> {
  const start = performance.now();
  const value = fn();
  return { value, milliseconds: performance.now() - start };
}

function measure<T>(warmups: number, repetitions: number, fn: () => T): { value: T; measurement: Measurement } {
  let value = fn();
  for (let index = 0; index < warmups; index++) value = fn();
  const samples: number[] = [];
  for (let index = 0; index < repetitions; index++) {
    const result = time(fn);
    value = result.value;
    samples.push(result.milliseconds);
  }
  const sorted = [...samples].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
  const p95 = sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)] ?? median;
  return { value, measurement: { medianMs: median, p95Ms: p95, rangeMs: [sorted[0] ?? 0, sorted.at(-1) ?? 0], samples: sorted.length } };
}

function explain(db: Database, sql: string, values: SqlBinding[] = []): string[] {
  return db.query<{ detail: string }, SqlBinding[]>(`EXPLAIN QUERY PLAN ${sql}`).all(...values).map(row => row.detail);
}

function dbBytes(db: Database, file: string): Record<string, number> {
  const rows = db.query<{ name: string; bytes: number }, []>('SELECT name, SUM(pgsize) AS bytes FROM dbstat GROUP BY name').all();
  const result = Object.fromEntries(rows.map(row => [row.name, row.bytes]));
  result.databaseFile = existsSync(file) ? statSync(file).size : 0;
  return result;
}

function idsFromView(fixture: SyntheticFixture, spec: ViewSpec): { displayed: string[]; truncated: boolean } {
  const service = new ViewService(fixture.runtime);
  const view = service.create({ spec, model: 'synthetic/benchmark' }, 'synthetic benchmark view');
  const block = service.evaluate(view.id).blocks[0]!;
  return { displayed: block.rows.map(row => row.object.id), truncated: block.truncated };
}

function sameIds(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((id, index) => id === right[index]);
}

function createBenchmarkObject(fixture: SyntheticFixture, title: string, scheduled = '2026-11-01'): void {
  fixture.runtime.createObject({ typeId: PAGE_TYPE_ID, title, properties: { [fixture.scheduledPropertyId]: scheduled, [fixture.statusPropertyId]: 'bench', [fixture.scorePropertyId]: 0, [fixture.flagPropertyId]: false }, body: '' });
}

function repeatedWriteCost(iterations: number, fn: (index: number) => void): number {
  return time(() => {
    for (let index = 0; index < iterations; index++) fn(index);
  }).milliseconds;
}

export function propertyIndexScenario(fixture: SyntheticFixture, warmups = 1, repetitions = 3): ScenarioResult {
  const db = fixture.db;
  const path = `$\."${fixture.scheduledPropertyId}"`.replace('\\.', '.');
  const expression = `json_extract(o.properties_json, '${path}')`;
  const spec: ViewSpec = { title: 'Scheduled pages', blocks: [{ title: 'Scheduled pages', component: 'table', columns: [{ role: 'date', label: 'Date' }], sources: [{ typeId: PAGE_TYPE_ID, bindings: { date: fixture.scheduledPropertyId }, where: [{ propertyId: fixture.scheduledPropertyId, operator: 'after', value: '2026-11-14' }], orderBy: { propertyId: fixture.scheduledPropertyId, direction: 'ascending' } }] }] };
  const sql = `SELECT o.id, 0 AS source_index, CASE WHEN (${expression} IS NULL OR ${expression} = '') THEN 1 ELSE 0 END AS sort_missing, ${expression} AS sort_ascending, NULL AS sort_descending FROM objects AS o WHERE ((o.trashed = 0) AND (o.type_id = ?) AND (${expression} > ?)) ORDER BY source_index ASC, sort_missing ASC, sort_ascending ASC, sort_descending DESC, o.title COLLATE NOCASE ASC, o.id ASC LIMIT 101`;
  const values: SqlBinding[] = [PAGE_TYPE_ID, '2026-11-14'];
  db.query('ANALYZE').run();
  const baselinePlan = explain(db, sql, values);
  const baseline = measure(warmups, repetitions, () => db.query<{ id: string }, SqlBinding[]>(sql).all(...values).map(row => row.id));
  const beforeBytes = dbBytes(db, fixture.file);
  const insertBefore = repeatedWriteCost(5, index => createBenchmarkObject(fixture, `Bench property insert before ${index}`));
  const updateBeforeTarget = fixture.runtime.getObject(fixture.ids.find(id => fixture.runtime.getObject(id).typeId === PAGE_TYPE_ID)!);
  const updateBefore = time(() => fixture.runtime.updateObject(updateBeforeTarget.id, updateBeforeTarget.revision, { typeId: updateBeforeTarget.typeId, title: `${updateBeforeTarget.title} property-before`, properties: { ...updateBeforeTarget.properties, [fixture.scheduledPropertyId]: '2026-11-01' }, body: updateBeforeTarget.body })).milliseconds;

  db.query(`CREATE INDEX bench_property_scheduled ON objects(type_id, trashed, json_extract(properties_json, '${path}'))`).run();
  db.query('ANALYZE').run();
  const afterBytes = dbBytes(db, fixture.file);
  const candidatePlan = explain(db, sql, values);
  const candidate = measure(warmups, repetitions, () => db.query<{ id: string }, SqlBinding[]>(sql).all(...values).map(row => row.id));
  const view = idsFromView(fixture, spec);
  const insertAfter = repeatedWriteCost(5, index => createBenchmarkObject(fixture, `Bench property insert after ${index}`));
  const updateAfterTarget = fixture.runtime.getObject(fixture.ids.find(id => fixture.runtime.getObject(id).typeId === PAGE_TYPE_ID && id !== updateBeforeTarget.id)!);
  const updateAfter = time(() => fixture.runtime.updateObject(updateAfterTarget.id, updateAfterTarget.revision, { typeId: updateAfterTarget.typeId, title: `${updateAfterTarget.title} property-after`, properties: { ...updateAfterTarget.properties, [fixture.scheduledPropertyId]: '2026-11-20' }, body: updateAfterTarget.body })).milliseconds;
  return {
    name: 'property-path-expression-index',
    equivalent: sameIds(view.displayed, baseline.value.slice(0, 100)) && sameIds(baseline.value, candidate.value),
    metadata: { propertyId: fixture.scheduledPropertyId, predicate: 'date after 2026-11-14', viewRows: view.displayed.length, viewTruncated: view.truncated, sqlLimitRows: baseline.value.length, indexUsed: candidatePlan.some(step => step.includes('bench_property_scheduled')) },
    baseline: { ids: baseline.value, plan: baselinePlan, read: baseline.measurement, notes: ['Baseline analyzed before timing.'] },
    candidate: { ids: candidate.value, plan: candidatePlan, read: candidate.measurement, notes: ['Uses the same literal UUID JSON path shape as ViewService.'] },
    storage: { indexBytes: afterBytes.bench_property_scheduled ?? 0, statsBytes: afterBytes.sqlite_stat1 ?? 0, databaseBytesBefore: beforeBytes.databaseFile ?? 0, databaseBytesAfter: afterBytes.databaseFile ?? 0 },
    write: { insertFiveBeforeIndexMs: insertBefore, insertFiveAfterIndexMs: insertAfter, updateBeforeIndexMs: updateBefore, updateAfterIndexMs: updateAfter },
  };
}

export function referenceScenario(fixture: SyntheticFixture, warmups = 1, repetitions = 3): ScenarioResult {
  const db = fixture.db;
  const popular = db.query<{ target_id: string; count: number }, [string]>('SELECT target_id, COUNT(*) AS count FROM object_references WHERE property_id = ? GROUP BY target_id ORDER BY count DESC, target_id LIMIT 1').get(fixture.multiReferencePropertyId);
  if (!popular) throw new Error('Fixture did not create a multiple-reference edge. Lower --reference-every or increase --objects.');
  const target = popular.target_id;
  const path = `$."${fixture.multiReferencePropertyId}"`;
  const spec: ViewSpec = { title: 'Reference pages', blocks: [{ title: 'Reference pages', component: 'table', columns: [{ role: 'related', label: 'Related' }], sources: [{ typeId: PAGE_TYPE_ID, bindings: { related: fixture.multiReferencePropertyId }, where: [{ propertyId: fixture.multiReferencePropertyId, operator: 'contains', value: target }] }] }] };
  const baselineSql = `SELECT o.id, 0 AS source_index, 0 AS sort_missing, NULL AS sort_ascending, NULL AS sort_descending FROM objects AS o WHERE ((o.trashed = 0) AND (o.type_id = ?) AND (EXISTS (SELECT 1 FROM json_each(json_extract(o.properties_json, '${path}')) AS member WHERE member.value COLLATE NOCASE = ?))) ORDER BY source_index ASC, sort_missing ASC, sort_ascending ASC, sort_descending DESC, o.title COLLATE NOCASE ASC, o.id ASC LIMIT 101`;
  const baselineValues: SqlBinding[] = [PAGE_TYPE_ID, target.toUpperCase()];
  const edgeSql = `SELECT o.id, 0 AS source_index, 0 AS sort_missing, NULL AS sort_ascending, NULL AS sort_descending FROM objects AS o WHERE o.trashed = 0 AND o.type_id = ? AND EXISTS (SELECT 1 FROM object_references AS r WHERE r.source_id = o.id AND r.property_id = ? AND r.target_id COLLATE NOCASE = ?) ORDER BY source_index ASC, sort_missing ASC, sort_ascending ASC, sort_descending DESC, o.title COLLATE NOCASE ASC, o.id ASC LIMIT 101`;
  const edgeValues: SqlBinding[] = [PAGE_TYPE_ID, fixture.multiReferencePropertyId, target.toUpperCase()];
  db.query('ANALYZE').run();
  const view = idsFromView(fixture, spec);
  const baseline = measure(warmups, repetitions, () => db.query<{ id: string }, SqlBinding[]>(baselineSql).all(...baselineValues).map(row => row.id));
  const edgeExisting = measure(warmups, repetitions, () => db.query<{ id: string }, SqlBinding[]>(edgeSql).all(...edgeValues).map(row => row.id));
  const existingPlan = explain(db, edgeSql, edgeValues);
  const beforeBytes = dbBytes(db, fixture.file);
  db.query('CREATE INDEX bench_refs_property_target_source ON object_references(property_id, target_id COLLATE NOCASE, source_id)').run();
  db.query('ANALYZE').run();
  const candidate = measure(warmups, repetitions, () => db.query<{ id: string }, SqlBinding[]>(edgeSql).all(...edgeValues).map(row => row.id));
  const afterBytes = dbBytes(db, fixture.file);
  const insertAfter = repeatedWriteCost(5, index => fixture.runtime.createObject({ typeId: PAGE_TYPE_ID, title: `Bench reference insert ${index}`, properties: { [fixture.scheduledPropertyId]: '2026-11-02', [fixture.multiReferencePropertyId]: [target] }, body: '' }));
  const updateTarget = fixture.runtime.getObject(fixture.ids.find(id => fixture.runtime.getObject(id).typeId === PAGE_TYPE_ID && id !== target)!);
  const updateAfter = time(() => fixture.runtime.updateObject(updateTarget.id, updateTarget.revision, { typeId: updateTarget.typeId, title: `${updateTarget.title} reference-after`, properties: { ...updateTarget.properties, [fixture.multiReferencePropertyId]: [target] as PropertyValue }, body: updateTarget.body })).milliseconds;
  return {
    name: 'reference-edge-membership',
    equivalent: sameIds(view.displayed, baseline.value.slice(0, 100)) && sameIds(baseline.value, edgeExisting.value) && sameIds(edgeExisting.value, candidate.value),
    metadata: { propertyId: fixture.multiReferencePropertyId, targetId: target, targetInboundMatches: popular.count, sqlLimitRows: baseline.value.length, viewRows: view.displayed.length, viewTruncated: view.truncated, existingIndexPlan: existingPlan, candidateIndexUsed: explain(db, edgeSql, edgeValues).some(step => step.includes('bench_refs_property_target_source')), writingEdgesExcludedByPropertyId: true },
    baseline: { ids: baseline.value, plan: explain(db, baselineSql, baselineValues), read: baseline.measurement, notes: ['Current json_each membership with analyzed statistics.'] },
    candidate: { ids: candidate.value, plan: explain(db, edgeSql, edgeValues), read: candidate.measurement, notes: [`Existing-index edge median was ${edgeExisting.measurement.medianMs.toFixed(3)} ms before adding the optional composite index.`] },
    storage: { candidateIndexBytes: afterBytes.bench_refs_property_target_source ?? 0, databaseBytesBefore: beforeBytes.databaseFile ?? 0, databaseBytesAfter: afterBytes.databaseFile ?? 0 },
    write: { insertFiveWithCandidateIndexMs: insertAfter, updateWithCandidateIndexMs: updateAfter },
  };
}

function likePattern(query: string): string {
  return `%${query.replace(/[\\%_]/g, '\\$&')}%`;
}

function safeFtsPhrase(query: string): string | undefined {
  if (query.length < 3 || query.length > 80) return undefined;
  if (/[%_\\]/.test(query)) return undefined;
  if (/\b(?:AND|OR|NOT)\b/i.test(query)) return undefined;
  return `"${query.replace(/"/g, '""')}"`;
}

function createSearchTables(db: Database): number {
  const start = performance.now();
  db.query('CREATE TABLE bench_search_key(search_key INTEGER PRIMARY KEY, object_id TEXT NOT NULL UNIQUE)').run();
  db.query("CREATE VIRTUAL TABLE bench_object_search USING fts5(search_key UNINDEXED, object_id UNINDEXED, title, body_text, tokenize='trigram')").run();
  db.query('INSERT INTO bench_search_key(object_id) SELECT id FROM objects ORDER BY id').run();
  db.query(`INSERT INTO bench_object_search(search_key, object_id, title, body_text)
    SELECT k.search_key, o.id, o.title, o.body_text FROM bench_search_key AS k JOIN objects AS o ON o.id = k.object_id`).run();
  return performance.now() - start;
}

function syncSearchObject(db: Database, objectId: string): void {
  db.query(`UPDATE bench_object_search SET title = (SELECT title FROM objects WHERE id = ?), body_text = (SELECT body_text FROM objects WHERE id = ?) WHERE object_id = ?`).run(objectId, objectId, objectId);
}

function baselineSearchIds(fixture: SyntheticFixture, query: string): string[] {
  return fixture.runtime.listObjectSummaries({ search: query, limit: 50 }).map(row => row.id);
}

function candidateSearchIds(db: Database, query: string): { ids: string[]; fallback: boolean } {
  const pattern = likePattern(query);
  const phrase = safeFtsPhrase(query);
  const baselineSql = "SELECT id FROM objects WHERE trashed = 0 AND (title LIKE ? ESCAPE '\\' OR body_text LIKE ? ESCAPE '\\') ORDER BY updated_at DESC, id LIMIT 50";
  if (!phrase) return { ids: db.query<{ id: string }, SqlBinding[]>(baselineSql).all(pattern, pattern).map(row => row.id), fallback: true };
  const candidateSql = `SELECT o.id FROM bench_object_search AS s JOIN objects AS o ON o.id = s.object_id
    WHERE s.bench_object_search MATCH ? AND o.trashed = 0 AND (o.title LIKE ? ESCAPE '\\' OR o.body_text LIKE ? ESCAPE '\\')
    ORDER BY o.updated_at DESC, o.id LIMIT 50`;
  return { ids: db.query<{ id: string }, SqlBinding[]>(candidateSql).all(phrase, pattern, pattern).map(row => row.id), fallback: false };
}

export function searchCases(fixture: SyntheticFixture): { query: string; fallback: boolean; equivalent: boolean }[] {
  return ['', 'a', 'ab', 'Syn', 'Synthetic', 'synthetic', 'Synthetic object', '"quoted"', 'OR ', '100%', 'under_score_', 'back\\slash', 'Café', 'body-only-needle', 'title-only-needle'].map(query => {
    const candidate = candidateSearchIds(fixture.db, query);
    return { query, fallback: candidate.fallback, equivalent: sameIds(baselineSearchIds(fixture, query), candidate.ids) };
  });
}

export function searchScenario(fixture: SyntheticFixture, warmups = 1, repetitions = 3): ScenarioResult {
  const db = fixture.db;
  const buildMs = createSearchTables(db);
  const titleOnly = fixture.runtime.getObject(fixture.ids.find(id => fixture.runtime.getObject(id).typeId === PAGE_TYPE_ID)!);
  const titleUpdated = fixture.runtime.updateObject(titleOnly.id, titleOnly.revision, { typeId: titleOnly.typeId, title: `${titleOnly.title} title-only-needle`, properties: titleOnly.properties, body: titleOnly.body });
  syncSearchObject(db, titleUpdated.id);
  const bodyOnly = fixture.runtime.getObject(fixture.ids.find(id => fixture.runtime.getObject(id).typeId === PAGE_TYPE_ID && id !== titleUpdated.id)!);
  const bodyUpdated = fixture.runtime.updateObject(bodyOnly.id, bodyOnly.revision, { typeId: bodyOnly.typeId, title: bodyOnly.title, properties: bodyOnly.properties, body: `${bodyOnly.body}\n\nbody-only-needle` });
  syncSearchObject(db, bodyUpdated.id);

  const query = 'Synthetic';
  const pattern = likePattern(query);
  const phrase = safeFtsPhrase(query)!;
  const baselineSql = "SELECT id FROM objects WHERE trashed = 0 AND (title LIKE ? ESCAPE '\\' OR body_text LIKE ? ESCAPE '\\') ORDER BY updated_at DESC, id LIMIT 50";
  const candidateSql = `SELECT o.id FROM bench_object_search AS s JOIN objects AS o ON o.id = s.object_id
    WHERE s.bench_object_search MATCH ? AND o.trashed = 0 AND (o.title LIKE ? ESCAPE '\\' OR o.body_text LIKE ? ESCAPE '\\')
    ORDER BY o.updated_at DESC, o.id LIMIT 50`;
  const baselineValues: SqlBinding[] = [pattern, pattern];
  const candidateValues: SqlBinding[] = [phrase, pattern, pattern];
  const beforeBytes = dbBytes(db, fixture.file);
  const baseline = measure(warmups, repetitions, () => db.query<{ id: string }, SqlBinding[]>(baselineSql).all(...baselineValues).map(row => row.id));
  const candidate = measure(warmups, repetitions, () => db.query<{ id: string }, SqlBinding[]>(candidateSql).all(...candidateValues).map(row => row.id));

  let insertedId = '';
  const insertMaintenanceMs = time(() => {
    const inserted = fixture.runtime.createObject({ typeId: PAGE_TYPE_ID, title: 'Inserted needle object', properties: { [fixture.scheduledPropertyId]: '2026-11-03' }, body: 'insert-mutation-needle' });
    insertedId = inserted.id;
    const newKey = db.query<{ next: number }, []>('SELECT COALESCE(MAX(search_key), 0) + 1 AS next FROM bench_search_key').get()!.next;
    db.query('INSERT INTO bench_search_key(search_key, object_id) VALUES (?, ?)').run(newKey, inserted.id);
    db.query('INSERT INTO bench_object_search(search_key, object_id, title, body_text) SELECT ?, id, title, body_text FROM objects WHERE id = ?').run(newKey, inserted.id);
  }).milliseconds;
  if (!insertedId) throw new Error('Search insert maintenance did not create an object.');
  const updateTarget = fixture.runtime.getObject(titleUpdated.id);
  const updateMaintenanceMs = time(() => {
    const afterUpdate = fixture.runtime.updateObject(updateTarget.id, updateTarget.revision, { typeId: updateTarget.typeId, title: `${updateTarget.title} update-mutation-needle`, properties: updateTarget.properties, body: updateTarget.body });
    syncSearchObject(db, afterUpdate.id);
  }).milliseconds;
  const trashTarget = fixture.runtime.getObject(bodyUpdated.id);
  fixture.runtime.setTrashed(trashTarget.id, trashTarget.revision, true);
  const mutationNeedleCandidate = candidateSearchIds(db, 'mutation-needle').ids;
  const mutationNeedleBaseline = baselineSearchIds(fixture, 'mutation-needle');
  const trashedCandidate = candidateSearchIds(db, 'body-only-needle').ids;
  const trashedBaseline = baselineSearchIds(fixture, 'body-only-needle');
  const cases = searchCases(fixture);
  const afterBytes = dbBytes(db, fixture.file);
  return {
    name: 'literal-search-fts5-trigram-candidate-plus-like',
    equivalent: sameIds(baseline.value, candidate.value) && cases.every(row => row.equivalent) && sameIds(mutationNeedleBaseline, mutationNeedleCandidate) && sameIds(trashedBaseline, trashedCandidate),
    metadata: { query, cases, mutationSynchronized: sameIds(mutationNeedleBaseline, mutationNeedleCandidate), trashSynchronized: sameIds(trashedBaseline, trashedCandidate), stableExplicitIntegerKeys: true },
    baseline: { ids: baseline.value, plan: explain(db, baselineSql, baselineValues), read: baseline.measurement },
    candidate: { ids: candidate.value, plan: explain(db, candidateSql, candidateValues), read: candidate.measurement, notes: ['FTS MATCH receives a quoted literal phrase only; unsafe or too-short strings execute the exact LIKE baseline path.'] },
    storage: { ftsBytes: Object.entries(afterBytes).filter(([name]) => name.startsWith('bench_object_search') || name === 'bench_search_key').reduce((sum, [, bytes]) => sum + bytes, 0), databaseBytesBefore: beforeBytes.databaseFile ?? 0, databaseBytesAfter: afterBytes.databaseFile ?? 0 },
    write: { ftsBuildMs: buildMs, insertMaintenanceMs, updateMaintenanceMs, ftsRows: db.query<{ count: number }, []>('SELECT COUNT(*) AS count FROM bench_object_search').get()!.count },
  };
}

function benchmarkFixtureOptions(input: SyntheticFixtureOptions): Required<SyntheticFixtureOptions> {
  return normalizeSyntheticFixtureOptions({ ...input, benchmarkProperties: true });
}

function collectOne(options: Required<SyntheticFixtureOptions>, bench: Pick<BenchmarkOptions, 'warmups' | 'repetitions'>) {
  const setup = time(() => buildSyntheticFixture(options));
  const fixture = setup.value;
  try {
    const db = fixture.db;
    const sqliteVersion = db.query<{ version: string }, []>('SELECT sqlite_version() AS version').get()!.version;
    const sourceId = db.query<{ source_id: string }, []>('SELECT sqlite_source_id() AS source_id').get()!.source_id;
    const pragmas = { journalMode: db.query<{ journal_mode: string }, []>('PRAGMA journal_mode').get()!.journal_mode, synchronous: db.query<{ synchronous: number }, []>('PRAGMA synchronous').get()!.synchronous, trustedSchema: db.query<{ trusted_schema: number }, []>('PRAGMA trusted_schema').get()!.trusted_schema };
    return { fixture: fixture.options, setupMs: setup.milliseconds, distribution: { pageRows: db.query<{ count: number }, []>(`SELECT COUNT(*) AS count FROM objects WHERE type_id = '${PAGE_TYPE_ID}'`).get()!.count, trashedRows: db.query<{ count: number }, []>('SELECT COUNT(*) AS count FROM objects WHERE trashed = 1').get()!.count, referenceRows: db.query<{ count: number }, []>('SELECT COUNT(*) AS count FROM object_references').get()!.count, bodyBytes: options.bodyBytes, revisions: options.revisions }, engine: { bunVersion: Bun.version, sqliteVersion, sourceId, pragmas }, scenarios: [propertyIndexScenario(fixture, bench.warmups, bench.repetitions), referenceScenario(fixture, bench.warmups, bench.repetitions), searchScenario(fixture, bench.warmups, bench.repetitions)] };
  } finally {
    fixture.cleanup();
  }
}

export function collectBenchmarkReport(options: BenchmarkOptions) {
  return {
    generatedAt: new Date().toISOString(),
    command: { options },
    scales: [
      collectOne(benchmarkFixtureOptions({ objects: options.objects, bodyBytes: options.bodyBytes, revisions: options.revisions, referenceEvery: options.referenceEvery }), options),
      collectOne(benchmarkFixtureOptions({ objects: options.largeObjects, bodyBytes: options.bodyBytes, revisions: options.revisions, referenceEvery: options.referenceEvery }), options),
    ],
    conclusion: 'This synthetic benchmark reports candidate equivalence and costs only; it does not change production schema or authorize adoption.',
  };
}

if (import.meta.main) {
  try {
    const options = parseArgs(Bun.argv.slice(2));
    console.log(JSON.stringify(collectBenchmarkReport(options), null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
