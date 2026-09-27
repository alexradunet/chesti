import type { Database } from 'bun:sqlite';
import { existsSync, statSync } from 'node:fs';
import { buildSyntheticFixture, normalizeSyntheticFixtureOptions } from './sqlite-fixture.js';
import type { SyntheticFixture, SyntheticFixtureOptions } from './sqlite-fixture.js';
import { PAGE_TYPE_ID } from '../src/objects/model.js';
import type { PropertyValue, ViewSpec } from '../src/objects/model.js';
import { ViewService } from '../src/objects/views.js';

type SqlBinding = string | number | null;
interface Timed<T> { value: T; milliseconds: number }
interface Measurement { medianMs: number; p95Ms: number; rangeMs: [number, number] }
interface ScenarioResult {
  name: string;
  equivalent: boolean;
  metadata: Record<string, unknown>;
  baseline: { ids: string[]; plan: string[]; read: Measurement };
  candidate: { ids: string[]; plan: string[]; read: Measurement; notes?: string[] };
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

const LIMITS = {
  objects: 10_000,
  largeObjects: 10_000,
  bodyBytes: 16_384,
  revisions: 10,
  referenceEvery: 1_000,
  repetitions: 50,
  warmups: 20,
};

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
      if (flag === '--database' || flag === '--db' || flag === '--path' || flag === '--database-path') throw new Error('sqlite:bench creates owned temporary synthetic databases only; existing database paths are not accepted.');
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
    else if (flag === '--database' || flag === '--db' || flag === '--path' || flag === '--database-path') throw new Error('sqlite:bench creates owned temporary synthetic databases only; existing database paths are not accepted.');
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
  return { value, measurement: { medianMs: median, p95Ms: p95, rangeMs: [sorted[0] ?? 0, sorted.at(-1) ?? 0] } };
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

function idsFromView(fixture: SyntheticFixture, spec: ViewSpec): string[] {
  const service = new ViewService(fixture.runtime);
  const view = service.create({ spec, model: 'synthetic/benchmark' }, 'synthetic benchmark view');
  return service.evaluate(view.id).blocks[0]!.rows.map(row => row.object.id);
}

function sameIds(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((id, index) => id === right[index]);
}

export function propertyIndexScenario(fixture: SyntheticFixture, warmups = 1, repetitions = 3): ScenarioResult {
  const db = fixture.db;
  const path = `$."${fixture.scheduledPropertyId}"`;
  const spec: ViewSpec = {
    title: 'Scheduled pages',
    blocks: [{
      title: 'Scheduled pages', component: 'table', columns: [{ role: 'date', label: 'Date' }],
      sources: [{ typeId: PAGE_TYPE_ID, bindings: { date: fixture.scheduledPropertyId }, where: [{ propertyId: fixture.scheduledPropertyId, operator: 'after', value: '2026-11-14' }], orderBy: { propertyId: fixture.scheduledPropertyId, direction: 'ascending' } }],
    }],
  };
  const baselineSql = `SELECT o.id FROM objects AS o WHERE (o.trashed = 0) AND (o.type_id = ?) AND (json_extract(o.properties_json, ?) > ?) ORDER BY json_extract(o.properties_json, ?) ASC, o.title COLLATE NOCASE ASC, o.id ASC LIMIT 101`;
  const baselineValues: SqlBinding[] = [PAGE_TYPE_ID, path, '2026-11-14', path];
  const baseline = measure(warmups, repetitions, () => db.query<{ id: string }, SqlBinding[]>(baselineSql).all(...baselineValues).map(row => row.id));
  const baselinePlan = explain(db, baselineSql, baselineValues);
  const viewIds = idsFromView(fixture, spec);
  const beforeBytes = dbBytes(db, fixture.file);
  const insertBefore = time(() => fixture.runtime.createObject({ typeId: PAGE_TYPE_ID, title: 'Bench write before index', properties: { [fixture.scheduledPropertyId]: '2026-11-01', [fixture.statusPropertyId]: 'bench', [fixture.scorePropertyId]: 0, [fixture.flagPropertyId]: false }, body: '' })).milliseconds;
  db.query(`CREATE INDEX bench_property_scheduled ON objects(type_id, trashed, json_extract(properties_json, '${path}'))`).run();
  db.query('ANALYZE').run();
  const afterBytes = dbBytes(db, fixture.file);
  const insertAfter = time(() => fixture.runtime.createObject({ typeId: PAGE_TYPE_ID, title: 'Bench write after index', properties: { [fixture.scheduledPropertyId]: '2026-11-01', [fixture.statusPropertyId]: 'bench', [fixture.scorePropertyId]: 0, [fixture.flagPropertyId]: false }, body: '' })).milliseconds;
  const candidate = measure(warmups, repetitions, () => db.query<{ id: string }, SqlBinding[]>(baselineSql).all(...baselineValues).map(row => row.id));
  return {
    name: 'property-path-expression-index',
    equivalent: sameIds(viewIds, baseline.value.slice(0, 100)) && sameIds(baseline.value, candidate.value),
    metadata: { propertyId: fixture.scheduledPropertyId, predicate: 'date after 2026-11-14', viewRows: viewIds.length },
    baseline: { ids: baseline.value, plan: baselinePlan, read: baseline.measurement },
    candidate: { ids: candidate.value, plan: explain(db, baselineSql, baselineValues), read: candidate.measurement },
    storage: { indexAndStatsBytes: (afterBytes.bench_property_scheduled ?? 0) + (afterBytes.sqlite_stat1 ?? 0), databaseBytesBefore: beforeBytes.databaseFile ?? 0, databaseBytesAfter: afterBytes.databaseFile ?? 0 },
    write: { insertBeforeIndexMs: insertBefore, insertAfterIndexMs: insertAfter },
  };
}

export function referenceScenario(fixture: SyntheticFixture, warmups = 1, repetitions = 3): ScenarioResult {
  const db = fixture.db;
  const target = db.query<{ target_id: string }, [string]>('SELECT target_id FROM object_references WHERE property_id = ? LIMIT 1').get(fixture.multiReferencePropertyId)?.target_id;
  if (!target) throw new Error('Fixture did not create a multiple-reference edge. Lower --reference-every or increase --objects.');
  const path = `$."${fixture.multiReferencePropertyId}"`;
  const spec: ViewSpec = { title: 'Reference pages', blocks: [{ title: 'Reference pages', component: 'table', columns: [{ role: 'related', label: 'Related' }], sources: [{ typeId: PAGE_TYPE_ID, bindings: { related: fixture.multiReferencePropertyId }, where: [{ propertyId: fixture.multiReferencePropertyId, operator: 'contains', value: target }] }] }] };
  const baselineSql = `SELECT o.id FROM objects AS o WHERE (o.trashed = 0) AND (o.type_id = ?) AND (EXISTS (SELECT 1 FROM json_each(json_extract(o.properties_json, ?)) AS member WHERE member.value COLLATE NOCASE = ?)) ORDER BY o.title COLLATE NOCASE ASC, o.id ASC LIMIT 101`;
  const baselineValues: SqlBinding[] = [PAGE_TYPE_ID, path, target];
  const candidateSql = `SELECT o.id FROM objects AS o WHERE o.trashed = 0 AND o.type_id = ? AND EXISTS (SELECT 1 FROM object_references AS r WHERE r.source_id = o.id AND r.property_id = ? AND r.target_id COLLATE NOCASE = ?) ORDER BY o.title COLLATE NOCASE ASC, o.id ASC LIMIT 101`;
  const candidateValues: SqlBinding[] = [PAGE_TYPE_ID, fixture.multiReferencePropertyId, target];
  const baseline = measure(warmups, repetitions, () => db.query<{ id: string }, SqlBinding[]>(baselineSql).all(...baselineValues).map(row => row.id));
  const beforeBytes = dbBytes(db, fixture.file);
  db.query('CREATE INDEX bench_refs_property_target_source ON object_references(property_id, target_id COLLATE NOCASE, source_id)').run();
  db.query('ANALYZE').run();
  const afterBytes = dbBytes(db, fixture.file);
  const candidate = measure(warmups, repetitions, () => db.query<{ id: string }, SqlBinding[]>(candidateSql).all(...candidateValues).map(row => row.id));
  const viewIds = idsFromView(fixture, spec);
  return {
    name: 'reference-edge-membership',
    equivalent: sameIds(viewIds, baseline.value) && sameIds(baseline.value, candidate.value),
    metadata: { propertyId: fixture.multiReferencePropertyId, targetId: target, writingEdgesExcludedByPropertyId: true },
    baseline: { ids: baseline.value, plan: explain(db, baselineSql, baselineValues), read: baseline.measurement },
    candidate: { ids: candidate.value, plan: explain(db, candidateSql, candidateValues), read: candidate.measurement },
    storage: { candidateIndexBytes: afterBytes.bench_refs_property_target_source ?? 0, databaseBytesBefore: beforeBytes.databaseFile ?? 0, databaseBytesAfter: afterBytes.databaseFile ?? 0 },
    write: { indexMaintainedByCanonicalRuntime: 1 },
  };
}

function likePattern(query: string): string {
  return `%${query.replace(/[\\%_]/g, '\\$&')}%`;
}

function eligibleFtsQuery(query: string): boolean {
  return /^[A-Za-z0-9 ]{3,80}$/.test(query);
}

export function searchScenario(fixture: SyntheticFixture, warmups = 1, repetitions = 3): ScenarioResult {
  const db = fixture.db;
  db.query("CREATE VIRTUAL TABLE bench_object_search USING fts5(search_key UNINDEXED, object_id UNINDEXED, title, body_text, tokenize='trigram')").run();
  db.query(`INSERT INTO bench_object_search(search_key, object_id, title, body_text)
    SELECT row_number() OVER (ORDER BY id), id, title, body_text FROM objects`).run();
  const query = 'Synthetic';
  const pattern = likePattern(query);
  const baselineSql = "SELECT id FROM objects WHERE trashed = 0 AND (title LIKE ? ESCAPE '\\' OR body_text LIKE ? ESCAPE '\\') ORDER BY updated_at DESC, id LIMIT 50";
  const baselineValues: SqlBinding[] = [pattern, pattern];
  const candidateSql = `SELECT o.id FROM bench_object_search AS s JOIN objects AS o ON o.id = s.object_id
    WHERE s.bench_object_search MATCH ? AND o.trashed = 0 AND (o.title LIKE ? ESCAPE '\\' OR o.body_text LIKE ? ESCAPE '\\')
    ORDER BY o.updated_at DESC, o.id LIMIT 50`;
  const candidateValues: SqlBinding[] = [query, pattern, pattern];
  const beforeBytes = dbBytes(db, fixture.file);
  const baseline = measure(warmups, repetitions, () => db.query<{ id: string }, SqlBinding[]>(baselineSql).all(...baselineValues).map(row => row.id));
  const candidate = eligibleFtsQuery(query)
    ? measure(warmups, repetitions, () => db.query<{ id: string }, SqlBinding[]>(candidateSql).all(...candidateValues).map(row => row.id))
    : { value: baseline.value, measurement: baseline.measurement };
  const updated = fixture.runtime.getObject(fixture.ids.find(id => fixture.runtime.getObject(id).typeId === PAGE_TYPE_ID)!);
  const next = fixture.runtime.updateObject(updated.id, updated.revision, { typeId: updated.typeId, title: `${updated.title} needle`, properties: updated.properties, body: updated.body });
  db.query('UPDATE bench_object_search SET title = ?, body_text = (SELECT body_text FROM objects WHERE id = ?) WHERE object_id = ?').run(next.title, next.id, next.id);
  const trashed = fixture.runtime.getObject(fixture.ids.find(id => id !== next.id)!);
  fixture.runtime.setTrashed(trashed.id, trashed.revision, true);
  const afterMutationBaseline = fixture.runtime.listObjectSummaries({ search: 'needle', limit: 50 }).map(row => row.id);
  const afterMutationCandidate = db.query<{ id: string }, SqlBinding[]>(candidateSql).all('needle', likePattern('needle'), likePattern('needle')).map(row => row.id);
  const afterBytes = dbBytes(db, fixture.file);
  return {
    name: 'literal-search-fts5-trigram-candidate-plus-like',
    equivalent: sameIds(baseline.value, candidate.value) && sameIds(afterMutationBaseline, afterMutationCandidate),
    metadata: { query, fallbackQueries: ['a', 'é', '%', '_', '\\', ''], candidateRequiresSimpleAsciiAtLeast3: true, mutationSynchronized: sameIds(afterMutationBaseline, afterMutationCandidate) },
    baseline: { ids: baseline.value, plan: explain(db, baselineSql, baselineValues), read: baseline.measurement },
    candidate: { ids: candidate.value, plan: eligibleFtsQuery(query) ? explain(db, candidateSql, candidateValues) : ['baseline fallback'], read: candidate.measurement, notes: ['Exact LIKE ESCAPE remains the authority after FTS candidate retrieval.'] },
    storage: { ftsBytes: Object.entries(afterBytes).filter(([name]) => name.startsWith('bench_object_search')).reduce((sum, [, bytes]) => sum + bytes, 0), databaseBytesBefore: beforeBytes.databaseFile ?? 0, databaseBytesAfter: afterBytes.databaseFile ?? 0 },
    write: { ftsRows: db.query<{ count: number }, []>('SELECT COUNT(*) AS count FROM bench_object_search').get()!.count },
  };
}

function collectOne(options: Required<SyntheticFixtureOptions>, bench: Pick<BenchmarkOptions, 'warmups' | 'repetitions'>) {
  const fixture = buildSyntheticFixture(options);
  try {
    const db = fixture.db;
    const sqliteVersion = db.query<{ version: string }, []>('SELECT sqlite_version() AS version').get()!.version;
    const sourceId = db.query<{ source_id: string }, []>('SELECT sqlite_source_id() AS source_id').get()!.source_id;
    const pragmas = {
      journalMode: db.query<{ journal_mode: string }, []>('PRAGMA journal_mode').get()!.journal_mode,
      synchronous: db.query<{ synchronous: number }, []>('PRAGMA synchronous').get()!.synchronous,
      trustedSchema: db.query<{ trusted_schema: number }, []>('PRAGMA trusted_schema').get()!.trusted_schema,
    };
    return {
      fixture: fixture.options,
      engine: { bunVersion: Bun.version, sqliteVersion, sourceId, pragmas },
      scenarios: [propertyIndexScenario(fixture, bench.warmups, bench.repetitions), referenceScenario(fixture, bench.warmups, bench.repetitions), searchScenario(fixture, bench.warmups, bench.repetitions)],
    };
  } finally {
    fixture.cleanup();
  }
}

export function collectBenchmarkReport(options: BenchmarkOptions) {
  return {
    generatedAt: new Date().toISOString(),
    command: { options },
    scales: [
      collectOne(normalizeSyntheticFixtureOptions({ objects: options.objects, bodyBytes: options.bodyBytes, revisions: options.revisions, referenceEvery: options.referenceEvery }), options),
      collectOne(normalizeSyntheticFixtureOptions({ objects: options.largeObjects, bodyBytes: options.bodyBytes, revisions: options.revisions, referenceEvery: options.referenceEvery }), options),
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
