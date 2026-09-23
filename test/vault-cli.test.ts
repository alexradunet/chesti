import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { runCli } from '../src/vault/cli.js';
import { appJsonSchema } from '../src/vault/schema.js';

test('CLI help, version, schema, text report and JSON report are deterministic and read-only', () => {
  assert.match(runCli(['--help']).stdout, /No files are changed/);
  assert.match(runCli(['--version']).stdout, /0\.1\.0/);
  assert.deepEqual(JSON.parse(runCli(['schema']).stdout), JSON.parse(JSON.stringify(appJsonSchema)));
  const text = runCli(['check', 'examples/life-vault']);
  assert.equal(text.exitCode, 0); assert.match(text.stdout, /VALID.*13 Markdown files/);
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

test('actual Node CLI process exposes valid JSON, exit codes and no stderr contamination', () => {
  const run = (args: string[]) => spawnSync(process.execPath, ['--import', 'tsx', resolve('scripts/lifeapps.ts'), ...args], { encoding: 'utf8' });
  const good = run(['check', 'examples/life-vault', '--json']);
  assert.equal(good.status, 0, good.stderr); assert.equal(good.stderr, ''); assert.equal(JSON.parse(good.stdout).valid, true);
  const bad = run(['check', 'examples/no-such-vault', '--json']);
  assert.equal(bad.status, 1); assert.equal(bad.stderr, ''); assert.equal(JSON.parse(bad.stdout).valid, false);
  assert.equal(run(['check', '--fix']).status, 2);
});
