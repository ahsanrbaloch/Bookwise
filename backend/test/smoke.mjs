import assert from 'node:assert/strict';

const base = process.env.API_URL ?? 'http://localhost:3001/api';
async function request(path, method = 'GET', body) {
  const response = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json' }, body: body && JSON.stringify(body) });
  return { status: response.status, data: response.status === 204 ? null : await response.json() };
}

let id;
try {
  assert.equal((await request('/health')).status, 200);
  const created = await request('/books', 'POST', { title: 'Smoke Test Book', author: 'Bookwise Test', tags: ['test'], userId: '00000000-0000-0000-0000-000000000002' });
  assert.equal(created.status, 201);
  id = created.data.id;
  assert.equal(created.data.userId, '00000000-0000-0000-0000-000000000001');
  assert.equal((await request('/books', 'POST', { title: 'Smoke Test Book', author: 'Bookwise Test' })).status, 409);
  assert.equal((await request(`/books/${id}`)).data.title, 'Smoke Test Book');
  assert.ok((await request('/books')).data.some(book => book.id === id));
  assert.ok((await request('/books?userId=00000000-0000-0000-0000-000000000002')).data.some(book => book.id === id));
  assert.equal((await request(`/books/${id}`, 'PATCH', { status: 'CURRENTLY_READING', progress: 35 })).data.progress, 35);
  assert.equal((await request('/dashboard')).data.currentBooks.some(book => book.id === id), true);
  assert.equal((await request(`/books/${id}`, 'PATCH', { progress: 101 })).status, 400);
  assert.equal((await request(`/books/${id}`, 'DELETE')).status, 204);
  id = undefined;
  assert.equal((await request('/books/00000000-0000-0000-0000-000000000000')).status, 404);
  console.log('Book CRUD smoke check passed');
} finally {
  if (id) await request(`/books/${id}`, 'DELETE');
}
