import type { Database } from 'bun:sqlite';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { AppError } from '../core.js';
import type { AppCandidate } from './definition.js';
import { isObject, parseMarkdown, type Diagnostic } from './markdown.js';
import { createMarkdown, updateMarkdown } from './mutation.js';
import { snapshotFromFiles, type VaultSnapshot } from './reader.js';
import { hasErrors, validateRecord, validateRecordRelationships, type VaultDocument } from './records.js';
import type { DocumentType, Predicate } from './schema.js';
import { builtinFields, own, UUID, valueError } from './values.js';
import { initializeVault, loadSnapshot, saveDefinition, saveRecord, saveRelationships } from './sql.js';
import { definitionPath, hash, ID, MAX_FILE, MAX_RECEIPTS, readImport, recordPath, REVISION, writeExport, type Approval, type LegacyState, type Receipt } from './interchange.js';

export type { VaultSnapshot } from './reader.js';
export interface AppReview { id: string; name: string; path: string; revision: string; status: 'pending' | 'active' | 'invalid'; permissions: string[]; granted: string[]; source: string; diagnostics: Diagnostic[] }
export interface VaultMutation { id: string; app: string; type: string; action: string; record?: string; revision: string; definitionRevision?: string; fields: Record<string, unknown> }
export interface VaultMutationResult { id: string; status: 'applied' | 'failed'; message: string; resource?: string; path?: string; revision?: string; errorStatus?: number }
interface ReceiptRow { id: string; fingerprint: string; status: 'applied' | 'failed'; message: string; resource: string | null; path: string | null; revision: string | null; error_status: number | null }

