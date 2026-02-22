import { test, expect, Page } from '@playwright/test'

const BASE_URL = 'http://localhost:3001'
const SUPABASE_URL = 'http://localhost:54321'
const MAILPIT_URL = 'http://127.0.0.1:54324'
const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'

// Helper to get magic link from Mailpit
async function getMagicLink(email: string): Promise<string> {
  // Wait a bit for email to arrive
  await new Promise(resolve => setTimeout(resolve, 500))

  // Get messages for this email
  const response = await fetch(`${MAILPIT_URL}/api/v1/messages`)
  const data = await response.json()

  // Find the latest message for this email
  const message = data.messages.find((m: any) =>
    m.To.some((t: any) => t.Address === email)
  )

  if (!message) {
    throw new Error(`No email found for ${email}`)
  }

  // Get the full message
  const msgResponse = await fetch(`${MAILPIT_URL}/api/v1/message/${message.ID}`)
  const msgData = await msgResponse.json()

  // Extract magic link from HTML
  const match = msgData.HTML.match(/href="([^"]*verify[^"]*)"/)
  if (!match) {
    throw new Error('No magic link found in email')
  }

  return match[1].replace(/&amp;/g, '&')
}

// Helper to authenticate and get session tokens
async function getAuthSession(email: string): Promise<{ accessToken: string; refreshToken: string; userId: string; expiresAt: number }> {
  // Send OTP
  await fetch(`${SUPABASE_URL}/auth/v1/otp`, {
    method: 'POST',
    headers: {
      'apikey': ANON_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ email, create_user: true }),
  })

  // Get magic link
  const magicLink = await getMagicLink(email)

  // Follow the magic link to get tokens
  const response = await fetch(magicLink, { redirect: 'manual' })
  const location = response.headers.get('location') || ''

  // Parse tokens from hash
  const hash = location.split('#')[1]
  const params = new URLSearchParams(hash)
  const accessToken = params.get('access_token')!
  const refreshToken = params.get('refresh_token')!
  const expiresIn = parseInt(params.get('expires_in') || '3600')

  // Decode JWT to get user ID
  const payload = JSON.parse(atob(accessToken.split('.')[1]))

  return {
    accessToken,
    refreshToken,
    userId: payload.sub,
    expiresAt: Math.floor(Date.now() / 1000) + expiresIn
  }
}

// Helper to set up authenticated session in page
async function setupAuthenticatedSession(page: Page, session: { accessToken: string; refreshToken: string; userId: string; expiresAt: number }, email: string) {
  const storageKey = 'sb-localhost-auth-token'
  const sessionData = {
    access_token: session.accessToken,
    refresh_token: session.refreshToken,
    expires_at: session.expiresAt,
    token_type: 'bearer',
    user: {
      id: session.userId,
      email,
      aud: 'authenticated',
      role: 'authenticated',
    },
  }

  // Set localStorage before navigation
  await page.addInitScript(({ key, value }: { key: string; value: unknown }) => {
    localStorage.setItem(key, JSON.stringify(value))
  }, { key: storageKey, value: sessionData })
}

// Wait for loading spinner to disappear and content to load
async function waitForPageLoad(page: Page) {
  // Wait for the loading spinner to disappear
  await page.waitForSelector('.animate-spin', { state: 'hidden', timeout: 15000 }).catch(() => {})
  // Give a bit more time for content to render
  await page.waitForTimeout(500)
}

