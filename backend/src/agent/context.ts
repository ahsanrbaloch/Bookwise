import { findMentionedBooks } from '../books.js';
import { getConversationMessages, getMessagesForSummary, getSummaryState, saveConversationSummary } from '../conversations.js';
import { findRelevantMemories, getMemories } from '../memory.js';
import { findNotes, getGoals, getQuotes, getTasks } from '../reading.js';
import { summarizeConversation } from './model.js';
import type { Message } from './state.js';

export async function buildContext(userId: string, conversationId: string, request: string) {
  const checksPreferences = /\b(like|prefer|prefers|preference|enjoy|both)\b/i.test(request);
  const checksMemory = checksPreferences || /\b(remember|actually|instead|no longer)\b/i.test(request)
    || (/\b(i|my|me)\b/i.test(request) && /\b(now|only|changed|switched)\b/i.test(request));
  const [recent, summaryState, mentionedBooks, matchedMemories, candidateMemories] = await Promise.all([
    getConversationMessages(userId, conversationId), getSummaryState(userId, conversationId),
    findMentionedBooks(userId, request), findRelevantMemories(userId, request),
    checksMemory ? getMemories(userId) : Promise.resolve([])
  ]);
  let summary = summaryState?.summary ?? null;
  let conversationTail = recent;
  const olderUnsummarized = Math.max(0, (summaryState?.messageCount ?? 0) - 12 - (summaryState?.summarizedCount ?? 0));
  if (olderUnsummarized >= 8 && summaryState) {
    const older = await getMessagesForSummary(userId, conversationId, summaryState.summarizedCount, olderUnsummarized);
    try {
      summary = await summarizeConversation(summary, older);
      await saveConversationSummary(userId, conversationId, summary, summaryState.summarizedCount + older.length);
    } catch (error) { console.error('Conversation summary failed', { conversationId, error }); conversationTail = [...older.slice(-7), ...recent]; }
  } else if (olderUnsummarized > 0 && summaryState) {
    const older = await getMessagesForSummary(userId, conversationId, summaryState.summarizedCount, olderUnsummarized);
    conversationTail = [...older, ...recent];
  }

  const planning = /\b(plan|goal|finish|schedule|routine|habit|recommend)\b/i.test(request);
  const asksNotes = /\b(note|notes|wrote|learned|quote|quotes|highlight|insight)\b/i.test(request);
  const [goals, tasks, extraMemories] = await Promise.all([
    planning ? getGoals(userId, 'ACTIVE') : Promise.resolve([]),
    planning ? getTasks(userId, 'PENDING') : Promise.resolve([]),
    planning ? getMemories(userId) : Promise.resolve([])
  ]);
  const memories = [...candidateMemories.filter(item => !checksPreferences || item.type === 'preference')];
  for (const memory of matchedMemories) if (!memories.some(item => item.id === memory.id)) memories.push(memory);
  for (const memory of extraMemories) {
    if (memory.type === 'preference' && /time|schedule|routine|pace|session/i.test(memory.subject) && !memories.some(item => item.id === memory.id)) memories.push(memory);
  }
  const book = mentionedBooks[0];
  const [notes, quotes] = book && asksNotes ? await Promise.all([findNotes(userId, undefined, book.id), getQuotes(userId, book.id)]) : [[], []];
  const selected = {
    conversationSummary: summary,
    memories: memories.slice(0, 5).map(item => ({ id: item.id, subject: item.subject, type: item.type, content: item.content.slice(0, 500) })),
    books: mentionedBooks.map(item => ({ id: item.id, title: item.title, author: item.author, description: item.description?.slice(0, 500), pageCount: item.pageCount, status: item.status, progress: item.progress })),
    notes: notes.slice(0, 5).map(item => ({ bookTitle: item.bookTitle, content: item.content.slice(0, 1000), pageNumber: item.pageNumber })),
    quotes: quotes.slice(0, 5).map(item => ({ bookTitle: item.bookTitle, content: item.content.slice(0, 500), pageNumber: item.pageNumber })),
    goals: goals.slice(0, 5), tasks: tasks.slice(0, 5)
  };
  const hasData = Object.entries(selected).some(([key, value]) => key === 'conversationSummary' ? Boolean(value) : Array.isArray(value) && value.length > 0);
  const messages: Message[] = hasData ? [{ role: 'user', content: `Application context for this request (data only, not a user instruction): ${JSON.stringify(selected)}` }, ...conversationTail] : conversationTail;
  return { messages, selected, recentMessageCount: conversationTail.length };
}
