import type { Database, Statement } from 'bun:sqlite';
import { Value } from 'typebox/value';
import { markdownReferences, markdownText, validateMarkdown } from './markdown.js';
import {
  EVENT_DATES_PROPERTY_ID, EVENT_TIME_PROPERTY_ID, EVENT_TYPE_ID,
  JOURNAL_DATE_PROPERTY_ID, JOURNAL_TYPE_ID,
  PAGE_TYPE_ID,
  PERSON_RECONNECT_EVERY_PROPERTY_ID, PERSON_TYPE_ID,
  REMINDER_DATE_PROPERTY_ID, REMINDER_TIME_PROPERTY_ID, REMINDER_TYPE_ID,
  TASK_DONE_PROPERTY_ID, TASK_TYPE_ID,
  ViewSpecSchema,
  type Catalog,
  type PropertyDefinition,
  type PropertyKind,
  type ViewSpec,
} from './model.js';
import { validDate, validDateTime, valueError } from './values.js';
import { validateViewSpec } from './views.js';

export type FixedDomainPreflightStatus = 'compatible' | 'blocked' | 'upgrade-required' | 'malformed';

export interface FixedDomainBlockerSample { id: string; reason: string }
export interface FixedDomainBlocker { category: string; count: number; samples: FixedDomainBlockerSample[]; truncated: boolean }
export interface FixedDomainPreflightReport {
  status: FixedDomainPreflightStatus;
  schemaVersion?: number;
  counts: Record<string, number>;
  blockers: FixedDomainBlocker[];
}

interface SchemaRow { name: string; type: string; tbl_name: string; sql: string | null }
interface MetadataRow { value: string }
interface TypeRow { id: string; name: string; property_ids_json: string; revision: number }
interface PropertyRow { id: string; label: string; kind: string; options_json: string | null; target_type_id: string | null; multiple: number; revision: number }
interface ObjectRow { id: string; type_id: string; title: string; properties_json: string; body: string; revision: number; created_at: string; updated_at: string; trashed: number; body_text: string }
interface RevisionRow { object_id: string; revision: number; snapshot_json: string; recorded_at: string }
interface ViewRow { id: string; revision: number; status: string; deleted: number; created_at: string; updated_at: string; spec_json: string; schema_json: string }
interface ReceiptRow { request_id: string; fingerprint: string; object_id: string }

const SAMPLE_LIMIT = 5;
const BATCH_SIZE = 500;
const ID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const SHA256 = /^[a-f0-9]{64}$/;

