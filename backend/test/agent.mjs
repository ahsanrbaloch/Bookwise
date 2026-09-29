import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

process.env.DATABASE_URL ??= 'postgres://bookwise:bookwise@localhost:5434/bookwise';
process.env.OPENAI_API_KEY = 'test-key';
const { runAgent } = await import('../dist/agent/graph.js');
const { createBook, deleteBook, listBooks } = await import('../dist/books.js');
const { bookInput } = await import('../dist/validation.js');
const { DEV_USER_ID } = await import('../dist/db.js');
const { db } = await import('../dist/db.js');
const { executeTool } = await import('../dist/agent/tools.js');
const { getConversationMessages, getOrCreateConversation, listConversations, saveConversationTurn } = await import('../dist/conversations.js');

const title = `Agent smoke ${Date.now()}`;
const author = 'Bookwise Test';
const call = (name, args) => ({ role: 'assistant', content: null, tool_calls: [{ id: 'call_1', type: 'function', function: { name, arguments: JSON.stringify(args) } }] });
const answer = content => ({ role: 'assistant', content });
function mockModel(replies) {
  const requests = [];
  global.fetch = async (_url, options) => {
    requests.push(JSON.parse(options.body));
    const next = replies.shift();
    if (next instanceof Error) throw next;
    assert.ok(next, 'Unexpected model call');
    return Response.json({ choices: [{ message: next }] });
  };
  return requests;
}

