import { Database } from 'bun:sqlite';
import { chmodSync, closeSync, constants, existsSync, lstatSync, mkdirSync, openSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

/** One local database; the application and app runtime share this connection. */
export function openDatabase(file = ':memory:'): Database {
  if (file !== ':memory:') {
    file = resolve(file);
    const directory = (path: string): void => {
      const parent = dirname(path);
      if (parent !== path) directory(parent);
      if (!existsSync(path)) mkdirSync(path, { mode: 0o700 });
      const stat = lstatSync(path);
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Database directory must not be a symbolic link.');
    };
    directory(dirname(file));
    if (!existsSync(file)) closeSync(openSync(file, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600));
    const stat = lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) throw new Error('Database must be a private regular file.');
    chmodSync(file, 0o600);
  }
  const db = new Database(file, { strict: true });
  try {
    db.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL;');
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}
