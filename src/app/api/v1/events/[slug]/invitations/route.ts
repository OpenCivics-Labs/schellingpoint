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
    inviteUrl: created && created.length === 1 && !created[0].email
      ? `${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3001'}/invite/e/${created[0].token}`
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
