import { createBrowserClient } from '@supabase/ssr'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!

let client: ReturnType<typeof createBrowserClient> | null = null

export function createClient() {
  if (client) return client

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  console.log('Creating Supabase client with URL:', url)

  if (!url || !key) {
    console.error('Missing Supabase environment variables!', { url: !!url, key: !!key })
    throw new Error('Missing Supabase configuration')
  }

  client = createBrowserClient(url, key)

  return client
}

/**
 * Get the access token from localStorage for the current Supabase session.
 * This is used for making authenticated API calls from client components.
 *
 * @returns The access token if available, null otherwise
 */
export function getAccessToken(): string | null {
  if (typeof window === 'undefined') {
    return null
  }

  const storageKey = `sb-${new URL(SUPABASE_URL).hostname.split('.')[0]}-auth-token`
  const stored = localStorage.getItem(storageKey)

  if (stored) {
    try {
      const session = JSON.parse(stored)
      return session?.access_token || null
    } catch {
      return null
    }
  }

  return null
}
