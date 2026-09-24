import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isolatedResources } from '../src/pi.js';

test('embedded Pi resource loader does not discover personal extensions, skills or context', async () => {
  const resources = isolatedResources('Submit a declarative view.');
  await resources.reload();
  assert.deepEqual(resources.getExtensions().extensions, []);
  assert.deepEqual(resources.getSkills().skills, []);
  assert.deepEqual(resources.getAgentsFiles().agentsFiles, []);
  assert.deepEqual(resources.getPrompts().prompts, []);
  assert.deepEqual(resources.getThemes().themes, []);
  assert.deepEqual(resources.getAppendSystemPrompt(), []);
});
