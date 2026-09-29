import { db } from './db.js';
import { retireBookStateMemories } from './memory.js';

export async function findNotes(userId: string, query?: string, bookId?: string) {
  const result = await db.query(`SELECT n.id, n.book_id AS "bookId", b.title AS "bookTitle", n.content, n.page_number AS "pageNumber", n.chapter, n.created_at AS "createdAt"
    FROM notes n JOIN books b ON b.id = n.book_id AND b.user_id = n.user_id
    WHERE n.user_id = $1 AND ($2::text IS NULL OR to_tsvector('english', n.content || ' ' || coalesce(n.chapter, '')) @@ websearch_to_tsquery('english', $2))
      AND ($3::uuid IS NULL OR n.book_id = $3)
    ORDER BY CASE WHEN $2::text IS NULL THEN 0 ELSE ts_rank(to_tsvector('english', n.content || ' ' || coalesce(n.chapter, '')), websearch_to_tsquery('english', $2)) END DESC,
      n.created_at DESC LIMIT 30`, [userId, query ?? null, bookId ?? null]);
  return result.rows;
}

export async function searchQuotes(userId: string, query: string, bookId?: string) {
  const result = await db.query(`SELECT q.id, q.book_id AS "bookId", b.title AS "bookTitle", q.content, q.page_number AS "pageNumber", q.created_at AS "createdAt"
    FROM quotes q JOIN books b ON b.id = q.book_id AND b.user_id = q.user_id
    WHERE q.user_id = $1 AND to_tsvector('english', q.content) @@ websearch_to_tsquery('english', $2)
      AND ($3::uuid IS NULL OR q.book_id = $3)
    ORDER BY ts_rank(to_tsvector('english', q.content), websearch_to_tsquery('english', $2)) DESC, q.created_at DESC LIMIT 30`,
    [userId, query, bookId ?? null]);
  return result.rows;
}

export async function insertNote(userId: string, bookId: string, content: string, pageNumber?: number, chapter?: string) {
  const result = await db.query(`INSERT INTO notes (user_id, book_id, content, page_number, chapter) VALUES ($1,$2,$3,$4,$5)
    ON CONFLICT DO NOTHING
    RETURNING id, book_id AS "bookId", content, page_number AS "pageNumber", chapter, created_at AS "createdAt"`,
    [userId, bookId, content, pageNumber ?? null, chapter ?? null]);
  if (result.rows[0]) return { created: true, note: result.rows[0] };
  const existing = await db.query(`SELECT id, book_id AS "bookId", content, page_number AS "pageNumber", chapter, created_at AS "createdAt" FROM notes
    WHERE user_id = $1 AND book_id = $2 AND lower(btrim(content)) = lower(btrim($3)) AND page_number IS NOT DISTINCT FROM $4::integer
      AND coalesce(lower(btrim(chapter)), '') = coalesce(lower(btrim($5::text)), '')`, [userId, bookId, content, pageNumber ?? null, chapter ?? null]);
  return { created: false, note: existing.rows[0] };
}

export async function insertQuote(userId: string, bookId: string, content: string, pageNumber?: number) {
  const result = await db.query(`INSERT INTO quotes (user_id, book_id, content, page_number) VALUES ($1,$2,$3,$4)
    ON CONFLICT DO NOTHING
    RETURNING id, book_id AS "bookId", content, page_number AS "pageNumber", created_at AS "createdAt"`,
    [userId, bookId, content, pageNumber ?? null]);
  if (result.rows[0]) return { created: true, quote: result.rows[0] };
  const existing = await db.query(`SELECT id, book_id AS "bookId", content, page_number AS "pageNumber", created_at AS "createdAt" FROM quotes
    WHERE user_id = $1 AND book_id = $2 AND lower(btrim(content)) = lower(btrim($3)) AND page_number IS NOT DISTINCT FROM $4::integer`,
    [userId, bookId, content, pageNumber ?? null]);
  return { created: false, quote: existing.rows[0] };
}

export async function getQuotes(userId: string, bookId?: string) {
  const result = await db.query(`SELECT q.id, q.book_id AS "bookId", b.title AS "bookTitle", q.content, q.page_number AS "pageNumber", q.created_at AS "createdAt"
    FROM quotes q JOIN books b ON b.id = q.book_id AND b.user_id = q.user_id
    WHERE q.user_id = $1 AND ($2::uuid IS NULL OR q.book_id = $2) ORDER BY q.created_at DESC LIMIT 30`, [userId, bookId ?? null]);
  return result.rows;
}

export async function deleteNote(userId: string, id: string) {
  const result = await db.query('DELETE FROM notes WHERE user_id = $1 AND id = $2 RETURNING id', [userId, id]);
  return Boolean(result.rows[0]);
}

export async function deleteQuote(userId: string, id: string) {
  const result = await db.query('DELETE FROM quotes WHERE user_id = $1 AND id = $2 RETURNING id', [userId, id]);
  return Boolean(result.rows[0]);
}

