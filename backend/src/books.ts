import { db } from './db.js';
import type { BookInput } from './validation.js';
import { getLatestWeeklyReview } from './weeklyReview.js';
import { retireBookStateMemories } from './memory.js';

const fields = ['id', 'user_id AS "userId"', 'title', 'author', 'description', 'cover_image_url AS "coverImageUrl"', 'page_count AS "pageCount"', 'status', 'progress', 'rating', 'tags', 'started_at AS "startedAt"', 'finished_at AS "finishedAt"', 'created_at AS "createdAt"', 'updated_at AS "updatedAt"'].join(', ');
const columns: Record<keyof BookInput, string> = {
  title: 'title', author: 'author', description: 'description', coverImageUrl: 'cover_image_url',
  pageCount: 'page_count', status: 'status', progress: 'progress', rating: 'rating',
  tags: 'tags', startedAt: 'started_at', finishedAt: 'finished_at'
};

export async function listBooks(userId: string, status?: string, query?: string, finishedYear?: number, topic?: string) {
  const result = await db.query(`SELECT ${fields} FROM books WHERE user_id = $1
    AND ($2::text IS NULL OR status = $2)
    AND ($3::text IS NULL OR title ILIKE '%' || $3 || '%' OR author ILIKE '%' || $3 || '%')
    AND ($4::integer IS NULL OR (status = 'FINISHED' AND finished_at >= make_date($4, 1, 1) AND finished_at < make_date($4 + 1, 1, 1)))
    AND ($5::text IS NULL OR title ILIKE '%' || $5 || '%' OR author ILIKE '%' || $5 || '%'
      OR coalesce(description, '') ILIKE '%' || $5 || '%' OR array_to_string(tags, ' ') ILIKE '%' || $5 || '%'
      OR EXISTS (SELECT 1 FROM notes n WHERE n.user_id = books.user_id AND n.book_id = books.id
        AND to_tsvector('english', n.content || ' ' || coalesce(n.chapter, '')) @@ websearch_to_tsquery('english', $5)))
    ORDER BY updated_at DESC`, [userId, status ?? null, query ?? null, finishedYear ?? null, topic ?? null]);
  return result.rows;
}

export async function findMentionedBooks(userId: string, request: string) {
  const result = await db.query(`SELECT ${fields} FROM books WHERE user_id = $1
    AND (length(btrim(title)) >= 4 AND strpos(lower($2), lower(btrim(title))) > 0
      OR EXISTS (SELECT 1 FROM regexp_split_to_table(lower(title), '[^a-z0-9]+') AS word
        WHERE length(word) >= 8
          AND strpos(' ' || regexp_replace(lower($2), '[^a-z0-9]+', ' ', 'g') || ' ', ' ' || word || ' ') > 0))
    ORDER BY length(title) DESC LIMIT 3`, [userId, request]);
  return result.rows;
}

export async function getBook(userId: string, id: string) {
  const result = await db.query(`SELECT ${fields} FROM books WHERE user_id = $1 AND id = $2`, [userId, id]);
  return result.rows[0] ?? null;
}

export async function getBookByTitle(userId: string, title: string, author?: string) {
  const result = await db.query(`SELECT ${fields} FROM books WHERE user_id = $1 AND lower(btrim(title)) = lower(btrim($2))
    ORDER BY (lower(btrim(author)) = lower(btrim($3::text))) DESC, updated_at DESC LIMIT 2`, [userId, title, author ?? null]);
  const exactAuthor = author && result.rows.find(book => book.author.trim().toLowerCase() === author.trim().toLowerCase());
  if (exactAuthor) return exactAuthor;
  if (result.rows.length > 1) throw new Error('Multiple books have that title; include the author');
  return result.rows[0] ?? null;
}

export async function getBookByTitleAndAuthor(userId: string, title: string, author: string) {
  const result = await db.query(`SELECT ${fields} FROM books WHERE user_id = $1 AND lower(btrim(title)) = lower(btrim($2)) AND lower(btrim(author)) = lower(btrim($3)) LIMIT 1`, [userId, title, author]);
  return result.rows[0] ?? null;
}

