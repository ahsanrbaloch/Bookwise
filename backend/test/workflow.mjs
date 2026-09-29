import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

process.env.DATABASE_URL ??= 'postgres://bookwise:bookwise@localhost:5434/bookwise';
process.env.OPENAI_API_KEY = 'test-key';
const { db, DEV_USER_ID } = await import('../dist/db.js');
const { createBook, deleteBook, getBook } = await import('../dist/books.js');
const { bookInput } = await import('../dist/validation.js');
const { executeTool } = await import('../dist/agent/tools.js');
const { runAgent } = await import('../dist/agent/graph.js');
const userId = randomUUID();
const title = `Plan Test ${Date.now()}`;
const tool = (name, args) => ({ id: randomUUID(), type: 'function', function: { name, arguments: JSON.stringify(args) } });
const call = (name, args) => ({ role: 'assistant', content: null, tool_calls: [tool(name, args)] });
let book;
let missingPages;
try {
  await db.query('INSERT INTO users (id, name) VALUES ($1, $2)', [userId, 'Workflow test']);
  book = await createBook(userId, bookInput.parse({ title, author: 'Bookwise Test', pageCount: 140 }));
  missingPages = await createBook(userId, bookInput.parse({ title: `${title} no pages`, author: 'Bookwise Test' }));
  const replies = [call('getBook', { title }), call('getReadingGoals', { status: 'ACTIVE' }), call('createReadingPlan', { bookTitle: title, days: 14, startDate: '2026-10-01', startReading: true }), { role: 'assistant', content: 'Created your 14-day reading plan.' }];
  global.fetch = async () => Response.json({ choices: [{ message: replies.shift() }] });
  const result = await runAgent(userId, `Start ${title} and make a 14-day plan.`);
  assert.deepEqual(result.events.map(event => event.name), ['getBook', 'getReadingGoals', 'createReadingPlan']);
  assert.ok(result.events.every(event => event.success));
  const goals = await db.query('SELECT id, due_date FROM reading_goals WHERE user_id = $1', [userId]);
  const tasks = await db.query('SELECT title, due_date FROM reading_tasks WHERE user_id = $1 ORDER BY due_date', [userId]);
  assert.equal(goals.rows.length, 1);
  assert.equal(tasks.rows.length, 14);
  assert.match(tasks.rows[0].title, /pages 1-10$/);
  assert.match(tasks.rows[13].title, /pages 131-140$/);
  assert.equal((await getBook(userId, book.id)).status, 'CURRENTLY_READING');
  const retry = await executeTool(userId, tool('createReadingPlan', { bookTitle: title, days: 14, startDate: '2026-10-01' }));
  assert.equal(retry.result.created, false);
  assert.equal(retry.result.tasks.length, 14);
  const missing = await executeTool(userId, tool('createReadingPlan', { bookTitle: missingPages.title, days: 7, startDate: '2026-10-01' }));
  assert.equal(missing.result.success, false);
  assert.match(missing.result.error, /page count/i);
  assert.equal((await executeTool(DEV_USER_ID, tool('createReadingPlan', { bookTitle: title, days: 14 }))).result.success, false);
  console.log('Multi-step reading plan check passed');
} finally {
  await db.query('DELETE FROM reading_tasks WHERE user_id = $1', [userId]);
  await db.query('DELETE FROM reading_goals WHERE user_id = $1', [userId]);
  if (book) await deleteBook(userId, book.id);
  if (missingPages) await deleteBook(userId, missingPages.id);
  await db.query('DELETE FROM users WHERE id = $1', [userId]);
  await db.end();
}
