/**
 * Admin Session Emails API
 *
 * Consolidates session-related email actions for an event admin:
 *  - GET:  Returns counts and recent activity for session emails
 *  - POST action=notify-scheduled-hosts: Sends schedule-notification emails to
 *    all scheduled sessions in this event whose hosts haven't been notified.
 *  - POST action=resend-approval-emails: Re-queues session_approved notifications
 *    for approved sessions whose hosts haven't been emailed yet, then dispatches.
 *
 * Authorization: user must be owner/admin/moderator of the event.
 */

import { NextRequest, NextResponse } from 'next/server'
import { Resend } from 'resend'
import { createAdminClient } from '@/lib/supabase/server'
import { getUserFromRequest } from '@/lib/api/getUser'
import { buildSessionScheduledEmail } from '@/lib/email/session-scheduled'
import {
  buildSessionApprovedEmail,
  buildSessionRejectedEmail,
} from '@/lib/email/notification-emails'

const ALLOWED_ROLES = ['owner', 'admin', 'moderator']

let _resend: Resend | null = null
function getResend() {
  if (!_resend) _resend = new Resend(process.env.RESEND_API_KEY)
  return _resend
}

async function assertAdmin(
  request: NextRequest,
  slug: string,
): Promise<
  | { ok: true; user: { id: string }; event: { id: string; slug: string; name: string; start_date: string | null; end_date: string | null; location_name: string | null; logo_url: string | null; timezone: string | null } }
  | { ok: false; response: NextResponse }
> {
  const user = await getUserFromRequest(request)
  if (!user) {
    return { ok: false, response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  }

  const supabase = await createAdminClient()
  const { data: event } = await supabase
    .from('events')
    .select('id, slug, name, start_date, end_date, location_name, logo_url, timezone')
    .eq('slug', slug)
    .maybeSingle()

  if (!event) {
    return { ok: false, response: NextResponse.json({ error: 'Event not found' }, { status: 404 }) }
  }

  const { data: membership } = await supabase
    .from('event_members')
    .select('role')
    .eq('event_id', event.id)
    .eq('user_id', user.id)
    .maybeSingle()

  if (!membership || !ALLOWED_ROLES.includes(membership.role)) {
    return { ok: false, response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  }

  return { ok: true, user: { id: user.id }, event }
}

// ============================================================================
// GET: stats
// ============================================================================
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params
  const auth = await assertAdmin(request, slug)
  if (!auth.ok) return auth.response

  const supabase = await createAdminClient()
  const eventId = auth.event.id

  // Scheduled sessions not yet host-notified
  const { data: scheduledSessions } = await supabase
    .from('sessions')
    .select('id, title, host_id, host_notified_at, status, time_slot_id, venue_id')
    .eq('event_id', eventId)
    .eq('status', 'scheduled')

  const unnotifiedScheduled = (scheduledSessions || []).filter((s) => !s.host_notified_at)

  // Approval emails queued but not yet sent (in notifications table)
  const { data: pendingApproval } = await supabase
    .from('notifications')
    .select('id, type, created_at')
    .eq('event_id', eventId)
    .in('type', ['session_approved', 'session_rejected', 'session_scheduled'])
    .is('email_sent_at', null)

  return NextResponse.json({
    scheduled_total: scheduledSessions?.length ?? 0,
    scheduled_unnotified: unnotifiedScheduled.length,
    scheduled_unnotified_sessions: unnotifiedScheduled.map((s) => ({
      id: s.id,
      title: s.title,
    })),
    pending_email_notifications: pendingApproval?.length ?? 0,
  })
}

// ============================================================================
// POST: actions
// ============================================================================
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params
  const auth = await assertAdmin(request, slug)
  if (!auth.ok) return auth.response

  let body: { action?: string; sessionIds?: string[] } = {}
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const action = body.action
  if (!action) {
    return NextResponse.json({ error: 'action is required' }, { status: 400 })
  }

  if (action === 'notify-scheduled-hosts') {
    return handleNotifyScheduled(slug, auth.event.id, body.sessionIds)
  }

  if (action === 'dispatch-queue') {
    return handleDispatchQueue(auth.event)
  }

  return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 })
}