export async function getHistory(userId: string) {
  const result = await db.query(`SELECT e.id, b.title AS "bookTitle", e.old_status AS "oldStatus", e.new_status AS "newStatus",
    e.old_progress AS "oldProgress", e.new_progress AS "newProgress", e.created_at AS "createdAt"
    FROM reading_events e JOIN books b ON b.id = e.book_id AND b.user_id = e.user_id
    WHERE e.user_id = $1 ORDER BY e.created_at DESC LIMIT 30`, [userId]);
  return result.rows;
}

export async function getGoals(userId: string, status?: string) {
  const result = await db.query(`SELECT id, title, description, target, current_progress AS "currentProgress", due_date AS "dueDate", status, created_at AS "createdAt", updated_at AS "updatedAt"
    FROM reading_goals WHERE user_id = $1 AND ($2::text IS NULL OR status = $2) ORDER BY created_at DESC LIMIT 50`, [userId, status ?? null]);
  return result.rows;
}

export async function getGoal(userId: string, id: string) {
  const result = await db.query('SELECT id, title, target, status FROM reading_goals WHERE user_id = $1 AND id = $2', [userId, id]);
  return result.rows[0] ?? null;
}

export async function insertGoal(userId: string, input: { title: string; target: number; description?: string; dueDate?: string }) {
  const result = await db.query(`INSERT INTO reading_goals (user_id, title, target, description, due_date) VALUES ($1,$2,$3,$4,$5)
    ON CONFLICT (user_id, lower(btrim(title)), coalesce(due_date, 'infinity'::date)) WHERE status = 'ACTIVE' DO NOTHING
    RETURNING id, title, description, target, current_progress AS "currentProgress", due_date AS "dueDate", status`,
    [userId, input.title, input.target, input.description ?? null, input.dueDate ?? null]);
  if (result.rows[0]) return { created: true, goal: result.rows[0] };
  const existing = await db.query(`SELECT id, title, description, target, current_progress AS "currentProgress", due_date AS "dueDate", status
    FROM reading_goals WHERE user_id = $1 AND lower(btrim(title)) = lower(btrim($2)) AND due_date IS NOT DISTINCT FROM $3::date AND status = 'ACTIVE'`,
    [userId, input.title, input.dueDate ?? null]);
  return { created: false, goal: existing.rows[0] };
}

export async function updateGoal(userId: string, id: string, input: { currentProgress?: number; status?: string; target?: number; dueDate?: string }) {
  const entries = Object.entries(input);
  const column: Record<string, string> = { currentProgress: 'current_progress', status: 'status', target: 'target', dueDate: 'due_date' };
  const result = await db.query(`UPDATE reading_goals SET ${entries.map(([key], i) => `${column[key]} = $${i + 3}`).join(', ')}, updated_at = now()
    WHERE user_id = $1 AND id = $2 RETURNING id, title, description, target, current_progress AS "currentProgress", due_date AS "dueDate", status`,
    [userId, id, ...entries.map(([, value]) => value)]);
  return result.rows[0] ?? null;
}

export async function getTasks(userId: string, status?: string) {
  const result = await db.query(`SELECT t.id, t.book_id AS "bookId", b.title AS "bookTitle", t.goal_id AS "goalId", t.title, t.description,
    t.due_date AS "dueDate", t.status, t.created_at AS "createdAt", t.updated_at AS "updatedAt"
    FROM reading_tasks t LEFT JOIN books b ON b.id = t.book_id AND b.user_id = t.user_id
    WHERE t.user_id = $1 AND ($2::text IS NULL OR t.status = $2) ORDER BY t.due_date NULLS LAST, t.created_at DESC LIMIT 50`, [userId, status ?? null]);
  return result.rows;
}

export async function insertTask(userId: string, input: { title: string; description?: string; dueDate?: string; bookId?: string; goalId?: string }) {
  const result = await db.query(`INSERT INTO reading_tasks (user_id, title, description, due_date, book_id, goal_id) VALUES ($1,$2,$3,$4,$5,$6)
    ON CONFLICT (user_id, lower(btrim(title)), coalesce(due_date, 'infinity'::date)) WHERE status = 'PENDING' DO NOTHING
    RETURNING id, title, description, due_date AS "dueDate", book_id AS "bookId", goal_id AS "goalId", status`,
    [userId, input.title, input.description ?? null, input.dueDate ?? null, input.bookId ?? null, input.goalId ?? null]);
  if (result.rows[0]) return { created: true, task: result.rows[0] };
  const existing = await db.query(`SELECT id, title, description, due_date AS "dueDate", book_id AS "bookId", goal_id AS "goalId", status
    FROM reading_tasks WHERE user_id = $1 AND lower(btrim(title)) = lower(btrim($2)) AND due_date IS NOT DISTINCT FROM $3::date AND status = 'PENDING'`,
    [userId, input.title, input.dueDate ?? null]);
  return { created: false, task: existing.rows[0] };
}

