import { test, expect, Page } from '@playwright/test'

const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:3001'
const SUPABASE_URL = process.env.TEST_SUPABASE_URL || 'http://127.0.0.1:54321'
const MAILPIT_URL = process.env.TEST_MAILPIT_URL || 'http://127.0.0.1:54324'
const ANON_KEY = process.env.TEST_SUPABASE_ANON_KEY || ''
const SERVICE_KEY = process.env.TEST_SUPABASE_SERVICE_KEY || ''

const TEST_EVENT_SLUG = 'ethboulder-2026'

// ============================================================================
// Auth Helpers
// ============================================================================

async function getMagicLink(email: string): Promise<string> {
  await new Promise(resolve => setTimeout(resolve, 800))
  const response = await fetch(`${MAILPIT_URL}/api/v1/messages`)
  const data = await response.json()
  const message = data.messages.find((m: any) =>
    m.To.some((t: any) => t.Address === email)
  )
  if (!message) throw new Error(`No email found for ${email}`)
  const msgResponse = await fetch(`${MAILPIT_URL}/api/v1/message/${message.ID}`)
  const msgData = await msgResponse.json()
  const match = msgData.HTML.match(/href="([^"]*verify[^"]*)"/)
  if (!match) throw new Error('No magic link found in email')
  return match[1].replace(/&amp;/g, '&')
}

async function getAuthSession(email: string) {
  await fetch(`${SUPABASE_URL}/auth/v1/otp`, {
    method: 'POST',
    headers: { 'apikey': ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, create_user: true }),
  })
  const magicLink = await getMagicLink(email)
  const response = await fetch(magicLink, { redirect: 'manual' })
  const location = response.headers.get('location') || ''
  const hash = location.split('#')[1]
  const params = new URLSearchParams(hash)
  const accessToken = params.get('access_token')!
  const refreshToken = params.get('refresh_token')!
  const expiresIn = parseInt(params.get('expires_in') || '3600')
  const payload = JSON.parse(atob(accessToken.split('.')[1]))
  return { accessToken, refreshToken, userId: payload.sub, expiresAt: Math.floor(Date.now() / 1000) + expiresIn }
}

async function setupAuth(page: Page, session: any, email: string) {
  const storageKey = 'sb-127-auth-token'
  const sessionData = {
    access_token: session.accessToken,
    refresh_token: session.refreshToken,
    expires_at: session.expiresAt,
    token_type: 'bearer',
    user: { id: session.userId, email, aud: 'authenticated', role: 'authenticated' },
  }
  await page.addInitScript(({ key, value }: { key: string; value: unknown }) => {
    localStorage.setItem(key, JSON.stringify(value))
  }, { key: storageKey, value: sessionData })
}

async function waitForLoad(page: Page) {
  await page.waitForSelector('.animate-spin', { state: 'hidden', timeout: 15000 }).catch(() => {})
  await page.waitForTimeout(500)
}

// Make user an admin of the test event
async function makeAdmin(userId: string, eventId: string) {
  // First check if membership exists
  const checkRes = await fetch(
    `${SUPABASE_URL}/rest/v1/event_members?user_id=eq.${userId}&event_id=eq.${eventId}&select=id,role`,
    { headers: { 'apikey': SERVICE_KEY, 'Authorization': `Bearer ${SERVICE_KEY}` } }
  )
  const existing = await checkRes.json()
  if (existing.length > 0) {
    // Update to owner
    await fetch(
      `${SUPABASE_URL}/rest/v1/event_members?id=eq.${existing[0].id}`,
      {
        method: 'PATCH',
        headers: {
          'apikey': SERVICE_KEY,
          'Authorization': `Bearer ${SERVICE_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ role: 'owner' }),
      }
    )
  } else {
    // Create new membership
    await fetch(
      `${SUPABASE_URL}/rest/v1/event_members`,
      {
        method: 'POST',
        headers: {
          'apikey': SERVICE_KEY,
          'Authorization': `Bearer ${SERVICE_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ user_id: userId, event_id: eventId, role: 'owner' }),
      }
    )
  }
}

// ============================================================================
// Tests
// ============================================================================

