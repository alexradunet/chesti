import { Database } from 'bun:sqlite';
import { existsSync, rmSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase } from '../src/database.js';
import { ObjectRuntime } from '../src/objects/runtime.js';
import { PAGE_TYPE_ID, TASK_DUE_PROPERTY_ID, TASK_TYPE_ID } from '../src/objects/model.js';
import type { ObjectRecord, PropertyValue } from '../src/objects/model.js';

export interface SyntheticFixtureOptions {
  objects?: number;
  bodyBytes?: number;
  revisions?: number;
  referenceEvery?: number;
}

export interface SyntheticFixture {
  directory: string;
  file: string;
  db: Database;
  runtime: ObjectRuntime;
  ids: string[];
  referencePropertyId: string;
  statusPropertyId: string;
  options: Required<SyntheticFixtureOptions>;
  cleanup(): void;
}

const LIMITS = {
  objects: 5_000,
  bodyBytes: 16_384,
  revisions: 10,
  referenceEvery: 1_000,
};

const utf8 = new TextEncoder();

function appendWithinUtf8Limit(body: string, text: string, bytes: number): string {
  let next = body;
  for (const char of text) {
    const candidate = next + char;
    if (utf8.encode(candidate).byteLength > bytes) break;
    next = candidate;
  }
  return next;
}

export function syntheticWriting(index: number, bytes: number, revision = 0): string {
  const prefix = `# Synthetic note ${index}\n\nRevision ${revision}. Café sample text with CRLF marker.\n\n`;
  const seed = `This is deterministic non-personal writing for storage measurement ${index}.\n`;
  let body = appendWithinUtf8Limit('', prefix, bytes);
  while (utf8.encode(body).byteLength < bytes) {
    const next = appendWithinUtf8Limit(body, seed, bytes);
    if (next === body) body += 'x'.repeat(bytes - utf8.encode(body).byteLength);
    else body = next;
  }
  return body;
}

function boundedInteger(value: unknown, name: keyof typeof LIMITS, minimum: number): number {
  if (!Number.isInteger(value) || (value as number) < minimum || (value as number) > LIMITS[name]) {
    throw new Error(`${name} must be an integer from ${minimum} to ${LIMITS[name]}.`);
  }
  return value as number;
}

export function normalizeSyntheticFixtureOptions(input: SyntheticFixtureOptions = {}): Required<SyntheticFixtureOptions> {
  return {
    objects: boundedInteger(input.objects ?? 1_000, 'objects', 1),
    bodyBytes: boundedInteger(input.bodyBytes ?? 1_024, 'bodyBytes', 0),
    revisions: boundedInteger(input.revisions ?? 2, 'revisions', 0),
    referenceEvery: boundedInteger(input.referenceEvery ?? 5, 'referenceEvery', 1),
  };
}

export function buildSyntheticFixture(input: SyntheticFixtureOptions = {}): SyntheticFixture {
  const options = normalizeSyntheticFixtureOptions(input);
  const directory = mkdtempSync(join(tmpdir(), 'taskdesk-sqlite-fixture-'));
  const file = join(directory, 'workspace.sqlite');
  let db: Database | undefined;
  try {
    db = openDatabase(file);
    const runtime = new ObjectRuntime(db);
    let pageType = runtime.getType(PAGE_TYPE_ID);
    pageType = runtime.addProperty(pageType.id, pageType.revision, { label: 'Related note', kind: 'reference', targetTypeId: PAGE_TYPE_ID });
    const referencePropertyId = pageType.propertyIds.at(-1)!;
    pageType = runtime.addProperty(pageType.id, pageType.revision, { label: 'Synthetic status', kind: 'text' });
    const statusPropertyId = pageType.propertyIds.at(-1)!;
    const ids: string[] = [];
    let lastPageId: string | undefined;
    db.transaction(() => {
      for (let index = 0; index < options.objects; index++) {
        const isTask = index % 4 === 0;
        const properties: Record<string, PropertyValue> = isTask
          ? { [TASK_DUE_PROPERTY_ID]: `2026-10-${String((index % 28) + 1).padStart(2, '0')}` }
          : { [statusPropertyId]: `batch-${index % 7}` };
        if (!isTask && lastPageId && index % options.referenceEvery === 0) properties[referencePropertyId] = lastPageId;
        let object = runtime.createObject({
          typeId: isTask ? TASK_TYPE_ID : PAGE_TYPE_ID,
          title: `Synthetic object ${String(index).padStart(5, '0')}`,
          properties,
          body: syntheticWriting(index, options.bodyBytes),
        });
        ids.push(object.id);
        if (!isTask) lastPageId = object.id;
        for (let revision = 1; revision <= options.revisions; revision++) {
          object = runtime.updateObject(object.id, object.revision, {
            typeId: object.typeId,
            title: `${object.title} r${revision}`,
            properties: object.properties,
            body: syntheticWriting(index, options.bodyBytes + (revision % 3) * 17, revision),
          });
        }
      }
    }).immediate();
    return {
      directory,
      file,
      db,
      runtime,
      ids,
      referencePropertyId,
      statusPropertyId,
      options,
      cleanup() {
        if (db) {
          db.close();
          db = undefined;
        }
        rmSync(directory, { recursive: true, force: true });
      },
    };
  } catch (error) {
    if (db) db.close();
    if (existsSync(directory)) rmSync(directory, { recursive: true, force: true });
    throw error;
  }
}
