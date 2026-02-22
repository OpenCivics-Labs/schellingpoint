-- Add suggested_topics to events table
-- These are event-specific topic suggestions shown in onboarding and proposal forms

ALTER TABLE events ADD COLUMN IF NOT EXISTS suggested_topics TEXT[] DEFAULT ARRAY[
  'Governance',
  'DeFi',
  'DAOs',
  'NFTs',
  'Privacy',
  'Security',
  'Public Goods',
  'Developer Tools',
  'Community',
  'Education'
]::TEXT[];

COMMENT ON COLUMN events.suggested_topics IS 'Suggested interest topics for this event, shown in onboarding and proposal forms';
