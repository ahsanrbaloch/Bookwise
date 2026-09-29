import express from 'express';
import cors from 'cors';
import { z, ZodError } from 'zod';
import { DEV_USER_ID, db } from './db.js';
import { bookInput, bookPatch } from './validation.js';
import { createBook, dashboard, deleteBook, getBook, listBooks, updateBook } from './books.js';
import { runAgent } from './agent/graph.js';
import { buildContext } from './agent/context.js';
import { MODEL } from './agent/model.js';
import { deleteConversation, getConversationMessages, getOrCreateConversation, listConversations, saveConversationTurn } from './conversations.js';
import { forgetMemory, getMemories } from './memory.js';
import { completeTask, deleteNote, deleteQuote, deleteTask, findNotes, getHistory, getQuotes, getGoals, getStats, getTask, getTasks } from './reading.js';
import { startWeeklyReviews } from './jobs/weeklyReview.js';

const app = express();
app.use(cors({ origin: 'http://localhost:5173' }));
app.use(express.json());

// Authentication will replace this single identity; clients cannot choose a user ID.
const user = (_req: express.Request) => DEV_USER_ID;

app.get('/api/health', async (_req, res) => {
  await db.query('SELECT 1');
  res.json({ ok: true });
});
app.get('/api/dashboard', async (req, res) => res.json(await dashboard(user(req))));
app.get('/api/books', async (req, res) => {
  const filters = z.object({ status: z.enum(['WANT_TO_READ', 'CURRENTLY_READING', 'FINISHED', 'ABANDONED']).optional(), q: z.string().max(200).optional() }).parse(req.query);
  res.json(await listBooks(user(req), filters.status, filters.q));
});
app.get('/api/books/:id', async (req, res) => {
  const book = await getBook(user(req), z.uuid().parse(req.params.id));
  if (!book) return res.status(404).json({ error: 'Book not found' });
  res.json(book);
});
app.post('/api/books', async (req, res) => res.status(201).json(await createBook(user(req), bookInput.parse(req.body))));
app.patch('/api/books/:id', async (req, res) => {
  const book = await updateBook(user(req), z.uuid().parse(req.params.id), bookPatch.parse(req.body));
  if (!book) return res.status(404).json({ error: 'Book not found' });
  res.json(book);
});
app.delete('/api/books/:id', async (req, res) => {
  if (!await deleteBook(user(req), z.uuid().parse(req.params.id))) return res.status(404).json({ error: 'Book not found' });
  res.status(204).end();
});

app.get('/api/reading', async (req, res) => {
  const userId = user(req);
  const [goals, tasks, notes, quotes, history, stats] = await Promise.all([
    getGoals(userId), getTasks(userId), findNotes(userId), getQuotes(userId), getHistory(userId), getStats(userId)
  ]);
  res.json({ goals, tasks, notes, quotes, history, stats });
});
app.post('/api/tasks/:id/complete', async (req, res) => {
  const id = z.uuid().parse(req.params.id);
  const task = await completeTask(user(req), id) ?? await getTask(user(req), id);
  if (!task || task.status !== 'COMPLETED') return res.status(404).json({ error: 'Pending task not found' });
  res.json(task);
});
app.delete('/api/tasks/:id', async (req, res) => {
  if (!await deleteTask(user(req), z.uuid().parse(req.params.id))) return res.status(404).json({ error: 'Task not found' });
  res.status(204).end();
});
app.delete('/api/notes/:id', async (req, res) => {
  if (!await deleteNote(user(req), z.uuid().parse(req.params.id))) return res.status(404).json({ error: 'Note not found' });
  res.status(204).end();
});
app.delete('/api/quotes/:id', async (req, res) => {
  if (!await deleteQuote(user(req), z.uuid().parse(req.params.id))) return res.status(404).json({ error: 'Quote not found' });
  res.status(204).end();
});

app.post('/api/chat', async (req, res) => {
  const { message, conversationId } = z.object({ message: z.string().trim().min(1).max(4000), conversationId: z.uuid().nullish() }).parse(req.body);
  if (!process.env.OPENAI_API_KEY) return res.status(503).json({ error: 'Set OPENAI_API_KEY in backend/.env to use the assistant' });
  const requestId = crypto.randomUUID();
  const started = Date.now();
  try {
    const id = await getOrCreateConversation(user(req), conversationId ?? undefined, message);
    if (!id) return res.status(404).json({ error: 'Conversation not found', requestId });
    const context = await buildContext(user(req), id, message);
    const result = await runAgent(user(req), message, context.messages);
    let historySaved = true;
    try { await saveConversationTurn(user(req), id, message, result.reply); }
    catch (error) { historySaved = false; console.error('Could not save conversation turn', { requestId, conversationId: id, error }); }
    console.info('Agent request', { requestId, userId: user(req), conversationId: id, model: MODEL, memoryIds: context.selected.memories.map(item => item.id), bookIds: context.selected.books.map(item => item.id), recentMessageCount: context.recentMessageCount, tools: result.events.map(e => ({ name: e.name, success: e.success })), usage: result.usage, durationMs: Date.now() - started });
    res.json({ reply: result.reply, events: result.events, requestId, conversationId: id, historySaved,
      ...(process.env.NODE_ENV === 'production' ? {} : { debugContext: { selected: context.selected, recentMessageCount: context.recentMessageCount, toolTrace: result.toolTrace, usage: result.usage } }) });
  } catch (error) {
    console.error('Agent request failed', { requestId, userId: user(req), model: MODEL, durationMs: Date.now() - started, error });
    res.status(502).json({ error: 'The assistant could not complete this request.', requestId });
  }
});
app.get('/api/conversations', async (req, res) => res.json(await listConversations(user(req))));
app.delete('/api/conversations/:id', async (req, res) => {
  if (!await deleteConversation(user(req), z.uuid().parse(req.params.id))) return res.status(404).json({ error: 'Conversation not found' });
  res.status(204).end();
});
app.get('/api/memories', async (req, res) => res.json(await getMemories(user(req))));
app.delete('/api/memories/:id', async (req, res) => {
  if (!await forgetMemory(user(req), z.uuid().parse(req.params.id))) return res.status(404).json({ error: 'Active memory not found' });
  res.status(204).end();
});
app.get('/api/conversations/:id/messages', async (req, res) => {
  const id = z.uuid().parse(req.params.id);
  const conversation = await getOrCreateConversation(user(req), id, '');
  if (!conversation) return res.status(404).json({ error: 'Conversation not found' });
  res.json(await getConversationMessages(user(req), id, null));
});

app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (error instanceof ZodError) return res.status(400).json({ error: 'Invalid request', details: error.issues });
  if (error instanceof SyntaxError && 'status' in error && error.status === 400) return res.status(400).json({ error: 'Invalid JSON' });
  if (error instanceof Error && 'code' in error && error.code === '23505') return res.status(409).json({ error: 'Book already exists' });
  console.error(error);
  res.status(500).json({ error: 'Server error' });
});

app.listen(Number(process.env.PORT ?? 3001), () => { console.log(`Bookwise API listening on ${process.env.PORT ?? 3001}`); startWeeklyReviews(); });
