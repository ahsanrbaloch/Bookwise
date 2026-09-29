CREATE UNIQUE INDEX IF NOT EXISTS notes_identity_idx ON notes (user_id, book_id, lower(btrim(content)), coalesce(page_number, -1), coalesce(lower(btrim(chapter)), ''));
CREATE UNIQUE INDEX IF NOT EXISTS quotes_identity_idx ON quotes (user_id, book_id, lower(btrim(content)), coalesce(page_number, -1));
