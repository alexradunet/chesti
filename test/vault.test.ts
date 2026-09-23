import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { stringify } from 'yaml';
import { Value } from 'typebox/value';
import { AppDefinitionSchema, type AppDefinition } from '../src/vault/schema.js';
import { parseMarkdown } from '../src/vault/markdown.js';
import { validateDefinition } from '../src/vault/definition.js';
import { readVault } from '../src/vault/reader.js';
import { valueError, validDate, validDateTime } from '../src/vault/values.js';

const sample = resolve('examples/life-vault');
const taskPath = 'Projects/Website/Tasks/Publish homepage.md';
const projectPath = 'Projects/Website/Overview.md';
const journalPath = 'Journal/2026/09/23.md';
const taskSource = readFileSync(join(sample, taskPath), 'utf8');
const appSource = readFileSync(join(sample, '.apps/Tasks.md'), 'utf8');
const app = () => structuredClone(validateDefinition(parseMarkdown('.apps/Tasks.md', appSource)).definition!);
const markdown = (data: unknown, body = '# Example\n') => `---\n${stringify(data)}---\n${body}`;
function fixture(t: TestContext) {
  const root = mkdtempSync(join(tmpdir(), 'lifeapps-test-'));
  cpSync(sample, root, { recursive: true });
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}
function put(root: string, path: string, source: string | Buffer) { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), source); }
function editRecord(root: string, path: string, edit: (data: Record<string, unknown>) => void) {
  const file = parseMarkdown(path, readFileSync(join(root, path), 'utf8')); edit(file.frontmatter); put(root, path, markdown(file.frontmatter, file.body));
}
function editApp(root: string, path: string, edit: (app: AppDefinition) => void) {
  const file = parseMarkdown(path, readFileSync(join(root, path), 'utf8')); edit(file.frontmatter as AppDefinition); put(root, path, markdown(file.frontmatter, file.body));
}
const codes = (root: string) => readVault(root).report.diagnostics.map(d => d.code);

function inventory(root: string): Record<string, { source: string; mtime: number }> {
  const files: Record<string, { source: string; mtime: number }> = {};
  function scan(dir: string, prefix: string) {
    for (const name of readdirSync(dir).sort()) {
      const path = prefix + name; const absolute = join(dir, name); const stat = statSync(absolute);
      if (stat.isDirectory()) scan(absolute, path + '/');
      else files[path] = { source: readFileSync(absolute).toString('base64'), mtime: stat.mtimeMs };
    }
  }
  scan(root, ''); return files;
}

test('sample vault: four eligible app candidates, six linked records, three plain notes, no activation or writes', t => {
  const root = fixture(t); const before = inventory(root);
  const result = readVault(root);
  assert.deepEqual(result.report.counts, { files: 13, apps: 4, validApps: 4, records: 6, notes: 3, errors: 0, warnings: 0 });
  assert.equal(result.report.valid, true);
  assert.deepEqual(result.report, readVault(root).report);
  assert.deepEqual(inventory(root), before);
  assert.ok(result.apps.every(app => Value.Check(AppDefinitionSchema, app.definition)));
  assert.ok(!('active' in result.apps[0]!));
});

test('Markdown parser preserves BOM, CRLF, comments, body and revision without coercing dates', () => {
  const source = '\uFEFF---\r\n# Keep my comment\r\ndate: 2026-09-23\r\ncustom: yes\r\n---\r\n# **My** day\r\n\r\n[[Missing]]\r\n';
  const parsed = parseMarkdown('Journal/Day.md', source);
  assert.equal(parsed.source, source); assert.equal(parsed.body, '# **My** day\r\n\r\n[[Missing]]\r\n');
  assert.equal(parsed.title, 'My day'); assert.equal(parsed.frontmatter.date, '2026-09-23'); assert.equal(parsed.frontmatter.custom, 'yes');
  assert.deepEqual(parsed.at(['date']), { line: 3, column: 7 });
  assert.deepEqual(parsed.links, [{ target: 'Missing', line: 8, column: 1 }]);
  assert.match(parsed.revision, /^[a-f0-9]{64}$/); assert.deepEqual(parsed.diagnostics, []);
  assert.notEqual(parsed.revision, parseMarkdown('Journal/Day.md', source + '\n').revision);
});

