import { existsSync, statSync } from 'node:fs';
import { buildSyntheticFixture, normalizeSyntheticFixtureOptions } from './sqlite-fixture.js';
import type { SyntheticFixtureOptions } from './sqlite-fixture.js';

interface DbstatRow { name: string; bytes: number; pages: number }

function parsePositiveInteger(text: string, flag: string): number {
  if (!/^\d+$/.test(text)) throw new Error(`${flag} expects a nonnegative integer.`);
  return Number(text);
}

export function parseArgs(args: string[]): { fixture: Required<SyntheticFixtureOptions>; checkpoint: boolean } {
  const fixture: SyntheticFixtureOptions = {};
  let checkpoint = false;
  for (const arg of args) {
    if (arg === '--help' || arg === '-h') {
      throw new Error('Usage: bun run sqlite:storage -- [--objects=N] [--body-bytes=N] [--revisions=N] [--reference-every=N] [--checkpoint]');
    }
    if (arg === '--checkpoint') {
      checkpoint = true;
      continue;
    }
    const match = /^(--[a-z-]+)=(\d+)$/.exec(arg);
    if (!match) {
      const flag = arg.includes('=') ? arg.slice(0, arg.indexOf('=')) : arg;
      if (flag === '--database' || flag === '--db' || flag === '--path' || flag === '--database-path') throw new Error('This diagnostic only creates and measures a temporary synthetic database; existing database paths are not accepted.');
      throw new Error(`Unknown or incomplete flag: ${arg}`);
    }
    const flag = match[1]!;
    const value = match[2]!;
    if (flag === '--objects') fixture.objects = parsePositiveInteger(value, flag);
    else if (flag === '--body-bytes') fixture.bodyBytes = parsePositiveInteger(value, flag);
    else if (flag === '--revisions') fixture.revisions = parsePositiveInteger(value, flag);
    else if (flag === '--reference-every') fixture.referenceEvery = parsePositiveInteger(value, flag);
    else if (flag === '--database' || flag === '--db' || flag === '--path' || flag === '--database-path') throw new Error('This diagnostic only creates and measures a temporary synthetic database; existing database paths are not accepted.');
    else throw new Error(`Unknown flag: ${flag}`);
  }
  return { fixture: normalizeSyntheticFixtureOptions(fixture), checkpoint };
}

function fileSize(path: string): number {
  return existsSync(path) ? statSync(path).size : 0;
}

export function collectSyntheticStorageReport(options: Required<SyntheticFixtureOptions>, checkpoint = false) {
  const fixture = buildSyntheticFixture(options);
  try {
    const db = fixture.db;
    const sqliteVersion = db.query<{ version: string }, []>('SELECT sqlite_version() AS version').get()!.version;
    let checkpointResult: { busy: number; log: number; checkpointed: number } | undefined;
    if (checkpoint) {
      const row = db.query<{ busy: number; log: number; checkpointed: number }, []>('PRAGMA wal_checkpoint(TRUNCATE)').get();
      if (row) checkpointResult = row;
    }
    let dbstat: DbstatRow[];
    try {
      dbstat = db.query<DbstatRow, []>('SELECT name, SUM(pgsize) AS bytes, COUNT(*) AS pages FROM dbstat GROUP BY name ORDER BY bytes DESC, name ASC').all();
    } catch (error) {
      throw new Error(`SQLite DBSTAT is unavailable: ${error instanceof Error ? error.message : String(error)}`);
    }
    const pageSize = db.query<{ page_size: number }, []>('PRAGMA page_size').get()!.page_size;
    const pageCount = db.query<{ page_count: number }, []>('PRAGMA page_count').get()!.page_count;
    const freelistCount = db.query<{ freelist_count: number }, []>('PRAGMA freelist_count').get()!.freelist_count;
    const dbstatBytes = dbstat.reduce((sum, row) => sum + row.bytes, 0);
    return {
      engine: { bunVersion: Bun.version, sqliteVersion },
      fixture: fixture.options,
      page: { pageSize, pageCount, freelistCount, allocatedBytes: pageSize * pageCount, dbstatBytes },
      dbstat,
      files: {
        databaseBytes: fileSize(fixture.file),
        walBytes: fileSize(`${fixture.file}-wal`),
        shmBytes: fileSize(`${fixture.file}-shm`),
      },
      checkpoint: checkpointResult ? { requested: true, result: checkpointResult } : { requested: checkpoint, result: null },
      notes: [
        'DBSTAT bytes are allocated SQLite pages by table/index, not logical payload bytes.',
        'Main database, WAL, and SHM file sizes are distinct physical files and should not be summed as independent logical data.',
        'Free pages and SQLite metadata can make dbstat totals differ from page_count * page_size.',
      ],
    };
  } finally {
    fixture.cleanup();
  }
}

if (import.meta.main) {
  try {
    const parsed = parseArgs(Bun.argv.slice(2));
    console.log(JSON.stringify(collectSyntheticStorageReport(parsed.fixture, parsed.checkpoint), null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
