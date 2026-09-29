import { z } from 'zod';
import { createBook, getBookByTitle, getBookByTitleAndAuthor, listBooks, updateBook } from '../books.js';
import { completeTask, createReadingPlan, findNotes, getGoal, getGoals, getHistory, getStats, getTask, getTasks, insertGoal, insertNote, insertQuote, insertTask, searchQuotes, updateGoal } from '../reading.js';
import { bookInput } from '../validation.js';
import { findRelevantMemories, forgetMemory, getMemories, saveMemory } from '../memory.js';
import type { ToolCall, ToolEvent } from './state.js';

const searchInput = z.strictObject({
  query: z.string().trim().min(1).max(200).optional(),
  status: z.enum(['WANT_TO_READ', 'CURRENTLY_READING', 'FINISHED', 'ABANDONED']).optional(),
  finishedYear: z.number().int().min(1900).max(2100).optional(),
  topic: z.string().trim().min(1).max(200).optional()
});
const getInput = z.strictObject({ title: z.string().trim().min(1).max(300), author: z.string().trim().min(1).max(300).optional() });
const addInput = z.strictObject({
  title: z.string().trim().min(1).max(300),
  author: z.string().trim().min(1).max(300),
  description: z.string().trim().max(10000).optional()
});
const title = z.string().trim().min(1).max(300);
const text = z.string().trim().min(1).max(10000);
const date = z.iso.date();
const updateInput = z.strictObject({ title, author: title.optional(), status: z.enum(['WANT_TO_READ', 'CURRENTLY_READING', 'FINISHED', 'ABANDONED']).optional(), description: text.optional(), rating: z.number().int().min(1).max(5).optional(), pageCount: z.number().int().positive().optional(), tags: z.array(z.string().trim().min(1).max(50)).max(20).optional() }).refine(value => Object.keys(value).some(key => key !== 'title' && key !== 'author'), 'Provide a field to update');
const progressInput = z.strictObject({ title, author: title.optional(), progress: z.number().int().min(0).max(100) });
const noteInput = z.strictObject({ bookTitle: title, bookAuthor: title.optional(), content: text, pageNumber: z.number().int().positive().optional(), chapter: title.optional() });
const quoteInput = z.strictObject({ bookTitle: title, bookAuthor: title.optional(), content: text, pageNumber: z.number().int().positive().optional() });
const textSearchInput = z.strictObject({ query: z.string().trim().min(1).max(200), bookTitle: title.optional(), bookAuthor: title.optional() });
const goalListInput = z.strictObject({ status: z.enum(['ACTIVE', 'COMPLETED', 'CANCELLED']).optional() });
const goalInput = z.strictObject({ title, target: z.number().int().positive(), description: text.optional(), dueDate: date.optional() });
const goalUpdateInput = z.strictObject({ goalId: z.uuid(), currentProgress: z.number().int().min(0).optional(), target: z.number().int().positive().optional(), status: z.enum(['ACTIVE', 'COMPLETED', 'CANCELLED']).optional(), dueDate: date.optional() }).refine(value => Object.keys(value).length > 1, 'Provide a field to update');
const taskListInput = z.strictObject({ status: z.enum(['PENDING', 'COMPLETED', 'CANCELLED']).optional() });
const taskInput = z.strictObject({ title, description: text.optional(), dueDate: date.optional(), bookTitle: title.optional(), bookAuthor: title.optional(), goalId: z.uuid().optional() });
const planInput = z.strictObject({ bookTitle: title, bookAuthor: title.optional(), days: z.number().int().min(1).max(31), startDate: date.optional(), startReading: z.boolean().optional() });
const taskCompleteInput = z.strictObject({ taskId: z.uuid() });
const memoryInput = z.strictObject({ subject: z.string().trim().min(1).max(80), content: z.string().trim().min(1).max(1000), type: z.enum(['preference', 'fact', 'goal', 'instruction']), replacesMemoryId: z.uuid().optional() });
const memorySearchInput = z.strictObject({ query: z.string().trim().min(1).max(300) });
const memoryForgetInput = z.strictObject({ memoryId: z.uuid() });
const emptyInput = z.strictObject({});
const definition = (name: string, description: string, schema: z.ZodType) => ({ type: 'function' as const, function: { name, description, parameters: z.toJSONSchema(schema) } });

