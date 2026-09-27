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

export function assertSameIds(label: string, left: string[], right: string[]): void {
  if (sameIds(left, right)) return;
  const firstMismatch = left.findIndex((id, index) => id !== right[index]);
  throw new Error(`${label} semantic mismatch: left=${left.length} rows right=${right.length} rows firstMismatch=${firstMismatch}`);
}

function assertScenarioEquivalent(name: string, checks: Array<[string, string[], string[]]>): void {
  for (const [label, left, right] of checks) assertSameIds(`${name} ${label}`, left, right);
}

function measureWriteSamples(warmups: number, repetitions: number, fn: (index: number) => void): Measurement {
  return measure(warmups, repetitions, () => {
    fn(Math.floor(Math.random() * 1_000_000_000));
    return true;
  }).measurement;
}

function flattenMeasurement(prefix: string, measurement: Measurement): Record<string, number> {
  return {
    [`${prefix}MedianMs`]: measurement.medianMs,
    [`${prefix}P95Ms`]: measurement.p95Ms,
    [`${prefix}MinMs`]: measurement.rangeMs[0],
    [`${prefix}MaxMs`]: measurement.rangeMs[1],
    [`${prefix}Samples`]: measurement.samples,
  };
}

function createBenchmarkObject(fixture: SyntheticFixture, title: string, scheduled = '2026-11-01', references: string[] = []): void {
  fixture.runtime.createObject({
    typeId: PAGE_TYPE_ID,
    title,
    properties: {
      [fixture.scheduledPropertyId]: scheduled,
      [fixture.statusPropertyId]: 'bench',
      [fixture.scorePropertyId]: 0,
      [fixture.flagPropertyId]: false,
      ...(references.length ? { [fixture.multiReferencePropertyId]: references } : {}),
    },
    body: '',
  });
}

