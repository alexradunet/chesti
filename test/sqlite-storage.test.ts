import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSyntheticFixture, normalizeSyntheticFixtureOptions, syntheticWriting } from '../scripts/sqlite-fixture.js';
import { collectSyntheticStorageReport } from '../scripts/sqlite-storage.js';

test('synthetic writing produces exact UTF-8 byte lengths without splitting characters', () => {
  assert.equal(Buffer.byteLength(syntheticWriting(1, 128), 'utf8'), 128);
});

test('synthetic fixture creates fixed-domain objects and cleans up', () => {
  const fixture = buildSyntheticFixture({ objects: 8, bodyBytes: 32, revisions: 1 });
  try {
    assert.equal(fixture.runtime.listObjectSummaries({ limit: 20 }).length, 8);
    assert.ok(fixture.ids.length);
  } finally {
    fixture.cleanup();
  }
});

test('storage report is bounded and synthetic', () => {
  const report = collectSyntheticStorageReport(normalizeSyntheticFixtureOptions({ objects: 4, bodyBytes: 16, revisions: 0 }));
  assert.ok(report.page.allocatedBytes >= 0);
  assert.equal(report.fixture.objects, 4);
});