export const toolDefinitions = [
  definition('searchBooks', 'Find books by title/author query, status, finish year, or topic. Topic matches book metadata and notes.', searchInput),
  definition('getBook', 'Get one book by exact title; include author when titles are ambiguous.', getInput),
  definition('addBook', 'Add a book with title and author; reports existing books.', addInput),
  definition('updateBook', 'Change book status, description, rating, page count, or tags by title.', updateInput),
  definition('updateReadingProgress', 'Set a book progress percentage by title.', progressInput),
  definition('searchNotes', 'Full-text search notes by keywords, optionally within a book.', textSearchInput),
  definition('searchQuotes', 'Full-text search saved quotes by keywords, optionally within a book.', textSearchInput),
  definition('getBookNotes', 'List notes for a book by exact title.', getInput),
  definition('saveNote', 'Save a note for a book.', noteInput),
  definition('saveQuote', 'Save a quote from a book.', quoteInput),
  definition('getReadingHistory', 'Get recent changes to book status and progress.', emptyInput),
  definition('getReadingGoals', 'List reading goals, optionally by status.', goalListInput),
  definition('createReadingGoal', 'Create an active reading goal; target is a count chosen by the user.', goalInput),
  definition('updateReadingGoal', 'Update a goal by ID. Get goals first when the ID is unknown.', goalUpdateInput),
  definition('getReadingTasks', 'List reading tasks, optionally by status; use this to find a task ID.', taskListInput),
  definition('createReadingTask', 'Create a reading task, optionally linked to a book or goal.', taskInput),
  definition('createReadingPlan', 'Atomically create a page-based goal and daily tasks for a book with a page count. Set startReading only when the user says they are starting the book.', planInput),
  definition('completeReadingTask', 'Mark a pending task complete by ID.', taskCompleteInput),
  definition('getReadingStats', 'Get current counts of books, notes, quotes, goals, and tasks.', emptyInput),
  definition('saveMemory', 'Save a durable memory. For a correction, find the existing memory first and pass its ID as replacesMemoryId so it is superseded even if the subject wording changed.', memoryInput),
  definition('searchMemories', 'Find relevant active long-term memories for a specific topic.', memorySearchInput),
  definition('getMemories', 'List active long-term memories when the user asks what you remember.', emptyInput),
  definition('forgetMemory', 'Forget an active memory by ID. Find the ID first.', memoryForgetInput)
];

