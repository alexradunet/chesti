#!/usr/bin/env bun
import { Database } from 'bun:sqlite';
import { existsSync, lstatSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute } from 'node:path';
import { analyzeFixedDomainPreflight, type FixedDomainPreflightReport } from '../src/objects/upgrade-fixed-domains.js';

function usage(): void {
  console.log(`Usage: bun scripts/fixed-domain-preflight.ts --database /absolute/path/to/snapshot.sqlite

Read-only fixed-domain compatibility preflight for an existing Taskdesk SQLite snapshot.

Options:
  --database PATH   Required absolute path to an existing private SQLite file.
  --help            Show this help.

Exit codes:
  0  Compatible with the fixed-domain migration preconditions.
  2  Valid database, but blocked or requires a preparatory schema-version-6 upgrade.
  1  Usage error, unreadable path, malformed database, or unsupported/newer schema.

Reports are bounded: sample IDs/reasons are examples, not a complete inventory. Object titles,
bodies, prompts, CSRF values, and full records are intentionally not printed.`);
}

function parse(argv: string[]): string | undefined {
  if (argv.length === 1 && argv[0] === '--help') return undefined;
  if (argv.length !== 2 || argv[0] !== '--database') throw new Error('Provide exactly --database /absolute/path/to/snapshot.sqlite.');
  return argv[1];
}

function checkedPath(input: string): string {
  if (!isAbsolute(input)) throw new Error('Database path must be absolute.');
  if (!existsSync(input)) throw new Error('Database file does not exist.');
  for (let path = input; ; path = dirname(path)) {
    const stat = lstatSync(path);
    if (stat.isSymbolicLink()) throw new Error('Database path must not contain a symlink.');
    const parent = dirname(path);
    if (parent === path) break;
  }
  const stat = lstatSync(input);
  if (!stat.isFile() || stat.nlink !== 1) throw new Error('Database must be a private regular file, not a symlink or hard link.');
  return realpathSync(input);
}

function exitCode(report: FixedDomainPreflightReport): number {
  if (report.status === 'compatible') return 0;
  if (report.status === 'upgrade-required') return 2;
  if (report.status === 'malformed') return 1;
  if (report.blockers.some(blocker => blocker.category === 'schema-version')) return 1;
  return 2;
}

function printReport(report: FixedDomainPreflightReport): void {
  console.log(JSON.stringify(report, null, 2));
}

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === '--help') {
    usage();
    return 0;
  }
  let databasePath: string;
  try {
    const parsed = parse(args);
    if (!parsed) return 0;
    databasePath = checkedPath(parsed);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    console.error('Run with --help for usage.');
    return 1;
  }
  let db: Database | undefined;
  try {
    db = new Database(databasePath, { readonly: true, strict: true });
    db.exec('PRAGMA trusted_schema = OFF; PRAGMA foreign_keys = ON; PRAGMA query_only = ON;');
    const report = analyzeFixedDomainPreflight(db);
    printReport(report);
    return exitCode(report);
  } catch {
    console.error('Preflight could not read a valid supported SQLite database.');
    return 1;
  } finally {
    db?.close();
  }
}

process.exitCode = await main();
