/**
 * Admin Ticketing Settings API
 *
 * GET  → returns ticketing_enabled + stripe_account_id + platform stripe status
 * POST → updates ticketing_enabled (and in the future, stripe_account_id)
 *
 * Authorization: user must be owner or admin of the event.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { getUserFromRequest } from '@/lib/api/getUser'

const ALLOWED_ROLES = ['owner', 'admin']

async function assertAdmin(request: NextRequest, slug: string) {
  const user = await getUserFromRequest(request)
  if (!user) {
    return { ok: false as const, response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  }

  const supabase = await createAdminClient()
  const { data: event } = await supabase
    .from('events')
    .select('id, slug, name, ticketing_enabled, stripe_account_id')
    .eq('slug', slug)
    .maybeSingle()

  if (!event) {
    return { ok: false as const, response: NextResponse.json({ error: 'Event not found' }, { status: 404 }) }
  }

  const { data: membership } = await supabase
    .from('event_members')
    .select('role')
    .eq('event_id', event.id)
    .eq('user_id', user.id)
    .maybeSingle()

  if (!membership || !ALLOWED_ROLES.includes(membership.role)) {
    return { ok: false as const, response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  }

  return { ok: true as const, user, event, supabase }
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params
  const auth = await assertAdmin(request, slug)
  if (!auth.ok) return auth.response

  return NextResponse.json({
    ticketing_enabled: auth.event.ticketing_enabled,
    stripe_account_id: auth.event.stripe_account_id,
    platform_stripe_configured: Boolean(process.env.STRIPE_SECRET_KEY),
    webhook_configured: Boolean(process.env.STRIPE_WEBHOOK_SECRET),
  })
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params
  const auth = await assertAdmin(request, slug)
  if (!auth.ok) return auth.response

  let body: { ticketing_enabled?: boolean; stripe_account_id?: string | null } = {}
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const updates: Record<string, unknown> = {}
  if (typeof body.ticketing_enabled === 'boolean') {
    updates.ticketing_enabled = body.ticketing_enabled
  }
  if (body.stripe_account_id !== undefined) {
    // Accept null to clear, otherwise require a plausible format
    if (
      body.stripe_account_id !== null &&
      (typeof body.stripe_account_id !== 'string' || !body.stripe_account_id.startsWith('acct_'))
    ) {
      return NextResponse.json(
        { error: "stripe_account_id must start with 'acct_'" },
        { status: 400 },
      )
    }
    updates.stripe_account_id = body.stripe_account_id
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'No updates provided' }, { status: 400 })
  }

  const { data: updated, error } = await auth.supabase
    .from('events')
    .update(updates)
    .eq('id', auth.event.id)
    .select('ticketing_enabled, stripe_account_id')
    .single()

  if (error || !updated) {
    return NextResponse.json({ error: error?.message || 'Failed to update' }, { status: 500 })
  }

  return NextResponse.json({
    ticketing_enabled: updated.ticketing_enabled,
    stripe_account_id: updated.stripe_account_id,
    platform_stripe_configured: Boolean(process.env.STRIPE_SECRET_KEY),
    webhook_configured: Boolean(process.env.STRIPE_WEBHOOK_SECRET),
  })
}
