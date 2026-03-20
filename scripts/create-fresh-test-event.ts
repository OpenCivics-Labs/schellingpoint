/**
 * Create a fresh test event with clean data for testing auto-scheduler
 * Run with: npx tsx scripts/create-fresh-test-event.ts
 */

import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'
import { join } from 'path'

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
  } catch (e) {}
}

loadEnvFile(join(process.cwd(), '.env.local'))

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing env vars')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false }
})

// Get the user to make owner
async function getOwnerUser() {
  const { data } = await supabase
    .from('profiles')
    .select('id, email')
    .limit(1)
    .single()
  return data
}

async function createFreshTestEvent() {
  const owner = await getOwnerUser()
  if (!owner) {
    console.error('No user found to be owner')
    process.exit(1)
  }

  console.log(`Creating event with owner: ${owner.email}`)

  // Delete old test event if exists
  const { data: oldEvent } = await supabase
    .from('events')
    .select('id')
    .eq('slug', 'fresh-test-2026')
    .single()

  if (oldEvent) {
    console.log('Deleting old fresh-test-2026 event...')
    await supabase.from('events').delete().eq('id', oldEvent.id)
  }

  // Create new event
  const startDate = new Date()
  startDate.setDate(startDate.getDate() + 7) // Start in 7 days
  const endDate = new Date(startDate)
  endDate.setDate(endDate.getDate() + 1) // 2-day event

  const { data: event, error: eventError } = await supabase
    .from('events')
    .insert({
      name: 'Fresh Test Event 2026',
      slug: 'fresh-test-2026',
      description: 'A clean test event for auto-scheduler testing',
      start_date: startDate.toISOString().split('T')[0],
      end_date: endDate.toISOString().split('T')[0],
      location_name: 'Test Venue',
      timezone: 'America/Denver',
      status: 'published',
      visibility: 'public',
      created_by: owner.id,
    })
    .select()
    .single()

  if (eventError) {
    console.error('Error creating event:', eventError)
    process.exit(1)
  }

  console.log(`Created event: ${event.name} (${event.slug})`)

  // Add owner as event member
  await supabase.from('event_members').insert({
    event_id: event.id,
    user_id: owner.id,
    role: 'owner',
  })

  // Create 2 venues
  const venues = [
    { name: 'Main Hall', capacity: 100, is_primary: true },
    { name: 'Workshop Room', capacity: 30, is_primary: false },
  ]

  const { data: createdVenues } = await supabase
    .from('venues')
    .insert(venues.map(v => ({ ...v, event_id: event.id })))
    .select()

  console.log(`Created ${createdVenues?.length} venues`)

  // Create time slots for each day (3 slots per venue per day)
  const timeSlots: any[] = []
  const days = [startDate, endDate]
  const slotTimes = [
    { start: '09:00', end: '10:00' },
    { start: '10:30', end: '11:30' },
    { start: '14:00', end: '15:00' },
  ]

  for (const day of days) {
    const dayDate = day.toISOString().split('T')[0]
    for (const venue of createdVenues || []) {
      for (const slot of slotTimes) {
        timeSlots.push({
          event_id: event.id,
          venue_id: venue.id,
          day_date: dayDate,
          start_time: `${dayDate}T${slot.start}:00`,
          end_time: `${dayDate}T${slot.end}:00`,
          is_break: false,
          slot_type: 'unconference',
        })
      }
    }
    // Add one break per day
    timeSlots.push({
      event_id: event.id,
      venue_id: null,
      day_date: dayDate,
      start_time: `${dayDate}T12:00:00`,
      end_time: `${dayDate}T13:00:00`,
      is_break: true,
      label: 'Lunch Break',
      slot_type: 'break',
    })
  }

  await supabase.from('time_slots').insert(timeSlots)
  console.log(`Created ${timeSlots.length} time slots (${timeSlots.filter(s => !s.is_break).length} non-break)`)

  // Create 8 approved sessions (more than slots to test unassigned handling)
  const sessions = [
    { title: 'Intro to Quadratic Voting', format: 'talk', duration: 60, total_votes: 15 },
    { title: 'Community Building Workshop', format: 'workshop', duration: 60, total_votes: 12 },
    { title: 'Open Source Sustainability', format: 'discussion', duration: 60, total_votes: 10 },
    { title: 'Tech for Good Panel', format: 'panel', duration: 60, total_votes: 8 },
    { title: 'Creative Coding Demo', format: 'demo', duration: 60, total_votes: 7 },
    { title: 'Networking Session', format: 'discussion', duration: 60, total_votes: 5 },
    { title: 'Future of Work', format: 'talk', duration: 60, total_votes: 4 },
    { title: 'Closing Reflections', format: 'discussion', duration: 60, total_votes: 3 },
  ]

  const { data: createdSessions } = await supabase
    .from('sessions')
    .insert(sessions.map(s => ({
      ...s,
      event_id: event.id,
      status: 'approved',
      host_name: 'Test Host',
    })))
    .select()

  console.log(`Created ${createdSessions?.length} approved sessions`)

  // Add some votes for cluster analysis testing
  const { data: users } = await supabase
    .from('profiles')
    .select('id')
    .limit(5)

  if (users && users.length > 0 && createdSessions) {
    const votes: any[] = []

    // Create voting patterns - some users vote for similar sessions
    const votingPatterns = [
      { userIdx: 0, sessions: [0, 1, 2] }, // User 0 likes sessions 0, 1, 2
      { userIdx: 1, sessions: [0, 1, 3] }, // User 1 overlaps with user 0 on 0, 1
      { userIdx: 2, sessions: [4, 5, 6] }, // User 2 likes different sessions
      { userIdx: 3, sessions: [4, 5, 7] }, // User 3 overlaps with user 2
    ]

    for (const pattern of votingPatterns) {
      if (users[pattern.userIdx]) {
        for (const sessionIdx of pattern.sessions) {
          if (createdSessions[sessionIdx]) {
            votes.push({
              event_id: event.id,
              user_id: users[pattern.userIdx].id,
              session_id: createdSessions[sessionIdx].id,
              vote_count: Math.floor(Math.random() * 3) + 1,
              credits_spent: Math.floor(Math.random() * 9) + 1,
            })
          }
        }
      }
    }

    if (votes.length > 0) {
      await supabase.from('votes').insert(votes)
      console.log(`Created ${votes.length} votes for cluster analysis testing`)
    }
  }

  console.log('\n✅ Fresh test event created!')
  console.log(`   URL: /e/${event.slug}/admin`)
  console.log(`   ${createdSessions?.length} approved sessions ready to schedule`)
  console.log(`   ${timeSlots.filter(s => !s.is_break).length} available time slots`)
}

createFreshTestEvent().catch(console.error)