export function propertyIndexScenario(fixture: SyntheticFixture, warmups = 1, repetitions = 3): ScenarioResult {
  const db = fixture.db;
  const path = `$\."${fixture.scheduledPropertyId}"`.replace('\\.', '.');
  const expression = `json_extract(o.properties_json, '${path}')`;
  const spec: ViewSpec = { title: 'Scheduled pages', blocks: [{ title: 'Scheduled pages', component: 'table', columns: [{ role: 'date', label: 'Date' }], sources: [{ typeId: PAGE_TYPE_ID, bindings: { date: fixture.scheduledPropertyId }, where: [{ propertyId: fixture.scheduledPropertyId, operator: 'after', value: '2026-11-14' }], orderBy: { propertyId: fixture.scheduledPropertyId, direction: 'ascending' } }] }] };
  const sql = `SELECT o.id, o.type_id, o.title, o.properties_json, o.revision, o.created_at, o.updated_at, o.trashed, 0 AS source_index, CASE WHEN (${expression} IS NULL OR ${expression} = '') THEN 1 ELSE 0 END AS sort_missing, ${expression} AS sort_ascending, NULL AS sort_descending FROM objects AS o WHERE ((o.trashed = 0) AND (o.type_id = ?) AND (${expression} > ?)) ORDER BY source_index ASC, sort_missing ASC, sort_ascending ASC, sort_descending DESC, title COLLATE NOCASE ASC, id ASC LIMIT 101`;
  const values: SqlBinding[] = [PAGE_TYPE_ID, '2026-11-14'];
  db.query('ANALYZE').run();
  const view = idsFromView(fixture, spec);
  const baselinePlan = explain(db, sql, values);
  const baseline = measure(warmups, repetitions, () => db.query<{ id: string }, SqlBinding[]>(sql).all(...values).map(row => row.id));
  const beforeBytes = dbBytes(db, fixture.file);
  db.query(`CREATE INDEX bench_property_scheduled ON objects(type_id, trashed, json_extract(properties_json, '${path}'))`).run();
  db.query('ANALYZE').run();
  const candidatePlan = explain(db, sql, values);
  const candidate = measure(warmups, repetitions, () => db.query<{ id: string }, SqlBinding[]>(sql).all(...values).map(row => row.id));
  assertScenarioEquivalent('property-path-expression-index', [['view/baseline', view.displayed, baseline.value.slice(0, 100)], ['baseline/candidate', baseline.value, candidate.value]]);

  const baselineWrites = buildSyntheticFixture({ objects: fixture.options.objects, bodyBytes: fixture.options.bodyBytes, revisions: 0, referenceEvery: fixture.options.referenceEvery, benchmarkProperties: true });
  const candidateWrites = buildSyntheticFixture({ objects: fixture.options.objects, bodyBytes: fixture.options.bodyBytes, revisions: 0, referenceEvery: fixture.options.referenceEvery, benchmarkProperties: true });
  try {
    candidateWrites.db.query(`CREATE INDEX bench_property_scheduled ON objects(type_id, trashed, json_extract(properties_json, '${path}'))`).run();
    const insertBaseline = measureWriteSamples(warmups, repetitions, index => createBenchmarkObject(baselineWrites, `Bench property insert baseline ${index}`));
    const insertCandidate = measureWriteSamples(warmups, repetitions, index => createBenchmarkObject(candidateWrites, `Bench property insert candidate ${index}`));
    const pageBaseline = baselineWrites.ids.find(id => baselineWrites.runtime.getObject(id).typeId === PAGE_TYPE_ID)!;
    const pageCandidate = candidateWrites.ids.find(id => candidateWrites.runtime.getObject(id).typeId === PAGE_TYPE_ID)!;
    const updateBaseline = measureWriteSamples(warmups, repetitions, index => {
      const object = baselineWrites.runtime.getObject(pageBaseline);
      baselineWrites.runtime.updateObject(object.id, object.revision, { typeId: object.typeId, title: object.title, properties: { ...object.properties, [baselineWrites.scheduledPropertyId]: `2026-11-${String((index % 14) + 15).padStart(2, '0')}` }, body: object.body });
    });
    const updateCandidate = measureWriteSamples(warmups, repetitions, index => {
      const object = candidateWrites.runtime.getObject(pageCandidate);
      candidateWrites.runtime.updateObject(object.id, object.revision, { typeId: object.typeId, title: object.title, properties: { ...object.properties, [candidateWrites.scheduledPropertyId]: `2026-11-${String((index % 14) + 15).padStart(2, '0')}` }, body: object.body });
    });
    const afterBytes = dbBytes(db, fixture.file);
    return {
      name: 'property-path-expression-index',
      equivalent: true,
      metadata: { propertyId: fixture.scheduledPropertyId, predicate: 'date after 2026-11-14', viewRows: view.displayed.length, viewTruncated: view.truncated, sqlLimitRows: baseline.value.length, indexUsed: candidatePlan.some(step => step.includes('bench_property_scheduled')), projection: 'matches ViewService object projection plus sort columns', edgeSemantics: 'ISO date text boundaries; missing/empty excluded by predicate' },
      baseline: { ids: baseline.value, plan: baselinePlan, read: baseline.measurement, notes: ['Baseline analyzed and read before any write probes.'] },
      candidate: { ids: candidate.value, plan: candidatePlan, read: candidate.measurement, notes: ['Same fixture state, same SQL and bindings after adding only the expression index.'] },
      storage: { indexBytes: afterBytes.bench_property_scheduled ?? 0, statsBytes: afterBytes.sqlite_stat1 ?? 0, databaseBytesBefore: beforeBytes.databaseFile ?? 0, databaseBytesAfter: afterBytes.databaseFile ?? 0 },
      write: { ...flattenMeasurement('insertBaseline', insertBaseline), ...flattenMeasurement('insertCandidate', insertCandidate), ...flattenMeasurement('updateBaseline', updateBaseline), ...flattenMeasurement('updateCandidate', updateCandidate) },
    };
  } finally {
    baselineWrites.cleanup();
    candidateWrites.cleanup();
  }
}

