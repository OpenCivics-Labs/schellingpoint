/**
 * Auto-Scheduling Algorithm
 *
 * A greedy algorithm that places sessions in optimal time slots.
 * Sessions are processed by vote count (highest first), and each
 * session is assigned to its highest-scoring available slot.
 *
 * Scoring criteria:
 * - Time preference match: +10
 * - Duration match: +8
 * - Venue features match: +6 (all required features present)
 * - Capacity fit: +5 (uses expected_attendance or falls back to total_votes)
 * - Track spread: +3 (avoid same track in same time)
 * - Primary venue bonus: +2 (popular sessions in main venue)
 */

export interface Session {
  id: string
  title: string
  duration: number
  total_votes: number
  expected_attendance: number | null
  status: 'pending' | 'approved' | 'rejected' | 'scheduled'
  time_slot_id: string | null
  venue_id: string | null
  track_id: string | null
  time_preferences: string[] | null
  required_features: string[] | null
}

export interface TimeSlot {
  id: string
  start_time: string
  end_time: string
  is_break: boolean
  venue_id: string | null
  day_date: string | null
  slot_type: string | null
}

export interface Venue {
  id: string
  name: string
  capacity: number | null
  is_primary: boolean
  features: string[] | null
}

export interface Vote {
  session_id: string
  user_id: string
  vote_count: number
}

export interface ScheduleAssignment {
  sessionId: string
  sessionTitle: string
  slotId: string
  venueId: string
  score: number
  warnings: string[]
}

export interface AutoScheduleResult {
  assignments: ScheduleAssignment[]
  unassigned: { sessionId: string; sessionTitle: string; reason: string }[]
  stats: {
    totalSessions: number
    assigned: number
    unassigned: number
    averageScore: number
  }
}

// Calculate slot duration in minutes
function getSlotDuration(slot: TimeSlot): number {
  const start = new Date(slot.start_time)
  const end = new Date(slot.end_time)
  return Math.round((end.getTime() - start.getTime()) / (1000 * 60))
}

// Get time preferences that match a day (e.g., "2024-02-20" -> ["tuesday_am", "tuesday_pm"])
function getDayPreferences(dayDate: string): string[] {
  const date = new Date(dayDate + 'T12:00:00')
  const dayOfWeek = date.getDay()
  const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
  const dayName = dayNames[dayOfWeek]
  return [`${dayName}_am`, `${dayName}_pm`]
}

// Determine if a time is AM or PM
function isAM(dateStr: string): boolean {
  const date = new Date(dateStr)
  return date.getUTCHours() < 12
}

// Build a map of session_id -> set of user_ids who voted for it
function buildVoterSets(votes: Vote[]): Map<string, Set<string>> {
  const voterSets = new Map<string, Set<string>>()
  for (const vote of votes) {
    if (!voterSets.has(vote.session_id)) {
      voterSets.set(vote.session_id, new Set())
    }
    voterSets.get(vote.session_id)!.add(vote.user_id)
  }
  return voterSets
}

// Calculate Jaccard similarity between two voter sets (0 to 1)
// Higher value means more overlap between voters
function calculateVoterOverlap(setA: Set<string>, setB: Set<string>): number {
  if (setA.size === 0 || setB.size === 0) return 0

  let intersection = 0
  // Convert to array to avoid downlevelIteration requirement
  Array.from(setA).forEach((voter) => {
    if (setB.has(voter)) intersection++
  })

  // Jaccard index: intersection / union
  const union = setA.size + setB.size - intersection
  return union > 0 ? intersection / union : 0
}

