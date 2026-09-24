import { AppError } from './core.js';
import { createTurnContext, decideReceipt, runDemoTurn, undoLayout, visibleResources, workspaceResolver } from './conversation.js';
import type { ChatEvent, ChatRunner } from './conversation.js';
import { runPiTurn } from './pi-chat.js';
import { conversationPanel, workspaceCanvas, resourceCanvas } from './render.js';
import { todayCanvas } from './vault/today.js';
import type { ChatTurn, Store, Visitor } from './store.js';

const eventHeaders = { 'Content-Type': 'text/event-stream; charset=utf-8', 'X-Accel-Buffering': 'no' };
const encoder = new TextEncoder();

export function createConversationRoutes(store: Store, runner?: ChatRunner) {
  const active = new Map<string, { controller: AbortController; turnId: string }>();
  return async (req: Request, url: URL, visitor: Visitor, fields?: URLSearchParams): Promise<Response | undefined> => {
    const match = /^\/workspaces\/([a-f0-9-]{36})\/(messages|stop|state|undo|receipts\/([a-f0-9-]{36}))$/.exec(url.pathname);
    if (!match) return;
    const workspace = visitor.workspaces.find(w => w.id === match[1]);
    if (!workspace) throw new AppError(404, 'Workspace not found in this browser sandbox.');
    const target = match[2];
    if (req.method === 'GET') {
      if (target !== 'state') throw new AppError(405, 'Submit a form for this operation.');
      const focus = url.searchParams.get('focus') ?? '';
      const resolve = workspaceResolver(visitor, store);
      const canvas = focus ? resourceCanvas(resolve(focus), visitor, workspace) : workspace.kind === 'today' && store.vault ? todayCanvas(workspace, visitor, store.vault) : workspaceCanvas(workspace, visitor, resolve);
      return Response.json({ conversation: conversationPanel(workspace, visitor, focus), canvas, revision: workspace.revision, busy: active.has(workspace.id) });
    }
    if (!fields || target === 'state') throw new AppError(405, 'Use the appropriate link or form.');
    const allowed = target === 'messages' ? ['csrf', 'message', 'requestId', 'engine', 'selected', 'focus', 'revision']
      : target === 'stop' ? ['csrf', 'turnId'] : target === 'undo' ? ['csrf', 'revision'] : ['csrf', 'decision'];
    if ([...fields.keys()].some(k => !allowed.includes(k))) throw new AppError(422, 'Unexpected form field.');
    const redirect = () => new Response(null, { status: 303, headers: { Location: `/workspaces/${workspace.id}` } });
    if (target === 'stop') {
      const run = active.get(workspace.id);
      if (run && fields.get('turnId') === run.turnId) run.controller.abort(new Error('Stopped by user.'));
      return new Response(null, { status: 204 });
    }
    if (target?.startsWith('receipts/')) {
      const decision = fields.get('decision');
      if (decision !== 'confirm' && decision !== 'cancel') throw new AppError(422, 'Choose confirm or cancel.');
      decideReceipt(store, visitor, workspace, match[3]!, decision);
      return redirect();
    }
    if (target === 'undo') {
      if (active.has(workspace.id)) throw new AppError(409, 'Wait for Pi to finish before undoing the layout.');
      if (fields.get('revision') !== String(workspace.revision)) throw new AppError(409, 'The layout changed. Refresh first.');
      undoLayout(store, workspace);
      return redirect();
    }
    const message = fields.get('message')?.trim() ?? '';
    const id = fields.get('requestId') ?? '';
    const engine = fields.get('engine');
    const focus = fields.get('focus') ?? '';
    const selected = [...new Set(fields.getAll('selected'))].sort();
    if (!message || message.length > 2000 || !/^[a-f0-9-]{36}$/.test(id) || (engine !== 'pi' && engine !== 'demo')) throw new AppError(422, 'Invalid message, engine, or request ID.');
    const prior = workspace.conversation.turns.find(t => t.id === id);
    const streaming = req.headers.get('accept')?.includes('text/event-stream');
    if (prior) {
      if (prior.message !== message || prior.engine !== engine || prior.focus !== focus || JSON.stringify(prior.selected) !== JSON.stringify(selected)) throw new AppError(409, 'Request ID already used for a different message.');
      if (prior.status === 'running') throw new AppError(409, 'This turn is already running. Reload to reconnect.');
      return streaming
        ? new Response(`data: ${JSON.stringify({ type: 'done', replay: true, status: prior.status })}\n\n`, { headers: eventHeaders })
        : redirect();
    }
    if (active.has(workspace.id) || active.size >= 4) throw new AppError(429, 'Pi is busy. Wait for the current turn or stop it.');
    if (workspace.conversation.turns.length >= 100 || JSON.stringify(workspace.conversation.entries).length > 1_000_000) throw new AppError(429, 'This conversation reached its local context limit. Start a new workspace.');
    if (fields.get('revision') !== String(workspace.revision)) throw new AppError(409, 'The workspace layout changed. Refresh before sending.');
    const visible = visibleResources(workspace, visitor, focus, store).map(r => r.href);
    if (selected.some(ref => !visible.includes(ref))) throw new AppError(409, 'A selected issue is no longer in this view. Refresh and select it again.');
    const turn: ChatTurn = { id, engine, message, selected, visible, focus, response: '', status: 'running', created: new Date().toISOString() };
    const revision = workspace.revision;
    const oldEngine = workspace.conversation.engine;
    workspace.conversation.engine = engine;
    workspace.conversation.turns.push(turn);
    try { store.save(); } catch (error) { workspace.conversation.turns.pop(); workspace.conversation.engine = oldEngine; throw error; }
    const controller = new AbortController();
    const signal = AbortSignal.any([controller.signal, req.signal, AbortSignal.timeout(60_000)]);
    active.set(workspace.id, { controller, turnId: id });
    let output: ReadableStreamDefaultController<Uint8Array> | undefined;
    let closed = false;
    const stream = streaming ? new ReadableStream<Uint8Array>({
      start(streamController) { output = streamController; },
      cancel() {
        closed = true;
        controller.abort(new Error('Browser disconnected.'));
      },
    }) : undefined;
    const write = (chunk: string) => {
      if (!output || closed) return;
      try { output.enqueue(encoder.encode(chunk)); }
      catch {
        closed = true;
        controller.abort(new Error('Browser disconnected.'));
      }
    };
    const send = (event: ChatEvent | { type: 'start'; id: string } | { type: 'done'; status: string; layoutChanged: boolean }) => {
      if (streaming) write(`data: ${JSON.stringify(event)}\n\n`);
    };
    const keepAlive = streaming ? setInterval(() => write(': keepalive\n\n'), 15_000) : undefined;
    const execute = async () => {
      try {
        send({ type: 'start', id });
        signal.throwIfAborted();
        const context = createTurnContext(store, visitor, workspace, turn, signal, send);
        const run = runner ?? (engine === 'demo' ? runDemoTurn : runPiTurn);
        await run(context);
        signal.throwIfAborted();
        turn.status = 'done';
      } catch (error) {
        turn.status = signal.aborted ? 'stopped' : 'failed';
        turn.notice = signal.aborted ? 'Turn stopped or timed out. Applied actions are not rolled back; check the receipts.' : 'Pi could not complete this turn. Some actions may already have applied; check the receipts before sending another request.';
        console.warn('Conversation turn ended:', error instanceof Error ? error.message : 'Unknown error');
      } finally {
        clearInterval(keepAlive);
        active.delete(workspace.id);
        // Cancellation only ends delivery, never the persistence of a completed turn.
        store.save();
      }
    };
    if (stream) {
      // Do not await the runner: Bun needs the Response now to flush start/keepalive events.
      void execute().then(() => {
        send({ type: 'done', status: turn.status, layoutChanged: workspace.revision !== revision });
        if (!closed) { closed = true; output!.close(); }
      }).catch(error => {
        console.error('Conversation persistence failed:', error);
        if (!closed) { closed = true; output!.error(error); }
      });
      return new Response(stream, { headers: eventHeaders });
    }
    await execute();
    return redirect();
  };
}
