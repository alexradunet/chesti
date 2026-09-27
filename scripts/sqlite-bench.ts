import type { Database } from 'bun:sqlite';
import { buildSyntheticFixture, normalizeSyntheticFixtureOptions, syntheticWriting } from './sqlite-fixture.js';
import type { SyntheticFixture, SyntheticFixtureOptions } from './sqlite-fixture.js';
import { PAGE_TYPE_ID } from '../src/objects/model.js';
import type { ObjectWrite, ViewSpec } from '../src/objects/model.js';
import { ViewService } from '../src/objects/views.js';

type Binding = string | number | null;
export interface Measurement { medianMs: number; p95Ms: number; rangeMs: [number, number]; samples: number }
export interface BenchmarkOptions {
  objects: number; largeObjects: number; bodyBytes: number; revisions: number;
  referenceEvery: number; repetitions: number; warmups: number;
}
const LIMITS = { objects: 10_000, largeObjects: 10_000, bodyBytes: 16_384, revisions: 10, referenceEvery: 1_000, repetitions: 50, warmups: 20 };
export function parseArgs(args: string[]): BenchmarkOptions {
  const options: BenchmarkOptions = { objects: 1000, largeObjects: 10_000, bodyBytes: 384, revisions: 1, referenceEvery: 7, repetitions: 9, warmups: 2 };
  const flags: Record<string, keyof BenchmarkOptions> = { objects: 'objects', 'large-objects': 'largeObjects', 'body-bytes': 'bodyBytes', revisions: 'revisions', 'reference-every': 'referenceEvery', repetitions: 'repetitions', warmups: 'warmups' };
  for (const arg of args) {
    if (/^--(?:database|db|path|database-path)(?:=|$)/.test(arg)) throw new Error('sqlite:bench creates owned temporary synthetic databases only; existing database paths are not accepted.');
    const match = /^--([a-z-]+)=(\d+)$/.exec(arg);
    const key = match && flags[match[1]!];
    if (!match || !key) throw new Error(`Unknown or incomplete flag: ${arg}`);
    const value = Number(match[2]);
    const minimum = ['bodyBytes', 'revisions', 'warmups'].includes(key) ? 0 : 1;
    if (!Number.isInteger(value) || value < minimum || value > LIMITS[key]) throw new Error(`${key} must be an integer from ${minimum} to ${LIMITS[key]}.`);
    options[key] = value;
  }
  return options;
}
function timed<T>(fn: () => T) {
  const start = performance.now();
  const value = fn();
  return { value, milliseconds: performance.now() - start };
}
function statistics(samples: number[]): Measurement {
  const sorted = [...samples].sort((a, b) => a - b);
  return { medianMs: sorted[Math.floor(sorted.length / 2)]!, p95Ms: sorted[Math.ceil(sorted.length * 0.95) - 1]!, rangeMs: [sorted[0]!, sorted.at(-1)!], samples: sorted.length };
}
function measure(warmups: number, repetitions: number, fn: () => unknown): Measurement {
  for (let i = 0; i < warmups; i++) fn();
  return statistics(Array.from({ length: repetitions }, () => timed(fn).milliseconds));
}
// Alternate the measured execution order, not just the labels, on every sample.
function pairedReads(warmups: number, repetitions: number, baseline: () => unknown, candidate: () => unknown) {
  const samples: number[][] = [[], []];
  for (let i = -warmups; i < repetitions; i++) {
    for (const side of i % 2 === 0 ? [0, 1] : [1, 0]) {
      const result = timed(side === 0 ? baseline : candidate);
      if (i >= 0) samples[side]!.push(result.milliseconds);
    }
  }
  return { baseline: statistics(samples[0]!), candidate: statistics(samples[1]!) };
}
function explain(db: Database, sql: string, values: Binding[]) {
  // Bun's cached EXPLAIN statements can retain a schema lock even after all().
  // Plans are untimed diagnostics; finalize them before toggling candidate DDL.
  const statement = db.prepare<{ detail: string }, Binding[]>(`EXPLAIN QUERY PLAN ${sql}`);
  try {
    return statement.all(...values).map(row => row.detail);
  } finally {
    statement.finalize();
  }
}
function ids(db: Database, sql: string, values: Binding[]) {
  return db.query<{ id: string }, Binding[]>(sql).all(...values).map(row => row.id);
}
function bytes(db: Database, names: string[]): number {
  const rows = db.query<{ name: string; bytes: number }, []>('SELECT name, SUM(pgsize) AS bytes FROM dbstat GROUP BY name').all();
  return rows.filter(row => names.includes(row.name)).reduce((sum, row) => sum + row.bytes, 0);
}
export function assertSameIds(label: string, left: string[], right: string[]) {
  if (left.length !== right.length || left.some((id, index) => id !== right[index])) throw new Error(`${label} semantic mismatch: ${left.length} versus ${right.length} rows`);
}
function viewIds(f: SyntheticFixture, spec: ViewSpec) {
  const service = new ViewService(f.runtime);
  const saved = service.create({ spec, model: 'synthetic/benchmark' }, 'Synthetic benchmark');
  const block = service.evaluate(saved.id).blocks[0]!;
  if (block.error) throw new Error(block.error);
  return { displayed: block.rows.map(row => row.object.id), truncated: block.truncated };
}
function verifyView(label: string, view: ReturnType<typeof viewIds>, sqlIds: string[]) {
  assertSameIds(label, view.displayed, sqlIds.slice(0, 100));
  if (view.truncated !== (sqlIds.length > 100)) throw new Error(`${label} truncation mismatch`);
}
const projection = 'o.id, o.type_id, o.title, o.properties_json, o.revision, o.created_at, o.updated_at, o.trashed';
const ordering = ' ORDER BY source_index ASC, sort_missing ASC, sort_ascending ASC, sort_descending DESC, title COLLATE NOCASE ASC, id ASC LIMIT 101';
const path = (id: string) => `$.${JSON.stringify(id)}`;
const expression = (id: string) => `json_extract(o.properties_json, '${path(id)}')`;
export function propertyIndexSql(f: SyntheticFixture) {
  return `CREATE INDEX bench_property_scheduled ON objects(type_id, trashed, json_extract(properties_json, '${path(f.scheduledPropertyId)}'))`;
}
const referenceIndexSql = 'CREATE INDEX bench_refs_property_target_source ON object_references(property_id, target_id COLLATE NOCASE, source_id)';

