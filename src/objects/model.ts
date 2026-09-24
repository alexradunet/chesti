import { Type } from 'typebox';
import type { Static, TSchema } from 'typebox';

const object = <T extends Record<string, TSchema>>(properties: T) => Type.Object(properties, { additionalProperties: false });
export const IdSchema = Type.String({ pattern: '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' });
export const PAGE_TYPE_ID = '00000000-0000-4000-8000-000000000001';
export const PropertyKindSchema = Type.Union([
  Type.Literal('text'), Type.Literal('number'), Type.Literal('boolean'), Type.Literal('date'), Type.Literal('datetime'),
  Type.Literal('select'), Type.Literal('reference'), Type.Literal('date-range'), Type.Literal('time-range'),
]);
export type PropertyKind = Static<typeof PropertyKindSchema>;
export interface PropertyDefinition {
  id: string;
  label: string;
  kind: PropertyKind;
  revision: number;
  options?: { id: string; label: string }[];
  targetTypeId?: string;
  multiple?: boolean;
}
export interface ObjectType {
  id: string;
  name: string;
  propertyIds: string[];
  revision: number;
}
export type PropertyValue = string | number | boolean | string[] | { start: string; end: string; timeZone?: string };
export interface DocumentNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: DocumentNode[];
  marks?: { type: string; attrs?: Record<string, unknown> }[];
  text?: string;
}
export interface ObjectRecord {
  id: string;
  typeId: string;
  title: string;
  properties: Record<string, PropertyValue>;
  document: DocumentNode;
  revision: number;
  createdAt: string;
  updatedAt: string;
  trashed: boolean;
}
export interface Catalog { types: ObjectType[]; properties: PropertyDefinition[] }
export interface ObjectWrite {
  typeId: string;
  title: string;
  properties: Record<string, PropertyValue>;
  document: DocumentNode;
}
export interface ObjectListOptions { typeId?: string; search?: string; trashed?: boolean; limit?: number; offset?: number }

const role = Type.String({ pattern: '^[a-z][a-zA-Z0-9]{0,31}$' });
const FilterSchema = object({
  propertyId: IdSchema,
  operator: Type.Union([Type.Literal('equals'), Type.Literal('notEquals'), Type.Literal('contains'), Type.Literal('before'), Type.Literal('after'), Type.Literal('empty'), Type.Literal('notEmpty')]),
  value: Type.Optional(Type.Union([Type.String({ maxLength: 500 }), Type.Number(), Type.Boolean(), object({ input: Type.Literal(true) })])),
});
export const ViewSpecSchema = object({
  title: Type.String({ minLength: 1, maxLength: 100 }),
  description: Type.Optional(Type.String({ maxLength: 500 })),
  input: Type.Optional(object({ label: Type.String({ minLength: 1, maxLength: 80 }), typeId: IdSchema })),
  blocks: Type.Array(object({
    title: Type.String({ minLength: 1, maxLength: 100 }),
    component: Type.Union([Type.Literal('list'), Type.Literal('table'), Type.Literal('calendar'), Type.Literal('board')]),
    columns: Type.Optional(Type.Array(object({ role, label: Type.String({ minLength: 1, maxLength: 80 }) }), { minItems: 1, maxItems: 8 })),
    sources: Type.Array(object({
      typeId: IdSchema,
      bindings: Type.Record(role, IdSchema, { maxProperties: 10 }),
      where: Type.Optional(Type.Array(FilterSchema, { maxItems: 8 })),
      orderBy: Type.Optional(object({ propertyId: IdSchema, direction: Type.Union([Type.Literal('ascending'), Type.Literal('descending')]) })),
    }), { minItems: 1, maxItems: 8 }),
    editable: Type.Optional(Type.Boolean()),
  }), { minItems: 1, maxItems: 6 }),
});
export type ViewSpec = Static<typeof ViewSpecSchema>;
export type ViewBlock = ViewSpec['blocks'][number];
export type ViewSource = ViewBlock['sources'][number];
export interface SavedView {
  id: string;
  revision: number;
  status: 'draft' | 'published';
  spec: ViewSpec;
  prompt: string;
  model: string;
  createdAt: string;
  updatedAt: string;
}
export interface ViewRow { object: ObjectRecord; bindings: Record<string, string> }
export interface EvaluatedBlock { definition: ViewBlock; rows: ViewRow[]; truncated: boolean; error?: string }
export interface EvaluatedView { view: SavedView; blocks: EvaluatedBlock[]; input?: ObjectRecord }
export interface GeneratedView { spec: ViewSpec; model: string }
export type ViewGenerator = (prompt: string, catalog: Catalog, options?: { signal?: AbortSignal; previous?: ViewSpec; history?: string[] }) => Promise<GeneratedView>;
export interface ViewConversationTurn {
  prompt: string;
  viewId: string;
  title: string;
  description?: string;
  model: string;
}
export interface ViewConversation {
  id: string;
  previousId?: string;
  contextTitle: string;
  turns: ViewConversationTurn[];
}

export interface Backlink { object: ObjectRecord; propertyId?: string; blockId?: string }
export interface ObjectPageModel {
  csrf: string;
  path: string;
  screen: 'objects' | 'types' | 'type' | 'new-object' | 'object' | 'views' | 'view';
  section?: 'calendar' | 'tasks';
  catalog: Catalog;
  views: SavedView[];
  objects: ObjectRecord[];
  object?: ObjectRecord;
  objectType?: ObjectType;
  evaluatedView?: EvaluatedView;
  backlinks?: Backlink[];
  search?: string;
  selectedTypeId?: string;
  notice?: string;
  error?: string;
  prompt?: string;
  aiOpen?: boolean;
  aiPreviousId?: string;
  aiConversationId?: string;
  aiContextTitle?: string;
  offset?: number;
  hasMore?: boolean;
  trashed?: boolean;
}
