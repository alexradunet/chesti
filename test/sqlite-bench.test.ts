import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseArgs } from '../scripts/sqlite-bench.js';

test('sqlite benchmark CLI parsing is bounded and rejects database paths', () => {
  assert.deepEqual(parseArgs(['--objects=12', '--large-objects=20', '--body-bytes=64', '--revisions=0', '--repetitions=1', '--warmups=0']), { objects: 12, largeObjects: 20, bodyBytes: 64, revisions: 0, repetitions: 1, warmups: 0 });
  assert.throws(() => parseArgs(['--database=/tmp/nope']), /database paths are not accepted/);
});

test('benchmark bounds reject extreme inputs', () => {
  assert.throws(() => parseArgs(['--objects=1000000']), /objects must be/);
});

test('benchmark runs successfully with v7 schema', () => {
  const { collectOne } = require('../scripts/sqlite-bench.js');
  const { normalizeSyntheticFixtureOptions } = require('../scripts/sqlite-fixture.js');
  const result = collectOne('test', normalizeSyntheticFixtureOptions({ objects: 10, bodyBytes: 32, revisions: 0 }), { repetitions: 1, warmups: 0 });
  assert.ok(result.setupMs >= 0);
  assert.ok(result.scenarios.property);
  assert.ok(result.scenarios.search);
  assert.equal(result.scenarios.reference, undefined);
});
