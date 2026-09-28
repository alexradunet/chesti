import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Database } from 'bun:sqlite';
import { chmodSync, existsSync, lstatSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
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
  createVersionFiveFixture,
  createWrongKindFieldFixture,
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
