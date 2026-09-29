import type { Database } from 'bun:sqlite';
import { AppError } from '../core.js';
import { initializeApplicationSchema } from '../schema.js';
import { fingerprint } from './fingerprint.js';
import { FIXED_PROPERTIES, FIXED_TYPES, FIXED_PROPERTY_IDS, FIXED_TYPE_IDS, PERSON_TYPE_ID, PERSON_RECONNECT_EVERY_PROPERTY_ID, type ViewObjectRecord } from './model.js';
import { localDateBounds, validDate, valueError } from './values.js';
import { markdownReferences, markdownText, validateMarkdown } from './markdown.js';
import { EVENT_DATES_PROPERTY_ID, EVENT_TIME_PROPERTY_ID, EVENT_TYPE_ID, JOURNAL_DATE_PROPERTY_ID, JOURNAL_TYPE_ID, REMINDER_DATE_PROPERTY_ID, REMINDER_TIME_PROPERTY_ID, REMINDER_TYPE_ID, TASK_DONE_PROPERTY_ID, TASK_DUE_PROPERTY_ID, TASK_SCHEDULED_PROPERTY_ID, TASK_TYPE_ID } from './model.js';
import type { BacklinkPage, BoundedPage, Catalog, DayTaskSummary, ObjectListOptions, ObjectRecord, ObjectRevisionSummary, ObjectSummary, ObjectType, ObjectWrite, PropertyDefinition, PropertyValue } from './model.js';

const ID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const JOURNAL_DATE_PATH = `$."${JOURNAL_DATE_PROPERTY_ID}"`;
interface ObjectSummaryRow { id: string; type_id: string; title: string; revision: number; created_at: string; updated_at: string; trashed: number }
interface ObjectRow extends ObjectSummaryRow { properties_json: string; body: string }
interface DayTaskRow extends ObjectSummaryRow { done: unknown; due_date: unknown; scheduled_date: unknown; matches_due: number; matches_scheduled: number }
interface RevisionRow { revision: number; snapshot_json: string; recorded_at: string }
interface RevisionSummaryRow { revision: number; recorded_at: string; title: string; type_id: string; trashed: number }
interface WritingDerivations { links: Set<string>; text?: string }

function objectSummary(row: ObjectSummaryRow): ObjectSummary {
  return { id: row.id, typeId: row.type_id, title: row.title, revision: row.revision, createdAt: row.created_at, updatedAt: row.updated_at, trashed: row.trashed === 1 };
}
function objectRecord(row: ObjectRow): ObjectRecord {
  return { ...objectSummary(row), properties: JSON.parse(row.properties_json), body: row.body };
}
function snapshotRecord(value: string): ObjectRecord {
  const record = JSON.parse(value) as ObjectRecord;
  if (!plainObject(record) || typeof record.id !== 'string' || !ID.test(record.id) || typeof record.typeId !== 'string' || !ID.test(record.typeId) ||
      typeof record.title !== 'string' || !plainObject(record.properties) || typeof record.body !== 'string' ||
      !Number.isSafeInteger(record.revision) || record.revision < 1 || typeof record.createdAt !== 'string' || typeof record.updatedAt !== 'string' ||
      typeof record.trashed !== 'boolean') throw new AppError(500, 'Historical snapshot is not readable.');
  return record;
}
function revisionIs(current: number, supplied: number): void {
  if (!Number.isSafeInteger(supplied) || current !== supplied) throw new AppError(409, 'This item changed. Reload before saving.');
}
function plainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

type BrowseShape = { where: string; values: (string | number)[] };
function browseShape(options: ObjectListOptions): BrowseShape {
  if (options.search !== undefined && (typeof options.search !== 'string' || options.search.length > 200)) throw new AppError(422, 'Search must be at most 200 characters.');
  if (options.trashed !== undefined && typeof options.trashed !== 'boolean') throw new AppError(422, 'Invalid trash filter.');
  const values: (string | number)[] = [options.trashed ? 1 : 0];
  const predicates = ['trashed = ?'];
  if (options.typeId !== undefined) {
    if (typeof options.typeId !== 'string' || !ID.test(options.typeId)) throw new AppError(422, 'Invalid type filter.');
    predicates.push('type_id = ?');
    values.push(options.typeId);
  }
  if (options.search?.length) {
    const pattern = `%${options.search.replace(/[\\%_]/g, '\\$&')}%`;
    predicates.push("(title LIKE ? ESCAPE '\\' OR body_text LIKE ? ESCAPE '\\')");
    values.push(pattern, pattern);
  }
  return { where: predicates.join(' AND '), values };
}
function browseBounds(options: ObjectListOptions): { limit: number; offset: number } {
  const limit = options.limit ?? 50;
  const offset = options.offset ?? 0;
  if (!Number.isInteger(limit) || limit < 1 || limit > 200 || !Number.isInteger(offset) || offset < 0 || offset > 1_000_000) throw new AppError(422, 'Invalid browse limit or offset.');
  return { limit, offset };
}