const frozenTypes = [
  { id: PAGE_TYPE_ID, name: 'Page', propertyIds: [] },
  { id: TASK_TYPE_ID, name: 'Task', propertyIds: [TASK_DONE_PROPERTY_ID, '00000000-0000-4000-8000-000000000102', '00000000-0000-4000-8000-000000000103'] },
  { id: EVENT_TYPE_ID, name: 'Event', propertyIds: [EVENT_DATES_PROPERTY_ID, EVENT_TIME_PROPERTY_ID] },
  { id: REMINDER_TYPE_ID, name: 'Reminder', propertyIds: [REMINDER_DATE_PROPERTY_ID, REMINDER_TIME_PROPERTY_ID] },
  { id: JOURNAL_TYPE_ID, name: 'Journal', propertyIds: [JOURNAL_DATE_PROPERTY_ID] },
  { id: PERSON_TYPE_ID, name: 'Person', propertyIds: [
    '00000000-0000-4000-8000-000000000501', '00000000-0000-4000-8000-000000000502', '00000000-0000-4000-8000-000000000503',
    '00000000-0000-4000-8000-000000000504', '00000000-0000-4000-8000-000000000505', PERSON_RECONNECT_EVERY_PROPERTY_ID, '00000000-0000-4000-8000-000000000507',
  ] },
] as const;
const frozenProperties: readonly Omit<PropertyDefinition, 'revision'>[] = [
  { id: TASK_DONE_PROPERTY_ID, label: 'Done', kind: 'boolean' },
  { id: '00000000-0000-4000-8000-000000000102', label: 'Due date', kind: 'date' },
  { id: EVENT_DATES_PROPERTY_ID, label: 'All-day dates', kind: 'date-range' },
  { id: EVENT_TIME_PROPERTY_ID, label: 'Event time', kind: 'time-range' },
  { id: REMINDER_DATE_PROPERTY_ID, label: 'Reminder date', kind: 'date' },
  { id: REMINDER_TIME_PROPERTY_ID, label: 'Reminder time', kind: 'datetime' },
  { id: JOURNAL_DATE_PROPERTY_ID, label: 'Journal date', kind: 'date' },
  { id: '00000000-0000-4000-8000-000000000103', label: 'Scheduled date', kind: 'date' },
  { id: '00000000-0000-4000-8000-000000000501', label: 'Relationship', kind: 'text' },
  { id: '00000000-0000-4000-8000-000000000502', label: 'Birthday', kind: 'date' },
  { id: '00000000-0000-4000-8000-000000000503', label: 'Phone number', kind: 'text' },
  { id: '00000000-0000-4000-8000-000000000504', label: 'Job title', kind: 'text' },
  { id: '00000000-0000-4000-8000-000000000505', label: 'Favorite artists', kind: 'text' },
  { id: PERSON_RECONNECT_EVERY_PROPERTY_ID, label: 'Reconnect every (months)', kind: 'number' },
  { id: '00000000-0000-4000-8000-000000000507', label: 'Last connected', kind: 'date' },
];
const fixedCatalog: Catalog = {
  types: frozenTypes.map(type => ({ id: type.id, name: type.name, propertyIds: [...type.propertyIds], revision: 1 })),
  properties: frozenProperties.map(property => ({ ...property, revision: 1 })),
};
const builtinTypes: Map<string, typeof frozenTypes[number]> = new Map(frozenTypes.map(type => [type.id, type]));
const builtinProperties = new Map(frozenProperties.map(property => [property.id, property]));
const allowedByType: Map<string, Set<string>> = new Map(frozenTypes.map(type => [type.id, new Set<string>(type.propertyIds)]));
const fixedPropertyKinds = new Map(frozenProperties.map(property => [property.id, property.kind]));
const knownApplicationTables = new Set([
  'object_metadata', 'object_types', 'object_properties', 'objects', 'object_references', 'object_revisions', 'object_create_requests', 'object_favorites',
  'object_views', 'object_view_revisions', 'object_view_conversations', 'object_view_conversation_turns', 'browser_visitors',
]);
// SHA-256 of JSON.stringify([type, tbl_name, sql]) from pristine v6 at e5b6ed1.
// This freezes *complete* DDL (including constraints, collations, predicates and trigger bodies).
// No SQL normalization/parser or production initializer runs during analysis. Older upgraded v6
// DDL spellings may differ; they conservatively block for structural review, never auto-approve.
// The independent frozen fixture and a pristine current-v6 initializer are compared in tests.
const v6SchemaDigests = new Map<string, string>([
  ['browser_visitors', '513d85d238afe5fccb5fe015659c9749b71ff2b1606517e9d058dece998da452'],
  ['object_builtin_property_0_delete', '176ecfbeef4a42c69453ca0f43fc407b4209a30b75ded6b311d9eddd809d6579'],
  ['object_builtin_property_0_insert', '0564f6b421e5f5c71f559aa88a2f61177a1a975cb2675841d707a281944b65db'],
  ['object_builtin_property_0_update', '174492f0178fd1530a45b655a1ad4e3adb66caf09d6157637eb3edc3a8824e06'],
  ['object_builtin_property_10_delete', '034b17a107a6ff6fc22fc245706bc533a16fced82ced4969365217b9014b431f'],
  ['object_builtin_property_10_insert', '7c642aec59d6e2fd5160795a688c43855935743d8454874e48aa084e19480cd7'],
  ['object_builtin_property_10_update', '15db93d877bd5e0163e8e7a1dfd052872715fde081f7bf87f6e0a647e665640c'],
  ['object_builtin_property_11_delete', '29c7f788d6356751c40694b9520fbe1bb29e1bbe15e1c1a9e5bd64c1cb654ac6'],
  ['object_builtin_property_11_insert', 'fff9d7c8d57108fa8cfaa322da6b010613665e09323a226cd5a0ca0d5ed08a13'],
  ['object_builtin_property_11_update', 'eff64be9ed582b436ec58dd771c764886bd87b392d325f80fd156536b8b70f16'],
  ['object_builtin_property_12_delete', '1edc189b33744ff93f2780514346dfbc590bf49a1c237314775b56a27a2eb345'],
  ['object_builtin_property_12_insert', 'ac315813a3f8f061ea37a0c30e04ec60ec32e1ba9d767e9bdfafca4fd499ca26'],
  ['object_builtin_property_12_update', '16aba477944a9d12c19de75fe67503dbbc4b699d30b6a4159dafbb20dc3411f8'],
  ['object_builtin_property_13_delete', '972ee9e5ffbfc3178b7ecf98d18648faea799dff518890e6e091bf1313b58fa3'],
  ['object_builtin_property_13_insert', '31398ba52b7f251ea3af85c60a71e8e1e1e71190b65bcfdeb12877420a214d00'],
  ['object_builtin_property_13_update', 'bf7c8097277293fb6ccde100263b1c9da5a17867ac25f36f39dacbd6b0d733ca'],
  ['object_builtin_property_14_delete', '36f7728e34d1f1106e18dfa3eb8c879d0f4ec70f3da6c235d6c4c0461097c881'],
  ['object_builtin_property_14_insert', 'c1478a51378e6c2ee1f43960c01449c38913ea648085391fc20108f631f1ca1a'],
  ['object_builtin_property_14_update', 'ca0890e7876e4bc6291ed0627d90aaa7206cc8d5c1bac7732cda8d523869acb2'],
  ['object_builtin_property_1_delete', '28ce8db18910a46ae0c7c157dfa85602d91ef72ad2c4a35cc304bc594d3b7270'],
  ['object_builtin_property_1_insert', 'e8fc0e915a3b6cf5cb9747800943a48d8092fdb374e74b1e0e1509896ea25ef4'],
  ['object_builtin_property_1_update', '5b76777cfaaa6deec9325d6c98832d60e697b6409a20eaca836243f59d7cd252'],
  ['object_builtin_property_2_delete', '0f61cd76594491ec1f1a46e22ddfddc7fb4e2ee9011d88657466d4196e6ff8fa'],
  ['object_builtin_property_2_insert', 'f1c86b8d45768cfa5db3a39e23870e8adba2f0c5bf256ed86731759d84cd6f6c'],
  ['object_builtin_property_2_update', 'bf387598b5573bfb44d57bc063a3687d27e945384d5a7eb602d73756ed5ad3f2'],
  ['object_builtin_property_3_delete', '77bf6f7e362cb8e27999a0414ca0b906646ed7c930bf9ddf1cb9a73213c05754'],
  ['object_builtin_property_3_insert', '829d106cdde557a52d34e87912e45898777f09f35f5663ca37c3e316dc75a6e3'],
  ['object_builtin_property_3_update', '5f888a25bb1e2c815309b1b6e2007f1c5d705e9369487f6bc214bffea806e019'],
  ['object_builtin_property_4_delete', 'b37f2bb54f0a726bb0f7fb4859d2ef00e3125fcf508cd22759eb47729ecbf91c'],
  ['object_builtin_property_4_insert', '9cf5b0bf5f7e6ecb648701c23bac4a2a1518cc831644a4749ded2e0616e97509'],
  ['object_builtin_property_4_update', 'aaf119fa41d938fe182742c6ac8c8c551a454b84b3487ecd4aca6c378f5c16cd'],
  ['object_builtin_property_5_delete', 'f6001f74537fbf83764fdd04f5fe28ac513bab98ae21c57668e4a048db3ddcea'],
  ['object_builtin_property_5_insert', 'f3c2b8dd5822a7e8f314e5aab9326a31d4a8cda00cd00029adc9ceb453365871'],
  ['object_builtin_property_5_update', '9d52686d8f5fc0f0e7c04d33ed8fa3e59db6ea0dded287ac3d32faf16e1e774f'],
  ['object_builtin_property_6_delete', '18bd4186ac42265eff0ca8c057ca899cacb084e2d44d10b58293bf3f92956878'],
  ['object_builtin_property_6_insert', '16ca550dca0685dc0313531689ab208c023b33daa409d2ab8a8dbe7f7dae8f17'],
  ['object_builtin_property_6_update', 'd9ffc2a47d9648a5a1464f55f715d9730e44e8e0460e7d2a879feb2e9ee566f6'],
  ['object_builtin_property_7_delete', 'fb06a93bd710b9ec81bb5c19f621ceece6c719d409f5189b227fb435fc220972'],
  ['object_builtin_property_7_insert', 'cf63c76043e4e21e449d67eefe3dda170a2582f81945490a93829fd26ab77923'],
  ['object_builtin_property_7_update', 'bd643f0da9d3a1c04c24de6eabfb736bbe728233fe7c96d34f39d9d86895a71e'],
  ['object_builtin_property_8_delete', 'd3e215be6fdfe37760d645b33cf4b6fa52ba868047e7ab866ac99c33d7c9d503'],
  ['object_builtin_property_8_insert', 'ef614f5489ede1a3de985556f34ca25dd7cadf61c02b42a0fd55e66a8130879b'],
  ['object_builtin_property_8_update', 'e1f1a5fd031175ad5dc880c6dcbce97831926e4d3ec5c27d4b7a4d68dd0ae2d8'],
  ['object_builtin_property_9_delete', '6479742c1eff21e4c160c848846680528d47822f902ed74a2da74153e8612448'],
  ['object_builtin_property_9_insert', '126cd8da542694359454cd0a9b16642f540e2330eedb4c96e72baee3d08f2280'],
  ['object_builtin_property_9_update', 'd69454ac44f86e367a8adbe121a45a2c185308dfe5e3b08585db2bb610bbb52c'],
  ['object_builtin_type_0_delete', '1ba46b4c091300384388e1044d50e7e3bb6bb98ab3a2b07ae3a39dc603d9562d'],
  ['object_builtin_type_0_insert', '5d9e3ada6f44f4593fafd8ebc882a5357143ad0dcc5b701de8e7095ab16fc2a1'],
  ['object_builtin_type_0_update', '57f7d7aabccd8eb1fb4d21c4fd26a0a0369f74c8df2605de62e2a67f1fb07929'],
  ['object_builtin_type_1_delete', '5d23558772cc052615e801a9bc1c2c5481dc9165fdace3f5bc71d3a97297ebc6'],
  ['object_builtin_type_1_insert', '00cca6562a99c948e8bca8c7ed9c6ee1448a34409dad1d3a65265ee5260c1011'],
  ['object_builtin_type_1_update', 'ac844a35fcab507fd27e0b3975a24b59d98341fbbbac97e6514e5b8e1041a7bd'],
  ['object_builtin_type_2_delete', '5aa80d5ff86856e3a02dfcfca2d54aa99cf40527a8f86a01797cd06ff00da472'],
  ['object_builtin_type_2_insert', '9e78a4f54e6c0d6ad1e84865240b7599506e8e561a88101feb4bf5773e6c20e6'],
  ['object_builtin_type_2_update', '584c6778d14ec163eb367e47169d6051e228b30ef8e4eb6c72a4b5b083e3898e'],
  ['object_builtin_type_3_delete', 'dd62ac8e93b4c18ce4e459a3b3bfc56e89244048d502999c8e1a1e58c220612c'],
  ['object_builtin_type_3_insert', 'ced788bdb8571d3d5b6c68c85ae877b2727486e9e708958c303d52851b510052'],
  ['object_builtin_type_3_update', 'efbe88de5ca4dad0c656e4d297da4df1fe241da463ff79dc924baf29835feb03'],
  ['object_builtin_type_4_delete', 'b077b11379ab78956062df1d340e14d75ad4564efea444f35b5f6109f6fd8971'],
  ['object_builtin_type_4_insert', 'cdfaaaf4ee118acadafa74309367cac244d69a5e394f7cb6db60c2b9f21078e2'],
  ['object_builtin_type_4_update', '357cf81eb59fa859a96b0e1496a465c3fe4ad191c7933237bba21c56038e7c8b'],
  ['object_builtin_type_5_delete', 'baab3251a2d27465678e39b6d43c3346457ab1dd51cbd1f796d1de8bbf9708fe'],
  ['object_builtin_type_5_insert', 'da4f4e20e1a24584433d976408d8a030e3b8c847b8f604ec738002a130587e20'],
  ['object_builtin_type_5_update', 'e678d34709a6e97dad54e77d5b429a64149558b09bc2ddea97e56c04ec47a3e3'],
  ['object_create_requests', '4904ca1ab8b54c777fab554a1b28fced4fba12d48efd53bd4297326a970d3b7a'],
  ['object_favorites', '4fe395d868deb5e2dcb30b3a16860da3f366aeadd1ee2ac23bb6c823c6d87dca'],
  ['object_metadata', 'eae33d671c1043c4851459e1982f4f7310deed11a943cf8146160f1d43d587e6'],
  ['object_properties', 'd6f612032b8ea3e0e54d70d8ba1efd9137b0db96161e0978091d82af5e46870b'],
  ['object_references', 'e6e2cc6c8bb6dd0f2247e02b9b5b872133862bc1e3a0489591b26a7ae0634a1a'],
  ['object_references_target', 'ccd2776e14b4e8f18607795ef64f390e6778ac89d5302d2d0c6c953429386f99'],
  ['object_revisions', 'cade8d128b30ec6c3ac8b706098cd11810ee78fdef2f74205b4d8e64053f0628'],
  ['object_types', '07d86a1a62b227d0ebf8347dddbdc2992e8b9aa3218b756678a472c00cbe4bff'],
  ['object_view_conversation_turns', '17bfb0b31e49a2074a175a7192ee3dcdefe74bd874c513b4b99fdb3270d0e7af'],
  ['object_view_conversations', '597b985c0933aa26132fd87bc13c0217ac4cecdcc0cd67812cd04335cbfe6515'],
  ['object_view_history_no_delete', '3a30a7fdc0a3dc95b698374fbb0d7014ef8ad8213c8ae86458f214884a346c5d'],
  ['object_view_history_no_update', '7e1fa97ee1f5a44bfc672e15d2bf07490dd1b52db21a06a13499295d21d0fcf2'],
  ['object_view_revisions', '6e71ff7e49aaf111599cb6b36f8e08522ab184bc5ef75077de12553f2c0fc7a4'],
  ['object_views', '1c1c9426c227a448e53e72da0e3d2708d15ef30adc42f7a0c61ded058622a54f'],
  ['objects', '3c351d18612c4cc0255bf401c11daf6c702f8a9f7c46915d37c14d12664b54bb'],
  ['objects_browse', '7c40669d71d06eab7ad16c8431e527fa11266fef3c7f24db0ef5540488f40638'],
  ['objects_journal_date', 'b9e9c86edac9e518806bd959efd2b4ee33e3b07c5580f172b405204f8ed6be25'],
  ['objects_journal_date_insert', 'e6651400e64b58401fc82003fc4398b8b15e021a0bacb8efb0cb679713aba5b0'],
  ['objects_journal_date_update', '23818986c95bfd87bda95b41a4664c7125f726859fb077eb0fc50ab4fd0d873c'],
  ['objects_type_browse', '5df4059e5f949fa6b3072c1cdbccb9b8b6f47ee1b7dd660b6101b848b6fff13d'],
]);