export function referenceScenario(fixture: SyntheticFixture, warmups = 1, repetitions = 3): ScenarioResult {
  const db = fixture.db;
  const popular = db.query<{ target_id: string; count: number }, [string]>('SELECT target_id, COUNT(*) AS count FROM object_references WHERE property_id = ? GROUP BY target_id ORDER BY count DESC, target_id LIMIT 1').get(fixture.multiReferencePropertyId);
  if (!popular) throw new Error('Fixture did not create a multiple-reference edge. Lower --reference-every or increase --objects.');
  const target = popular.target_id;
  const path = `$."${fixture.multiReferencePropertyId}"`;
  const spec: ViewSpec = { title: 'Reference pages', blocks: [{ title: 'Reference pages', component: 'table', columns: [{ role: 'related', label: 'Related' }], sources: [{ typeId: PAGE_TYPE_ID, bindings: { related: fixture.multiReferencePropertyId }, where: [{ propertyId: fixture.multiReferencePropertyId, operator: 'contains', value: target }] }] }] };
  const baselineSql = `SELECT o.id, o.type_id, o.title, o.properties_json, o.revision, o.created_at, o.updated_at, o.trashed, 0 AS source_index, 0 AS sort_missing, NULL AS sort_ascending, NULL AS sort_descending FROM objects AS o WHERE ((o.trashed = 0) AND (o.type_id = ?) AND (EXISTS (SELECT 1 FROM json_each(json_extract(o.properties_json, '${path}')) AS member WHERE member.value COLLATE NOCASE = ?))) ORDER BY source_index ASC, sort_missing ASC, sort_ascending ASC, sort_descending DESC, title COLLATE NOCASE ASC, id ASC LIMIT 101`;
  const baselineValues: SqlBinding[] = [PAGE_TYPE_ID, target.toUpperCase()];
  const edgeSql = `SELECT o.id, o.type_id, o.title, o.properties_json, o.revision, o.created_at, o.updated_at, o.trashed, 0 AS source_index, 0 AS sort_missing, NULL AS sort_ascending, NULL AS sort_descending FROM objects AS o WHERE o.trashed = 0 AND o.type_id = ? AND EXISTS (SELECT 1 FROM object_references AS r WHERE r.source_id = o.id AND r.property_id = ? AND r.target_id COLLATE NOCASE = ?) ORDER BY source_index ASC, sort_missing ASC, sort_ascending ASC, sort_descending DESC, title COLLATE NOCASE ASC, id ASC LIMIT 101`;
  const edgeValues: SqlBinding[] = [PAGE_TYPE_ID, fixture.multiReferencePropertyId, target.toUpperCase()];
  db.query('ANALYZE').run();
  const view = idsFromView(fixture, spec);
  const baseline = measure(warmups, repetitions, () => db.query<{ id: string }, SqlBinding[]>(baselineSql).all(...baselineValues).map(row => row.id));
  const edgeExisting = measure(warmups, repetitions, () => db.query<{ id: string }, SqlBinding[]>(edgeSql).all(...edgeValues).map(row => row.id));
  const existingPlan = explain(db, edgeSql, edgeValues);
  assertScenarioEquivalent('reference-existing-index', [['view/baseline', view.displayed, baseline.value.slice(0, 100)], ['baseline/existing-edge', baseline.value, edgeExisting.value]]);
  const beforeBytes = dbBytes(db, fixture.file);
  db.query('CREATE INDEX bench_refs_property_target_source ON object_references(property_id, target_id COLLATE NOCASE, source_id)').run();
  db.query('ANALYZE').run();
  const candidate = measure(warmups, repetitions, () => db.query<{ id: string }, SqlBinding[]>(edgeSql).all(...edgeValues).map(row => row.id));
  assertSameIds('reference composite semantic mismatch', edgeExisting.value, candidate.value);

  const baselineWrites = buildSyntheticFixture({ objects: fixture.options.objects, bodyBytes: fixture.options.bodyBytes, revisions: 0, referenceEvery: fixture.options.referenceEvery, benchmarkProperties: true });
  const candidateWrites = buildSyntheticFixture({ objects: fixture.options.objects, bodyBytes: fixture.options.bodyBytes, revisions: 0, referenceEvery: fixture.options.referenceEvery, benchmarkProperties: true });
  try {
    const writeTarget = candidateWrites.db.query<{ target_id: string }, [string]>('SELECT target_id FROM object_references WHERE property_id = ? LIMIT 1').get(candidateWrites.multiReferencePropertyId)!.target_id;
    candidateWrites.db.query('CREATE INDEX bench_refs_property_target_source ON object_references(property_id, target_id COLLATE NOCASE, source_id)').run();
    const baselineTarget = baselineWrites.db.query<{ target_id: string }, [string]>('SELECT target_id FROM object_references WHERE property_id = ? LIMIT 1').get(baselineWrites.multiReferencePropertyId)!.target_id;
    const insertBaseline = measureWriteSamples(warmups, repetitions, index => createBenchmarkObject(baselineWrites, `Bench reference insert baseline ${index}`, '2026-11-02', [baselineTarget]));
    const insertCandidate = measureWriteSamples(warmups, repetitions, index => createBenchmarkObject(candidateWrites, `Bench reference insert candidate ${index}`, '2026-11-02', [writeTarget]));
    const pageBaseline = baselineWrites.ids.find(id => baselineWrites.runtime.getObject(id).typeId === PAGE_TYPE_ID && id !== baselineTarget)!;
    const pageCandidate = candidateWrites.ids.find(id => candidateWrites.runtime.getObject(id).typeId === PAGE_TYPE_ID && id !== writeTarget)!;
    const updateBaseline = measureWriteSamples(warmups, repetitions, () => {
      const object = baselineWrites.runtime.getObject(pageBaseline);
      baselineWrites.runtime.updateObject(object.id, object.revision, { typeId: object.typeId, title: object.title, properties: { ...object.properties, [baselineWrites.multiReferencePropertyId]: [baselineTarget] as PropertyValue }, body: object.body });
    });
    const updateCandidate = measureWriteSamples(warmups, repetitions, () => {
      const object = candidateWrites.runtime.getObject(pageCandidate);
      candidateWrites.runtime.updateObject(object.id, object.revision, { typeId: object.typeId, title: object.title, properties: { ...object.properties, [candidateWrites.multiReferencePropertyId]: [writeTarget] as PropertyValue }, body: object.body });
    });
    const afterBytes = dbBytes(db, fixture.file);
    return {
      name: 'reference-edge-membership',
      equivalent: true,
      metadata: { propertyId: fixture.multiReferencePropertyId, targetId: target, targetInboundMatches: popular.count, sqlLimitRows: baseline.value.length, viewRows: view.displayed.length, viewTruncated: view.truncated, existingIndexPlan: existingPlan, existingIndexRead: edgeExisting.measurement, existingIndexRequiresExtraSchema: false, candidateIndexUsed: explain(db, edgeSql, edgeValues).some(step => step.includes('bench_refs_property_target_source')), writingEdgesExcludedByPropertyId: true },
      baseline: { ids: baseline.value, plan: explain(db, baselineSql, baselineValues), read: baseline.measurement, notes: ['Current json_each membership with analyzed statistics.'] },
      candidate: { ids: candidate.value, plan: explain(db, edgeSql, edgeValues), read: candidate.measurement, notes: ['Optional composite index; existing object_references target index is reported separately in metadata.'] },
      storage: { candidateIndexBytes: afterBytes.bench_refs_property_target_source ?? 0, databaseBytesBefore: beforeBytes.databaseFile ?? 0, databaseBytesAfter: afterBytes.databaseFile ?? 0 },
      write: { ...flattenMeasurement('insertBaseline', insertBaseline), ...flattenMeasurement('insertCandidate', insertCandidate), ...flattenMeasurement('updateBaseline', updateBaseline), ...flattenMeasurement('updateCandidate', updateCandidate) },
    };
  } finally {
    baselineWrites.cleanup();
    candidateWrites.cleanup();
  }
}