test.describe('Schelling Point E2E Tests', () => {
  const testEmail = `test-${Date.now()}@example.com`
  let authSession: { accessToken: string; refreshToken: string; userId: string; expiresAt: number }

  test.beforeAll(async () => {
    // Authenticate once for all tests
    authSession = await getAuthSession(testEmail)
    console.log(`Authenticated as ${testEmail}, userId: ${authSession.userId}`)
  })

  test('1. Sessions page loads and shows sessions (unauthenticated)', async ({ page }) => {
    await page.goto(`${BASE_URL}/sessions`)
    await waitForPageLoad(page)

    // Should show Sessions heading
    await expect(page.locator('h1')).toContainText('Sessions')

    // Should show session cards - look for the grid with session titles
    // Session cards have class "rounded-xl border bg-card" and contain session info
    const sessionCards = page.locator('.rounded-xl.border')
    await expect(sessionCards.first()).toBeVisible({ timeout: 10000 })

    const cardCount = await sessionCards.count()
    console.log(`Sessions page: Found ${cardCount} session cards`)
    expect(cardCount).toBeGreaterThanOrEqual(1)

    // Verify session title is visible
    const sessionTitle = page.locator('h3.font-semibold').first()
    await expect(sessionTitle).toBeVisible()
    const titleText = await sessionTitle.textContent()
    console.log(`First session title: ${titleText}`)

    // Verify total votes display exists
    await expect(page.locator('text=total votes').first()).toBeVisible()
  })

  test('2. Login flow via magic link', async ({ page }) => {
    // Go to login page
    await page.goto(`${BASE_URL}/login`)
    await page.waitForLoadState('networkidle')

    // Should show login form
    await expect(page.locator('text=Welcome')).toBeVisible()
    await expect(page.locator('input[type="email"]')).toBeVisible()

    // Fill in email
    const loginEmail = `login-test-${Date.now()}@example.com`
    await page.fill('input[type="email"]', loginEmail)
    await page.click('button:has-text("Send Magic Link")')

    // Should show success message
    await expect(page.locator('text=Check Your Email')).toBeVisible({ timeout: 10000 })
    console.log('Login flow: Magic link sent successfully')
  })

  test('3. Sessions page with authentication shows voting controls', async ({ page }) => {
    // Set up authenticated session
    await setupAuthenticatedSession(page, authSession, testEmail)

    await page.goto(`${BASE_URL}/sessions`)
    await waitForPageLoad(page)

    // Should show Sessions heading
    await expect(page.locator('h1')).toContainText('Sessions')

    // Should show sign out button (LogOut icon in a button)
    const signOutButton = page.locator('button').filter({ has: page.locator('svg.lucide-log-out') })
    await expect(signOutButton).toBeVisible({ timeout: 10000 })
    console.log('Auth: Sign out button visible, user is logged in')

    // Should show voting controls (+ and - buttons with Plus/Minus icons)
    const plusButtons = page.locator('button').filter({ has: page.locator('svg.lucide-plus') })
    await expect(plusButtons.first()).toBeVisible({ timeout: 10000 })

    const plusCount = await plusButtons.count()
    console.log(`Voting: Found ${plusCount} vote + buttons`)
    expect(plusCount).toBeGreaterThanOrEqual(1)

    // Should show heart buttons for favorites
    const heartButtons = page.locator('button').filter({ has: page.locator('svg.lucide-heart') })
    const heartCount = await heartButtons.count()
    console.log(`Favorites: Found ${heartCount} heart buttons`)
    expect(heartCount).toBeGreaterThanOrEqual(1)
  })

  test('4. Voting functionality works', async ({ page }) => {
    // Set up authenticated session
    await setupAuthenticatedSession(page, authSession, testEmail)

    await page.goto(`${BASE_URL}/sessions`)
    await waitForPageLoad(page)

    // Find a + button for voting
    const plusButton = page.locator('button').filter({ has: page.locator('svg.lucide-plus') }).first()
    await expect(plusButton).toBeVisible({ timeout: 10000 })

    // Get initial vote count display (the div with min-w-[60px] contains the vote count)
    const voteDisplay = page.locator('.min-w-\\[60px\\] .font-semibold').first()
    const initialVoteText = await voteDisplay.textContent() || '0'
    const initialVotes = parseInt(initialVoteText)
    console.log(`Voting: Initial user votes: ${initialVotes}`)

    // Click to add a vote
    await plusButton.click()
    await page.waitForTimeout(1500) // Wait for API call and state update

    // Check if vote count increased
    const newVoteText = await voteDisplay.textContent() || '0'
    const newVotes = parseInt(newVoteText)
    console.log(`Voting: New user votes: ${newVotes}`)

    expect(newVotes).toBe(initialVotes + 1)
    console.log('Voting: Successfully added a vote!')
  })

  test('5. Favorite functionality works', async ({ page }) => {
    // Set up authenticated session
    await setupAuthenticatedSession(page, authSession, testEmail)

    await page.goto(`${BASE_URL}/sessions`)
    await waitForPageLoad(page)

    // Find a heart button
    const heartButton = page.locator('button').filter({ has: page.locator('svg.lucide-heart') }).first()
    await expect(heartButton).toBeVisible({ timeout: 10000 })

    // Check initial state - look for fill-current class on the heart svg
    const heartSvg = heartButton.locator('svg')
    const initialClass = await heartSvg.getAttribute('class') || ''
    const wasFavorited = initialClass.includes('fill-current')
    console.log(`Favorites: Initial state - favorited: ${wasFavorited}`)

    // Click to toggle favorite
    await heartButton.click()
    await page.waitForTimeout(1000)

    // Check new state
    const newClass = await heartSvg.getAttribute('class') || ''
    const isFavoritedNow = newClass.includes('fill-current')
    console.log(`Favorites: New state - favorited: ${isFavoritedNow}`)

    // State should have toggled
    expect(isFavoritedNow).not.toBe(wasFavorited)
    console.log('Favorites: Successfully toggled favorite!')
  })

  test('6. Schedule page loads', async ({ page }) => {
    await page.goto(`${BASE_URL}/schedule`)
    await waitForPageLoad(page)

    // Should show Schedule heading
    await expect(page.locator('h1')).toContainText('Schedule')

    // Check for time slots or empty state
    const emptyState = page.locator('text=No sessions scheduled yet')
    const hasEmptyState = await emptyState.isVisible().catch(() => false)

    if (hasEmptyState) {
      console.log('Schedule page: Empty state shown (no scheduled sessions)')
    } else {
      // Look for scheduled sessions
      const sessionCards = page.locator('.rounded-xl.border')
      const cardCount = await sessionCards.count()
      console.log(`Schedule page: Found ${cardCount} scheduled sessions`)
    }
  })

  test('7. My Schedule page works', async ({ page }) => {
    // Set up authenticated session
    await setupAuthenticatedSession(page, authSession, testEmail)

    await page.goto(`${BASE_URL}/my-schedule`)
    await waitForPageLoad(page)

    // Should show My Schedule heading
    await expect(page.locator('h1')).toContainText('My Schedule')

    // Check for content
    const emptyState = page.locator('text=No sessions saved')
    const hasEmptyState = await emptyState.isVisible().catch(() => false)

    if (hasEmptyState) {
      console.log('My Schedule: Empty state (no favorites yet)')
      // Verify browse button exists
      await expect(page.locator('a:has-text("Browse Sessions")')).toBeVisible()
    } else {
      console.log('My Schedule: Showing saved sessions')
    }
  })

  test('8. My Votes page shows user votes', async ({ page }) => {
    // Set up authenticated session
    await setupAuthenticatedSession(page, authSession, testEmail)

    await page.goto(`${BASE_URL}/my-votes`)
    await waitForPageLoad(page)

    // Should show My Votes heading
    await expect(page.locator('h1')).toContainText('My Votes')

    // Should show stats card
    await expect(page.locator('text=Sessions Voted')).toBeVisible()
    await expect(page.locator('text=Total Votes')).toBeVisible()
    await expect(page.locator('text=Credits Used')).toBeVisible()
    await expect(page.locator('text=Credits Remaining')).toBeVisible()

    console.log('My Votes: Stats card visible')
  })

  test('9. Propose session flow', async ({ page }) => {
    // Set up authenticated session
    await setupAuthenticatedSession(page, authSession, testEmail)

    await page.goto(`${BASE_URL}/propose`)
    await waitForPageLoad(page)

    // Should show propose form
    await expect(page.locator('h1:has-text("Propose")')).toBeVisible()

    // Fill in the form
    await page.fill('input[placeholder*="session"]', 'E2E Test Session')
    await page.fill('textarea', 'This is a test session created by E2E tests.')

    // Select format (click on "Workshop" button that's not already selected)
    const workshopButton = page.locator('button:has-text("Workshop")').first()
    await workshopButton.click()

    // Select duration
    await page.click('button:has-text("60 min")')

    // Add a tag
    await page.fill('input[placeholder*="tag"]', 'testing')
    await page.click('button:has-text("Add")')

    console.log('Propose: Form filled out')

    // Submit
    await page.click('button:has-text("Submit Proposal")')

    // Should show success
    await expect(page.locator('text=Session Proposed!')).toBeVisible({ timeout: 10000 })
    console.log('Propose: Session submitted successfully!')
  })

  test('10. Dashboard navigation works', async ({ page }) => {
    // Set up authenticated session
    await setupAuthenticatedSession(page, authSession, testEmail)

    await page.goto(`${BASE_URL}/sessions`)
    await waitForPageLoad(page)

    // Check navigation tabs exist and work
    const navTests = [
      { href: '/sessions', label: 'Sessions' },
      { href: '/schedule', label: 'Schedule' },
      { href: '/my-schedule', label: 'My Schedule' },
      { href: '/my-votes', label: 'My Votes' },
      { href: '/participants', label: 'Participants' },
    ]

    for (const nav of navTests) {
      const link = page.locator(`a[href="${nav.href}"]`).first()
      const isVisible = await link.isVisible().catch(() => false)
      console.log(`Nav: ${nav.label} - ${isVisible ? 'visible' : 'NOT visible'}`)
      expect(isVisible).toBeTruthy()
    }

    // Test clicking on Schedule
    await page.click('a[href="/schedule"]')
    await waitForPageLoad(page)
    await expect(page.locator('h1')).toContainText('Schedule')
    console.log('Nav: Successfully navigated to Schedule')

    // Test clicking on My Votes
    await page.click('a[href="/my-votes"]')
    await waitForPageLoad(page)
    await expect(page.locator('h1')).toContainText('My Votes')
    console.log('Nav: Successfully navigated to My Votes')
  })

  test('11. Participants page loads', async ({ page }) => {
    await page.goto(`${BASE_URL}/participants`)
    await waitForPageLoad(page)

    // Should show Participants heading
    await expect(page.locator('h1')).toContainText('Participants')
    console.log('Participants page: Loaded successfully')
  })

  test('12. Sign out works', async ({ page }) => {
    // Set up authenticated session
    await setupAuthenticatedSession(page, authSession, testEmail)

    await page.goto(`${BASE_URL}/sessions`)
    await waitForPageLoad(page)

    // Verify we're logged in first
    const signOutButton = page.locator('button').filter({ has: page.locator('svg.lucide-log-out') })
    await expect(signOutButton).toBeVisible({ timeout: 10000 })

    // Click sign out button
    await signOutButton.click()

    // Wait for sign out to complete
    await page.waitForTimeout(1000)

    // Voting controls should no longer be visible (page should reload without auth)
    // Instead of checking for + button, check that sign out button is gone
    await expect(signOutButton).not.toBeVisible({ timeout: 5000 })
    console.log('Sign out: Successfully signed out!')
  })
})
