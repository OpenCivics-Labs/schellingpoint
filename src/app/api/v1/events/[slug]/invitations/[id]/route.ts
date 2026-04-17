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
    .maybeSingle()

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