export async function executeTool(userId: string, call: ToolCall, userRequest = ''): Promise<{ result: Record<string, unknown>; event: ToolEvent }> {
  const name = call.function.name;
  try {
    const args: unknown = JSON.parse(call.function.arguments);
    if (name === 'searchBooks') {
      const { query, status, finishedYear, topic } = searchInput.parse(args);
      const books = await listBooks(userId, status, query, finishedYear, topic);
      return { result: { success: true, books: books.slice(0, 20), total: books.length }, event: { name, success: true, summary: `Found ${books.length} book${books.length === 1 ? '' : 's'}` } };
    }
    if (name === 'getBook') {
      const { title, author } = getInput.parse(args);
      const book = await getBookByTitle(userId, title, author);
      return { result: book ? { success: true, book } : { success: false, error: 'Book not found' }, event: { name, success: Boolean(book), summary: book ? `Checked ${book.title}` : `Could not find ${title}` } };
    }
    if (name === 'addBook') {
      const { title, author, description } = addInput.parse(args);
      if (/^(yes|yeah|yep|ok|okay|sure|it|this|that)$/i.test(title) || /^(unknown|unknown author|n\/a)$/i.test(author)) {
        return { result: { success: false, error: 'A real book title and author are required' }, event: { name, success: false, summary: 'Could not add a book without a real title and author' } };
      }
      const existing = await getBookByTitleAndAuthor(userId, title, author);
      if (existing) return { result: { success: true, created: false, book: existing }, event: { name, success: true, summary: `${existing.title} is already in your library` } };
      try {
        const book = await createBook(userId, bookInput.parse({ title, author, description }));
        return { result: { success: true, created: true, book }, event: { name, success: true, summary: `Added ${book.title} to your library` } };
      } catch (error) {
        if (error instanceof Error && 'code' in error && error.code === '23505') {
          const book = await getBookByTitleAndAuthor(userId, title, author);
          if (book) return { result: { success: true, created: false, book }, event: { name, success: true, summary: `${book.title} is already in your library` } };
        }
        throw error;
      }
    }
    if (name === 'updateBook') {
      const { title, author, ...patch } = updateInput.parse(args);
      if (patch.pageCount !== undefined && !new RegExp(`(^|\\D)${patch.pageCount}(\\D|$)`).test(userRequest)) {
        return { result: { success: false, error: 'Page count must come from the user request' }, event: { name, success: false, summary: 'Could not set page count without a number supplied by you' } };
      }
      const current = await getBookByTitle(userId, title, author);
      if (!current) return { result: { success: false, error: 'Book not found' }, event: { name, success: false, summary: `Could not find ${title}` } };
      const book = await updateBook(userId, current.id, patch);
      return { result: { success: true, book }, event: { name, success: true, summary: `Updated ${book.title}` } };
    }
    if (name === 'updateReadingProgress') {
      const { title, author, progress } = progressInput.parse(args);
      const current = await getBookByTitle(userId, title, author);
      if (!current) return { result: { success: false, error: 'Book not found' }, event: { name, success: false, summary: `Could not find ${title}` } };
      const status = progress === 100 ? 'FINISHED' : progress === 0 ? 'WANT_TO_READ' : 'CURRENTLY_READING';
      const book = await updateBook(userId, current.id, { progress, status });
      return { result: { success: true, book }, event: { name, success: true, summary: `${book.title} is ${book.progress}% complete` } };
    }
    if (name === 'searchNotes' || name === 'searchQuotes') {
      const { query, bookTitle, bookAuthor } = textSearchInput.parse(args);
      const book = bookTitle ? await getBookByTitle(userId, bookTitle, bookAuthor) : null;
      if (bookTitle && !book) return { result: { success: false, error: 'Book not found' }, event: { name, success: false, summary: `Could not find ${bookTitle}` } };
      const items = name === 'searchNotes' ? await findNotes(userId, query, book?.id) : await searchQuotes(userId, query, book?.id);
      const kind = name === 'searchNotes' ? 'notes' : 'quotes';
      return { result: { success: true, [kind]: items }, event: { name, success: true, summary: `Found ${items.length} ${kind}` } };
    }
    if (name === 'getBookNotes') {
      const { title, author } = getInput.parse(args);
      const book = await getBookByTitle(userId, title, author);
      if (!book) return { result: { success: false, error: 'Book not found' }, event: { name, success: false, summary: `Could not find ${title}` } };
      const notes = await findNotes(userId, undefined, book.id);
      return { result: { success: true, book, notes }, event: { name, success: true, summary: `Found ${notes.length} note${notes.length === 1 ? '' : 's'} for ${book.title}` } };
    }
    if (name === 'saveNote' || name === 'saveQuote') {
      const input = name === 'saveNote' ? noteInput.parse(args) : quoteInput.parse(args);
      const book = await getBookByTitle(userId, input.bookTitle, input.bookAuthor);
      if (!book) return { result: { success: false, error: 'Book not found' }, event: { name, success: false, summary: `Could not find ${input.bookTitle}` } };
      const saved = name === 'saveNote' ? await insertNote(userId, book.id, input.content, input.pageNumber, noteInput.parse(args).chapter)
        : await insertQuote(userId, book.id, input.content, input.pageNumber);
      const kind = name === 'saveNote' ? 'note' : 'quote';
      return { result: { success: true, ...saved }, event: { name, success: true, summary: saved.created ? `Saved ${kind} for ${book.title}` : `${kind === 'note' ? 'Note' : 'Quote'} already saved for ${book.title}` } };
    }
    if (name === 'getReadingHistory') {
      emptyInput.parse(args);
      const history = await getHistory(userId);
      return { result: { success: true, history }, event: { name, success: true, summary: `Found ${history.length} reading event${history.length === 1 ? '' : 's'}` } };
    }
    if (name === 'getReadingGoals') {
      const { status } = goalListInput.parse(args);
      const goals = await getGoals(userId, status);
      return { result: { success: true, goals }, event: { name, success: true, summary: `Found ${goals.length} goal${goals.length === 1 ? '' : 's'}` } };
    }
    if (name === 'createReadingGoal') {
      const input = goalInput.parse(args);
      const saved = await insertGoal(userId, input);
      return { result: { success: true, ...saved }, event: { name, success: true, summary: saved.created ? `Created goal: ${saved.goal.title}` : `Goal already exists: ${saved.goal.title}` } };
    }
    if (name === 'updateReadingGoal') {
      const { goalId, ...patch } = goalUpdateInput.parse(args);
      const current = await getGoal(userId, goalId);
      if (!current) return { result: { success: false, error: 'Goal not found' }, event: { name, success: false, summary: 'Goal not found' } };
      if (patch.currentProgress !== undefined && patch.currentProgress >= (patch.target ?? current.target) && !patch.status) patch.status = 'COMPLETED';
      const goal = await updateGoal(userId, goalId, patch);
      return { result: { success: true, goal }, event: { name, success: true, summary: `Updated goal: ${goal.title}` } };
    }
    if (name === 'getReadingTasks') {
      const { status } = taskListInput.parse(args);
      const tasks = await getTasks(userId, status);
      return { result: { success: true, tasks }, event: { name, success: true, summary: `Found ${tasks.length} task${tasks.length === 1 ? '' : 's'}` } };
    }
    if (name === 'createReadingTask') {
      const { bookTitle, bookAuthor, goalId, ...input } = taskInput.parse(args);
      const book = bookTitle ? await getBookByTitle(userId, bookTitle, bookAuthor) : null;
      if (bookTitle && !book) return { result: { success: false, error: 'Book not found' }, event: { name, success: false, summary: `Could not find ${bookTitle}` } };
      const goal = goalId ? await getGoal(userId, goalId) : null;
      if (goalId && (!goal || goal.status !== 'ACTIVE')) return { result: { success: false, error: 'Active goal not found' }, event: { name, success: false, summary: 'Active goal not found' } };
      const saved = await insertTask(userId, { ...input, bookId: book?.id, goalId });
      return { result: { success: true, ...saved }, event: { name, success: true, summary: saved.created ? `Created task: ${saved.task.title}` : `Task already exists: ${saved.task.title}` } };
    }
    if (name === 'createReadingPlan') {
      const { bookTitle, bookAuthor, days, startDate, startReading } = planInput.parse(args);
      const book = await getBookByTitle(userId, bookTitle, bookAuthor);
      if (!book) return { result: { success: false, error: 'Book not found' }, event: { name, success: false, summary: `Could not find ${bookTitle}` } };
      const saved = await createReadingPlan(userId, book.id, days, startDate ?? new Date().toLocaleDateString('sv-SE', { timeZone: process.env.APP_TIME_ZONE || 'Asia/Karachi' }), startReading);
      return { result: saved, event: { name, success: saved.success, summary: saved.success ? saved.created ? `Created ${saved.tasks?.length} reading tasks and a goal for ${book.title}` : `Reading plan already exists for ${book.title}` : saved.error ?? 'Could not create reading plan' } };
    }
    if (name === 'completeReadingTask') {
      const { taskId } = taskCompleteInput.parse(args);
      const task = await completeTask(userId, taskId);
      if (task) return { result: { success: true, task }, event: { name, success: true, summary: `Completed task: ${task.title}` } };
      const current = await getTask(userId, taskId);
      return current?.status === 'COMPLETED'
        ? { result: { success: true, alreadyCompleted: true, task: current }, event: { name, success: true, summary: `Task already completed: ${current.title}` } }
        : { result: { success: false, error: 'Pending task not found' }, event: { name, success: false, summary: 'Pending task not found' } };
    }
    if (name === 'getReadingStats') {
      emptyInput.parse(args);
      const stats = await getStats(userId);
      return { result: { success: true, stats }, event: { name, success: true, summary: 'Checked reading statistics' } };
    }
    if (name === 'saveMemory') {
      const input = memoryInput.parse(args);
      const saved = await saveMemory(userId, input);
      return { result: { success: true, ...saved }, event: { name, success: true, summary: saved.replaced ? `Updated memory: ${saved.memory.subject}` : saved.created ? `Remembered ${saved.memory.subject}` : `Already remembered ${saved.memory.subject}` } };
    }
    if (name === 'searchMemories') {
      const { query } = memorySearchInput.parse(args);
      const memories = await findRelevantMemories(userId, query);
      return { result: { success: true, memories }, event: { name, success: true, summary: `Found ${memories.length} relevant memories` } };
    }
    if (name === 'getMemories') {
      emptyInput.parse(args);
      const memories = await getMemories(userId);
      return { result: { success: true, memories }, event: { name, success: true, summary: `Found ${memories.length} memories` } };
    }
    if (name === 'forgetMemory') {
      const { memoryId } = memoryForgetInput.parse(args);
      const memory = await forgetMemory(userId, memoryId);
      return { result: memory ? { success: true, memory } : { success: false, error: 'Active memory not found' }, event: { name, success: Boolean(memory), summary: memory ? `Forgot ${memory.subject}` : 'Active memory not found' } };
    }
    return { result: { success: false, error: 'Unknown tool' }, event: { name, success: false, summary: 'Unknown tool requested' } };
  } catch (error) {
    const ambiguous = error instanceof Error && error.message === 'Multiple books have that title; include the author';
    const knownMemoryError = error instanceof Error && ['Book progress and status belong in the book record; use the book tools instead', 'Memory to replace was not found'].includes(error.message);
    const reason = error instanceof z.ZodError ? error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`).join('; ') : error instanceof SyntaxError ? 'Invalid JSON arguments' : ambiguous || knownMemoryError ? error.message : 'Tool execution failed';
    if (!(error instanceof z.ZodError || error instanceof SyntaxError || ambiguous || knownMemoryError)) console.error('Agent tool failed', { name, error });
    return { result: { success: false, error: reason }, event: { name, success: false, summary: `${name} failed: ${reason}` } };
  }
}
