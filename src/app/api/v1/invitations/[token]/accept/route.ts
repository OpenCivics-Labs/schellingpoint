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

  // Check if already accepted (only for email-specific invitations)
  if (invitation.email && invitation.accepted_at) {
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

  // If email-specific, verify email matches.
  // Check the user's profile email first, then fall back to auth.users email
  // (which is the source of truth since we require email auth).
  if (invitation.email) {
    let userEmail: string | null = null

    const { data: profile } = await supabase
      .from('profiles')
      .select('email')
      .eq('id', user.id)
      .maybeSingle()

    userEmail = profile?.email ?? null

    // Fallback to auth user email (always present)
    if (!userEmail && user.email) {
      userEmail = user.email
    }

    if (!userEmail || userEmail.toLowerCase() !== invitation.email.toLowerCase()) {
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
    .maybeSingle()

  if (existingMember) {
    // Mark invitation as accepted anyway (for email invitations)
    if (invitation.email) {
      await supabase
        .from('event_invitations')
        .update({ accepted_at: new Date().toISOString() })
        .eq('id', invitation.id)
    }

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