// All phases use ONE owning database and the exact same input/history. Per-sample
// savepoints restore state OUTSIDE the timer. Probe setup is committed before either
// phase; candidate DDL is also committed before sampling to avoid schema reprepare
// costs caused by rolling back samples under an uncommitted schema change.
function writeSamples(f: SyntheticFixture, warmups: number, repetitions: number, write: () => string, inspect: (id: string) => unknown) {
  const samples: number[] = [];
  let observed: unknown;
  for (let i = -warmups; i < repetitions; i++) {
    f.db.exec('SAVEPOINT bench_sample');
    try {
      const result = timed(write);
      observed = inspect(result.value);
      if (i >= 0) samples.push(result.milliseconds);
    } finally {
      f.db.exec('ROLLBACK TO bench_sample; RELEASE bench_sample');
    }
  }
  return { timing: statistics(samples), observed };
}
export function writeComparison(f: SyntheticFixture, kind: 'property' | 'reference' | 'search', warmups: number, repetitions: number) {
  const db = f.db;
  let built = false;
  try {
    // A live private target avoids newly adding a reference to a trashed read target.
    const target = f.runtime.createObject({ typeId: PAGE_TYPE_ID, title: 'Write-only target', properties: {}, body: '' });
    const initial: ObjectWrite = { typeId: PAGE_TYPE_ID, title: 'Measured initial', properties: { [f.scheduledPropertyId]: '2026-11-14' }, body: syntheticWriting(0, f.options.bodyBytes) };
    let probe = f.runtime.createObject(initial);
    for (let revision = 0; revision < f.options.revisions; revision++) probe = f.runtime.updateObject(probe.id, probe.revision, { ...initial, title: `Measured history ${revision}` });
    const input: ObjectWrite = { typeId: PAGE_TYPE_ID, title: 'Measured changed title', properties: { [f.scheduledPropertyId]: '2026-11-28', [f.multiReferencePropertyId]: [target.id] }, body: syntheticWriting(1, f.options.bodyBytes) };
    const inspect = (id: string) => {
      const value = db.query<{ value: string }, [string]>(`SELECT json_extract(properties_json, '${path(f.scheduledPropertyId)}') AS value FROM objects WHERE id = ?`).get(id)!.value;
      if (value !== '2026-11-28') throw new Error('Measured property update did not change expression value');
      return value;
    };
    const phase = (candidate: boolean) => ({
      insert: writeSamples(f, warmups, repetitions, () => {
        const object = f.runtime.createObject(input);
        if (candidate && kind === 'search') insertSearchObject(db, object.id);
        return object.id;
      }, inspect),
      update: writeSamples(f, warmups, repetitions, () => {
        const object = f.runtime.updateObject(probe.id, probe.revision, input);
        if (candidate && kind === 'search') syncSearchObject(db, object.id);
        return object.id;
      }, inspect),
    });
    const baseline = phase(false);
    let ddl: string;
    if (kind === 'property') {
      ddl = propertyIndexSql(f);
      db.exec(ddl);
    } else if (kind === 'reference') {
      ddl = referenceIndexSql;
      db.exec(ddl);
    } else {
      ddl = 'bench_search_key INTEGER PRIMARY KEY + FTS5 trigram';
      createSearchTables(db);
    }
    built = true;
    const candidate = phase(true);
    return { setupRecords: 2, scope: 'Canonical insert/update and candidate maintenance only; excludes probe setup, outer commit/rollback/fsync and inspection. Fixed baseline phase then candidate phase, identical restored state per sample. Candidate DDL commits before samples.', initialRevision: probe.revision, initialHistoryRows: f.options.revisions, input: { title: input.title, properties: input.properties, bodyBytes: Buffer.byteLength(input.body) }, ddl, baseline, candidate };
  } finally {
    if (built) {
      if (kind === 'property') db.exec('DROP INDEX bench_property_scheduled');
      else if (kind === 'reference') db.exec('DROP INDEX bench_refs_property_target_source');
      else db.exec('DROP TABLE bench_object_search; DROP TABLE bench_search_key');
    }
  }
}

