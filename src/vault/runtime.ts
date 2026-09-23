import { createHash, randomUUID } from 'node:crypto';
import { constants, closeSync, fstatSync, fsyncSync, linkSync, lstatSync, mkdirSync, openSync, readSync, realpathSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { AppError } from '../core.js';
import type { AppCandidate } from './definition.js';
import { isObject, parseMarkdown, type Diagnostic } from './markdown.js';
import { createMarkdown, updateMarkdown } from './mutation.js';
import { readVault, type VaultSnapshot } from './reader.js';
import { hasErrors, validateRecord, validateRecordRelationships, type VaultDocument } from './records.js';
import type { DocumentType, Predicate } from './schema.js';
import { builtinFields, own, safeFolder, UUID, valueError } from './values.js';

export type { VaultSnapshot } from './reader.js';
export interface AppReview { id: string; name: string; path: string; revision: string; status: 'pending' | 'active' | 'invalid'; permissions: string[]; granted: string[]; source: string; diagnostics: Diagnostic[] }
export interface VaultMutation { id: string; app: string; type: string; action: string; record?: string; revision: string; definitionRevision?: string; fields: Record<string, unknown> }
export interface VaultMutationResult { id: string; status: 'applied' | 'failed'; message: string; resource?: string; path?: string; revision?: string; errorStatus?: number }
interface Approval { path: string; revision: string; grants: string[] }
interface Receipt { fingerprint: string; result: VaultMutationResult }
interface Pending { id: string; fingerprint: string; path: string; temporary: string; before?: string; after: string; result: VaultMutationResult }
interface State { version: 1; root: string; approvals: Record<string, Approval>; receipts: Record<string, Receipt>; pending?: Pending }
const MAX_FILE = 1_048_576;
const MAX_STATE = 16_777_216;
const MAX_RECEIPTS = 10_000;
const REVISION = /^[a-f0-9]{64}$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/;
const hash = (source: string) => createHash('sha256').update(source).digest('hex');
const missing = (error: unknown) => isObject(error) && error.code === 'ENOENT';

/** No symlink component is allowed, even in the explicitly supplied state path. */
function directory(path: string, create = false): void {
  const parent = dirname(path);
  if (parent !== path) directory(parent, create);
  let stat;
  try { stat = lstatSync(path); }
  catch (error) {
    if (!create || !missing(error)) throw error;
    mkdirSync(path, { mode: 0o700 });
    syncDirectory(parent);
    stat = lstatSync(path);
  }
  if (!stat.isDirectory() || stat.isSymbolicLink() || realpathSync(path) !== path) throw new AppError(422, 'A filesystem path is not a real directory.');
}
function syncDirectory(path: string): void {
  const fd = openSync(path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try { fsyncSync(fd); } finally { closeSync(fd); }
}
function safeRead(path: string, limit: number): string | undefined {
  directory(dirname(path));
  let fd: number;
  try { fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK); }
  catch (error) { if (missing(error)) return undefined; throw error; }
  try {
    const before = fstatSync(fd, { bigint: true });
    if (!before.isFile() || before.nlink !== 1n || before.size > BigInt(limit)) throw new AppError(422, 'Only bounded, unlinked regular files are safe to use.');
    const buffer = Buffer.alloc(Number(before.size) + 1);
    let size = 0;
    while (size < buffer.length) { const count = readSync(fd, buffer, size, buffer.length - size, null); if (!count) break; size += count; }
    const after = fstatSync(fd, { bigint: true });
    const current = lstatSync(path, { bigint: true });
    if (before.ino !== current.ino || before.dev !== current.dev || current.nlink !== 1n || before.size !== BigInt(size) || before.mtimeNs !== after.mtimeNs || before.ctimeNs !== after.ctimeNs || current.isSymbolicLink()) throw new AppError(409, 'File changed while being read.');
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(buffer.subarray(0, size));
  } finally { closeSync(fd); }
}
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

/**
 * Synchronous, single-process authority. The private journal is fsynced before publication;
 * restart reconciles the published content hash, never replays a write over external edits.
 * O_NOFOLLOW, inode checks and final revision checks fail closed on observed changes. Node
 * has no portable renameat2/openat transaction: hostile directory swaps or external edits in
 * the last check-to-rename window require OS isolation. Do not share a vault between writers.
 */
export class VaultRuntime {
  readonly root: string;
  readonly stateFile: string;
  private state: State;
  private stateRevision: string | undefined;
  private persistedState: string | undefined;

  constructor(root: string, stateFile?: string) {
    this.root = resolve(root);
    directory(this.root);
    this.stateFile = resolve(stateFile ?? join(this.root, '.lifeapps', 'runtime.json'));
    const location = relative(this.root, this.stateFile);
    if (location === '' || (!isAbsolute(location) && location !== '..' && !location.startsWith(`..${sep}`) && (!location.split(sep)[0]!.startsWith('.') || location.split(sep)[0] === '.apps'))) throw new AppError(422, 'Runtime state must be outside the visible vault scan.');
    directory(dirname(this.stateFile), true);
    const source = safeRead(this.stateFile, MAX_STATE);
    this.stateRevision = source === undefined ? undefined : hash(source);
    this.persistedState = source;
    this.state = source === undefined ? { version: 1, root: this.root, approvals: {}, receipts: {} } : this.parseState(source);
    if (source === undefined) this.save();
    this.recover();
  }
  private parseState(source: string): State {
    const state: unknown = JSON.parse(source);
    if (!isObject(state) || state.version !== 1 || state.root !== this.root || !isObject(state.approvals) || !isObject(state.receipts)) throw new AppError(422, 'Runtime state is invalid or belongs to another vault.');
    for (const [id, entry] of Object.entries(state.approvals)) if (!/^[a-z][a-z0-9-]{0,47}$/.test(id) || !isObject(entry) || typeof entry.path !== 'string' || !entry.path.startsWith('.apps/') || typeof entry.revision !== 'string' || !REVISION.test(entry.revision) || !Array.isArray(entry.grants) || !entry.grants.every(grant => typeof grant === 'string')) throw new AppError(422, 'Runtime approval state is invalid.');
    for (const [id, entry] of Object.entries(state.receipts)) if (!ID.test(id) || !isObject(entry) || typeof entry.fingerprint !== 'string' || !REVISION.test(entry.fingerprint) || !isObject(entry.result) || entry.result.id !== id || !['applied', 'failed'].includes(String(entry.result.status))) throw new AppError(422, 'Runtime receipt state is invalid.');
    if (Object.keys(state.receipts).length > MAX_RECEIPTS) throw new AppError(507, 'Runtime receipt capacity has been reached.');
    if (state.pending !== undefined) {
      const pending = state.pending;
      if (!isObject(pending) || typeof pending.id !== 'string' || !ID.test(pending.id) || typeof pending.fingerprint !== 'string' || !REVISION.test(pending.fingerprint) || typeof pending.path !== 'string' || typeof pending.temporary !== 'string' || typeof pending.after !== 'string' || !REVISION.test(pending.after) || (pending.before !== undefined && (typeof pending.before !== 'string' || !REVISION.test(pending.before))) || !isObject(pending.result) || pending.result.id !== pending.id || pending.result.status !== 'applied') throw new AppError(422, 'Runtime journal is invalid.');
      this.recordPath(pending.path);
      if (dirname(pending.temporary) !== dirname(pending.path) || !/^\.lifeapps-[a-f0-9-]+\.tmp$/.test(pending.temporary.split('/').at(-1)!)) throw new AppError(422, 'Runtime journal temporary path is invalid.');
    }
    return state as unknown as State;
  }
  private save(): void {
    let temporary: string | undefined;
    try {
      const current = safeRead(this.stateFile, MAX_STATE);
      if ((current === undefined ? undefined : hash(current)) !== this.stateRevision) throw new AppError(409, 'Runtime state changed externally; restart before writing.');
      const source = JSON.stringify(this.state);
      if (Buffer.byteLength(source) > MAX_STATE) throw new AppError(507, 'Runtime state capacity has been reached.');
      temporary = join(dirname(this.stateFile), `.runtime-${randomUUID()}.tmp`);
      const fd = openSync(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
      try { writeFileSync(fd, source); fsyncSync(fd); } finally { closeSync(fd); }
      const latest = safeRead(this.stateFile, MAX_STATE);
      if ((latest === undefined ? undefined : hash(latest)) !== this.stateRevision) throw new AppError(409, 'Runtime state changed externally; restart before writing.');
      renameSync(temporary, this.stateFile);
      this.persistedState = source;
      this.stateRevision = hash(source);
      syncDirectory(dirname(this.stateFile));
    } catch (error) {
      // Failed persistence cannot leave an uncommitted grant/receipt active in memory.
      if (this.persistedState !== undefined) this.state = this.parseState(this.persistedState);
      throw error;
    } finally {
      if (temporary) try { unlinkSync(temporary); } catch (error) { if (!missing(error)) throw error; }
    }
  }
  private recordPath(path: string): string {
    if (!safeFolder(path) || !/\.md$/i.test(path)) throw new AppError(422, 'Record path is not a visible Markdown path.');
    return join(this.root, path);
  }
  private recover(): void {
    const pending = this.state.pending;
    if (!pending) return;
    const path = this.recordPath(pending.path);
    const temporary = join(this.root, pending.temporary);
    directory(dirname(path));
    // Creation uses link+unlink for atomic no-clobber publication. Finish that unlink
    // if a crash left the newly published file and our private staging name hard-linked.
    try {
      const target = lstatSync(path);
      const staging = lstatSync(temporary);
      if (pending.before === undefined && target.isFile() && staging.isFile() && !target.isSymbolicLink() && !staging.isSymbolicLink() && target.ino === staging.ino && target.dev === staging.dev && target.nlink === 2 && staging.nlink === 2) unlinkSync(temporary);
    } catch (error) { if (!missing(error)) throw error; }
    let result: VaultMutationResult;
    try {
      const source = safeRead(path, MAX_FILE);
      result = source !== undefined && hash(source) === pending.after
        ? pending.result
        : { id: pending.id, status: 'failed', message: 'Interrupted mutation was not published, or the file changed externally. No recovery write was attempted.', errorStatus: 409 };
      syncDirectory(dirname(path));
    } catch {
      result = { id: pending.id, status: 'failed', message: 'Interrupted mutation has an unsafe or externally changed target. No recovery write was attempted.', errorStatus: 409 };
    }
    try {
      const stat = lstatSync(temporary);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) throw new AppError(422, 'Unsafe interrupted staging file.');
      unlinkSync(temporary);
      syncDirectory(dirname(path));
    } catch (error) { if (!missing(error)) throw error; }
    this.state.receipts[pending.id] = { fingerprint: pending.fingerprint, result };
    delete this.state.pending;
    this.save();
  }
  private current(): { scan: VaultSnapshot; active: AppCandidate[]; types: Map<string, DocumentType>; documents: VaultDocument[] } {
    const scan = readVault(this.root);
    const active = scan.apps.filter(app => {
      if (!app.definition || hasErrors(app.diagnostics)) return false;
      const approval = own(this.state.approvals, app.definition.id);
      return approval?.path === app.file.path && approval.revision === app.file.revision;
    });
    const types = new Map<string, DocumentType>();
    for (const app of active) for (const [name, type] of Object.entries(app.definition!.types)) types.set(`${app.definition!.id}.${name}`, type);
    const documents = scan.documents.map(document => validateRecord(document.file, types));
    validateRecordRelationships(documents);
    return { scan, active, types, documents };
  }
  reviews(): AppReview[] {
    const { scan } = this.current();
    return scan.apps.map(app => {
      const id = app.definition?.id ?? (typeof app.file.frontmatter.id === 'string' ? app.file.frontmatter.id : app.file.path);
      const approval = own(this.state.approvals, id);
      const active = !hasErrors(app.diagnostics) && !!app.definition && approval?.path === app.file.path && approval.revision === app.file.revision;
      return { id, name: app.definition?.name ?? app.file.title, path: app.file.path, revision: app.file.revision, status: hasErrors(app.diagnostics) || !app.definition ? 'invalid' : active ? 'active' : 'pending', permissions: offered(app), granted: active ? [...approval!.grants] : [], source: app.file.source, diagnostics: app.diagnostics };
    });
  }
  approve(appId: string, revision: string, permissions: string[]): void {
    this.recover();
    const candidates = readVault(this.root).apps.filter(app => app.definition?.id === appId);
    const app = candidates[0];
    if (candidates.length !== 1 || !app || hasErrors(app.diagnostics)) throw new AppError(422, 'Only one valid app definition may be approved.');
    if (app.file.revision !== revision) throw new AppError(409, 'App definition changed; review the current source first.');
    const offeredPermissions = offered(app);
    if (!Array.isArray(permissions) || new Set(permissions).size !== permissions.length || permissions.some(permission => !offeredPermissions.includes(permission))) throw new AppError(422, 'Approval contains an undeclared capability.');
    const fresh = safeRead(join(this.root, app.file.path), MAX_FILE);
    if (fresh === undefined || hash(fresh) !== revision) throw new AppError(409, 'App definition changed during approval.');
    this.state.approvals[appId] = { path: app.file.path, revision, grants: [...permissions].sort() };
    this.save();
  }
  snapshot(): VaultSnapshot {
    const { scan, active, documents } = this.current();
    const grants = new Set(active.flatMap(app => this.state.approvals[app.definition!.id]!.grants));
    const readable = documents.filter(document => document.kind === 'record' ? grants.has(`read:${String(document.file.frontmatter.type)}`) : grants.has('notes:read'));
    const visible = readable.filter(document => !hasErrors(document.diagnostics));
    const readablePaths = new Set(readable.map(document => document.file.path));
    const diagnostics = [
      ...scan.report.diagnostics.filter(item => item.severity === 'error' && /^(?:VAULT_|FILE_)/.test(item.code)),
      ...active.flatMap(app => app.diagnostics),
      ...readable.flatMap(document => document.diagnostics).map(item => item.related ? { ...item, related: item.related.filter(path => readablePaths.has(path)) } : item),
    ];
    return { root: scan.root, apps: active, documents: visible, report: { contract: 'lifeapps/check-v1', valid: !hasErrors(diagnostics), counts: { files: active.length + readable.length, apps: active.length, validApps: active.length, records: readable.filter(document => document.kind === 'record').length, notes: readable.filter(document => document.kind === 'note').length, errors: diagnostics.filter(item => item.severity === 'error').length, warnings: diagnostics.filter(item => item.severity === 'warning').length }, diagnostics } };
  }
  receipt(id: string): VaultMutationResult | undefined {
    this.recover();
    const result = own(this.state.receipts, id)?.result;
    return result ? structuredClone(result) : undefined;
  }
  execute(request: VaultMutation): VaultMutationResult {
    this.recover();
    if (!request || typeof request.id !== 'string' || !ID.test(request.id)) throw new AppError(422, 'Mutation requires a bounded request ID.');
    const encoded = stable(request);
    const fingerprint = hash(encoded);
    const previous = own(this.state.receipts, request.id);
    if (previous) {
      if (previous.fingerprint !== fingerprint) return { id: request.id, status: 'failed', message: 'Request ID was already used for different inputs.', errorStatus: 409 };
      return structuredClone(previous.result);
    }
    if (Object.keys(this.state.receipts).length >= MAX_RECEIPTS) throw new AppError(507, 'Runtime receipt capacity has been reached; archive state before adding mutations.');
    try {
      if (Buffer.byteLength(encoded) > MAX_FILE) throw new AppError(413, 'Mutation exceeds the byte limit.');
      if (Object.keys(request).some(key => !['id', 'app', 'type', 'action', 'record', 'revision', 'definitionRevision', 'fields'].includes(key)) || typeof request.app !== 'string' || typeof request.type !== 'string' || typeof request.action !== 'string' || typeof request.revision !== 'string' || !REVISION.test(request.revision) || (request.definitionRevision !== undefined && (typeof request.definitionRevision !== 'string' || !REVISION.test(request.definitionRevision))) || !isObject(request.fields)) throw new AppError(422, 'Malformed mutation.');
      const { scan, active, types, documents } = this.current();
      if (scan.report.diagnostics.some(item => item.severity === 'error' && (/^VAULT_|^FILE_/.test(item.code)))) throw new AppError(409, 'Vault scan is incomplete or unsafe; resolve its diagnostics before writing.');
      const app = active.find(app => app.definition!.id === request.app);
      if (!app) throw new AppError(403, 'App is not approved at its current definition revision.');
      if (request.definitionRevision !== undefined && request.definitionRevision !== app.file.revision) throw new AppError(409, 'Action definition changed; inspect the current action before editing.');
      const type = own(app.definition!.types, request.type);
      const action = type && own(type.actions, request.action);
      if (!type || !action) throw new AppError(422, 'Action is not declared by this document type.');
      const creating = action.operation === 'record.create';
      const qualified = `${request.app}.${request.type}`;
      if (!this.state.approvals[request.app]!.grants.includes(`${creating ? 'create' : 'update'}:${qualified}`)) throw new AppError(403, 'This mutation capability was not granted.');
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
      const target = this.recordPath(path);
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
      // A second bounded scan closes ordinary external-edit windows during proposal construction.
      const fresh = this.current();
      const revisions = new Map([...scan.apps.map(entry => [entry.file.path, entry.file.revision] as const), ...scan.documents.map(entry => [entry.file.path, entry.file.revision] as const)]);
      if (fresh.scan.apps.length !== scan.apps.length || fresh.scan.documents.length !== scan.documents.length || [...fresh.scan.apps, ...fresh.scan.documents].some(entry => revisions.get(entry.file.path) !== entry.file.revision) || fresh.scan.report.diagnostics.some(item => item.severity === 'error' && /^(?:VAULT_|FILE_)/.test(item.code))) throw new AppError(409, 'Vault changed during validation; retry after inspecting it.');
      directory(dirname(target), creating);
      const before = safeRead(target, MAX_FILE);
      if (creating ? before !== undefined : before === undefined || hash(before) !== request.revision) throw new AppError(409, 'Record changed before publication.');
      const result: VaultMutationResult = { id: request.id, status: 'applied', message: creating ? 'Record created.' : 'Record updated.', resource: `/vault/records/${id}`, path, revision: hash(source) };
      if (before === source) {
        this.state.receipts[request.id] = { fingerprint, result };
        this.save();
        return structuredClone(result);
      }
      const temporaryPath = `${path.includes('/') ? path.slice(0, path.lastIndexOf('/') + 1) : ''}.lifeapps-${randomUUID()}.tmp`;
      this.state.pending = { id: request.id, fingerprint, path, temporary: temporaryPath, ...(before === undefined ? {} : { before: hash(before) }), after: result.revision!, result };
      this.save();
      const temporary = join(this.root, temporaryPath);
      const fd = openSync(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
      try { writeFileSync(fd, source); fsyncSync(fd); } finally { closeSync(fd); }
      const latest = safeRead(target, MAX_FILE);
      const definition = safeRead(join(this.root, app.file.path), MAX_FILE);
      if ((creating ? latest !== undefined : latest === undefined || hash(latest) !== request.revision) || definition === undefined || hash(definition) !== app.file.revision) throw new AppError(409, 'Record or app changed before publication.');
      if (creating) { linkSync(temporary, target); unlinkSync(temporary); }
      else renameSync(temporary, target);
      syncDirectory(dirname(target));
      this.recover();
      return structuredClone(this.state.receipts[request.id]!.result);
    } catch (error) {
      const settled = own(this.state.receipts, request.id);
      if (settled?.fingerprint === fingerprint) {
        syncDirectory(dirname(this.stateFile));
        return structuredClone(settled.result);
      }
      if (this.state.pending) {
        this.recover();
        return structuredClone(this.state.receipts[request.id]!.result);
      }
      const result: VaultMutationResult = { id: request.id, status: 'failed', message: error instanceof AppError ? error.message : 'Mutation could not be completed safely.', errorStatus: error instanceof AppError ? error.status : 500 };
      this.state.receipts[request.id] = { fingerprint, result };
      this.save();
      return result;
    }
  }
}
