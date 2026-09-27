import { test } from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { Database } from 'bun:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AppError } from '../src/core.js';
import { openDatabase } from '../src/database.js';
import { ObjectRuntime } from '../src/objects/runtime.js';
import { openWorkspace } from '../src/objects/workspace.js';
import { ViewService } from '../src/objects/views.js';
import { PAGE_TYPE_ID, TASK_TYPE_ID, TASK_DONE_PROPERTY_ID, TASK_DUE_PROPERTY_ID } from '../src/objects/model.js';

function workspace(t: TestContext) {
  const directory = mkdtempSync(join(tmpdir(), 'taskdesk-demo-'));
  const file = join(directory, 'workspace.sqlite');
  const state = { objects: openWorkspace(file) };
  t.after(() => {
    state.objects.db.close();
    rmSync(directory, { recursive: true, force: true });
  });
  return {
    state,
    reopen() {
      state.objects.db.close();
      state.objects = openWorkspace(file);
      return state.objects;
    },
  };
}
const status = (code: number) => (error: unknown): boolean => error instanceof AppError && error.status === code;

function assertHealthy(db: Database): void {
  assert.deepEqual(db.query<Record<string, string>, []>('PRAGMA integrity_check').all(), [{ integrity_check: 'ok' }]);
  assert.deepEqual(db.query('PRAGMA foreign_key_check').all(), []);
}

test('openWorkspace runs bounded planner optimization only after successful initialization', t => {
  const executed: string[] = [];
  const optimizeTransactions: boolean[] = [];
  const exec = Database.prototype.exec;
  Database.prototype.exec = function(sql: string) {
    executed.push(sql);
    if (sql === 'PRAGMA optimize=0x10002') optimizeTransactions.push(this.inTransaction);
    return exec.call(this, sql);
  };
  t.after(() => { Database.prototype.exec = exec; });

  const directory = mkdtempSync(join(tmpdir(), 'taskdesk-optimize-'));
  const file = join(directory, 'workspace.sqlite');
  let objects = openWorkspace(file);
  t.after(() => { objects.db.close(); rmSync(directory, { recursive: true, force: true }); });
  assert.ok(executed.some(sql => sql === 'PRAGMA optimize=0x10002'));
  assert.deepEqual(optimizeTransactions, [false]);
  assertHealthy(objects.db);

  executed.length = 0;
  optimizeTransactions.length = 0;
  objects.db.close();
  objects = openWorkspace(file);
  assert.ok(executed.some(sql => sql === 'PRAGMA optimize=0x10002'));
  assert.deepEqual(optimizeTransactions, [false]);
  assertHealthy(objects.db);
});

test('unsupported workspaces are rejected without touching data or statistics', t => {
  const executed: string[] = [];
  const exec = Database.prototype.exec;
  Database.prototype.exec = function(sql: string) {
    executed.push(sql);
    return exec.call(this, sql);
  };
  t.after(() => { Database.prototype.exec = exec; });

  const directory = mkdtempSync(join(tmpdir(), 'taskdesk-unsupported-'));
  const file = join(directory, 'workspace.sqlite');
  let db = openDatabase(file);
  t.after(() => { db.close(); rmSync(directory, { recursive: true, force: true }); });
  db.exec(`
    CREATE TABLE object_metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT;
    INSERT INTO object_metadata VALUES ('schema_version', '999');
    CREATE TABLE sample (id INTEGER PRIMARY KEY, value TEXT NOT NULL) STRICT;
    CREATE INDEX sample_value ON sample(value);
    INSERT INTO sample(value) VALUES ('a'), ('b'), ('c');
    ANALYZE;
  `);
  const schema = db.query('SELECT type, name, tbl_name, sql FROM sqlite_schema ORDER BY type, name').all();
  const statistics = db.query('SELECT * FROM sqlite_stat1 ORDER BY tbl, idx').all();
  const rows = db.query('SELECT * FROM sample ORDER BY id').all();
  db.close();

  executed.length = 0;
  assert.throws(() => openWorkspace(file), /Unsupported object database schema/);
  assert.equal(executed.some(sql => sql === 'PRAGMA optimize=0x10002'), false);
  db = openDatabase(file);
  assert.deepEqual(db.query('SELECT type, name, tbl_name, sql FROM sqlite_schema ORDER BY type, name').all(), schema);
  assert.deepEqual(db.query('SELECT * FROM sqlite_stat1 ORDER BY tbl, idx').all(), statistics);
  assert.deepEqual(db.query('SELECT * FROM sample ORDER BY id').all(), rows);
});

