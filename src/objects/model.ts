import { Type } from 'typebox';
import type { Static, TSchema } from 'typebox';

const object = <T extends Record<string, TSchema>>(properties: T) => Type.Object(properties, { additionalProperties: false });
export const IdSchema = Type.String({ pattern: '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' });
export const PAGE_TYPE_ID = '00000000-0000-4000-8000-000000000001';
export const TASK_TYPE_ID = '00000000-0000-4000-8000-000000000002';
export const EVENT_TYPE_ID = '00000000-0000-4000-8000-000000000003';
export const REMINDER_TYPE_ID = '00000000-0000-4000-8000-000000000004';
export const JOURNAL_TYPE_ID = '00000000-0000-4000-8000-000000000005';
export const PERSON_TYPE_ID = '00000000-0000-4000-8000-000000000006';
export const TASK_DONE_PROPERTY_ID = '00000000-0000-4000-8000-000000000101';
export const TASK_DUE_PROPERTY_ID = '00000000-0000-4000-8000-000000000102';
export const TASK_SCHEDULED_PROPERTY_ID = '00000000-0000-4000-8000-000000000103';
export const EVENT_DATES_PROPERTY_ID = '00000000-0000-4000-8000-000000000201';
export const EVENT_TIME_PROPERTY_ID = '00000000-0000-4000-8000-000000000202';
export const REMINDER_DATE_PROPERTY_ID = '00000000-0000-4000-8000-000000000301';
export const REMINDER_TIME_PROPERTY_ID = '00000000-0000-4000-8000-000000000302';
export const JOURNAL_DATE_PROPERTY_ID = '00000000-0000-4000-8000-000000000401';
export const PERSON_RELATIONSHIP_PROPERTY_ID = '00000000-0000-4000-8000-000000000501';
export const PERSON_BIRTHDAY_PROPERTY_ID = '00000000-0000-4000-8000-000000000502';
export const PERSON_PHONE_PROPERTY_ID = '00000000-0000-4000-8000-000000000503';
export const PERSON_JOB_TITLE_PROPERTY_ID = '00000000-0000-4000-8000-000000000504';
export const PERSON_FAVORITE_ARTISTS_PROPERTY_ID = '00000000-0000-4000-8000-000000000505';
export const PERSON_RECONNECT_EVERY_PROPERTY_ID = '00000000-0000-4000-8000-000000000506';
export const PERSON_LAST_CONNECTED_PROPERTY_ID = '00000000-0000-4000-8000-000000000507';
export const PropertyKindSchema = Type.Union([
  Type.Literal('text'), Type.Literal('number'), Type.Literal('boolean'), Type.Literal('date'), Type.Literal('datetime'),
  Type.Literal('date-range'), Type.Literal('time-range'),
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
export const BUILTIN_PROPERTIES: readonly Omit<PropertyDefinition, 'revision'>[] = [
  { id: TASK_DONE_PROPERTY_ID, label: 'Done', kind: 'boolean' },
  { id: TASK_DUE_PROPERTY_ID, label: 'Due date', kind: 'date' },
  { id: EVENT_DATES_PROPERTY_ID, label: 'All-day dates', kind: 'date-range' },
  { id: EVENT_TIME_PROPERTY_ID, label: 'Event time', kind: 'time-range' },
  { id: REMINDER_DATE_PROPERTY_ID, label: 'Reminder date', kind: 'date' },
  { id: REMINDER_TIME_PROPERTY_ID, label: 'Reminder time', kind: 'datetime' },
  { id: JOURNAL_DATE_PROPERTY_ID, label: 'Journal date', kind: 'date' },
  { id: TASK_SCHEDULED_PROPERTY_ID, label: 'Scheduled date', kind: 'date' },
  { id: PERSON_RELATIONSHIP_PROPERTY_ID, label: 'Relationship', kind: 'text' },
  { id: PERSON_BIRTHDAY_PROPERTY_ID, label: 'Birthday', kind: 'date' },
  { id: PERSON_PHONE_PROPERTY_ID, label: 'Phone number', kind: 'text' },
  { id: PERSON_JOB_TITLE_PROPERTY_ID, label: 'Job title', kind: 'text' },
  { id: PERSON_FAVORITE_ARTISTS_PROPERTY_ID, label: 'Favorite artists', kind: 'text' },
  { id: PERSON_RECONNECT_EVERY_PROPERTY_ID, label: 'Reconnect every (months)', kind: 'number' },
  { id: PERSON_LAST_CONNECTED_PROPERTY_ID, label: 'Last connected', kind: 'date' },
];
export const BUILTIN_TYPES: readonly { id: string; name: string; description: string; propertyIds: readonly string[] }[] = [
  { id: PAGE_TYPE_ID, name: 'Page', description: 'Freeform writing without extra fields.', propertyIds: [] },
  { id: TASK_TYPE_ID, name: 'Task', description: 'Work with a completion state, optional scheduled date, and optional due date.', propertyIds: [TASK_DONE_PROPERTY_ID, TASK_DUE_PROPERTY_ID, TASK_SCHEDULED_PROPERTY_ID] },
  { id: EVENT_TYPE_ID, name: 'Event', description: 'Exactly one all-day date range or timed range, with an exclusive end.', propertyIds: [EVENT_DATES_PROPERTY_ID, EVENT_TIME_PROPERTY_ID] },
  { id: REMINDER_TYPE_ID, name: 'Reminder', description: 'A calendar item with exactly one date or time. No notifications or recurrence.', propertyIds: [REMINDER_DATE_PROPERTY_ID, REMINDER_TIME_PROPERTY_ID] },
  { id: JOURNAL_TYPE_ID, name: 'Journal', description: 'One canonical entry per calendar date, including entries in Trash.', propertyIds: [JOURNAL_DATE_PROPERTY_ID] },
  { id: PERSON_TYPE_ID, name: 'Person', description: 'A person you know, with relationship details and reconnect dates.', propertyIds: [PERSON_RELATIONSHIP_PROPERTY_ID, PERSON_BIRTHDAY_PROPERTY_ID, PERSON_PHONE_PROPERTY_ID, PERSON_JOB_TITLE_PROPERTY_ID, PERSON_FAVORITE_ARTISTS_PROPERTY_ID, PERSON_RECONNECT_EVERY_PROPERTY_ID, PERSON_LAST_CONNECTED_PROPERTY_ID] },
];

export interface ObjectType {
  id: string;
  name: string;
  propertyIds: string[];
  revision: number;
}
export const FIXED_TYPES: readonly ObjectType[] = BUILTIN_TYPES.map(type => ({ id: type.id, name: type.name, propertyIds: [...type.propertyIds], revision: 1 }));
export const FIXED_PROPERTIES: readonly PropertyDefinition[] = BUILTIN_PROPERTIES.map(property => ({ ...property, revision: 1 }));
export const FIXED_TYPE_IDS = new Set(FIXED_TYPES.map(type => type.id));
export const FIXED_PROPERTY_IDS = new Set(FIXED_PROPERTIES.map(property => property.id));
export type PropertyValue = string | number | boolean | string[] | { start: string; end: string; timeZone?: string };
export interface ObjectSummary {
  id: string;
  typeId: string;
  title: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
  trashed: boolean;
}
export interface DayTaskSummary extends ObjectSummary {
  done: boolean;
  dueDate?: string;
  scheduledDate?: string;
  matchesDue: boolean;
  matchesScheduled: boolean;
}
export interface BoundedPage<T> { items: T[]; offset: number; hasMore: boolean }
export interface ViewObjectRecord extends ObjectSummary {
  properties: Record<string, PropertyValue>;
}
export interface ObjectRecord extends ViewObjectRecord {
  body: string;
}
export interface Catalog { types: ObjectType[]; properties: PropertyDefinition[] }
export interface ObjectWrite {
  typeId: string;
  title: string;
  properties: Record<string, PropertyValue>;
  body: string;
}
export interface ObjectListOptions { typeId?: string; search?: string; trashed?: boolean; limit?: number; offset?: number }
export interface ObjectRevisionSummary { revision: number; recordedAt: string; title: string; typeId: string; trashed: boolean }

export const ObjectLookupSchema = object({
  items: Type.Array(object({
    id: IdSchema,
    title: Type.String({ minLength: 1, maxLength: 500 }),
    typeName: Type.String({ minLength: 1, maxLength: 200 }),
  }), { maxItems: 50 }),
  truncated: Type.Boolean(),
});
export type ObjectLookupResult = Static<typeof ObjectLookupSchema>;

const role = Type.String({ pattern: '^[a-z][a-zA-Z0-9]{0,31}$' });
const FilterSchema = object({
  propertyId: IdSchema,
  operator: Type.Union([Type.Literal('equals'), Type.Literal('notEquals'), Type.Literal('contains'), Type.Literal('before'), Type.Literal('after'), Type.Literal('empty'), Type.Literal('notEmpty')]),
  value: Type.Optional(Type.Union([Type.String({ maxLength: 500 }), Type.Number(), Type.Boolean(), object({ input: Type.Literal(true) })])),
});
export const ViewSpecSchema = object({
  title: Type.String({ minLength: 1, maxLength: 100 }),
  description: Type.Optional(Type.String({ maxLength: 500 })),
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
export type ViewSpec = Static<typeof ViewSpecSchema> & { input?: { label: string; typeId: string } };
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
export interface ViewRow { object: ViewObjectRecord; bindings: Record<string, string> }
export interface EvaluatedBlock { definition: ViewBlock; rows: ViewRow[]; truncated: boolean; error?: string }
export interface EvaluatedView { view: SavedView; blocks: EvaluatedBlock[]; input?: ObjectSummary }
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

export interface Backlink { object: ObjectSummary; propertyId?: string }
export interface BacklinkPage { links: Backlink[]; offset: number; hasMore: boolean }
export interface ObjectPageModel {
  csrf: string;
  path: string;
  screen: 'home' | 'objects' | 'people' | 'types' | 'new-object' | 'object' | 'object-history' | 'views' | 'view' | 'journal' | 'calendar';
  section?: 'calendar' | 'tasks' | 'favorites';
  catalog: Catalog;
  views: SavedView[];
  objects: ObjectSummary[];
  typeCounts?: Record<string, number>;
  browseLayout?: 'list' | 'gallery';
  objectExcerpts?: Record<string, string>;
  people?: ViewObjectRecord[];
  object?: ObjectRecord;
  objectDraft?: { title: string; body: string; revision?: string; requestId?: string; typeId?: string; properties?: Record<string, PropertyValue>; fields?: Record<string, string[]>; historyRevision?: string };
  history?: { revisions: ObjectRevisionSummary[]; selected?: ObjectRecord; offset: number; hasMore: boolean };
  objectType?: ObjectType;
  journalDate?: string;
  journalDateDefault?: boolean;
  journal?: ObjectRecord;
  dayTasks?: BoundedPage<DayTaskSummary>;
  dayCreated?: BoundedPage<ObjectSummary>;
  favorites?: BoundedPage<ObjectSummary>;
  favorite?: boolean;
  timeZone?: string;
  dayJournalConflict?: boolean;
  dayJournalDraft?: { mode: 'create' | 'update'; date: string; body: string; requestId?: string; objectId?: string; revision?: string; saveBlocked?: boolean; conflictRevision?: string };
  calendarMonth?: string;
  evaluatedView?: EvaluatedView;  backlinksPage?: BacklinkPage;
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
  typeChangeDrops?: { fromTypeId: string; toTypeId: string; fields: { id: string; label: string; value: string }[] };
}
