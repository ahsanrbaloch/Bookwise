CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Development identity until authentication is added.
INSERT INTO users (id, name) VALUES ('00000000-0000-0000-0000-000000000001', 'Reader');

CREATE TABLE books (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id),
  title text NOT NULL CHECK (length(trim(title)) > 0),
  author text NOT NULL CHECK (length(trim(author)) > 0),
  description text,
  cover_image_url text,
  page_count integer CHECK (page_count > 0),
  status text NOT NULL DEFAULT 'WANT_TO_READ' CHECK (status IN ('WANT_TO_READ', 'CURRENTLY_READING', 'FINISHED', 'ABANDONED')),
  progress integer NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
  rating integer CHECK (rating BETWEEN 1 AND 5),
  tags text[] NOT NULL DEFAULT '{}',
  started_at date,
  finished_at date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, id)
);
CREATE INDEX books_user_status_idx ON books (user_id, status);
CREATE UNIQUE INDEX books_user_title_author_idx ON books (user_id, lower(btrim(title)), lower(btrim(author)));

CREATE TABLE notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id),
  book_id uuid NOT NULL,
  content text NOT NULL,
  page_number integer CHECK (page_number > 0),
  chapter text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (user_id, book_id) REFERENCES books(user_id, id) ON DELETE CASCADE
);
CREATE TABLE quotes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id),
  book_id uuid NOT NULL,
  content text NOT NULL,
  page_number integer CHECK (page_number > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (user_id, book_id) REFERENCES books(user_id, id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX notes_identity_idx ON notes (user_id, book_id, lower(btrim(content)), coalesce(page_number, -1), coalesce(lower(btrim(chapter)), ''));
CREATE UNIQUE INDEX quotes_identity_idx ON quotes (user_id, book_id, lower(btrim(content)), coalesce(page_number, -1));
CREATE INDEX notes_search_idx ON notes USING gin (to_tsvector('english', content || ' ' || coalesce(chapter, '')));
CREATE INDEX quotes_search_idx ON quotes USING gin (to_tsvector('english', content));
CREATE TABLE reading_goals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id),
  title text NOT NULL,
  description text,
  target integer NOT NULL CHECK (target > 0),
  current_progress integer NOT NULL DEFAULT 0 CHECK (current_progress >= 0),
  due_date date,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'COMPLETED', 'CANCELLED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, id)
);
CREATE TABLE reading_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id),
  book_id uuid,
  goal_id uuid,
  title text NOT NULL,
  description text,
  due_date date,
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'COMPLETED', 'CANCELLED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (user_id, book_id) REFERENCES books(user_id, id) ON DELETE SET NULL (book_id),
  FOREIGN KEY (user_id, goal_id) REFERENCES reading_goals(user_id, id) ON DELETE SET NULL (goal_id)
);
CREATE TABLE conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id),
  title text NOT NULL,
  summary text,
  summarized_message_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, id)
);
CREATE TABLE messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  conversation_id uuid NOT NULL,
  role text NOT NULL CHECK (role IN ('user', 'assistant', 'tool')),
  content text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (user_id, conversation_id) REFERENCES conversations(user_id, id) ON DELETE CASCADE
);

CREATE TABLE memories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id),
  subject text NOT NULL CHECK (length(btrim(subject)) > 0),
  content text NOT NULL CHECK (length(btrim(content)) > 0),
  type text NOT NULL CHECK (type IN ('preference', 'fact', 'goal', 'instruction')),
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'SUPERSEDED', 'FORGOTTEN')),
  source text NOT NULL,
  superseded_by uuid REFERENCES memories(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, id)
);
CREATE UNIQUE INDEX memories_active_subject_idx ON memories (user_id, type, lower(btrim(subject))) WHERE status = 'ACTIVE';
CREATE INDEX memories_search_idx ON memories USING gin (to_tsvector('english', subject || ' ' || content));

CREATE TABLE reading_events (
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
CREATE INDEX reading_events_user_date_idx ON reading_events (user_id, created_at DESC);
CREATE TABLE weekly_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id),
  week_start date NOT NULL,
  metrics jsonb NOT NULL,
  summary text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, week_start)
);
CREATE UNIQUE INDEX active_goals_identity_idx ON reading_goals (user_id, lower(btrim(title)), coalesce(due_date, 'infinity'::date)) WHERE status = 'ACTIVE';
CREATE UNIQUE INDEX pending_tasks_identity_idx ON reading_tasks (user_id, lower(btrim(title)), coalesce(due_date, 'infinity'::date)) WHERE status = 'PENDING';

CREATE FUNCTION record_reading_event() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' OR NEW.progress IS DISTINCT FROM OLD.progress OR NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO reading_events (user_id, book_id, old_status, new_status, old_progress, new_progress)
    VALUES (NEW.user_id, NEW.id, CASE WHEN TG_OP = 'UPDATE' THEN OLD.status END, NEW.status,
      CASE WHEN TG_OP = 'UPDATE' THEN OLD.progress END, NEW.progress);
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER books_reading_event AFTER INSERT OR UPDATE OF status, progress ON books
FOR EACH ROW EXECUTE FUNCTION record_reading_event();
