-- Add required_features column to sessions table
-- This allows sessions to specify which venue features they need (projector, whiteboard, etc.)

ALTER TABLE sessions ADD COLUMN IF NOT EXISTS required_features TEXT[] DEFAULT ARRAY[]::TEXT[];

-- Add comment explaining the column
COMMENT ON COLUMN sessions.required_features IS 'Array of venue feature tags required for this session (e.g., projector, whiteboard, microphone)';

-- Add index for feature-based queries
CREATE INDEX IF NOT EXISTS idx_sessions_required_features ON sessions USING GIN (required_features);
