import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

process.env.DATABASE_URL ??= 'postgres://bookwise:bookwise@localhost:5434/bookwise';
const { db } = await import('../dist/db.js');
const { createBook, deleteBook, findMentionedBooks, updateBook } = await import('../dist/books.js');
const { bookInput } = await import('../dist/validation.js');
const { getMemories, saveMemory } = await import('../dist/memory.js');
const { buildContext } = await import('../dist/agent/context.js');
const { getOrCreateConversation } = await import('../dist/conversations.js');
const { executeTool } = await import('../dist/agent/tools.js');
const userId = randomUUID();
let book;
let conversationId;

try {
  await db.query('INSERT INTO users (id, name) VALUES ($1,$2)', [userId, 'Book state test']);
  book = await createBook(userId, bookInput.parse({ title: 'To Kill a Mockingbird', author: 'Harper Lee', progress: 50, status: 'CURRENTLY_READING' }));
  await db.query(`INSERT INTO memories (user_id, subject, content, type, source)
    VALUES ($1, 'To Kill a Mockingbird progress', 'User has finished 50% of To Kill a Mockingbird', 'fact', 'chat')`, [userId]);
  const updated = await updateBook(userId, book.id, { progress: 70 });
  assert.equal(updated.progress, 70);
  assert.equal((await getMemories(userId)).length, 0);
  const old = await db.query('SELECT status FROM memories WHERE user_id = $1', [userId]);
  assert.equal(old.rows[0].status, 'SUPERSEDED');
  await db.query(`INSERT INTO memories (user_id, subject, content, type, source)
    VALUES ($1, 'Mockingbird status', 'User has finished 50% of this book', 'fact', 'legacy')`, [userId]);
  assert.equal((await getMemories(userId)).length, 0);
  await updateBook(userId, book.id, { progress: 70 });
  assert.equal((await db.query("SELECT status FROM memories WHERE user_id = $1 AND subject = 'Mockingbird status'", [userId])).rows[0].status, 'SUPERSEDED');
  assert.equal((await findMentionedBooks(userId, 'How much of mockingbird did I read?'))[0].id, book.id);
  conversationId = await getOrCreateConversation(userId, undefined, 'New chat');
  const context = await buildContext(userId, conversationId, 'How much of mockingbird did I read?');
  assert.equal(context.selected.books[0].progress, 70);
  assert.deepEqual(context.selected.memories, []);
  const bad = await executeTool(userId, { id: 'test', type: 'function', function: { name: 'saveMemory', arguments: JSON.stringify({ subject: 'Mockingbird progress', content: 'I am 50% through the book', type: 'fact' }) } });
  assert.equal(bad.result.success, false);
  assert.match(bad.result.error, /book record/i);
  const pageCall = { id: 'pages', type: 'function', function: { name: 'updateBook', arguments: JSON.stringify({ title: book.title, pageCount: 320 }) } };
  assert.equal((await executeTool(userId, pageCall, 'Create a reading plan')).result.success, false);
  assert.equal((await executeTool(userId, pageCall, 'This book has 320 pages')).result.success, true);
  await saveMemory(userId, { subject: 'reading time', content: 'I prefer reading before bed', type: 'preference' });
  assert.equal((await getMemories(userId)).length, 1);
  console.log('Book state authority check passed');
} finally {
  if (conversationId) await db.query('DELETE FROM conversations WHERE user_id = $1 AND id = $2', [userId, conversationId]);
  if (book) await deleteBook(userId, book.id);
  await db.query('DELETE FROM memories WHERE user_id = $1', [userId]);
  await db.query('DELETE FROM users WHERE id = $1', [userId]);
  await db.end();
}
