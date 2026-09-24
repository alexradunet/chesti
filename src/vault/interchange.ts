import { createHash } from 'node:crypto';
import { constants, closeSync, fstatSync, fsyncSync, lstatSync, mkdirSync, openSync, readSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { AppError } from '../core.js';
import { isObject } from './markdown.js';
import { readVault, type VaultSnapshot } from './reader.js';
import { safeFolder } from './values.js';
import type { VaultMutationResult } from './runtime.js';

export const MAX_FILE = 1_048_576;
export const MAX_RECEIPTS = 10_000;
export const REVISION = /^[a-f0-9]{64}$/;
export const ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/;
export const hash = (source: string) => createHash('sha256').update(source).digest('hex');
const MAX_STATE = 16_777_216;
const missing = (error: unknown) => isObject(error) && error.code === 'ENOENT';
export interface Approval { path: string; revision: string; grants: string[] }
export interface Receipt { fingerprint: string; result: VaultMutationResult }
interface Pending { id: string; fingerprint: string; path: string; temporary: string; before?: string; after: string; result: VaultMutationResult }
export interface LegacyState { version: 1; root: string; approvals: Record<string, Approval>; receipts: Record<string, Receipt>; pending?: Pending }

function directory(path: string): void {
  const parent = dirname(path);
  if (parent !== path) directory(parent);
  const stat = lstatSync(path);
  if (!stat.isDirectory() || stat.isSymbolicLink() || realpathSync(path) !== path) throw new AppError(422, 'Interchange paths must use real directories, never symbolic links.');
}

export function definitionPath(path: string): boolean {
  return path.startsWith('.apps/') && safeFolder(path.slice(6)) && /\.md$/i.test(path);
}
export function recordPath(path: string): boolean { return safeFolder(path) && /\.md$/i.test(path); }

/** Explicit interchange only. Runtime queries never call filesystem readers. */
export function readImportFile(path: string, limit = MAX_FILE, links = 1): string | undefined {
  path = resolve(path);
  try { directory(dirname(path)); } catch (error) { if (missing(error)) return undefined; throw error; }
  let fd: number;
  try { fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK); }
  catch (error) { if (missing(error)) return undefined; throw error; }
  try {
    const before = fstatSync(fd, { bigint: true });
    if (!before.isFile() || before.nlink !== BigInt(links) || before.size > BigInt(limit)) throw new AppError(422, 'Only bounded regular interchange files without unexpected hard links are supported.');
    const buffer = Buffer.alloc(Number(before.size) + 1);
    let size = 0;
    while (size < buffer.length) { const count = readSync(fd, buffer, size, buffer.length - size, null); if (!count) break; size += count; }
    const after = fstatSync(fd, { bigint: true });
    const current = lstatSync(path, { bigint: true });
    if (before.ino !== current.ino || before.dev !== current.dev || current.nlink !== BigInt(links) || before.size !== BigInt(size) || before.mtimeNs !== after.mtimeNs || before.ctimeNs !== after.ctimeNs || before.mtimeNs !== current.mtimeNs || before.ctimeNs !== current.ctimeNs || current.isSymbolicLink()) throw new AppError(409, 'Interchange file changed while being read.');
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(buffer.subarray(0, size));
  } finally { closeSync(fd); }
}

function validResult(value: unknown, id: string): value is VaultMutationResult {
  return isObject(value) && value.id === id && ['applied', 'failed'].includes(String(value.status)) && typeof value.message === 'string' &&
    (value.resource === undefined || typeof value.resource === 'string') &&
    (value.path === undefined || (typeof value.path === 'string' && recordPath(value.path))) &&
    (value.revision === undefined || (typeof value.revision === 'string' && REVISION.test(value.revision))) &&
    (value.errorStatus === undefined || (Number.isInteger(value.errorStatus) && Number(value.errorStatus) >= 400 && Number(value.errorStatus) <= 599));
}

function parseLegacy(source: string, root: string): LegacyState {
  let state: unknown;
  try { state = JSON.parse(source); } catch { throw new AppError(422, 'Legacy runtime state is not valid JSON.'); }
  if (!isObject(state) || state.version !== 1 || state.root !== root || !isObject(state.approvals) || !isObject(state.receipts)) throw new AppError(422, 'Legacy runtime state is invalid or belongs to another vault.');
  for (const [id, entry] of Object.entries(state.approvals)) if (!/^[a-z][a-z0-9-]{0,47}$/.test(id) || !isObject(entry) || typeof entry.path !== 'string' || !definitionPath(entry.path) || typeof entry.revision !== 'string' || !REVISION.test(entry.revision) || !Array.isArray(entry.grants) || !entry.grants.every(grant => typeof grant === 'string') || new Set(entry.grants).size !== entry.grants.length) throw new AppError(422, 'Legacy approval state is invalid.');
  for (const [id, entry] of Object.entries(state.receipts)) if (!ID.test(id) || !isObject(entry) || typeof entry.fingerprint !== 'string' || !REVISION.test(entry.fingerprint) || !validResult(entry.result, id)) throw new AppError(422, 'Legacy receipt state is invalid.');
  if (Object.keys(state.receipts).length + Number(state.pending !== undefined) > MAX_RECEIPTS) throw new AppError(507, 'Legacy runtime receipt capacity has been reached.');
  if (state.pending !== undefined) {
    const pending = state.pending;
    if (!isObject(pending) || typeof pending.id !== 'string' || !ID.test(pending.id) || Object.hasOwn(state.receipts, pending.id) || typeof pending.fingerprint !== 'string' || !REVISION.test(pending.fingerprint) || typeof pending.path !== 'string' || !recordPath(pending.path) || typeof pending.temporary !== 'string' || typeof pending.after !== 'string' || !REVISION.test(pending.after) || (pending.before !== undefined && (typeof pending.before !== 'string' || !REVISION.test(pending.before))) || !validResult(pending.result, pending.id) || pending.result.status !== 'applied' || pending.result.path !== pending.path || pending.result.revision !== pending.after) throw new AppError(422, 'Legacy pending journal is invalid.');
    if (dirname(pending.temporary) !== dirname(pending.path) || !/^\.lifeapps-[a-f0-9-]+\.tmp$/.test(pending.temporary.split('/').at(-1)!)) throw new AppError(422, 'Legacy journal staging path is invalid.');
  }
  return state as unknown as LegacyState;
}

