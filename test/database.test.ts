import { test } from 'node:test';
import assert from 'node:assert/strict';
import { closeSync, linkSync, mkdirSync, mkdtempSync, openSync, rmSync, symlinkSync, writeFileSync, constants } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase } from '../src/database.js';

function temporaryDirectory(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

test('application SQLite connections use expected safety and durability pragmas', t => {
  const memory = openDatabase();
  t.after(() => memory.close());
  assert.equal(memory.query<{ trusted_schema: number }, []>('PRAGMA trusted_schema').get()!.trusted_schema, 0);
  assert.equal(memory.query<{ foreign_keys: number }, []>('PRAGMA foreign_keys').get()!.foreign_keys, 1);
  assert.equal(memory.query<{ timeout: number }, []>('PRAGMA busy_timeout').get()!.timeout, 5000);
  assert.equal(memory.query<{ synchronous: number }, []>('PRAGMA synchronous').get()!.synchronous, 2);

  const directory = temporaryDirectory('taskdesk-database-');
  const file = join(directory, 'workspace.sqlite');
  const db = openDatabase(file);
  t.after(() => { db.close(); rmSync(directory, { recursive: true, force: true }); });
  assert.equal(db.query<{ trusted_schema: number }, []>('PRAGMA trusted_schema').get()!.trusted_schema, 0);
  assert.equal(db.query<{ foreign_keys: number }, []>('PRAGMA foreign_keys').get()!.foreign_keys, 1);
  assert.equal(db.query<{ timeout: number }, []>('PRAGMA busy_timeout').get()!.timeout, 5000);
  assert.equal(db.query<{ synchronous: number }, []>('PRAGMA synchronous').get()!.synchronous, 2);
  assert.equal(db.query<{ journal_mode: string }, []>('PRAGMA journal_mode').get()!.journal_mode, 'wal');
});

test('database files must be private regular files, not symlinks or hardlinks', () => {
  const directory = temporaryDirectory('taskdesk-database-path-');
  try {
    const target = join(directory, 'target.sqlite');
    const hardlink = join(directory, 'hardlink.sqlite');
    const symlink = join(directory, 'symlink.sqlite');
    closeSync(openSync(target, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600));
    linkSync(target, hardlink);
    symlinkSync(target, symlink);
    assert.throws(() => openDatabase(hardlink), /private regular file/);
    assert.throws(() => openDatabase(symlink), /private regular file/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('database parent directories must not be symlinks', () => {
  const directory = temporaryDirectory('taskdesk-database-dir-');
  try {
    const real = join(directory, 'real');
    const linked = join(directory, 'linked');
    mkdirSync(real);
    writeFileSync(join(directory, 'not-a-directory'), 'x');
    symlinkSync(real, linked);
    assert.throws(() => openDatabase(join(linked, 'workspace.sqlite')), /symbolic link/);
    assert.throws(() => openDatabase(join(directory, 'not-a-directory', 'workspace.sqlite')), /symbolic link/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
