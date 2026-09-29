CREATE TABLE IF NOT EXISTS memories (
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
CREATE UNIQUE INDEX IF NOT EXISTS memories_active_subject_idx ON memories (user_id, type, lower(btrim(subject))) WHERE status = 'ACTIVE';
CREATE INDEX IF NOT EXISTS memories_search_idx ON memories USING gin (to_tsvector('english', subject || ' ' || content));