// ============================================================================
// Handlers
// ============================================================================

async function handleNotifyScheduled(slug: string, eventId: string, specificIds?: string[]) {
  const supabase = await createAdminClient()

  const query = supabase
    .from('sessions')
    .select(`
      id, title, status, host_notified_at, host_id, event_id,
      host:profiles!host_id(email, display_name),
      venue:venues(name, address),
      time_slot:time_slots(start_time, end_time, day_date, label),
      track:tracks(name, color),
      event:events(id, slug, name, start_date, end_date, timezone, location_name)
    `)
    .eq('event_id', eventId)
    .eq('status', 'scheduled')
    .is('host_notified_at', null)

  const { data: sessions, error } = specificIds && specificIds.length > 0
    ? await query.in('id', specificIds)
    : await query

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  if (!sessions || sessions.length === 0) {
    return NextResponse.json({ sent: 0, message: 'No scheduled sessions awaiting notification.' })
  }

  const fromEmail = process.env.RESEND_FROM_EMAIL || 'hello@schellingpoint.city'

  let sent = 0
  let skipped = 0
  const errors: string[] = []

  for (const session of sessions) {
    const host = extractOne<{ email: string; display_name: string | null }>(session.host)
    if (!host?.email) {
      skipped++
      continue
    }

    const venue = extractOne<{ name: string; address: string | null }>(session.venue)
    const timeSlot = extractOne<{ start_time: string; end_time: string; day_date: string | null; label: string | null }>(session.time_slot)
    const track = extractOne<{ name: string; color: string | null }>(session.track)
    const event = extractOne<{ id: string; slug: string; name: string; start_date: string | null; end_date: string | null; timezone: string | null; location_name: string | null }>(session.event)

    const eventTimezone = event?.timezone || 'UTC'
    const startDate = timeSlot?.start_time ? new Date(timeSlot.start_time) : null
    const endDate = timeSlot?.end_time ? new Date(timeSlot.end_time) : null

    const dateString = startDate
      ? startDate.toLocaleDateString('en-US', {
          weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: eventTimezone,
        })
      : 'TBD'

    const tzAbbr = startDate
      ? startDate.toLocaleTimeString('en-US', { timeZone: eventTimezone, timeZoneName: 'short' }).split(' ').pop()
      : ''

    const timeString = startDate && endDate
      ? `${startDate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: eventTimezone })} – ${endDate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: eventTimezone })}${tzAbbr ? ` ${tzAbbr}` : ''}`
      : 'TBD'

    let eventDateRange: string | undefined
    if (event?.start_date && event?.end_date) {
      const s = new Date(event.start_date)
      const e = new Date(event.end_date)
      const sm = s.toLocaleDateString('en-US', { month: 'long', timeZone: 'UTC' })
      const em = e.toLocaleDateString('en-US', { month: 'long', timeZone: 'UTC' })
      const sd = s.getUTCDate()
      const ed = e.getUTCDate()
      const y = s.getUTCFullYear()
      eventDateRange = sm === em ? `${sm} ${sd}-${ed}, ${y}` : `${sm} ${sd} - ${em} ${ed}, ${y}`
    }

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://schellingpoint.city'
    const sessionUrl = event?.slug
      ? `${appUrl}/e/${event.slug}/sessions/${session.id}`
      : `${appUrl}/sessions/${session.id}`

    const { subject, html } = buildSessionScheduledEmail({
      sessionTitle: session.title,
      hostName: host.display_name || 'there',
      venueName: venue?.name || 'TBD',
      venueAddress: venue?.address || null,
      dateString,
      timeString,
      trackName: track?.name || null,
      trackColor: track?.color || null,
      sessionUrl,
      eventName: event?.name || 'Schelling Point',
      eventDateRange,
      eventLocation: event?.location_name || undefined,
    })

    const fromName = event?.name || 'Schelling Point'
    const { error: sendError } = await getResend().emails.send({
      from: `${fromName} <${fromEmail}>`,
      to: host.email,
      subject,
      html,
    })

    if (sendError) {
      errors.push(`${session.title}: ${sendError.message}`)
      continue
    }

    await supabase
      .from('sessions')
      .update({ host_notified_at: new Date().toISOString() })
      .eq('id', session.id)

    sent++
  }

  return NextResponse.json({
    sent,
    skipped,
    total: sessions.length,
    errors: errors.slice(0, 10),
  })
}

