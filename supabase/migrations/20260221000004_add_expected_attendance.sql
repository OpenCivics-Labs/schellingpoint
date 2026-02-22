-- Add expected_attendance field to sessions
-- Used for venue capacity matching during scheduling

ALTER TABLE sessions ADD COLUMN IF NOT EXISTS expected_attendance INTEGER;

-- Add check constraint
ALTER TABLE sessions ADD CONSTRAINT sessions_expected_attendance_check
  CHECK (expected_attendance IS NULL OR expected_attendance > 0);

-- Comment
COMMENT ON COLUMN sessions.expected_attendance IS 'Expected number of attendees, used for venue capacity matching';
