-- Event Invitations for Private Events
-- Allows event owners/admins to invite people via email or shareable links

-- Ensure pgcrypto is available for gen_random_bytes()
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

CREATE TABLE IF NOT EXISTS event_invitations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  email TEXT, -- NULL for reusable/shareable links
  token TEXT NOT NULL UNIQUE DEFAULT encode(extensions.gen_random_bytes(32), 'hex'),
  role TEXT NOT NULL DEFAULT 'attendee' CHECK (role IN ('attendee', 'volunteer', 'moderator', 'admin')),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '7 days',
  accepted_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  created_by UUID NOT NULL REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_event_invitations_event ON event_invitations(event_id);
CREATE INDEX IF NOT EXISTS idx_event_invitations_token ON event_invitations(token);
CREATE INDEX IF NOT EXISTS idx_event_invitations_email ON event_invitations(email) WHERE email IS NOT NULL;

-- RLS Policies
ALTER TABLE event_invitations ENABLE ROW LEVEL SECURITY;

-- Event owners/admins can view invitations
CREATE POLICY "Event admins can view invitations"
  ON event_invitations FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM event_members
      WHERE event_members.event_id = event_invitations.event_id
        AND event_members.user_id = auth.uid()
        AND event_members.role IN ('owner', 'admin')
    )
  );

-- Event owners/admins can create invitations
CREATE POLICY "Event admins can create invitations"
  ON event_invitations FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM event_members
      WHERE event_members.event_id = event_invitations.event_id
        AND event_members.user_id = auth.uid()
        AND event_members.role IN ('owner', 'admin')
    )
    AND created_by = auth.uid()
  );

-- Event owners/admins can update (revoke) invitations
CREATE POLICY "Event admins can update invitations"
  ON event_invitations FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM event_members
      WHERE event_members.event_id = event_invitations.event_id
        AND event_members.user_id = auth.uid()
        AND event_members.role IN ('owner', 'admin')
    )
  );

-- Event owners/admins can delete invitations
CREATE POLICY "Event admins can delete invitations"
  ON event_invitations FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM event_members
      WHERE event_members.event_id = event_invitations.event_id
        AND event_members.user_id = auth.uid()
        AND event_members.role IN ('owner', 'admin')
    )
  );