export function propertyIndexScenario(f: SyntheticFixture, warmups = 1, repetitions = 3) {
  const db = f.db;
  const field = expression(f.scheduledPropertyId);
  const definitions = [
    { label: 'common-type-common-date', typeId: PAGE_TYPE_ID, threshold: '2026-11-14' },
    { label: 'common-type-rare-date', typeId: PAGE_TYPE_ID, threshold: '2026-11-27' },
    { label: 'rare-type-date', typeId: f.rareTypeId, threshold: '2026-11-20' },
  ];
  const cases = definitions.map(definition => {
    const { label, typeId, threshold } = definition;
    const spec: ViewSpec = { title: label, blocks: [{ title: label, component: 'table', columns: [{ role: 'date', label: 'Date' }], sources: [{ typeId, bindings: { date: f.scheduledPropertyId }, where: [{ propertyId: f.scheduledPropertyId, operator: 'after', value: threshold }], orderBy: { propertyId: f.scheduledPropertyId, direction: 'ascending' } }] }] };
    const sql = `SELECT ${projection}, 0 AS source_index, CASE WHEN (${field} IS NULL OR ${field} = '') THEN 1 ELSE 0 END AS sort_missing, ${field} AS sort_ascending, NULL AS sort_descending FROM objects AS o WHERE ((o.trashed = 0) AND (o.type_id = ?) AND (${field} > ?))${ordering}`;
    const values: Binding[] = [typeId, threshold];
    const view = viewIds(f, spec);
    const baselineIds = ids(db, sql, values);
    verifyView(label, view, baselineIds);
    return { ...definition, sql, values, view, ids: baselineIds, matchCount: db.query<{ n: number }, Binding[]>(`SELECT COUNT(*) AS n FROM objects o WHERE o.trashed = 0 AND o.type_id = ? AND ${field} > ?`).get(...values)!.n, beforeStatistics: explain(db, sql, values) };
  });
  db.exec('ANALYZE');
  const baseline = cases.map(c => ({ plan: explain(db, c.sql, c.values), read: measure(warmups, repetitions, () => ids(db, c.sql, c.values)) }));
  const ddl = propertyIndexSql(f);
  db.exec('SAVEPOINT bench_property');
  try {
    const buildMs = timed(() => db.exec(ddl)).milliseconds;
    const beforeStatistics = cases.map(c => explain(db, c.sql, c.values));
    db.exec('ANALYZE');
    const results = cases.map((c, index) => {
      const candidateIds = ids(db, c.sql, c.values);
      assertSameIds(c.label, c.ids, candidateIds);
      return { ...c, baseline: baseline[index]!, candidate: { ids: candidateIds, beforeStatistics: beforeStatistics[index]!, plan: explain(db, c.sql, c.values), read: measure(warmups, repetitions, () => ids(db, c.sql, c.values)) } };
    });
    return { name: 'property-expression-index', equivalent: true, phaseOrder: 'Fixed analyzed baseline, build, candidate before-statistics plan, ANALYZE, candidate reads; same SQL/state.', ddl, buildMs, storageBytes: bytes(db, ['bench_property_scheduled']), cases: results };
  } finally {
    db.exec('ROLLBACK TO bench_property; RELEASE bench_property');
  }
}

