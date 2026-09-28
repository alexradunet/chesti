import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Database } from 'bun:sqlite';
import { chmodSync, existsSync, linkSync, lstatSync, mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { analyzeFixedDomainPreflight, fixedDomainFingerprint } from '../src/objects/upgrade-fixed-domains.js';
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
  createVersionFiveFixture,
  createWrongKindFieldFixture,
  ids,
  taskCreateFingerprint,
  taskCreatePayload,
} from './fixtures/object-schema-v6.js';

function tempDir(): string { return mkdtempSync(join(tmpdir(), 'taskdesk-preflight-')); }

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
    assert.equal(report.status, 'blocked', name);
    assert.ok(blockerCategories(report).includes(category), `${name} should include ${category}`);
    const text = JSON.stringify(report);
    assert.equal(text.includes('Fixture prompt'), false, 'prompt text is not reported');
    assert.equal(text.includes('café'), false, 'body text is not reported');
    assert.equal(text.includes('csrf-secret'), false, 'CSRF values are not reported');
  }
});

test('schema versions before v6 request an old-app preserving upgrade, while unknown versions fail closed', t => {
  const v5 = withDb(t, createVersionFiveFixture);
  const v5Report = analyzeFixedDomainPreflight(v5);
  assert.equal(v5Report.status, 'upgrade-required');
  assert.equal(v5Report.schemaVersion, 5);
  assert.equal(v5Report.blockers[0]?.category, 'schema-version');

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

    const noPath = runCli([]);
    assert.equal(noPath.exitCode, 1);
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
    const beforeTables = db.query<{ name: string }, []>("SELECT name FROM sqlite_schema WHERE type = 'table' ORDER BY name").all().map(row => row.name);
    db.close();
    db = new Database(sentinel, { strict: true });
    createMalformedDataFixture(db);
    db.close();
    chmodSync(target, 0o640);
    const beforeMode = lstatSync(target).mode & 0o777;

    const result = runCli(['--database', target], { DATABASE_PATH: sentinel });
    assert.equal(result.exitCode, 0, result.stderr);
    const report = JSON.parse(result.stdout) as { status: string };
    assert.equal(report.status, 'compatible');
    assert.equal(lstatSync(target).mode & 0o777, beforeMode);
    db = new Database(target, { readonly: true, strict: true });
    const afterTables = db.query<{ name: string }, []>("SELECT name FROM sqlite_schema WHERE type = 'table' ORDER BY name").all().map(row => row.name);
    db.close();
    assert.deepEqual(afterTables, beforeTables);
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
  assert.equal(fixedDomainFingerprint(taskCreatePayload), taskCreateFingerprint);
  const db = withDb(t, createCompatibleV6Fixture);
  db.query('UPDATE object_views SET schema_json = ? WHERE id = ?').run('[]', ids.view);
  let report = analyzeFixedDomainPreflight(db);
  assert.equal(report.status, 'blocked');
  assert.ok(blockerCategories(report).includes('views'));

  db.query('UPDATE object_views SET schema_json = (SELECT schema_json FROM object_view_revisions WHERE id = ? AND revision = 1) WHERE id = ?').run(ids.view, ids.view);
  db.query('INSERT INTO object_view_revisions(id, revision, status, spec_json, prompt, model, schema_json, created_at, updated_at, deleted) SELECT id, 2, status, json_set(spec_json, \"$.blocks[0].sources[1].typeId\", \"00000000-0000-4000-8000-000000000002\"), prompt, model, schema_json, created_at, updated_at, deleted FROM object_views WHERE id = ?').run(ids.deletedView);
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
  assert.equal(report.status, 'blocked');
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
