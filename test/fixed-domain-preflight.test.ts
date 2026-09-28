import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Database } from 'bun:sqlite';
import { chmodSync, existsSync, linkSync, lstatSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { initializeApplicationSchema } from '../src/schema.js';
import { ObjectRuntime } from '../src/objects/runtime.js';
import { seedDemo } from '../src/objects/demo.js';
import { ViewService } from '../src/objects/views.js';
import type { ViewSpec } from '../src/objects/model.js';
import { fingerprint } from '../src/objects/fingerprint.js';
import { analyzeFixedDomainPreflight } from '../src/objects/upgrade-fixed-domains.js';
import {
  createCompatibleV6Fixture,
  createCustomDefinitionFixture,
  createCustomHistoryFixture,
  createInputViewFixture,
  createMalformedDataFixture,
  createOldDemoSemanticsFixture,
  createRenamedDefinitionFixture,
  createStructuredReferenceFixture,
  createUnknownVersionFixture,
  createVersionMetadataFixture,
  createWrongKindFieldFixture,
  ids,
  taskCreateFingerprint,
  taskCreatePayload,
} from './fixtures/object-schema-v6.js';

function tempDir(): string { return mkdtempSync(join(tmpdir(), 'taskdesk-preflight-')); }

function logicalSnapshot(db: Database) {
  const schema = db.query<{ type: string; name: string; tbl_name: string; sql: string | null }, []>(
    'SELECT type, name, tbl_name, sql FROM sqlite_schema ORDER BY type, name',
  ).all();
  // Test-only full inventory of owned synthetic databases. Quote identifiers from SQLite.
  const rows = schema.filter(row => row.type === 'table').map(row => {
    const table = `"${row.name.replaceAll('"', '""')}"`;
    return [row.name, db.query(`SELECT * FROM ${table}`).all().map(value => JSON.stringify(value)).sort()];
  });
  return { schema, rows };
}

function withDb(t: { after(fn: () => void): void }, build: (db: Database) => void): Database {
  const db = new Database(':memory:', { strict: true });
  db.exec('PRAGMA foreign_keys = ON; PRAGMA trusted_schema = OFF;');
  build(db);
  t.after(() => db.close());
  return db;
}

function blockerCategories(report: ReturnType<typeof analyzeFixedDomainPreflight>): string[] {
  return report.blockers.map(blocker => blocker.category).sort();
}

function runCli(args: string[], env: Record<string, string | undefined> = {}): { exitCode: number | null; stdout: string; stderr: string } {
  const result = Bun.spawnSync({ cmd: ['bun', 'scripts/fixed-domain-preflight.ts', ...args], env: { ...process.env, ...env }, stdout: 'pipe', stderr: 'pipe' });
  return { exitCode: result.exitCode, stdout: new TextDecoder().decode(result.stdout), stderr: new TextDecoder().decode(result.stderr) };
}

test('compatible frozen v6 fixture preserves all fixed-domain evidence without blockers', t => {
  const db = withDb(t, createCompatibleV6Fixture);
  const report = analyzeFixedDomainPreflight(db);
  assert.equal(report.status, 'compatible');
  assert.equal(report.schemaVersion, 6);
  assert.deepEqual(report.blockers, []);
  assert.equal(report.counts.objects, 10);
  assert.equal(report.counts.object_revisions, 2);
  assert.equal(report.counts.object_views, 3);
  assert.equal(report.counts.object_view_revisions, 3);
  assert.equal(report.counts.object_create_requests, 1);
  assert.equal(report.counts.object_favorites, 1);
  assert.equal(report.counts.browser_visitors, 1);
  assert.equal(report.counts.object_view_conversations, 1);
  assert.equal(report.counts.object_view_conversation_turns, 1);
  assert.equal(report.counts.object_references, 2);
  assert.equal(report.counts.unrelated_sentinel, undefined);
});

test('preflight reports substantive incompatible v6 categories with bounded ID-only samples', t => {
  const cases: Array<[string, (db: Database) => void, string]> = [
    ['custom definitions', createCustomDefinitionFixture, 'definitions'],
    ['renamed labels', createRenamedDefinitionFixture, 'definitions'],
    ['wrong kind fields', createWrongKindFieldFixture, 'objects'],
    ['structured references', createStructuredReferenceFixture, 'structured-references'],
    ['old demo semantics', createOldDemoSemanticsFixture, 'definitions'],
    ['custom-only history', createCustomHistoryFixture, 'history'],
    ['input views', createInputViewFixture, 'views'],
    ['malformed data', createMalformedDataFixture, 'objects'],
  ];
  for (const [name, build, category] of cases) {
    const db = new Database(':memory:', { strict: true });
    db.exec('PRAGMA foreign_keys = ON; PRAGMA trusted_schema = OFF;');
    build(db);
    const report = analyzeFixedDomainPreflight(db);
    db.close();
    assert.notEqual(report.status, 'compatible', name);
    assert.ok(blockerCategories(report).includes(category), `${name} should include ${category}`);
    const text = JSON.stringify(report);
    assert.equal(text.includes('Fixture prompt'), false, 'prompt text is not reported');
    assert.equal(text.includes('café'), false, 'body text is not reported');
    assert.equal(text.includes('csrf-secret'), false, 'CSRF values are not reported');
  }
});

test('schema versions before v6 request an old-app preserving upgrade, while unknown versions fail closed', t => {
  for (const version of ['1', '2', '3', '4', '5']) {
    const metadataOnly = withDb(t, db => createVersionMetadataFixture(db, version));
    const before = logicalSnapshot(metadataOnly);
    const report = analyzeFixedDomainPreflight(metadataOnly);
    assert.equal(report.status, 'upgrade-required');
    assert.equal(report.schemaVersion, Number(version));
    assert.equal(report.blockers[0]?.category, 'schema-version');
    assert.deepEqual(logicalSnapshot(metadataOnly), before);
  }

  const unknown = withDb(t, createUnknownVersionFixture);
  const unknownReport = analyzeFixedDomainPreflight(unknown);
  assert.equal(unknownReport.status, 'blocked');
  assert.equal(unknownReport.schemaVersion, 99);
  assert.equal(unknownReport.blockers[0]?.category, 'schema-version');
});

test('CLI help and usage do not require or create a database', () => {
  const help = runCli(['--help']);
  assert.equal(help.exitCode, 0);
  assert.match(help.stdout, /--database \/absolute\/path\/to\/snapshot\.sqlite/);
  assert.match(help.stdout, /Exit codes:/);

  const dir = tempDir();
  try {
    const missing = join(dir, 'missing.sqlite');
    const result = runCli(['--database', missing]);
    assert.equal(result.exitCode, 1);
    assert.equal(existsSync(missing), false);

    for (const args of [[], ['--database', ''], ['--database'], ['--database', 'relative.sqlite'], ['--help', '--database', missing]]) {
      assert.equal(runCli(args).exitCode, 1);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('CLI opens only the explicit safe path read-only and preserves mode and schema', () => {
  const dir = tempDir();
  try {
    const target = join(dir, 'target.sqlite');
    const sentinel = join(dir, 'sentinel.sqlite');
    let db = new Database(target, { strict: true });
    db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;');
    createCompatibleV6Fixture(db);
    const before = logicalSnapshot(db);
    db.close();
    db = new Database(sentinel, { strict: true });
    createMalformedDataFixture(db);
    const sentinelBefore = logicalSnapshot(db);
    db.close();
    chmodSync(target, 0o640);
    const beforeMode = lstatSync(target).mode & 0o777;

    const result = runCli(['--database', target], { DATABASE_PATH: sentinel });
    assert.equal(result.exitCode, 0, result.stderr);
    const report = JSON.parse(result.stdout) as { status: string };
    assert.equal(report.status, 'compatible');
    assert.equal(lstatSync(target).mode & 0o777, beforeMode);
    db = new Database(target, { readonly: true, strict: true });
    assert.deepEqual(logicalSnapshot(db), before);
    db.close();
    db = new Database(sentinel, { readonly: true, strict: true });
    assert.deepEqual(logicalSnapshot(db), sentinelBefore);
    db.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('CLI refuses symlink sources consistently', () => {
  const dir = tempDir();
  try {
    const real = join(dir, 'real.sqlite');
    const link = join(dir, 'link.sqlite');
    const db = new Database(real, { strict: true });
    createCompatibleV6Fixture(db);
    db.close();
    symlinkSync(real, link);
    const result = runCli(['--database', link]);
    assert.equal(result.exitCode, 1);
    assert.match(result.stderr, /symlink|regular file/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('read-only CLI sees committed WAL content and returns nonzero blockers', () => {
  const dir = tempDir();
  try {
    const file = join(dir, 'wal.sqlite');
    const writer = new Database(file, { strict: true });
    writer.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;');
    createCompatibleV6Fixture(writer);
    writer.query('INSERT INTO object_types(id, name, property_ids_json, revision) VALUES (?, ?, ?, 1)').run('60000000-0000-4000-8000-000000000099', 'Wal Custom', '[]');
    assert.ok(existsSync(`${file}-wal`), 'fixture keeps committed changes in WAL for this check');
    const result = runCli(['--database', file]);
    writer.close();
    assert.equal(result.exitCode, 2, result.stderr);
    const report = JSON.parse(result.stdout) as { status: string; blockers: Array<{ category: string }> };
    assert.equal(report.status, 'blocked');
    assert.ok(report.blockers.some(blocker => blocker.category === 'definitions'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('view semantics signatures deleted/history views and fixed receipt digest are real v6 evidence', t => {
  assert.equal(fingerprint(taskCreatePayload), taskCreateFingerprint);
  const db = withDb(t, createCompatibleV6Fixture);
  db.query('UPDATE object_views SET schema_json = ? WHERE id = ?').run('[]', ids.view);
  let report = analyzeFixedDomainPreflight(db);
  assert.equal(report.status, 'blocked');
  assert.ok(blockerCategories(report).includes('views'));

  db.query('UPDATE object_views SET schema_json = (SELECT schema_json FROM object_view_revisions WHERE id = ? AND revision = 1) WHERE id = ?').run(ids.view, ids.view);
  db.query(`INSERT INTO object_view_revisions(id, revision, status, spec_json, prompt, model, schema_json, created_at, updated_at, deleted)
    SELECT id, 2, status, json_set(spec_json, '$.blocks[0].sources[0].bindings.relationship', ?), prompt, model, schema_json, created_at, updated_at, deleted
    FROM object_views WHERE id = ?`).run('60000000-0000-4000-8000-000000000099', ids.deletedView);
  report = analyzeFixedDomainPreflight(db);
  assert.equal(report.status, 'blocked');
  assert.ok(blockerCategories(report).includes('view-history'));
});

test('current/history record shape, receipts, and content leaks fail closed', t => {
  const db = withDb(t, createCompatibleV6Fixture);
  db.query('UPDATE object_revisions SET snapshot_json = ? WHERE object_id = ? AND revision = 1').run(JSON.stringify({ typeId: 'not-a-uuid-secret-title', properties: {} }), ids.task);
  db.query('UPDATE object_create_requests SET fingerprint = ? WHERE object_id = ?').run('not-a-digest-secret-body', ids.task);
  db.query('UPDATE objects SET body_text = ? WHERE id = ?').run('wrong secret body text', ids.page);
  const report = analyzeFixedDomainPreflight(db);
  assert.equal(report.status, 'malformed');
  assert.ok(blockerCategories(report).includes('history'));
  assert.ok(blockerCategories(report).includes('receipts'));
  assert.ok(blockerCategories(report).includes('objects'));
  const text = JSON.stringify(report);
  assert.equal(text.includes('secret-title'), false);
  assert.equal(text.includes('secret-body'), false);
});

test('Markdown writing edges must exactly match extracted links including self mixed-case and trash targets', t => {
  const db = withDb(t, createCompatibleV6Fixture);
  assert.equal(analyzeFixedDomainPreflight(db).status, 'compatible');
  db.query("DELETE FROM object_references WHERE source_id = ? AND target_id = ? AND property_id = ''").run(ids.page, ids.task);
  assert.ok(blockerCategories(analyzeFixedDomainPreflight(db)).includes('writing-links'));
  db.query("INSERT INTO object_references(source_id, target_id, property_id) VALUES (?, ?, '')").run(ids.page, ids.task);
  db.query("INSERT INTO object_references(source_id, target_id, property_id) VALUES (?, ?, '')").run(ids.task, ids.trash);
  assert.ok(blockerCategories(analyzeFixedDomainPreflight(db)).includes('writing-links'));
});

test('application shape rejects extra columns altered known triggers and external dependencies while preserving unrelated tables', t => {
  const db = withDb(t, createCompatibleV6Fixture);
  db.exec('CREATE TABLE harmless_unrelated (id TEXT PRIMARY KEY) STRICT;');
  assert.equal(analyzeFixedDomainPreflight(db).status, 'compatible');
  db.exec('ALTER TABLE objects ADD COLUMN extra_saved_data TEXT;');
  let report = analyzeFixedDomainPreflight(db);
  assert.equal(report.status, 'blocked');
  assert.ok(blockerCategories(report).includes('application-shape'));

  const db2 = withDb(t, createCompatibleV6Fixture);
  db2.exec('CREATE TABLE external_dependency (id TEXT PRIMARY KEY, type_id TEXT REFERENCES object_types(id)) STRICT; INSERT INTO external_dependency(id, type_id) VALUES (\'row\', \'00000000-0000-4000-8000-000000000001\');');
  assert.ok(blockerCategories(analyzeFixedDomainPreflight(db2)).includes('application-shape'));

  const db3 = withDb(t, createCompatibleV6Fixture);
  db3.exec('DROP TRIGGER object_view_history_no_update; CREATE TRIGGER object_view_history_no_update BEFORE UPDATE ON object_view_revisions BEGIN SELECT RAISE(ABORT, \'changed\'); END;');
  assert.ok(blockerCategories(analyzeFixedDomainPreflight(db3)).includes('application-shape'));
});

test('analysis does not permanently change writable connection pragmas and can run inside a transaction', () => {
  const db = new Database(':memory:', { strict: true });
  db.exec('PRAGMA foreign_keys = ON; CREATE TABLE writable_sentinel (id TEXT PRIMARY KEY, value TEXT) STRICT; INSERT INTO writable_sentinel(id, value) VALUES (\'a\', \'before\');');
  createCompatibleV6Fixture(db);
  try {
    assert.equal(db.query<{ query_only: number }, []>('PRAGMA query_only').get()!.query_only, 0);
    assert.equal(analyzeFixedDomainPreflight(db).status, 'compatible');
    assert.equal(db.query<{ query_only: number }, []>('PRAGMA query_only').get()!.query_only, 0);
    db.query('UPDATE writable_sentinel SET value = ? WHERE id = ?').run('after', 'a');
    db.transaction(() => {
      assert.equal(analyzeFixedDomainPreflight(db).status, 'compatible');
      throw new Error('rollback');
    }).immediate();
  } catch (error) {
    assert.equal((error as Error).message, 'rollback');
  } finally {
    db.query('UPDATE writable_sentinel SET value = ? WHERE id = ?').run('after-rollback', 'a');
    assert.equal(db.query<{ value: string }, []>('SELECT value FROM writable_sentinel WHERE id = \'a\'').get()!.value, 'after-rollback');
    db.close();
  }
});

test('bounded blockers count all rows with limited samples', t => {
  const db = withDb(t, createCompatibleV6Fixture);
  for (let index = 0; index < 12; index += 1) {
    db.query('INSERT INTO object_types(id, name, property_ids_json, revision) VALUES (?, ?, ?, 1)').run(`60000000-0000-4000-8000-${String(index).padStart(12, '0')}`, `Custom ${index}`, '[]');
  }
  const blocker = analyzeFixedDomainPreflight(db).blockers.find(item => item.category === 'definitions')!;
  assert.equal(blocker.count, 12);
  assert.equal(blocker.samples.length, 5);
  assert.equal(blocker.truncated, true);
});

test('CLI refuses ancestor symlinks and hardlinks and maps malformed versus incompatible exits', () => {
  const dir = tempDir();
  try {
    const realDir = join(dir, 'real');
    const linkDir = join(dir, 'linkdir');
    mkdirSync(realDir);
    const file = join(realDir, 'db.sqlite');
    let db = new Database(file, { strict: true });
    createCompatibleV6Fixture(db);
    db.close();
    symlinkSync(realDir, linkDir);
    assert.equal(runCli(['--database', join(linkDir, 'db.sqlite')]).exitCode, 1);

    const hardlink = join(dir, 'hard.sqlite');
    linkSync(file, hardlink);
    assert.equal(runCli(['--database', hardlink]).exitCode, 1);
    rmSync(hardlink);

    db = new Database(file, { strict: true });
    db.query('INSERT INTO object_types(id, name, property_ids_json, revision) VALUES (?, ?, ?, 1)').run('60000000-0000-4000-8000-000000000123', 'Custom', '[]');
    db.close();
    assert.equal(runCli(['--database', file]).exitCode, 2);

    const bad = join(dir, 'bad.sqlite');
    db = new Database(bad, { strict: true });
    createUnknownVersionFixture(db);
    db.close();
    assert.equal(runCli(['--database', bad]).exitCode, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('reproduced structural false positives now block', t => {
  const db = withDb(t, createCompatibleV6Fixture);
  db.exec("DROP TRIGGER object_builtin_type_0_delete; CREATE TRIGGER object_builtin_type_0_delete BEFORE DELETE ON object_types BEGIN SELECT 1; END;");
  assert.ok(blockerCategories(analyzeFixedDomainPreflight(db)).includes('application-shape'));

  const db2 = withDb(t, createCompatibleV6Fixture);
  db2.exec('DROP INDEX objects_journal_date;');
  assert.ok(blockerCategories(analyzeFixedDomainPreflight(db2)).includes('application-shape'));

  const db3 = withDb(t, createCompatibleV6Fixture);
  db3.exec('CREATE INDEX custom_properties_index ON objects(properties_json);');
  assert.ok(blockerCategories(analyzeFixedDomainPreflight(db3)).includes('application-shape'));
});

test('reproduced record and diagnostic false positives now fail closed without leaking sentinels', t => {
  const db = withDb(t, createCompatibleV6Fixture);
  const snapshot = JSON.parse(db.query<{ snapshot_json: string }, []>('SELECT snapshot_json FROM object_revisions LIMIT 1').get()!.snapshot_json) as Record<string, unknown>;
  snapshot.title = '';
  snapshot.createdAt = 'not-a-time';
  db.query('UPDATE object_revisions SET snapshot_json = ? WHERE object_id = ? AND revision = 1').run(JSON.stringify(snapshot), ids.task);
  db.query('UPDATE objects SET created_at = ? WHERE id = ?').run('2026-99-99T88:88:88Z', ids.page);
  const report = analyzeFixedDomainPreflight(db);
  assert.equal(report.status, 'malformed');
  assert.ok(blockerCategories(report).includes('history'));
  assert.ok(blockerCategories(report).includes('objects'));

  const db2 = withDb(t, createCompatibleV6Fixture);
  const props = JSON.parse(db2.query<{ properties_json: string }, [string]>('SELECT properties_json FROM objects WHERE id = ?').get(ids.page)!.properties_json) as Record<string, unknown>;
  props.PRIVATE_SENTINEL_MEDICAL_NOTE = 'value';
  db2.query('UPDATE objects SET properties_json = ? WHERE id = ?').run(JSON.stringify(props), ids.page);
  const text = JSON.stringify(analyzeFixedDomainPreflight(db2));
  assert.equal(text.includes('PRIVATE_SENTINEL_MEDICAL_NOTE'), false);
});

test('unrelated table names are quoted safely during dependency inspection', t => {
  const db = withDb(t, createCompatibleV6Fixture);
  db.exec('CREATE TABLE "owner notes" (id TEXT PRIMARY KEY) STRICT;');
  assert.equal(analyzeFixedDomainPreflight(db).status, 'compatible');
});

test('batch boundaries and bounded samples hold for large definition and FK inventories', t => {
  const db = withDb(t, createCompatibleV6Fixture);
  for (let index = 0; index < 505; index += 1) {
    db.query('INSERT INTO object_types(id, name, property_ids_json, revision) VALUES (?, ?, ?, 1)').run(`60000000-0000-4000-8000-${String(index).padStart(12, '0')}`, `Custom ${index}`, '[]');
  }
  const blocker = analyzeFixedDomainPreflight(db).blockers.find(item => item.category === 'definitions')!;
  assert.equal(blocker.count, 505);
  assert.equal(blocker.samples.length, 5);
  assert.equal(blocker.truncated, true);

  const broken = new Database(':memory:', { strict: true });
  createCompatibleV6Fixture(broken);
  broken.exec('PRAGMA foreign_keys = OFF;');
  for (let index = 0; index < 7; index += 1) broken.query('INSERT INTO object_favorites(object_id, created_at) VALUES (?, ?)').run(`aaaaaaaa-0000-4000-8000-${String(index).padStart(12, '0')}`, '2026-09-28T12:00:00.000Z');
  broken.exec('PRAGMA foreign_keys = ON;');
  const fkBlocker = analyzeFixedDomainPreflight(broken).blockers.find(item => item.category === 'sqlite-integrity')!;
  broken.close();
  assert.equal(fkBlocker.count, 7);
  assert.equal(fkBlocker.samples.length, 5);
  assert.equal(fkBlocker.truncated, true);
});

test('writing-edge comparison handles alphabetic UUID case without global edge assumptions', t => {
  const db = withDb(t, createCompatibleV6Fixture);
  const source = 'aaaaaaaa-0000-4000-8000-000000000001';
  const target = 'bbbbbbbb-0000-4000-8000-000000000002';
  db.query('INSERT INTO objects(id, type_id, title, properties_json, body, revision, created_at, updated_at, trashed, body_text) VALUES (?, ?, ?, ?, ?, 1, ?, ?, 0, ?)')
    .run(source, '00000000-0000-4000-8000-000000000001', 'Alpha source', '{}', `[Target](/objects/${target.toUpperCase()})`, '2026-09-28T12:00:00.000Z', '2026-09-28T12:00:00.000Z', `Target`);
  db.query('INSERT INTO objects(id, type_id, title, properties_json, body, revision, created_at, updated_at, trashed, body_text) VALUES (?, ?, ?, ?, ?, 1, ?, ?, 1, ?)')
    .run(target, '00000000-0000-4000-8000-000000000001', 'Alpha target', '{}', '', '2026-09-28T12:00:00.000Z', '2026-09-28T12:00:00.000Z', '');
  db.query("INSERT INTO object_references(source_id, target_id, property_id) VALUES (?, ?, '')").run(source.toUpperCase(), target.toLowerCase());
  assert.equal(analyzeFixedDomainPreflight(db).status, 'compatible');
  db.query("DELETE FROM object_references WHERE source_id = ? COLLATE NOCASE AND target_id = ? COLLATE NOCASE AND property_id = ''").run(source, target);
  assert.ok(blockerCategories(analyzeFixedDomainPreflight(db)).includes('writing-links'));
});

test('frozen v6 DDL and definitions exactly match a separate pristine baseline initializer', t => {
  const frozen = withDb(t, createCompatibleV6Fixture);
  const pristine = withDb(t, initializeApplicationSchema);
  const schema = (db: Database) => logicalSnapshot(db).schema.filter(row => row.tbl_name !== 'unrelated_sentinel');
  assert.deepEqual(schema(frozen), schema(pristine));
  for (const table of ['object_types', 'object_properties']) {
    assert.deepEqual(frozen.query(`SELECT * FROM ${table} ORDER BY id`).all(), pristine.query(`SELECT * FROM ${table} ORDER BY id`).all());
  }
  assert.equal(analyzeFixedDomainPreflight(pristine).status, 'compatible');
  assert.equal(analyzeFixedDomainPreflight(frozen).status, 'compatible');

  // Canonical API independently checks fixture view semantics/signatures and receipt meaning.
  const before = logicalSnapshot(frozen);
  const runtime = new ObjectRuntime(frozen);
  const views = new ViewService(runtime);
  for (const id of [ids.view, ids.draftView]) assert.equal(views.evaluate(id).view.id, id);
  const current = runtime.getObject(ids.task);
  assert.deepEqual(runtime.createObject(taskCreatePayload, '50000000-0000-4000-8000-000000000001'), current);
  assert.throws(() => runtime.createObject({ ...taskCreatePayload, title: 'Changed request' }, '50000000-0000-4000-8000-000000000001'));
  assert.deepEqual(logicalSnapshot(frozen), before);
});

test('frozen v6 enforces genuine named JSON/history checks and real Journal dates', t => {
  const db = withDb(t, createCompatibleV6Fixture);
  const before = logicalSnapshot(db);
  for (const [column, value, constraint] of [
    ['spec_json', '[]', 'object_views_spec_object'],
    ['schema_json', '{}', 'object_views_schema_array'],
    ['revision', 0, 'object_views_revision_positive'],
  ] as const) {
    assert.throws(() => db.query(`UPDATE object_views SET ${column} = ? WHERE id = ?`).run(value, ids.view), new RegExp(constraint));
  }
  for (const [column, value, constraint] of [
    ['spec_json', '[]', 'object_view_revisions_spec_object'],
    ['schema_json', '{}', 'object_view_revisions_schema_array'],
    ['status', 'unknown', 'object_view_revisions_status_closed'],
    ['deleted', 2, 'object_view_revisions_deleted_closed'],
    ['revision', 0, 'object_view_revisions_revision_positive'],
  ] as const) {
    const columns = ['id', 'revision', 'status', 'spec_json', 'prompt', 'model', 'schema_json', 'created_at', 'updated_at', 'deleted'];
    const projection = columns.map(name => name === column ? '?' : name === 'revision' ? '2' : name).join(', ');
    assert.throws(() => db.query(`INSERT INTO object_view_revisions SELECT ${projection} FROM object_view_revisions WHERE id = ?`).run(value, ids.view), new RegExp(constraint));
  }
  assert.throws(() => db.query('UPDATE objects SET properties_json = ? WHERE id = ?').run('[]', ids.page), /objects_properties_object/);
  assert.throws(() => db.query('UPDATE object_revisions SET snapshot_json = ? WHERE object_id = ?').run('[]', ids.task), /object_revisions_snapshot_object/);
  assert.throws(() => db.query('INSERT INTO object_types VALUES (?, ?, ?, 1)').run('aaaaaaaa-0000-4000-8000-000000000001', 'Custom', '{}'), /object_types_property_ids_array/);
  for (const date of ['2026-02-30', '0000-01-01', '2026-13-01']) {
    assert.throws(() => db.query('UPDATE objects SET properties_json = ? WHERE id = ?').run(JSON.stringify({ '00000000-0000-4000-8000-000000000401': date }), ids.journal), /Journal requires a real calendar date/);
  }
  assert.throws(() => db.query('UPDATE objects SET properties_json = ? WHERE id = ?').run('{"00000000-0000-4000-8000-000000000401":"2026-09-28","00000000-0000-4000-8000-000000000401":"2026-09-29"}', ids.journal), /Journal requires a real calendar date/);
  assert.throws(() => db.exec('UPDATE object_view_revisions SET prompt = prompt'), /immutable/);
  assert.throws(() => db.exec('DELETE FROM object_view_revisions'), /immutable/);
  assert.deepEqual(logicalSnapshot(db), before);
});

test('whole-DDL checks reject same-name semantic changes even when expected phrases survive', t => {
  const mutations = [
    "DROP TRIGGER object_builtin_type_0_delete; CREATE TRIGGER object_builtin_type_0_delete BEFORE DELETE ON object_types BEGIN SELECT 'Built-in types cannot be deleted.'; END",
    "DROP TRIGGER object_builtin_type_0_delete; CREATE TRIGGER object_builtin_type_0_delete BEFORE DELETE ON object_types WHEN 0 BEGIN SELECT RAISE(ABORT, 'Built-in types cannot be deleted.'); END",
    'DROP INDEX objects_journal_date; CREATE INDEX objects_journal_date ON objects(title)',
    'DROP INDEX objects_browse; CREATE INDEX objects_browse ON objects(id)',
    'ALTER TABLE objects ADD COLUMN private_extra TEXT GENERATED ALWAYS AS (title) VIRTUAL',
    'CREATE UNIQUE INDEX private_extra ON objects(title)',
    'DROP TRIGGER object_view_history_no_delete',
    'DROP INDEX objects_journal_date',
  ];
  for (const sql of mutations) {
    const db = withDb(t, createCompatibleV6Fixture);
    db.exec(sql);
    const before = logicalSnapshot(db);
    const report = analyzeFixedDomainPreflight(db);
    assert.notEqual(report.status, 'compatible', sql);
    assert.ok(report.blockers.some(blocker => blocker.category === 'application-shape'), sql);
    assert.deepEqual(logicalSnapshot(db), before);
  }
});

test('no private identifiers or SQLite diagnostic text escape reports', t => {
  const secret = 'private_sentinel_medical_note';
  for (const mutate of [
    (db: Database) => db.query('UPDATE objects SET properties_json = ? WHERE id = ?').run(JSON.stringify({ [secret]: '' }), ids.page),
    (db: Database) => db.query('INSERT INTO object_types VALUES (?, ?, ?, 1)').run(secret, secret, '[]'),
    (db: Database) => db.query('UPDATE object_create_requests SET request_id = ?').run(secret),
    (db: Database) => db.exec(`CREATE TABLE "${secret}" (id TEXT, type_id TEXT REFERENCES object_types(id)) STRICT`),
    (db: Database) => db.exec(`CREATE INDEX "${secret}" ON objects(title)`),
    (db: Database) => {
      db.exec('PRAGMA foreign_keys = OFF');
      db.query("INSERT INTO object_references VALUES (?, ?, '')").run(ids.page, secret);
    },
    (db: Database) => {
      db.exec(`CREATE TABLE "${secret}" (id INTEGER CHECK(id > 0)) STRICT; PRAGMA ignore_check_constraints = ON; INSERT INTO "${secret}" VALUES (-1); PRAGMA ignore_check_constraints = OFF`);
    },
  ]) {
    const db = withDb(t, createCompatibleV6Fixture);
    mutate(db);
    const before = logicalSnapshot(db);
    const report = analyzeFixedDomainPreflight(db);
    assert.notEqual(report.status, 'compatible');
    assert.equal(JSON.stringify(report).includes(secret), false);
    assert.deepEqual(logicalSnapshot(db), before);
  }
});

test('CLI preserves every source/sentinel row and mode for success and each failure class', t => {
  const directory = tempDir();
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const sentinelPath = join(directory, 'sentinel.sqlite');
  let sentinel = new Database(sentinelPath);
  createCompatibleV6Fixture(sentinel);
  const sentinelBefore = logicalSnapshot(sentinel);
  sentinel.close();
  const cases: Array<[(db: Database) => void, number]> = [
    [createCompatibleV6Fixture, 0],
    [createCustomDefinitionFixture, 2],
    [createMalformedDataFixture, 1],
    [createUnknownVersionFixture, 1],
    [db => createVersionMetadataFixture(db, '5'), 2],
    [db => { createCompatibleV6Fixture(db); db.exec('DROP INDEX objects_journal_date'); }, 1],
    [db => { createCompatibleV6Fixture(db); db.exec('CREATE INDEX custom_index ON objects(title)'); }, 2],
  ];
  for (const [index, [build, exitCode]] of cases.entries()) {
    const path = join(directory, `${index}.sqlite`);
    let db = new Database(path);
    build(db);
    const before = logicalSnapshot(db);
    db.close();
    chmodSync(path, 0o640);
    const mode = lstatSync(path).mode;
    const result = runCli(['--database', path], { DATABASE_PATH: sentinelPath });
    assert.equal(result.exitCode, exitCode, result.stdout + result.stderr);
    assert.equal(lstatSync(path).mode, mode);
    db = new Database(path, { readonly: true });
    assert.deepEqual(logicalSnapshot(db), before);
    db.close();
    sentinel = new Database(sentinelPath, { readonly: true });
    assert.deepEqual(logicalSnapshot(sentinel), sentinelBefore);
    sentinel.close();
  }
});

test('analysis preserves connection flags and parent transaction contents on success and failure', t => {
  for (const queryOnly of [0, 1]) for (const foreignKeys of [0, 1]) {
    const db = withDb(t, createCompatibleV6Fixture);
    db.exec(`PRAGMA query_only = ${queryOnly}; PRAGMA foreign_keys = ${foreignKeys}`);
    const flags = () => [db.query('PRAGMA query_only').get(), db.query('PRAGMA foreign_keys').get(), db.query('PRAGMA trusted_schema').get()];
    const beforeFlags = flags();
    const before = logicalSnapshot(db);
    assert.equal(analyzeFixedDomainPreflight(db).status, 'compatible');
    assert.equal(db.inTransaction, false);
    assert.deepEqual(flags(), beforeFlags);
    db.exec('BEGIN');
    if (!queryOnly) db.query('UPDATE objects SET created_at = ? WHERE id = ?').run('invalid', ids.page);
    assert.equal(analyzeFixedDomainPreflight(db).status, queryOnly ? 'compatible' : 'malformed');
    assert.equal(db.inTransaction, true);
    assert.deepEqual(flags(), beforeFlags);
    db.exec('ROLLBACK');
    assert.deepEqual(logicalSnapshot(db), before);
    if (!queryOnly) {
      db.query('UPDATE unrelated_sentinel SET note = ?').run('still writable');
      assert.equal(db.query<{ note: string }, []>('SELECT note FROM unrelated_sentinel').get()!.note, 'still writable');
    }
  }
  const broken = withDb(t, createMalformedDataFixture);
  broken.exec('PRAGMA query_only = ON; BEGIN');
  assert.equal(analyzeFixedDomainPreflight(broken).status, 'malformed');
  assert.equal(broken.inTransaction, true);
  assert.equal(broken.query<{ query_only: number }, []>('PRAGMA query_only').get()!.query_only, 1);
  broken.exec('ROLLBACK');
  assert.equal(analyzeFixedDomainPreflight(broken).status, 'malformed');
});

test('all historical members, exact fingerprints and ambiguous JSON are checked without rewriting values', t => {
  for (const [field, value] of [
    ['title', ''], ['createdAt', '2026-99-99T88:88:88Z'], ['updatedAt', null], ['revision', Number.MAX_SAFE_INTEGER + 1],
    ['id', ids.page], ['body', {}], ['trashed', 0], ['private_extra', 'not discardable'],
  ] as const) {
    const db = withDb(t, createCompatibleV6Fixture);
    const row = db.query<{ snapshot_json: string }, [string]>('SELECT snapshot_json FROM object_revisions WHERE object_id = ? AND revision = 1').get(ids.task)!;
    const snapshot = JSON.parse(row.snapshot_json);
    snapshot[field] = value;
    db.query('UPDATE object_revisions SET snapshot_json = ? WHERE object_id = ? AND revision = 1').run(JSON.stringify(snapshot), ids.task);
    const before = logicalSnapshot(db);
    const report = analyzeFixedDomainPreflight(db);
    assert.notEqual(report.status, 'compatible', field);
    assert.ok(report.blockers.some(blocker => blocker.category === 'history'), field);
    assert.deepEqual(logicalSnapshot(db), before);
  }
  const db = withDb(t, createCompatibleV6Fixture);
  db.query('UPDATE objects SET properties_json = ? WHERE id = ?').run('{"00000000-0000-4000-8000-000000000101":"private","00000000-0000-4000-8000-000000000101":false}', ids.task);
  assert.ok(blockerCategories(analyzeFixedDomainPreflight(db)).includes('json'));

  const absentAndEmpty = withDb(t, createCompatibleV6Fixture);
  absentAndEmpty.query('UPDATE objects SET properties_json = ? WHERE id = ?').run('{}', ids.task);
  absentAndEmpty.query('UPDATE objects SET created_at = ? WHERE id = ?').run('2026-09-28T12:00:00Z', ids.page);
  const before = logicalSnapshot(absentAndEmpty);
  assert.equal(analyzeFixedDomainPreflight(absentAndEmpty).status, 'compatible');
  assert.deepEqual(logicalSnapshot(absentAndEmpty), before);
  assert.notEqual(fingerprint({ ...taskCreatePayload, properties: { ...taskCreatePayload.properties, '00000000-0000-4000-8000-000000000101': false } }), taskCreateFingerprint);
});

test('view-only historical/deleted semantic blockers are detected separately from wire shape', t => {
  for (const mutate of [
    (spec: ViewSpec) => { spec.blocks[0]!.sources.push(spec.blocks[0]!.sources[0]!); },
    (spec: ViewSpec) => { spec.blocks[0]!.sources[0]!.bindings = { date: '00000000-0000-4000-8000-000000000101' }; },
    (spec: ViewSpec) => { spec.blocks[0]!.sources[0]!.where = [{ propertyId: '00000000-0000-4000-8000-000000000101', operator: 'before', value: '2026-09-28' }]; },
    (spec: ViewSpec) => { spec.input = { label: 'Page', typeId: '00000000-0000-4000-8000-000000000001' }; },
  ]) {
    const db = withDb(t, createCompatibleV6Fixture);
    const row = db.query<{ spec_json: string }, [string]>('SELECT spec_json FROM object_views WHERE id = ?').get(ids.view)!;
    const spec = JSON.parse(row.spec_json);
    mutate(spec);
    // A new immutable history entry, never an UPDATE of a protected row.
    db.query('INSERT INTO object_view_revisions SELECT id, 2, status, ?, prompt, model, schema_json, created_at, updated_at, deleted FROM object_views WHERE id = ?').run(JSON.stringify(spec), ids.view);
    assert.ok(blockerCategories(analyzeFixedDomainPreflight(db)).includes('view-history'));
  }
  const deleted = withDb(t, createCompatibleV6Fixture);
  deleted.query("UPDATE object_views SET schema_json = '[]' WHERE id = ?").run(ids.deletedView);
  assert.ok(blockerCategories(analyzeFixedDomainPreflight(deleted)).includes('views'));
  const spaces = withDb(t, createCompatibleV6Fixture);
  spaces.query("UPDATE object_views SET schema_json = ' ' || schema_json WHERE id = ?").run(ids.view);
  assert.ok(blockerCategories(analyzeFixedDomainPreflight(spaces)).includes('views'));
});

test('preflight holds one WAL read snapshot even when a writer commits during analysis', t => {
  const directory = tempDir();
  const path = join(directory, 'consistent.sqlite');
  const writer = new Database(path, { strict: true });
  writer.exec('PRAGMA journal_mode = WAL');
  createCompatibleV6Fixture(writer);
  const reader = new Database(path, { readonly: true, strict: true });
  t.after(() => {
    reader.close();
    writer.close();
    rmSync(directory, { recursive: true, force: true });
  });
  const query = reader.query.bind(reader);
  let committed = false;
  reader.query = ((sql: string) => {
    if (!committed && sql.includes('SELECT value FROM object_metadata')) {
      committed = true;
      assert.equal(reader.inTransaction, true);
      writer.query('INSERT INTO object_types VALUES (?, ?, ?, 1)').run('aaaaaaaa-0000-4000-8000-000000000099', 'Committed later', '[]');
    }
    return query(sql);
  }) as typeof reader.query;
  assert.equal(analyzeFixedDomainPreflight(reader).status, 'compatible');
  assert.equal(committed, true);
  reader.query = query as typeof reader.query;
  const next = analyzeFixedDomainPreflight(reader);
  assert.equal(next.status, 'blocked');
  assert.equal(next.counts.object_types, 7);
});

test('the actual old demo blocks without rewriting definitions, structured references or views', t => {
  const db = withDb(t, db => seedDemo(new ObjectRuntime(db)));
  const before = logicalSnapshot(db);
  const report = analyzeFixedDomainPreflight(db);
  assert.equal(report.status, 'blocked');
  for (const category of ['definitions', 'objects', 'structured-references', 'views', 'view-history']) {
    assert.ok(blockerCategories(report).includes(category), category);
  }
  assert.deepEqual(logicalSnapshot(db), before);
});

test('malformed file and unsafe sidecar errors do not print private paths or SQLite content', t => {
  const directory = tempDir();
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const secret = 'private_sentinel_medical_note';
  const file = join(directory, `${secret}.sqlite`);
  writeFileSync(file, secret);
  let result = runCli(['--database', file]);
  assert.equal(result.exitCode, 1);
  assert.equal((result.stdout + result.stderr).includes(secret), false);

  const real = join(directory, 'real.sqlite');
  const db = new Database(real);
  createCompatibleV6Fixture(db);
  db.close();
  symlinkSync(file, `${real}-wal`);
  result = runCli(['--database', real]);
  assert.equal(result.exitCode, 1);
  assert.equal((result.stdout + result.stderr).includes(secret), false);
});
