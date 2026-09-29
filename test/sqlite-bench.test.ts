import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseArgs } from '../scripts/sqlite-bench.js';

test('sqlite benchmark CLI parsing is bounded and rejects database paths', () => {
  assert.deepEqual(parseArgs(['--objects=12', '--large-objects=20', '--body-bytes=64', '--revisions=0', '--reference-every=2', '--repetitions=1', '--warmups=0']), { objects: 12, largeObjects: 20, bodyBytes: 64, revisions: 0, referenceEvery: 2, repetitions: 1, warmups: 0 });
  assert.throws(() => parseArgs(['--database=/tmp/nope']), /database paths are not accepted/);
});

test('benchmark bounds reject extreme inputs', () => {
  assert.throws(() => parseArgs(['--objects=1000000']), /objects must be/);
});
