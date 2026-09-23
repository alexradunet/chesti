import { randomUUID } from 'node:crypto';
import { AppError, createExplorer, type Resource, type ViewPlan } from './core.js';
import { applyAction, issueResolver } from './issues.js';
import { demoComposition } from './composer.js';
import type { ChatTurn, Composition, Receipt, Store, Visitor, Workspace } from './store.js';

export type ChatEvent = { type: 'text' | 'status'; text: string } | { type: 'receipt'; receipt: Receipt };
export type ChatRunner = (context: TurnContext) => Promise<void>;
export const actor = { id: 'alex', name: 'Alex' }; // Local sandbox identity; never taken from model input.

export function visibleResources(workspace: Workspace, visitor: Visitor, focus = ''): Resource[] {
  const resolve = issueResolver(visitor.issues);
  const resources = focus ? [resolve(focus)] : workspace.plan.blocks.map(b => resolve(b.resource));
  const records = resources.flatMap(r => r.kind === 'collection' ? r.items ?? [] : [r]);
  return [...new Map(records.map(r => [r.href, r])).values()];
}

function resultMessage(receipt: Receipt): string {
  const values = Object.entries(receipt.fields).map(([k, v]) => `${k}: ${v}`).join(', ');
  return `${receipt.action} applied${values ? ` (${values})` : ''}.`;
}

// Both browser forms and the agent pass through this exact mutation boundary.
// Persist the state and receipt together before reporting success. No awaited work
// occurs between version validation, mutation and the atomic store rename.
export function executeReceipt(store: Store, visitor: Visitor, receipt: Receipt): Receipt {
  const before = structuredClone(visitor.issues);
  const previous = structuredClone(receipt);
  try {
    const fields = new URLSearchParams({ ...receipt.fields, version: String(receipt.version) });
    const id = /^\/issues\/(ISS-\d+)$/.exec(receipt.resource)?.[1];
    if (!id) throw new AppError(404, 'Issue not found.');
    applyAction(visitor.issues, id, receipt.action, fields);
    receipt.status = 'applied';
    receipt.message = resultMessage(receipt);
  } catch (error) {
    if (!(error instanceof AppError)) throw error;
    receipt.status = 'failed';
    receipt.errorStatus = error.status;
    receipt.message = error.message;
  }
  try { store.save(); }
  catch (error) {
    visitor.issues.forEach((issue, index) => Object.assign(issue, before[index]));
    Object.assign(receipt, previous);
    throw error;
  }
  return receipt;
}

export function decideReceipt(store: Store, visitor: Visitor, workspace: Workspace, id: string, decision: 'confirm' | 'cancel'): Receipt {
  const receipt = workspace.conversation.receipts.find(r => r.id === id);
  if (!receipt) throw new AppError(404, 'Action receipt not found.');
  if (receipt.status !== 'pending') return receipt; // Repeated clicks cannot execute twice.
  if (decision === 'confirm') return executeReceipt(store, visitor, receipt);
  receipt.status = 'cancelled';
  receipt.message = 'Cancelled by you. No change made.';
  try { store.save(); } catch (error) { receipt.status = 'pending'; receipt.message = 'Confirmation required. No change made.'; throw error; }
  return receipt;
}

export function undoLayout(store: Store, workspace: Workspace): void {
  if (!workspace.previousPlan) throw new AppError(409, 'There is no previous layout to restore.');
  const before = { ...compositionOf(workspace), previousPlan: workspace.previousPlan, previousComposition: workspace.previousComposition, revision: workspace.revision };
  if (workspace.previousComposition) Object.assign(workspace, workspace.previousComposition);
  else workspace.plan = workspace.previousPlan;
  delete workspace.previousPlan;
  delete workspace.previousComposition;
  workspace.revision++;
  try { store.save(); } catch (error) { Object.assign(workspace, before); throw error; }
}

function compositionOf(workspace: Workspace): Composition {
  const { plan, engine, note, model, inspected, elapsedMs } = workspace;
  return { plan, engine, note, model, inspected, elapsedMs };
}

