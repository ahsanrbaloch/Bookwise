import { mkdir, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { cases } from './cases.mjs';

const { db } = await import('../dist/db.js');
const { MODEL } = await import('../dist/agent/model.js');
const { runAgent } = await import('../dist/agent/graph.js');
const { buildContext } = await import('../dist/agent/context.js');
const { createBook } = await import('../dist/books.js');
const { bookInput } = await import('../dist/validation.js');
const { insertNote } = await import('../dist/reading.js');
const { saveMemory } = await import('../dist/memory.js');
const { getOrCreateConversation } = await import('../dist/conversations.js');

const selectedCases = process.argv[2] ? cases.filter(item => item.id === process.argv[2]) : cases;
if (!selectedCases.length) throw new Error(`Unknown case: ${process.argv[2]}`);
const results = [];

async function cleanUser(userId) {
  await db.query('DELETE FROM weekly_reviews WHERE user_id = $1', [userId]);
  await db.query('DELETE FROM reading_tasks WHERE user_id = $1', [userId]);
  await db.query('DELETE FROM reading_goals WHERE user_id = $1', [userId]);
  await db.query('DELETE FROM conversations WHERE user_id = $1', [userId]);
  await db.query('DELETE FROM memories WHERE user_id = $1', [userId]);
  await db.query('DELETE FROM books WHERE user_id = $1', [userId]);
  await db.query('DELETE FROM users WHERE id = $1', [userId]);
}

for (const item of selectedCases) {
  const userId = randomUUID();
  const privateUsers = [];
  let started = Date.now();
  let record = { id: item.id, mode: item.mode ?? 'live', input: item.input, expectedBehavior: item.expected, toolsExpected: item.expectedTools, toolsActuallyUsed: [], retrievedContext: null, result: null, latencyMs: 0, errors: [], passed: false };
  try {
    await db.query('INSERT INTO users (id, name) VALUES ($1, $2)', [userId, 'Evaluation reader']);
    const h = {
      userId,
      db,
      book: input => createBook(userId, bookInput.parse(input)),
      note: (book, content) => insertNote(userId, book.id, content),
      memory: (subject, content) => saveMemory(userId, { subject, content, type: 'preference' }),
      privateBook: async input => {
        const id = randomUUID();
        await db.query('INSERT INTO users (id, name) VALUES ($1, $2)', [id, 'Other evaluation reader']);
        privateUsers.push(id);
        return createBook(id, bookInput.parse(input));
      },
      count: async (table, where = '') => Number((await db.query(`SELECT count(*)::int AS count FROM ${table} WHERE user_id = $1 ${where ? `AND ${where}` : ''}`, [userId])).rows[0].count),
      row: async (sql, args = []) => (await db.query(sql, [userId, ...args])).rows[0] ?? null
    };
    await item.seed(h);
    const conversationId = await getOrCreateConversation(userId, undefined, item.input);
    started = Date.now();
    const context = await buildContext(userId, conversationId, item.input);
    record.retrievedContext = { selected: context.selected, recentMessageCount: context.recentMessageCount };
    let actual;
    if (item.mode === 'scriptedToolFailure') {
      const originalFetch = global.fetch;
      const replies = [
        { role: 'assistant', content: null, tool_calls: [{ id: randomUUID(), type: 'function', function: { name: 'createReadingPlan', arguments: JSON.stringify({ bookTitle: 'Deep Work', days: 7, startDate: '2026-10-01' }) } }] },
        { role: 'assistant', content: 'Done, I created your plan.' }
      ];
      global.fetch = async () => Response.json({ choices: [{ message: replies.shift() }] });
      try { actual = await runAgent(userId, item.input, context.messages); }
      finally { global.fetch = originalFetch; }
    } else actual = await runAgent(userId, item.input, context.messages);
    record.toolsActuallyUsed = actual.events.map(event => event.name);
    record.result = { reply: actual.reply, toolEvents: actual.events, toolTrace: actual.toolTrace, usage: actual.usage };
    record.errors = actual.events.filter(event => !event.success).map(event => event.summary);
    record.passed = Boolean(await item.check(h, actual, context));
    record.toolMatch = item.expectedTools.every(name => record.toolsActuallyUsed.includes(name));
  } catch (error) {
    record.errors.push(error instanceof Error ? error.message : String(error));
  } finally {
    record.latencyMs = Date.now() - started;
    results.push(record);
    try { await cleanUser(userId); for (const id of privateUsers) await cleanUser(id); }
    catch (error) { record.errors.push(`Cleanup failed: ${error instanceof Error ? error.message : String(error)}`); record.passed = false; }
    console.log(`${record.passed ? 'PASS' : 'FAIL'} ${item.id} (${record.latencyMs} ms)`);
  }
}

await mkdir(new URL('./results/', import.meta.url), { recursive: true });
await writeFile(new URL('./results/latest.json', import.meta.url), JSON.stringify({ runAt: new Date().toISOString(), model: MODEL, cases: results }, null, 2));
await db.end();
console.log(`${results.filter(item => item.passed).length}/${results.length} cases passed; details in evaluation/results/latest.json`);
if (results.some(item => !item.passed)) process.exitCode = 1;
