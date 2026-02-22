# Missing Features Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Complete 9 missing features to enable full platform usability: fix auth bugs, add event invitations, integrate Stripe Connect, add bulk slot generator to admin, enable session capacity matching, and create test data generator.

**Architecture:** Fix broadcast 401 by adding Authorization headers. Create event_invitations table with invite-only model. Integrate Stripe Connect OAuth for organizer payouts. Port wizard's BulkGenerator to admin setup. Add expected_attendance to session proposals with capacity validation. Seed test sessions with varied constraints.

**Tech Stack:** Next.js 14, Supabase (PostgreSQL + RLS), Stripe Connect, TypeScript, shadcn/ui

---

## Phase A: Bug Fixes

### Task A1: Fix Broadcast API 401 Error

**Files:**
- Modify: `src/app/e/[slug]/admin/communications/page.tsx:1-295`

**Step 1: Import getAccessToken utility**

At line 15, add the import:

```typescript
import { getAccessToken } from '@/lib/supabase/client'
```

**Step 2: Update fetchHistory function to include Authorization header**

Replace lines 46-58 with:

```typescript
  React.useEffect(() => {
    async function fetchHistory() {
      try {
        const token = getAccessToken()
        if (!token) {
          console.warn('No auth token for broadcast history')
          setLoadingHistory(false)
          return
        }

        const response = await fetch(`/api/v1/events/${event.slug}/admin/broadcast`, {
          headers: {
            'Authorization': `Bearer ${token}`,
          },
        })
        if (response.ok) {
          const data = await response.json()
          setBroadcasts(data.broadcasts || [])
        }
      } catch (err) {
        console.error('Error fetching broadcast history:', err)
      } finally {
        setLoadingHistory(false)
      }
    }
    fetchHistory()
  }, [event.slug])
```

**Step 3: Update handleSubmit to include Authorization header**

Replace lines 69-80 with:

```typescript
    try {
      const token = getAccessToken()
      if (!token) {
        setError('Please log in to send announcements')
        setIsLoading(false)
        return
      }

      const response = await fetch(`/api/v1/events/${event.slug}/admin/broadcast`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          title: title.trim(),
          message: message.trim(),
          ctaUrl: ctaUrl.trim() || undefined,
          ctaText: ctaText.trim() || undefined,
        }),
      })
```

**Step 4: Update the history refresh call**

Replace lines 95-102 with:

```typescript
      // Refresh history
      const historyResponse = await fetch(`/api/v1/events/${event.slug}/admin/broadcast`, {
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      })
      if (historyResponse.ok) {
        const historyData = await historyResponse.json()
        setBroadcasts(historyData.broadcasts || [])
      }
```

**Step 5: Test the fix**

Run: `npm run dev`

1. Navigate to `/e/[slug]/admin/communications`
2. Verify no 401 errors in console
3. Try sending a test announcement
4. Verify it appears in history

**Step 6: Commit**

```bash
git add src/app/e/[slug]/admin/communications/page.tsx
git commit -m "fix(communications): Add Authorization header to broadcast API calls

Resolves 401 Unauthorized errors by including Bearer token in fetch requests."
```

---

## Phase B: Core Missing Features

### Task B3: Create Event Invitations System

#### Task B3.1: Database Migration

**Files:**
- Create: `supabase/migrations/20260221000001_event_invitations.sql`

**Step 1: Write the migration**

```sql
-- Event Invitations for Private Events
-- Allows event owners/admins to invite people via email or shareable links

CREATE TABLE event_invitations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  email TEXT, -- NULL for reusable/shareable links
  token TEXT NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(32), 'hex'),
  role TEXT NOT NULL DEFAULT 'attendee' CHECK (role IN ('attendee', 'volunteer', 'moderator', 'admin')),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '7 days',
  accepted_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  created_by UUID NOT NULL REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_event_invitations_event ON event_invitations(event_id);
CREATE INDEX idx_event_invitations_token ON event_invitations(token);
CREATE INDEX idx_event_invitations_email ON event_invitations(email) WHERE email IS NOT NULL;

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
```

**Step 2: Apply migration**

Run: `npx supabase db push`

Expected: Migration applied successfully

**Step 3: Commit**

```bash
git add supabase/migrations/20260221000001_event_invitations.sql
git commit -m "feat(db): Add event_invitations table for private event access

Supports invite-only model with email or shareable link invitations."
```

#### Task B3.2: API Endpoints for Invitations

**Files:**
- Create: `src/app/api/v1/events/[slug]/invitations/route.ts`

**Step 1: Write the API route**

```typescript
/**
 * Event Invitations API
 *
 * POST - Create invitation (email or shareable link)
 * GET - List pending invitations
 */

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { getUserFromRequest } from '@/lib/api/getUser'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params

  const user = await getUserFromRequest(request)
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = await createAdminClient()

  // Get event
  const { data: event, error: eventError } = await supabase
    .from('events')
    .select('id, name, visibility')
    .eq('slug', slug)
    .single()

  if (eventError || !event) {
    return NextResponse.json({ error: 'Event not found' }, { status: 404 })
  }

  // Verify admin/owner role
  const { data: membership } = await supabase
    .from('event_members')
    .select('role')
    .eq('event_id', event.id)
    .eq('user_id', user.id)
    .single()

  if (!membership || !['owner', 'admin'].includes(membership.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // Parse request
  let body: { emails?: string[]; role?: string; expiresInDays?: number }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const role = body.role || 'attendee'
  if (!['attendee', 'volunteer', 'moderator', 'admin'].includes(role)) {
    return NextResponse.json({ error: 'Invalid role' }, { status: 400 })
  }

  const expiresAt = new Date()
  expiresAt.setDate(expiresAt.getDate() + (body.expiresInDays || 7))

  // Create invitations
  const invitations = []

  if (body.emails && body.emails.length > 0) {
    // Email invitations
    for (const email of body.emails) {
      invitations.push({
        event_id: event.id,
        email: email.toLowerCase().trim(),
        role,
        expires_at: expiresAt.toISOString(),
        created_by: user.id,
      })
    }
  } else {
    // Shareable link (no email)
    invitations.push({
      event_id: event.id,
      email: null,
      role,
      expires_at: expiresAt.toISOString(),
      created_by: user.id,
    })
  }

  const { data: created, error: insertError } = await supabase
    .from('event_invitations')
    .insert(invitations)
    .select('id, token, email, role, expires_at')

  if (insertError) {
    console.error('Error creating invitations:', insertError)
    return NextResponse.json({ error: 'Failed to create invitations' }, { status: 500 })
  }

  return NextResponse.json({
    success: true,
    invitations: created,
    inviteUrl: created.length === 1 && !created[0].email
      ? `${process.env.NEXT_PUBLIC_APP_URL}/invite/e/${created[0].token}`
      : null,
  })
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params

  const user = await getUserFromRequest(request)
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = await createAdminClient()

  // Get event
  const { data: event, error: eventError } = await supabase
    .from('events')
    .select('id')
    .eq('slug', slug)
    .single()

  if (eventError || !event) {
    return NextResponse.json({ error: 'Event not found' }, { status: 404 })
  }

  // Verify admin/owner role
  const { data: membership } = await supabase
    .from('event_members')
    .select('role')
    .eq('event_id', event.id)
    .eq('user_id', user.id)
    .single()

  if (!membership || !['owner', 'admin'].includes(membership.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // Fetch pending invitations
  const { data: invitations, error: fetchError } = await supabase
    .from('event_invitations')
    .select('id, token, email, role, expires_at, accepted_at, revoked_at, created_at')
    .eq('event_id', event.id)
    .is('revoked_at', null)
    .order('created_at', { ascending: false })

  if (fetchError) {
    console.error('Error fetching invitations:', fetchError)
    return NextResponse.json({ error: 'Failed to fetch invitations' }, { status: 500 })
  }

  return NextResponse.json({ invitations })
}
```

