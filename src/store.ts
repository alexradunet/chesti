import { randomBytes, randomUUID } from 'node:crypto';
import { constants, closeSync, existsSync, fstatSync, openSync, readFileSync } from 'node:fs';
import type { Database } from 'bun:sqlite';
import { openDatabase } from './database.js';
import { seedIssues, type Issue } from './issues.js';
import type { ViewPlan } from './core.js';
import type { SessionEntry } from '@earendil-works/pi-coding-agent';
import type { VaultMutation, VaultRuntime } from './vault/runtime.js';

export interface Composition {
  plan: ViewPlan;
  engine: 'pi' | 'demo' | 'fallback';
  note: string;
  model?: string;
  inspected: string[];
  elapsedMs: number;
}
export interface Receipt {
  id: string;
  source: 'pi' | 'form' | 'demo';
  turnId?: string;
  resource: string;
  action: string;
  fields: Record<string, string>;
  version: number | string;
  vaultRequest?: VaultMutation;
  executionStarted?: boolean;
  status: 'applied' | 'pending' | 'failed' | 'cancelled';
  message: string;
  errorStatus?: number;
  created: string;
}
export interface ChatTurn {
  id: string;
  message: string;
  engine: 'pi' | 'demo';
  selected: string[];
  visible: string[];
  focus: string;
  response: string;
  status: 'running' | 'done' | 'failed' | 'stopped';
  notice?: string;
  created: string;
}
export interface Conversation {
  engine: 'pi' | 'demo';
  turns: ChatTurn[];
  receipts: Receipt[];
  entries: SessionEntry[];
}
export interface Workspace extends Composition {
  id: string; task: string; created: string;
  revision: number;
  kind?: 'today';
  previousPlan?: ViewPlan;
  previousComposition?: Composition;
  conversation: Conversation;
}
function initializeWorkspace(workspace: Workspace): Workspace {
  workspace.revision ??= 1;
  workspace.conversation ??= { engine: workspace.engine === 'demo' ? 'demo' : 'pi', turns: [], receipts: [], entries: [] };
  return workspace;
}
export interface Visitor {
  id: string;
  csrf: string;
  issues: Issue[];
  workspaces: Workspace[];
}

