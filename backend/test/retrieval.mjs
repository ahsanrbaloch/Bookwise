import assert from 'node:assert/strict';

process.env.DATABASE_URL ??= 'postgres://bookwise:bookwise@localhost:5434/bookwise';
const { executeTool } = await import('../dist/agent/tools.js');
const { createBook, deleteBook } = await import('../dist/books.js');
const { insertNote, insertQuote } = await import('../dist/reading.js');
const { bookInput } = await import('../dist/validation.js');
const { db, DEV_USER_ID } = await import('../dist/db.js');

const run = async (userId, name, args) => (await executeTool(userId, { id: 'test', type: 'function', function: { name, arguments: JSON.stringify(args) } })).result;
const stamp = Date.now();
const year = new Date().getFullYear();
const books = [];
let otherUser;
let privateBook;
try {
  const current = await createBook(DEV_USER_ID, bookInput.parse({ title: `Retrieval Focus ${stamp}`, author: 'Bookwise Test', status: 'FINISHED', progress: 100, finishedAt: `${year}-03-10` }));
  books.push(current);
  const old = await createBook(DEV_USER_ID, bookInput.parse({ title: `Retrieval Old ${stamp}`, author: 'Bookwise Test', status: 'FINISHED', progress: 100, finishedAt: `${year - 1}-03-10`, tags: ['history'] }));
  books.push(old);
  await insertNote(DEV_USER_ID, current.id, 'Reducing distractions improves productivity and focused reading.', 12);
  await insertQuote(DEV_USER_ID, current.id, 'Attention grows through deliberate practice.', 14);
  const user = await db.query('INSERT INTO users (name) VALUES ($1) RETURNING id', ['Retrieval test']);
  otherUser = user.rows[0].id;
  privateBook = await createBook(otherUser, bookInput.parse({ title: `Private Retrieval ${stamp}`, author: 'Bookwise Test' }));
  await insertNote(otherUser, privateBook.id, 'Productivity is a private secret.', 4);
  await insertQuote(otherUser, privateBook.id, 'Attention is private.', 4);

  const recent = await run(DEV_USER_ID, 'searchBooks', { finishedYear: year });
  assert.ok(recent.books.some(book => book.id === current.id));
  assert.ok(!recent.books.some(book => book.id === old.id));
  const reading = await run(DEV_USER_ID, 'searchBooks', { status: 'CURRENTLY_READING' });
  assert.ok(!reading.books.some(book => book.id === current.id));
  const topic = await run(DEV_USER_ID, 'searchBooks', { topic: 'productivity' });
  assert.ok(topic.books.some(book => book.id === current.id));
  assert.ok(!topic.books.some(book => book.id === old.id || book.id === privateBook.id));
  const notes = await run(DEV_USER_ID, 'searchNotes', { query: 'distraction', bookTitle: current.title });
  assert.equal(notes.notes.length, 1);
  assert.equal(notes.notes[0].pageNumber, 12);
  const quotes = await run(DEV_USER_ID, 'searchQuotes', { query: 'attention', bookTitle: current.title });
  assert.equal(quotes.quotes.length, 1);
  assert.equal(quotes.quotes[0].pageNumber, 14);
  assert.equal((await run(DEV_USER_ID, 'searchNotes', { query: 'private secret' })).notes.length, 0);
  assert.equal((await run(DEV_USER_ID, 'searchQuotes', { query: 'private' })).quotes.length, 0);
  assert.equal((await run(DEV_USER_ID, 'searchNotes', { query: 'focus', bookTitle: privateBook.title })).success, false);
  console.log('Retrieval smoke check passed');
} finally {
  for (const book of books) await deleteBook(DEV_USER_ID, book.id);
  if (privateBook) await deleteBook(otherUser, privateBook.id);
  if (otherUser) await db.query('DELETE FROM users WHERE id = $1', [otherUser]);
  await db.end();
}