async function handleDispatchQueue(event: { id: string; slug: string; name: string; start_date: string | null; end_date: string | null; location_name: string | null; logo_url: string | null }) {
  const supabase = await createAdminClient()

  const { data: notifications } = await supabase
    .from('notifications')
    .select('id, user_id, type, title, body, data, action_url, email_sent_at')
    .eq('event_id', event.id)
    .in('type', ['session_approved', 'session_rejected'])
    .is('email_sent_at', null)
    .order('created_at', { ascending: true })
    .limit(100)

  if (!notifications || notifications.length === 0) {
    return NextResponse.json({ sent: 0, message: 'No queued approval/rejection emails.' })
  }

  const fromEmail = process.env.RESEND_FROM_EMAIL || 'hello@schellingpoint.city'
  const fromName = event.name || 'Schelling Point'

  const eventInfo = {
    name: event.name,
    slug: event.slug,
    logoUrl: event.logo_url || undefined,
    dateRange: formatEventDateRange(event.start_date, event.end_date),
    location: event.location_name || undefined,
  }

  let sent = 0
  let skipped = 0
  const errors: string[] = []

  for (const notif of notifications) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('email, display_name')
      .eq('id', notif.user_id)
      .maybeSingle()

    if (!profile?.email) {
      await supabase.from('notifications').update({ email_sent_at: new Date().toISOString() }).eq('id', notif.id)
      skipped++
      continue
    }

    const recipientName = profile.display_name || 'there'
    const data = notif.data || {}

    let email: { subject: string; html: string } | null = null
    if (notif.type === 'session_approved') {
      email = buildSessionApprovedEmail({
        event: eventInfo,
        hostName: recipientName,
        sessionTitle: (data.session_title as string) || notif.title,
        sessionId: data.session_id as string,
      })
    } else if (notif.type === 'session_rejected') {
      email = buildSessionRejectedEmail({
        event: eventInfo,
        hostName: recipientName,
        sessionTitle: (data.session_title as string) || notif.title,
        sessionId: data.session_id as string,
        reason: data.reason as string | undefined,
      })
    }

    if (!email) {
      skipped++
      continue
    }

    const { error: sendError } = await getResend().emails.send({
      from: `${fromName} <${fromEmail}>`,
      to: profile.email,
      subject: email.subject,
      html: email.html,
    })

    if (sendError) {
      errors.push(`${notif.title}: ${sendError.message}`)
      continue
    }

    await supabase.from('notifications').update({ email_sent_at: new Date().toISOString() }).eq('id', notif.id)
    sent++
  }

  return NextResponse.json({ sent, skipped, total: notifications.length, errors: errors.slice(0, 10) })
}

// ============================================================================
// Utilities
// ============================================================================

function extractOne<T>(value: unknown): T | null {
  if (!value) return null
  if (Array.isArray(value)) return (value[0] as T) ?? null
  return value as T
}

function formatEventDateRange(startDate: string | null, endDate: string | null): string | undefined {
  if (!startDate || !endDate) return undefined
  const s = new Date(startDate)
  const e = new Date(endDate)
  const sm = s.toLocaleDateString('en-US', { month: 'long', timeZone: 'UTC' })
  const em = e.toLocaleDateString('en-US', { month: 'long', timeZone: 'UTC' })
  const sd = s.getUTCDate()
  const ed = e.getUTCDate()
  const y = s.getUTCFullYear()
  return sm === em ? `${sm} ${sd}-${ed}, ${y}` : `${sm} ${sd} - ${em} ${ed}, ${y}`
}
