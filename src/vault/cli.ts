import { appJsonSchema } from './schema.js';
import { readVault } from './reader.js';

const HELP = `lifeapps — read-only Markdown vault validation

Usage:
  lifeapps check [vault-root] [--json]
  lifeapps schema
  lifeapps --help
  lifeapps --version

Examples:
  bun scripts/lifeapps.ts check examples/life-vault
  bun scripts/lifeapps.ts check examples/life-vault --json
  bun scripts/lifeapps.ts schema

check: Validate all app candidates, documents and relationships in a vault.
       Defaults to the current directory; a .apps directory is required.
       Hidden paths (except .apps), node_modules and symbolic links are not read.
       No files are changed, app definitions activated, or model calls made.
schema: Print the app-definition JSON Schema (shape checks; semantic checks
        and vault integrity still require the shared validator).

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
  if (args[0] !== 'check') return failure('Expected check, schema, --help or --version.', json);
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
