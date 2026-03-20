/**
 * Debug script to check test event data state
 * Run with: npx tsx scripts/debug-test-event.ts
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

  // Count time slots
  const { data: slots, count: slotCount } = await supabase
    .from('time_slots')
    .select('id, venue_id, is_break, day_date', { count: 'exact' })
    .eq('event_id', event.id)

  const nonBreakSlots = slots?.filter(s => !s.is_break) || []
  console.log('Time slots:', slotCount)
  console.log('Non-break slots:', nonBreakSlots.length)
  console.log('')

  // Count sessions by status
  const { data: sessions } = await supabase
    .from('sessions')
    .select('id, title, status, time_slot_id, venue_id')
    .eq('event_id', event.id)

  const byStatus: Record<string, number> = {}
  sessions?.forEach(s => {
    byStatus[s.status] = (byStatus[s.status] || 0) + 1
  })

  console.log('Sessions by status:')
  Object.entries(byStatus).forEach(([status, count]) => {
    console.log(`  ${status}: ${count}`)
  })
  console.log('')

  // Show scheduled sessions
  const scheduled = sessions?.filter(s => s.status === 'scheduled') || []
  console.log('Scheduled sessions:', scheduled.length)
  scheduled.forEach(s => {
    console.log(`  - ${s.title.substring(0, 40)} (slot: ${s.time_slot_id ? 'yes' : 'NO'}, venue: ${s.venue_id ? 'yes' : 'NO'})`)
  })
  console.log('')

  // Show sessions with status=scheduled but no slot
  const scheduledNoSlot = sessions?.filter(s => s.status === 'scheduled' && !s.time_slot_id) || []
  if (scheduledNoSlot.length > 0) {
    console.log('⚠️  BUG: Sessions marked scheduled but have no time_slot_id:')
    scheduledNoSlot.forEach(s => {
      console.log(`  - ${s.title}`)
    })
  }

  // Show approved sessions
  const approved = sessions?.filter(s => s.status === 'approved') || []
  console.log('Approved (unscheduled) sessions:', approved.length)
  approved.forEach(s => {
    console.log(`  - ${s.title.substring(0, 40)}`)
  })
}

debug().catch(console.error)