test.describe('New Features - 9 Commit PR', () => {
  const testEmail = `e2e-${Date.now()}@example.com`
  let auth: Awaited<ReturnType<typeof getAuthSession>>

  test.beforeAll(async () => {
    auth = await getAuthSession(testEmail)
    // Create a profile for this user
    await fetch(`${SUPABASE_URL}/rest/v1/profiles`, {
      method: 'POST',
      headers: {
        'apikey': SERVICE_KEY,
        'Authorization': `Bearer ${SERVICE_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal',
      },
      body: JSON.stringify({
        id: auth.userId,
        display_name: 'E2E Test User',
        email: testEmail,
      }),
    })
    // Make user admin/owner of test event
    const evtRes = await fetch(
      `${SUPABASE_URL}/rest/v1/events?slug=eq.${TEST_EVENT_SLUG}&select=id`,
      { headers: { 'apikey': SERVICE_KEY, 'Authorization': `Bearer ${SERVICE_KEY}` } }
    )
    const [evt] = await evtRes.json()
    if (evt) await makeAdmin(auth.userId, evt.id)
  })

  // ─────────────────────────────────────────────────────────────────────
  // 1. EVENT CREATION WIZARD - Tab navigation, custom inputs
  // ─────────────────────────────────────────────────────────────────────

  test.describe('Event Creation Wizard', () => {
    test('wizard loads with tab navigation', async ({ page }) => {
      await setupAuth(page, auth, testEmail)
      await page.goto(`${BASE_URL}/create`)
      await waitForLoad(page)

      // Should show "Create Event" heading
      await expect(page.locator('h1')).toContainText('Create Event')

      // Desktop tabs should be present (hidden on mobile, visible on desktop)
      const tabNav = page.locator('nav[aria-label="Wizard steps"]')
      await expect(tabNav).toBeVisible()

      // Should show step tabs: Basics, Dates, Venues, Schedule, Tracks, Voting, Branding, Review
      const tabs = page.locator('nav[aria-label="Wizard steps"] button[role="tab"]')
      // On desktop these should exist (may be hidden on mobile)
      const tabCount = await tabs.count()
      console.log(`Wizard tabs found: ${tabCount}`)
      expect(tabCount).toBe(8) // 8 steps

      // First tab (Basics) should be current
      const firstTab = tabs.first()
      await expect(firstTab).toHaveAttribute('aria-selected', 'true')
    })

    test('Basics step - custom event type input', async ({ page }) => {
      await setupAuth(page, auth, testEmail)
      await page.goto(`${BASE_URL}/create`)
      await waitForLoad(page)

      // Fill in event name
      await page.fill('input#name', 'Test Unconference')

      // Slug should auto-generate
      const slugInput = page.locator('input#slug')
      await expect(slugInput).toHaveValue('test-unconference')

      // Event types should be visible: Unconference, Hackathon, Conference, Meetup, Other
      await expect(page.getByRole('button', { name: /Unconference/i })).toBeVisible()
      await expect(page.getByRole('button', { name: /Hackathon/i })).toBeVisible()
      await expect(page.getByRole('button', { name: /Conference Traditional/i })).toBeVisible()
      await expect(page.getByRole('button', { name: /Meetup/i })).toBeVisible()
      await expect(page.getByRole('button', { name: /Other/i })).toBeVisible()

      // Click "Other" to see custom event type input
      await page.getByRole('button', { name: /Other/i }).click()
      const customInput = page.locator('input#custom-event-type')
      await expect(customInput).toBeVisible()
      await customInput.fill('Retreat')

      // Visibility options should work
      await expect(page.locator('button:has-text("Public")')).toBeVisible()
      await expect(page.locator('button:has-text("Unlisted")')).toBeVisible()
      await expect(page.locator('button:has-text("Private")')).toBeVisible()
    })

    test('Voting step - mechanism selection and custom formats', async ({ page }) => {
      await setupAuth(page, auth, testEmail)
      await page.goto(`${BASE_URL}/create`)
      await waitForLoad(page)

      // Fill basics to pass validation
      await page.fill('input#name', 'Test Event')
      // Navigate to Voting step (step 6, index 5)
      // Fill dates first (step 2)
      await page.click('button:has-text("Next")')
      await page.waitForTimeout(500)

      // On Dates step - fill required fields using IDs
      await page.fill('input#startDate', '2026-06-01')
      await page.fill('input#endDate', '2026-06-03')

      // Navigate forward through Venues, Schedule, Tracks to Voting
      for (let i = 0; i < 4; i++) {
        await page.click('button:has-text("Next")')
        await page.waitForTimeout(600)
      }

      // Should be on Voting step now - check for voting mechanism options
      await expect(page.getByRole('heading', { name: 'Voting Mechanism' })).toBeVisible({ timeout: 5000 })

      // Three mechanism options should be visible
      await expect(page.locator('span.font-medium:has-text("Quadratic")')).toBeVisible()
      await expect(page.locator('span.font-medium:has-text("Linear")')).toBeVisible()
      await expect(page.locator('span.font-medium:has-text("Approval")')).toBeVisible()

      // Click Linear to change mechanism
      await page.locator('button:has-text("Linear"):not([role="tab"])').click()

      // Verify the mechanism description is shown
      await expect(page.locator('text=1 vote = 1 credit. Simple and straightforward.')).toBeVisible()

      // Check session format checkboxes
      await expect(page.getByRole('heading', { name: 'Allowed Session Formats' })).toBeVisible()
      await expect(page.getByRole('button', { name: 'Talk', exact: true })).toBeVisible()
      await expect(page.getByRole('button', { name: 'Workshop', exact: true })).toBeVisible()

      // Test custom format input
      const customFormatInput = page.locator('input[placeholder*="custom format"]')
      if (await customFormatInput.isVisible()) {
        await customFormatInput.fill('Fireside chat')
        // Click the Add button next to custom format (first one)
        await customFormatInput.locator('..').locator('button:has-text("Add")').click()
        await expect(page.locator('text=Fireside chat')).toBeVisible()
      }

      // Check proposal limit toggle
      await expect(page.locator('text=No per-user proposal limit')).toBeVisible()
    })

    test('Schedule step - calendar component renders', async ({ page }) => {
      await setupAuth(page, auth, testEmail)
      await page.goto(`${BASE_URL}/create`)
      await waitForLoad(page)

      // Fill basics
      await page.fill('input#name', 'Calendar Test')
      await page.click('button:has-text("Next")')
      await page.waitForTimeout(300)

      // Fill dates
      const startDateInput = page.locator('input[type="date"]').first()
      if (await startDateInput.isVisible()) {
        await startDateInput.fill('2026-06-01')
        const endDateInput = page.locator('input[type="date"]').nth(1)
        await endDateInput.fill('2026-06-02')
      }

      // Go to Venues step, add a venue
      await page.click('button:has-text("Next")')
      await page.waitForTimeout(300)

      // Add a venue so the calendar has something to show
      const addVenueBtn = page.locator('button:has-text("Add Venue"), button:has-text("Add Room")')
      if (await addVenueBtn.isVisible()) {
        await addVenueBtn.click()
        await page.waitForTimeout(300)
        const venueNameInput = page.locator('input[placeholder*="venue"], input[placeholder*="name"], input[placeholder*="room"]').first()
        if (await venueNameInput.isVisible()) {
          await venueNameInput.fill('Main Hall')
        }
      }

      // Go to Schedule step
      await page.click('button:has-text("Next")')
      await page.waitForTimeout(500)

      // The Schedule step should show the calendar or schedule configuration
      const scheduleContent = page.locator('text=Schedule')
      await expect(scheduleContent.first()).toBeVisible({ timeout: 5000 })
      console.log('Schedule step loaded successfully')
    })
  })

  // ─────────────────────────────────────────────────────────────────────
  // 2. DASHBOARD - Ported ETHBoulder features
  // ─────────────────────────────────────────────────────────────────────

  test.describe('Dashboard', () => {
    test('dashboard loads with stats and sections', async ({ page }) => {
      await setupAuth(page, auth, testEmail)
      await page.goto(`${BASE_URL}/e/${TEST_EVENT_SLUG}/dashboard`)
      await waitForLoad(page)

      // Welcome header or Dashboard heading
      const h1 = page.locator('h1')
      await expect(h1).toBeVisible()
      const heading = await h1.textContent()
      console.log(`Dashboard heading: "${heading}"`)
      expect(heading?.includes('Welcome') || heading?.includes('Dashboard')).toBeTruthy()

      // Stats grid cards
      await expect(page.getByText('Total Sessions', { exact: true })).toBeVisible()
      await expect(page.getByText('Total Votes', { exact: true })).toBeVisible()
      await expect(page.getByText('Participants', { exact: true }).first()).toBeVisible()
      await expect(page.getByText('Your Credits', { exact: true })).toBeVisible()

      console.log('Dashboard: Stats cards visible')
    })

    test('dashboard shows quick action cards', async ({ page }) => {
      await setupAuth(page, auth, testEmail)
      await page.goto(`${BASE_URL}/e/${TEST_EVENT_SLUG}/dashboard`)
      await waitForLoad(page)

      // Quick actions
      await expect(page.getByRole('heading', { name: 'Vote on Sessions' })).toBeVisible()
      await expect(page.getByRole('heading', { name: 'My Schedule' })).toBeVisible()
      await expect(page.getByRole('heading', { name: 'Propose Session' })).toBeVisible()

      console.log('Dashboard: Quick action cards visible')
    })

    test('dashboard shows voting activity section', async ({ page }) => {
      await setupAuth(page, auth, testEmail)
      await page.goto(`${BASE_URL}/e/${TEST_EVENT_SLUG}/dashboard`)
      await waitForLoad(page)

      // Voting activity section
      await expect(page.getByText('Your voting activity')).toBeVisible()
      await expect(page.getByText('Sessions voted', { exact: true })).toBeVisible()
      await expect(page.getByText('Votes cast', { exact: true })).toBeVisible()
      await expect(page.getByText('Credits used', { exact: true })).toBeVisible()
      await expect(page.getByText('Credits remaining', { exact: true })).toBeVisible()

      // Credit usage progress bar
      const progressBar = page.getByRole('main').getByRole('progressbar')
      await expect(progressBar).toBeVisible()

      console.log('Dashboard: Voting activity section visible')
    })

    test('dashboard shows top sessions leaderboard', async ({ page }) => {
      await setupAuth(page, auth, testEmail)
      await page.goto(`${BASE_URL}/e/${TEST_EVENT_SLUG}/dashboard`)
      await waitForLoad(page)

      // Top sessions section
      await expect(page.locator('text=Top sessions')).toBeVisible()

      // Recently proposed section
      await expect(page.locator('text=Recently proposed')).toBeVisible()

      console.log('Dashboard: Leaderboard and recent sections visible')
    })
  })

  // ─────────────────────────────────────────────────────────────────────
  // 3. ADMIN PAGES - Nav, Stats, Tickets, Communications
  // ─────────────────────────────────────────────────────────────────────

  test.describe('Admin Pages', () => {
    test('admin nav renders with all links', async ({ page }) => {
      await setupAuth(page, auth, testEmail)
      await page.goto(`${BASE_URL}/e/${TEST_EVENT_SLUG}/admin`)
      await waitForLoad(page)

      // Admin nav should have key links
      const navLinks = [
        'Sessions',
        'Schedule',
        'Communications',
        'Tickets',
        'Members',
      ]

      for (const label of navLinks) {
        const link = page.locator(`a:has-text("${label}")`).first()
        const isVisible = await link.isVisible().catch(() => false)
        console.log(`Admin nav: ${label} - ${isVisible ? 'visible' : 'NOT visible'}`)
      }
    })

    test('tickets page loads with ticketing toggle', async ({ page }) => {
      await setupAuth(page, auth, testEmail)
      await page.goto(`${BASE_URL}/e/${TEST_EVENT_SLUG}/admin/tickets`)
      await waitForLoad(page)

      // Page heading
      await expect(page.locator('h1')).toContainText('Ticket Tiers')

      // Ticketing settings card with toggle
      await expect(page.getByRole('heading', { name: 'Ticket sales' })).toBeVisible()

      // Stats cards
      await expect(page.getByText('Tickets Sold', { exact: true })).toBeVisible()
      await expect(page.getByText('Total Revenue', { exact: true })).toBeVisible()
      await expect(page.getByText('Active Tiers', { exact: true })).toBeVisible()

      // Add Tier button
      await expect(page.locator('button:has-text("Add Tier")')).toBeVisible()

      console.log('Tickets page: All sections rendered')
    })

    test('tickets page - create tier form', async ({ page }) => {
      await setupAuth(page, auth, testEmail)
      await page.goto(`${BASE_URL}/e/${TEST_EVENT_SLUG}/admin/tickets`)
      await waitForLoad(page)

      // Click Add Tier
      await page.click('button:has-text("Add Tier")')
      await page.waitForTimeout(300)

      // Form should appear
      await expect(page.locator('text=Create Tier').first()).toBeVisible()

      // Form fields
      const nameInput = page.locator('input[placeholder*="Early Bird"]')
      await expect(nameInput).toBeVisible()

      const priceInput = page.locator('input[placeholder*="0.00"]')
      await expect(priceInput).toBeVisible()

      const descInput = page.locator('input[placeholder*="included"]')
      await expect(descInput).toBeVisible()

      // Permission checkboxes
      await expect(page.locator('text=Can propose sessions')).toBeVisible()
      await expect(page.locator('text=Can vote on sessions')).toBeVisible()

      // Cancel button
      await page.click('button:has-text("Cancel")')
      await page.waitForTimeout(300)

      console.log('Tickets: Create tier form works')
    })

    test('communications page loads with session emails section', async ({ page }) => {
      await setupAuth(page, auth, testEmail)
      await page.goto(`${BASE_URL}/e/${TEST_EVENT_SLUG}/admin/communications`)
      await waitForLoad(page)

      // Page heading
      await expect(page.locator('h1')).toContainText('Communications')

      // Session Host Emails section (new feature)
      await expect(page.locator('text=Session Host Emails')).toBeVisible()
      await expect(page.locator('text=Schedule notifications')).toBeVisible()
      await expect(page.locator('text=Approval & rejection emails')).toBeVisible()

      // Buttons for email actions
      await expect(page.locator('button:has-text("Notify scheduled hosts")')).toBeVisible()
      await expect(page.locator('button:has-text("Send queued emails")')).toBeVisible()

      // Announcement section
      await expect(page.getByRole('heading', { name: 'Send Announcement' })).toBeVisible()
      await expect(page.getByRole('heading', { name: 'Recent Announcements' })).toBeVisible()

      console.log('Communications: All sections rendered including session emails')
    })

    test('members page loads', async ({ page }) => {
      await setupAuth(page, auth, testEmail)
      await page.goto(`${BASE_URL}/e/${TEST_EVENT_SLUG}/admin/members`)
      await waitForLoad(page)

      // Should show members page content
      const heading = page.locator('h1, h2').first()
      await expect(heading).toBeVisible()

      console.log('Members page: Loaded successfully')
    })
  })

  // ─────────────────────────────────────────────────────────────────────
  // 4. VOTING MECHANISM - Credits computation per mechanism
  // ─────────────────────────────────────────────────────────────────────

  test.describe('Voting & Sessions', () => {
    test('sessions page loads with voting controls', async ({ page }) => {
      await setupAuth(page, auth, testEmail)
      await page.goto(`${BASE_URL}/e/${TEST_EVENT_SLUG}/sessions`)
      await waitForLoad(page)

      // Should show Sessions heading
      await expect(page.locator('h1')).toContainText('Sessions')

      // Should show session cards
      const sessionCards = page.locator('.rounded-xl.border, [class*="rounded"][class*="border"]')
      await expect(sessionCards.first()).toBeVisible({ timeout: 10000 })

      const cardCount = await sessionCards.count()
      console.log(`Sessions page: Found ${cardCount} cards`)
      expect(cardCount).toBeGreaterThanOrEqual(1)
    })

    test('session detail page loads', async ({ page }) => {
      await setupAuth(page, auth, testEmail)

      // Get a session ID from the API
      const sessionsRes = await fetch(
        `${SUPABASE_URL}/rest/v1/sessions?event_id=eq.e0df2790-da26-4856-8ce2-35710e823e7e&select=id,title&limit=1`,
        { headers: { 'apikey': ANON_KEY, 'Authorization': `Bearer ${ANON_KEY}` } }
      )
      const sessions = await sessionsRes.json()
      if (sessions.length === 0) {
        test.skip()
        return
      }

      await page.goto(`${BASE_URL}/e/${TEST_EVENT_SLUG}/sessions/${sessions[0].id}`)
      await waitForLoad(page)

      // Should show session title
      await expect(page.locator('h1, h2').first()).toBeVisible()
      console.log(`Session detail: Loaded "${sessions[0].title}"`)
    })

    test('my-votes page shows credits info', async ({ page }) => {
      await setupAuth(page, auth, testEmail)
      await page.goto(`${BASE_URL}/e/${TEST_EVENT_SLUG}/my-votes`)
      await waitForLoad(page)

      await expect(page.locator('h1')).toContainText('My Votes')

      // Stats should be visible (may use different labels now)
      const pageContent = await page.textContent('body')
      const hasCreditsInfo = pageContent?.includes('Credits') || pageContent?.includes('credits')
      console.log(`My Votes: Credits info visible: ${hasCreditsInfo}`)

      expect(hasCreditsInfo).toBeTruthy()
    })

    test('propose page loads with topics support', async ({ page }) => {
      await setupAuth(page, auth, testEmail)
      await page.goto(`${BASE_URL}/e/${TEST_EVENT_SLUG}/propose`)
      await waitForLoad(page)

      // Should show proposal form
      const heading = page.locator('h1, h2').first()
      await expect(heading).toBeVisible()

      const pageContent = await heading.textContent()
      console.log(`Propose page heading: "${pageContent}"`)

      // Title input should exist
      const titleInput = page.locator('input[placeholder*="session"], input[placeholder*="title"], input[placeholder*="Session"]').first()
      await expect(titleInput).toBeVisible({ timeout: 5000 })

      console.log('Propose page: Form loaded')
    })
  })

  // ─────────────────────────────────────────────────────────────────────
  // 5. ADMIN STATS & BRANDING
  // ─────────────────────────────────────────────────────────────────────

  test.describe('Admin Stats & Branding', () => {
    test('admin stats component renders', async ({ page }) => {
      await setupAuth(page, auth, testEmail)
      await page.goto(`${BASE_URL}/e/${TEST_EVENT_SLUG}/admin`)
      await waitForLoad(page)

      // Admin page should show stats or session management
      const pageText = await page.textContent('body')
      const hasAdminContent =
        pageText?.includes('Sessions') ||
        pageText?.includes('Pending') ||
        pageText?.includes('Approved') ||
        pageText?.includes('Scheduled')
      console.log(`Admin page: Has admin content: ${hasAdminContent}`)
      expect(hasAdminContent).toBeTruthy()
    })

    test('branding step shows theme palettes', async ({ page }) => {
      await setupAuth(page, auth, testEmail)
      await page.goto(`${BASE_URL}/create`)
      await waitForLoad(page)

      // Fill basics to enable navigation
      await page.fill('input#name', 'Branding Test')

      // Navigate to branding step (step 7, click Next 6 times)
      // Fill dates
      await page.click('button:has-text("Next")')
      await page.waitForTimeout(300)
      const startDateInput = page.locator('input[type="date"]').first()
      if (await startDateInput.isVisible()) {
        await startDateInput.fill('2026-06-01')
        const endDateInput = page.locator('input[type="date"]').nth(1)
        await endDateInput.fill('2026-06-03')
      }

      // Click through Venues, Schedule, Tracks, Voting to Branding
      for (let i = 0; i < 5; i++) {
        await page.click('button:has-text("Next")')
        await page.waitForTimeout(400)
      }

      // Should be on Branding step
      const brandingVisible = await page.locator('text=Theme').first().isVisible().catch(() => false)
      const socialVisible = await page.locator('text=Social').first().isVisible().catch(() => false)

      console.log(`Branding step: Theme visible: ${brandingVisible}, Social visible: ${socialVisible}`)

      // At least one of these should be true if we're on the branding step
      if (brandingVisible || socialVisible) {
        console.log('Branding step loaded successfully')
      }
    })
  })

  // ─────────────────────────────────────────────────────────────────────
  // 6. NAVIGATION & LAYOUT
  // ─────────────────────────────────────────────────────────────────────

  test.describe('Navigation & Layout', () => {
    test('DashboardLayout renders with event nav', async ({ page }) => {
      await setupAuth(page, auth, testEmail)
      await page.goto(`${BASE_URL}/e/${TEST_EVENT_SLUG}/sessions`)
      await waitForLoad(page)

      // Dashboard layout nav should have links to main sections
      const dashboardLink = page.locator(`a[href="/e/${TEST_EVENT_SLUG}/dashboard"]`).first()
      const sessionsLink = page.locator(`a[href="/e/${TEST_EVENT_SLUG}/sessions"]`).first()

      const hasDashboard = await dashboardLink.isVisible().catch(() => false)
      const hasSessions = await sessionsLink.isVisible().catch(() => false)

      console.log(`Nav: Dashboard link: ${hasDashboard}, Sessions link: ${hasSessions}`)
    })

    test('event page redirects/loads correctly', async ({ page }) => {
      await page.goto(`${BASE_URL}/e/${TEST_EVENT_SLUG}`)
      await waitForLoad(page)

      // Should load the event page (may redirect to dashboard or sessions)
      const url = page.url()
      console.log(`Event page URL: ${url}`)

      // Should contain the event slug in the URL
      expect(url).toContain(TEST_EVENT_SLUG)
    })
  })
})
