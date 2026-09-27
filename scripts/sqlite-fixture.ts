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
  benchmarkProperties?: boolean;
  benchmarkDense?: boolean;
}

export interface SyntheticFixture {
  directory: string;
  file: string;
  db: Database;
  runtime: ObjectRuntime;
  ids: string[];
  referencePropertyId: string;
  multiReferencePropertyId: string;
  scheduledPropertyId: string;
  rareTypeId: string;
  options: Required<SyntheticFixtureOptions>;
  cleanup(): void;
}

const LIMITS = {
  objects: 10_000,
  bodyBytes: 16_384,
  revisions: 10,
  referenceEvery: 1_000,
};

function appendWithinUtf8Limit(parts: string[], text: string, budget: number, used: number): number {
  let nextUsed = used;
  for (const char of text) {
    const charBytes = Buffer.byteLength(char, 'utf8');
    if (nextUsed + charBytes > budget) break;
    parts.push(char);
    nextUsed += charBytes;
  }
  return nextUsed;
}

export function syntheticWriting(index: number, bytes: number, revision = 0): string {
  const prefix = `# Synthetic note ${index}\n\nRevision ${revision}. Café sample text with CRLF marker.\n\n`;
  const seed = `This is deterministic non-personal writing for storage measurement ${index}.\n`;
  const parts: string[] = [];
  let used = appendWithinUtf8Limit(parts, prefix, bytes, 0);
  while (used < bytes) {
    const nextUsed = appendWithinUtf8Limit(parts, seed, bytes, used);
    if (nextUsed === used) break;
    used = nextUsed;
  }
  if (used < bytes) parts.push('x'.repeat(bytes - used));
  return parts.join('');
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
    benchmarkProperties: input.benchmarkProperties === true,
    benchmarkDense: input.benchmarkProperties === true && input.benchmarkDense === true,
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
    let multiReferencePropertyId = '';
    let scheduledPropertyId = '';
    let rareTypeId = '';
    if (options.benchmarkProperties) {
      pageType = runtime.addProperty(pageType.id, pageType.revision, { label: 'Related notes', kind: 'reference', targetTypeId: PAGE_TYPE_ID, multiple: true });
      multiReferencePropertyId = pageType.propertyIds.at(-1)!;
      pageType = runtime.addProperty(pageType.id, pageType.revision, { label: 'Synthetic scheduled', kind: 'date' });
      scheduledPropertyId = pageType.propertyIds.at(-1)!;
      const rareType = runtime.createType('Synthetic rare page', PAGE_TYPE_ID);
      rareTypeId = rareType.id;
    }
    const ids: string[] = [];
    const pageIds: string[] = [];
    let lastPageId: string | undefined;
    db.transaction(() => {
      for (let index = 0; index < options.objects; index++) {
        const isTask = index % 4 === 0;
        const isRare = options.benchmarkProperties && !isTask && index % 97 === 1;
        const properties: Record<string, PropertyValue> = isTask
          ? { [TASK_DUE_PROPERTY_ID]: `2026-10-${String((index % 28) + 1).padStart(2, '0')}` }
          : options.benchmarkProperties
            ? {
                [scheduledPropertyId]: isRare || index % 53 === 3 ? '2026-11-28' : `2026-11-${String((index % 28) + 1).padStart(2, '0')}`,
              }
            : {};
        if (!isTask && lastPageId && index % options.referenceEvery === 0) properties[referencePropertyId] = lastPageId;
        if (options.benchmarkProperties && !isTask && pageIds.length >= 2 && (options.benchmarkDense || index % options.referenceEvery === 0)) {
          const referenceCount = options.benchmarkDense ? Math.min(12, pageIds.length) : 2;
          const recentTargets = pageIds.slice(Math.max(0, pageIds.length - (referenceCount - 1)));
          properties[multiReferencePropertyId] = [pageIds[0]!, ...recentTargets].slice(0, referenceCount);
        }
        let object = runtime.createObject({
          typeId: isTask ? TASK_TYPE_ID : isRare ? rareTypeId : PAGE_TYPE_ID,
          title: `${isRare ? 'Rare synthetic object' : 'Synthetic object'} ${String(index).padStart(5, '0')}`,
          properties,
          body: syntheticWriting(index, options.bodyBytes),
        });
        ids.push(object.id);
        if (!isTask && !isRare) {
          lastPageId = object.id;
          pageIds.push(object.id);
        }
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
    if (options.benchmarkProperties) {
      for (let index = 22; index < ids.length; index += 23) {
        const object = runtime.getObject(ids[index]!);
        runtime.setTrashed(object.id, object.revision, true);
      }
    }
    return {
      directory,
      file,
      db,
      runtime,
      ids,
      referencePropertyId,
      multiReferencePropertyId,
      scheduledPropertyId,
      rareTypeId,
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
