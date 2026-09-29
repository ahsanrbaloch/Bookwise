CREATE UNIQUE INDEX IF NOT EXISTS books_user_title_author_idx ON books (user_id, lower(btrim(title)), lower(btrim(author)));
