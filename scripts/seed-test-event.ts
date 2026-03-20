/**
 * Seed a test event with full data for testing
 * Run with: npx tsx scripts/seed-test-event.ts
 *
 * Prerequisites:
 * - SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env.local
 * - benjamin@opencivics.co must exist as a user in the database
 */

import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'
import { join } from 'path'

// Load environment variables from .env.local manually
function loadEnvFile(path: string) {
  try {
    const content = readFileSync(path, 'utf-8')
    for (const line of content.split('\n')) {
      const trimmed = line.trim()
      if (trimmed && !trimmed.startsWith('#')) {
        const [key, ...valueParts] = trimmed.split('=')
        const value = valueParts.join('=')
        if (key && value) {
          process.env[key] = value
        }
      }
    }
  } catch (e) {
    // File doesn't exist, ignore
  }
}

loadEnvFile(join(process.cwd(), '.env.local'))

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false }
})

const ADMIN_EMAIL = 'benjamin@opencivics.co'
const EVENT_SLUG = 'test-unconference-2026'

async function seedTestEvent() {
  console.log('Starting test event seed...')

  // 1. Find or error if admin user doesn't exist
  const { data: adminUser, error: userError } = await supabase
    .from('profiles')
    .select('id')
    .eq('email', ADMIN_EMAIL)
    .single()

  if (userError || !adminUser) {
    console.error(`Admin user ${ADMIN_EMAIL} not found. Please sign up first.`)
    process.exit(1)
  }

  console.log(`Found admin user: ${adminUser.id}`)

  // 2. Check if event already exists
  let eventId: string
  const { data: existingEvent } = await supabase
    .from('events')
    .select('id')
    .eq('slug', EVENT_SLUG)
    .single()

  if (existingEvent) {
    console.log(`Event ${EVENT_SLUG} already exists. Using existing event.`)
    eventId = existingEvent.id
  } else {
    // Will be set after creating the event
    eventId = ''
  }

  // Calculate dates (used for both new events and time slots)
  const startDate = new Date()
  startDate.setDate(startDate.getDate() + 30) // 30 days from now
  const endDate = new Date(startDate)
  endDate.setDate(endDate.getDate() + 2) // 3-day event

  // Create event if it doesn't exist
  if (!existingEvent) {
    // 3. Create the event
    const { data: event, error: eventError } = await supabase
      .from('events')
      .insert({
        slug: EVENT_SLUG,
        name: 'Test Unconference 2026',
        tagline: 'A test event for Schelling Point development',
        description: 'This is a fully populated test event for testing all features of the Schelling Point platform.',
        start_date: startDate.toISOString().split('T')[0],
        end_date: endDate.toISOString().split('T')[0],
        timezone: 'America/Denver',
        location_name: 'Test Venue',
        location_address: '123 Test Street, Boulder, CO 80302',
        status: 'voting_open',
        vote_credits_per_user: 100,
        voting_opens_at: new Date().toISOString(),
        voting_closes_at: endDate.toISOString(),
        proposals_open_at: new Date().toISOString(),
        proposals_close_at: endDate.toISOString(),
        allowed_formats: ['talk', 'workshop', 'discussion', 'panel', 'demo'],
        allowed_durations: [30, 60, 90],
        max_proposals_per_user: 5,
        require_proposal_approval: false,
        created_by: adminUser.id,
        visibility: 'public',
        theme: {
          colors: {
            primary: '#6366f1',
          },
        },
      })
      .select()
      .single()

    if (eventError) {
      console.error('Error creating event:', eventError)
      process.exit(1)
    }

    console.log(`Created event: ${event.id}`)
    eventId = event.id

    // 4. Add admin as owner
    const { error: memberError } = await supabase
      .from('event_members')
      .insert({
        event_id: eventId,
        user_id: adminUser.id,
        role: 'owner',
        vote_credits: 100,
      })

    if (memberError) {
      console.error('Error adding member:', memberError)
    }
  }

  // 5. Create venues (if they don't exist)
  const { data: existingVenues } = await supabase
    .from('venues')
    .select('id, name')
    .eq('event_id', eventId)

  let createdVenues = existingVenues || []

  if (!existingVenues || existingVenues.length === 0) {
    const venues = [
      { name: 'Main Hall', capacity: 150 },
      { name: 'Workshop Room A', capacity: 40 },
      { name: 'Workshop Room B', capacity: 30 },
      { name: 'Breakout Room', capacity: 20 },
      { name: 'Outdoor Patio', capacity: 50 },
    ]

    const { data: newVenues, error: venueError } = await supabase
      .from('venues')
      .insert(
        venues.map((v) => ({
          event_id: eventId,
          name: v.name,
          capacity: v.capacity,
          slug: v.name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
          features: [],
        }))
      )
      .select()

    if (venueError) {
      console.error('Error creating venues:', venueError)
    } else {
      createdVenues = newVenues || []
      console.log(`Created ${createdVenues.length} venues`)
    }
  } else {
    console.log(`Venues already exist (${existingVenues.length} found)`)
  }

  // 6. Create tracks (if they don't exist)
  const { data: existingTracks } = await supabase
    .from('tracks')
    .select('id, name')
    .eq('event_id', eventId)

  let createdTracks = existingTracks || []

  if (!existingTracks || existingTracks.length === 0) {
    const tracks = [
      { name: 'Technology', color: '#3b82f6' },
      { name: 'Governance', color: '#10b981' },
      { name: 'Community', color: '#f59e0b' },
      { name: 'Culture', color: '#ec4899' },
    ]

    const { data: newTracks, error: trackError } = await supabase
      .from('tracks')
      .insert(
        tracks.map((t, i) => ({
          event_id: eventId,
          name: t.name,
          slug: t.name.toLowerCase(),
          color: t.color,
          display_order: i,
        }))
      )
      .select()

    if (trackError) {
      console.error('Error creating tracks:', trackError)
    } else {
      createdTracks = newTracks || []
      console.log(`Created ${createdTracks.length} tracks`)
    }
  } else {
    console.log(`Tracks already exist (${existingTracks.length} found)`)
  }

  // 7. Create time slots for each day (if they don't exist)
  const { data: existingTimeSlots } = await supabase
    .from('time_slots')
    .select('id')
    .eq('event_id', eventId)
    .limit(1)

  if ((!existingTimeSlots || existingTimeSlots.length === 0) && createdVenues && createdVenues.length > 0) {
    const timeSlots: any[] = []
    const days = [startDate, new Date(startDate.getTime() + 24*60*60*1000), endDate]

    for (const day of days) {
      const dayStr = day.toISOString().split('T')[0]

      for (const venue of createdVenues) {
        // Morning sessions
        timeSlots.push({
          event_id: eventId,
          venue_id: venue.id,
          day_date: dayStr,
          start_time: `${dayStr}T09:00:00Z`,
          end_time: `${dayStr}T10:00:00Z`,
          slot_type: 'session',
        })
        timeSlots.push({
          event_id: eventId,
          venue_id: venue.id,
          day_date: dayStr,
          start_time: `${dayStr}T10:15:00Z`,
          end_time: `${dayStr}T11:15:00Z`,
          slot_type: 'session',
        })
        timeSlots.push({
          event_id: eventId,
          venue_id: venue.id,
          day_date: dayStr,
          start_time: `${dayStr}T11:30:00Z`,
          end_time: `${dayStr}T12:30:00Z`,
          slot_type: 'session',
        })
        // Afternoon sessions
        timeSlots.push({
          event_id: eventId,
          venue_id: venue.id,
          day_date: dayStr,
          start_time: `${dayStr}T14:00:00Z`,
          end_time: `${dayStr}T15:00:00Z`,
          slot_type: 'session',
        })
        timeSlots.push({
          event_id: eventId,
          venue_id: venue.id,
          day_date: dayStr,
          start_time: `${dayStr}T15:15:00Z`,
          end_time: `${dayStr}T16:15:00Z`,
          slot_type: 'session',
        })
        timeSlots.push({
          event_id: eventId,
          venue_id: venue.id,
          day_date: dayStr,
          start_time: `${dayStr}T16:30:00Z`,
          end_time: `${dayStr}T17:30:00Z`,
          slot_type: 'session',
        })
      }
    }

    const { data: createdSlots, error: slotError } = await supabase
      .from('time_slots')
      .insert(timeSlots)
      .select()

    if (slotError) {
      console.error('Error creating time slots:', slotError)
    } else {
      console.log(`Created ${createdSlots?.length} time slots`)
    }
  } else if (existingTimeSlots && existingTimeSlots.length > 0) {
    console.log('Time slots already exist')
  }

  // 8. Create test sessions (if they don't exist)
  const { data: existingSessions } = await supabase
    .from('sessions')
    .select('id')
    .eq('event_id', eventId)
    .limit(1)

  if (!existingSessions || existingSessions.length === 0) {
    const testSessions = [
      { title: 'Opening Keynote: The Future of Unconferences', format: 'talk', duration: 60, expected_attendance: 100, track: 'Community' },
      { title: 'Introduction to Quadratic Voting', format: 'workshop', duration: 90, expected_attendance: 30, track: 'Governance' },
      { title: 'Building Better Communities', format: 'discussion', duration: 60, expected_attendance: 25, track: 'Community' },
      { title: 'Tech for Good Panel', format: 'panel', duration: 60, expected_attendance: 50, track: 'Technology' },
      { title: 'Demo: New Collaboration Tools', format: 'demo', duration: 30, expected_attendance: 40, track: 'Technology' },
      { title: 'Art & Technology Workshop', format: 'workshop', duration: 90, expected_attendance: 20, track: 'Culture' },
      { title: 'Local Governance Best Practices', format: 'talk', duration: 60, expected_attendance: 35, track: 'Governance' },
      { title: 'Community Building 101', format: 'workshop', duration: 60, expected_attendance: 25, track: 'Community' },
      { title: 'Open Source Sustainability', format: 'discussion', duration: 60, expected_attendance: 30, track: 'Technology' },
      { title: 'Cultural Exchange Session', format: 'discussion', duration: 60, expected_attendance: 20, track: 'Culture' },
      { title: 'Digital Democracy Tools', format: 'demo', duration: 30, expected_attendance: 45, track: 'Governance' },
      { title: 'Networking & Collaboration', format: 'discussion', duration: 60, expected_attendance: 50, track: 'Community' },
      { title: 'Innovation in Education', format: 'talk', duration: 60, expected_attendance: 40, track: 'Technology' },
      { title: 'Creative Coding Workshop', format: 'workshop', duration: 90, expected_attendance: 15, track: 'Culture' },
      { title: 'Closing Circle & Reflections', format: 'discussion', duration: 60, expected_attendance: 80, track: 'Community' },
    ]

    const trackMap = new Map(createdTracks?.map(t => [t.name, t.id]) || [])

    const { data: createdSessions, error: sessionError } = await supabase
      .from('sessions')
      .insert(
        testSessions.map(s => ({
          event_id: eventId,
          title: s.title,
          description: `This is a test session for "${s.title}". It explores important topics related to ${s.track.toLowerCase()} and community building.`,
          format: s.format,
          duration: s.duration,
          expected_attendance: s.expected_attendance,
          status: 'approved',
          host_id: adminUser.id,
          host_name: 'Test Host',
          track_id: trackMap.get(s.track) || null,
          topic_tags: [s.track.toLowerCase(), 'test'],
        }))
      )
      .select()

    if (sessionError) {
      console.error('Error creating sessions:', sessionError)
    } else {
      console.log(`Created ${createdSessions?.length} test sessions`)
    }
  } else {
    console.log('Sessions already exist')
  }

  // 9. Create ticket tiers (if they don't exist)
  const { data: existingTiers } = await supabase
    .from('ticket_tiers')
    .select('id')
    .eq('event_id', eventId)
    .limit(1)

  if (!existingTiers || existingTiers.length === 0) {
    const { data: createdTiers, error: tierError } = await supabase
      .from('ticket_tiers')
      .insert([
        {
          event_id: eventId,
          name: 'Early Bird',
          description: 'Limited early bird tickets',
          price_cents: 5000,
          currency: 'usd',
          quantity_total: 50,
          display_order: 0,
        },
        {
          event_id: eventId,
          name: 'General Admission',
          description: 'Standard admission',
          price_cents: 7500,
          currency: 'usd',
          quantity_total: 150,
          display_order: 1,
        },
        {
          event_id: eventId,
          name: 'VIP',
          description: 'VIP access with special perks',
          price_cents: 15000,
          currency: 'usd',
          quantity_total: 25,
          display_order: 2,
        },
      ])
      .select()

    if (tierError) {
      console.error('Error creating ticket tiers:', tierError)
    } else {
      console.log(`Created ${createdTiers?.length} ticket tiers`)
    }
  } else {
    console.log('Ticket tiers already exist')
  }

  console.log('\n✅ Test event seeded successfully!')
  console.log(`Event URL: /e/${EVENT_SLUG}`)
  console.log(`Admin: ${ADMIN_EMAIL}`)

  return eventId
}

seedTestEvent().catch(console.error)
