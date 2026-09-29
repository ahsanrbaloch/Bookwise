import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

process.env.DATABASE_URL ??= 'postgres://bookwise:bookwise@localhost:5434/bookwise';
const { db, DEV_USER_ID } = await import('../dist/db.js');
const { createBook, deleteBook, updateBook } = await import('../dist/books.js');
const { bookInput } = await import('../dist/validation.js');
const { insertGoal, updateGoal, insertNote, insertTask, completeTask } = await import('../dist/reading.js');
const { generateWeeklyReview, getLatestWeeklyReview, previousWeekStart } = await import('../dist/weeklyReview.js');
const userId = randomUUID();
const weekStart = '2026-09-14';
let book;
try {
  assert.equal(previousWeekStart('2026-09-21'), weekStart);
  assert.equal(previousWeekStart('2026-09-27'), weekStart);
  await db.query('INSERT INTO users (id, name) VALUES ($1, $2)', [userId, 'Weekly review test']);
  book = await createBook(userId, bookInput.parse({ title: `Weekly Review ${Date.now()}`, author: 'Bookwise Test', pageCount: 100 }));
  await updateBook(userId, book.id, { status: 'CURRENTLY_READING', progress: 30 });
  await updateBook(userId, book.id, { status: 'FINISHED', finishedAt: '2026-09-17' });
  await db.query(`UPDATE reading_events SET created_at = CASE WHEN new_progress = 30 THEN '2026-09-15T12:00:00Z'::timestamptz ELSE '2026-09-17T12:00:00Z'::timestamptz END
    WHERE user_id = $1 AND book_id = $2 AND new_progress > 0`, [userId, book.id]);
  await insertNote(userId, book.id, 'Review note');
  await db.query(`UPDATE notes SET created_at = '2026-09-16T12:00:00Z' WHERE user_id = $1`, [userId]);
  const goal = await insertGoal(userId, { title: 'Weekly goal', target: 1 });
  await updateGoal(userId, goal.goal.id, { status: 'COMPLETED' });
  await db.query(`UPDATE reading_goals SET updated_at = '2026-09-18T12:00:00Z' WHERE user_id = $1`, [userId]);
  const task = await insertTask(userId, { title: 'Weekly task', bookId: book.id });
  await completeTask(userId, task.task.id);
  await db.query(`UPDATE reading_tasks SET updated_at = '2026-09-18T12:00:00Z' WHERE user_id = $1`, [userId]);
  const review = await generateWeeklyReview(userId, weekStart);
  assert.deepEqual(review.metrics, { booksFinished: 1, pagesLogged: 100, readingDays: 2, notesSaved: 1, goalsCompleted: 1, tasksCompleted: 1 });
  assert.equal((await generateWeeklyReview(userId, weekStart)).id, review.id);
  assert.equal((await getLatestWeeklyReview(userId)).id, review.id);
  assert.notEqual((await getLatestWeeklyReview(DEV_USER_ID))?.id, review.id);
  console.log('Weekly review check passed');
} finally {
  await db.query('DELETE FROM weekly_reviews WHERE user_id = $1', [userId]);
  await db.query('DELETE FROM reading_tasks WHERE user_id = $1', [userId]);
  await db.query('DELETE FROM reading_goals WHERE user_id = $1', [userId]);
  if (book) await deleteBook(userId, book.id);
  await db.query('DELETE FROM users WHERE id = $1', [userId]);
  await db.end();
}
