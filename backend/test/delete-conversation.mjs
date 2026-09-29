import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

process.env.DATABASE_URL ??= 'postgres://bookwise:bookwise@localhost:5434/bookwise';
const { db } = await import('../dist/db.js');
const { deleteConversation, getOrCreateConversation, listConversations, saveConversationTurn } = await import('../dist/conversations.js');
const owner = randomUUID();
const outsider = randomUUID();

try {
  await db.query('INSERT INTO users (id, name) VALUES ($1,$2),($3,$4)', [owner, 'Chat delete test', outsider, 'Other user']);
  const id = await getOrCreateConversation(owner, undefined, 'Test chat');
  await saveConversationTurn(owner, id, 'Hello', 'Hi');
  assert.equal(await deleteConversation(outsider, id), false);
  assert.equal((await listConversations(owner)).some(chat => chat.id === id), true);
  assert.equal(await deleteConversation(owner, id), true);
  assert.equal(await deleteConversation(owner, id), false);
  const messages = await db.query('SELECT count(*)::int AS count FROM messages WHERE conversation_id = $1', [id]);
  assert.equal(messages.rows[0].count, 0);
  console.log('Conversation deletion check passed');
} finally {
  await db.query('DELETE FROM conversations WHERE user_id = ANY($1::uuid[])', [[owner, outsider]]);
  await db.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [[owner, outsider]]);
  await db.end();
}
