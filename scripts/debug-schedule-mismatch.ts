/**
 * Debug script to compare time slots vs sessions data
 * Run with: npx tsx scripts/debug-schedule-mismatch.ts
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

async function debug() {
  const { data: event } = await supabase
    .from('events')
    .select('id')
    .eq('slug', 'test-unconference-2026')
    .single()

  if (!event) {
    console.log('Event not found')
    return
  }

  console.log('Event ID:', event.id)
  console.log('')

  // Get all time slots
  const { data: slots } = await supabase
    .from('time_slots')
    .select('id, day_date, start_time, end_time, is_break, venue_id')
    .eq('event_id', event.id)
    .order('start_time')

  // Get all sessions (any status)
  const { data: allSessions } = await supabase
    .from('sessions')
    .select('id, title, status, time_slot_id, venue_id')
    .eq('event_id', event.id)

  // Get scheduled sessions only
  const scheduledSessions = allSessions?.filter(s => s.status === 'scheduled') || []

  // Find sessions with valid time_slot_id
  const validSlotIds = new Set(slots?.map(s => s.id) || [])
  const sessionsWithValidSlot = scheduledSessions.filter(s => s.time_slot_id && validSlotIds.has(s.time_slot_id))
  const sessionsWithoutSlot = scheduledSessions.filter(s => !s.time_slot_id)
  const sessionsWithInvalidSlot = scheduledSessions.filter(s => s.time_slot_id && !validSlotIds.has(s.time_slot_id))

  // Get unique days
  const days = new Set(slots?.map(s => s.day_date).filter(Boolean) || [])
  const nonBreakSlots = slots?.filter(s => !s.is_break) || []

  console.log('=== TIME SLOTS ===')
  console.log('Total time slots:', slots?.length || 0)
  console.log('  - Non-break slots:', nonBreakSlots.length)
  console.log('  - Break slots:', (slots?.length || 0) - nonBreakSlots.length)
  console.log('Days covered:', Array.from(days).sort().join(', '))
  console.log('')

  console.log('=== SESSIONS ===')
  console.log('Total sessions:', allSessions?.length || 0)

  const byStatus: Record<string, number> = {}
  allSessions?.forEach(s => {
    byStatus[s.status] = (byStatus[s.status] || 0) + 1
  })
  Object.entries(byStatus).forEach(([status, count]) => {
    console.log(`  - ${status}: ${count}`)
  })
  console.log('')

  console.log('=== SCHEDULED SESSIONS ANALYSIS ===')
  console.log('Scheduled sessions total:', scheduledSessions.length)
  console.log('  - With valid time_slot_id:', sessionsWithValidSlot.length)
  console.log('  - Without time_slot_id:', sessionsWithoutSlot.length)
  console.log('  - With INVALID time_slot_id:', sessionsWithInvalidSlot.length)

  if (sessionsWithInvalidSlot.length > 0) {
    console.log('\n⚠️  Sessions with INVALID slot references (slot doesn\'t exist):')
    sessionsWithInvalidSlot.forEach(s => {
      console.log(`  - ${s.title.substring(0, 40)} (slot: ${s.time_slot_id})`)
    })
  }

  if (sessionsWithoutSlot.length > 0) {
    console.log('\n⚠️  Scheduled sessions WITHOUT time_slot_id:')
    sessionsWithoutSlot.forEach(s => {
      console.log(`  - ${s.title}`)
    })
  }

  // Check slot occupancy
  console.log('\n=== SLOT OCCUPANCY ===')
  const slotOccupancy = new Map<string, string[]>()
  sessionsWithValidSlot.forEach(s => {
    if (!slotOccupancy.has(s.time_slot_id!)) {
      slotOccupancy.set(s.time_slot_id!, [])
    }
    slotOccupancy.get(s.time_slot_id!)!.push(s.title)
  })

  const occupiedSlots = slotOccupancy.size
  const emptySlots = nonBreakSlots.length - occupiedSlots
  console.log('Occupied non-break slots:', occupiedSlots)
  console.log('Empty non-break slots:', emptySlots)

  // Check for double-booked slots
  const doubleBooked = Array.from(slotOccupancy.entries()).filter(([_, sessions]) => sessions.length > 1)
  if (doubleBooked.length > 0) {
    console.log('\n⚠️  Double-booked slots:')
    doubleBooked.forEach(([slotId, sessions]) => {
      console.log(`  Slot ${slotId}:`)
      sessions.forEach(title => console.log(`    - ${title}`))
    })
  }
}

debug().catch(console.error)
