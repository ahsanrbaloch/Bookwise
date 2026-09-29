import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

process.env.DATABASE_URL ??= 'postgres://bookwise:bookwise@localhost:5434/bookwise';
const { db, DEV_USER_ID } = await import('../dist/db.js');
const { buildContext } = await import('../dist/agent/context.js');
const { createBook, deleteBook } = await import('../dist/books.js');
const { bookInput } = await import('../dist/validation.js');
const { getOrCreateConversation, getSummaryState, saveConversationTurn } = await import('../dist/conversations.js');
const { saveMemory } = await import('../dist/memory.js');
const { insertNote, insertQuote } = await import('../dist/reading.js');
const userId = randomUUID();
const title = `Context Book ${Date.now()}`;
let book;
let conversationId;
try {
  await db.query('INSERT INTO users (id, name) VALUES ($1, $2)', [userId, 'Context test']);
  book = await createBook(userId, bookInput.parse({ title, author: 'Bookwise Test', pageCount: 200 }));
  await insertNote(userId, book.id, 'Morning focus works best for difficult chapters.');
  await insertQuote(userId, book.id, 'One page at a time.');
  await saveMemory(userId, { subject: 'reading time', type: 'preference', content: 'Prefers reading in the morning' });
  await saveMemory(userId, { subject: 'tea flavor', type: 'preference', content: 'Likes mint tea' });
  conversationId = await getOrCreateConversation(userId, undefined, 'Reading plan');
  for (let i = 0; i < 7; i++) await saveConversationTurn(userId, conversationId, `Question ${i}`, `Answer ${i}`);
  assert.equal((await buildContext(userId, conversationId, 'A simple question')).recentMessageCount, 14);
  for (let i = 7; i < 13; i++) await saveConversationTurn(userId, conversationId, `Question ${i}`, `Answer ${i}`);
  let summaryCalls = 0;
  global.fetch = async () => { summaryCalls++; return Response.json({ choices: [{ message: { role: 'assistant', content: 'Earlier discussion about reading plans.' } }] }); };
  const context = await buildContext(userId, conversationId, `Make a plan to finish ${title} using my notes and morning reading time`);
  assert.equal(summaryCalls, 1);
  assert.equal(context.recentMessageCount, 12);
  assert.equal(context.selected.conversationSummary, 'Earlier discussion about reading plans.');
  assert.equal(context.selected.books[0].id, book.id);
  assert.equal(context.selected.notes.length, 1);
  assert.equal(context.selected.quotes.length, 1);
  assert.ok(context.selected.memories.some(memory => /morning/.test(memory.content)));
  assert.ok(!context.selected.memories.some(memory => /tea/.test(memory.content)));
  assert.equal((await getSummaryState(userId, conversationId)).summarizedCount, 14);
  const isolated = await buildContext(DEV_USER_ID, conversationId, `Tell me about ${title}`);
  assert.equal(isolated.selected.books.length, 0);
  assert.equal(isolated.recentMessageCount, 0);
  console.log('Context selection smoke check passed');
} finally {
  if (conversationId) await db.query('DELETE FROM conversations WHERE user_id = $1 AND id = $2', [userId, conversationId]);
  if (book) await deleteBook(userId, book.id);
  await db.query('DELETE FROM memories WHERE user_id = $1', [userId]);
  await db.query('DELETE FROM users WHERE id = $1', [userId]);
  await db.end();
}