**Step 2: Commit**

```bash
git add src/app/api/v1/events/[slug]/invitations/route.ts
git commit -m "feat(api): Add event invitations endpoints

POST creates email or shareable link invitations.
GET lists pending invitations for admins."
```

#### Task B3.3: Delete/Revoke Invitation Endpoint

**Files:**
- Create: `src/app/api/v1/events/[slug]/invitations/[id]/route.ts`

**Step 1: Write the route**

```typescript
/**
 * Single Invitation Operations
 * DELETE - Revoke an invitation
 */

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { getUserFromRequest } from '@/lib/api/getUser'

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string; id: string }> }
) {
  const { slug, id } = await params

  const user = await getUserFromRequest(request)
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = await createAdminClient()

  // Get event
  const { data: event, error: eventError } = await supabase
    .from('events')
    .select('id')
    .eq('slug', slug)
    .single()

  if (eventError || !event) {
    return NextResponse.json({ error: 'Event not found' }, { status: 404 })
  }

  // Verify admin/owner role
  const { data: membership } = await supabase
    .from('event_members')
    .select('role')
    .eq('event_id', event.id)
    .eq('user_id', user.id)
    .single()

  if (!membership || !['owner', 'admin'].includes(membership.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // Revoke invitation (soft delete)
  const { error: updateError } = await supabase
    .from('event_invitations')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', id)
    .eq('event_id', event.id)

  if (updateError) {
    console.error('Error revoking invitation:', updateError)
    return NextResponse.json({ error: 'Failed to revoke invitation' }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
```

**Step 2: Commit**

```bash
git add src/app/api/v1/events/[slug]/invitations/[id]/route.ts
git commit -m "feat(api): Add invitation revoke endpoint"
```

#### Task B3.4: Accept Invitation Endpoint

**Files:**
- Create: `src/app/api/v1/invitations/[token]/accept/route.ts`

**Step 1: Write the route**

```typescript
/**
 * Accept Event Invitation
 * POST - Accept invitation and join event
 */

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { getUserFromRequest } from '@/lib/api/getUser'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params

  const user = await getUserFromRequest(request)
  if (!user) {
    return NextResponse.json({ error: 'Please log in to accept invitation' }, { status: 401 })
  }

  const supabase = await createAdminClient()

  // Find invitation
  const { data: invitation, error: inviteError } = await supabase
    .from('event_invitations')
    .select('id, event_id, email, role, expires_at, accepted_at, revoked_at')
    .eq('token', token)
    .single()

  if (inviteError || !invitation) {
    return NextResponse.json({ error: 'Invalid invitation' }, { status: 404 })
  }

  // Check if already accepted
  if (invitation.accepted_at) {
    return NextResponse.json({ error: 'Invitation already used' }, { status: 400 })
  }

  // Check if revoked
  if (invitation.revoked_at) {
    return NextResponse.json({ error: 'Invitation has been revoked' }, { status: 400 })
  }

  // Check expiration
  if (new Date(invitation.expires_at) < new Date()) {
    return NextResponse.json({ error: 'Invitation has expired' }, { status: 400 })
  }

  // If email-specific, verify email matches
  if (invitation.email) {
    const { data: profile } = await supabase
      .from('user_data')
      .select('email')
      .eq('id', user.id)
      .single()

    if (profile?.email?.toLowerCase() !== invitation.email.toLowerCase()) {
      return NextResponse.json({
        error: 'This invitation was sent to a different email address'
      }, { status: 403 })
    }
  }

  // Check if already a member
  const { data: existingMember } = await supabase
    .from('event_members')
    .select('id')
    .eq('event_id', invitation.event_id)
    .eq('user_id', user.id)
    .single()

  if (existingMember) {
    // Mark invitation as accepted anyway
    await supabase
      .from('event_invitations')
      .update({ accepted_at: new Date().toISOString() })
      .eq('id', invitation.id)

    // Get event slug for redirect
    const { data: event } = await supabase
      .from('events')
      .select('slug')
      .eq('id', invitation.event_id)
      .single()

    return NextResponse.json({
      success: true,
      message: 'You are already a member of this event',
      eventSlug: event?.slug
    })
  }

  // Add user to event
  const { error: memberError } = await supabase
    .from('event_members')
    .insert({
      event_id: invitation.event_id,
      user_id: user.id,
      role: invitation.role,
    })

  if (memberError) {
    console.error('Error adding member:', memberError)
    return NextResponse.json({ error: 'Failed to join event' }, { status: 500 })
  }

  // Mark invitation as accepted (only for email invitations)
  if (invitation.email) {
    await supabase
      .from('event_invitations')
      .update({ accepted_at: new Date().toISOString() })
      .eq('id', invitation.id)
  }

  // Get event slug for redirect
  const { data: event } = await supabase
    .from('events')
    .select('slug, name')
    .eq('id', invitation.event_id)
    .single()

  return NextResponse.json({
    success: true,
    message: `Welcome to ${event?.name}!`,
    eventSlug: event?.slug,
    role: invitation.role
  })
}
```

