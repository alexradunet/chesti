import { test } from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import type { Database } from 'bun:sqlite';
import { AppError } from '../src/core.js';
import { openDatabase } from '../src/database.js';
import { documentFromMarkdown, documentReferences, documentText } from '../src/objects/document.js';
import { PAGE_TYPE_ID } from '../src/objects/model.js';
import type { ObjectWrite, PropertyValue } from '../src/objects/model.js';
import { ObjectRuntime } from '../src/objects/runtime.js';
import { initializeVault } from '../src/vault/sql.js';

function fixture(t: TestContext) {
  const db = openDatabase();
  t.after(() => db.close());
  return { db, runtime: new ObjectRuntime(db) };
}
function input(typeId = PAGE_TYPE_ID, title = 'Object', properties: Record<string, PropertyValue> = {}, markdown = ''): ObjectWrite {
  return { typeId, title, properties, document: documentFromMarkdown(markdown) };
}
function status(code: number): (error: unknown) => boolean {
  return error => error instanceof AppError && error.status === code;
}

test('shared property identity and existing values survive global label renames', t => {
  const { runtime } = fixture(t);
  let tasks = runtime.createType('Task');
  const projects = runtime.createType('Project');
  tasks = runtime.addProperty(tasks.id, tasks.revision, { label: 'State', kind: 'select', options: ['Open', 'Done'] });
  const property = runtime.getProperty(tasks.propertyIds[0]!);
  const shared = runtime.addProperty(projects.id, projects.revision, { propertyId: property.id });
  const option = property.options![0]!.id;
  const task = runtime.createObject(input(tasks.id, 'Task', { [property.id]: option }));
  const project = runtime.createObject(input(shared.id, 'Project', { [property.id]: option }));
  const page = runtime.createObject(input(PAGE_TYPE_ID, 'Extra registered property', { [property.id]: option }));
  const renamed = runtime.renameProperty(property.id, property.revision, 'Progress');
  assert.equal(renamed.id, property.id);
  assert.deepEqual(renamed.options, property.options);
  assert.deepEqual(runtime.getType(tasks.id).propertyIds, [property.id]);
  assert.deepEqual(runtime.getType(projects.id).propertyIds, [property.id]);
  for (const object of [task, project, page]) assert.equal(runtime.getObject(object.id).properties[renamed.id], option);
  assert.throws(() => runtime.renameProperty(property.id, property.revision, 'Stale'), status(409));
  assert.throws(() => runtime.addProperty(shared.id, shared.revision, { propertyId: property.id }), status(409));
  assert.equal(runtime.createObject(input(tasks.id, 'Optional')).properties[property.id], undefined);
  assert.throws(() => runtime.createObject(input(tasks.id, 'Label is not identity', { [property.id]: 'Open' })), status(422));
});

test('object revisions reject stale writes and preserve recoverable pre-change content', t => {
  const { db, runtime } = fixture(t);
  const made = runtime.createObject(input(PAGE_TYPE_ID, 'Before', {}, '# Body\n\nKeep **formatting**.'));
  const renamed = runtime.updateObject(made.id, made.revision, { ...made, title: 'After' });
  assert.equal(renamed.id, made.id);
  assert.deepEqual(renamed.document, made.document);
  assert.throws(() => runtime.updateObject(made.id, made.revision, { ...made, title: 'Lost update' }), status(409));
  assert.throws(() => runtime.patchProperties(made.id, made.revision, {}), status(409));
  assert.throws(() => runtime.setTrashed(made.id, made.revision, true), status(409));
  const snapshot = db.query<{ snapshot_json: string }, [string, number]>('SELECT snapshot_json FROM object_revisions WHERE object_id = ? AND revision = ?').get(made.id, made.revision)!;
  assert.deepEqual(JSON.parse(snapshot.snapshot_json), made);
  const otherType = runtime.createType('Reading');
  const changed = runtime.updateObject(made.id, renamed.revision, { ...renamed, typeId: otherType.id });
  assert.equal(changed.id, made.id);
  assert.deepEqual(changed.document, made.document);
  assert.equal(changed.createdAt, made.createdAt);
  assert.equal(runtime.getObject(made.id).title, 'After');
});

