-- Remove hardcoded Web3-flavored defaults from events.suggested_topics.
-- Topics are now organizer-defined per event via the creation wizard.
-- Existing rows retain whatever values they were inserted with.

ALTER TABLE events
  ALTER COLUMN suggested_topics DROP DEFAULT;

COMMENT ON COLUMN events.suggested_topics IS
  'Suggested interest topics for this event, defined by the organizer in the creation wizard. Shown in onboarding and proposal forms.';
