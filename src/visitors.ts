import { randomBytes } from 'node:crypto';
import type { Database, Statement } from 'bun:sqlite';

export interface Visitor {
  id: string;
  csrf: string;
}

export class VisitorStore {
  private readonly lookup: Statement<Visitor, [string]>;
  private readonly insert: Statement<unknown, [string, string]>;

  constructor(readonly db: Database) {
    db.exec('CREATE TABLE IF NOT EXISTS browser_visitors (id TEXT PRIMARY KEY, csrf TEXT NOT NULL)');
    this.lookup = db.query<Visitor, [string]>('SELECT id, csrf FROM browser_visitors WHERE id = ?');
    this.insert = db.query<unknown, [string, string]>('INSERT INTO browser_visitors(id, csrf) VALUES (?, ?)');
  }

  get(id: string | undefined): Visitor | undefined {
    return id === undefined ? undefined : this.lookup.get(id) ?? undefined;
  }

  create(): Visitor {
    const visitor = { id: randomBytes(32).toString('hex'), csrf: randomBytes(32).toString('hex') };
    this.insert.run(visitor.id, visitor.csrf);
    return visitor;
  }
}