function likePattern(query: string): string {
  return `%${query.replace(/[\\%_]/g, '\\$&')}%`;
}

function safeFtsPhrase(query: string): string | undefined {
  if (query.length < 3 || query.length > 80) return undefined;
  if (!/^[A-Za-z0-9 -]+$/.test(query)) return undefined;
  if (/\b(?:AND|OR|NOT)\b/i.test(query)) return undefined;
  return `"${query.replace(/"/g, '""')}"`;
}

function createSearchTables(db: Database): number {
  const start = performance.now();
  db.query('CREATE TABLE bench_search_key(search_key INTEGER PRIMARY KEY, object_id TEXT NOT NULL UNIQUE)').run();
  db.query("CREATE VIRTUAL TABLE bench_object_search USING fts5(object_id UNINDEXED, title, body_text, tokenize='trigram')").run();
  db.query('INSERT INTO bench_search_key(object_id) SELECT id FROM objects ORDER BY id').run();
  db.query(`INSERT INTO bench_object_search(rowid, object_id, title, body_text)
    SELECT k.search_key, o.id, o.title, o.body_text FROM bench_search_key AS k JOIN objects AS o ON o.id = k.object_id`).run();
  return performance.now() - start;
}

function syncSearchObject(db: Database, objectId: string): void {
  const key = db.query<{ search_key: number }, [string]>('SELECT search_key FROM bench_search_key WHERE object_id = ?').get(objectId);
  if (!key) throw new Error(`Missing search key for ${objectId}`);
  db.query(`UPDATE bench_object_search SET title = (SELECT title FROM objects WHERE id = ?), body_text = (SELECT body_text FROM objects WHERE id = ?) WHERE rowid = ?`).run(objectId, objectId, key.search_key);
}

