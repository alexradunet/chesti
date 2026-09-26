import { test } from 'node:test';
import assert from 'node:assert/strict';
import { restoreAiState, type AiState } from '../src/objects/ai-state.js';

const fresh: AiState = { open: true, draft: '', contextTitle: 'New view' };
const thread: AiState = { open: false, draft: '  Unsent A\n', conversationId: 'thread-A', previousId: 'view-A', contextTitle: 'A' };

test('ordinary navigation preserves the tab conversation, target, and exact draft', () => {
  const page = { ...fresh, open: false, previousId: 'view-B', contextTitle: 'B' };
  assert.deepEqual(restoreAiState(page, thread, 'browse'), thread);
  assert.deepEqual(restoreAiState(fresh, thread, 'browse'), { ...thread, open: true });
});

test('explicit refinement does not import another thread or its draft', () => {
  const request = { ...fresh, previousId: 'view-B', contextTitle: 'B' };
  assert.deepEqual(restoreAiState(request, thread, 'explicit'), request);
  assert.deepEqual(restoreAiState(request, { ...thread, previousId: 'view-B' }, 'explicit'), request);
  const saved = { open: false, draft: '  \n', previousId: 'view-B', contextTitle: 'Old title' };
  assert.deepEqual(restoreAiState(request, saved, 'explicit'), { ...request, draft: '  \n' });
});

test('explicit new entry keeps only an unthreaded new-view draft', () => {
  assert.deepEqual(restoreAiState(fresh, thread, 'explicit'), fresh);
  assert.deepEqual(restoreAiState(fresh, { ...fresh, previousId: 'view-A', draft: 'Refine A' }, 'explicit'), fresh);
  assert.deepEqual(restoreAiState(fresh, { ...fresh, draft: '  ' }, 'explicit'), { ...fresh, draft: '  ' });
});

test('explicit conversation restores only that thread draft and keeps request context', () => {
  const request = { ...fresh, conversationId: 'thread-B', contextTitle: 'B' };
  assert.deepEqual(restoreAiState(request, thread, 'explicit'), request);
  assert.deepEqual(restoreAiState(request, { ...thread, conversationId: 'thread-B' }, 'explicit'), { ...request, draft: thread.draft });
});

test('rejected submissions own empty, whitespace, and nonempty prompts and context', () => {
  for (const draft of ['', '  \n', 'Rejected prompt']) {
    const request = { ...fresh, draft, previousId: 'view-B', contextTitle: 'B' };
    assert.deepEqual(restoreAiState(request, thread, 'submitted'), request);
  }
  assert.deepEqual(restoreAiState({ ...fresh, draft: ' ' }, thread, 'browse'), { ...fresh, draft: ' ' });
});

test('invalid tab storage leaves the native request intact', () => {
  for (const stored of [null, [], 'bad', { ...thread, open: 'yes' }, { ...thread, draft: null }, { ...thread, previousId: 1 }, { ...thread, conversationId: {} }, { ...thread, contextTitle: false }]) {
    assert.deepEqual(restoreAiState(fresh, stored, 'browse'), fresh);
  }
});