function offered(app: AppCandidate): string[] {
  if (!app.definition || hasErrors(app.diagnostics)) return [];
  const permissions: string[] = [];
  for (const [name, type] of Object.entries(app.definition.types)) {
    const qualified = `${app.definition.id}.${name}`;
    permissions.push(`read:${qualified}`);
    if (Object.values(type.actions).some(action => action.operation === 'record.create')) permissions.push(`create:${qualified}`);
    if (Object.values(type.actions).some(action => action.operation === 'record.update')) permissions.push(`update:${qualified}`);
  }
  if (app.definition.id === 'wiki') permissions.push('notes:read');
  return permissions.sort();
}
function predicateMatches(predicate: Predicate, document: VaultDocument, type: DocumentType): boolean {
  const value = predicate.field === 'title' ? document.file.title : predicate.field === 'body' ? document.file.body : document.file.frontmatter[predicate.field];
  const field = own(type.fields, predicate.field) ?? own(builtinFields, predicate.field);
  const normalize = (entry: unknown) => field?.type === 'datetime' && typeof entry === 'string' ? Date.parse(entry) : field?.type === 'reference' && typeof entry === 'string' ? entry.toLowerCase() : entry;
  return ('equals' in predicate ? [predicate.equals] : predicate.in).some(entry => normalize(entry) === normalize(value));
}
function stable(value: unknown, depth = 0): string {
  if (depth > 8) throw new AppError(422, 'Mutation values are too deeply nested.');
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(item => stable(item, depth + 1)).join(',')}]`;
  if (isObject(value) && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)) return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stable(value[key], depth + 1)}`).join(',')}}`;
  throw new AppError(422, 'Mutation values must be JSON data.');
}
function receiptResult(row: ReceiptRow): VaultMutationResult {
  return { id: row.id, status: row.status, message: row.message,
    ...(row.resource === null ? {} : { resource: row.resource }), ...(row.path === null ? {} : { path: row.path }),
    ...(row.revision === null ? {} : { revision: row.revision }), ...(row.error_status === null ? {} : { errorStatus: row.error_status }) };
}

/** SQLite is the only live authority. Nested transactions participate in the caller's commit. */
export class VaultRuntime {
  constructor(readonly db: Database, options: { importRoot?: string } = {}) {
    initializeVault(db);
    if (options.importRoot !== undefined) this.importRoot(options.importRoot);
  }
  get root(): string {
    return this.db.query<{ value: string }, []>("SELECT value FROM vault_metadata WHERE key = 'import_root'").get()?.value ?? '';
  }
  importRoot(root: string): void {
    root = resolve(root);
    this.db.transaction(() => {
      const imported = this.root;
      if (imported) {
        if (imported !== root) throw new AppError(409, 'Database already imported a different vault.');
        return;
      }
      if (this.db.query<{ count: number }, []>('SELECT (SELECT count(*) FROM vault_apps) + (SELECT count(*) FROM vault_records) + (SELECT count(*) FROM vault_receipts) + (SELECT count(*) FROM vault_approvals) AS count').get()!.count) throw new AppError(409, 'Import requires an empty vault database.');
      const { snapshot, state } = readImport(root);
      for (const app of snapshot.apps) saveDefinition(this.db, app);
      for (const document of snapshot.documents) saveRecord(this.db, document);
      saveRelationships(this.db, snapshot.documents);
      for (const [id, approval] of Object.entries(state.approvals)) {
        const app = snapshot.apps.find(app => app.definition!.id === id);
        if (app?.file.path === approval.path && app.file.revision === approval.revision && approval.grants.some(grant => !offered(app).includes(grant))) throw new AppError(422, 'Legacy approval grants an undeclared capability.');
        this.saveApproval(id, approval);
      }
      for (const receipt of Object.values(state.receipts)) this.saveReceipt(receipt);
      this.db.query("INSERT INTO vault_metadata(key, value) VALUES ('import_root', ?)").run(root);
    }).immediate();
  }
  exportTo(root: string): void {
    const exported = this.db.transaction(() => {
      const snapshot = loadSnapshot(this.db, this.root);
      const state: LegacyState = { version: 1, root: resolve(root), approvals: this.approvals(), receipts: {} };
      for (const row of this.db.query<ReceiptRow, []>('SELECT * FROM vault_receipts ORDER BY id').all()) state.receipts[row.id] = { fingerprint: row.fingerprint, result: receiptResult(row) };
      return { snapshot, state };
    })();
    writeExport(root, exported.snapshot, exported.state);
  }
  /** Explicit definition replacement retains history and revokes its previous grants. */
  updateDefinition(path: string, source: string): void {
    if (!definitionPath(path) || typeof source !== 'string' || Buffer.byteLength(source) > MAX_FILE) throw new AppError(422, 'Provide a bounded Markdown definition under .apps/.');
    this.db.transaction(() => {
      const scan = loadSnapshot(this.db, this.root);
      const previous = scan.apps.find(app => app.file.path === path);
      const file = parseMarkdown(path, source);
      const proposed = snapshotFromFiles(this.root, [...scan.apps.filter(app => app.file.path !== path).map(app => app.file), file, ...scan.documents.map(document => document.file)]);
      if (proposed.apps.some(app => !app.definition || hasErrors(app.diagnostics))) throw new AppError(422, 'Definition update would leave invalid, duplicate or unresolved app definitions.');
      const app = proposed.apps.find(app => app.file.path === path)!;
      if (previous && previous.definition!.id !== app.definition!.id) throw new AppError(422, 'An installed app ID cannot be changed. Import a separate definition instead.');
      if (previous?.file.revision === file.revision) return;
      saveDefinition(this.db, app);
      this.db.query('DELETE FROM vault_approvals WHERE app_id = ?').run(app.definition!.id);
      saveRelationships(this.db, proposed.documents);
    }).immediate();
  }
  private approvals(): Record<string, Approval> {
    const approvals: Record<string, Approval> = Object.create(null) as Record<string, Approval>;
    for (const row of this.db.query<{ app_id: string; path: string; revision: string }, []>('SELECT * FROM vault_approvals').all()) approvals[row.app_id] = { path: row.path, revision: row.revision, grants: [] };
    for (const row of this.db.query<{ app_id: string; permission: string }, []>('SELECT * FROM vault_grants ORDER BY permission').all()) approvals[row.app_id]!.grants.push(row.permission);
    return approvals;
  }
  private saveApproval(id: string, approval: Approval): void {
    this.db.query(`INSERT INTO vault_approvals(app_id, path, revision) VALUES (?, ?, ?)
      ON CONFLICT(app_id) DO UPDATE SET path = excluded.path, revision = excluded.revision`).run(id, approval.path, approval.revision);
    this.db.query('DELETE FROM vault_grants WHERE app_id = ?').run(id);
    for (const permission of approval.grants) this.db.query('INSERT INTO vault_grants(app_id, permission) VALUES (?, ?)').run(id, permission);
  }
  private saveReceipt(receipt: Receipt): void {
    const result = receipt.result;
    this.db.query('INSERT INTO vault_receipts(id, fingerprint, status, message, resource, path, revision, error_status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(result.id, receipt.fingerprint, result.status, result.message, result.resource ?? null, result.path ?? null, result.revision ?? null, result.errorStatus ?? null);
  }
  private current(): { scan: VaultSnapshot; active: AppCandidate[]; types: Map<string, DocumentType>; documents: VaultDocument[]; approvals: Record<string, Approval> } {
    const scan = loadSnapshot(this.db, this.root);
    const approvals = this.approvals();
    const active = scan.apps.filter(app => {
      if (!app.definition || hasErrors(app.diagnostics)) return false;
      const approval = own(approvals, app.definition.id);
      return approval?.path === app.file.path && approval.revision === app.file.revision;
    });
    const types = new Map<string, DocumentType>();
    for (const app of active) for (const [name, type] of Object.entries(app.definition!.types)) types.set(`${app.definition!.id}.${name}`, type);
    const documents = scan.documents.map(document => validateRecord(document.file, types));
    validateRecordRelationships(documents);
    return { scan, active, types, documents, approvals };
  }
  reviews(): AppReview[] {
    return this.db.transaction(() => {
      const { scan, approvals } = this.current();
      return scan.apps.map(app => {
        const id = app.definition?.id ?? (typeof app.file.frontmatter.id === 'string' ? app.file.frontmatter.id : app.file.path);
        const approval = own(approvals, id);
        const active = !hasErrors(app.diagnostics) && !!app.definition && approval?.path === app.file.path && approval.revision === app.file.revision;
        return { id, name: app.definition?.name ?? app.file.title, path: app.file.path, revision: app.file.revision, status: hasErrors(app.diagnostics) || !app.definition ? 'invalid' as const : active ? 'active' as const : 'pending' as const, permissions: offered(app), granted: active ? [...approval!.grants] : [], source: app.file.source, diagnostics: app.diagnostics };
      });
    })();
  }
  approve(requests: unknown): void {
    this.db.transaction(() => {
      if (!Array.isArray(requests) || !requests.length || requests.length > 10_000) throw new AppError(422, 'Choose at least one app to approve.');
      const apps = new Map(loadSnapshot(this.db, this.root).apps.filter(app => app.definition).map(app => [app.definition!.id, app]));
      const approvals = new Map<string, Approval>();
      for (const request of requests) {
        if (!isObject(request) || Object.keys(request).some(key => !['app', 'revision', 'permissions'].includes(key)) || typeof request.app !== 'string' || typeof request.revision !== 'string' || !REVISION.test(request.revision) || !Array.isArray(request.permissions)) throw new AppError(422, 'Malformed app approval.');
        if (approvals.has(request.app)) throw new AppError(422, 'Each app may appear only once in an approval.');
        const app = apps.get(request.app);
        if (!app || hasErrors(app.diagnostics)) throw new AppError(422, 'Only valid app definitions may be approved.');
        if (app.file.revision !== request.revision) throw new AppError(409, 'An app definition changed. Nothing was approved; reload and review the current definitions.');
        const permissions = request.permissions;
        const offeredPermissions = offered(app);
        if (new Set(permissions).size !== permissions.length || permissions.some(permission => typeof permission !== 'string' || !offeredPermissions.includes(permission))) throw new AppError(422, 'Approval contains an undeclared capability.');
        approvals.set(request.app, { path: app.file.path, revision: request.revision, grants: [...permissions].sort() });
      }
      for (const [id, approval] of approvals) this.saveApproval(id, approval);
    }).immediate();
  }
  snapshot(): VaultSnapshot {
    return this.db.transaction(() => {
      const { scan, active, documents, approvals } = this.current();
      const grants = new Set(active.flatMap(app => approvals[app.definition!.id]!.grants));
      const readable = documents.filter(document => document.kind === 'record' ? grants.has(`read:${String(document.file.frontmatter.type)}`) : grants.has('notes:read'));
      const visible = readable.filter(document => !hasErrors(document.diagnostics));
      const readablePaths = new Set(readable.map(document => document.file.path));
      const diagnostics = [...active.flatMap(app => app.diagnostics), ...readable.flatMap(document => document.diagnostics).map(item => item.related ? { ...item, related: item.related.filter(path => readablePaths.has(path)) } : item)];
      return { root: scan.root, apps: active, documents: visible, report: { contract: 'lifeapps/check-v1' as const, valid: !hasErrors(diagnostics), counts: { files: active.length + readable.length, apps: active.length, validApps: active.length, records: readable.filter(document => document.kind === 'record').length, notes: readable.filter(document => document.kind === 'note').length, errors: diagnostics.filter(item => item.severity === 'error').length, warnings: diagnostics.filter(item => item.severity === 'warning').length }, diagnostics } };
    })();
  }
  receipt(id: string): VaultMutationResult | undefined {
    const row = this.db.query<ReceiptRow, [string]>('SELECT * FROM vault_receipts WHERE id = ?').get(id);
    return row ? receiptResult(row) : undefined;
  }
  execute(request: VaultMutation): VaultMutationResult {
    if (!request || typeof request.id !== 'string' || !ID.test(request.id)) throw new AppError(422, 'Mutation requires a bounded request ID.');
    const encoded = stable(request);
    const fingerprint = hash(encoded);
    return this.db.transaction(() => {
      const previous = this.db.query<ReceiptRow, [string]>('SELECT * FROM vault_receipts WHERE id = ?').get(request.id);
      if (previous) {
        if (previous.fingerprint !== fingerprint) return { id: request.id, status: 'failed' as const, message: 'Request ID was already used for different inputs.', errorStatus: 409 };
        return receiptResult(previous);
      }
      if (this.db.query<{ count: number }, []>('SELECT count(*) AS count FROM vault_receipts').get()!.count >= MAX_RECEIPTS) throw new AppError(507, 'Runtime receipt capacity has been reached.');
      let result: VaultMutationResult;
      try {
        // Savepoint rolls back any partially applied record/relationship write before a failure receipt.
        result = this.db.transaction(() => this.apply(request, encoded))();
      } catch (error) {
        result = { id: request.id, status: 'failed', message: error instanceof AppError ? error.message : 'Mutation could not be completed safely.', errorStatus: error instanceof AppError ? error.status : 500 };
      }
      this.saveReceipt({ fingerprint, result });
      return result;
    }).immediate();
  }
  private apply(request: VaultMutation, encoded: string): VaultMutationResult {
    if (Buffer.byteLength(encoded) > MAX_FILE) throw new AppError(413, 'Mutation exceeds the byte limit.');
    if (Object.keys(request).some(key => !['id', 'app', 'type', 'action', 'record', 'revision', 'definitionRevision', 'fields'].includes(key)) || typeof request.app !== 'string' || typeof request.type !== 'string' || typeof request.action !== 'string' || typeof request.revision !== 'string' || !REVISION.test(request.revision) || (request.definitionRevision !== undefined && (typeof request.definitionRevision !== 'string' || !REVISION.test(request.definitionRevision))) || !isObject(request.fields)) throw new AppError(422, 'Malformed mutation.');
    const { active, types, documents, approvals } = this.current();
    const app = active.find(app => app.definition!.id === request.app);
    if (!app) throw new AppError(403, 'App is not approved at its current definition revision.');
    if (request.definitionRevision !== undefined && request.definitionRevision !== app.file.revision) throw new AppError(409, 'Action definition changed; inspect the current action before editing.');
    const type = own(app.definition!.types, request.type);
    const action = type && own(type.actions, request.action);
    if (!type || !action) throw new AppError(422, 'Action is not declared by this document type.');
    const creating = action.operation === 'record.create';
    const qualified = `${request.app}.${request.type}`;
    if (!approvals[request.app]!.grants.includes(`${creating ? 'create' : 'update'}:${qualified}`)) throw new AppError(403, 'This mutation capability was not granted.');
    let document: VaultDocument | undefined;
    if (creating) {
      if (request.record !== undefined) throw new AppError(422, 'Creation cannot choose a record ID.');
      if (request.revision !== app.file.revision) throw new AppError(409, 'App definition changed; inspect the create action again.');
    } else {
      if (typeof request.record !== 'string' || !UUID.test(request.record)) throw new AppError(422, 'Update requires a record UUID.');
      const found = documents.filter(document => typeof document.file.frontmatter.id === 'string' && document.file.frontmatter.id.toLowerCase() === request.record!.toLowerCase());
      document = found[0];
      if (found.length !== 1 || !document || document.file.frontmatter.type !== qualified) throw new AppError(404, 'No unambiguous record of this type exists.');
      if (hasErrors(document.diagnostics)) throw new AppError(422, 'Invalid records must be repaired explicitly before app mutations.');
      if (document.file.revision !== request.revision) throw new AppError(409, 'Record changed; inspect it again before editing.');
      if (action.operation === 'record.update' && action.when && !predicateMatches(action.when, document, type)) throw new AppError(409, 'Action is no longer applicable to this record.');
    }
    const allowed = creating ? [...Object.keys(type.fields), 'title', 'body'] : action.operation === 'record.update' ? action.fields ?? [] : [];
    const fields: Record<string, unknown> = {};
    for (const [name, value] of Object.entries(request.fields)) {
      if (!allowed.includes(name)) throw new AppError(422, `Field is not editable by this action: ${name}.`);
      fields[name] = value;
    }
    if (action.operation === 'record.update') Object.assign(fields, action.set ?? {});
    for (const [name, value] of Object.entries(fields)) {
      const field = own(type.fields, name) ?? own(builtinFields, name);
      if (!field) throw new AppError(422, 'Action contains an unknown field.');
      if (value === null && !creating && !field.required && Object.hasOwn(type.fields, name)) continue;
      const error = valueError(field, value);
      if (error) throw new AppError(422, `${name}: ${error}`);
      if (name === 'title' && (typeof value !== 'string' || !value.trim() || value.length > 500 || /[\r\n\u0000-\u001f\u007f]/.test(value))) throw new AppError(422, 'Title must be nonempty single-line text of at most 500 characters.');
    }
    const id = creating ? randomUUID() : String(document!.file.frontmatter.id);
    const path = creating ? `${type.storage.defaultFolder}/${id}.md` : document!.file.path;
    if (!recordPath(path)) throw new AppError(422, 'Record path is not a visible Markdown path.');
    let source: string;
    if (creating) {
      const data: Record<string, unknown> = { id, type: qualified, schema: type.version };
      for (const [name, field] of Object.entries(type.fields)) {
        if (Object.hasOwn(fields, name)) data[name] = fields[name];
        else if (Object.hasOwn(field, 'default')) data[name] = field.default;
      }
      source = createMarkdown(data, fields);
    } else source = updateMarkdown(document!.file, fields);
    if (Buffer.byteLength(source) > MAX_FILE) throw new AppError(413, 'Resulting Markdown exceeds the file byte limit.');
    const proposal = validateRecord(parseMarkdown(path, source), types);
    const prospective = documents.filter(entry => entry.file.path !== path).map(entry => validateRecord(entry.file, types));
    prospective.push(proposal);
    validateRecordRelationships(prospective);
    const baseline = new Map(documents.map(entry => [entry.file.path, new Set(entry.diagnostics.filter(item => item.severity === 'error').map(item => `${item.code}:${item.field ?? ''}`))]));
    const introduced = prospective.flatMap(entry => entry.diagnostics.filter(item => item.severity === 'error' && (entry === proposal || !baseline.get(entry.file.path)?.has(`${item.code}:${item.field ?? ''}`))));
    if (introduced.length) throw new AppError(422, `Proposed record is invalid: ${introduced.slice(0, 4).map(item => item.message).join(' ')}`);
    saveRecord(this.db, proposal);
    saveRelationships(this.db, [proposal]);
    return { id: request.id, status: 'applied', message: creating ? 'Record created.' : 'Record updated.', resource: `/vault/records/${id}`, path, revision: proposal.file.revision };
  }
}
