/**
 * Seed random votes for test sessions
 * Run with: npx tsx scripts/seed-test-votes.ts
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

const EVENT_SLUG = 'test-unconference-2026'

async function seedTestVotes() {
  console.log('Starting test votes seed...')

  // 1. Get the test event
  const { data: event, error: eventError } = await supabase
    .from('events')
    .select('id')
    .eq('slug', EVENT_SLUG)
    .single()

  if (eventError || !event) {
    console.error(`Event ${EVENT_SLUG} not found. Run seed-test-event.ts first.`)
    process.exit(1)
  }

  console.log(`Found event: ${event.id}`)

  // 2. Get all sessions for the event
  const { data: sessions, error: sessionsError } = await supabase
    .from('sessions')
    .select('id, title')
    .eq('event_id', event.id)

  if (sessionsError || !sessions || sessions.length === 0) {
    console.error('No sessions found for this event')
    process.exit(1)
  }

  console.log(`Found ${sessions.length} sessions`)

  // 3. Get the admin user (we'll use them as a voter)
  const { data: adminUser, error: userError } = await supabase
    .from('profiles')
    .select('id')
    .eq('email', 'benjamin@opencivics.co')
    .single()

  if (userError || !adminUser) {
    console.error('Admin user not found')
    process.exit(1)
  }

  // 4. Delete existing votes for this event (to allow re-running)
  const { error: deleteError } = await supabase
    .from('votes')
    .delete()
    .eq('event_id', event.id)

  if (deleteError) {
    console.error('Error deleting existing votes:', deleteError)
  } else {
    console.log('Cleared existing votes')
  }

  // 5. Create random votes for each session
  // Quadratic voting: credits_spent = vote_count^2
  const votes = sessions.map(session => {
    // Random vote count between 1 and 8 (credits: 1, 4, 9, 16, 25, 36, 49, 64)
    const voteCount = Math.floor(Math.random() * 8) + 1
    const creditsSpent = voteCount * voteCount

    return {
      user_id: adminUser.id,
      session_id: session.id,
      event_id: event.id,
      vote_count: voteCount,
      credits_spent: creditsSpent,
    }
  })

  const { data: createdVotes, error: votesError } = await supabase
    .from('votes')
    .insert(votes)
    .select()

  if (votesError) {
    console.error('Error creating votes:', votesError)
    process.exit(1)
  }

  console.log(`Created ${createdVotes?.length} votes`)

  // 6. Display the vote distribution
  console.log('\nVote distribution:')
  for (const session of sessions) {
    const vote = votes.find(v => v.session_id === session.id)
    console.log(`  ${session.title.substring(0, 40).padEnd(40)} - ${vote?.vote_count} votes (${vote?.credits_spent} credits)`)
  }

  // 7. Verify the session totals were updated by the trigger
  const { data: updatedSessions, error: verifyError } = await supabase
    .from('sessions')
    .select('title, total_votes, total_credits, voter_count')
    .eq('event_id', event.id)
    .order('total_votes', { ascending: false })

  if (!verifyError && updatedSessions) {
    console.log('\nSession rankings (by total votes):')
    updatedSessions.forEach((s, i) => {
      console.log(`  ${i + 1}. ${s.title.substring(0, 35).padEnd(35)} - ${s.total_votes} votes, ${s.total_credits} credits`)
    })
  }

  console.log('\n✅ Test votes seeded successfully!')
}

seedTestVotes().catch(console.error)
