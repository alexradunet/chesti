import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
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

// Deliberately a single-process local store, not a database abstraction.
// Each browser gets its own sandbox. Agent transcripts are not application state.
export class Store {
  private visitors: Visitor[] = [];
  vault?: VaultRuntime;
  reconcileVaultReceipts() {
    if (!this.vault) return;
    for (const visitor of this.visitors) for (const workspace of visitor.workspaces) {
      for (const receipt of workspace.conversation.receipts) {
        if (!receipt.vaultRequest || !receipt.executionStarted || receipt.status !== 'pending') continue;
        const result = this.vault.receipt(receipt.id);
        receipt.status = result?.status ?? 'failed';
        receipt.message = result?.message ?? 'Interrupted before the vault write. No automatic retry was made.';
        receipt.errorStatus = result?.errorStatus;
      }
    }
    this.save();
  }
  constructor(private file?: string) {
    if (file && existsSync(file)) {
      const data = JSON.parse(readFileSync(file, 'utf8'));
      if (![1, 2].includes(data.version) || !Array.isArray(data.visitors)) throw new Error('Unsupported Taskdesk store. Back up the file before resetting it.');
      this.visitors = data.visitors;
      for (const visitor of this.visitors) for (const workspace of visitor.workspaces) {
        initializeWorkspace(workspace);
        for (const turn of workspace.conversation.turns) if (turn.status === 'running') {
          turn.status = 'stopped';
          turn.notice = 'Server restarted. This turn was not resumed. Applied actions remain in the receipts.';
        }
      }
      this.save();
    }
  }
  get(id: string | undefined) { return this.visitors.find(v => v.id === id); }
  create(): Visitor {
    if (this.visitors.length >= 100) throw new Error('Local sandbox limit reached. Back up and reset .data/state.json.');
    const visitor = { id: randomBytes(32).toString('hex'), csrf: randomBytes(32).toString('hex'), issues: seedIssues(), workspaces: [] };
    this.visitors.push(visitor);
    this.save();
    return visitor;
  }
  workspace(visitor: Visitor, task: string, composition: Composition): Workspace {
    const workspace = initializeWorkspace({ ...composition, id: randomUUID(), task, created: new Date().toISOString() } as Workspace);
    visitor.workspaces.push(workspace);
    this.save();
    return workspace;
  }
  save() {
    if (!this.file) return;
    mkdirSync(dirname(this.file), { recursive: true, mode: 0o700 });
    const temporary = `${this.file}.tmp`;
    writeFileSync(temporary, JSON.stringify({ version: 2, visitors: this.visitors }, null, 2), { mode: 0o600 });
    renameSync(temporary, this.file);
  }
}