export function readImport(root: string): { snapshot: VaultSnapshot; state: LegacyState } {
  root = resolve(root);
  directory(root);
  const stateFile = join(root, '.lifeapps/runtime.json');
  const stateSource = readImportFile(stateFile, MAX_STATE);
  const state: LegacyState = stateSource === undefined ? { version: 1, root, approvals: {}, receipts: {} } : parseLegacy(stateSource, root);
  const pending = state.pending;
  let linkedTarget: string | undefined;
  if (pending) {
    // Old creation could crash between link and unlink. Recognize only its exact pair;
    // neither remove the staging name nor replay a publication into the source vault.
    let target;
    let staging;
    try { target = lstatSync(join(root, pending.path)); } catch (error) { if (!missing(error)) throw error; }
    try { directory(dirname(join(root, pending.temporary))); staging = lstatSync(join(root, pending.temporary)); } catch (error) { if (!missing(error)) throw error; }
    if (pending.before === undefined && target?.isFile() && staging?.isFile() && !target.isSymbolicLink() && !staging.isSymbolicLink() && target.ino === staging.ino && target.dev === staging.dev && target.nlink === 2 && staging.nlink === 2) linkedTarget = pending.path;
    if (staging) readImportFile(join(root, pending.temporary), MAX_FILE, linkedTarget ? 2 : 1);
    const source = readImportFile(join(root, pending.path), MAX_FILE, linkedTarget ? 2 : 1);
    state.receipts[pending.id] = { fingerprint: pending.fingerprint, result: source !== undefined && hash(source) === pending.after ? pending.result : { id: pending.id, status: 'failed', message: 'Interrupted mutation was not published, or its target changed. No recovery write was attempted.', errorStatus: 409 } };
  }
  const snapshot = readVault(root);
  if (!snapshot.report.valid) throw new AppError(422, `Vault import rejected: ${snapshot.report.diagnostics.filter(item => item.severity === 'error').slice(0, 4).map(item => `${item.file}: ${item.message}`).join(' ')}`);
  const files = new Map([...snapshot.apps, ...snapshot.documents].map(entry => [entry.file.path, entry.file]));
  let entries = 0;
  const inspect = (folder: string, prefix: string, depth: number): void => {
    if (depth > 32) throw new AppError(422, 'Import directory limit exceeded.');
    directory(folder);
    for (const name of readdirSync(folder)) {
      if ((name.startsWith('.') && !(prefix === '' && name === '.apps')) || name === 'node_modules') continue;
      if (++entries > 10_000) throw new AppError(422, 'Import entry limit exceeded.');
      const path = prefix ? `${prefix}/${name}` : name;
      const absolute = join(folder, name);
      const stat = lstatSync(absolute);
      if (stat.isSymbolicLink()) throw new AppError(422, 'Import cannot follow symbolic links.');
      if (stat.isDirectory()) { inspect(absolute, path, depth + 1); continue; }
      const file = files.get(path);
      if (!file || !(definitionPath(path) || recordPath(path))) throw new AppError(422, `Unsupported or changed interchange file: ${path}. Import only Markdown vault content.`);
      const source = readImportFile(absolute, MAX_FILE, path === linkedTarget ? 2 : 1);
      if (source === undefined || hash(source) !== file.revision) throw new AppError(409, 'Vault changed during import.');
      files.delete(path);
    }
  };
  inspect(root, '', 0);
  if (files.size || readImportFile(stateFile, MAX_STATE) !== stateSource) throw new AppError(409, 'Vault changed during import.');
  if (pending) {
    const source = readImportFile(join(root, pending.path), MAX_FILE, linkedTarget ? 2 : 1);
    const applied = state.receipts[pending.id]!.result.status === 'applied';
    if (applied !== (source !== undefined && hash(source) === pending.after)) throw new AppError(409, 'Pending target changed during import.');
  }
  delete state.pending;
  return { snapshot, state };
}

/** Exclusively create a new export tree; never merge into or overwrite user files. */
export function writeExport(root: string, snapshot: VaultSnapshot, state: LegacyState): void {
  root = resolve(root);
  directory(dirname(root));
  mkdirSync(root, { mode: 0o700 });
  for (const entry of [...snapshot.apps, ...snapshot.documents]) {
    const file = entry.file;
    if (!(definitionPath(file.path) || recordPath(file.path))) throw new AppError(422, 'Stored interchange path is unsafe.');
    const target = join(root, file.path);
    mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
    directory(dirname(target));
    const fd = openSync(target, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    try { writeFileSync(fd, file.source); fsyncSync(fd); } finally { closeSync(fd); }
  }
  mkdirSync(join(root, '.apps'), { recursive: true, mode: 0o700 });
  mkdirSync(join(root, '.lifeapps'), { mode: 0o700 });
  const fd = openSync(join(root, '.lifeapps/runtime.json'), constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try { writeFileSync(fd, JSON.stringify({ ...state, root })); fsyncSync(fd); } finally { closeSync(fd); }
}