// Browser-owned state is relationally separated from shared app records.
// In-memory objects live for this single server process; SQLite owns durability.
export class Store {
  private visitors: Visitor[] = [];
  readonly db: Database;
  vault?: VaultRuntime;
  reconcileVaultReceipts() {
    if (!this.vault) return;
    for (const visitor of this.visitors) for (const workspace of visitor.workspaces) {
      for (const receipt of workspace.conversation.receipts) {
        if (!receipt.vaultRequest || !receipt.executionStarted || receipt.status !== 'pending') continue;
        const result = this.vault.receipt(receipt.id);
        receipt.status = result?.status ?? 'failed';
        receipt.message = result?.message ?? 'Interrupted before the record transaction. No automatic retry was made.';
        receipt.errorStatus = result?.errorStatus;
      }
    }
    this.save();
  }
  constructor(db: Database = openDatabase()) {
    this.db = db;
    db.transaction(() => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS browser_schema (version INTEGER NOT NULL);
        INSERT INTO browser_schema SELECT 1 WHERE NOT EXISTS (SELECT 1 FROM browser_schema);
      `);
      const schema = db.query<{ version: number }, []>('SELECT version FROM browser_schema').get();
      if (schema?.version !== 1) throw new Error('Unsupported browser database schema.');
      db.exec(`
        CREATE TABLE IF NOT EXISTS browser_imports (source TEXT PRIMARY KEY);
        CREATE TABLE IF NOT EXISTS browser_visitors (id TEXT PRIMARY KEY, csrf TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS sandbox_issues (
          visitor_id TEXT NOT NULL REFERENCES browser_visitors(id) ON DELETE CASCADE,
          id TEXT NOT NULL, position INTEGER NOT NULL, data TEXT NOT NULL CHECK(json_valid(data)),
          PRIMARY KEY(visitor_id, id)
        );
        CREATE TABLE IF NOT EXISTS workspaces (
          id TEXT PRIMARY KEY, visitor_id TEXT NOT NULL REFERENCES browser_visitors(id) ON DELETE CASCADE,
          position INTEGER NOT NULL, data TEXT NOT NULL CHECK(json_valid(data))
        );
        CREATE INDEX IF NOT EXISTS workspaces_visitor ON workspaces(visitor_id, position);
        CREATE TABLE IF NOT EXISTS chat_turns (
          id TEXT NOT NULL, workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
          position INTEGER NOT NULL, data TEXT NOT NULL CHECK(json_valid(data)), PRIMARY KEY(workspace_id, id)
        );
        CREATE TABLE IF NOT EXISTS action_receipts (
          id TEXT NOT NULL, workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
          position INTEGER NOT NULL, data TEXT NOT NULL CHECK(json_valid(data)), PRIMARY KEY(workspace_id, id)
        );
        CREATE TABLE IF NOT EXISTS sdk_entries (
          workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
          position INTEGER NOT NULL, data TEXT NOT NULL CHECK(json_valid(data)), PRIMARY KEY(workspace_id, position)
        );
      `);
    })();
    const issues = db.query<{ data: string }, [string]>('SELECT data FROM sandbox_issues WHERE visitor_id = ? ORDER BY position');
    const workspaces = db.query<{ id: string; data: string }, [string]>('SELECT id, data FROM workspaces WHERE visitor_id = ? ORDER BY position');
    const turns = db.query<{ data: string }, [string]>('SELECT data FROM chat_turns WHERE workspace_id = ? ORDER BY position');
    const receipts = db.query<{ data: string }, [string]>('SELECT data FROM action_receipts WHERE workspace_id = ? ORDER BY position');
    const entries = db.query<{ data: string }, [string]>('SELECT data FROM sdk_entries WHERE workspace_id = ? ORDER BY position');
    this.visitors = db.query<{ id: string; csrf: string }, []>('SELECT id, csrf FROM browser_visitors ORDER BY rowid').all().map(visitor => ({
      ...visitor,
      issues: issues.all(visitor.id).map(row => JSON.parse(row.data)),
      workspaces: workspaces.all(visitor.id).map(row => {
        const { conversationEngine, ...workspace } = JSON.parse(row.data);
        return { ...workspace, conversation: {
          engine: conversationEngine,
          turns: turns.all(row.id).map(row => JSON.parse(row.data)),
          receipts: receipts.all(row.id).map(row => JSON.parse(row.data)),
          entries: entries.all(row.id).map(row => JSON.parse(row.data)),
        } };
      }),
    }));
    if (this.stopInterruptedTurns()) this.save();
  }
  private stopInterruptedTurns(): boolean {
    let changed = false;
    for (const visitor of this.visitors) for (const workspace of visitor.workspaces) {
      initializeWorkspace(workspace);
      for (const turn of workspace.conversation.turns) if (turn.status === 'running') {
        turn.status = 'stopped';
        turn.notice = 'Server restarted. This turn was not resumed. Applied actions remain in the receipts.';
        changed = true;
      }
    }
    return changed;
  }
  /** Import the old browser store once. Never modify or overwrite the source. */
  importLegacy(file: string): void {
    if (this.db.query('SELECT 1 FROM browser_imports WHERE source = ?').get('state.json')) return;
    if (!existsSync(file)) return;
    if (this.visitors.length) throw new Error('Cannot import legacy browser state into a populated database.');
    const fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    let data: { version: number; visitors: Visitor[] };
    try {
      const stat = fstatSync(fd);
      if (!stat.isFile() || stat.nlink !== 1 || stat.size > 128 * 1024 * 1024) throw new Error('Legacy browser store must be a bounded regular file.');
      data = JSON.parse(readFileSync(fd, 'utf8'));
    } finally { closeSync(fd); }
    if (![1, 2].includes(data.version) || !Array.isArray(data.visitors) || data.visitors.length > 100) throw new Error('Unsupported legacy Taskdesk store. The source has not been changed.');
    for (const visitor of data.visitors) {
      if (!visitor || typeof visitor.id !== 'string' || typeof visitor.csrf !== 'string' || !Array.isArray(visitor.issues) || !Array.isArray(visitor.workspaces)) throw new Error('Invalid legacy browser sandbox.');
    }
    const before = this.visitors;
    try {
      this.visitors = data.visitors;
      this.stopInterruptedTurns();
      this.db.transaction(() => {
        this.save();
        this.db.query('INSERT INTO browser_imports(source) VALUES (?)').run('state.json');
      })();
    } catch (error) {
      this.visitors = before;
      throw error;
    }
  }
  get(id: string | undefined) { return this.visitors.find(v => v.id === id); }
  create(): Visitor {
    if (this.visitors.length >= 100) throw new Error('Local sandbox limit reached. Back up the database before resetting it.');
    const visitor = { id: randomBytes(32).toString('hex'), csrf: randomBytes(32).toString('hex'), issues: seedIssues(), workspaces: [] };
    this.visitors.push(visitor);
    try { this.save(); } catch (error) { this.visitors.pop(); throw error; }
    return visitor;
  }
  workspace(visitor: Visitor, task: string, composition: Composition): Workspace {
    const workspace = initializeWorkspace({ ...composition, id: randomUUID(), task, created: new Date().toISOString() } as Workspace);
    visitor.workspaces.push(workspace);
    try { this.save(); } catch (error) { visitor.workspaces.pop(); throw error; }
    return workspace;
  }
  save() {
    const db = this.db;
    db.transaction(() => {
      const visitorWrite = db.query('INSERT INTO browser_visitors(id, csrf) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET csrf = excluded.csrf WHERE csrf <> excluded.csrf');
      const issueWrite = db.query('INSERT INTO sandbox_issues(visitor_id, id, position, data) VALUES (?, ?, ?, ?) ON CONFLICT(visitor_id, id) DO UPDATE SET position = excluded.position, data = excluded.data WHERE data <> excluded.data OR position <> excluded.position');
      const workspaceWrite = db.query('INSERT INTO workspaces(id, visitor_id, position, data) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET position = excluded.position, data = excluded.data WHERE data <> excluded.data OR position <> excluded.position');
      const turnWrite = db.query('INSERT INTO chat_turns(id, workspace_id, position, data) VALUES (?, ?, ?, ?) ON CONFLICT(workspace_id, id) DO UPDATE SET position = excluded.position, data = excluded.data WHERE data <> excluded.data OR position <> excluded.position');
      const receiptWrite = db.query('INSERT INTO action_receipts(id, workspace_id, position, data) VALUES (?, ?, ?, ?) ON CONFLICT(workspace_id, id) DO UPDATE SET position = excluded.position, data = excluded.data WHERE data <> excluded.data OR position <> excluded.position');
      const entryWrite = db.query('INSERT INTO sdk_entries(workspace_id, position, data) VALUES (?, ?, ?) ON CONFLICT(workspace_id, position) DO UPDATE SET data = excluded.data WHERE data <> excluded.data');
      for (const visitor of this.visitors) {
        visitorWrite.run(visitor.id, visitor.csrf);
        visitor.issues.forEach((issue, index) => issueWrite.run(visitor.id, issue.id, index, JSON.stringify(issue)));
        db.query('DELETE FROM sandbox_issues WHERE visitor_id = ? AND id NOT IN (SELECT value FROM json_each(?))').run(visitor.id, JSON.stringify(visitor.issues.map(issue => issue.id)));
        visitor.workspaces.forEach((workspace, index) => {
          const { conversation, ...composition } = workspace;
          workspaceWrite.run(workspace.id, visitor.id, index, JSON.stringify({ ...composition, conversationEngine: conversation.engine }));
          conversation.turns.forEach((turn, index) => turnWrite.run(turn.id, workspace.id, index, JSON.stringify(turn)));
          conversation.receipts.forEach((receipt, index) => receiptWrite.run(receipt.id, workspace.id, index, JSON.stringify(receipt)));
          conversation.entries.forEach((entry, index) => entryWrite.run(workspace.id, index, JSON.stringify(entry)));
          db.query('DELETE FROM chat_turns WHERE workspace_id = ? AND id NOT IN (SELECT value FROM json_each(?))').run(workspace.id, JSON.stringify(conversation.turns.map(turn => turn.id)));
          db.query('DELETE FROM action_receipts WHERE workspace_id = ? AND id NOT IN (SELECT value FROM json_each(?))').run(workspace.id, JSON.stringify(conversation.receipts.map(receipt => receipt.id)));
          db.query('DELETE FROM sdk_entries WHERE workspace_id = ? AND position >= ?').run(workspace.id, conversation.entries.length);
        });
        db.query('DELETE FROM workspaces WHERE visitor_id = ? AND id NOT IN (SELECT value FROM json_each(?))').run(visitor.id, JSON.stringify(visitor.workspaces.map(workspace => workspace.id)));
      }
    })();
  }
}
