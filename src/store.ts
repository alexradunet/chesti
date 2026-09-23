import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { seedIssues, type Issue } from './issues.js';
import type { ViewPlan } from './core.js';

export interface Composition {
  plan: ViewPlan;
  engine: 'pi' | 'demo' | 'fallback';
  note: string;
  model?: string;
  inspected: string[];
  elapsedMs: number;
}
export interface Workspace extends Composition { id: string; task: string; created: string }
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
  constructor(private file?: string) {
    if (file && existsSync(file)) {
      const data = JSON.parse(readFileSync(file, 'utf8'));
      if (data.version !== 1 || !Array.isArray(data.visitors)) throw new Error('Unsupported Taskdesk store. Back up the file before resetting it.');
      this.visitors = data.visitors;
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
    const workspace = { ...composition, id: randomUUID(), task, created: new Date().toISOString() };
    visitor.workspaces.push(workspace);
    this.save();
    return workspace;
  }
  save() {
    if (!this.file) return;
    mkdirSync(dirname(this.file), { recursive: true, mode: 0o700 });
    const temporary = `${this.file}.tmp`;
    writeFileSync(temporary, JSON.stringify({ version: 1, visitors: this.visitors }, null, 2), { mode: 0o600 });
    renameSync(temporary, this.file);
  }
}
