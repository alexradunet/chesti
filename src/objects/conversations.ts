import type { Database } from 'bun:sqlite';
import { randomUUID } from 'node:crypto';
import { AppError } from '../core.js';
import type { GeneratedView, SavedView, ViewConversation, ViewConversationTurn } from './model.js';
import type { ViewService } from './views.js';

interface ConversationRow { id: string; previous_id: string | null; context_title: string }
interface TurnRow { prompt: string; view_id: string; title: string; description: string | null; model: string }

/** Conversations own successful generation history, never workspace objects. */
export class ViewConversationService {
  constructor(private readonly db: Database, private readonly views: ViewService) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS object_view_conversations (
        id TEXT PRIMARY KEY, visitor_id TEXT NOT NULL, previous_id TEXT REFERENCES object_views(id), context_title TEXT NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS object_view_conversation_turns (
        conversation_id TEXT NOT NULL REFERENCES object_view_conversations(id), position INTEGER NOT NULL CHECK(position >= 0),
        prompt TEXT NOT NULL, view_id TEXT NOT NULL REFERENCES object_views(id), title TEXT NOT NULL, description TEXT, model TEXT NOT NULL,
        PRIMARY KEY(conversation_id, position)
      ) STRICT;
    `);
  }

  get(visitorId: string, id: string): ViewConversation {
    if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(id)) throw new AppError(422, 'Invalid view conversation ID.');
    const row = this.db.query<ConversationRow, [string, string]>('SELECT id, previous_id, context_title FROM object_view_conversations WHERE id = ? AND visitor_id = ?').get(id, visitorId);
    if (!row) throw new AppError(404, 'View conversation not found.');
    const turns = this.db.query<TurnRow, [string]>('SELECT prompt, view_id, title, description, model FROM object_view_conversation_turns WHERE conversation_id = ? ORDER BY position').all(id);
    return {
      id: row.id, ...(row.previous_id ? { previousId: row.previous_id } : {}), contextTitle: row.context_title,
      turns: turns.map((turn): ViewConversationTurn => ({ prompt: turn.prompt, viewId: turn.view_id, title: turn.title, ...(turn.description === null ? {} : { description: turn.description }), model: turn.model })),
    };
  }

  previous(conversation: ViewConversation): SavedView {
    const last = conversation.turns.at(-1);
    if (!last) throw new AppError(409, 'This conversation has no saved result. Start a new conversation.');
    try { return this.views.get(last.viewId); }
    catch (error) {
      if (error instanceof AppError && error.status === 404) throw new AppError(409, 'The latest view in this conversation was deleted. Start a new conversation or choose another view to refine.');
      throw error;
    }
  }

  save(visitorId: string, prompt: string, generated: GeneratedView, context: { conversation?: ViewConversation; previous?: SavedView }): { conversation: ViewConversation; view: SavedView } {
    return this.db.transaction(() => {
      const current = context.conversation ? this.get(visitorId, context.conversation.id) : undefined;
      if (current) {
        if (current.turns.length !== context.conversation!.turns.length || current.turns.at(-1)?.viewId !== context.previous?.id) throw new AppError(409, 'This conversation changed while generating. Reload its history before trying again.');
        this.previous(current);
      } else if (context.previous) this.views.get(context.previous.id);
      const view = this.views.create(generated, prompt);
      const id = current?.id ?? randomUUID();
      if (!current) this.db.query('INSERT INTO object_view_conversations(id, visitor_id, previous_id, context_title) VALUES (?, ?, ?, ?)')
        .run(id, visitorId, context.previous?.id ?? null, context.previous?.spec.title ?? 'New view');
      this.db.query('INSERT INTO object_view_conversation_turns(conversation_id, position, prompt, view_id, title, description, model) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(id, current?.turns.length ?? 0, prompt, view.id, view.spec.title, view.spec.description ?? null, view.model);
      return { conversation: this.get(visitorId, id), view };
    }).immediate();
  }
}