export function createTurnContext(store: Store, visitor: Visitor, workspace: Workspace, turn: ChatTurn, signal: AbortSignal, emit: (event: ChatEvent) => void) {
  const resolve = issueResolver(visitor.issues);
  const explorer = createExplorer(resolve);
  const snapshots = new Map<string, Resource>();
  const startRevision = workspace.revision;
  let calls = 0;
  let presented = false;
  let model: string | undefined;
  const started = Date.now();
  const guard = () => {
    signal.throwIfAborted();
    if (++calls > 24) throw new AppError(429, 'Tool budget exhausted. Finish this turn.');
  };
  return {
    workspace, turn, signal,
    setModel: (name: string) => { model = name; },
    context: {
      actor, task: workspace.task, plan: structuredClone(workspace.plan),
      focus: turn.focus || 'workspace', visible: turn.visible, selected: turn.selected,
      recentActions: structuredClone(workspace.conversation.receipts.slice(-20)),
      // Covers native edits and demo turns that are intentionally not SDK messages.
      conversation: workspace.conversation.turns.slice(-12).map(t => ({ message: t.message, response: t.response, status: t.status, notice: t.notice })),
    },
    inspect(resource: string) {
      guard();
      const snapshot = explorer.inspect(resource);
      snapshots.set(resource, snapshot);
      return snapshot;
    },
    act(resource: string, actionId: string, input: Record<string, string>) {
      guard();
      const snapshot = snapshots.get(resource);
      if (!snapshot || snapshot.kind !== 'record') throw new AppError(403, 'Explicitly inspect this issue in this turn before acting.');
      // Authorize using the inspected affordance, never an invented URL or method.
      const action = snapshot.actions.find(a => a.id === actionId);
      if (!action) throw new AppError(409, 'That action was not advertised by the inspected resource.');
      const fields = { ...input };
      if (actionId === 'assign' && fields.owner === 'me') fields.owner = actor.id;
      if (Object.keys(fields).some(k => !action.fields.some(f => f.name === k))) throw new AppError(422, 'Unexpected action field.');
      for (const field of action.fields) if (!field.options.some(o => o.value === fields[field.name])) throw new AppError(422, `Choose a valid ${field.label.toLowerCase()}.`);
      const receipts = workspace.conversation.receipts;
      const signature = JSON.stringify(Object.entries(fields).sort(([a], [b]) => a.localeCompare(b)));
      const prior = receipts.find(r => r.turnId === turn.id && r.resource === resource && r.action === actionId && JSON.stringify(Object.entries(r.fields).sort(([a], [b]) => a.localeCompare(b))) === signature);
      if (prior) return structuredClone(prior); // Same intention, even after re-inspection: replay receipt, not mutation.
      const current = resolve(resource);
      const receipt: Receipt = {
        id: randomUUID(), turnId: turn.id, source: turn.engine, resource, action: actionId,
        fields, version: snapshot.version!, status: 'pending', message: 'Confirmation required. No change made.', created: new Date().toISOString(),
      };
      receipts.push(receipt);
      try {
        if (current.version !== snapshot.version || !current.actions.some(a => a.id === actionId)) {
          receipt.status = 'failed';
          receipt.message = 'This issue changed after inspection. No change made; ask the user before retrying in a new turn.';
          store.save();
        } else if (current.actions.find(a => a.id === actionId)?.requiresConfirmation) store.save();
        else executeReceipt(store, visitor, receipt);
      } catch (error) { receipts.pop(); throw error; }
      emit({ type: 'receipt', receipt: structuredClone(receipt) });
      return structuredClone(receipt);
    },
    present(input: unknown) {
      guard();
      if (presented) throw new AppError(409, 'Only one layout change is allowed per turn.');
      if (workspace.revision !== startRevision) throw new AppError(409, 'The layout changed during this turn. Keep the current layout.');
      const plan = explorer.present(input);
      const before = { ...compositionOf(workspace), previousPlan: workspace.previousPlan, previousComposition: workspace.previousComposition, revision: workspace.revision };
      workspace.previousPlan = workspace.plan;
      workspace.previousComposition = compositionOf(workspace);
      Object.assign(workspace, { plan, engine: turn.engine, model, inspected: [...explorer.inspected], elapsedMs: Date.now() - started, note: turn.engine === 'pi' ? 'Layout updated by Pi during this conversation. Data and actions remain server-owned.' : 'Layout updated with deterministic demo rules. No model was called.' });
      workspace.revision++;
      try { store.save(); } catch (error) { Object.assign(workspace, before); throw error; }
      presented = true;
      return { accepted: true, revision: workspace.revision };
    },
    text(text: string) {
      signal.throwIfAborted();
      if (turn.response.length + text.length > 24_000) throw new AppError(429, 'Response size limit reached.');
      turn.response += text;
      emit({ type: 'text', text });
    },
    status(text: string) { emit({ type: 'status', text }); },
    save: () => store.save(),
  };
}
export type TurnContext = ReturnType<typeof createTurnContext>;

// An explicitly labeled, conservative offline demo. A Pi failure NEVER falls
// back to this executor: after a partial failure, retrying could repeat actions.
export const runDemoTurn: ChatRunner = async context => {
  const { turn } = context;
  const command = /^(assign|close) (both(?: issues)?|selected(?: issues)?|these(?: issues)?|ISS-\d+(?:(?:, | and )ISS-\d+)*)( to me)?[.!]?$/i.exec(turn.message.trim());
  if (command && (command[1]!.toLowerCase() !== 'assign' || command[3])) {
    let refs = [...new Set(turn.message.match(/ISS-\d+/gi)?.map(id => `/issues/${id.toUpperCase()}`) ?? turn.selected)];
    if (!refs.length && /both|these/i.test(command[2]!)) refs = turn.visible.length === 2 ? turn.visible : [];
    if (!refs.length) { context.text('Which issues? Select the issues in the workspace, or name their IDs. I have not changed anything.'); return; }
    context.inspect('/issues');
    const results = refs.map(ref => {
      context.inspect(ref);
      return context.act(ref, command[1]!.toLowerCase() === 'assign' ? 'assign' : 'close', command[1]!.toLowerCase() === 'assign' ? { owner: 'me' } : {});
    });
    context.text(results.map(r => `${r.resource.split('/').at(-1)}: ${r.message}`).join('\n'));
    return;
  }
  if (/^(show|switch to) (the )?(triage|my work|all issues)[.!]?$/i.test(turn.message.trim())) {
    const resolve = issueResolverFromContext(context);
    const composition = demoComposition(turn.message, resolve);
    context.inspect('/issues');
    for (const ref of composition.inspected) context.inspect(ref);
    context.present(composition.plan);
    context.text('Updated the workspace using deterministic demo rules.');
    return;
  }
  context.text('Demo mode supports “assign both issues to me”, “assign selected issues to me”, “close ISS-101”, and “show triage / my work / all issues”. Select Pi for an open-ended conversation. No changes made.');
};

function issueResolverFromContext(context: TurnContext) {
  // The offline composer uses the same discovery boundary as Pi.
  context.inspect('/issues');
  return (ref: string) => context.inspect(ref);
}