for (const [name, source, code] of [
  ['unclosed frontmatter', '---\nstatus: open', 'FRONTMATTER_UNCLOSED'],
  ['duplicate YAML keys', '---\nstatus: open\nstatus: done\n---\n', 'YAML_SYNTAX'],
  ['malformed YAML', '---\nvalue: [unterminated\n---\n', 'YAML_SYNTAX'],
  ['sequence root', '---\n- one\n- two\n---\n', 'FRONTMATTER_SHAPE'],
  ['anchors and aliases', '---\na: &x [a, b]\nb: *x\n---\n', 'YAML_UNSUPPORTED'],
  ['unknown tags', '---\na: !execute rm\n---\n', 'YAML_SYNTAX'],
  ['explicit YAML tags', '---\na: !!str 123\n---\n', 'YAML_UNSUPPORTED'],
  ['object-prototype keys', '---\n__proto__: {polluted: true}\n---\n', 'YAML_UNSUPPORTED'],
  ['merge keys', '---\n<<: {status: done}\n---\n', 'YAML_UNSUPPORTED'],
  ['complex mapping keys', '---\n? [a, b]\n: c\n---\n', 'YAML_UNSUPPORTED'],
  ['non-string mapping keys', '---\n42: value\n---\n', 'YAML_UNSUPPORTED'],
  ['nonfinite numbers', '---\namount: .inf\n---\n', 'YAML_UNSUPPORTED'],
  ['unsafe integers', '---\namount: 9007199254740993\n---\n', 'YAML_UNSUPPORTED'],
] as const) test(`parser rejects ${name} without interpreting the content`, () => {
  assert.ok(parseMarkdown('Bad.md', source).diagnostics.some(d => d.code === code));
  assert.equal(Object.hasOwn({}, 'polluted'), false);
});

test('free-form notes need neither frontmatter nor headings; code and escaped examples are not wiki links', () => {
  const source = 'Free-form prose.\n\n`[[Inline]]`\n\n```md\n[[Fenced]]\n```\n\n    [[Indented]]\n\n\\[[Escaped]]\n\n[[Real|Label]] and ![[Picture.png]]\n';
  const file = parseMarkdown('Notes/Plain.md', source);
  assert.equal(file.title, 'Plain'); assert.deepEqual(file.frontmatter, {}); assert.deepEqual(file.diagnostics, []);
  assert.deepEqual(file.links.map(l => l.target), ['Real', 'Picture.png']);
});

