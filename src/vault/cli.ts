import { existsSync } from 'node:fs';
import { openDatabase } from '../database.js';
import { VaultRuntime } from './runtime.js';
import { readImportFile } from './interchange.js';
import { appJsonSchema } from './schema.js';
import { readVault } from './reader.js';

const HELP = `lifeapps — SQLite app storage tools

Usage:
  lifeapps check [vault-root] [--json]
  lifeapps schema
  lifeapps import <vault-root> --db <database> [--json]
  lifeapps export <new-directory> --db <database> [--json]
  lifeapps definition <markdown-file> --path <.apps/name.md> --db <database> [--json]
  lifeapps --help
  lifeapps --version

Examples:
  bun scripts/lifeapps.ts check examples/life-vault
  bun scripts/lifeapps.ts check examples/life-vault --json
  bun scripts/lifeapps.ts schema

SQLite is the application's authoritative storage. The file-oriented commands
below are optional migration/interchange tools, not live storage.

check: Validate all app candidates, documents and relationships in a vault.
       Defaults to the current directory; a .apps directory is required.
       Hidden paths (except .apps), node_modules and symbolic links are not read.
       No files are changed, app definitions activated, or model calls made.
schema: Print the app-definition JSON Schema (shape checks; semantic checks
        and vault integrity still require the shared validator).
import: Seed an empty database once from a valid Markdown vault and its legacy
        approvals/receipts. Inputs are untouched; later file changes are ignored.
        Unsupported visible non-Markdown files or unsafe/incomplete input fail closed.
export: Write current definitions, records and approvals/receipts into a NEW
        directory. An existing destination is never merged or overwritten.
definition: Import a definition revision into the database. Changed definitions
            revoke their grants and must be reviewed and approved again in the app.

Output: human-readable diagnostics by default; --json produces a stable report
        without document bodies. JSON shape: {contract, valid, counts, diagnostics}.
Limits: 10,000 directory entries, 1 MiB per Markdown file, 32 MiB total, depth 32.
Exit codes: 0 valid (warnings allowed), 1 validation failed, 2 usage/internal error.
Version: 0.1.0
`;
export interface CliResult { stdout: string; stderr: string; exitCode: number }
const failure = (message: string, json: boolean): CliResult => ({ stdout: json ? JSON.stringify({ error: { code: 'CLI_ERROR', message } }, null, 2) + '\n' : '', stderr: json ? '' : `${message}\nRun lifeapps --help for usage.\n`, exitCode: 2 });
// Escape terminal control characters in user-controlled filenames/messages.
const visible = (text: string) => text.replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, char => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`);
export function runCli(args: string[]): CliResult {
  const json = args.includes('--json');
  if (args.length === 0 || (args.length === 1 && ['--help', '-h', 'help'].includes(args[0]!))) return { stdout: HELP, stderr: '', exitCode: 0 };
  if (args.length === 1 && args[0] === '--version') return { stdout: 'lifeapps 0.1.0\n', stderr: '', exitCode: 0 };
  if (args.length === 1 && args[0] === 'schema') return { stdout: JSON.stringify(appJsonSchema, null, 2) + '\n', stderr: '', exitCode: 0 };
  if (['import', 'export', 'definition'].includes(args[0]!)) {
    const paths: string[] = [];
    let database: string | undefined;
    let definition: string | undefined;
    let seenJson = false;
    for (let index = 1; index < args.length; index++) {
      const arg = args[index]!;
      if (arg === '--json' && !seenJson) { seenJson = true; continue; }
      if (arg === '--db' && database === undefined && args[index + 1] && !args[index + 1]!.startsWith('-')) { database = args[++index]; continue; }
      if (arg === '--path' && args[0] === 'definition' && definition === undefined && args[index + 1] && !args[index + 1]!.startsWith('-')) { definition = args[++index]; continue; }
      if (arg.startsWith('-')) return failure('Unknown, repeated or incomplete option.', json);
      paths.push(arg);
    }
    if (paths.length !== 1 || !paths[0] || !database || database === ':memory:' || (args[0] === 'definition' && !definition)) return failure('Pass one interchange path, --db with a persistent database path, and --path for a definition.', json);
    if (args[0] !== 'import' && !existsSync(database)) return failure('Database does not exist.', json);
    try {
      const db = openDatabase(database);
      try {
        const runtime = new VaultRuntime(db);
        if (args[0] === 'import') runtime.importRoot(paths[0]);
        else if (args[0] === 'export') runtime.exportTo(paths[0]);
        else {
          const source = readImportFile(paths[0]);
          if (source === undefined) throw new Error('Definition input does not exist.');
          runtime.updateDefinition(definition!, source);
        }
        return { stdout: json ? JSON.stringify({ command: args[0], database, path: paths[0], completed: true }) + '\n' : `${args[0]} completed.\n`, stderr: '', exitCode: 0 };
      } finally { db.close(); }
    } catch (error) { return failure(visible(error instanceof Error ? error.message : 'Interchange could not complete.'), json); }
  }
  if (args[0] !== 'check') return failure('Expected check, import, export, definition, schema, --help or --version.', json);
  const remaining = args.slice(1);
  if (remaining.filter(arg => arg === '--json').length > 1 || remaining.some(arg => arg.startsWith('-') && arg !== '--json')) return failure('Unknown or repeated option.', json);
  const paths = remaining.filter(arg => arg !== '--json');
  if (paths.length > 1 || paths.some(path => !path)) return failure('Pass at most one vault root.', json);
  try {
    const { report } = readVault(paths[0] ?? '.');
    const stdout = json ? JSON.stringify(report, null, 2) + '\n' : [
      ...report.diagnostics.map(d => `${visible(d.file)}:${d.line}:${d.column} ${d.severity.toUpperCase()} ${d.code}${d.field ? ` (${visible(d.field)})` : ''}\n  ${visible(d.message)}${d.related?.length ? `\n  Related: ${d.related.map(visible).join(', ')}` : ''}`),
      `${report.valid ? 'VALID' : 'INVALID'} · ${report.counts.files} Markdown files · ${report.counts.validApps}/${report.counts.apps} valid app candidates · ${report.counts.errors} errors · ${report.counts.warnings} warnings`,
      'Read-only check; no apps were activated and no files were changed.',
    ].join('\n\n') + '\n';
    return { stdout, stderr: '', exitCode: report.valid ? 0 : 1 };
  } catch { return failure('Validation could not finish. No files were changed.', json); }
}