**Step 2: Commit**

```bash
git add src/app/api/v1/invitations/[token]/accept/route.ts
git commit -m "feat(api): Add invitation acceptance endpoint

Validates token, checks expiration, adds user to event_members."
```

#### Task B3.5: Invitation Acceptance Page

**Files:**
- Create: `src/app/invite/e/[token]/page.tsx`

**Step 1: Write the page**

```typescript
'use client'

import * as React from 'react'
import { useRouter, useParams } from 'next/navigation'
import Link from 'next/link'
import { Loader2, CheckCircle, XCircle, Calendar, Users } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { useAuth } from '@/hooks/useAuth'
import { getAccessToken } from '@/lib/supabase/client'

interface InvitationInfo {
  event: {
    name: string
    slug: string
    description: string | null
    start_date: string
    end_date: string
  }
  role: string
  expires_at: string
  is_expired: boolean
  is_used: boolean
  is_revoked: boolean
}

export default function AcceptEventInvitationPage() {
  const router = useRouter()
  const params = useParams()
  const token = params.token as string
  const { user, isLoading: authLoading } = useAuth()

  const [invitation, setInvitation] = React.useState<InvitationInfo | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [accepting, setAccepting] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [success, setSuccess] = React.useState<string | null>(null)

  // Fetch invitation info
  React.useEffect(() => {
    async function fetchInvitation() {
      try {
        const response = await fetch(`/api/v1/invitations/${token}`)
        const data = await response.json()

        if (!response.ok) {
          setError(data.error || 'Invalid invitation')
          return
        }

        setInvitation(data)
      } catch (err) {
        setError('Failed to load invitation')
      } finally {
        setLoading(false)
      }
    }

    fetchInvitation()
  }, [token])

  const handleAccept = async () => {
    const accessToken = getAccessToken()
    if (!accessToken) {
      router.push(`/login?redirect=/invite/e/${token}`)
      return
    }

    setAccepting(true)
    setError(null)

    try {
      const response = await fetch(`/api/v1/invitations/${token}/accept`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
        },
      })

      const data = await response.json()

      if (!response.ok) {
        setError(data.error || 'Failed to accept invitation')
        return
      }

      setSuccess(data.message)

      // Redirect to event after short delay
      setTimeout(() => {
        router.push(`/e/${data.eventSlug}`)
      }, 2000)
    } catch (err) {
      setError('Failed to accept invitation')
    } finally {
      setAccepting(false)
    }
  }

  if (loading || authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (error && !invitation) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <Card className="max-w-md w-full">
          <CardContent className="py-12 text-center">
            <XCircle className="h-12 w-12 mx-auto text-destructive mb-4" />
            <h2 className="text-xl font-semibold mb-2">Invalid Invitation</h2>
            <p className="text-muted-foreground mb-4">{error}</p>
            <Button asChild variant="outline">
              <Link href="/">Go Home</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (success) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <Card className="max-w-md w-full">
          <CardContent className="py-12 text-center">
            <CheckCircle className="h-12 w-12 mx-auto text-green-500 mb-4" />
            <h2 className="text-xl font-semibold mb-2">You&apos;re In!</h2>
            <p className="text-muted-foreground mb-4">{success}</p>
            <p className="text-sm text-muted-foreground">Redirecting...</p>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (!invitation) return null

  const isInvalid = invitation.is_expired || invitation.is_used || invitation.is_revoked

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <Card className="max-w-md w-full">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl">{invitation.event.name}</CardTitle>
          <CardDescription>You&apos;ve been invited to join this event</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {invitation.event.description && (
            <p className="text-sm text-muted-foreground">{invitation.event.description}</p>
          )}

          <div className="flex items-center gap-4 text-sm text-muted-foreground">
            <div className="flex items-center gap-1">
              <Calendar className="h-4 w-4" />
              <span>
                {new Date(invitation.event.start_date).toLocaleDateString()} - {new Date(invitation.event.end_date).toLocaleDateString()}
              </span>
            </div>
            <div className="flex items-center gap-1">
              <Users className="h-4 w-4" />
              <span className="capitalize">{invitation.role}</span>
            </div>
          </div>

          {error && (
            <div className="rounded-lg bg-destructive/10 border border-destructive/20 p-3 text-sm text-destructive">
              {error}
            </div>
          )}

          {isInvalid ? (
            <div className="rounded-lg bg-muted p-4 text-center">
              <XCircle className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
              <p className="font-medium">
                {invitation.is_expired && 'This invitation has expired'}
                {invitation.is_used && 'This invitation has already been used'}
                {invitation.is_revoked && 'This invitation has been revoked'}
              </p>
            </div>
          ) : user ? (
            <Button
              onClick={handleAccept}
              className="w-full"
              size="lg"
              disabled={accepting}
            >
              {accepting ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Joining...
                </>
              ) : (
                'Accept Invitation'
              )}
            </Button>
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-center text-muted-foreground">
                Please log in or create an account to accept this invitation
              </p>
              <Button asChild className="w-full" size="lg">
                <Link href={`/login?redirect=/invite/e/${token}`}>
                  Log In to Accept
                </Link>
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
```

**Step 2: Create the invitation info API endpoint**

**Files:**
- Create: `src/app/api/v1/invitations/[token]/route.ts`

```typescript
/**
 * Get Invitation Info (public)
 */

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params

  const supabase = await createAdminClient()

  // Find invitation with event info
  const { data: invitation, error } = await supabase
    .from('event_invitations')
    .select(`
      role,
      expires_at,
      accepted_at,
      revoked_at,
      events (
        name,
        slug,
        description,
        start_date,
        end_date
      )
    `)
    .eq('token', token)
    .single()

  if (error || !invitation) {
    return NextResponse.json({ error: 'Invalid invitation' }, { status: 404 })
  }

  const event = invitation.events as { name: string; slug: string; description: string | null; start_date: string; end_date: string }

  return NextResponse.json({
    event: {
      name: event.name,
      slug: event.slug,
      description: event.description,
      start_date: event.start_date,
      end_date: event.end_date,
    },
    role: invitation.role,
    expires_at: invitation.expires_at,
    is_expired: new Date(invitation.expires_at) < new Date(),
    is_used: !!invitation.accepted_at,
    is_revoked: !!invitation.revoked_at,
  })
}
```