const appCases: [string, (definition: AppDefinition) => void, string][] = [
  ['unknown keys', d => Object.assign(d, { execute: 'shell' }), 'APP_SCHEMA'],
  ['unknown contract', d => Object.assign(d, { contract: 'lifeapps/v900' }), 'APP_SCHEMA'],
  ['unsupported operations', d => Object.assign(d.types.task!.actions.create!, { operation: 'shell.run' }), 'APP_SCHEMA'],
  ['reserved fields', d => { d.types.task!.fields.id = { type: 'text' }; }, 'APP_FIELD_RESERVED'],
  ['invalid defaults', d => { d.types.task!.fields.due = { type: 'date', default: '2026-02-30' }; }, 'APP_VALUE'],
  ['unknown action fields', d => { d.types.task!.actions.edit = { operation: 'record.update', fields: ['owner'] }; }, 'APP_FIELD_UNKNOWN'],
  ['invalid fixed values', d => { d.types.task!.actions.complete = { operation: 'record.update', set: { status: 'finished' } }; }, 'APP_VALUE'],
  ['editable fixed values', d => { d.types.task!.actions.complete = { operation: 'record.update', fields: ['status'], set: { status: 'done' } }; }, 'APP_ACTION'],
  ['empty updates', d => { d.types.task!.actions.complete = { operation: 'record.update' }; }, 'APP_ACTION'],
  ['bad predicate values', d => { d.collections.unfinished!.where = { field: 'status', equals: 'oops' }; }, 'APP_VALUE'],
  ['unknown sort fields', d => { d.collections.unfinished!.orderBy = [{ field: 'missing', direction: 'ascending' }]; }, 'APP_FIELD_UNKNOWN'],
  ['unknown collection types', d => { d.collections.unfinished!.type = 'missing'; }, 'APP_TYPE_UNKNOWN'],
  ['unknown view collections', d => { d.views.default = { collection: 'missing', presentation: 'list' }; }, 'APP_COLLECTION_UNKNOWN'],
  ['non-temporal calendar mapping', d => { d.views.deadlines = { collection: 'unfinished', presentation: 'calendar', mapping: { date: 'status', label: 'title' } }; }, 'APP_CALENDAR'],
  ['optional uniqueness keys', d => { d.types.task!.uniqueBy = [['due']]; }, 'APP_UNIQUENESS'],
  ['unknown rule fields', d => { d.types.task!.rules = [{ kind: 'exactlyOne', fields: ['unknown'] }]; }, 'APP_FIELD_UNKNOWN'],
];
for (const [name, mutate, code] of appCases) test(`app semantics reject ${name}`, () => {
  const definition = app(); mutate(definition);
  const result = validateDefinition(parseMarkdown('.apps/Tasks.md', markdown(definition)));
  assert.ok(result.diagnostics.some(d => d.code === code), JSON.stringify(result.diagnostics));
});
for (const folder of ['/tmp', '../Outside', 'Inbox/../Outside', '.apps', 'Inbox/.secret', 'C:\\data', 'Inbox//Tasks', 'Inbox/Tasks/']) test(`unsafe creation folder is rejected: ${folder}`, () => {
  const definition = app(); definition.types.task!.storage.defaultFolder = folder;
  assert.ok(validateDefinition(parseMarkdown('.apps/Tasks.md', markdown(definition))).diagnostics.some(d => d.code === 'APP_PATH'));
});

test('calendar dates and timestamps are strict, leap-aware, and never locale/timezone guessed', () => {
  for (const date of ['2024-02-29', '2000-02-29', '0001-01-01', '9999-12-31']) assert.ok(validDate(date), date);
  for (const date of ['2026-02-30', '1900-02-29', '0000-01-01', '2026-9-01', '2026-13-01', 'tomorrow', '2026-01-01T00:00:00Z']) assert.equal(validDate(date), false, date);
  for (const date of ['2026-09-23T12:00:00Z', '2026-09-23T12:00:00.123+01:00']) assert.ok(validDateTime(date), date);
  for (const date of ['2026-02-30T12:00:00Z', '2026-09-23T24:00:00Z', '2026-09-23T12:00:00', '2026-09-23T12:00:00+14:30', '2026-09-23T12:00:00-00:00']) assert.equal(validDateTime(date), false, date);
  assert.ok(valueError({ type: 'boolean' }, 'true')); assert.ok(valueError({ type: 'number' }, Infinity)); assert.ok(valueError({ type: 'number' }, Number.MAX_SAFE_INTEGER + 1));
});

test('time ranges validate ordering, zone offsets and DST at both endpoints; all-day ranges have exclusive ends', () => {
  const good = { start: '2026-10-25T01:30:00+01:00', end: '2026-10-25T01:30:00+00:00', timeZone: 'Europe/London' };
  assert.equal(valueError({ type: 'time-range' }, good), undefined);
  for (const bad of [{ ...good, timeZone: 'Invalid/Zone' }, { ...good, end: good.start }, { ...good, start: '2026-10-25T01:30:00+02:00' }, { ...good, extra: true }]) assert.ok(valueError({ type: 'time-range' }, bad));
  assert.equal(valueError({ type: 'date-range' }, { start: '2026-09-23', end: '2026-09-24' }), undefined);
  assert.ok(valueError({ type: 'date-range' }, { start: '2026-09-23', end: '2026-09-23' }));
});