export async function completeTask(userId: string, id: string) {
  const result = await db.query(`UPDATE reading_tasks SET status = 'COMPLETED', updated_at = now()
    WHERE user_id = $1 AND id = $2 AND status = 'PENDING' RETURNING id, title, status`, [userId, id]);
  return result.rows[0] ?? null;
}

export async function getTask(userId: string, id: string) {
  const result = await db.query('SELECT id, title, status FROM reading_tasks WHERE user_id = $1 AND id = $2', [userId, id]);
  return result.rows[0] ?? null;
}

export async function deleteTask(userId: string, id: string) {
  const result = await db.query('DELETE FROM reading_tasks WHERE user_id = $1 AND id = $2 RETURNING id', [userId, id]);
  return Boolean(result.rows[0]);
}

export async function getStats(userId: string) {
  const result = await db.query(`SELECT
    (SELECT count(*)::int FROM books WHERE user_id = $1) AS "totalBooks",
    (SELECT count(*)::int FROM books WHERE user_id = $1 AND status = 'FINISHED') AS "finishedBooks",
    (SELECT count(*)::int FROM books WHERE user_id = $1 AND status = 'CURRENTLY_READING') AS "currentBooks",
    (SELECT count(*)::int FROM notes WHERE user_id = $1) AS "notes",
    (SELECT count(*)::int FROM quotes WHERE user_id = $1) AS "quotes",
    (SELECT count(*)::int FROM reading_goals WHERE user_id = $1 AND status = 'ACTIVE') AS "activeGoals",
    (SELECT count(*)::int FROM reading_tasks WHERE user_id = $1 AND status = 'PENDING') AS "pendingTasks"`, [userId]);
  return result.rows[0];
}

export async function createReadingPlan(userId: string, bookId: string, days: number, startDate: string, startReading = false) {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const found = await client.query(`SELECT id, title, page_count AS "pageCount", progress, status FROM books
      WHERE user_id = $1 AND id = $2 FOR UPDATE`, [userId, bookId]);
    const book = found.rows[0];
    if (!book) { await client.query('ROLLBACK'); return { success: false, error: 'Book not found' }; }
    if (!book.pageCount) { await client.query('ROLLBACK'); return { success: false, error: 'Add a page count before creating a page-based plan' }; }
    if (book.status === 'FINISHED' || book.progress >= 100) { await client.query('ROLLBACK'); return { success: false, error: 'Book is already finished' }; }
    const day = (offset: number) => new Date(Date.parse(`${startDate}T00:00:00Z`) + offset * 86400000).toISOString().slice(0, 10);
    const dueDate = day(days - 1);
    const goalTitle = `Finish ${book.title}`;
    const completedPages = Math.floor(book.pageCount * book.progress / 100);
    const remainingPages = book.pageCount - completedPages;
    const goalResult = await client.query(`INSERT INTO reading_goals (user_id, title, target, description, due_date)
      VALUES ($1,$2,1,$3,$4)
      ON CONFLICT (user_id, lower(btrim(title)), coalesce(due_date, 'infinity'::date)) WHERE status = 'ACTIVE' DO NOTHING
      RETURNING id, title, target, due_date AS "dueDate", status`, [userId, goalTitle, `Read ${remainingPages} remaining pages over ${days} days.`, dueDate]);
    const created = Boolean(goalResult.rows[0]);
    const goal = goalResult.rows[0] ?? (await client.query(`SELECT id, title, target, due_date AS "dueDate", status FROM reading_goals
      WHERE user_id = $1 AND lower(btrim(title)) = lower(btrim($2)) AND due_date = $3 AND status = 'ACTIVE'`, [userId, goalTitle, dueDate])).rows[0];
    if (startReading && book.status !== 'CURRENTLY_READING') {
      await client.query(`UPDATE books SET status = 'CURRENTLY_READING', started_at = coalesce(started_at, $3::date), finished_at = NULL, updated_at = now()
        WHERE user_id = $1 AND id = $2`, [userId, bookId, startDate]);
      await retireBookStateMemories(client, userId, book.title);
    }
    if (created) {
      const pagesPerDay = Math.ceil(remainingPages / days);
      for (let i = 0; i < days; i++) {
        const from = completedPages + i * pagesPerDay + 1;
        if (from > book.pageCount) break;
        const to = Math.min(book.pageCount, from + pagesPerDay - 1);
        await client.query(`INSERT INTO reading_tasks (user_id, book_id, goal_id, title, description, due_date)
          VALUES ($1,$2,$3,$4,$5,$6)`, [userId, bookId, goal.id, `Read ${book.title}: pages ${from}-${to}`, `Read pages ${from} through ${to}.`, day(i)]);
      }
    }
    const tasks = await client.query(`SELECT id, title, due_date AS "dueDate", status FROM reading_tasks
      WHERE user_id = $1 AND goal_id = $2 ORDER BY due_date`, [userId, goal.id]);
    await client.query('COMMIT');
    return { success: true, created, book: { id: book.id, title: book.title, pageCount: book.pageCount, progress: book.progress }, goal, tasks: tasks.rows };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
}