**Step 3: Commit**

```bash
git add src/app/invite/e/[token]/page.tsx src/app/api/v1/invitations/[token]/route.ts
git commit -m "feat(invitations): Add invitation acceptance page and info endpoint

Shows event details, validates invitation status, handles accept flow."
```

#### Task B3.6: Admin Members Page with Invite UI

**Files:**
- Create: `src/app/e/[slug]/admin/members/page.tsx`

**Step 1: Write the admin members page**

```typescript
'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import {
  Loader2,
  Users,
  UserPlus,
  Mail,
  Link as LinkIcon,
  Copy,
  Check,
  Trash2,
  Clock,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { AdminNav } from '@/components/admin/AdminNav'
import { useAuth } from '@/hooks/useAuth'
import { useEvent, useEventRole } from '@/contexts/EventContext'
import { getAccessToken } from '@/lib/supabase/client'
import { formatDistanceToNow } from 'date-fns'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

interface Member {
  id: string
  user_id: string
  role: string
  joined_at: string
  user_data: {
    display_name: string | null
    email: string | null
  } | null
}

interface Invitation {
  id: string
  token: string
  email: string | null
  role: string
  expires_at: string
  accepted_at: string | null
  created_at: string
}

const ROLE_COLORS: Record<string, string> = {
  owner: 'bg-purple-500',
  admin: 'bg-blue-500',
  moderator: 'bg-green-500',
  volunteer: 'bg-amber-500',
  attendee: 'bg-gray-500',
}

export default function AdminMembersPage() {
  const router = useRouter()
  const { user, isLoading: authLoading } = useAuth()
  const event = useEvent()
  const { isAdmin, isOwner, isLoading: roleLoading, can } = useEventRole()

  const [members, setMembers] = React.useState<Member[]>([])
  const [invitations, setInvitations] = React.useState<Invitation[]>([])
  const [loading, setLoading] = React.useState(true)

  const [showInviteModal, setShowInviteModal] = React.useState(false)
  const [inviteEmails, setInviteEmails] = React.useState('')
  const [inviteRole, setInviteRole] = React.useState('attendee')
  const [inviteType, setInviteType] = React.useState<'email' | 'link'>('link')
  const [inviting, setInviting] = React.useState(false)
  const [generatedLink, setGeneratedLink] = React.useState<string | null>(null)
  const [copied, setCopied] = React.useState(false)

  // Redirect if not admin
  React.useEffect(() => {
    if (!authLoading && !roleLoading && (!user || !isAdmin)) {
      router.push(`/e/${event.slug}/sessions`)
    }
  }, [user, isAdmin, authLoading, roleLoading, router, event.slug])

  // Fetch members and invitations
  React.useEffect(() => {
    async function fetchData() {
      const token = getAccessToken()
      if (!token) return

      try {
        // Fetch members
        const membersRes = await fetch(
          `${SUPABASE_URL}/rest/v1/event_members?event_id=eq.${event.id}&select=id,user_id,role,joined_at,user_data:user_data(display_name,email)&order=role.asc,joined_at.asc`,
          {
            headers: {
              'apikey': SUPABASE_KEY,
              'Authorization': `Bearer ${token}`,
            },
          }
        )
        if (membersRes.ok) {
          setMembers(await membersRes.json())
        }

        // Fetch invitations
        const invitationsRes = await fetch(`/api/v1/events/${event.slug}/invitations`, {
          headers: {
            'Authorization': `Bearer ${token}`,
          },
        })
        if (invitationsRes.ok) {
          const data = await invitationsRes.json()
          setInvitations(data.invitations || [])
        }
      } catch (err) {
        console.error('Error fetching data:', err)
      } finally {
        setLoading(false)
      }
    }

    fetchData()
  }, [event.id, event.slug])

  const handleCreateInvite = async () => {
    const token = getAccessToken()
    if (!token) return

    setInviting(true)
    setGeneratedLink(null)

    try {
      const body: { emails?: string[]; role: string } = { role: inviteRole }

      if (inviteType === 'email' && inviteEmails.trim()) {
        body.emails = inviteEmails.split(',').map(e => e.trim()).filter(e => e)
      }

      const response = await fetch(`/api/v1/events/${event.slug}/invitations`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify(body),
      })

      const data = await response.json()

      if (response.ok) {
        if (data.inviteUrl) {
          setGeneratedLink(data.inviteUrl)
        }

        // Refresh invitations list
        const invitationsRes = await fetch(`/api/v1/events/${event.slug}/invitations`, {
          headers: { 'Authorization': `Bearer ${token}` },
        })
        if (invitationsRes.ok) {
          const invData = await invitationsRes.json()
          setInvitations(invData.invitations || [])
        }

        if (inviteType === 'email') {
          setShowInviteModal(false)
          setInviteEmails('')
        }
      }
    } catch (err) {
      console.error('Error creating invitation:', err)
    } finally {
      setInviting(false)
    }
  }

  const handleRevokeInvite = async (id: string) => {
    const token = getAccessToken()
    if (!token) return

    if (!confirm('Revoke this invitation?')) return

    try {
      await fetch(`/api/v1/events/${event.slug}/invitations/${id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` },
      })

      setInvitations(prev => prev.filter(i => i.id !== id))
    } catch (err) {
      console.error('Error revoking invitation:', err)
    }
  }

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  if (authLoading || roleLoading || loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (!isAdmin) return null

  const pendingInvitations = invitations.filter(i => !i.accepted_at)

  return (
    <div className="min-h-screen bg-background">
      <AdminNav
        eventSlug={event.slug}
        canManageSchedule={can('manageSchedule')}
        canManageVenues={can('manageVenues')}
      />

      <main className="container mx-auto px-4 py-6">
        <div className="space-y-6">
          {/* Header */}
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold">Members</h1>
              <p className="text-sm text-muted-foreground">
                {members.length} members in {event.name}
              </p>
            </div>
            <Button onClick={() => setShowInviteModal(true)}>
              <UserPlus className="h-4 w-4 mr-2" />
              Invite People
            </Button>
          </div>

          {/* Invite Modal */}
          {showInviteModal && (
            <Card className="border-primary">
              <CardHeader>
                <CardTitle>Invite People</CardTitle>
                <CardDescription>
                  Create an invitation link or send email invites
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Invite Type Toggle */}
                <div className="flex gap-2">
                  <Button
                    variant={inviteType === 'link' ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setInviteType('link')}
                  >
                    <LinkIcon className="h-4 w-4 mr-1" />
                    Shareable Link
                  </Button>
                  <Button
                    variant={inviteType === 'email' ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setInviteType('email')}
                  >
                    <Mail className="h-4 w-4 mr-1" />
                    Email Invites
                  </Button>
                </div>

                {inviteType === 'email' && (
                  <div className="space-y-2">
                    <Label>Email Addresses</Label>
                    <Input
                      placeholder="email@example.com, another@example.com"
                      value={inviteEmails}
                      onChange={(e) => setInviteEmails(e.target.value)}
                    />
                    <p className="text-xs text-muted-foreground">
                      Separate multiple emails with commas
                    </p>
                  </div>
                )}

                <div className="space-y-2">
                  <Label>Role</Label>
                  <select
                    value={inviteRole}
                    onChange={(e) => setInviteRole(e.target.value)}
                    className="w-full h-10 rounded-md border bg-background px-3 text-sm"
                  >
                    <option value="attendee">Attendee</option>
                    <option value="volunteer">Volunteer</option>
                    <option value="moderator">Moderator</option>
                    {isOwner && <option value="admin">Admin</option>}
                  </select>
                </div>

                {generatedLink && (
                  <div className="space-y-2">
                    <Label>Invitation Link</Label>
                    <div className="flex gap-2">
                      <Input value={generatedLink} readOnly className="font-mono text-sm" />
                      <Button
                        variant="outline"
                        size="icon"
                        onClick={() => copyToClipboard(generatedLink)}
                      >
                        {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                      </Button>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Anyone with this link can join as {inviteRole}. Expires in 7 days.
                    </p>
                  </div>
                )}

                <div className="flex gap-2 justify-end">
                  <Button variant="outline" onClick={() => {
                    setShowInviteModal(false)
                    setGeneratedLink(null)
                    setInviteEmails('')
                  }}>
                    {generatedLink ? 'Done' : 'Cancel'}
                  </Button>
                  {!generatedLink && (
                    <Button onClick={handleCreateInvite} disabled={inviting}>
                      {inviting ? (
                        <>
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                          Creating...
                        </>
                      ) : inviteType === 'link' ? (
                        'Generate Link'
                      ) : (
                        'Send Invites'
                      )}
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Pending Invitations */}
          {pendingInvitations.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <Clock className="h-5 w-5" />
                  Pending Invitations
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {pendingInvitations.map((invite) => (
                    <div
                      key={invite.id}
                      className="flex items-center justify-between p-3 rounded-lg border bg-muted/30"
                    >
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          {invite.email ? (
                            <span className="font-medium">{invite.email}</span>
                          ) : (
                            <span className="text-muted-foreground flex items-center gap-1">
                              <LinkIcon className="h-4 w-4" />
                              Shareable Link
                            </span>
                          )}
                          <Badge variant="secondary" className="capitalize">
                            {invite.role}
                          </Badge>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          Created {formatDistanceToNow(new Date(invite.created_at), { addSuffix: true })}
                          {' · '}
                          Expires {formatDistanceToNow(new Date(invite.expires_at), { addSuffix: true })}
                        </p>
                      </div>
                      <div className="flex items-center gap-1">
                        {!invite.email && (
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => copyToClipboard(`${window.location.origin}/invite/e/${invite.token}`)}
                          >
                            <Copy className="h-4 w-4" />
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="icon"
                          className="text-destructive hover:text-destructive"
                          onClick={() => handleRevokeInvite(invite.id)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Members List */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Users className="h-5 w-5" />
                All Members
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {members.map((member) => (
                  <div
                    key={member.id}
                    className="flex items-center justify-between p-3 rounded-lg border"
                  >
                    <div className="flex items-center gap-3">
                      <div className={`w-2 h-2 rounded-full ${ROLE_COLORS[member.role] || 'bg-gray-500'}`} />
                      <div>
                        <p className="font-medium">
                          {member.user_data?.display_name || member.user_data?.email || 'Unknown User'}
                        </p>
                        {member.user_data?.email && member.user_data?.display_name && (
                          <p className="text-xs text-muted-foreground">{member.user_data.email}</p>
                        )}
                      </div>
                    </div>
                    <Badge variant="outline" className="capitalize">
                      {member.role}
                    </Badge>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  )
}
```

**Step 2: Add Members link to AdminNav**

**Files:**
- Modify: `src/components/admin/AdminNav.tsx`

Add the members link in the navigation items.

**Step 3: Commit**

```bash
git add src/app/e/[slug]/admin/members/page.tsx
git commit -m "feat(admin): Add members management page with invite UI

Displays current members, pending invitations, and invite creation."
```

---

### Task B4: Add Bulk Time Slot Generator to Admin Setup

**Files:**
- Create: `src/components/admin/BulkSlotGenerator.tsx`
- Modify: `src/app/e/[slug]/admin/setup/page.tsx`

#### Task B4.1: Create BulkSlotGenerator Component

**Step 1: Write the component**

```typescript
'use client'

import * as React from 'react'
import { Zap, Coffee } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

interface BulkSlotGeneratorProps {
  venues: { id: string; name: string; capacity: number | null }[]
  eventDays: { date: string; label: string }[]
  onGenerate: (slots: GeneratedSlot[]) => void
  onCancel: () => void
}

interface GeneratedSlot {
  venueId: string
  dayDate: string
  startTime: string
  endTime: string
  label: string
  isBreak: boolean
}

const DURATION_OPTIONS = [
  { value: 30, label: '30 min' },
  { value: 45, label: '45 min' },
  { value: 60, label: '1 hour' },
  { value: 90, label: '1.5 hours' },
  { value: 120, label: '2 hours' },
]

const BREAK_DURATION_OPTIONS = [
  { value: 10, label: '10 min' },
  { value: 15, label: '15 min' },
  { value: 20, label: '20 min' },
  { value: 30, label: '30 min' },
]

function minutesToTime(minutes: number): string {
  const hours = Math.floor(minutes / 60)
  const mins = minutes % 60
  return `${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}`
}

function formatTime(time: string): string {
  const [hours, minutes] = time.split(':').map(Number)
  const period = hours >= 12 ? 'PM' : 'AM'
  const displayHours = hours % 12 || 12
  return `${displayHours}:${minutes.toString().padStart(2, '0')} ${period}`
}

export function BulkSlotGenerator({
  venues,
  eventDays,
  onGenerate,
  onCancel,
}: BulkSlotGeneratorProps) {
  const [venueId, setVenueId] = React.useState(venues[0]?.id || '')
  const [dayDate, setDayDate] = React.useState(eventDays[0]?.date || '')
  const [startHour, setStartHour] = React.useState(9)
  const [endHour, setEndHour] = React.useState(17)
  const [duration, setDuration] = React.useState(60)
  const [includeBreaks, setIncludeBreaks] = React.useState(false)
  const [breakDuration, setBreakDuration] = React.useState(15)

  // Generate preview
  const preview = React.useMemo(() => {
    const slots: GeneratedSlot[] = []
    let currentMinutes = startHour * 60
    const endMinutes = endHour * 60

    while (currentMinutes + duration <= endMinutes) {
      const startTime = minutesToTime(currentMinutes)
      const slotEndMinutes = currentMinutes + duration
      const endTime = minutesToTime(slotEndMinutes)

      slots.push({
        venueId,
        dayDate,
        startTime,
        endTime,
        label: '',
        isBreak: false,
      })

      currentMinutes = slotEndMinutes

      // Add break if enabled
      if (includeBreaks && currentMinutes + duration <= endMinutes) {
        const breakStart = minutesToTime(currentMinutes)
        const breakEndMinutes = currentMinutes + breakDuration
        const breakEnd = minutesToTime(breakEndMinutes)

        slots.push({
          venueId,
          dayDate,
          startTime: breakStart,
          endTime: breakEnd,
          label: 'Break',
          isBreak: true,
        })

        currentMinutes = breakEndMinutes
      }
    }

    return slots
  }, [venueId, dayDate, startHour, endHour, duration, includeBreaks, breakDuration])

  const selectedVenue = venues.find(v => v.id === venueId)

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>Venue</Label>
          <select
            value={venueId}
            onChange={(e) => setVenueId(e.target.value)}
            className="w-full h-10 rounded-md border bg-background px-3 text-sm"
          >
            {venues.map((venue) => (
              <option key={venue.id} value={venue.id}>
                {venue.name} {venue.capacity ? `(${venue.capacity} cap)` : ''}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-2">
          <Label>Date</Label>
          <select
            value={dayDate}
            onChange={(e) => setDayDate(e.target.value)}
            className="w-full h-10 rounded-md border bg-background px-3 text-sm"
          >
            {eventDays.map((day) => (
              <option key={day.date} value={day.date}>
                {day.label}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-2">
          <Label>Start Hour</Label>
          <select
            value={startHour}
            onChange={(e) => setStartHour(Number(e.target.value))}
            className="w-full h-10 rounded-md border bg-background px-3 text-sm"
          >
            {Array.from({ length: 24 }, (_, i) => (
              <option key={i} value={i}>
                {formatTime(`${i.toString().padStart(2, '0')}:00`)}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-2">
          <Label>End Hour</Label>
          <select
            value={endHour}
            onChange={(e) => setEndHour(Number(e.target.value))}
            className="w-full h-10 rounded-md border bg-background px-3 text-sm"
          >
            {Array.from({ length: 24 }, (_, i) => (
              <option key={i} value={i}>
                {formatTime(`${i.toString().padStart(2, '0')}:00`)}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-2">
          <Label>Slot Duration</Label>
          <select
            value={duration}
            onChange={(e) => setDuration(Number(e.target.value))}
            className="w-full h-10 rounded-md border bg-background px-3 text-sm"
          >
            {DURATION_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-2">
          <Label>Breaks Between Slots</Label>
          <div className="flex items-center gap-3 h-10">
            <button
              type="button"
              role="switch"
              aria-checked={includeBreaks}
              onClick={() => setIncludeBreaks(!includeBreaks)}
              className={cn(
                'relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors',
                includeBreaks ? 'bg-primary' : 'bg-input'
              )}
            >
              <span
                className={cn(
                  'pointer-events-none inline-block h-5 w-5 rounded-full bg-background shadow-lg transition-transform',
                  includeBreaks ? 'translate-x-5' : 'translate-x-0'
                )}
              />
            </button>
            {includeBreaks && (
              <select
                value={breakDuration}
                onChange={(e) => setBreakDuration(Number(e.target.value))}
                className="h-10 rounded-md border bg-background px-3 text-sm"
              >
                {BREAK_DURATION_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            )}
          </div>
        </div>
      </div>

      {/* Preview */}
      {preview.length > 0 && (
        <div className="space-y-2">
          <Label>Preview ({preview.filter(s => !s.isBreak).length} sessions, {preview.filter(s => s.isBreak).length} breaks)</Label>
          <div className="rounded-lg border bg-muted/30 p-3 max-h-48 overflow-y-auto">
            <div className="space-y-1.5">
              {preview.map((slot, index) => (
                <div
                  key={index}
                  className={cn(
                    'flex items-center justify-between text-sm px-2 py-1 rounded',
                    slot.isBreak ? 'bg-amber-100 dark:bg-amber-950/30 text-amber-700 dark:text-amber-300' : 'bg-background'
                  )}
                >
                  <span>
                    {formatTime(slot.startTime)} - {formatTime(slot.endTime)}
                  </span>
                  {slot.isBreak && (
                    <Badge variant="secondary" className="text-xs">
                      <Coffee className="h-3 w-3 mr-1" />
                      Break
                    </Badge>
                  )}
                </div>
              ))}
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Slots for {selectedVenue?.name} on {eventDays.find(d => d.date === dayDate)?.label}
          </p>
        </div>
      )}

      {startHour >= endHour && (
        <p className="text-sm text-destructive">End hour must be after start hour</p>
      )}

      <div className="flex gap-3 pt-2">
        <Button
          onClick={() => onGenerate(preview)}
          disabled={preview.length === 0}
        >
          <Zap className="h-4 w-4 mr-2" />
          Generate {preview.filter(s => !s.isBreak).length} Slots
        </Button>
        <Button variant="outline" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  )
}
```

**Step 2: Commit**

```bash
git add src/components/admin/BulkSlotGenerator.tsx
git commit -m "feat(admin): Create reusable BulkSlotGenerator component

Extracted from wizard for use in admin setup page."
```

#### Task B4.2: Integrate BulkSlotGenerator into Admin Setup

**Files:**
- Modify: `src/app/e/[slug]/admin/setup/page.tsx`

**Step 1: Import the component**

Add at top of file:
```typescript
import { BulkSlotGenerator } from '@/components/admin/BulkSlotGenerator'
```

**Step 2: Add state for bulk generator modal**

After line 99, add:
```typescript
const [showBulkGenerator, setShowBulkGenerator] = React.useState(false)
```

**Step 3: Add bulk generate handler**

After `handleDeleteTimeSlot` function, add:

```typescript
const handleBulkGenerate = async (slots: { venueId: string; dayDate: string; startTime: string; endTime: string; label: string; isBreak: boolean }[]) => {
  for (const slot of slots) {
    await handleAddTimeSlot(
      slot.venueId,
      slot.dayDate,
      slot.startTime,
      slot.endTime,
      slot.label,
      slot.isBreak ? 'break' : 'session',
      slot.isBreak
    )
  }
  setShowBulkGenerator(false)
}
```

**Step 4: Add Bulk Generate button and modal**

After the "Add Venue" button section (around line 379), add:

```typescript
{venues.length > 0 && (
  <Button
    variant="outline"
    onClick={() => setShowBulkGenerator(true)}
    disabled={showBulkGenerator}
  >
    <Zap className="h-4 w-4 mr-2" />
    Bulk Generate Slots
  </Button>
)}
```

**Step 5: Add the bulk generator modal**

After the venue form card, add:

```typescript
{/* Bulk Slot Generator */}
{showBulkGenerator && venues.length > 0 && (
  <Card className="border-primary/50">
    <CardHeader>
      <CardTitle className="text-lg">Bulk Generate Time Slots</CardTitle>
    </CardHeader>
    <CardContent>
      <BulkSlotGenerator
        venues={venues.map(v => ({ id: v.id, name: v.name, capacity: v.capacity }))}
        eventDays={eventDays}
        onGenerate={handleBulkGenerate}
        onCancel={() => setShowBulkGenerator(false)}
      />
    </CardContent>
  </Card>
)}
```

**Step 6: Add Zap import**

Add to imports: `Zap`

**Step 7: Commit**

```bash
git add src/app/e/[slug]/admin/setup/page.tsx
git commit -m "feat(admin): Add bulk slot generator to admin setup

Admins can now bulk-generate time slots like in the wizard."
```

---

## Phase C: Payment Infrastructure

### Task C5: Stripe Connect Integration

#### Task C5.1: Database Migration for Stripe Fields

**Files:**
- Create: `supabase/migrations/20260221000002_stripe_connect_fields.sql`

**Step 1: Write the migration**

```sql
-- Add Stripe Connect fields to events table
ALTER TABLE events ADD COLUMN IF NOT EXISTS stripe_account_id TEXT;
ALTER TABLE events ADD COLUMN IF NOT EXISTS stripe_account_status TEXT DEFAULT 'none'
  CHECK (stripe_account_status IN ('none', 'pending', 'active', 'restricted'));
```

**Step 2: Apply migration**

Run: `npx supabase db push`

**Step 3: Commit**

```bash
git add supabase/migrations/20260221000002_stripe_connect_fields.sql
git commit -m "feat(db): Add Stripe Connect fields to events table"
```

#### Task C5.2: Stripe Connect OAuth Endpoints

**Files:**
- Create: `src/app/api/v1/events/[slug]/stripe/connect/route.ts`
- Create: `src/app/api/v1/events/[slug]/stripe/callback/route.ts`

(Implementation details for Stripe OAuth - requires Stripe Connect setup)

**Note:** Full Stripe Connect implementation requires:
1. Stripe Connect account setup
2. OAuth redirect URLs configured
3. Webhook endpoints for account updates

This is a larger integration - create placeholder endpoints that explain requirements.

---

## Phase D: Scheduling Improvements

### Task D7: Add Expected Attendance to Session Proposals

**Files:**
- Modify: `src/app/e/[slug]/propose/page.tsx`

**Step 1: Add expected attendance field to form**

Add after the description field:

```typescript
<div className="space-y-2">
  <Label htmlFor="expected-attendance">Expected Attendance</Label>
  <select
    id="expected-attendance"
    value={expectedAttendance}
    onChange={(e) => setExpectedAttendance(e.target.value)}
    className="w-full h-10 rounded-md border bg-background px-3 text-sm"
  >
    <option value="">Select expected attendance...</option>
    <option value="10">Small (1-10 people)</option>
    <option value="25">Medium (10-25 people)</option>
    <option value="50">Large (25-50 people)</option>
    <option value="100">Very Large (50-100 people)</option>
    <option value="150">Auditorium (100+ people)</option>
  </select>
  <p className="text-xs text-muted-foreground">
    Helps organizers assign an appropriate venue
  </p>
</div>
```

**Step 2: Add state and include in submission**

**Step 3: Commit**

```bash
git add src/app/e/[slug]/propose/page.tsx
git commit -m "feat(proposals): Add expected attendance field

Helps organizers match sessions to appropriate venues."
```

### Task D8: Auto-Scheduler Capacity Check

**Files:**
- Modify: `src/app/e/[slug]/admin/schedule/page.tsx` (auto-schedule logic)

Add capacity validation in the auto-scheduling algorithm.

### Task D9: Test Data Generator

**Files:**
- Create: `src/app/api/v1/events/[slug]/admin/seed-sessions/route.ts`

**Step 1: Create seed endpoint**

```typescript
/**
 * Generate test sessions for auto-scheduler testing
 * POST - Create 25-30 test sessions with varied constraints
 * DELETE - Remove seeded test sessions
 */

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { getUserFromRequest } from '@/lib/api/getUser'

const TEST_SESSIONS = [
  // Time slot conflicts (5 sessions wanting morning keynote)
  { title: 'Opening Keynote: The Future of DAOs', expectedAttendance: 100, trackPreference: 'governance' },
  { title: 'Morning Meditation & Intention Setting', expectedAttendance: 50, trackPreference: null },
  { title: 'Breakfast Discussion: Web3 Ethics', expectedAttendance: 30, trackPreference: 'culture' },
  { title: 'Early Bird Workshop: Solidity Basics', expectedAttendance: 40, trackPreference: 'technical' },
  { title: 'Dawn Yoga for Builders', expectedAttendance: 25, trackPreference: null },

  // Presenter conflicts (3 sessions by same person - will use first user as presenter)
  { title: 'Zero-Knowledge Proofs 101', expectedAttendance: 60, presenterConflict: 'presenter-a' },
  { title: 'Advanced ZK Circuits', expectedAttendance: 40, presenterConflict: 'presenter-a' },
  { title: 'ZK for Privacy Applications', expectedAttendance: 45, presenterConflict: 'presenter-a' },

  // Large venue requirements
  { title: 'Community Town Hall', expectedAttendance: 150, trackPreference: 'governance' },
  { title: 'Demo Day: Showcase Your Project', expectedAttendance: 120, trackPreference: null },
  { title: 'Panel: Scaling Ethereum', expectedAttendance: 100, trackPreference: 'technical' },
  { title: 'Fireside Chat: Founders Stories', expectedAttendance: 80, trackPreference: 'culture' },

  // Multi-slot workshops
  { title: 'Full-Stack DApp Workshop (Part 1)', expectedAttendance: 35, multiSlot: true, trackPreference: 'technical' },
  { title: 'Governance Design Workshop (Part 1)', expectedAttendance: 30, multiSlot: true, trackPreference: 'governance' },

  // Track-assigned sessions
  { title: 'Token Engineering Deep Dive', expectedAttendance: 40, trackPreference: 'technical' },
  { title: 'Smart Contract Security Patterns', expectedAttendance: 45, trackPreference: 'technical' },
  { title: 'DAO Treasury Management', expectedAttendance: 35, trackPreference: 'governance' },
  { title: 'Quadratic Funding Explained', expectedAttendance: 50, trackPreference: 'governance' },
  { title: 'Regenerative Finance Panel', expectedAttendance: 55, trackPreference: 'culture' },
  { title: 'Art & NFTs: Beyond Profile Pictures', expectedAttendance: 40, trackPreference: 'culture' },

  // Flexible sessions
  { title: 'Lightning Talks: 5 Minute Pitches', expectedAttendance: 60, trackPreference: null },
  { title: 'Networking Lunch Discussion', expectedAttendance: 50, trackPreference: null },
  { title: 'Open Space: Bring Your Topic', expectedAttendance: 30, trackPreference: null },
  { title: 'AMA: Ask the Core Team', expectedAttendance: 70, trackPreference: null },
  { title: 'Closing Circle & Reflections', expectedAttendance: 80, trackPreference: null },
  { title: 'Hackathon Project Showcase', expectedAttendance: 65, trackPreference: null },
  { title: 'Birds of a Feather: Find Your Tribe', expectedAttendance: 40, trackPreference: null },
  { title: 'Impromptu Sessions Board', expectedAttendance: 25, trackPreference: null },
]

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params

  const user = await getUserFromRequest(request)
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = await createAdminClient()

  // Get event and verify admin
  const { data: event } = await supabase
    .from('events')
    .select('id')
    .eq('slug', slug)
    .single()

  if (!event) {
    return NextResponse.json({ error: 'Event not found' }, { status: 404 })
  }

  const { data: membership } = await supabase
    .from('event_members')
    .select('role')
    .eq('event_id', event.id)
    .eq('user_id', user.id)
    .single()

  if (!membership || !['owner', 'admin'].includes(membership.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // Get tracks for assignment
  const { data: tracks } = await supabase
    .from('tracks')
    .select('id, name')
    .eq('event_id', event.id)

  const trackMap: Record<string, string> = {}
  tracks?.forEach(t => {
    const key = t.name.toLowerCase()
    if (key.includes('tech')) trackMap['technical'] = t.id
    if (key.includes('gov')) trackMap['governance'] = t.id
    if (key.includes('cult') || key.includes('commun')) trackMap['culture'] = t.id
  })

  // Create sessions
  const sessionsToCreate = TEST_SESSIONS.map((s, index) => ({
    event_id: event.id,
    title: s.title,
    description: `Test session ${index + 1} for auto-scheduler testing. Expected attendance: ${s.expectedAttendance}.`,
    status: 'approved',
    proposer_id: user.id,
    expected_attendance: s.expectedAttendance,
    track_id: s.trackPreference ? trackMap[s.trackPreference] || null : null,
    is_test_data: true, // Custom flag for cleanup
  }))

  const { data: created, error } = await supabase
    .from('sessions')
    .insert(sessionsToCreate)
    .select('id, title')

  if (error) {
    console.error('Error creating test sessions:', error)
    return NextResponse.json({ error: 'Failed to create sessions' }, { status: 500 })
  }

  return NextResponse.json({
    success: true,
    created: created?.length || 0,
    message: `Created ${created?.length} test sessions`,
  })
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params

  const user = await getUserFromRequest(request)
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = await createAdminClient()

  // Get event and verify admin
  const { data: event } = await supabase
    .from('events')
    .select('id')
    .eq('slug', slug)
    .single()

  if (!event) {
    return NextResponse.json({ error: 'Event not found' }, { status: 404 })
  }

  // Delete test sessions
  const { error } = await supabase
    .from('sessions')
    .delete()
    .eq('event_id', event.id)
    .eq('is_test_data', true)

  if (error) {
    console.error('Error deleting test sessions:', error)
    return NextResponse.json({ error: 'Failed to delete' }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
```

**Step 2: Add is_test_data column migration**

```sql
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS is_test_data BOOLEAN DEFAULT FALSE;
```

**Step 3: Add UI button in admin page**

**Step 4: Commit**

```bash
git add supabase/migrations/20260221000003_add_test_data_flag.sql src/app/api/v1/events/[slug]/admin/seed-sessions/route.ts
git commit -m "feat(admin): Add test data generator for auto-scheduler

Creates 25-30 test sessions with varied scheduling constraints."
```

---

## Summary Checklist

- [ ] A1: Fix broadcast API 401
- [ ] B3.1: Event invitations migration
- [ ] B3.2: Invitations API endpoints
- [ ] B3.3: Delete/revoke endpoint
- [ ] B3.4: Accept invitation endpoint
- [ ] B3.5: Invitation acceptance page
- [ ] B3.6: Admin members page
- [ ] B4.1: BulkSlotGenerator component
- [ ] B4.2: Integrate into admin setup
- [ ] C5.1: Stripe Connect migration
- [ ] C5.2: Stripe OAuth endpoints (placeholder)
- [ ] C6: Revenue dashboard enhancement
- [ ] D7: Expected attendance field
- [ ] D8: Auto-scheduler capacity check
- [ ] D9: Test data generator