test('typed references and mentions retain provenance through trash and restore without view ownership', t => {
  const { runtime } = fixture(t);
  const people = runtime.createType('Person');
  const person = runtime.createObject(input(people.id, 'Ada'));
  const another = runtime.createObject(input(people.id, 'Grace'));
  let page = runtime.getType(PAGE_TYPE_ID);
  page = runtime.addProperty(page.id, page.revision, { label: 'People', kind: 'reference', targetTypeId: people.id, multiple: true });
  const references = page.propertyIds[0]!;
  page = runtime.addProperty(page.id, page.revision, { label: 'Comment', kind: 'text' });
  const comment = page.propertyIds[1]!;
  const mention = documentFromMarkdown('People:');
  mention.content![0]!.content!.push({ type: 'object_link', attrs: { objectId: person.id, label: person.title } });
  const note = runtime.createObject({ ...input(page.id, 'Meeting', { [references]: [person.id, another.id] }), document: mention });
  const backlinks = runtime.backlinks(person.id);
  assert.equal(backlinks.length, 2);
  assert.ok(backlinks.some(link => link.object.id === note.id && link.propertyId === references && link.blockId === undefined));
  assert.ok(backlinks.some(link => link.object.id === note.id && link.blockId === note.document.content![0]!.attrs!.blockId && link.propertyId === undefined));
  assert.throws(() => runtime.patchProperties(note.id, note.revision, { [references]: person.id }), status(422));
  assert.throws(() => runtime.patchProperties(note.id, note.revision, { [references]: [person.id, person.id] }), status(422));
  assert.throws(() => runtime.patchProperties(note.id, note.revision, { [references]: [note.id] }), status(422));
  assert.throws(() => runtime.updateObject(person.id, person.revision, { ...person, typeId: page.id }), status(409));
  const trashed = runtime.setTrashed(person.id, person.revision, true);
  const edited = runtime.patchProperties(note.id, note.revision, { [comment]: 'Still editable' });
  assert.deepEqual(edited.properties[references], [person.id, another.id]);
  assert.equal(runtime.backlinks(person.id).length, 2);
  assert.throws(() => runtime.createObject(input(page.id, 'New forbidden reference', { [references]: [person.id] })), status(422));
  assert.throws(() => runtime.createObject({ ...input(page.id, 'New forbidden mention'), document: mention }), status(422));
  assert.equal(runtime.listObjects().some(object => object.id === person.id), false);
  assert.deepEqual(runtime.listObjects({ trashed: true }).map(object => object.id), [person.id]);
  const restored = runtime.setTrashed(person.id, trashed.revision, false);
  assert.equal(restored.id, person.id);
  assert.equal(restored.typeId, people.id);
  assert.equal(runtime.backlinks(person.id).length, 2);
  const removed = runtime.patchProperties(edited.id, edited.revision, { [references]: null });
  assert.equal(removed.properties[references], undefined);
  assert.equal(runtime.backlinks(person.id).length, 1);
});

test('idempotent creation ignores generated block IDs but rejects mismatched requests', t => {
  const { runtime } = fixture(t);
  const requestId = crypto.randomUUID();
  const first = runtime.createObject(input(PAGE_TYPE_ID, 'Once', {}, 'A paragraph.'), requestId);
  const retry = runtime.createObject(input(PAGE_TYPE_ID, 'Once', {}, 'A paragraph.'), requestId);
  assert.equal(retry.id, first.id);
  assert.equal(runtime.listObjects().length, 1);
  assert.throws(() => runtime.createObject(input(PAGE_TYPE_ID, 'Different', {}, 'A paragraph.'), requestId), status(409));
  const trashed = runtime.setTrashed(first.id, first.revision, true);
  assert.deepEqual(runtime.createObject(input(PAGE_TYPE_ID, 'Once', {}, 'A paragraph.'), requestId), trashed);
});

