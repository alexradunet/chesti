import { test } from 'node:test';
import assert from 'node:assert/strict';
import { documentFromMarkdown, documentReferences, documentToMarkdown, validateDocument } from '../src/objects/document.js';

test('native writing preserves mention targets and structured saves preserve block identity', () => {
  const targetId = 'eb227f83-14b4-4e77-a3f2-bda7bc4e5d84';
  const original = validateDocument({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Discuss with ' }, { type: 'object_link', attrs: { objectId: targetId, label: 'Alex' } }] }] });
  const stable = validateDocument(original);
  assert.deepEqual(documentReferences(stable), documentReferences(original));
  assert.equal(stable.content![0]!.attrs!.blockId, original.content![0]!.attrs!.blockId);
  const nativeSave = documentFromMarkdown(documentToMarkdown(original));
  assert.deepEqual(documentReferences(nativeSave).map(link => link.targetId), [targetId]);
});

test('stored document links cannot carry executable URLs and nesting is bounded', () => {
  assert.throws(() => validateDocument({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Click', marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }] }] }] }), /Links must/);
  let nested: unknown = { type: 'paragraph' };
  for (let index = 0; index < 40; index++) nested = { type: 'blockquote', content: [nested] };
  assert.throws(() => validateDocument({ type: 'doc', content: [nested] }), /complex/);
});