test('record diagnostics identify invalid fields precisely; custom metadata is warned about, not deleted', t => {
  const root = fixture(t);
  editRecord(root, taskPath, data => { data.status = 'finished'; data.due = '2026-02-30'; data.custom = 'keep this'; });
  const result = readVault(root); const diagnostics = result.report.diagnostics.filter(d => d.file === taskPath);
  assert.equal(diagnostics.filter(d => d.code === 'FIELD_VALUE').length, 2);
  assert.ok(diagnostics.some(d => d.field === 'frontmatter.status' && d.line === 5));
  assert.ok(diagnostics.some(d => d.code === 'FIELD_UNKNOWN' && d.severity === 'warning'));
  assert.equal(result.documents.find(d => d.file.path === taskPath)!.file.frontmatter.custom, 'keep this');
});

test('required fields are not silently defaulted; envelope/schema changes need explicit migration', t => {
  const root = fixture(t);
  editRecord(root, taskPath, data => { delete data.status; data.schema = 2; data.id = 'not-a-uuid'; data.title = 'not the title source'; });
  const found = codes(root);
  for (const code of ['FIELD_REQUIRED', 'RECORD_SCHEMA_VERSION', 'RECORD_ID', 'FIELD_RESERVED']) assert.ok(found.includes(code), code);
});

test('same UUID in multiple files blocks all copies, even with different casing', t => {
  const root = fixture(t);
  const file = parseMarkdown(taskPath, taskSource); file.frontmatter.id = String(file.frontmatter.id).toUpperCase();
  put(root, 'Inbox/Duplicate.md', markdown(file.frontmatter, file.body));
  const errors = readVault(root).report.diagnostics.filter(d => d.code === 'DUPLICATE_ID');
  assert.equal(errors.length, 2); assert.ok(errors.every(d => d.related?.length === 1));
});

test('two daily entries with different IDs but the same date are both rejected', t => {
  const root = fixture(t); const journal = parseMarkdown(journalPath, readFileSync(join(root, journalPath), 'utf8'));
  journal.frontmatter.id = '550e8400-e29b-41d4-a716-446655440099';
  put(root, 'Journal/Another.md', markdown(journal.frontmatter));
  assert.equal(readVault(root).report.diagnostics.filter(d => d.code === 'DUPLICATE_UNIQUE').length, 2);
});

test('event requires either a day or a time range, never neither or both', t => {
  const root = fixture(t);
  editRecord(root, 'Calendar/2026/09/Day off.md', data => { delete data.day; });
  editRecord(root, 'Calendar/2026/09/Project review.md', data => { data.day = '2026-09-25'; });
  assert.equal(codes(root).filter(code => code === 'FIELD_EXACTLY_ONE').length, 2);
});

test('reference fields resolve by stable ID after a move; unresolved wiki paths warn instead of guessing', t => {
  const root = fixture(t);
  renameSync(join(root, projectPath), join(root, 'Archives/Website.md'));
  const result = readVault(root);
  assert.equal(result.report.valid, true); assert.ok(result.report.counts.warnings > 0);
  assert.ok(!result.report.diagnostics.some(d => d.code.startsWith('REFERENCE_')));
});

test('missing, wrong-type, invalid and duplicate reference targets fail closed', t => {
  const root = fixture(t);
  editRecord(root, taskPath, data => { data.project = '550e8400-e29b-41d4-a716-446655440099'; });
  assert.ok(codes(root).includes('REFERENCE_MISSING'));
  editRecord(root, taskPath, data => { data.project = '550e8400-e29b-41d4-a716-446655440004'; });
  assert.ok(codes(root).includes('REFERENCE_TYPE'));
  editRecord(root, taskPath, data => { data.project = '550e8400-e29b-41d4-a716-446655440001'; });
  editRecord(root, projectPath, data => { data.schema = 99; });
  assert.ok(codes(root).includes('REFERENCE_INVALID'));
  put(root, 'Inbox/Copy.md', readFileSync(join(root, projectPath), 'utf8'));
  assert.ok(codes(root).includes('REFERENCE_AMBIGUOUS'));
});

