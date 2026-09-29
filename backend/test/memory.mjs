import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

process.env.DATABASE_URL ??= 'postgres://bookwise:bookwise@localhost:5434/bookwise';
const { db, DEV_USER_ID } = await import('../dist/db.js');
const { saveMemory, getMemories, findRelevantMemories, forgetMemory } = await import('../dist/memory.js');
const { executeTool } = await import('../dist/agent/tools.js');
const userId = randomUUID();
const call = (name, args) => executeTool(userId, { id: 'test', type: 'function', function: { name, arguments: JSON.stringify(args) } });

try {
  await db.query('INSERT INTO users (id, name) VALUES ($1, $2)', [userId, 'Memory test']);
  const first = await saveMemory(userId, { subject: 'reading time', type: 'preference', content: 'Prefers reading before bed' });
  assert.equal(first.created, true);
  assert.equal((await saveMemory(userId, { subject: 'reading time', type: 'preference', content: 'Prefers reading before bed' })).created, false);
  const updated = await saveMemory(userId, { subject: 'reading time', type: 'preference', content: 'Prefers reading in the morning' });
  assert.equal(updated.replaced, true);
  const old = await db.query('SELECT status, superseded_by FROM memories WHERE user_id = $1 AND id = $2', [userId, first.memory.id]);
  assert.equal(old.rows[0].status, 'SUPERSEDED');
  assert.equal(old.rows[0].superseded_by, updated.memory.id);
  await saveMemory(userId, { subject: 'genre', type: 'preference', content: 'Enjoys technical books with practical examples' });
  const fiction = await saveMemory(userId, { subject: 'reading preference', type: 'preference', content: 'User likes only fiction books' });
  const nonFiction = await saveMemory(userId, { subject: 'book genre preference', type: 'preference', content: 'User prefers non-fiction books now', replacesMemoryId: fiction.memory.id });
  assert.equal(nonFiction.replaced, true);
  assert.equal(nonFiction.memory.subject, 'book genre preference');
  assert.equal((await db.query('SELECT status, superseded_by FROM memories WHERE id = $1', [fiction.memory.id])).rows[0].superseded_by, nonFiction.memory.id);
  const both = await saveMemory(userId, { subject: 'preference', type: 'preference', content: 'User likes both fiction and non-fiction books', replacesMemoryId: nonFiction.memory.id });
  assert.equal(both.replaced, true);
  const latest = await saveMemory(userId, { subject: 'reading preference', type: 'preference', content: 'User likes only non-fiction books now', replacesMemoryId: both.memory.id });
  assert.equal(latest.replaced, true);
  assert.equal((await getMemories(userId)).filter(memory => /fiction/i.test(memory.content)).length, 1);
  assert.equal((await findRelevantMemories(userId, 'What sort of books do I like?')).some(memory => memory.id === latest.memory.id), true);
  const city = await saveMemory(userId, { subject: 'home city', type: 'fact', content: 'Lives in Karachi' });
  const moved = await saveMemory(userId, { subject: 'location', type: 'fact', content: 'Lives in Lahore', replacesMemoryId: city.memory.id });
  assert.equal(moved.replaced, true);
  assert.equal((await findRelevantMemories(userId, 'Where is Karachi?')).length, 0);
  await assert.rejects(saveMemory(userId, { subject: 'something else', content: 'A fact', type: 'fact', replacesMemoryId: first.memory.id }), /not found/);
  const relevant = await findRelevantMemories(userId, 'Plan my morning reading');
  assert.deepEqual(relevant.map(memory => memory.id), [updated.memory.id]);
  assert.ok(!(await getMemories(DEV_USER_ID)).some(memory => memory.id === updated.memory.id));
  assert.equal((await forgetMemory(DEV_USER_ID, updated.memory.id)), null);
  assert.equal((await call('saveMemory', { subject: '', type: 'preference', content: 'invalid' })).result.success, false);
  assert.equal((await call('forgetMemory', { memoryId: updated.memory.id })).result.success, true);
  assert.equal((await findRelevantMemories(userId, 'morning reading')).length, 0);
  console.log('Memory smoke check passed');
} finally {
  await db.query('DELETE FROM memories WHERE user_id = $1', [userId]);
  await db.query('DELETE FROM users WHERE id = $1', [userId]);
  await db.end();
}