test('reopening a populated WAL workspace preserves data, history, receipts, views and checks cleanly', t => {
  const f = workspace(t);
  let objects = f.state.objects;
  const requestId = crypto.randomUUID();
  const page = objects.createObject({ typeId: PAGE_TYPE_ID, title: 'Persistent page', properties: {}, body: 'Original body' }, requestId);
  const edited = objects.updateObject(page.id, page.revision, { ...page, title: 'Edited page', body: 'Edited body' });
  const views = new ViewService(objects);
  const viewId = views.list()[0]!.id;
  const evaluated = views.evaluate(viewId);
  assertHealthy(objects.db);

  objects = f.reopen();
  assert.deepEqual(objects.getObject(page.id), edited);
  assert.deepEqual(objects.createObject({ typeId: PAGE_TYPE_ID, title: 'Persistent page', properties: {}, body: 'Original body' }, requestId), edited);
  assert.deepEqual(
    JSON.parse(objects.db.query<{ snapshot_json: string }, [string, number]>('SELECT snapshot_json FROM object_revisions WHERE object_id = ? AND revision = ?').get(page.id, page.revision)!.snapshot_json),
    page,
  );
  assert.deepEqual(new ViewService(objects).evaluate(viewId), evaluated);
  assertHealthy(objects.db);
});

test('reopening a demo preserves edits, identities, trash, and deleted views even after emptying it', t => {
  const f = workspace(t);
  let objects = f.state.objects;
  const page = objects.listObjects({ typeId: PAGE_TYPE_ID })[0]!;
  const changed = objects.updateObject(page.id, page.revision, { ...page, title: 'My own workspace', body: 'Keep my exact writing.\n' });
  const views = new ViewService(objects);
  const deleted = views.list()[0]!;
  views.delete(deleted.id, deleted.revision);
  const catalog = objects.catalog();
  const saved = objects.listObjects();
  const trashed = objects.listObjects({ trashed: true });
  const remainingViews = views.list();

  objects = f.reopen();
  assert.deepEqual(objects.getObject(page.id), changed);
  assert.deepEqual(objects.catalog(), catalog);
  assert.deepEqual(objects.listObjects(), saved);
  assert.deepEqual(objects.listObjects({ trashed: true }), trashed);
  assert.deepEqual(new ViewService(objects).list(), remainingViews);

  for (const object of objects.listObjects()) objects.setTrashed(object.id, object.revision, true);
  const reopenedViews = new ViewService(objects);
  for (const view of reopenedViews.list()) reopenedViews.delete(view.id, view.revision);
  const emptyWorkspaceTrash = objects.listObjects({ trashed: true });
  objects = f.reopen();
  assert.deepEqual(objects.listObjects(), []);
  assert.deepEqual(objects.listObjects({ trashed: true }), emptyWorkspaceTrash);
  assert.deepEqual(new ViewService(objects).list(), []);
});

test('an existing empty object workspace is not mistaken for first initialization', t => {
  const directory = mkdtempSync(join(tmpdir(), 'taskdesk-existing-'));
  const file = join(directory, 'workspace.sqlite');
  let db = openDatabase(file);
  t.after(() => { db.close(); rmSync(directory, { recursive: true, force: true }); });
  const original = new ObjectRuntime(db);
  const page = original.getType(PAGE_TYPE_ID);
  original.renameType(page.id, page.revision, 'Notes');
  const catalog = original.catalog();
  db.exec("CREATE TABLE unrelated (value TEXT); INSERT INTO unrelated VALUES ('preserve me')");
  db.close();

  const objects = openWorkspace(file);
  db = objects.db;
  assert.deepEqual(objects.catalog(), catalog);
  assert.deepEqual(objects.listObjects(), []);
  assert.deepEqual(new ViewService(objects).list(), []);
  assert.deepEqual(db.query('SELECT value FROM unrelated').all(), [{ value: 'preserve me' }]);
});

test('a failed demo write rolls back first initialization and permits a complete retry', t => {
  const directory = mkdtempSync(join(tmpdir(), 'taskdesk-demo-rollback-'));
  const file = join(directory, 'workspace.sqlite');
  let db = openDatabase(file);
  t.after(() => { db.close(); rmSync(directory, { recursive: true, force: true }); });
  // Deliberately incompatible storage fails only when the first view is saved,
  // after all demo objects and their reference edges have been written.
  db.exec("CREATE TABLE object_views (id TEXT PRIMARY KEY); CREATE TABLE unrelated (value TEXT); INSERT INTO unrelated VALUES ('preserve me')");
  const before = db.query('SELECT type, name, sql FROM sqlite_schema ORDER BY type, name').all();
  db.close();
  assert.throws(() => openWorkspace(file));
  db = openDatabase(file);
  assert.deepEqual(db.query('SELECT type, name, sql FROM sqlite_schema ORDER BY type, name').all(), before);
  assert.deepEqual(db.query('SELECT value FROM unrelated').all(), [{ value: 'preserve me' }]);
  db.exec('DROP TABLE object_views');
  db.close();

  const objects = openWorkspace(file);
  db = objects.db;
  const task = objects.listObjects({ typeId: TASK_TYPE_ID }).find(object => !object.properties[TASK_DONE_PROPERTY_ID])!;
  const views = new ViewService(objects);
  const view = views.list().find(view => view.spec.blocks.some(block => block.component === 'board' && block.sources[0]?.bindings.group === TASK_DONE_PROPERTY_ID))!;
  const block = view.spec.blocks.findIndex(block => block.component === 'board');
  const completed = views.act(view.id, view.revision, block, task.id, task.revision, 'group', true);
  assert.equal(objects.getObject(completed.id).properties[TASK_DONE_PROPERTY_ID], true);
});