export async function createBook(userId: string, input: BookInput) {
  const keys = Object.keys(input) as (keyof BookInput)[];
  const result = await db.query(`INSERT INTO books (user_id, ${keys.map(k => columns[k]).join(', ')})
    VALUES ($1, ${keys.map((_, i) => `$${i + 2}`).join(', ')}) RETURNING ${fields}`,
    [userId, ...keys.map(k => input[k])]);
  return result.rows[0];
}

export async function updateBook(userId: string, id: string, input: Partial<BookInput>) {
  const patch = { ...input };
  if (patch.status === 'CURRENTLY_READING' || patch.status === 'FINISHED') {
    if (!patch.startedAt) delete patch.startedAt;
    if (patch.status === 'CURRENTLY_READING') patch.finishedAt = null;
    if (patch.status === 'FINISHED') {
      if (!patch.finishedAt) delete patch.finishedAt;
      patch.progress = 100;
    }
  }
  if (patch.status === 'WANT_TO_READ' || patch.status === 'ABANDONED') {
    patch.finishedAt = null;
    if (patch.status === 'WANT_TO_READ') patch.startedAt = null;
  }
  const keys = Object.keys(patch) as (keyof BookInput)[];
  const needsStart = (patch.status === 'CURRENTLY_READING' || patch.status === 'FINISHED') && !keys.includes('startedAt');
  const needsFinish = patch.status === 'FINISHED' && !keys.includes('finishedAt');
  const today = `(now() AT TIME ZONE $${keys.length + 3}::text)::date`;
  const dates = needsStart ? `, started_at = coalesce(started_at, ${today})` : '';
  const finished = needsFinish ? `, finished_at = coalesce(finished_at, ${today})` : '';
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query(`UPDATE books SET ${keys.map((k, i) => `${columns[k]} = $${i + 3}`).join(', ')}${dates}${finished}, updated_at = now()
      WHERE user_id = $1 AND id = $2 RETURNING ${fields}`, [userId, id, ...keys.map(k => patch[k]), ...(needsStart || needsFinish ? [process.env.APP_TIME_ZONE || 'Asia/Karachi'] : [])]);
    const book = result.rows[0] ?? null;
    if (book && (patch.progress !== undefined || patch.status !== undefined)) await retireBookStateMemories(client, userId, book.title);
    await client.query('COMMIT');
    return book;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
}

export async function deleteBook(userId: string, id: string) {
  const result = await db.query('DELETE FROM books WHERE user_id = $1 AND id = $2 RETURNING id', [userId, id]);
  return Boolean(result.rowCount);
}

export async function dashboard(userId: string) {
  const [stats, current, recentNotes, weeklyReview] = await Promise.all([
    db.query(`SELECT count(*)::int AS total,
      count(*) FILTER (WHERE status = 'CURRENTLY_READING')::int AS reading,
      count(*) FILTER (WHERE status = 'FINISHED')::int AS finished,
      coalesce(round(avg(progress) FILTER (WHERE status = 'CURRENTLY_READING')), 0)::int AS "averageProgress"
      FROM books WHERE user_id = $1`, [userId]),
    db.query(`SELECT ${fields} FROM books WHERE user_id = $1 AND status = 'CURRENTLY_READING' ORDER BY updated_at DESC LIMIT 4`, [userId]),
    db.query(`SELECT n.id, n.content, n.created_at AS "createdAt", b.title AS "bookTitle"
      FROM notes n JOIN books b ON b.id = n.book_id AND b.user_id = n.user_id
      WHERE n.user_id = $1 ORDER BY n.created_at DESC LIMIT 3`, [userId]),
    getLatestWeeklyReview(userId)
  ]);
  return { stats: stats.rows[0], currentBooks: current.rows, recentNotes: recentNotes.rows, weeklyReview };
}
