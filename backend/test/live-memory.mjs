import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

const { db } = await import('../dist/db.js');
const { runAgent } = await import('../dist/agent/graph.js');
const { getMemories } = await import('../dist/memory.js');
const userId = randomUUID();
try {
  await db.query('INSERT INTO users (id, name) VALUES ($1, $2)', [userId, 'Memory live test']);
  const result = await runAgent(userId, 'Remember that I prefer reading before bed.');
  assert.ok(result.events.some(event => event.name === 'saveMemory' && event.success), JSON.stringify(result));
  assert.ok((await getMemories(userId)).some(memory => /before bed/i.test(memory.content)));
  console.log('Live memory check passed');
} finally {
  await db.query('DELETE FROM memories WHERE user_id = $1', [userId]);
  await db.query('DELETE FROM users WHERE id = $1', [userId]);
  await db.end();
}
