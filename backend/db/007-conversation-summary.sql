ALTER TABLE conversations ADD COLUMN IF NOT EXISTS summary text;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS summarized_message_count integer NOT NULL DEFAULT 0;