function baselineSearchIds(fixture: SyntheticFixture, query: string): string[] {
  return fixture.runtime.listObjectSummaries({ search: query, limit: 50 }).map(row => row.id);
}

function candidateSearchIds(db: Database, query: string): { ids: string[]; fallback: boolean } {
  const pattern = likePattern(query);
  const phrase = safeFtsPhrase(query);
  const baselineSql = "SELECT id FROM objects WHERE trashed = 0 AND (? = '' OR title LIKE ? ESCAPE '\\' OR body_text LIKE ? ESCAPE '\\') ORDER BY updated_at DESC, id LIMIT 50";
  if (!phrase) return { ids: db.query<{ id: string }, SqlBinding[]>(baselineSql).all(query, pattern, pattern).map(row => row.id), fallback: true };
  const candidateSql = `SELECT o.id FROM bench_object_search AS s JOIN bench_search_key AS k ON k.search_key = s.rowid JOIN objects AS o ON o.id = k.object_id
    WHERE s.bench_object_search MATCH ? AND o.trashed = 0 AND (o.title LIKE ? ESCAPE '\\' OR o.body_text LIKE ? ESCAPE '\\')
    ORDER BY o.updated_at DESC, o.id LIMIT 50`;
  return { ids: db.query<{ id: string }, SqlBinding[]>(candidateSql).all(phrase, pattern, pattern).map(row => row.id), fallback: false };
}

export function searchCases(fixture: SyntheticFixture): { query: string; fallback: boolean; equivalent: boolean }[] {
  return ['', 'a', 'ab', 'abc', 'Syn', 'Synthetic', 'synthetic', 'Synthetic object', 'two words', '100%', 'under_score_', 'back\\slash', '"quoted"', 'OR ', 'Café', '😀a', 'body-only-needle', 'title-only-needle'].map(query => {
    const candidate = candidateSearchIds(fixture.db, query);
    return { query, fallback: candidate.fallback, equivalent: sameIds(baselineSearchIds(fixture, query), candidate.ids) };
  });
}

function addSearchBoundaryObjects(fixture: SyntheticFixture): { titleId: string; bodyId: string; unicodeId: string; removableId: string } {
  const title = fixture.runtime.createObject({ typeId: PAGE_TYPE_ID, title: 'title-only-needle abc two words 100% under_score_ back\\slash "quoted" OR ', properties: { [fixture.scheduledPropertyId]: '2026-11-03' }, body: '' });
  const body = fixture.runtime.createObject({ typeId: PAGE_TYPE_ID, title: 'body holder', properties: { [fixture.scheduledPropertyId]: '2026-11-04' }, body: 'body-only-needle mixed CASE Café' });
  const unicode = fixture.runtime.createObject({ typeId: PAGE_TYPE_ID, title: 'Emoji needle 😀a', properties: { [fixture.scheduledPropertyId]: '2026-11-05' }, body: '' });
  const removable = fixture.runtime.createObject({ typeId: PAGE_TYPE_ID, title: 'remove-mutation-needle', properties: { [fixture.scheduledPropertyId]: '2026-11-06' }, body: 'old mutation text' });
  return { titleId: title.id, bodyId: body.id, unicodeId: unicode.id, removableId: removable.id };
}

