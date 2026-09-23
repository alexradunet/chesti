import { Type, type Static } from 'typebox';
import { Value } from 'typebox/value';

// The app owns these representations. Neither model output nor browser input
// can supply action URLs, field definitions, or authoritative resource facts.
export interface Link { rel: string; href: string; title: string }
export interface Field {
  name: string;
  label: string;
  value: string;
  options: { value: string; label: string }[];
  input?: 'text' | 'date' | 'datetime-local' | 'number' | 'textarea' | 'checkbox' | 'json';
  required?: boolean;
  valueType?: string;
}
export interface Action {
  id: string;
  title: string;
  href: string;
  method: 'post';
  fields: Field[];
  requiresConfirmation?: boolean;
}
export interface Resource {
  href: string;
  kind: 'collection' | 'record';
  title: string;
  description: string;
  facts: Record<string, string>;
  links: Link[];
  actions: Action[];
  items?: Resource[];
  version?: number | string;
  body?: string;
}
export type Resolve = (href: string) => Resource;

export const ViewSchema = Type.Object({
  title: Type.String({ minLength: 1, maxLength: 80 }),
  layout: Type.Union([Type.Literal('split'), Type.Literal('stack')]),
  blocks: Type.Array(Type.Object({
    resource: Type.String({ minLength: 1, maxLength: 160 }),
    view: Type.Union([Type.Literal('table'), Type.Literal('list'), Type.Literal('detail'), Type.Literal('actions')]),
  }, { additionalProperties: false }), { minItems: 1, maxItems: 5 }),
}, { additionalProperties: false });
export type ViewPlan = Static<typeof ViewSchema>;

export class AppError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export function validatePlan(input: unknown, resolve: Resolve, inspected: Set<string>): ViewPlan {
  if (!Value.Check(ViewSchema, input)) throw new AppError(422, 'Invalid view structure.');
  const seen = new Set<string>();
  for (const block of input.blocks) {
    if (!inspected.has(block.resource)) throw new AppError(422, 'Inspect a resource before presenting it.');
    const resource = resolve(block.resource);
    const collectionView = block.view === 'table' || block.view === 'list';
    if (collectionView !== (resource.kind === 'collection')) {
      throw new AppError(422, 'That presentation does not match the resource.');
    }
    const key = `${block.resource}:${block.view}`;
    if (seen.has(key)) throw new AppError(422, 'Duplicate view block.');
    seen.add(key);
  }
  return structuredClone(input);
}

// A small hypermedia traversal boundary: only the entry point is known upfront.
// Embedded items are discoverable, but must be inspected before presentation.
export function createExplorer(resolve: Resolve, entry = '/issues') {
  const discovered = new Set([entry]);
  const inspected = new Set<string>();
  return {
    inspected,
    inspect(href: string): Resource {
      if (!discovered.has(href)) throw new AppError(403, 'Follow a discovered link; do not invent resource URLs.');
      const resource = resolve(href);
      inspected.add(href);
      for (const link of resource.links) discovered.add(link.href);
      for (const item of resource.items ?? []) discovered.add(item.href);
      return structuredClone(resource);
    },
    present(input: unknown) { return validatePlan(input, resolve, inspected); },
  };
}

export function escapeHtml(value: unknown): string {
  return String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
