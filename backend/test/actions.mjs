import assert from 'node:assert/strict';

process.env.DATABASE_URL ??= 'postgres://bookwise:bookwise@localhost:5434/bookwise';
const { executeTool } = await import('../dist/agent/tools.js');
const { createBook, deleteBook, getBookByTitle, updateBook } = await import('../dist/books.js');
const { bookInput } = await import('../dist/validation.js');
const { db, DEV_USER_ID } = await import('../dist/db.js');

const title = `Reading actions ${Date.now()}`;
const use = async (name, args = {}) => (await executeTool(DEV_USER_ID, { id: 'test', type: 'function', function: { name, arguments: JSON.stringify(args) } })).result;
let book;
let sameTitle;
let goalId;
let taskId;
try {
  book = await createBook(DEV_USER_ID, bookInput.parse({ title, author: 'Bookwise Test', pageCount: 200 }));
  assert.equal((await use('updateReadingProgress', { title, progress: 60 })).book.progress, 60);
  assert.equal((await getBookByTitle(DEV_USER_ID, title)).status, 'CURRENTLY_READING');
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: process.env.APP_TIME_ZONE || 'Asia/Karachi' });
  assert.equal((await getBookByTitle(DEV_USER_ID, title)).startedAt, today);
  assert.equal((await use('saveNote', { bookTitle: title, content: 'Test note', pageNumber: 12 })).success, true);
  assert.equal((await use('saveNote', { bookTitle: title, content: 'Test note', pageNumber: 12 })).created, false);
  assert.equal((await use('saveQuote', { bookTitle: title, content: 'Test quote' })).success, true);
  assert.equal((await use('saveQuote', { bookTitle: title, content: 'Test quote' })).created, false);
  assert.equal((await use('getBookNotes', { title })).notes.length, 1);
  assert.equal((await use('getBookNotes', { title, author: 'Bookwise Tset' })).book.id, book.id);
  assert.equal((await use('saveNote', { bookTitle: title, bookAuthor: 'Bookwise Tset', content: 'Saved through a unique title' })).success, true);
  const goal = await use('createReadingGoal', { title, target: 1 });
  assert.equal(goal.created, true); goalId = goal.goal.id;
  assert.equal((await use('createReadingGoal', { title, target: 1 })).created, false);
  const task = await use('createReadingTask', { title: `Read ${title}`, bookTitle: title, goalId });
  assert.equal(task.created, true); taskId = task.task.id;
  assert.equal((await use('createReadingTask', { title: `Read ${title}`, bookTitle: title, goalId })).created, false);
  assert.equal((await use('completeReadingTask', { taskId })).task.status, 'COMPLETED');
  assert.equal((await use('completeReadingTask', { taskId })).alreadyCompleted, true);
  assert.equal((await use('updateReadingGoal', { goalId, currentProgress: 1 })).goal.status, 'COMPLETED');
  assert.ok((await use('getReadingHistory')).history.some(event => event.bookTitle === title && event.newProgress === 60));
  const finished = await updateBook(DEV_USER_ID, book.id, { status: 'FINISHED', startedAt: null, finishedAt: null, progress: 0 });
  assert.equal(finished.progress, 100);
  assert.equal(finished.finishedAt, today);
  assert.ok((await use('getReadingStats')).stats.notes >= 1);
  sameTitle = await createBook(DEV_USER_ID, bookInput.parse({ title, author: 'Another Author' }));
  const ambiguous = await use('updateReadingProgress', { title, progress: 80 });
  assert.equal(ambiguous.success, false);
  assert.match(ambiguous.error, /include the author/);
  assert.equal((await use('saveNote', { bookTitle: title, bookAuthor: 'Bookwise Tset', content: 'Should be ambiguous' })).success, false);
  assert.equal((await use('updateReadingProgress', { title, author: 'Bookwise Test', progress: 80 })).book.author, 'Bookwise Test');
  const reset = (await use('updateReadingProgress', { title, author: 'Bookwise Test', progress: 0 })).book;
  assert.equal(reset.status, 'WANT_TO_READ');
  assert.equal(reset.progress, 0);
  assert.equal(reset.finishedAt, null);
  assert.equal((await use('saveNote', { bookTitle: 'Another user book', content: 'Nope' })).success, false);
  console.log('Reading actions smoke check passed');
} finally {
  if (taskId) await db.query('DELETE FROM reading_tasks WHERE user_id = $1 AND id = $2', [DEV_USER_ID, taskId]);
  if (goalId) await db.query('DELETE FROM reading_goals WHERE user_id = $1 AND id = $2', [DEV_USER_ID, goalId]);
  if (sameTitle) await deleteBook(DEV_USER_ID, sameTitle.id);
  if (book) await deleteBook(DEV_USER_ID, book.id);
}