export function searchScenario(fixture: SyntheticFixture, warmups = 1, repetitions = 3): ScenarioResult {
  const db = fixture.db;
  const boundary = addSearchBoundaryObjects(fixture);
  const buildMs = createSearchTables(db);
  const query = 'Synthetic';
  const pattern = likePattern(query);
  const phrase = safeFtsPhrase(query)!;
  const baselineSql = "SELECT id FROM objects WHERE trashed = 0 AND (title LIKE ? ESCAPE '\\' OR body_text LIKE ? ESCAPE '\\') ORDER BY updated_at DESC, id LIMIT 50";
  const candidateSql = `SELECT o.id FROM bench_object_search AS s JOIN bench_search_key AS k ON k.search_key = s.rowid JOIN objects AS o ON o.id = k.object_id
    WHERE s.bench_object_search MATCH ? AND o.trashed = 0 AND (o.title LIKE ? ESCAPE '\\' OR o.body_text LIKE ? ESCAPE '\\')
    ORDER BY o.updated_at DESC, o.id LIMIT 50`;
  const baselineValues: SqlBinding[] = [pattern, pattern];
  const candidateValues: SqlBinding[] = [phrase, pattern, pattern];
  const beforeBytes = dbBytes(db, fixture.file);
  const baseline = measure(warmups, repetitions, () => db.query<{ id: string }, SqlBinding[]>(baselineSql).all(...baselineValues).map(row => row.id));
  const candidate = measure(warmups, repetitions, () => db.query<{ id: string }, SqlBinding[]>(candidateSql).all(...candidateValues).map(row => row.id));
  assertSameIds('search read semantic mismatch', baseline.value, candidate.value);

  const baselineWriteFixture = buildSyntheticFixture({ objects: fixture.options.objects, bodyBytes: fixture.options.bodyBytes, revisions: 0, referenceEvery: fixture.options.referenceEvery, benchmarkProperties: true });
  const insertBaseline = measureWriteSamples(warmups, repetitions, index => baselineWriteFixture.runtime.createObject({ typeId: PAGE_TYPE_ID, title: `baseline search insert ${index}`, properties: { [baselineWriteFixture.scheduledPropertyId]: '2026-11-07' }, body: 'insert-mutation-needle' }));
  const insertCandidate = measureWriteSamples(warmups, repetitions, index => {
    const inserted = fixture.runtime.createObject({ typeId: PAGE_TYPE_ID, title: `candidate search insert ${index}`, properties: { [fixture.scheduledPropertyId]: '2026-11-07' }, body: 'insert-mutation-needle' });
    const newKey = db.query<{ next: number }, []>('SELECT COALESCE(MAX(search_key), 0) + 1 AS next FROM bench_search_key').get()!.next;
    db.query('INSERT INTO bench_search_key(search_key, object_id) VALUES (?, ?)').run(newKey, inserted.id);
    db.query('INSERT INTO bench_object_search(rowid, object_id, title, body_text) SELECT ?, id, title, body_text FROM objects WHERE id = ?').run(newKey, inserted.id);
  });
  const baselineUpdateTarget = baselineWriteFixture.ids.find(id => baselineWriteFixture.runtime.getObject(id).typeId === PAGE_TYPE_ID)!;
  const updateBaseline = measureWriteSamples(warmups, repetitions, () => {
    const object = baselineWriteFixture.runtime.getObject(baselineUpdateTarget);
    baselineWriteFixture.runtime.updateObject(object.id, object.revision, { typeId: object.typeId, title: `${object.title} baseline-update`, properties: object.properties, body: `${object.body}\nupdate-mutation-needle` });
  });
  const updateCandidate = measureWriteSamples(warmups, repetitions, () => {
    const object = fixture.runtime.getObject(boundary.titleId);
    const updated = fixture.runtime.updateObject(object.id, object.revision, { typeId: object.typeId, title: `${object.title} update-mutation-needle`, properties: object.properties, body: object.body });
    syncSearchObject(db, updated.id);
  });
  const removable = fixture.runtime.getObject(boundary.removableId);
  const removed = fixture.runtime.updateObject(removable.id, removable.revision, { typeId: removable.typeId, title: 'removed old search text', properties: removable.properties, body: removable.body.replace('mutation', 'changed') });
  syncSearchObject(db, removed.id);
  const removedCandidate = candidateSearchIds(db, 'remove-mutation-needle').ids;
  const removedBaseline = baselineSearchIds(fixture, 'remove-mutation-needle');
  const trashTarget = fixture.runtime.getObject(boundary.bodyId);
  const trashed = fixture.runtime.setTrashed(trashTarget.id, trashTarget.revision, true);
  syncSearchObject(db, trashed.id);
  const mutationNeedleCandidate = candidateSearchIds(db, 'mutation-needle').ids;
  const mutationNeedleBaseline = baselineSearchIds(fixture, 'mutation-needle');
  const trashedCandidate = candidateSearchIds(db, 'body-only-needle').ids;
  const trashedBaseline = baselineSearchIds(fixture, 'body-only-needle');
  const restored = fixture.runtime.setTrashed(trashed.id, trashed.revision, false);
  syncSearchObject(db, restored.id);
  const restoredCandidate = candidateSearchIds(db, 'body-only-needle').ids;
  const restoredBaseline = baselineSearchIds(fixture, 'body-only-needle');
  assertScenarioEquivalent('search mutation', [['insert/update', mutationNeedleBaseline, mutationNeedleCandidate], ['replacement-removal', removedBaseline, removedCandidate], ['trash', trashedBaseline, trashedCandidate], ['restore', restoredBaseline, restoredCandidate]]);
  const keyRows = db.query<{ mismatches: number }, []>('SELECT COUNT(*) AS mismatches FROM bench_search_key AS k LEFT JOIN bench_object_search AS s ON s.rowid = k.search_key WHERE s.object_id IS NOT k.object_id').get()!.mismatches;
  const cases = searchCases(fixture);
  for (const row of cases) if (!row.equivalent) throw new Error(`search case ${JSON.stringify(row.query)} semantic mismatch`);
  const afterBytes = dbBytes(db, fixture.file);
  baselineWriteFixture.cleanup();
  return {
    name: 'literal-search-fts5-trigram-candidate-plus-like',
    equivalent: true,
    metadata: { query, cases, mutationSynchronized: sameIds(mutationNeedleBaseline, mutationNeedleCandidate), replacementRemovalSynchronized: sameIds(removedBaseline, removedCandidate), trashSynchronized: sameIds(trashedBaseline, trashedCandidate), restoreSynchronized: sameIds(restoredBaseline, restoredCandidate), explicitIntegerKeyMismatches: keyRows, eligibility: 'ASCII letters/digits/space/hyphen, length 3-80, no AND/OR/NOT; every other shape executes LIKE fallback', unicodeBoundaryId: boundary.unicodeId },
    baseline: { ids: baseline.value, plan: explain(db, baselineSql, baselineValues), read: baseline.measurement },
    candidate: { ids: candidate.value, plan: explain(db, candidateSql, candidateValues), read: candidate.measurement, notes: ['FTS MATCH receives a quoted literal phrase only for documented ASCII-safe strings; unsafe, quoted, wildcard, operator and Unicode strings execute the exact LIKE baseline path.'] },
    storage: { ftsBytes: Object.entries(afterBytes).filter(([name]) => name.startsWith('bench_object_search') || name === 'bench_search_key').reduce((sum, [, bytes]) => sum + bytes, 0), databaseBytesBefore: beforeBytes.databaseFile ?? 0, databaseBytesAfter: afterBytes.databaseFile ?? 0 },
    write: { ftsBuildMs: buildMs, ...flattenMeasurement('insertBaseline', insertBaseline), ...flattenMeasurement('insertCandidate', insertCandidate), ...flattenMeasurement('updateBaseline', updateBaseline), ...flattenMeasurement('updateCandidate', updateCandidate), ftsRows: db.query<{ count: number }, []>('SELECT COUNT(*) AS count FROM bench_object_search').get()!.count },
  };
}

