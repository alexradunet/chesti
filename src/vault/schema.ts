import { Type, type Static } from 'typebox';

const object = <T extends Record<string, import('typebox').TSchema>>(properties: T) => Type.Object(properties, { additionalProperties: false });
const namePattern = '^[a-z][a-zA-Z0-9_]{0,47}$';
const name = Type.String({ pattern: namePattern });
const typeName = Type.String({ pattern: '^[a-z][a-z0-9-]{0,47}\\.[a-z][a-zA-Z0-9_]{0,47}$' });
const names = Type.Array(name, { minItems: 1, maxItems: 32, uniqueItems: true });
const common = { required: Type.Optional(Type.Boolean()), default: Type.Optional(Type.Unknown()) };
const simpleField = <T extends string>(type: T) => object({ type: Type.Literal(type), ...common });
export const FieldSchema = Type.Union([
  simpleField('text'), simpleField('number'), simpleField('boolean'), simpleField('date'),
  simpleField('datetime'), simpleField('date-range'), simpleField('time-range'),
  object({ type: Type.Literal('enum'), values: Type.Array(Type.String({ minLength: 1 }), { minItems: 1, maxItems: 100, uniqueItems: true }), ...common }),
  object({ type: Type.Literal('reference'), target: typeName, ...common }),
]);
export type FieldDefinition = Static<typeof FieldSchema>;

// A deliberately small predicate vocabulary; neither expressions nor scripts.
const PredicateSchema = Type.Union([
  object({ field: name, equals: Type.Unknown() }),
  object({ field: name, in: Type.Array(Type.Unknown(), { minItems: 1, maxItems: 100 }) }),
]);
const actionCommon = { label: Type.Optional(Type.String({ minLength: 1, maxLength: 80 })), requiresConfirmation: Type.Optional(Type.Boolean()) };
const ActionSchema = Type.Union([
  object({ operation: Type.Literal('record.create'), ...actionCommon }),
  object({ operation: Type.Literal('record.update'), fields: Type.Optional(names), set: Type.Optional(Type.Record(name, Type.Unknown(), { minProperties: 1 })), when: Type.Optional(PredicateSchema), ...actionCommon }),
]);
export const DocumentTypeSchema = object({
  version: Type.Integer({ minimum: 1 }),
  storage: object({ defaultFolder: Type.String({ minLength: 1, maxLength: 240 }) }),
  fields: Type.Record(name, FieldSchema, { maxProperties: 64 }),
  actions: Type.Record(name, ActionSchema, { maxProperties: 32 }),
  uniqueBy: Type.Optional(Type.Array(names, { minItems: 1, maxItems: 8 })),
  rules: Type.Optional(Type.Array(object({ kind: Type.Literal('exactlyOne'), fields: names }), { minItems: 1, maxItems: 16 })),
});
export type DocumentType = Static<typeof DocumentTypeSchema>;
export type Predicate = Static<typeof PredicateSchema>;
export type ActionDefinition = Static<typeof ActionSchema>;

const CollectionSchema = object({
  type: name,
  where: Type.Optional(PredicateSchema),
  orderBy: Type.Optional(Type.Array(object({
    field: name,
    direction: Type.Union([Type.Literal('ascending'), Type.Literal('descending')]),
    missing: Type.Optional(Type.Union([Type.Literal('first'), Type.Literal('last')])),
  }), { minItems: 1, maxItems: 8 })),
});
const ViewSchema = Type.Union([
  object({ collection: name, presentation: Type.Union([Type.Literal('list'), Type.Literal('table')]) }),
  object({ collection: name, presentation: Type.Literal('calendar'), mapping: object({ date: name, label: name }) }),
]);
export const AppDefinitionSchema = object({
  contract: Type.Literal('lifeapps/v1'),
  id: Type.String({ pattern: '^[a-z][a-z0-9-]{0,47}$' }),
  name: Type.String({ minLength: 1, maxLength: 80 }),
  description: Type.Optional(Type.String({ maxLength: 500 })),
  types: Type.Record(name, DocumentTypeSchema, { minProperties: 1, maxProperties: 16 }),
  collections: Type.Record(name, CollectionSchema, { minProperties: 1, maxProperties: 32 }),
  views: Type.Record(name, ViewSchema, { minProperties: 1, maxProperties: 32 }),
});
export type AppDefinition = Static<typeof AppDefinitionSchema>;
export const appJsonSchema = { $schema: 'https://json-schema.org/draft/2020-12/schema', ...AppDefinitionSchema };
