CREATE INDEX IF NOT EXISTS notes_search_idx ON notes USING gin (to_tsvector('english', content || ' ' || coalesce(chapter, '')));
CREATE INDEX IF NOT EXISTS quotes_search_idx ON quotes USING gin (to_tsvector('english', content));