export class ObjectRuntime {
  constructor(readonly db: Database) {
    initializeApplicationSchema(db);
  }

  catalog(): Catalog {
    return {
      types: FIXED_TYPES.map(type => ({ ...type, propertyIds: [...type.propertyIds] })),
      properties: FIXED_PROPERTIES.map(property => ({ ...property })),
    };
  }
  getType(id: string): ObjectType {
    const type = FIXED_TYPES.find(item => item.id === id);
    if (!type) throw new AppError(404, 'Object type not found.');
    return { ...type, propertyIds: [...type.propertyIds] };
  }
  getProperty(id: string): PropertyDefinition {
    const property = FIXED_PROPERTIES.find(item => item.id === id);
    if (!property) throw new AppError(404, 'Property not found.');
    return { ...property };
  }
  getObject(id: string): ObjectRecord {
    const row = this.db.query<ObjectRow, [string]>('SELECT * FROM objects WHERE id = ?').get(id);
    if (!row) throw new AppError(404, 'Object not found.');
    return objectRecord(row);
  }
  getObjectSummary(id: string): ObjectSummary {
    const row = this.db.query<ObjectSummaryRow, [string]>('SELECT id, type_id, title, revision, created_at, updated_at, trashed FROM objects WHERE id = ?').get(id);
    if (!row) throw new AppError(404, 'Object not found.');
    return objectSummary(row);
  }
  listObjectHistory(id: string, offset = 0): { revisions: ObjectRevisionSummary[]; hasMore: boolean } {
    if (typeof id !== 'string' || !ID.test(id)) throw new AppError(422, 'Invalid object ID.');
    this.getObject(id);
    const limit = 20;
    if (!Number.isInteger(offset) || offset < 0 || offset > 1_000_000) throw new AppError(422, 'Invalid history page.');
    const rows = this.db.query<RevisionSummaryRow, [string, number, number]>(`SELECT revision, recorded_at,
        json_extract(snapshot_json, '$.title') AS title,
        json_extract(snapshot_json, '$.typeId') AS type_id,
        CASE json_extract(snapshot_json, '$.trashed') WHEN 1 THEN 1 ELSE 0 END AS trashed
      FROM object_revisions WHERE object_id = ? ORDER BY revision DESC LIMIT ? OFFSET ?`).all(id, limit + 1, offset);
    return {
      revisions: rows.slice(0, limit).map(row => {
        if (typeof row.title !== 'string' || typeof row.type_id !== 'string' || !ID.test(row.type_id)) throw new AppError(500, 'Historical summary is not readable.');
        return { revision: row.revision, recordedAt: row.recorded_at, title: row.title, typeId: row.type_id, trashed: row.trashed === 1 };
      }),
      hasMore: rows.length > limit,
    };
  }
  getObjectRevision(id: string, revision: number): ObjectRecord {
    if (typeof id !== 'string' || !ID.test(id)) throw new AppError(422, 'Invalid object ID.');
    if (!Number.isSafeInteger(revision) || revision < 1) throw new AppError(422, 'Choose a historical revision.');
    this.getObject(id);
    const row = this.db.query<RevisionRow, [string, number]>('SELECT revision, snapshot_json, recorded_at FROM object_revisions WHERE object_id = ? AND revision = ?').get(id, revision);
    if (!row) throw new AppError(404, 'Historical revision not found.');
    const snapshot = snapshotRecord(row.snapshot_json);
    if (snapshot.id.toLowerCase() !== id.toLowerCase() || snapshot.revision !== revision) throw new AppError(500, 'Historical snapshot does not match this object.');
    return snapshot;
  }
  getJournal(date: string): ObjectRecord | undefined {
    if (!validDate(date)) throw new AppError(422, 'Choose a real calendar date in YYYY-MM-DD format.');
    const row = this.db.query<ObjectRow, [string]>(`SELECT * FROM objects
      WHERE type_id = '${JOURNAL_TYPE_ID}' AND json_extract(properties_json, '${JOURNAL_DATE_PATH}') = ?`).get(date);
    return row ? objectRecord(row) : undefined;
  }
  openJournal(date: string): ObjectRecord {
    return this.db.transaction(() => {
      const existing = this.getJournal(date);
      return existing ?? this.createObject({ typeId: JOURNAL_TYPE_ID, title: date, properties: { [JOURNAL_DATE_PROPERTY_ID]: date }, body: '' });
    }).immediate();
  }
  saveDayJournal(input: { date: string; body: string; requestId: string } | { date: string; body: string; objectId: string; revision: number }): ObjectRecord {
    if (!validDate(input.date)) throw new AppError(422, 'Choose a real calendar date in YYYY-MM-DD format.');
    if ('objectId' in input) {
      if (typeof input.objectId !== 'string' || !ID.test(input.objectId)) throw new AppError(422, 'Invalid daily page object.');
      return this.db.transaction(() => {
        const previous = this.getObject(input.objectId);
        revisionIs(previous.revision, input.revision);
        if (previous.trashed) throw new AppError(409, 'This daily page is in Trash. Open the existing object to restore it.');
        if (previous.typeId !== JOURNAL_TYPE_ID || previous.properties[JOURNAL_DATE_PROPERTY_ID] !== input.date) {
          throw new AppError(409, 'This daily page no longer belongs to the selected day. Reload before saving.');
        }
        return this.updateObjectFromPrevious(previous, input.revision, { typeId: JOURNAL_TYPE_ID, title: previous.title, properties: { ...previous.properties }, body: input.body });
      }).immediate();
    }
    if (!input.body.trim()) throw new AppError(422, 'Write something before saving a new journal.');
    return this.createObject({ typeId: JOURNAL_TYPE_ID, title: input.date, properties: { [JOURNAL_DATE_PROPERTY_ID]: input.date }, body: input.body }, input.requestId);
  }
  listObjects(options: ObjectListOptions = {}): ObjectRecord[] {
    const { limit, offset } = browseBounds(options);
    const shape = browseShape(options);
    if (options.typeId !== undefined) this.getType(options.typeId);
    return this.db.query<ObjectRow, (string | number)[]>(`SELECT * FROM objects WHERE ${shape.where} ORDER BY updated_at DESC, id LIMIT ? OFFSET ?`)
      .all(...shape.values, limit, offset).map(objectRecord);
  }
  listObjectSummaries(options: ObjectListOptions = {}): ObjectSummary[] {
    const { limit, offset } = browseBounds(options);
    const shape = browseShape(options);
    if (options.typeId !== undefined) this.getType(options.typeId);
    return this.db.query<ObjectSummaryRow, (string | number)[]>(`SELECT id, type_id, title, revision, created_at, updated_at, trashed FROM objects WHERE ${shape.where} ORDER BY updated_at DESC, id LIMIT ? OFFSET ?`)
      .all(...shape.values, limit, offset).map(objectSummary);
  }
  listPeople(search = '', offset = 0): BoundedPage<ViewObjectRecord> {
    browseBounds({ offset });
    const shape = browseShape({ typeId: PERSON_TYPE_ID, search });
    const rows = this.db.query<ObjectSummaryRow & { properties_json: string }, (string | number)[]>(`
      SELECT id, type_id, title, revision, created_at, updated_at, trashed, properties_json
      FROM objects WHERE ${shape.where} ORDER BY title COLLATE NOCASE, id LIMIT 51 OFFSET ?
    `).all(...shape.values, offset);
    return { items: rows.slice(0, 50).map(row => ({ ...objectSummary(row), properties: JSON.parse(row.properties_json) })), offset, hasMore: rows.length > 50 };
  }
  listDayTasks(date: string, offset = 0): BoundedPage<DayTaskSummary> {
    if (!validDate(date)) throw new AppError(422, 'Choose a real calendar date in YYYY-MM-DD format.');
    if (!Number.isInteger(offset) || offset < 0 || offset > 1_000_000) throw new AppError(422, 'Invalid task page.');
    const duePath = `$."${TASK_DUE_PROPERTY_ID}"`;
    const scheduledPath = `$."${TASK_SCHEDULED_PROPERTY_ID}"`;
    const rows = this.db.query<DayTaskRow, [string, string, string, string, string, number, number]>(`SELECT id, type_id, title, revision, created_at, updated_at, trashed,
        json_extract(properties_json, '$."${TASK_DONE_PROPERTY_ID}"') AS done,
        json_extract(properties_json, '${duePath}') AS due_date,
        json_extract(properties_json, '${scheduledPath}') AS scheduled_date,
        CASE WHEN json_extract(properties_json, '${duePath}') = ? THEN 1 ELSE 0 END AS matches_due,
        CASE WHEN json_extract(properties_json, '${scheduledPath}') = ? THEN 1 ELSE 0 END AS matches_scheduled
      FROM objects
      WHERE trashed = 0 AND type_id = ? AND (json_extract(properties_json, '${duePath}') = ? OR json_extract(properties_json, '${scheduledPath}') = ?)
      ORDER BY title COLLATE NOCASE, id LIMIT ? OFFSET ?`).all(date, date, TASK_TYPE_ID, date, date, 51, offset);
    return {
      items: rows.slice(0, 50).map(row => ({
        ...objectSummary(row),
        done: row.done === 1,
        ...(typeof row.due_date === 'string' ? { dueDate: row.due_date } : {}),
        ...(typeof row.scheduled_date === 'string' ? { scheduledDate: row.scheduled_date } : {}),
        matchesDue: row.matches_due === 1,
        matchesScheduled: row.matches_scheduled === 1,
      })),
      offset,
      hasMore: rows.length > 50,
    };
  }
  listObjectsCreatedOn(date: string, offset = 0): BoundedPage<ObjectSummary> {
    let bounds: { start: string; end: string };
    try { bounds = localDateBounds(date); } catch { throw new AppError(422, 'Choose a real calendar date in YYYY-MM-DD format.'); }
    if (!Number.isInteger(offset) || offset < 0 || offset > 1_000_000) throw new AppError(422, 'Invalid created-object page.');
    const hasFiniteEnd = !bounds.end.startsWith('+');
    const rows = this.db.query<ObjectSummaryRow, (string | number)[]>(`SELECT id, type_id, title, revision, created_at, updated_at, trashed
      FROM objects WHERE trashed = 0 AND created_at >= ?${hasFiniteEnd ? ' AND created_at < ?' : ''} ORDER BY created_at, id LIMIT ? OFFSET ?`)
      .all(...(hasFiniteEnd ? [bounds.start, bounds.end] : [bounds.start]), 51, offset);
    return { items: rows.slice(0, 50).map(objectSummary), offset, hasMore: rows.length > 50 };
  }
  listFavoriteObjects(offset = 0): BoundedPage<ObjectSummary> {
    if (!Number.isInteger(offset) || offset < 0 || offset > 1_000_000) throw new AppError(422, 'Invalid favorites page.');
    const rows = this.db.query<ObjectSummaryRow, [number, number]>(`SELECT o.id, o.type_id, o.title, o.revision, o.created_at, o.updated_at, o.trashed
      FROM object_favorites f JOIN objects o ON o.id = f.object_id WHERE o.trashed = 0 ORDER BY f.created_at, o.id LIMIT ? OFFSET ?`).all(51, offset);
    return { items: rows.slice(0, 50).map(objectSummary), offset, hasMore: rows.length > 50 };
  }
  setFavorite(id: string, favorite: boolean): void {
    if (typeof id !== 'string' || !ID.test(id)) throw new AppError(422, 'Invalid object ID.');
    if (typeof favorite !== 'boolean') throw new AppError(422, 'Invalid favorite state.');
    this.db.transaction(() => {
      const object = this.getObjectSummary(id);
      if (favorite) {
        if (object.trashed) throw new AppError(409, 'Restore this object before favoriting it.');
        this.db.query('INSERT OR IGNORE INTO object_favorites(object_id, created_at) VALUES (?, ?)').run(object.id.toLowerCase(), new Date().toISOString());
      } else {
        this.db.query('DELETE FROM object_favorites WHERE object_id = ?').run(object.id.toLowerCase());
      }
    }).immediate();
  }
  setTaskDoneForDay(id: string, revision: number, date: string, done: boolean): ObjectRecord {
    if (!validDate(date)) throw new AppError(422, 'Choose a real calendar date in YYYY-MM-DD format.');
    if (typeof done !== 'boolean') throw new AppError(422, 'Invalid completion state.');
    return this.db.transaction(() => {
      const object = this.getObject(id);
      revisionIs(object.revision, revision);
      if (object.trashed || object.typeId !== TASK_TYPE_ID) throw new AppError(409, 'This task is no longer in the selected day.');
      const due = object.properties[TASK_DUE_PROPERTY_ID];
      const scheduled = object.properties[TASK_SCHEDULED_PROPERTY_ID];
      if (due !== date && scheduled !== date) throw new AppError(409, 'This task is no longer in the selected day.');
      return this.updateObjectFromPrevious(object, revision, { ...object, properties: { ...object.properties, [TASK_DONE_PROPERTY_ID]: done } });
    }).immediate();
  }
  isFavorite(id: string): boolean {
    if (typeof id !== 'string' || !ID.test(id)) throw new AppError(422, 'Invalid object ID.');
    return Boolean(this.db.query<{ value: number }, [string]>('SELECT 1 AS value FROM object_favorites WHERE object_id = ?').get(id.toLowerCase()));
  }
  countObjectsByType(trashed = false): Record<string, number> {
    const rows = this.db.query<{ type_id: string; count: number }, [number]>(
      'SELECT type_id, COUNT(*) AS count FROM objects WHERE trashed = ? GROUP BY type_id',
    ).all(trashed ? 1 : 0);
    return Object.fromEntries(rows.map(row => [row.type_id, row.count]));
  }
  objectExcerpts(ids: string[]): Record<string, string> {
    if (ids.length > 50 || ids.some(id => !ID.test(id))) throw new AppError(422, 'Invalid object selection.');
    if (!ids.length) return {};
    const rows = this.db.query<{ id: string; excerpt: string }, string[]>(`
      SELECT id, substr(body_text, 1, 240) || CASE WHEN length(body_text) > 240 THEN '…' ELSE '' END AS excerpt
      FROM objects WHERE id IN (${ids.map(() => '?').join(',')})
    `).all(...ids);
    return Object.fromEntries(rows.map(row => [row.id, row.excerpt]));
  }
  createObject(input: ObjectWrite, requestId?: string): ObjectRecord {
    if (requestId !== undefined && (typeof requestId !== 'string' || !ID.test(requestId))) throw new AppError(422, 'Creation request ID must be a UUID.');
    return this.db.transaction(() => {
      // Check the receipt before current target state: retrying an applied request
      // cannot become a new write. Markdown source participates without normalization.
      const write = this.validateShape(input);
      const digest = requestId === undefined ? undefined : fingerprint(write);
      if (requestId !== undefined) {
        const receipt = this.db.query<{ fingerprint: string; object_id: string }, [string]>('SELECT fingerprint, object_id FROM object_create_requests WHERE request_id = ?').get(requestId.toLowerCase());
        if (receipt) {
          if (receipt.fingerprint !== digest) throw new AppError(409, 'This creation request was already used for different content.');
          return this.getObject(receipt.object_id);
        }
      }
      const writing = this.writingDerivations(write.body, true);
      this.validateValues(write, undefined, writing.links);
      const now = new Date().toISOString();
      const id = crypto.randomUUID();
      this.db.query(`INSERT INTO objects(id, type_id, title, properties_json, body, revision, created_at, updated_at, trashed, body_text)
        VALUES (?, ?, CAST(? AS TEXT), ?, CAST(? AS TEXT), 1, ?, ?, 0, CAST(? AS TEXT))`).run(id, write.typeId, Buffer.from(write.title), JSON.stringify(write.properties), Buffer.from(write.body), now, now, Buffer.from(writing.text!));
      const object = this.getObject(id);
      this.indexReferences(object, writing.links);
      if (requestId !== undefined) this.db.query('INSERT INTO object_create_requests(request_id, fingerprint, object_id) VALUES (?, ?, ?)').run(requestId.toLowerCase(), digest!, id);
      return object;
    }).immediate();
  }
  updateObject(id: string, revision: number, input: ObjectWrite): ObjectRecord {
    return this.db.transaction(() => {
      const previous = this.getObject(id);
      return this.updateObjectFromPrevious(previous, revision, input);
    }).immediate();
  }
  patchProperties(id: string, revision: number, patch: Record<string, PropertyValue | null>): ObjectRecord {
    return this.db.transaction(() => {
      const previous = this.getObject(id);
      revisionIs(previous.revision, revision);
      if (!plainObject(patch) || Object.keys(patch).length > 256) throw new AppError(422, 'Invalid property patch.');
      const properties = { ...previous.properties };
      for (const [propertyId, value] of Object.entries(patch)) {
        this.getProperty(propertyId);
        if (value === null) delete properties[propertyId]; else properties[propertyId] = value;
      }
      return this.updateObjectFromPrevious(previous, revision, { typeId: previous.typeId, title: previous.title, properties, body: previous.body });
    }).immediate();
  }
  private updateObjectFromPrevious(previous: ObjectRecord, revision: number, input: ObjectWrite): ObjectRecord {
    revisionIs(previous.revision, revision);
    const write = this.validateShape(input);
    const bodyChanged = write.body !== previous.body;
    const writing = this.writingDerivations(write.body, bodyChanged);
    this.validateValues(write, previous, writing.links);
    if (write.typeId !== previous.typeId) {
    }
    this.remember(previous);
    if (bodyChanged) {
      this.db.query(`UPDATE objects SET type_id = ?, title = CAST(? AS TEXT), properties_json = ?, body = CAST(? AS TEXT), body_text = CAST(? AS TEXT), revision = revision + 1, updated_at = ? WHERE id = ? AND revision = ?`).run(write.typeId, Buffer.from(write.title), JSON.stringify(write.properties), Buffer.from(write.body), Buffer.from(writing.text!), new Date().toISOString(), previous.id, revision);
    } else {
      this.db.query(`UPDATE objects SET type_id = ?, title = CAST(? AS TEXT), properties_json = ?, body = CAST(? AS TEXT), revision = revision + 1, updated_at = ? WHERE id = ? AND revision = ?`).run(write.typeId, Buffer.from(write.title), JSON.stringify(write.properties), Buffer.from(write.body), new Date().toISOString(), previous.id, revision);
    }
    const object = this.getObject(previous.id);
    this.indexReferences(object, writing.links, !bodyChanged);
    return object;
  }
  setTrashed(id: string, revision: number, trashed: boolean): ObjectRecord {
    if (typeof trashed !== 'boolean') throw new AppError(422, 'Invalid trash state.');
    return this.db.transaction(() => {
      const previous = this.getObject(id);
      revisionIs(previous.revision, revision);
      if (previous.trashed === trashed) return previous;
      const write = this.validateShape(previous);
      this.validateValues(write, previous, this.writingDerivations(write.body).links);
      this.remember(previous);
      this.db.query('UPDATE objects SET properties_json = ?, trashed = ?, revision = revision + 1, updated_at = ? WHERE id = ? AND revision = ?').run(JSON.stringify(write.properties), trashed ? 1 : 0, new Date().toISOString(), id, revision);
      return this.getObject(id);
    }).immediate();
  }
  backlinks(id: string, offset = 0): BacklinkPage {
    if (typeof id !== 'string' || !ID.test(id)) throw new AppError(422, 'Invalid object ID.');
    const target = this.db.query<{ id: string }, [string]>('SELECT id FROM objects WHERE id = ?').get(id);
    if (!target) throw new AppError(404, 'Object not found.');
    if (!Number.isInteger(offset) || offset < 0 || offset > 1_000_000) throw new AppError(422, 'Invalid backlinks page.');
    const limit = 50;
    const rows = this.db.query<ObjectSummaryRow, [string, number, number]>(`SELECT o.id, o.type_id, o.title, o.revision, o.created_at, o.updated_at, o.trashed
      FROM object_references r JOIN objects o ON o.id = r.source_id
      WHERE r.target_id = ? ORDER BY o.updated_at DESC, o.id LIMIT ? OFFSET ?`).all(id, limit + 1, offset);
    return {
      links: rows.slice(0, limit).map(row => ({ object: objectSummary(row) })),
      offset,
      hasMore: rows.length > limit,
    };
  }