test('demo views expose the same objects, avoid temporal duplicates, and enforce reference scope', t => {
  const { state } = workspace(t);
  const objects = state.objects;
  const views = new ViewService(objects);
  const allViews = views.list();
  const calendar = allViews.find(view => view.spec.blocks.some(block => block.component === 'calendar'))!;
  const calendarRows = views.evaluate(calendar.id).blocks.flatMap(block => block.rows.map(row => row.object.id));
  const datedTypes = objects.listObjects().filter(object => object.typeId !== PAGE_TYPE_ID);
  assert.equal(calendarRows.length, new Set(calendarRows).size, 'each temporal object appears only once');
  assert.deepEqual(new Set(calendarRows), new Set(datedTypes.map(object => object.id)));
  const undated = objects.listObjects({ typeId: TASK_TYPE_ID }).find(object => !object.properties[TASK_DUE_PROPERTY_ID])!;
  assert.ok(calendarRows.includes(undated.id), 'undated tasks remain visible');

  const overview = allViews.find(view => view.spec.blocks.some(block => block.component === 'table'))!;
  const board = overview.spec.blocks.findIndex(block => block.component === 'board');
  const task = objects.listObjects({ typeId: TASK_TYPE_ID }).find(object =>
    !object.properties[TASK_DONE_PROPERTY_ID] && object.properties[TASK_DUE_PROPERTY_ID])!;
  const completed = views.act(overview.id, overview.revision, board, task.id, task.revision, 'group', true);
  const table = views.evaluate(overview.id).blocks.find(block => block.definition.component === 'table')!;
  const tableObject = table.rows.find(row => row.object.id === task.id)?.object;
  assert.equal(Object.hasOwn(tableObject as object, 'body'), false);
  assert.deepEqual(tableObject, (({ body: _body, ...summary }) => summary)(completed));
  assert.equal(objects.getObject(task.id).properties[TASK_DONE_PROPERTY_ID], true);
  assert.throws(() => views.act(overview.id, overview.revision, board, task.id, task.revision, 'group', false), status(409));

  const scoped = allViews.find(view => view.spec.input)!;
  assert.ok(views.evaluate(scoped.id).blocks.every(block => block.rows.length === 0));
  const scopedBoard = scoped.spec.blocks.findIndex(block => block.component === 'board');
  const source = scoped.spec.blocks[scopedBoard]!.sources[0]!;
  const reference = source.where!.find(filter => typeof filter.value === 'object')!.propertyId;
  const inputId = task.properties[reference] as string;
  const selected = views.evaluate(scoped.id, inputId);
  const scopedTasks = selected.blocks[scopedBoard]!.rows;
  assert.ok(scopedTasks.every(row => row.object.properties[reference] === inputId));
  assert.equal(scopedTasks.some(row => row.object.id === completed.id), false, 'completed task is filtered out');
  const outside = objects.listObjects({ typeId: TASK_TYPE_ID }).find(object => object.properties[reference] !== inputId)!;
  assert.throws(() => views.act(scoped.id, scoped.revision, scopedBoard, outside.id, outside.revision, 'group', null, inputId), status(403));
  const inside = scopedTasks[0]!.object;
  assert.throws(() => views.act(scoped.id, scoped.revision, scopedBoard, inside.id, inside.revision, 'group', null), status(422));
  const regrouped = views.act(scoped.id, scoped.revision, scopedBoard, inside.id, inside.revision, 'group', null, inputId);
  assert.equal(regrouped.properties[source.bindings.group!], undefined);
  assert.ok(views.evaluate(scoped.id, inputId).blocks[scopedBoard]!.rows.some(row => row.object.id === inside.id));
  views.delete(overview.id, overview.revision);
  assert.deepEqual(objects.getObject(completed.id), completed);
  assert.equal(objects.getObject(completed.id).body, completed.body);
});