export function referenceScenario(f: SyntheticFixture, warmups = 1, repetitions = 3, selectedTargets?: string[]) {
  const db = f.db;
  const targets = db.query<{ target_id: string; n: number }, [string, string]>(`SELECT r.target_id, COUNT(*) AS n FROM object_references r JOIN objects o ON o.id = r.source_id WHERE r.property_id = ? AND o.type_id = ? AND o.trashed = 0 GROUP BY r.target_id ORDER BY n DESC, r.target_id`).all(f.multiReferencePropertyId, PAGE_TYPE_ID);
  if (!targets.length && !selectedTargets) throw new Error('Fixture has no live multiple-reference matches; increase --objects or lower --reference-every.');
  const chosen = selectedTargets ?? [...new Set([targets[0]!.target_id, targets.at(-1)!.target_id])];
  const cases = chosen.map((target, index) => {
    const select = `SELECT ${projection}, 0 AS source_index, 0 AS sort_missing, NULL AS sort_ascending, NULL AS sort_descending FROM objects AS o WHERE o.trashed = 0 AND o.type_id = ? AND `;
    const jsonSql = `${select}EXISTS (SELECT 1 FROM json_each(${expression(f.multiReferencePropertyId)}) member WHERE member.value COLLATE NOCASE = ?)${ordering}`;
    const edgeSql = `${select}EXISTS (SELECT 1 FROM object_references r WHERE r.source_id = o.id AND r.property_id = ? AND r.target_id COLLATE NOCASE = ?)${ordering}`;
    const targetFirstSql = `${select}o.id IN (SELECT source_id FROM object_references WHERE property_id = ? AND target_id = ?)${ordering}`;
    const jsonValues: Binding[] = [PAGE_TYPE_ID, target.toUpperCase()];
    const edgeValues: Binding[] = [PAGE_TYPE_ID, f.multiReferencePropertyId, target.toUpperCase()];
    const targetFirstValues: Binding[] = [PAGE_TYPE_ID, f.multiReferencePropertyId, target.toUpperCase()];
    const spec: ViewSpec = { title: 'Reference', blocks: [{ title: 'Reference', component: 'list', sources: [{ typeId: PAGE_TYPE_ID, bindings: {}, where: [{ propertyId: f.multiReferencePropertyId, operator: 'contains', value: target }] }] }] };
    const view = viewIds(f, spec);
    const baselineIds = ids(db, jsonSql, jsonValues);
    verifyView('reference', view, baselineIds);
    assertSameIds('reference existing-edge', baselineIds, ids(db, edgeSql, edgeValues));
    assertSameIds('reference target-first', baselineIds, ids(db, targetFirstSql, targetFirstValues));
    const matchCount = db.query<{ n: number }, Binding[]>(`SELECT COUNT(*) AS n FROM objects o WHERE o.trashed = 0 AND o.type_id = ? AND EXISTS (SELECT 1 FROM json_each(${expression(f.multiReferencePropertyId)}) member WHERE member.value COLLATE NOCASE = ?)`).get(...jsonValues)!.n;
    const targetFirstCount = db.query<{ n: number }, Binding[]>(`SELECT COUNT(*) AS n FROM objects o WHERE o.trashed = 0 AND o.type_id = ? AND o.id IN (SELECT source_id FROM object_references WHERE property_id = ? AND target_id = ?)`).get(...targetFirstValues)!.n;
    const edgeCount = targets.find(row => row.target_id.toLowerCase() === target.toLowerCase())?.n ?? 0;
    if (matchCount !== edgeCount || matchCount !== targetFirstCount) throw new Error('reference full-count semantic mismatch');
    return { label: index === 0 ? 'common-target' : 'rare-target', target, matchCount, targetFirstCount, view, ids: baselineIds, jsonSql, edgeSql, targetFirstSql, jsonValues, edgeValues, targetFirstValues, beforeStatistics: { json: explain(db, jsonSql, jsonValues), existing: explain(db, edgeSql, edgeValues), targetFirst: explain(db, targetFirstSql, targetFirstValues) } };
  });
  db.exec('ANALYZE');
  const existing = cases.map(c => ({ plan: explain(db, c.edgeSql, c.edgeValues), baselinePlan: explain(db, c.jsonSql, c.jsonValues), reads: pairedReads(warmups, repetitions, () => ids(db, c.jsonSql, c.jsonValues), () => ids(db, c.edgeSql, c.edgeValues)), addedStorageBytes: 0, buildMs: 0, buildScope: 'No additional schema to build; canonical reference maintenance already occurs in both sides.' }));
  const targetFirst = cases.map(c => {
    const targetIds = ids(db, c.targetFirstSql, c.targetFirstValues);
    assertSameIds('reference target-first existing-index', c.ids, targetIds);
    const plan = explain(db, c.targetFirstSql, c.targetFirstValues);
    return { ids: targetIds, plan, usesExistingTargetIndex: plan.some(detail => detail.includes('object_references_target')), reads: pairedReads(warmups, repetitions, () => ids(db, c.jsonSql, c.jsonValues), () => ids(db, c.targetFirstSql, c.targetFirstValues)), addedStorageBytes: 0, buildMs: 0, buildScope: 'Adopted query-only target-first candidate using existing canonical target edges; no additional DDL.' };
  });
  db.exec('SAVEPOINT bench_reference');
  try {
    const buildMs = timed(() => db.exec(referenceIndexSql)).milliseconds;
    const beforeStatistics = cases.map(c => explain(db, c.edgeSql, c.edgeValues));
    db.exec('ANALYZE');
    const results = cases.map((c, index) => {
      const candidateIds = ids(db, c.edgeSql, c.edgeValues);
      assertSameIds('reference composite', c.ids, candidateIds);
      return { ...c, existing: existing[index]!, targetFirst: targetFirst[index]!, composite: { ids: candidateIds, beforeStatistics: beforeStatistics[index]!, plan: explain(db, c.edgeSql, c.edgeValues), reads: pairedReads(warmups, repetitions, () => ids(db, c.jsonSql, c.jsonValues), () => ids(db, c.edgeSql, c.edgeValues)) } };
    });
    return { name: 'reference-membership', equivalent: true, buildMs, storageBytes: bytes(db, ['bench_refs_property_target_source']), cases: results };
  } finally {
    db.exec('ROLLBACK TO bench_reference; RELEASE bench_reference');
  }
}