function benchmarkFixtureOptions(input: SyntheticFixtureOptions): Required<SyntheticFixtureOptions> {
  return normalizeSyntheticFixtureOptions({ ...input, benchmarkProperties: true });
}

function referenceDistribution(db: Database, propertyId: string) {
  const rows = db.query<{ target_id: string; count: number }, [string]>('SELECT target_id, COUNT(*) AS count FROM object_references WHERE property_id = ? GROUP BY target_id ORDER BY count DESC, target_id LIMIT 5').all(propertyId);
  const arrayLengths = db.query<{ length: number; count: number }, [string]>(`SELECT COALESCE(json_array_length(json_extract(properties_json, '$."${propertyId}"')), 0) AS length, COUNT(*) AS count FROM objects WHERE type_id = '${PAGE_TYPE_ID}' GROUP BY length ORDER BY length`).all(propertyId);
  return { topTargets: rows, arrayLengths };
}

function collectOne(label: string, options: Required<SyntheticFixtureOptions>, bench: Pick<BenchmarkOptions, 'warmups' | 'repetitions'>) {
  const setupFixture = buildSyntheticFixture(options);
  const setupMs = 0;
  try {
    const db = setupFixture.db;
    const sqliteVersion = db.query<{ version: string }, []>('SELECT sqlite_version() AS version').get()!.version;
    const sourceId = db.query<{ source_id: string }, []>('SELECT sqlite_source_id() AS source_id').get()!.source_id;
    const pragmas = { journalMode: db.query<{ journal_mode: string }, []>('PRAGMA journal_mode').get()!.journal_mode, synchronous: db.query<{ synchronous: number }, []>('PRAGMA synchronous').get()!.synchronous, trustedSchema: db.query<{ trusted_schema: number }, []>('PRAGMA trusted_schema').get()!.trusted_schema };
    const distribution = { requestedObjects: options.objects, pageRows: db.query<{ count: number }, []>(`SELECT COUNT(*) AS count FROM objects WHERE type_id = '${PAGE_TYPE_ID}'`).get()!.count, trashedRows: db.query<{ count: number }, []>('SELECT COUNT(*) AS count FROM objects WHERE trashed = 1').get()!.count, referenceRows: db.query<{ count: number }, []>('SELECT COUNT(*) AS count FROM object_references').get()!.count, bodyBytes: options.bodyBytes, revisions: options.revisions, reference: referenceDistribution(db, setupFixture.multiReferencePropertyId) };
    const scenarioOptions = { objects: options.objects, bodyBytes: options.bodyBytes, revisions: options.revisions, referenceEvery: options.referenceEvery, benchmarkProperties: true };
    const propertyFixture = buildSyntheticFixture(scenarioOptions);
    const referenceFixture = buildSyntheticFixture(scenarioOptions);
    const searchFixture = buildSyntheticFixture(scenarioOptions);
    try {
      return { label, fixture: setupFixture.options, setupMs, distribution, engine: { bunVersion: Bun.version, sqliteVersion, sourceId, pragmas }, scenarios: [propertyIndexScenario(propertyFixture, bench.warmups, bench.repetitions), referenceScenario(referenceFixture, bench.warmups, bench.repetitions), searchScenario(searchFixture, bench.warmups, bench.repetitions)] };
    } finally {
      propertyFixture.cleanup();
      referenceFixture.cleanup();
      searchFixture.cleanup();
    }
  } finally {
    setupFixture.cleanup();
  }
}

export function collectBenchmarkReport(options: BenchmarkOptions) {
  return {
    generatedAt: new Date().toISOString(),
    command: { options },
    scales: [
      collectOne('default/modest-writing-sparse-references', benchmarkFixtureOptions({ objects: options.objects, bodyBytes: options.bodyBytes, revisions: options.revisions, referenceEvery: options.referenceEvery }), options),
      collectOne('larger-writing-dense-references', benchmarkFixtureOptions({ objects: options.largeObjects, bodyBytes: Math.max(options.bodyBytes, 2048), revisions: options.revisions, referenceEvery: Math.max(1, Math.min(2, options.referenceEvery)) }), options),
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
