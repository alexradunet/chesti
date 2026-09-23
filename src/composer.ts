import { createExplorer, type Resolve, type ViewPlan } from './core.js';
import type { Composition } from './store.js';

export type Composer = (task: string, resolve: Resolve) => Promise<Composition>;

export function demoComposition(task: string, resolve: Resolve, fallback = false): Composition {
  const explorer = createExplorer(resolve);
  const root = explorer.inspect('/issues');
  const mine = /\b(my|mine|next|i work|assigned to me)\b/i.test(task);
  const triage = /\b(triage|unassigned|prioriti[sz]e)\b/i.test(task);
  const rel = mine ? 'mine' : triage ? 'triage' : 'all';
  const href = root.links.find(l => l.rel === rel)!.href;
  const collection = explorer.inspect(href);
  const first = collection.items?.[0];
  const blocks: ViewPlan['blocks'] = [{ resource: href, view: mine ? 'list' : 'table' }];
  if (first) {
    explorer.inspect(first.href);
    blocks.push({ resource: first.href, view: 'detail' }, { resource: first.href, view: 'actions' });
  }
  return {
    plan: explorer.present({ title: collection.title, layout: mine ? 'stack' : 'split', blocks }),
    engine: fallback ? 'fallback' : 'demo',
    note: fallback
      ? 'Pi could not complete this composition. Showing the deterministic fallback; ordinary links and forms still work.'
      : 'Deterministic demo: keyword rules select a view. No model was called.',
    inspected: [...explorer.inspected], elapsedMs: 0,
  };
}

// Lazy import: demo mode does not initialize Pi or inspect any credentials.
export function createComposer(mode: 'demo' | 'pi'): Composer {
  return async (task, resolve) => {
    if (mode === 'demo') return demoComposition(task, resolve);
    const started = Date.now();
    try {
      const { composeWithPi } = await import('./pi.js');
      return await composeWithPi(task, resolve);
    } catch (error) {
      // Do not put provider errors, credentials, or model text into the page.
      console.warn('Pi composition failed:', error instanceof Error ? error.message : 'Unknown error');
      return { ...demoComposition(task, resolve, true), elapsedMs: Date.now() - started };
    }
  };
}
