-- Add voting_mechanism column to events.
-- Supports quadratic (cost = votes^2), linear (cost = votes),
-- and approval (each approved session costs 1 credit, no squared cost).
ALTER TABLE events
  ADD COLUMN IF NOT EXISTS voting_mechanism TEXT NOT NULL DEFAULT 'quadratic'
    CHECK (voting_mechanism IN ('quadratic', 'linear', 'approval'));