function likePattern(query: string) { return `%${query.replace(/[\\%_]/g, '\\$&')}%`; }
function phrase(query: string): string | undefined {
  if (query.length < 3 || query.length > 80 || !/^[A-Za-z0-9 -]+$/.test(query) || /\b(?:AND|OR|NOT)\b/i.test(query)) return undefined;
  return `"${query}"`;
}
const searchBaselineSql = "SELECT id FROM objects WHERE trashed = 0 AND (title LIKE ? ESCAPE '\\' OR body_text LIKE ? ESCAPE '\\') ORDER BY updated_at DESC, id LIMIT 50";
const searchEmptySql = 'SELECT id FROM objects WHERE trashed = 0 ORDER BY updated_at DESC, id LIMIT 50';
const searchCandidateSql = `SELECT o.id FROM bench_object_search s JOIN bench_search_key k ON k.search_key = s.rowid JOIN objects o ON o.id = k.object_id WHERE s.bench_object_search MATCH ? AND o.trashed = 0 AND (o.title LIKE ? ESCAPE '\\' OR o.body_text LIKE ? ESCAPE '\\') ORDER BY o.updated_at DESC, o.id LIMIT 50`;
export function candidateSearchIds(db: Database, query: string) {
  const safe = phrase(query);
  const pattern = likePattern(query);
  if (safe) return { ids: ids(db, searchCandidateSql, [safe, pattern, pattern]), fallback: false };
  return { ids: ids(db, query ? searchBaselineSql : searchEmptySql, query ? [pattern, pattern] : []), fallback: true };
}
export function createSearchTables(db: Database) {
  db.exec('CREATE TABLE bench_search_key(search_key INTEGER PRIMARY KEY, object_id TEXT NOT NULL UNIQUE)');
  db.exec("CREATE VIRTUAL TABLE bench_object_search USING fts5(object_id UNINDEXED, title, body_text, tokenize='trigram')");
  db.exec('INSERT INTO bench_search_key(object_id) SELECT id FROM objects ORDER BY id');
  db.exec('INSERT INTO bench_object_search(rowid,object_id,title,body_text) SELECT k.search_key,o.id,o.title,o.body_text FROM bench_search_key k JOIN objects o ON o.id=k.object_id');
}
export function insertSearchObject(db: Database, id: string) {
  const result = db.query('INSERT INTO bench_search_key(object_id) VALUES (?)').run(id);
  db.query('INSERT INTO bench_object_search(rowid,object_id,title,body_text) SELECT ?,id,title,body_text FROM objects WHERE id=?').run(result.lastInsertRowid, id);
}
export function syncSearchObject(db: Database, id: string) {
  const key = db.query<{ search_key: number }, [string]>('SELECT search_key FROM bench_search_key WHERE object_id=?').get(id);
  if (!key) throw new Error('Missing explicit search key');
  db.query('UPDATE bench_object_search SET title=(SELECT title FROM objects WHERE id=?), body_text=(SELECT body_text FROM objects WHERE id=?) WHERE rowid=?').run(id, id, key.search_key);
}
export function searchCases(f: SyntheticFixture) {
  return ['', 'a', 'ab', 'abc', 'Synthetic', 'synthetic', 'Synthetic object', 'two words', '100%', 'under_score_', 'back\\slash', '"quoted"', 'OR ', 'Café', '😀a', 'title-only-needle', 'body-only-needle'].map(query => {
    const candidate = candidateSearchIds(f.db, query);
    const expected = f.runtime.listObjectSummaries({ search: query, limit: 50 }).map(row => row.id);
    assertSameIds(`search ${JSON.stringify(query)}`, expected, candidate.ids);
    return { query, ...candidate, equivalent: true };
  });
}
export function searchScenario(f: SyntheticFixture, warmups = 1, repetitions = 3) {
  const db = f.db;
  db.exec('SAVEPOINT bench_search');
  try {
    const title = f.runtime.createObject({ typeId: PAGE_TYPE_ID, title: 'title-only-needle abc two words 100% under_score_ back\\slash "quoted" OR ', properties: {}, body: '' });
    const body = f.runtime.createObject({ typeId: PAGE_TYPE_ID, title: 'body holder', properties: {}, body: 'body-only-needle Café 😀a' });
    const buildMs = timed(() => createSearchTables(db)).milliseconds;
    const tableNames = db.query<{ name: string }, []>("SELECT name FROM sqlite_schema WHERE name LIKE 'bench_object_search%' OR tbl_name='bench_search_key'").all().map(row => row.name);
    const storageBytes = bytes(db, tableNames);
    const cases = searchCases(f);
    assertSameIds('title positive', candidateSearchIds(db, 'title-only-needle').ids, [title.id]);
    assertSameIds('body positive', candidateSearchIds(db, 'body-only-needle').ids, [body.id]);
    const reads = ['Synthetic', 'title-only-needle', 'body-only-needle'].map(query => {
      const values = [likePattern(query), likePattern(query)];
      const candidateValues = [phrase(query)!, ...values];
      const beforeStatistics = { baseline: explain(db, searchBaselineSql, values), candidate: explain(db, searchCandidateSql, candidateValues) };
      const matchCount = db.query<{ n: number }, string[]>("SELECT COUNT(*) AS n FROM objects WHERE trashed = 0 AND (title LIKE ? ESCAPE '\\' OR body_text LIKE ? ESCAPE '\\')").get(values[0]!, values[1]!)!.n;
      return { query, values, candidateValues, matchCount, beforeStatistics };
    });
    db.exec('ANALYZE');
    return { name: 'fts-candidate-plus-literal-like', equivalent: true, buildMs, storageBytes, storageObjects: tableNames, semanticRecords: 2, cases, reads: reads.map(c => ({ ...c, baselinePlan: explain(db, searchBaselineSql, c.values), candidatePlan: explain(db, searchCandidateSql, c.candidateValues), reads: pairedReads(warmups, repetitions, () => ids(db, searchBaselineSql, c.values), () => ids(db, searchCandidateSql, c.candidateValues)) })) };
  } finally {
    db.exec('ROLLBACK TO bench_search; RELEASE bench_search');
  }
}
export function collectOne(label: string, options: Required<SyntheticFixtureOptions>, bench: Pick<BenchmarkOptions, 'warmups' | 'repetitions'>) {
  const setup = timed(() => buildSyntheticFixture(options));
  const f = setup.value;
  try {
    const db = f.db;
    const distribution = {
      requestedObjects: options.objects,
      actualObjects: db.query<{ n: number }, []>('SELECT COUNT(*) AS n FROM objects').get()!.n,
      types: db.query('SELECT type_id, trashed, COUNT(*) AS count FROM objects GROUP BY type_id, trashed').all(),
      arrays: db.query(`SELECT type_id, trashed, COALESCE(json_array_length(${expression(f.multiReferencePropertyId)}),0) AS length, COUNT(*) AS count FROM objects o GROUP BY type_id, trashed, length ORDER BY type_id, trashed, length`).all(),
      historyRows: db.query<{ n: number }, []>('SELECT COUNT(*) AS n FROM object_revisions').get()!.n,
    };
    // All read probes precede all write probes. Each candidate removes its schema;
    // search also rolls back its two explicit semantic records. Each later write
    // comparison adds two setup records, explicitly reported separately.
    const property = propertyIndexScenario(f, bench.warmups, bench.repetitions);
    const reference = referenceScenario(f, bench.warmups, bench.repetitions);
    const search = searchScenario(f, bench.warmups, bench.repetitions);
    const propertyWrites = writeComparison(f, 'property', bench.warmups, bench.repetitions);
    const referenceWrites = writeComparison(f, 'reference', bench.warmups, bench.repetitions);
    const searchWrites = writeComparison(f, 'search', bench.warmups, bench.repetitions);
    return { label, fixture: options, setupMs: setup.milliseconds, setupScope: 'One owned temporary database: open/schema, synthetic properties/type, canonical objects, revisions, references and trash. All scenarios reuse it; no internal fixtures.', distribution,
      engine: { bun: Bun.version, sqlite: db.query('SELECT sqlite_version() AS version, sqlite_source_id() AS sourceId').get(), pragmas: { journalMode: db.query('PRAGMA journal_mode').get(), synchronous: db.query('PRAGMA synchronous').get(), trustedSchema: db.query('PRAGMA trusted_schema').get() } },
      scenarios: {
        property: { ...property, write: propertyWrites },
        reference: { ...reference, write: referenceWrites, existingIndexWrite: referenceWrites.baseline, existingIndexWriteScope: 'The same measured canonical baseline samples, not another run: edge reads need no additional write maintenance.' },
        search: { ...search, write: searchWrites },
      } };
  } finally {
    f.cleanup();
  }
}
export function collectBenchmarkReport(options: BenchmarkOptions) {
  return { generatedAt: new Date().toISOString(), options, scales: [
    collectOne('modest-writing-sparse-arrays', normalizeSyntheticFixtureOptions({ objects: options.objects, bodyBytes: options.bodyBytes, revisions: options.revisions, referenceEvery: options.referenceEvery, benchmarkProperties: true }), options),
    collectOne('larger-writing-dense-arrays', normalizeSyntheticFixtureOptions({ objects: options.largeObjects, bodyBytes: Math.max(options.bodyBytes, 2048), revisions: options.revisions, referenceEvery: options.referenceEvery, benchmarkProperties: true, benchmarkDense: true }), options),
  ], conclusion: 'Synthetic costs only. Production adopts only the target-first reference membership query using existing edges; added indexes, FTS, JSONB and deep pagination remain deferred.' };
}
if (import.meta.main) {
  try {
    console.log(JSON.stringify(collectBenchmarkReport(parseArgs(Bun.argv.slice(2))), null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
