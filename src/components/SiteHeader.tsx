'use client'

import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { useAuth } from '@/hooks/useAuth'
import { LogIn, LogOut, Plus } from 'lucide-react'

export function SiteHeader() {
  const { user, profile, isLoading, signOut } = useAuth()

  return (
    <header className="sticky top-0 z-50 w-full border-b border-border bg-background ruler-edge">
      <div className="container mx-auto px-4 flex h-14 items-center justify-between">
        {/* Logo with connection indicator */}
        <Link href="/" className="flex items-center gap-2.5 font-display font-bold text-lg group">
          <span className={user ? 'node-indicator' : 'node-indicator-idle'} />
          <span className="text-foreground group-hover:text-primary transition-colors">
            Schelling <span className="text-primary">Point</span>
          </span>
        </Link>

        {/* Navigation — monospace system labels */}
        <div className="flex items-center gap-2 sm:gap-3">
          {isLoading ? (
            <div className="h-9 w-20 rounded-md bg-muted animate-pulse" />
          ) : user ? (
            <>
              <Button asChild variant="default" size="sm">
                <Link href="/create" className="font-mono text-xs uppercase tracking-wider">
                  <Plus className="h-3.5 w-3.5 sm:mr-1.5" strokeWidth={1.5} />
                  <span className="hidden sm:inline">Create</span>
                </Link>
              </Button>
              <div className="flex items-center gap-2">
                {profile?.avatar_url ? (
                  <img
                    src={profile.avatar_url}
                    alt=""
                    className="h-7 w-7 rounded-full border"
                  />
                ) : (
                  <div className="h-7 w-7 rounded-full bg-primary/10 flex items-center justify-center text-xs font-mono font-medium text-primary">
                    {(profile?.display_name || user.email || 'U')[0].toUpperCase()}
                  </div>
                )}
                <span className="text-sm hidden md:inline max-w-[120px] truncate font-mono text-muted-foreground">
                  {profile?.display_name || user.email?.split('@')[0]}
                </span>
              </div>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => signOut()}
                className="text-muted-foreground hover:text-foreground"
              >
                <LogOut className="h-4 w-4" strokeWidth={1.5} />
                <span className="sr-only">Sign out</span>
              </Button>
            </>
          ) : (
            <>
              <Button asChild variant="ghost" size="sm">
                <Link href="/login" className="font-mono text-xs uppercase tracking-wider">
                  <LogIn className="h-3.5 w-3.5 sm:mr-1.5" strokeWidth={1.5} />
                  <span className="hidden sm:inline">Sign In</span>
                </Link>
              </Button>
              <Button asChild variant="default" size="sm">
                <Link href="/login?redirect=/create" className="font-mono text-xs uppercase tracking-wider">
                  <Plus className="h-3.5 w-3.5 sm:mr-1.5" strokeWidth={1.5} />
                  <span className="hidden sm:inline">Create</span>
                </Link>
              </Button>
            </>
          )}
        </div>
      </div>
    </header>
  )
}
