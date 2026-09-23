import { constants, closeSync, fstatSync, lstatSync, openSync, readSync, readdirSync, realpathSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { basename, dirname, normalize } from 'node:path/posix';
import { validateDefinition, type AppCandidate } from './definition.js';
import { diagnostic, parseMarkdown, type Diagnostic, type MarkdownFile } from './markdown.js';
import { hasErrors, validateRecord, validateRecordRelationships, type VaultDocument } from './records.js';
import type { DocumentType } from './schema.js';

export interface VaultReport {
  contract: 'lifeapps/check-v1';
  valid: boolean;
  counts: { files: number; apps: number; validApps: number; records: number; notes: number; errors: number; warnings: number };
  diagnostics: Diagnostic[];
}
export interface VaultSnapshot { root: string; apps: AppCandidate[]; documents: VaultDocument[]; report: VaultReport }
export interface ReadOptions { maxFiles?: number; maxFileBytes?: number; maxTotalBytes?: number; maxDepth?: number }
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;

/** Read-only, bounded scan. Candidates are not activated, files are never repaired, and no personal paths are discovered. */
export function readVault(root: string, options: ReadOptions = {}): VaultSnapshot {
  const limits = { maxFiles: 10_000, maxFileBytes: 1_048_576, maxTotalBytes: 33_554_432, maxDepth: 32, ...options };
  if (Object.values(limits).some(value => !Number.isSafeInteger(value) || value < 1)) throw new Error('Reader limits must be positive safe integers.');
  const snapshot: VaultSnapshot = { root: resolve(root), apps: [], documents: [], report: { contract: 'lifeapps/check-v1', valid: false, counts: { files: 0, apps: 0, validApps: 0, records: 0, notes: 0, errors: 0, warnings: 0 }, diagnostics: [] } };
  const scanDiagnostics: Diagnostic[] = [];
  const parsed: MarkdownFile[] = [];
  const allFiles = new Set<string>();
  let bytes = 0;
  let entries = 0;
  let exhausted = false;
  const issue = (file: string, code: string, message: string) => scanDiagnostics.push({ code, severity: 'error', file, line: 1, column: 1, message });
  const contained = (path: string) => {
    const rel = relative(snapshot.root, realpathSync(path));
    return !isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`);
  };
  const scan = (directory: string, prefix: string, depth: number) => {
    if (depth > limits.maxDepth) { issue(prefix, 'VAULT_LIMIT', 'Directory nesting limit exceeded.'); return; }
    let names: string[];
    try {
      if (!contained(directory)) { issue(prefix || '.', 'VAULT_PATH', 'Directory resolves outside the vault.'); return; }
      names = readdirSync(directory).sort(compare);
    } catch { issue(prefix || '.', 'VAULT_IO', 'Could not read this directory.'); return; }
    for (const name of names) {
      if (exhausted) return;
      if ((name.startsWith('.') && !(prefix === '' && name === '.apps')) || name === 'node_modules') continue;
      const path = prefix ? `${prefix}/${name}` : name;
      if (++entries > limits.maxFiles) { issue(path, 'VAULT_LIMIT', 'Vault entry limit exceeded; scan is incomplete.'); exhausted = true; return; }
      const absolute = join(directory, name);
      try {
        const stat = lstatSync(absolute);
        if (stat.isSymbolicLink()) { issue(path, 'VAULT_SYMLINK', 'Symbolic links are not followed.'); continue; }
        if (stat.isDirectory()) { scan(absolute, path, depth + 1); continue; }
        if (!stat.isFile()) { issue(path, 'VAULT_FILE_KIND', 'Only regular files and directories are supported.'); continue; }
        allFiles.add(path);
        if (!/\.md$/i.test(name)) continue;
        if (!contained(absolute)) { issue(path, 'VAULT_PATH', 'File resolves outside the vault.'); continue; }
        const fd = openSync(absolute, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
        try {
          const before = fstatSync(fd, { bigint: true });
          if (!before.isFile()) { issue(path, 'VAULT_FILE_KIND', 'Only regular Markdown files are supported.'); continue; }
          if (before.size > BigInt(limits.maxFileBytes)) { issue(path, 'FILE_TOO_LARGE', 'Markdown file exceeds the per-file byte limit.'); continue; }
          const buffer = Buffer.alloc(Number(before.size) + 1);
          let size = 0;
          while (size < buffer.length) { const count = readSync(fd, buffer, size, buffer.length - size, null); if (!count) break; size += count; }
          const after = fstatSync(fd, { bigint: true });
          const current = lstatSync(absolute, { bigint: true });
          if (before.mtimeNs !== after.mtimeNs || before.ctimeNs !== after.ctimeNs || before.size !== BigInt(size) || !contained(absolute) || current.ino !== after.ino || current.dev !== after.dev) { issue(path, 'FILE_CHANGED', 'File changed during reading; run the check again.'); continue; }
          bytes += size;
          if (bytes > limits.maxTotalBytes) { issue(path, 'VAULT_LIMIT', 'Total Markdown byte limit exceeded; scan is incomplete.'); exhausted = true; return; }
          let source: string;
          try { source = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(buffer.subarray(0, size)); }
          catch { issue(path, 'FILE_ENCODING', 'Markdown must be valid UTF-8.'); continue; }
          parsed.push(parseMarkdown(path, source));
        } finally { closeSync(fd); }
      } catch { issue(path, 'VAULT_IO', 'Could not safely read this file or directory.'); }
    }
  };
  try {
    const stat = lstatSync(snapshot.root);
    if (!stat.isDirectory() || stat.isSymbolicLink()) issue('.', 'VAULT_ROOT', 'Choose a real vault directory, not a file or symbolic link.');
    else {
      snapshot.root = realpathSync(snapshot.root);
      const apps = join(snapshot.root, '.apps');
      try {
        const appStat = lstatSync(apps);
        if (!appStat.isDirectory() || appStat.isSymbolicLink()) issue('.apps', 'VAULT_APPS', 'The vault needs a real .apps directory, not a link.');
        else scan(snapshot.root, '', 0);
      } catch { issue('.apps', 'VAULT_APPS', 'No .apps directory found. Pass the vault root explicitly.'); }
    }
  } catch { issue('.', 'VAULT_ROOT', 'Vault directory does not exist or cannot be read.'); }

  snapshot.apps = parsed.filter(file => file.path.startsWith('.apps/')).map(validateDefinition);
  const appIds = new Map<string, AppCandidate[]>();
  for (const app of snapshot.apps) {
    const id = app.file.frontmatter.id;
    if (typeof id === 'string') { const group = appIds.get(id) ?? []; group.push(app); appIds.set(id, group); }
  }
  for (const group of appIds.values()) if (group.length > 1) for (const app of group) app.diagnostics.push({
    ...diagnostic(app.file, 'APP_DUPLICATE_ID', 'App ID appears in multiple definitions; none is selected as authoritative.', ['id']),
    related: group.filter(other => other !== app).map(other => other.file.path).sort(compare),
  });
  const buildTypes = () => {
    const types = new Map<string, DocumentType>();
    for (const app of snapshot.apps) if (app.definition && !hasErrors(app.diagnostics)) for (const [name, type] of Object.entries(app.definition.types)) types.set(`${app.definition.id}.${name}`, type);
    return types;
  };
  let changed = true;
  while (changed) {
    changed = false;
    const types = buildTypes();
    for (const app of snapshot.apps) if (app.definition && !hasErrors(app.diagnostics)) for (const [typeName, type] of Object.entries(app.definition.types)) for (const [name, field] of Object.entries(type.fields)) {
      if (field.type === 'reference' && 'target' in field && !types.has(field.target)) {
        app.diagnostics.push(diagnostic(app.file, 'APP_REFERENCE_TYPE', `No valid definition provides ${field.target}.`, ['types', typeName, 'fields', name, 'target']));
        changed = true;
      }
    }
  }
  const types = buildTypes();
  snapshot.documents = parsed.filter(file => !file.path.startsWith('.apps/')).map(file => validateRecord(file, types));
  validateRecordRelationships(snapshot.documents);
  // Links use paths/names, never network access. Fragment existence is not checked in v1.
  const paths = [...allFiles].filter(path => !path.startsWith('.apps/'));
  for (const doc of snapshot.documents) for (const link of doc.file.links) {
    const target = link.target.split('#')[0]!.trim();
    if (!target) continue; // heading/block link inside this document
    let code: string | undefined;
    let matches: string[] = [];
    if (/^[a-z]+:/i.test(target) || target.startsWith('/') || /[\\\u0000-\u001f\u007f]/.test(target)) code = 'WIKILINK_UNSAFE';
    else {
      const candidates = target.startsWith('.') ? [normalize(`${dirname(doc.file.path)}/${target}`)] : [normalize(target)];
      if (candidates.some(path => path === '..' || path.startsWith('../') || path.split('/').some(p => p.startsWith('.')))) code = 'WIKILINK_UNSAFE';
      else {
        matches = paths.filter(path => candidates.includes(path) || candidates.includes(path.replace(/\.md$/i, '')));
        if (matches.length === 0 && !target.includes('/')) matches = paths.filter(path => basename(path) === target || basename(path).replace(/\.md$/i, '') === target);
        if (matches.length === 0) code = 'WIKILINK_MISSING';
        else if (matches.length > 1) code = 'WIKILINK_AMBIGUOUS';
      }
    }
    if (code) doc.diagnostics.push({ code, severity: 'warning', file: doc.file.path, line: link.line, column: link.column, message: code === 'WIKILINK_UNSAFE' ? 'Wiki links must stay inside the visible vault.' : code === 'WIKILINK_MISSING' ? 'Wiki link has no matching file.' : 'Wiki link matches multiple files; use a vault-relative path.', ...(matches.length ? { related: matches.sort(compare) } : {}) });
  }
  const diagnostics = [...scanDiagnostics, ...snapshot.apps.flatMap(app => app.diagnostics), ...snapshot.documents.flatMap(doc => doc.diagnostics)].sort((a, b) => compare(a.file, b.file) || a.line - b.line || a.column - b.column || compare(a.code, b.code) || compare(a.message, b.message));
  const counts = {
    files: parsed.length, apps: snapshot.apps.length, validApps: snapshot.apps.filter(app => !hasErrors(app.diagnostics)).length,
    records: snapshot.documents.filter(doc => doc.kind === 'record').length, notes: snapshot.documents.filter(doc => doc.kind === 'note').length,
    errors: diagnostics.filter(d => d.severity === 'error').length, warnings: diagnostics.filter(d => d.severity === 'warning').length,
  };
  snapshot.report = { contract: 'lifeapps/check-v1', valid: counts.errors === 0, counts, diagnostics };
  return snapshot;
}