test('browse is bounded, literal-searchable, and isolates trash state', t => {
  const { runtime } = fixture(t);
  for (let index = 0; index < 52; index++) runtime.createObject(input(PAGE_TYPE_ID, `Item ${index}`));
  const percent = runtime.createObject(input(PAGE_TYPE_ID, '100% complete', {}, 'An unusual needle.'));
  assert.equal(runtime.listObjects().length, 50);
  assert.equal(runtime.listObjects({ offset: 50 }).length, 3);
  assert.deepEqual(runtime.listObjects({ search: '%' }).map(object => object.id), [percent.id]);
  assert.deepEqual(runtime.listObjects({ search: 'unusual needle' }).map(object => object.id), [percent.id]);
  runtime.setTrashed(percent.id, percent.revision, true);
  assert.deepEqual(runtime.listObjects({ search: '%' }), []);
  assert.deepEqual(runtime.listObjects({ search: '%', trashed: true }).map(object => object.id), [percent.id]);
  assert.throws(() => runtime.listObjects({ limit: 201 }), status(422));
  assert.throws(() => runtime.listObjects({ offset: -1 }), status(422));
});

function legacyFixture(t: TestContext) {
  const db = openDatabase();
  t.after(() => db.close());
  initializeVault(db);
  const definition = { id: 'work', types: { task: { fields: { status: { type: 'enum', values: ['Open', 'Done'] }, owner: { type: 'reference', target: 'people.person' }, due: { type: 'date' } } } } };
  const people = { id: 'people', types: { person: { fields: {} } } };
  for (const app of [definition, people]) {
    db.query('INSERT INTO vault_apps(id, path, current_revision) VALUES (?, ?, ?)').run(app.id, `.apps/${app.id}.md`, 'current');
    db.query('INSERT INTO vault_app_revisions(app_id, revision, definition_json, body, source) VALUES (?, ?, ?, ?, ?)').run(app.id, 'current', JSON.stringify(app), 'Original definition prose.', 'Original definition source.');
  }
  const targetId = 'AABBCCDD-0000-4000-8000-000000000001';
  const taskId = 'aabbccdd-0000-4000-8000-000000000002';
  const noteId = 'aabbccdd-0000-4000-8000-000000000003';
  legacyRecord(db, targetId, 'People/Ada.md', 'record', 'people.person', 'Ada', 'Original biography.', {});
  legacyRecord(db, taskId, 'Tasks/Ship.md', 'record', 'work.task', 'Ship', '# Ship\n\n[[Ada|Owner]] and [[Missing]]; `[[Ada]]`.', { status: 'Open', owner: targetId.toLowerCase(), due: '2026-09-24', custom: { nested: ['keep', 7], active: true }, effort: 3, comment: '\uFEFFOriginal metadata.' });
  legacyRecord(db, noteId, 'Notes/Private.md', 'note', null, 'Private', 'Owner-only note with [[People/Ada]].', { aliases: ['My private note'], pinned: true });
  return { db, targetId, taskId, noteId };
}
function legacyRecord(db: Database, id: string, path: string, kind: string, type: string | null, title: string, body: string, fields: Record<string, unknown>): void {
  db.query('INSERT INTO vault_records(id, path, kind, type, schema_version, fields_json, title, body, source, revision) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(id, path, kind, type, type === null ? null : 1, JSON.stringify(fields), title, body, `Archived source for ${id}`, `revision-${id}`);
}

test('SQL migration gives owners all records, preserves metadata and IDs, and resolves unambiguous wiki links once', t => {
  const { db, targetId, taskId, noteId } = legacyFixture(t);
  const archive = db.query('SELECT * FROM vault_records ORDER BY id').all();
  const runtime = new ObjectRuntime(db);
  assert.equal(runtime.listObjects().length, 3);
  const target = runtime.getObject(targetId);
  assert.equal(target.id, targetId);
  const task = runtime.getObject(taskId);
  assert.equal(task.title, 'Ship');
  assert.equal(runtime.getType(task.typeId).name, 'work.task');
  const byLabel = new Map(runtime.catalog().properties.map(property => [property.label, property]));
  const statusProperty = byLabel.get('status')!;
  assert.equal(task.properties[statusProperty.id], statusProperty.options!.find(option => option.label === 'Open')!.id);
  assert.equal(task.properties[byLabel.get('owner')!.id], targetId);
  assert.equal(task.properties[byLabel.get('due')!.id], '2026-09-24');
  assert.equal(task.properties[byLabel.get('effort')!.id], 3);
  assert.equal(task.properties[byLabel.get('comment')!.id], '\uFEFFOriginal metadata.');
  assert.deepEqual(JSON.parse(String(task.properties[byLabel.get('custom')!.id])), { nested: ['keep', 7], active: true });
  assert.equal(runtime.getObject(noteId).typeId, PAGE_TYPE_ID);
  assert.equal(runtime.getObject(noteId).properties[byLabel.get('pinned')!.id], true);
  assert.match(documentText(task.document), /Owner and \[\[Missing\]\]; \[\[Ada\]\]/);
  assert.deepEqual(documentReferences(task.document).map(reference => reference.targetId), [targetId.toLowerCase()]);
  assert.equal(runtime.backlinks(targetId).filter(link => link.object.id === taskId).length, 2);
  assert.equal(runtime.backlinks(targetId).some(link => link.object.id === noteId && link.blockId), true);
  assert.deepEqual(db.query('SELECT * FROM vault_records ORDER BY id').all(), archive);
  const catalog = runtime.catalog();
  const restarted = new ObjectRuntime(db);
  assert.deepEqual(restarted.catalog(), catalog);
  assert.deepEqual(restarted.getObject(taskId), task);
  assert.equal(restarted.listObjects().length, 3);
});

test('unsupported migration rolls back everything without losing or marking source data', t => {
  const { db, taskId } = legacyFixture(t);
  const old = db.query<{ fields_json: string }, [string]>('SELECT fields_json FROM vault_records WHERE id = ?').get(taskId)!;
  const fields = JSON.parse(old.fields_json);
  fields.status = 'Not declared';
  db.query('UPDATE vault_records SET fields_json = ? WHERE id = ?').run(JSON.stringify(fields), taskId);
  assert.throws(() => new ObjectRuntime(db), /enum value is not declared/);
  assert.equal(db.query<{ count: number }, []>("SELECT count(*) AS count FROM sqlite_master WHERE name IN ('objects', 'object_metadata')").get()!.count, 0);
  assert.equal(JSON.parse(db.query<{ fields_json: string }, [string]>('SELECT fields_json FROM vault_records WHERE id = ?').get(taskId)!.fields_json).status, 'Not declared');
  db.query('UPDATE vault_records SET fields_json = ? WHERE id = ?').run(old.fields_json, taskId);
  assert.equal(new ObjectRuntime(db).getObject(taskId).title, 'Ship');
});

test('schema version guard does not modify newer object databases', t => {
  const { db, runtime } = fixture(t);
  const object = runtime.createObject(input());
  db.query("UPDATE object_metadata SET value = '2' WHERE key = 'schema_version'").run();
  assert.throws(() => new ObjectRuntime(db), /Unsupported object database schema/);
  assert.deepEqual(runtime.getObject(object.id), object);
  assert.equal(db.query<{ value: string }, []>("SELECT value FROM object_metadata WHERE key = 'schema_version'").get()!.value, '2');
});