// Score a slot for a given session
function scoreSlot(
  session: Session,
  slot: TimeSlot,
  venue: Venue,
  occupiedSlots: Set<string>,
  trackAssignmentsInTimeRange: Map<string, Set<string>>, // timeRange -> trackIds
  sessionsInTimeRange: Map<string, string[]>, // timeRange -> sessionIds scheduled at that time
  voterSets: Map<string, Set<string>> // sessionId -> set of voter userIds
): { score: number; warnings: string[] } {
  // Skip if slot is already occupied
  if (occupiedSlots.has(slot.id)) {
    return { score: -1, warnings: [] }
  }

  // Skip if slot is a break
  if (slot.is_break) {
    return { score: -1, warnings: [] }
  }

  let score = 0
  const warnings: string[] = []

  // 1. Duration match (+8)
  const slotDuration = getSlotDuration(slot)
  if (session.duration === slotDuration) {
    score += 8
  } else if (Math.abs(session.duration - slotDuration) <= 15) {
    score += 4 // Partial credit for close match
    warnings.push(`Duration mismatch: session is ${session.duration}min, slot is ${slotDuration}min`)
  } else {
    score += 1 // Minimal credit
    warnings.push(`Duration mismatch: session is ${session.duration}min, slot is ${slotDuration}min`)
  }

  // 2. Time preference match (+10)
  if (session.time_preferences && session.time_preferences.length > 0 && slot.day_date) {
    const dayPrefs = getDayPreferences(slot.day_date)
    const timeOfDay = isAM(slot.start_time) ? '_am' : '_pm'

    const matchingPrefs = session.time_preferences.filter((pref) => {
      // Check if day matches
      const prefDay = pref.replace('_am', '').replace('_pm', '')
      const slotDayName = dayPrefs[0].replace('_am', '').replace('_pm', '')

      if (prefDay !== slotDayName) return false

      // Check if time of day matches
      return pref.endsWith(timeOfDay)
    })

    if (matchingPrefs.length > 0) {
      score += 10
    } else {
      // Partial credit if day matches but time doesn't
      const dayMatches = session.time_preferences.some((pref) =>
        dayPrefs.some((dp) => pref.replace('_am', '').replace('_pm', '') === dp.replace('_am', '').replace('_pm', ''))
      )
      if (dayMatches) {
        score += 3
      }
    }
  }

  // 3. Venue features match (+6)
  // Check if venue has all required features for this session
  if (session.required_features && session.required_features.length > 0) {
    const venueFeatures = new Set(venue.features || [])
    const missingFeatures = session.required_features.filter((f) => !venueFeatures.has(f))

    if (missingFeatures.length === 0) {
      score += 6 // All required features present
    } else if (missingFeatures.length <= 1) {
      score += 2 // Most features present
      warnings.push(`Missing feature: ${missingFeatures.join(', ')}`)
    } else {
      score += 0 // Many features missing
      warnings.push(`Missing features: ${missingFeatures.join(', ')}`)
    }
  } else {
    score += 3 // No specific features required, neutral
  }

  // 4. Capacity fit (+5)
  // Use expected_attendance if provided, otherwise fall back to total_votes as a proxy
  const estimatedAttendance = session.expected_attendance || session.total_votes || 0

  if (venue.capacity) {
    if (estimatedAttendance <= venue.capacity * 0.7) {
      score += 5 // Comfortable fit
    } else if (estimatedAttendance <= venue.capacity) {
      score += 3 // Tight fit
      warnings.push(`Venue may be tight: ~${estimatedAttendance} expected, ${venue.capacity} capacity`)
    } else {
      score += 0 // Over capacity - still allow but warn heavily
      warnings.push(`OVER CAPACITY: ~${estimatedAttendance} expected, ${venue.capacity} capacity`)
    }
  } else {
    score += 2 // Unknown capacity, neutral score
  }

  // 5. Track spread (+3)
  // Avoid scheduling same track in overlapping time slots
  const timeRangeKey = `${slot.start_time}-${slot.end_time}`
  if (session.track_id) {
    const tracksInRange = trackAssignmentsInTimeRange.get(timeRangeKey)

    if (!tracksInRange || !tracksInRange.has(session.track_id)) {
      score += 3 // Good - different track
    } else {
      warnings.push('Track conflict: same track scheduled at same time')
    }
  } else {
    score += 1 // No track, neutral
  }

  // 6. Voter overlap penalty (-4 to +4)
  // Avoid scheduling sessions with high voter overlap at the same time
  const sessionsAtSameTime = sessionsInTimeRange.get(timeRangeKey) || []
  const thisSessionVoters = voterSets.get(session.id)

  if (thisSessionVoters && thisSessionVoters.size > 0 && sessionsAtSameTime.length > 0) {
    let maxOverlap = 0
    let overlapSessionTitle = ''

    for (const otherSessionId of sessionsAtSameTime) {
      const otherVoters = voterSets.get(otherSessionId)
      if (otherVoters) {
        const overlap = calculateVoterOverlap(thisSessionVoters, otherVoters)
        if (overlap > maxOverlap) {
          maxOverlap = overlap
        }
      }
    }

    if (maxOverlap >= 0.5) {
      // High overlap (50%+) - significant penalty
      score -= 4
      warnings.push(`High voter overlap (${Math.round(maxOverlap * 100)}%) with another session at same time`)
    } else if (maxOverlap >= 0.3) {
      // Moderate overlap (30-50%) - small penalty
      score -= 2
      warnings.push(`Moderate voter overlap (${Math.round(maxOverlap * 100)}%) with another session at same time`)
    } else if (maxOverlap < 0.1) {
      // Low overlap - bonus for diverse scheduling
      score += 2
    }
  } else {
    score += 2 // No voter data or first session, neutral bonus
  }

  // 7. Primary venue bonus (+2)
  if (venue.is_primary && session.total_votes > 20) {
    score += 2 // Popular sessions in main venue
  }

  return { score, warnings }
}

