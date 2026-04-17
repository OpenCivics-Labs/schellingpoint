'use client'

import * as React from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  FileText,
  LayoutGrid,
  Settings,
  ArrowLeft,
  Megaphone,
  BarChart3,
  Tags,
  Ticket,
  DollarSign,
  Users,
  Menu,
  X,
  Shield,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useEvent, useEventRole } from '@/contexts/EventContext'

interface NavItem {
  label: string
  href: string
  icon: React.ElementType
  active: boolean
  show: boolean
}

function useAdminNav(eventSlug: string) {
  const pathname = usePathname()
  const { can } = useEventRole()

  const baseUrl = `/e/${eventSlug}/admin`
  const isActive = (path: string) =>
    path === baseUrl ? pathname === baseUrl : pathname?.startsWith(path)

  const navItems: NavItem[] = [
    {
      label: 'Sessions',
      href: baseUrl,
      icon: FileText,
      active: pathname === baseUrl,
      show: true,
    },
    {
      label: 'Schedule',
      href: `${baseUrl}/schedule`,
      icon: LayoutGrid,
      active: !!isActive(`${baseUrl}/schedule`),
      show: can('manageSchedule'),
    },
    {
      label: 'Setup',
      href: `${baseUrl}/setup`,
      icon: Settings,
      active: !!isActive(`${baseUrl}/setup`),
      show: can('manageVenues'),
    },
    {
      label: 'Tracks',
      href: `${baseUrl}/tracks`,
      icon: Tags,
      active: !!isActive(`${baseUrl}/tracks`),
      show: true,
    },
    {
      label: 'Tickets',
      href: `${baseUrl}/tickets`,
      icon: Ticket,
      active: !!isActive(`${baseUrl}/tickets`),
      show: true,
    },
    {
      label: 'Revenue',
      href: `${baseUrl}/revenue`,
      icon: DollarSign,
      active: !!isActive(`${baseUrl}/revenue`),
      show: true,
    },
    {
      label: 'Members',
      href: `${baseUrl}/members`,
      icon: Users,
      active: !!isActive(`${baseUrl}/members`),
      show: true,
    },
    {
      label: 'Communications',
      href: `${baseUrl}/communications`,
      icon: Megaphone,
      active: !!isActive(`${baseUrl}/communications`),
      show: true,
    },
    {
      label: 'Analytics',
      href: `${baseUrl}/analytics`,
      icon: BarChart3,
      active: !!isActive(`${baseUrl}/analytics`),
      show: true,
    },
  ].filter((item) => item.show)

  return navItems
}

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const event = useEvent()
  const navItems = useAdminNav(event.slug)
  const [mobileNavOpen, setMobileNavOpen] = React.useState(false)
  const pathname = usePathname()

  // Close mobile nav on route change
  React.useEffect(() => {
    setMobileNavOpen(false)
  }, [pathname])

  return (
    <div className="min-h-screen bg-background flex">
      {/* ─── Desktop Sidebar ─── */}
      <aside className="hidden md:flex flex-col w-[220px] lg:w-[240px] flex-shrink-0 border-r border-border bg-card fixed inset-y-0 left-0 z-20">
        {/* Header — "Control Center" branding */}
        <div className="p-4 border-b border-border">
          <Link
            href={`/e/${event.slug}/dashboard`}
            className="flex items-center gap-2 text-xs font-mono uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="h-3.5 w-3.5" strokeWidth={1.5} />
            Back to event
          </Link>
          <div className="flex items-center gap-2 mt-3">
            <div className="h-7 w-7 rounded bg-primary/10 flex items-center justify-center flex-shrink-0">
              <Shield className="h-4 w-4 text-primary" strokeWidth={1.5} />
            </div>
            <div className="min-w-0">
              <div className="font-display font-bold text-sm leading-tight truncate">
                Control Center
              </div>
              <div className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider truncate">
                {event.name}
              </div>
            </div>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 py-2 px-2 space-y-0.5 overflow-y-auto">
          <div className="section-rule text-[9px] px-2 mb-2">Manage</div>
          {navItems.map((item) => {
            const Icon = item.icon
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={item.active ? 'page' : undefined}
                className={cn(
                  'flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-all',
                  item.active
                    ? 'text-foreground bg-primary/8 border-l-[3px] border-l-primary font-medium'
                    : 'text-muted-foreground hover:text-foreground hover:bg-muted/50 border-l-[3px] border-l-transparent'
                )}
              >
                <Icon className="h-4 w-4 flex-shrink-0" strokeWidth={1.5} />
                <span className="font-mono text-xs uppercase tracking-wider">{item.label}</span>
              </Link>
            )
          })}
        </nav>

        {/* Footer */}
        <div className="p-3 border-t border-border">
          <div className="text-[9px] font-mono text-muted-foreground uppercase tracking-wider text-center">
            Admin · {event.name}
          </div>
        </div>
      </aside>

      {/* ─── Mobile Header ─── */}
      <div className="md:hidden fixed top-0 left-0 right-0 z-30 border-b border-border bg-background">
        <div className="flex items-center justify-between h-12 px-4">
          <div className="flex items-center gap-2">
            <Shield className="h-4 w-4 text-primary" strokeWidth={1.5} />
            <span className="font-display font-bold text-sm">Admin</span>
            <span className="text-xs text-muted-foreground truncate max-w-[120px]">{event.name}</span>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href={`/e/${event.slug}/dashboard`}
              className="text-xs font-mono text-muted-foreground hover:text-foreground px-2 py-1"
            >
              EXIT
            </Link>
            <button
              onClick={() => setMobileNavOpen(!mobileNavOpen)}
              className="p-2 rounded-md text-muted-foreground hover:text-foreground"
            >
              {mobileNavOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </button>
          </div>
        </div>

        {/* Mobile nav dropdown */}
        {mobileNavOpen && (
          <div className="border-t border-border bg-card px-4 py-3 space-y-1 animate-slide-down max-h-[70vh] overflow-y-auto">
            {navItems.map((item) => {
              const Icon = item.icon
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    'flex items-center gap-3 px-3 py-3 min-h-[44px] rounded-md text-sm transition-all',
                    item.active
                      ? 'text-foreground bg-primary/8 border-l-[3px] border-l-primary'
                      : 'text-muted-foreground hover:text-foreground border-l-[3px] border-l-transparent'
                  )}
                >
                  <Icon className="h-4 w-4" strokeWidth={1.5} />
                  <span className="font-mono text-xs uppercase tracking-wider">{item.label}</span>
                </Link>
              )
            })}
          </div>
        )}
      </div>

      {/* ─── Main Content ─── */}
      <main className="flex-1 md:ml-[220px] lg:ml-[240px] min-h-screen">
        <div className="h-12 md:hidden" />
        <div className="p-4 md:p-6 lg:p-8">
          {children}
        </div>
      </main>
    </div>
  )
}
