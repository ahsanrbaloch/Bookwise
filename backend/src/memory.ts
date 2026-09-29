import { db } from './db.js';
import type { PoolClient } from 'pg';

const fields = `id, subject, content, type, status, source, superseded_by AS "supersededBy", created_at AS "createdAt", updated_at AS "updatedAt"`;
export type MemoryInput = { subject: string; content: string; type: 'preference' | 'fact' | 'goal' | 'instruction'; replacesMemoryId?: string };

const bookStatePattern = /\b(progress|status|complete|completed|finished|halfway|currently reading|abandoned|want to read|started)\b|\b\d{1,3}%/i;
const mentionsBook = (subject: string, content: string, title: string) => `(strpos(lower(${subject}), lower(${title})) > 0
  OR strpos(lower(${content}), lower(${title})) > 0
  OR EXISTS (SELECT 1 FROM regexp_split_to_table(lower(${title}), '[^a-z0-9]+') AS word
    WHERE length(word) >= 8
      AND strpos(' ' || regexp_replace(lower(${subject} || ' ' || ${content}), '[^a-z0-9]+', ' ', 'g') || ' ', ' ' || word || ' ') > 0))`;
const visibleMemory = `m.user_id = $1 AND m.status = 'ACTIVE' AND NOT (m.type = 'fact'
  AND (m.subject ~* '(progress|status)' OR m.content ~* '[0-9]{1,3}%|currently reading|finished|halfway|completed|complete|abandoned|want to read|started')
  AND EXISTS (SELECT 1 FROM books b WHERE b.user_id = m.user_id
    AND ${mentionsBook('m.subject', 'm.content', 'b.title')}))`;

export async function retireBookStateMemories(client: PoolClient, userId: string, bookTitle: string) {
  await client.query(`UPDATE memories SET status = 'SUPERSEDED', updated_at = now()
    WHERE user_id = $1 AND status = 'ACTIVE' AND type = 'fact'
      AND ${mentionsBook('subject', 'content', '$2')}
      AND (subject ~* '(progress|status)' OR content ~* '[0-9]{1,3}%|currently reading|finished|halfway|completed|complete|abandoned|want to read|started')`, [userId, bookTitle]);
}

export async function getMemories(userId: string) {
  const result = await db.query(`SELECT ${fields} FROM memories m WHERE ${visibleMemory} ORDER BY updated_at DESC`, [userId]);
  return result.rows;
}

export async function saveMemory(userId: string, input: MemoryInput, source = 'chat') {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [userId]);
    const subject = input.subject;
    if (input.type === 'fact' && bookStatePattern.test(`${input.subject} ${input.content}`)) {
      const book = await client.query(`SELECT 1 FROM books WHERE user_id = $1
        AND ${mentionsBook('$2', '$3', 'title')} LIMIT 1`,
        [userId, input.subject, input.content]);
      if (book.rowCount) throw new Error('Book progress and status belong in the book record; use the book tools instead');
    }
    const previous = await client.query(`SELECT ${fields} FROM memories WHERE user_id = $1 AND status = 'ACTIVE'
      AND (id = $4::uuid OR (type = $2 AND lower(btrim(subject)) = lower(btrim($3)))) FOR UPDATE`,
      [userId, input.type, subject, input.replacesMemoryId ?? null]);
    if (input.replacesMemoryId && !previous.rows.some(memory => memory.id === input.replacesMemoryId)) throw new Error('Memory to replace was not found');
    const old = previous.rows;
    if (old.length === 1 && old[0].subject === subject && old[0].content === input.content) {
      await client.query('COMMIT');
      return { created: false, memory: old[0] };
    }
    if (old.length) await client.query(`UPDATE memories SET status = 'SUPERSEDED', updated_at = now()
      WHERE user_id = $1 AND id = ANY($2::uuid[])`, [userId, old.map(memory => memory.id)]);
    const saved = await client.query(`INSERT INTO memories (user_id, subject, content, type, source) VALUES ($1,$2,$3,$4,$5) RETURNING ${fields}`,
      [userId, subject, input.content, input.type, source]);
    if (old.length) await client.query(`UPDATE memories SET superseded_by = $3
      WHERE user_id = $1 AND id = ANY($2::uuid[])`, [userId, old.map(memory => memory.id), saved.rows[0].id]);
    await client.query('COMMIT');
    return { created: true, replaced: old.length > 0, memory: saved.rows[0] };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
}

export async function forgetMemory(userId: string, id: string) {
  const result = await db.query(`UPDATE memories SET status = 'FORGOTTEN', updated_at = now()
    WHERE user_id = $1 AND id = $2 AND status = 'ACTIVE' RETURNING ${fields}`, [userId, id]);
  return result.rows[0] ?? null;
}

export async function findRelevantMemories(userId: string, request: string) {
  const ignored = new Set(['about', 'books', 'book', 'reading', 'read', 'what', 'which', 'with', 'from', 'have', 'your', 'this', 'that', 'please', 'want', 'could', 'would']);
  const words = [...new Set(request.toLowerCase().match(/[a-z0-9]{3,}/g) ?? [])].filter(word => !ignored.has(word)).slice(0, 12);
  if (!words.length) return [];
  const result = await db.query(`SELECT ${fields} FROM memories m WHERE ${visibleMemory}
    AND to_tsvector('english', subject || ' ' || content) @@ websearch_to_tsquery('english', $2)
    ORDER BY ts_rank(to_tsvector('english', subject || ' ' || content), websearch_to_tsquery('english', $2)) DESC, updated_at DESC LIMIT 5`,
    [userId, words.join(' OR ')]);
  return result.rows;
}