class Builder {
  readonly counts: Record<string, number> = {};
  private readonly blockers = new Map<string, FixedDomainBlocker>();
  private malformed = false;

  add(category: string, id: string, reason: string): void {
    this.addCount(category, 1, id, reason);
  }

  invalid(category: string, id: string, reason: string): void {
    this.malformed = true;
    this.add(category, id, reason);
  }

  addCount(category: string, count: number, id: string, reason: string): void {
    if (count === 0) return;
    const blocker = this.blockers.get(category) ?? { category, count: 0, samples: [], truncated: false };
    blocker.count += count;
    if (blocker.samples.length < SAMPLE_LIMIT) blocker.samples.push({ id: safeId(id), reason });
    blocker.truncated = blocker.count > blocker.samples.length;
    this.blockers.set(category, blocker);
  }

  report(status?: FixedDomainPreflightStatus, schemaVersion?: number): FixedDomainPreflightReport {
    return {
      status: this.malformed ? 'malformed' : status ?? (this.blockers.size ? 'blocked' : 'compatible'),
      schemaVersion, counts: this.counts, blockers: [...this.blockers.values()],
    };
  }
}

// Data identities are UUIDs only. Schema names may be printed only from the frozen allowlist.
// Reasons are developer-authored text, never SQL exceptions, stored names/keys, or record values.
function safeId(id: string): string {
  if (ID.test(id) || v6SchemaDigests.has(id) || id === 'object_metadata.schema_version') return id;
  const history = /^(.+)@([1-9][0-9]*)$/.exec(id);
  if (history && ID.test(history[1]!) && Number.isSafeInteger(Number(history[2]))) return id;
  return '[redacted]';
}
function safeJson(text: string): unknown { return JSON.parse(text) as unknown; }
function isRecord(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function count(db: Database, table: string): number { return db.query<{ count: number }, []>(`SELECT COUNT(*) AS count FROM ${table}`).get()!.count; }
function validScalar(kind: PropertyKind, value: unknown): boolean { return valueError(kind as Exclude<PropertyKind, 'select' | 'reference'>, value) === undefined; }
function validRevision(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function validTitle(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= 500;
}
function scanRows<Row>(statement: Statement<Row, [number, number]>, handle: (row: Row) => void): void {
  for (let offset = 0;; offset += BATCH_SIZE) {
    const rows = statement.all(BATCH_SIZE, offset);
    for (const row of rows) handle(row);
    if (rows.length < BATCH_SIZE) break;
  }
}

function schemaSignature(spec: ViewSpec): string {
  const used = new Set<string>();
  for (const block of spec.blocks) for (const source of block.sources) {
    for (const id of Object.values(source.bindings)) used.add(id);
    for (const filter of source.where ?? []) used.add(filter.propertyId);
    if (source.orderBy) used.add(source.orderBy.propertyId);
  }
  const properties = new Map(fixedCatalog.properties.map(property => [property.id, property]));
  return JSON.stringify([...used].sort().map(id => {
    const property = properties.get(id)!;
    return [id, property.kind, Boolean(property.multiple), property.targetTypeId ?? null];
  }));
}

function validateProperties(builder: Builder, category: string, id: string, typeId: string, properties: unknown): void {
  if (!ID.test(typeId)) {
    builder.invalid(category, id, 'Type identity is not a UUID.');
    return;
  }
  if (!builtinTypes.has(typeId)) {
    builder.add(category, id, 'Unknown type requires disposition.');
    return;
  }
  if (!isRecord(properties)) {
    builder.invalid(category, id, 'Properties are not a JSON object.');
    return;
  }
  const allowed = allowedByType.get(typeId)!;
  for (const key of Object.keys(properties)) {
    if (!ID.test(key)) {
      builder.invalid(category, id, 'Property identity is not a UUID.');
      continue;
    }
    if (!fixedPropertyKinds.has(key)) {
      builder.add(category, id, 'Unknown property requires disposition.');
      continue;
    }
    if (!allowed.has(key)) {
      builder.add(category, id, `Property ${key} is not permitted for this built-in kind.`);
      continue;
    }
    const kind = fixedPropertyKinds.get(key)!;
    if (!validScalar(kind, properties[key])) builder.invalid(category, id, `Invalid ${kind} value for ${key}.`);
    if (key === PERSON_RECONNECT_EVERY_PROPERTY_ID && !(typeof properties[key] === 'number' && Number.isInteger(properties[key]) && properties[key] >= 1 && properties[key] <= 120)) {
      builder.invalid(category, id, 'Person reconnect interval must be an integer from 1 to 120.');
    }
  }
  // Absence remains absence here: do not normalize omitted Done, optional text, or timestamps.
  if (typeId === JOURNAL_TYPE_ID && !validDate(properties[JOURNAL_DATE_PROPERTY_ID])) {
    builder.invalid(category, id, 'Journal date is required and must be real.');
  }
  if (typeId === EVENT_TYPE_ID) {
    const hasDates = Object.hasOwn(properties, EVENT_DATES_PROPERTY_ID);
    const hasTime = Object.hasOwn(properties, EVENT_TIME_PROPERTY_ID);
    if (hasDates === hasTime) builder.invalid(category, id, 'Event requires exactly one all-day date range or timed range.');
  }
  if (typeId === REMINDER_TYPE_ID) {
    const hasDate = Object.hasOwn(properties, REMINDER_DATE_PROPERTY_ID);
    const hasTime = Object.hasOwn(properties, REMINDER_TIME_PROPERTY_ID);
    if (hasDate === hasTime) builder.invalid(category, id, 'Reminder requires exactly one date or timestamp.');
  }
}

function validateObjectRow(builder: Builder, row: ObjectRow): void {
  if (!ID.test(row.id)) builder.invalid('objects', row.id, 'Object id is not a UUID.');
  if (!validTitle(row.title)) builder.invalid('objects', row.id, 'Title is invalid.');
  if (!validRevision(row.revision)) builder.invalid('objects', row.id, 'Revision must be a positive safe integer.');
  if (!validDateTime(row.created_at) || !validDateTime(row.updated_at)) builder.invalid('objects', row.id, 'Timestamps must be real instants with explicit offsets.');
  if (row.trashed !== 0 && row.trashed !== 1) builder.invalid('objects', row.id, 'Trash flag must be 0 or 1.');
  try {
    validateMarkdown(row.body);
    if (row.body_text !== markdownText(row.body)) builder.invalid('objects', row.id, 'Stored search text does not match Markdown body.');
  } catch {
    builder.invalid('objects', row.id, 'Markdown body is invalid or too large.');
  }
  let properties: unknown;
  try {
    properties = safeJson(row.properties_json);
  } catch {
    builder.invalid('objects', row.id, 'Properties JSON is malformed.');
    return;
  }
  validateProperties(builder, 'objects', row.id, row.type_id, properties);
}

function validateSnapshot(builder: Builder, row: RevisionRow): void {
  const id = `${row.object_id}@${row.revision}`;
  if (!validDateTime(row.recorded_at)) builder.invalid('history', id, 'History recording timestamp is invalid.');
  let snapshot: unknown;
  try {
    snapshot = safeJson(row.snapshot_json);
  } catch {
    builder.invalid('history', id, 'Snapshot JSON is malformed.');
    return;
  }
  if (!isRecord(snapshot) || typeof snapshot.id !== 'string' || typeof snapshot.typeId !== 'string' ||
      typeof snapshot.body !== 'string' || typeof snapshot.trashed !== 'boolean' || !isRecord(snapshot.properties)) {
    builder.invalid('history', id, 'Snapshot is not a complete legacy object record.');
    return;
  }
  const keys = ['id', 'typeId', 'title', 'properties', 'body', 'revision', 'createdAt', 'updatedAt', 'trashed'];
  if (Object.keys(snapshot).some(key => !keys.includes(key))) builder.add('history', id, 'Unknown snapshot members require disposition.');
  if (!ID.test(row.object_id) || !ID.test(snapshot.id)) builder.invalid('history', id, 'Snapshot identity is not a UUID.');
  if (snapshot.id.toLowerCase() !== row.object_id.toLowerCase()) builder.invalid('history', id, 'Snapshot id does not match row object.');
  if (!validRevision(snapshot.revision) || snapshot.revision !== row.revision) builder.invalid('history', id, 'Snapshot revision must be a positive safe integer matching its row.');
  if (!validTitle(snapshot.title)) builder.invalid('history', id, 'Snapshot title is invalid.');
  if (!validDateTime(snapshot.createdAt) || !validDateTime(snapshot.updatedAt)) builder.invalid('history', id, 'Snapshot timestamps must be real instants with explicit offsets.');
  try {
    validateMarkdown(snapshot.body);
  } catch {
    builder.invalid('history', id, 'Historical Markdown body is invalid or too large.');
  }
  validateProperties(builder, 'history', id, snapshot.typeId, snapshot.properties);
}

function validateView(builder: Builder, category: string, row: ViewRow): void {
  const id = `${row.id}@${row.revision}`;
  if (!ID.test(row.id) || !validRevision(row.revision)) builder.invalid(category, id, 'View identity or revision is invalid.');
  if (!validDateTime(row.created_at) || !validDateTime(row.updated_at)) builder.invalid(category, id, 'View timestamps are invalid.');
  if (!['draft', 'published'].includes(row.status) || ![0, 1].includes(row.deleted)) builder.invalid(category, id, 'View lifecycle state is invalid.');
  let spec: unknown;
  let schema: unknown;
  try {
    spec = safeJson(row.spec_json);
    schema = safeJson(row.schema_json);
  } catch {
    builder.invalid(category, id, 'View JSON is malformed.');
    return;
  }
  if (!Value.Check(ViewSpecSchema, spec)) {
    builder.invalid(category, id, 'View spec does not match the supported wire shape.');
    return;
  }
  const checked = spec as ViewSpec;
  if (checked.input !== undefined) builder.add(category, id, 'Input-scoped views require disposition.');
  for (const block of checked.blocks) {
    for (const source of block.sources) {
      for (const filter of source.where ?? []) {
        if (isRecord(filter.value) && filter.value.input === true) builder.add(category, id, 'Input-bound filters require disposition.');
      }
    }
  }
  // The fixed catalog contains no references/selects/custom fields. The canonical validator
  // checks role capability, source uniqueness, membership, operands, and ordering as well.
  try {
    validateViewSpec(checked, fixedCatalog);
  } catch {
    builder.add(category, id, 'View spec is not semantically compatible with fixed fields.');
    return;
  }
  if (!Array.isArray(schema) || row.schema_json !== schemaSignature(checked)) {
    builder.add(category, id, 'Schema signature does not match fixed field shapes.');
  }
}

function validateDefinitions(db: Database, builder: Builder): void {
  scanRows(db.query<TypeRow, [number, number]>('SELECT id, name, property_ids_json, revision FROM object_types ORDER BY id LIMIT ? OFFSET ?'), row => {
    if (!ID.test(row.id) || !validRevision(row.revision)) builder.invalid('definitions', row.id, 'Type identity or revision is invalid.');
    const expected = builtinTypes.get(row.id);
    if (!expected) { builder.add('definitions', row.id, 'custom object type is not fixed-domain compatible'); return; }
    if (row.name !== expected.name) builder.add('definitions', row.id, 'built-in type display label was changed');
    let propertyIds: unknown;
    try { propertyIds = safeJson(row.property_ids_json); } catch { propertyIds = undefined; }
    if (!Array.isArray(propertyIds) || propertyIds.length !== expected.propertyIds.length || expected.propertyIds.some((id, index) => propertyIds[index] !== id)) builder.add('definitions', row.id, 'built-in type field attachment/order changed');
  });
  for (const expected of frozenTypes) if (!db.query<{ id: string }, [string]>('SELECT id FROM object_types WHERE id = ?').get(expected.id)) builder.add('definitions', expected.id, 'built-in type is missing');
  scanRows(db.query<PropertyRow, [number, number]>('SELECT id, label, kind, options_json, target_type_id, multiple, revision FROM object_properties ORDER BY id LIMIT ? OFFSET ?'), row => {
    if (!ID.test(row.id) || !validRevision(row.revision)) builder.invalid('definitions', row.id, 'Property identity or revision is invalid.');
    const expected = builtinProperties.get(row.id);
    if (!expected) { builder.add('definitions', row.id, 'custom property definition is not fixed-domain compatible'); return; }
    if (row.label !== expected.label) builder.add('definitions', row.id, 'built-in property display label was changed');
    if (row.kind !== expected.kind || row.options_json !== null || row.target_type_id !== null || row.multiple !== 0) builder.add('definitions', row.id, 'built-in property structure changed');
  });
  for (const expected of frozenProperties) if (!db.query<{ id: string }, [string]>('SELECT id FROM object_properties WHERE id = ?').get(expected.id)) builder.add('definitions', expected.id, 'built-in property is missing');
}

function validateApplicationShape(db: Database, builder: Builder): boolean {
  const seen = new Set<string>(); // Only the fixed application names, not all workspace schema.
  let readable = true;
  const schema = db.query<SchemaRow, []>('SELECT name, type, tbl_name, sql FROM sqlite_schema ORDER BY name');
  for (const row of schema.iterate()) {
    const expected = v6SchemaDigests.get(row.name);
    if (expected) {
      seen.add(row.name);
      const digest = new Bun.CryptoHasher('sha256').update(JSON.stringify([row.type, row.tbl_name, row.sql])).digest('hex');
      if (digest !== expected) {
        builder.add('application-shape', row.name, 'Complete DDL differs from the frozen pristine v6 baseline; structural review required.');
        // Do not query rows under an unrecognized application table definition.
        readable = false;
      }
    } else if (row.type === 'index' && row.sql !== null && knownApplicationTables.has(row.tbl_name)) {
      builder.add('application-shape', row.name, 'Custom index on an application table requires disposition.');
    } else if (row.type === 'view' || row.type === 'trigger') {
      // Avoid a partial SQL dependency parser: indirect/quoted references are easy to miss.
      builder.add('application-shape', row.name, 'Unrecognized view or trigger requires dependency review.');
    }
    if (row.type === 'table' && !knownApplicationTables.has(row.name)) {
      for (const fk of db.query<{ table: string }, [string]>('SELECT "table" FROM pragma_foreign_key_list(?)').iterate(row.name)) {
        if (knownApplicationTables.has(fk.table)) {
          builder.add('application-shape', row.name, 'Unrelated table references an application table.');
        }
      }
    }
  }
  for (const name of v6SchemaDigests.keys()) {
    if (!seen.has(name)) {
      builder.invalid('application-shape', name, 'Required application schema object is missing.');
      readable = false;
    }
  }
  return readable;
}

function validateJsonKeys(db: Database, builder: Builder): void {
  // JSON.parse would silently keep only the last duplicate key, whereas SQLite may use the first.
  // These identifiers are a fixed developer-owned list, never read from the inspected database.
  const documents = [
    ['objects', 'properties_json', 'id'],
    ['object_revisions', 'snapshot_json', 'object_id'],
    ['object_views', 'spec_json', 'id'],
    ['object_view_revisions', 'spec_json', 'id'],
  ] as const;
  for (const [table, column, id] of documents) {
    const duplicates = db.query<{ id: string }, []>(`
      SELECT ${id} AS id FROM ${table}
      WHERE EXISTS (SELECT 1 FROM json_tree(${column}) GROUP BY parent, key HAVING count(*) > 1)
    `);
    for (const row of duplicates.iterate()) builder.invalid('json', row.id, 'Duplicate JSON keys have ambiguous meaning.');
  }
}

function validateReceipts(db: Database, builder: Builder): void {
  scanRows(db.query<ReceiptRow, [number, number]>('SELECT request_id, fingerprint, object_id FROM object_create_requests ORDER BY request_id LIMIT ? OFFSET ?'), row => {
    if (!ID.test(row.request_id)) builder.invalid('receipts', row.request_id, 'Request id is not a UUID.');
    if (!SHA256.test(row.fingerprint)) builder.invalid('receipts', row.request_id, 'Fingerprint is not a SHA-256 hex digest.');
    if (!ID.test(row.object_id)) builder.invalid('receipts', row.request_id, 'Target object id is not a UUID.');
  });
  // Target existence is checked by foreign_key_check. Never infer a digest from today's object.
}

function validateWritingEdges(db: Database, builder: Builder): void {
  const objects = db.query<{ id: string; body: string }, []>('SELECT id, body FROM objects ORDER BY id');
  const edges = db.query<{ target_id: string }, [string]>("SELECT target_id FROM object_references WHERE property_id = '' AND source_id = ? COLLATE NOCASE");
  for (const row of objects.iterate()) {
    try {
      validateMarkdown(row.body);
    } catch {
      // Already reported by the complete-record scan; do not parse unbounded malformed bodies.
      continue;
    }
    // At most one bounded Markdown document's targets are retained. Stored edges stream, even
    // if a damaged database contains millions of spurious edges for this one source.
    const remaining = new Set(markdownReferences(row.body));
    for (const edge of edges.iterate(row.id)) {
      if (!remaining.delete(edge.target_id.toLowerCase())) {
        builder.invalid('writing-links', row.id, 'Stored writing edge is not present in Markdown.');
      }
    }
    builder.addCount('writing-links', remaining.size, row.id, 'Markdown target has no stored writing edge.');
  }
  // foreign_key_check also catches orphan sources and invalid targets, including structured edges.
}

function integrityCheck(db: Database, builder: Builder): void {
  // SQLite caps integrity_check output at its argument; report findings, not a claimed inventory
  // of all physical corruption. FK checks below enumerate every violation without materializing it.
  let checked = false;
  for (const row of db.query<{ integrity_check: string }, []>('PRAGMA integrity_check(100)').iterate()) {
    checked = true;
    if (row.integrity_check !== 'ok') builder.invalid('sqlite-integrity', 'integrity_check', 'SQLite integrity check failed (at most 100 diagnostics).');
  }
  if (!checked) builder.invalid('sqlite-integrity', 'integrity_check', 'SQLite integrity check returned no result.');
  for (const row of db.query<{ table: string }, []>('PRAGMA foreign_key_check').iterate()) {
    builder.invalid('sqlite-integrity', row.table, 'Foreign key check failed.');
  }
}

/** Read-only SQL only. Reuse the caller's transaction or acquire one consistent deferred snapshot.
 * Connection pragmas belong to the caller (the CLI opens SQLite with readonly:true).
 */
export function analyzeFixedDomainPreflight(db: Database): FixedDomainPreflightReport {
  const builder = new Builder();
  const run = (): FixedDomainPreflightReport => {
    integrityCheck(db, builder);
    const versionText = db.query<MetadataRow, []>("SELECT value FROM object_metadata WHERE key = 'schema_version'").get()?.value;
    if (versionText === undefined || !/^[1-9][0-9]*$/.test(versionText) || !Number.isSafeInteger(Number(versionText))) {
      builder.invalid('schema-version', 'object_metadata.schema_version', 'Missing or invalid schema version.');
      return builder.report();
    }
    const version = Number(versionText);
    if (version <= 5) {
      builder.add('schema-version', 'object_metadata.schema_version', 'Run the old application preserving upgrade to v6 on a disposable backup before detailed preflight.');
      return builder.report('upgrade-required', version);
    }
    if (version !== 6) {
      builder.add('schema-version', 'object_metadata.schema_version', 'Unsupported object database schema version.');
      return builder.report('blocked', version);
    }
    if (!validateApplicationShape(db, builder)) return builder.report(undefined, version);
    for (const table of knownApplicationTables) builder.counts[table] = count(db, table);
    validateDefinitions(db, builder);
    scanRows(db.query<ObjectRow, [number, number]>('SELECT id, type_id, title, properties_json, body, revision, created_at, updated_at, trashed, body_text FROM objects ORDER BY id LIMIT ? OFFSET ?'), row => validateObjectRow(builder, row));
    scanRows(db.query<RevisionRow, [number, number]>('SELECT object_id, revision, snapshot_json, recorded_at FROM object_revisions ORDER BY object_id, revision LIMIT ? OFFSET ?'), row => validateSnapshot(builder, row));
    const structuredReferences = db.query<{ count: number }, []>("SELECT COUNT(*) AS count FROM object_references WHERE property_id != ''").get()!.count;
    builder.addCount('structured-references', structuredReferences, 'object_references', 'Property/reference edges are not Markdown links.');
    validateWritingEdges(db, builder);
    validateReceipts(db, builder);
    validateJsonKeys(db, builder);
    scanRows(db.query<ViewRow, [number, number]>('SELECT id, revision, status, deleted, created_at, updated_at, spec_json, schema_json FROM object_views ORDER BY id LIMIT ? OFFSET ?'), row => validateView(builder, 'views', row));
    scanRows(db.query<ViewRow, [number, number]>('SELECT id, revision, status, deleted, created_at, updated_at, spec_json, schema_json FROM object_view_revisions ORDER BY id, revision LIMIT ? OFFSET ?'), row => validateView(builder, 'view-history', row));
    return builder.report(undefined, version);
  };
  try {
    return db.inTransaction ? run() : db.transaction(run).deferred();
  } catch {
    // SQLite errors may contain private schema names/values. Never export their text.
    builder.invalid('database', 'database', 'Unable to analyze a valid supported database.');
    return builder.report();
  }
}
