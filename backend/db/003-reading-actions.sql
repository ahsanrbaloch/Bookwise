CREATE TABLE IF NOT EXISTS reading_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id),
  book_id uuid NOT NULL,
  old_status text,
  new_status text NOT NULL,
  old_progress integer,
  new_progress integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (user_id, book_id) REFERENCES books(user_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS reading_events_user_date_idx ON reading_events (user_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS active_goals_identity_idx ON reading_goals (user_id, lower(btrim(title)), coalesce(due_date, 'infinity'::date)) WHERE status = 'ACTIVE';
CREATE UNIQUE INDEX IF NOT EXISTS pending_tasks_identity_idx ON reading_tasks (user_id, lower(btrim(title)), coalesce(due_date, 'infinity'::date)) WHERE status = 'PENDING';
CREATE OR REPLACE FUNCTION record_reading_event() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' OR NEW.progress IS DISTINCT FROM OLD.progress OR NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO reading_events (user_id, book_id, old_status, new_status, old_progress, new_progress)
    VALUES (NEW.user_id, NEW.id, CASE WHEN TG_OP = 'UPDATE' THEN OLD.status END, NEW.status,
      CASE WHEN TG_OP = 'UPDATE' THEN OLD.progress END, NEW.progress);
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS books_reading_event ON books;
CREATE TRIGGER books_reading_event AFTER INSERT OR UPDATE OF status, progress ON books
FOR EACH ROW EXECUTE FUNCTION record_reading_event();
INSERT INTO reading_events (user_id, book_id, old_status, new_status, old_progress, new_progress, created_at)
SELECT b.user_id, b.id, NULL, b.status, NULL, b.progress, b.created_at
FROM books b WHERE NOT EXISTS (SELECT 1 FROM reading_events e WHERE e.user_id = b.user_id AND e.book_id = b.id);
