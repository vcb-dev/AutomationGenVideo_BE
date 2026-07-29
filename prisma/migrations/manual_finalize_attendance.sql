-- Alter table meeting_sessions to add finalize fields
ALTER TABLE meeting_sessions ADD COLUMN IF NOT EXISTS is_finalized BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE meeting_sessions ADD COLUMN IF NOT EXISTS finalized_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE meeting_sessions ADD COLUMN IF NOT EXISTS finalized_by_id TEXT REFERENCES users(id) ON DELETE SET NULL;

-- Create table meeting_session_logs
CREATE TABLE IF NOT EXISTS meeting_session_logs (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES meeting_sessions(id) ON DELETE CASCADE,
    actor_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    action TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Index for logs
CREATE INDEX IF NOT EXISTS meeting_session_logs_session_id_idx ON meeting_session_logs(session_id);
