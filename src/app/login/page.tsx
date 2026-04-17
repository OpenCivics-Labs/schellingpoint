'use client'

import * as React from 'react'
import { Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Mail, CheckCircle, ArrowLeft, ArrowRight, Loader2 } from 'lucide-react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { useAuth } from '@/hooks/useAuth'

function LoginContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { user, signIn, isLoading: authLoading } = useAuth()

  const [email, setEmail] = React.useState('')
  const [isLoading, setIsLoading] = React.useState(false)
  const [emailSent, setEmailSent] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  // Redirect if already logged in
  React.useEffect(() => {
    if (user && !authLoading) {
      const redirect = searchParams.get('redirect')
      router.push(redirect || '/')
    }
  }, [user, authLoading, router, searchParams])

  const [loggedOutMessage, setLoggedOutMessage] = React.useState(false)

  // Check for auth errors or logged out state
  React.useEffect(() => {
    if (searchParams.get('error') === 'auth') {
      setError('Authentication failed. Please try again.')
    }
    if (searchParams.get('logged_out') === 'true') {
      setLoggedOutMessage(true)
    }
  }, [searchParams])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!email) return

    setIsLoading(true)
    setError(null)

    const { error } = await signIn(email)

    if (error) {
      setError(error.message)
      setIsLoading(false)
    } else {
      setEmailSent(true)
      setIsLoading(false)
    }
  }

  if (emailSent) {
    return (
      <div className="min-h-screen flex items-start sm:items-center justify-center bg-background p-4 pt-16 sm:pt-4">
        <Card className="w-full max-w-md" accent="top" accentColor="hsl(var(--signal))">
          <CardHeader className="text-center">
            <div className="flex justify-center mb-4">
              <div className="node-indicator w-4 h-4" />
            </div>
            <CardTitle className="text-2xl font-display">Handshake Initiated</CardTitle>
            <CardDescription className="font-mono text-xs uppercase tracking-wider">
              Verification signal sent to:
            </CardDescription>
            <p className="font-mono text-sm text-foreground mt-1">{email}</p>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="protocol-box border-border text-sm text-center text-muted-foreground">
              <p>Check your inbox to complete the connection.</p>
              <p className="mt-2 text-xs">Signal expires in 1 hour.</p>
            </div>
            <Button
              variant="ghost"
              className="w-full"
              onClick={() => {
                setEmailSent(false)
                setEmail('')
              }}
            >
              Use a different email
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-start sm:items-center justify-center bg-background p-4 pt-16 sm:pt-4">
      <Card className="w-full max-w-md" accent="top" accentColor="hsl(var(--signal))">
        <CardHeader className="text-center">
          <Link
            href="/"
            className="inline-flex items-center text-xs font-mono text-muted-foreground hover:text-foreground mb-4 uppercase tracking-wider"
          >
            <ArrowLeft className="h-3.5 w-3.5 mr-1" strokeWidth={1.5} />
            Back
          </Link>
          <div className="flex justify-center mb-4">
            <div className="node-indicator-idle w-10 h-10 flex items-center justify-center">
              <Mail className="h-5 w-5 text-muted-foreground" strokeWidth={1.5} />
            </div>
          </div>
          <CardTitle className="text-2xl font-display">Establish Connection</CardTitle>
          <CardDescription>
            Enter your address to join the network
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            {loggedOutMessage && (
              <div className="protocol-box border-border text-sm text-center">
                Connection terminated. Sign in to reconnect.
              </div>
            )}
            {error && (
              <div className="rounded-md bg-destructive/10 border border-destructive/20 p-3 text-sm text-destructive font-mono">
                {error}
              </div>
            )}
            <div className="space-y-2">
              <Input
                type="email"
                placeholder="your@address.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={isLoading}
                required
                className="font-mono"
              />
            </div>
            <Button type="submit" className="w-full" loading={isLoading}>
              Send Handshake <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </form>
          <p className="text-xs text-center text-muted-foreground mt-4 font-mono">
            {'>'} password-free authentication via magic link
            <br />
            <span className="text-foreground/60">{'>'} no account? one will be initialized automatically</span>
          </p>
        </CardContent>
      </Card>
    </div>
  )
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-muted/30 p-4">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      }
    >
      <LoginContent />
    </Suspense>
  )
}