test('duplicate app IDs and unavailable reference types prevent dependent definitions from passing', t => {
  const root = fixture(t);
  put(root, '.apps/Wiki copy.md', readFileSync(join(root, '.apps/Wiki.md'), 'utf8'));
  const result = readVault(root);
  assert.equal(result.report.counts.validApps, 0);
  assert.equal(result.report.diagnostics.filter(d => d.code === 'APP_DUPLICATE_ID').length, 2);
  assert.ok(result.report.diagnostics.some(d => d.code === 'APP_REFERENCE_TYPE'));
  assert.ok(result.report.diagnostics.some(d => d.code === 'RECORD_TYPE'));
});

test('an external definition edit is revalidated and never leaves stale accepted data', t => {
  const root = fixture(t); assert.equal(readVault(root).report.valid, true);
  editApp(root, '.apps/Tasks.md', app => { app.types.task!.fields.status = { type: 'enum', values: ['queued'], required: true, default: 'queued' }; app.types.task!.actions = {}; app.collections.unfinished!.where = { field: 'status', equals: 'queued' }; });
  assert.ok(codes(root).includes('FIELD_VALUE'));
});

test('wiki links resolve vault-relative paths, explicit relative paths, aliases, fragments, names and attachments', t => {
  const root = fixture(t);
  put(root, 'Attachments/Image.png', Buffer.from([0, 1, 2]));
  put(root, 'Resources/Links.md', '# Links\n\n[[Markdown notes]]\n[[../Projects/Website/Overview#Section|Label]]\n![[Attachments/Image.png]]\n[[#Local heading]]\n');
  assert.equal(readVault(root).report.counts.warnings, 0);
  put(root, 'Areas/Markdown notes.md', '# Other note\n');
  put(root, 'Resources/Bad.md', '[[Markdown notes]] [[Missing]] [[../../outside]] [[https://example.com]]');
  const found = codes(root);
  for (const code of ['WIKILINK_AMBIGUOUS', 'WIKILINK_MISSING', 'WIKILINK_UNSAFE']) assert.ok(found.includes(code), code);
});

test('symlinks are reported and never read; hidden private paths are ignored', t => {
  const root = fixture(t); const outside = mkdtempSync(join(tmpdir(), 'lifeapps-outside-'));
  t.after(() => rmSync(outside, { recursive: true, force: true }));
  put(outside, 'Private.md', 'DO NOT READ THIS CONTENT');
  symlinkSync(join(outside, 'Private.md'), join(root, 'Leak.md'));
  symlinkSync(outside, join(root, 'Linked folder'));
  put(root, '.private/Secret.md', '---\nbad: [\n---\n');
  const result = readVault(root);
  assert.equal(result.report.diagnostics.filter(d => d.code === 'VAULT_SYMLINK').length, 2);
  assert.ok(!JSON.stringify(result.report).includes('DO NOT READ'));
  assert.ok(!result.documents.some(d => d.file.path.startsWith('.private')));
  assert.equal(result.report.counts.files, 13);
});

test('missing roots, missing app directories, invalid UTF-8 and bounded scans produce errors', t => {
  const root = fixture(t);
  assert.ok(codes(join(root, 'Missing')).includes('VAULT_ROOT'));
  assert.ok(codes(join(root, 'Inbox')).includes('VAULT_APPS'));
  put(root, 'Bad.md', Buffer.from([0xff, 0xfe]));
  assert.ok(codes(root).includes('FILE_ENCODING'));
  assert.ok(readVault(root, { maxFiles: 1 }).report.diagnostics.some(d => d.code === 'VAULT_LIMIT'));
  assert.ok(readVault(root, { maxFileBytes: 10 }).report.diagnostics.some(d => d.code === 'FILE_TOO_LARGE'));
  assert.ok(readVault(root, { maxTotalBytes: 10 }).report.diagnostics.some(d => d.code === 'VAULT_LIMIT'));
  assert.ok(readVault(root, { maxDepth: 1 }).report.diagnostics.some(d => d.code === 'VAULT_LIMIT'));
  assert.throws(() => readVault(root, { maxFiles: 0 }), /positive safe integers/);
});
