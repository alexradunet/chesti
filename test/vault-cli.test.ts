import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { runCli } from '../src/vault/cli.js';
import { appJsonSchema } from '../src/vault/schema.js';
import { openDatabase } from '../src/database.js';
import { VaultRuntime } from '../src/vault/runtime.js';

test('CLI schema and JSON reports expose validation without document bodies', () => {
  assert.deepEqual(JSON.parse(runCli(['schema']).stdout), JSON.parse(JSON.stringify(appJsonSchema)));
  const json = runCli(['check', '--json', 'examples/life-vault']);
  assert.equal(json.exitCode, 0); assert.equal(json.stderr, '');
  assert.equal(JSON.parse(json.stdout).counts.validApps, 4);
  assert.ok(!json.stdout.includes('Today I sketched'));
});

test('CLI rejects unknown commands, extra paths, duplicate flags and unsupported repair requests', () => {
  for (const args of [['repair'], ['check', '--fix'], ['check', 'one', 'two'], ['check', '--json', '--json'], ['check', '--model', 'x'], ['schema', '--json']]) {
    const result = runCli(args); assert.equal(result.exitCode, 2, args.join(' '));
    if (args.includes('--json')) assert.ok(JSON.parse(result.stdout).error);
    else assert.notEqual(result.stderr, '');
  }
});

test('CLI warnings succeed, errors fail, and invalid files are not silently repaired', t => {
  const root = mkdtempSync(join(tmpdir(), 'lifeapps-cli-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  cpSync('examples/life-vault', root, { recursive: true });
  const path = join(root, 'Warning.md');
  writeFileSync(path, '[[Missing]]\n');
  assert.equal(runCli(['check', root]).exitCode, 0);
  writeFileSync(path, '---\ninvalid: [\n---\n');
  const original = readFileSync(path);
  const result = runCli(['check', root, '--json']);
  assert.equal(result.exitCode, 1); assert.equal(JSON.parse(result.stdout).valid, false);
  assert.deepEqual(readFileSync(path), original);
  assert.equal(runCli(['check', join(root, 'Missing')]).exitCode, 1);
});

test('CLI escapes terminal control characters from vault content', t => {
  const root = mkdtempSync(join(tmpdir(), 'lifeapps-terminal-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  cpSync('examples/life-vault', root, { recursive: true });
  writeFileSync(join(root, 'Bad\u001b[2J.md'), '---\na: [\n---\n');
  const result = runCli(['check', root]);
  assert.equal(result.exitCode, 1); assert.ok(!result.stdout.includes('\u001b')); assert.ok(result.stdout.includes('\\u001b'));
});

test('actual Bun CLI process exposes valid JSON and validation exit codes', () => {
  const run = (args: string[]) => spawnSync(process.execPath, [resolve('scripts/lifeapps.ts'), ...args], { encoding: 'utf8' });
  const good = run(['check', 'examples/life-vault', '--json']);
  assert.equal(good.status, 0, good.stderr); assert.equal(good.stderr, ''); assert.equal(JSON.parse(good.stdout).valid, true);
  const bad = run(['check', 'examples/no-such-vault', '--json']);
  assert.equal(bad.status, 1); assert.equal(bad.stderr, ''); assert.equal(JSON.parse(bad.stdout).valid, false);
  assert.equal(run(['check', '--fix']).status, 2);
});

test('CLI import, definition revision and exclusive export preserve authority and receipts', t => {
  const home = mkdtempSync(join(tmpdir(), 'lifeapps-cli-db-'));
  const root = join(home, 'input');
  const database = join(home, 'taskdesk.sqlite');
  const exported = join(home, 'export');
  cpSync('examples/life-vault', root, { recursive: true });
  t.after(() => rmSync(home, { recursive: true, force: true }));
  assert.equal(runCli(['import', root, '--db', database]).exitCode, 0);
  let db = openDatabase(database);
  let runtime = new VaultRuntime(db);
  const tasks = runtime.reviews().find(app => app.id === 'tasks')!;
  const mutation = { id: 'cli-roundtrip', app: 'tasks', type: 'task', action: 'create', revision: tasks.revision, fields: { title: 'Retried after export' } };
  const denied = runtime.execute(mutation);
  assert.equal(denied.errorStatus, 403);
  runtime.approve(runtime.reviews().map(app => ({ app: app.id, revision: app.revision, permissions: app.permissions })));
  const made = runtime.execute({ ...mutation, id: 'created' });
  assert.equal(made.status, 'applied');
  db.close();
  const revisionFile = join(home, 'revised.md');
  writeFileSync(revisionFile, tasks.source + '\nExplicitly revised definition.\n');
  assert.equal(runCli(['definition', revisionFile, '--path', tasks.path, '--db', database]).exitCode, 0);
  db = openDatabase(database);
  runtime = new VaultRuntime(db);
  assert.equal(runtime.reviews().find(app => app.id === 'tasks')!.status, 'pending');
  assert.deepEqual(runtime.receipt(mutation.id), denied);
  db.close();
  assert.equal(runCli(['export', exported, '--db', database]).exitCode, 0);
  assert.equal(runCli(['check', exported]).exitCode, 0);
  const exportedRecord = readFileSync(join(exported, made.path!), 'utf8');
  assert.match(exportedRecord, /Retried after export/);
  writeFileSync(join(exported, 'Unrelated.md'), 'Keep this user file.\n');
  assert.equal(runCli(['export', exported, '--db', database]).exitCode, 2);
  assert.equal(readFileSync(join(exported, 'Unrelated.md'), 'utf8'), 'Keep this user file.\n');
  assert.equal(readFileSync(join(exported, made.path!), 'utf8'), exportedRecord);
  const importedDatabase = join(home, 'roundtrip.sqlite');
  assert.equal(runCli(['import', exported, '--db', importedDatabase]).exitCode, 0);
  db = openDatabase(importedDatabase);
  try {
    runtime = new VaultRuntime(db);
    assert.deepEqual(runtime.receipt(mutation.id), denied);
    assert.deepEqual(runtime.receipt('created'), made);
    assert.equal(runtime.reviews().find(app => app.id === 'tasks')!.status, 'pending');
    assert.equal(runtime.reviews().find(app => app.id === 'wiki')!.status, 'active');
    runtime.approve(runtime.reviews().map(app => ({ app: app.id, revision: app.revision, permissions: app.permissions })));
    assert.equal(runtime.snapshot().documents.find(document => document.file.path === made.path)!.file.title, 'Retried after export');
  } finally { db.close(); }
});

test('CLI rejects ambiguous interchange options and refuses a missing export database', t => {
  const root = mkdtempSync(join(tmpdir(), 'lifeapps-cli-options-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const args of [
    ['import', 'examples/life-vault'],
    ['import', 'examples/life-vault', '--db'],
    ['import', 'examples/life-vault', '--db', ':memory:'],
    ['import', 'examples/life-vault', '--db', 'one', '--db', 'two'],
    ['definition', 'Tasks.md', '--db', 'one'],
    ['export', join(root, 'out'), '--db', join(root, 'missing.sqlite')],
  ]) assert.equal(runCli(args).exitCode, 2);
});