  private validateShape(input: ObjectWrite): ObjectWrite {
    if (!plainObject(input) || typeof input.typeId !== 'string' || !ID.test(input.typeId)) throw new AppError(422, 'Choose an object type.');
    if (typeof input.title !== 'string' || !input.title.trim() || input.title.length > 500) throw new AppError(422, 'Title must contain 1–500 characters.');
    if (!plainObject(input.properties) || Object.keys(input.properties).length > 256 || JSON.stringify(input.properties).length > 262_144) throw new AppError(422, 'Invalid or oversized properties.');
    let body: string;
    try { body = validateMarkdown(input.body); } catch (error) { throw new AppError(422, error instanceof Error ? error.message : 'Invalid Markdown.'); }
    return { typeId: input.typeId, title: input.title, properties: structuredClone(input.properties) as Record<string, PropertyValue>, body };
  }
  private validateValues(write: ObjectWrite, previous?: ObjectRecord, writingLinks = this.writingDerivations(write.body).links): void {
    const type = this.getType(write.typeId);
    const allowed = new Set(type.propertyIds);
    for (const [propertyId, value] of Object.entries(write.properties)) {
      if (!allowed.has(propertyId)) throw new AppError(422, 'Submitted fields must belong to the selected domain.');
      const property = this.getProperty(propertyId);
      const error = valueError(property.kind, value);
      if (error) throw new AppError(422, `${property.label}: ${error}`);
    }
    const retained = previous?.body === write.body ? writingLinks : new Set(previous ? markdownReferences(previous.body) : []);
    for (const targetId of writingLinks) {
      const target = this.getObjectSummary(targetId);
      if (target.trashed && !retained.has(target.id.toLowerCase())) throw new AppError(422, 'Cannot add a link to a trashed object.');
    }
    this.validateBuiltinValues(write, previous);
  }
  private validateBuiltinValues(write: ObjectWrite, previous?: ObjectRecord): void {
    const has = (id: string): boolean => Object.hasOwn(write.properties, id);
    if (write.typeId === PERSON_TYPE_ID && has(PERSON_RECONNECT_EVERY_PROPERTY_ID)) {
      const months = write.properties[PERSON_RECONNECT_EVERY_PROPERTY_ID];
      if (typeof months !== 'number' || !Number.isInteger(months) || months < 1 || months > 120) {
        throw new AppError(422, 'Reconnect frequency must be a whole number of months from 1 to 120.');
      }
    }
    if (write.typeId === TASK_TYPE_ID && !has(TASK_DONE_PROPERTY_ID)) {
      write.properties[TASK_DONE_PROPERTY_ID] = false;
      if (Object.keys(write.properties).length > 256 || JSON.stringify(write.properties).length > 262_144) throw new AppError(422, 'Invalid or oversized properties.');
    }
    if (write.typeId === EVENT_TYPE_ID && has(EVENT_DATES_PROPERTY_ID) === has(EVENT_TIME_PROPERTY_ID)) {
      throw new AppError(422, 'Event requires exactly one all-day date range or timed range.');
    }
    if (write.typeId === REMINDER_TYPE_ID && has(REMINDER_DATE_PROPERTY_ID) === has(REMINDER_TIME_PROPERTY_ID)) {
      throw new AppError(422, 'Reminder requires exactly one date or time.');
    }
    if (write.typeId === JOURNAL_TYPE_ID) {
      const date = write.properties[JOURNAL_DATE_PROPERTY_ID];
      if (!validDate(date)) throw new AppError(422, 'Daily Page requires a real calendar date in YYYY-MM-DD format.');
      const existing = this.getJournal(date);
      if (existing && existing.id !== previous?.id) throw new AppError(409, `A Daily Page already exists for ${date}, including in Trash. Open the existing Daily Page instead.`);
    }
  }
  private remember(object: ObjectRecord): void {
    this.db.query('INSERT INTO object_revisions(object_id, revision, snapshot_json, recorded_at) VALUES (?, ?, ?, ?)').run(object.id, object.revision, JSON.stringify(object), new Date().toISOString());
  }
  private writingDerivations(body: string, includeText = false): WritingDerivations {
    return { links: new Set(markdownReferences(body)), ...(includeText ? { text: markdownText(body) } : {}) };
  }
  private indexReferences(object: ObjectRecord, writingLinks: Set<string>, preserveWriting = false): void {
    if (preserveWriting) return;
    this.db.query('DELETE FROM object_references WHERE source_id = ?').run(object.id);
    const insert = this.db.query('INSERT OR IGNORE INTO object_references(source_id, target_id) VALUES (?, ?)');
    if (!preserveWriting) for (const targetId of writingLinks) insert.run(object.id, targetId);
  }
}
