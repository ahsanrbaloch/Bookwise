import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

process.env.DATABASE_URL ??= 'postgres://bookwise:bookwise@localhost:5434/bookwise';
const { db } = await import('../dist/db.js');
const { createBook, deleteBook } = await import('../dist/books.js');
const { insertNote, insertQuote, insertTask, deleteNote, deleteQuote, deleteTask, findNotes, getQuotes, getTasks } = await import('../dist/reading.js');
const { bookInput } = await import('../dist/validation.js');
const owner = randomUUID();
const outsider = randomUUID();
let book;

try {
  await db.query('INSERT INTO users (id, name) VALUES ($1,$2),($3,$4)', [owner, 'Delete test', outsider, 'Other user']);
  book = await createBook(owner, bookInput.parse({ title: 'Delete test book', author: 'Bookwise Test' }));
  const note = (await insertNote(owner, book.id, 'A test note')).note;
  const quote = (await insertQuote(owner, book.id, 'A test quote')).quote;
  const task = (await insertTask(owner, { title: 'A test task', bookId: book.id })).task;
  for (const [remove, id] of [[deleteNote, note.id], [deleteQuote, quote.id], [deleteTask, task.id]]) {
    assert.equal(await remove(outsider, id), false);
    assert.equal(await remove(owner, id), true);
    assert.equal(await remove(owner, id), false);
  }
  assert.equal((await findNotes(owner)).some(item => item.id === note.id), false);
  assert.equal((await getQuotes(owner)).some(item => item.id === quote.id), false);
  assert.equal((await getTasks(owner)).some(item => item.id === task.id), false);
  console.log('Reading item deletion check passed');
} finally {
  if (book) await deleteBook(owner, book.id);
  await db.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [[owner, outsider]]);
  await db.end();
}
