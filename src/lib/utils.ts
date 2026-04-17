import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// Supported voting mechanisms. Kept in sync with VotingMechanism in useWizardState
// and the voting_mechanism column constraint in the events table.
export type VotingMechanism = 'quadratic' | 'linear' | 'approval'

// Cost of casting `votes` votes on a single session for the given mechanism.
// - quadratic: votes^2 (default)
// - linear: votes (1 credit per vote)
// - approval: 0 or 1 (any positive vote count counts as a single approval)
export function votesToCredits(
  votes: number,
  mechanism: VotingMechanism = 'quadratic'
): number {
  if (votes <= 0) return 0
  switch (mechanism) {
    case 'linear':
      return votes
    case 'approval':
      return 1
    case 'quadratic':
    default:
      return votes * votes
  }
}

// Max votes a user can cast on a single session with `credits` available
// credits.
export function maxVotesWithCredits(
  credits: number,
  mechanism: VotingMechanism = 'quadratic'
): number {
  if (credits <= 0) return 0
  switch (mechanism) {
    case 'linear':
      return Math.floor(credits)
    case 'approval':
      // Approval voting is per-session binary; if the user can afford one
      // approval (1 credit) they can cast a vote on this session.
      return credits >= 1 ? 1 : 0
    case 'quadratic':
    default:
      return Math.floor(Math.sqrt(credits))
  }
}

// Inverse helper kept for callers doing rough estimates. Mechanism-aware.
export function creditsToVotes(
  credits: number,
  mechanism: VotingMechanism = 'quadratic'
): number {
  return maxVotesWithCredits(credits, mechanism)
}

// Cost of adding one more vote on top of `currentVotes` under the given
// mechanism.
export function nextVoteCost(
  currentVotes: number,
  mechanism: VotingMechanism = 'quadratic'
): number {
  return (
    votesToCredits(currentVotes + 1, mechanism) -
    votesToCredits(currentVotes, mechanism)
  )
}
