import { db } from './db.js';
import type { Message } from './agent/state.js';

export async function getOrCreateConversation(userId: string, conversationId: string | undefined, request: string) {
  if (conversationId) {
    const found = await db.query('SELECT id FROM conversations WHERE user_id = $1 AND id = $2', [userId, conversationId]);
    return found.rows[0]?.id as string | undefined;
  }
  const created = await db.query('INSERT INTO conversations (user_id, title) VALUES ($1, $2) RETURNING id', [userId, request.slice(0, 80)]);
  return created.rows[0].id as string;
}

export async function listConversations(userId: string) {
  const result = await db.query(`SELECT id, title, created_at AS "createdAt", updated_at AS "updatedAt"
    FROM conversations WHERE user_id = $1 ORDER BY updated_at DESC`, [userId]);
  return result.rows;
}

export async function deleteConversation(userId: string, conversationId: string) {
  const result = await db.query('DELETE FROM conversations WHERE user_id = $1 AND id = $2 RETURNING id', [userId, conversationId]);
  return Boolean(result.rows[0]);
}

export async function getConversationMessages(userId: string, conversationId: string, limit: number | null = 12) {
  const result = await db.query(`SELECT role, content FROM messages WHERE user_id = $1 AND conversation_id = $2
    ORDER BY created_at DESC, role ASC LIMIT $3::integer`, [userId, conversationId, limit]);
  return result.rows.reverse() as Message[];
}

export async function getSummaryState(userId: string, conversationId: string) {
  const result = await db.query(`SELECT c.summary, c.summarized_message_count AS "summarizedCount",
    (SELECT count(*)::int FROM messages m WHERE m.user_id = c.user_id AND m.conversation_id = c.id) AS "messageCount"
    FROM conversations c WHERE c.user_id = $1 AND c.id = $2`, [userId, conversationId]);
  return result.rows[0] as { summary: string | null; summarizedCount: number; messageCount: number } | undefined;
}

export async function getMessagesForSummary(userId: string, conversationId: string, offset: number, count: number) {
  const result = await db.query(`SELECT role, content FROM messages WHERE user_id = $1 AND conversation_id = $2
    ORDER BY created_at ASC, role DESC OFFSET $3::integer LIMIT $4::integer`, [userId, conversationId, offset, count]);
  return result.rows as Message[];
}

export async function saveConversationSummary(userId: string, conversationId: string, summary: string, count: number) {
  await db.query(`UPDATE conversations SET summary = $3, summarized_message_count = $4
    WHERE user_id = $1 AND id = $2 AND summarized_message_count < $4`, [userId, conversationId, summary, count]);
}

export async function saveConversationTurn(userId: string, conversationId: string, request: string, reply: string) {
  await db.query(`INSERT INTO messages (user_id, conversation_id, role, content)
    VALUES ($1, $2, 'user', $3), ($1, $2, 'assistant', $4)`, [userId, conversationId, request, reply]);
  await db.query('UPDATE conversations SET updated_at = now() WHERE user_id = $1 AND id = $2', [userId, conversationId]);
}