/**
 * Auto-schedule approved sessions into available time slots.
 *
 * @param sessions - All sessions for the event
 * @param timeSlots - All time slots for the event
 * @param venues - All venues for the event
 * @param votes - Optional: voting data for cluster analysis (avoids scheduling overlapping voter bases at same time)
 */
export function autoSchedule(
  sessions: Session[],
  timeSlots: TimeSlot[],
  venues: Venue[],
  votes: Vote[] = []
): AutoScheduleResult {
  // Filter to only approved/unscheduled sessions
  const sessionsToSchedule = sessions
    .filter((s) => s.status === 'approved' && !s.time_slot_id)
    .sort((a, b) => b.total_votes - a.total_votes) // Highest votes first

  // Build venue lookup
  const venueMap = new Map<string, Venue>()
  venues.forEach((v) => venueMap.set(v.id, v))

  // Build session title lookup for voter overlap warnings
  const sessionTitleMap = new Map<string, string>()
  sessions.forEach((s) => sessionTitleMap.set(s.id, s.title))

  // Build voter sets for cluster analysis
  const voterSets = buildVoterSets(votes)

  // Available slots (non-break, with valid venue)
  const availableSlots = timeSlots.filter(
    (s) => !s.is_break && s.venue_id && venueMap.has(s.venue_id)
  )

  // Track assignments
  const occupiedSlots = new Set<string>()
  const trackAssignmentsInTimeRange = new Map<string, Set<string>>()
  const sessionsInTimeRange = new Map<string, string[]>() // timeRange -> sessionIds
  const assignments: ScheduleAssignment[] = []
  const unassigned: { sessionId: string; sessionTitle: string; reason: string }[] = []

  // Process each session
  for (const session of sessionsToSchedule) {
    let bestSlot: TimeSlot | null = null
    let bestVenue: Venue | null = null
    let bestScore = -1
    let bestWarnings: string[] = []

    // Score all available slots
    for (const slot of availableSlots) {
      if (occupiedSlots.has(slot.id)) continue

      const venue = venueMap.get(slot.venue_id!)
      if (!venue) continue

      const { score, warnings } = scoreSlot(
        session,
        slot,
        venue,
        occupiedSlots,
        trackAssignmentsInTimeRange,
        sessionsInTimeRange,
        voterSets
      )

      if (score > bestScore) {
        bestScore = score
        bestSlot = slot
        bestVenue = venue
        bestWarnings = warnings
      }
    }

    // Assign to best slot or mark as unassigned
    if (bestSlot && bestVenue && bestScore >= 0) {
      occupiedSlots.add(bestSlot.id)

      // Track assignment for track spread calculation
      const timeRangeKey = `${bestSlot.start_time}-${bestSlot.end_time}`
      if (session.track_id) {
        if (!trackAssignmentsInTimeRange.has(timeRangeKey)) {
          trackAssignmentsInTimeRange.set(timeRangeKey, new Set())
        }
        trackAssignmentsInTimeRange.get(timeRangeKey)!.add(session.track_id)
      }

      // Track session for voter overlap calculation
      if (!sessionsInTimeRange.has(timeRangeKey)) {
        sessionsInTimeRange.set(timeRangeKey, [])
      }
      sessionsInTimeRange.get(timeRangeKey)!.push(session.id)

      assignments.push({
        sessionId: session.id,
        sessionTitle: session.title,
        slotId: bestSlot.id,
        venueId: bestVenue.id,
        score: bestScore,
        warnings: bestWarnings,
      })
    } else {
      unassigned.push({
        sessionId: session.id,
        sessionTitle: session.title,
        reason: 'No available slots match session requirements',
      })
    }
  }

  // Calculate stats
  const averageScore =
    assignments.length > 0
      ? assignments.reduce((sum, a) => sum + a.score, 0) / assignments.length
      : 0

  return {
    assignments,
    unassigned,
    stats: {
      totalSessions: sessionsToSchedule.length,
      assigned: assignments.length,
      unassigned: unassigned.length,
      averageScore: Math.round(averageScore * 100) / 100,
    },
  }
}
