import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Database } from 'bun:sqlite';
import { inspectSQLiteRuntime } from '../scripts/sqlite-runtime.js';

type RuntimeReport = ReturnType<typeof inspectSQLiteRuntime>;

type RuntimeCapability = RuntimeReport['capabilities'][string];

function capability(report: RuntimeReport, name: string): RuntimeCapability {
  const value = report.capabilities[name];
  assert.ok(value, `missing capability ${name}`);
  return value;
}

function runScript(args: string[] = []) {
  return Bun.spawnSync({
    cmd: [process.execPath, 'scripts/sqlite-runtime.ts', ...args],
    stdout: 'pipe',
    stderr: 'pipe',
  });
}

test('sqlite runtime report reflects the executing Bun SQLite engine', () => {
  const report = inspectSQLiteRuntime();
  const db = new Database(':memory:');
  try {
    const actual = db.query<{ version: string; source_id: string }, []>('SELECT sqlite_version() AS version, sqlite_source_id() AS source_id').get();
    assert.equal(report.bunVersion, Bun.version);
    assert.equal(report.sqlite.version, actual?.version);
    assert.equal(report.sqlite.sourceId, actual?.source_id);
    assert.ok(report.sqlite.compileOptions.length > 0);
    assert.ok(report.sqlite.compileOptions.every(option => typeof option === 'string' && option.length > 0));
    assert.equal(capability(report, 'jsonFunctions').available, true);
    assert.equal(capability(report, 'fts5TempTable').available, report.sqlite.compileOptions.some(option => option === 'ENABLE_FTS5'));
    assert.equal(typeof capability(report, 'jsonbFunctions').available, 'boolean');
    assert.equal(typeof capability(report, 'dbstatVirtualTable').available, 'boolean');
    assert.equal(typeof capability(report, 'alterTableAddColumnCheck').available, 'boolean');
    assert.equal(typeof capability(report, 'alterTableAddCheckConstraintSyntax').available, 'boolean');
    assert.equal(typeof capability(report, 'alterTableSetNotNullSyntax').available, 'boolean');
  } finally {
    db.close();
  }
});

test('sqlite runtime command prints parseable JSON', () => {
  const result = runScript();
  assert.equal(result.exitCode, 0, result.stderr.toString());
  const report = JSON.parse(result.stdout.toString()) as RuntimeReport;
  assert.equal(report.bunVersion, Bun.version);
  assert.match(report.sqlite.version, /^\d+\.\d+\.\d+$/);
  assert.match(report.sqlite.sourceId, /^\d{4}-\d{2}-\d{2} /);
  assert.ok(Object.keys(report.capabilities).includes('jsonFunctions'));
  for (const capability of Object.values(report.capabilities)) {
    assert.equal(typeof capability.available, 'boolean');
    assert.equal(typeof capability.detail, 'string');
    if (!capability.available) {
      assert.equal(typeof capability.error, 'string');
    }
  }
});

test('sqlite runtime command rejects arguments without opening a user file', () => {
  const directory = mkdtempSync(join(tmpdir(), 'taskdesk-sqlite-runtime-'));
  const databasePath = join(directory, 'must-not-exist.sqlite');
  try {
    const result = runScript([databasePath]);
    assert.notEqual(result.exitCode, 0);
    assert.match(result.stderr.toString(), /Usage:/);
    assert.equal(existsSync(databasePath), false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