let book;
let otherBook;
let followupBook;
let conversationId;
const batchTitles = Array.from({ length: 5 }, (_, index) => `Agent batch ${Date.now()} ${index + 1}`);
const recoveredTitle = `Agent recovered ${Date.now()}`;
const otherUserId = randomUUID();
try {
  await db.query('INSERT INTO users (id, name) VALUES ($1, $2)', [otherUserId, 'Other reader']);
  book = await createBook(DEV_USER_ID, bookInput.parse({ title, author, status: 'CURRENTLY_READING' }));
  otherBook = await createBook(otherUserId, bookInput.parse({ title: `${title} private`, author }));
  const hidden = await executeTool(DEV_USER_ID, call('getBook', { title: otherBook.title }).tool_calls[0]);
  assert.equal(hidden.result.success, false);
  const requests = mockModel([call('searchBooks', { status: 'CURRENTLY_READING' }), answer('You are reading one test book.')]);
  const searched = await runAgent(DEV_USER_ID, 'What am I reading?');
  assert.equal(searched.events[0].name, 'searchBooks');
  assert.equal(searched.events[0].success, true);
  assert.ok(JSON.parse(requests[1].messages.at(-1).content).books.some(item => item.id === book.id));

  mockModel([call('getBook', { title }), answer('I found that book.')]);
  assert.equal((await runAgent(DEV_USER_ID, `Tell me about ${title}`)).events[0].success, true);

  mockModel([call('addBook', { title, author }), answer('It is already in your library.')]);
  assert.match((await runAgent(DEV_USER_ID, `Add ${title}`)).events[0].summary, /already/);
  assert.equal((await listBooks(DEV_USER_ID, undefined, title)).length, 1);

  mockModel([call('addBook', { title: 'Invalid title', author: '' }), answer('Done, I added it.')]);
  const failed = await runAgent(DEV_USER_ID, 'Add invalid title');
  assert.equal(failed.events[0].success, false);
  assert.doesNotMatch(failed.reply, /Done, I added/);

  mockModel([call('getBookNotes', { title: 'Missing book' }), answer('You have no notes for it.')]);
  const missingNotes = await runAgent(DEV_USER_ID, 'What notes do I have for a missing book?');
  assert.equal(missingNotes.events[0].success, false);
  assert.doesNotMatch(missingNotes.reply, /no notes/i);

  await deleteBook(DEV_USER_ID, book.id);
  book = undefined;
  mockModel([call('addBook', { title, author }), new Error('Model unavailable')]);
  const added = await runAgent(DEV_USER_ID, `Add ${title}`);
  assert.equal(added.events[0].success, true);
  assert.match(added.reply, /Added/);
  book = (await listBooks(DEV_USER_ID, undefined, title))[0];
  assert.ok(book);
  const followupTitle = `Follow-up book ${Date.now()}`;
  conversationId = await getOrCreateConversation(DEV_USER_ID, undefined, 'add a book');
  assert.equal(await getOrCreateConversation(otherUserId, conversationId, ''), undefined);
  assert.deepEqual(await getConversationMessages(otherUserId, conversationId), []);
  await saveConversationTurn(DEV_USER_ID, conversationId, 'add a book', 'Which title and author?');
  await saveConversationTurn(DEV_USER_ID, conversationId, `${followupTitle} by ${author}`, `Would you like me to add ${followupTitle}?`);
  assert.ok((await listConversations(DEV_USER_ID)).some(item => item.id === conversationId));
  assert.ok(!(await listConversations(otherUserId)).some(item => item.id === conversationId));
  const context = await getConversationMessages(DEV_USER_ID, conversationId);
  const followupRequests = mockModel([call('addBook', { title: followupTitle, author }), answer(`Added ${followupTitle}.`)]);
  const followup = await runAgent(DEV_USER_ID, 'yes add it', context);
  assert.equal(followup.events[0].name, 'addBook');
  assert.ok(followupRequests[0].messages.some(message => message.role === 'user' && message.content === `${followupTitle} by ${author}`));
  followupBook = (await listBooks(DEV_USER_ID, undefined, followupTitle))[0];
  assert.ok(followupBook);
  const placeholder = await executeTool(DEV_USER_ID, call('addBook', { title: 'yes', author: 'unknown' }).tool_calls[0]);
  assert.equal(placeholder.result.success, false);
  const batchReplies = [
    call('getBook', { title: batchTitles[1] }),
    ...batchTitles.map(bookTitle => call('addBook', { title: bookTitle, author })),
    call('updateBook', { title: batchTitles[0], status: 'CURRENTLY_READING', pageCount: 250 }),
    call('updateReadingProgress', { title: batchTitles[0], progress: 8 }),
    answer('Added all five books; the first is currently reading at 8%.')
  ];
  const batchRequests = mockModel(batchReplies);
  const batch = await runAgent(DEV_USER_ID, 'Add all five books. The first is currently reading, 20 pages out of 250.');
  assert.equal(batchRequests.length, 9, 'The model must get a final turn after eight tool calls');
  assert.equal(batch.events.filter(event => event.name === 'addBook').length, 5);
  assert.ok(batch.events.every(event => event.success));
  assert.ok(batch.toolTrace.some(item => item.name === 'getBook' && item.result.success === false));
  assert.doesNotMatch(batch.reply, /could not find/i);
  const firstBatchBook = (await listBooks(DEV_USER_ID, undefined, batchTitles[0]))[0];
  assert.equal(firstBatchBook.status, 'CURRENTLY_READING');
  assert.equal(firstBatchBook.progress, 8);
  assert.equal(firstBatchBook.pageCount, 250);
  mockModel([call('getBook', { title: recoveredTitle }), call('addBook', { title: recoveredTitle, author }), new Error('Model unavailable')]);
  const recovered = await runAgent(DEV_USER_ID, `Add ${recoveredTitle} by ${author}`);
  assert.match(recovered.reply, /Added/);
  assert.doesNotMatch(recovered.reply, /Could not find/);
  assert.deepEqual(recovered.events.map(event => event.name), ['addBook']);
  assert.equal(recovered.toolTrace.length, 2);
  for (let i = 0; i < 5; i++) await saveConversationTurn(DEV_USER_ID, conversationId, `Question ${i}`, `Answer ${i}`);
  assert.equal((await getConversationMessages(DEV_USER_ID, conversationId)).length, 12);
  const allMessages = await getConversationMessages(DEV_USER_ID, conversationId, null);
  assert.equal(allMessages.length, 14);
  assert.deepEqual(allMessages.slice(0, 2).map(item => item.role), ['user', 'assistant']);
  console.log('Agent graph smoke check passed');
} finally {
  if (followupBook) await deleteBook(DEV_USER_ID, followupBook.id);
  for (const batchTitle of batchTitles) {
    const saved = (await listBooks(DEV_USER_ID, undefined, batchTitle)).find(item => item.title === batchTitle);
    if (saved) await deleteBook(DEV_USER_ID, saved.id);
  }
  const recoveredBook = (await listBooks(DEV_USER_ID, undefined, recoveredTitle)).find(item => item.title === recoveredTitle);
  if (recoveredBook) await deleteBook(DEV_USER_ID, recoveredBook.id);
  if (conversationId) await db.query('DELETE FROM conversations WHERE user_id = $1 AND id = $2', [DEV_USER_ID, conversationId]);
  if (book) await deleteBook(DEV_USER_ID, book.id);
  if (otherBook) await deleteBook(otherUserId, otherBook.id);
  await db.query('DELETE FROM users WHERE id = $1', [otherUserId]);
}
