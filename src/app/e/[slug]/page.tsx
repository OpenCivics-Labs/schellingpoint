'use client';

import * as React from 'react';
import Link from 'next/link';
import {
  Calendar,
  MapPin,
  Users,
  Vote,
  FileText,
  Clock,
  ArrowRight,
  Presentation,
  Settings,
  Loader2,
  TrendingUp,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { SiteHeader } from '@/components/SiteHeader';
import { Footer } from '@/components/Footer';
import { useEvent, useEventRole } from '@/contexts/EventContext';
import { useAuth } from '@/hooks/useAuth';
import { formatEventDate } from '@/lib/events/dates';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

interface EventStats {
  sessionCount: number;
  participantCount: number;
  trackCount: number;
}

interface TopSession {
  id: string;
  title: string;
  host_name: string | null;
  format: string | null;
  total_votes: number;
  track?: { name: string; color: string | null } | null;
}

export default function EventPage() {
  const event = useEvent();
  const { isAdmin, isMember } = useEventRole();
  const { user } = useAuth();

  const [stats, setStats] = React.useState<EventStats | null>(null);
  const [topSessions, setTopSessions] = React.useState<TopSession[]>([]);
  const [isLoading, setIsLoading] = React.useState(true);

  // Calculate event duration in days
  const dayCount = React.useMemo(() => {
    const start = new Date(event.startDate);
    const end = new Date(event.endDate);
    return Math.max(1, Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1);
  }, [event.startDate, event.endDate]);

  // Fetch stats and top sessions
  React.useEffect(() => {
    const fetchData = async () => {
      try {
        const [sessionsRes, membersRes, tracksRes, topRes] = await Promise.all([
          fetch(`${SUPABASE_URL}/rest/v1/sessions?event_id=eq.${event.id}&select=id`, {
            headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` },
          }),
          fetch(`${SUPABASE_URL}/rest/v1/event_members?event_id=eq.${event.id}&select=id`, {
            headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` },
          }),
          fetch(`${SUPABASE_URL}/rest/v1/tracks?event_id=eq.${event.id}&select=id`, {
            headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` },
          }),
          fetch(`${SUPABASE_URL}/rest/v1/sessions?event_id=eq.${event.id}&status=in.(approved,scheduled)&select=id,title,host_name,format,total_votes,track:tracks(name,color)&order=total_votes.desc&limit=4`, {
            headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` },
          }),
        ]);

        const [sessions, members, tracks, top] = await Promise.all([
          sessionsRes.ok ? sessionsRes.json() : [],
          membersRes.ok ? membersRes.json() : [],
          tracksRes.ok ? tracksRes.json() : [],
          topRes.ok ? topRes.json() : [],
        ]);

        setStats({
          sessionCount: sessions.length,
          participantCount: members.length,
          trackCount: tracks.length,
        });
        setTopSessions(top);
      } catch (err) {
        console.error('Error fetching event data:', err);
      } finally {
        setIsLoading(false);
      }
    };
    fetchData();
  }, [event.id]);

  const statusConfig: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' | 'amber' }> = {
    draft: { label: 'Draft', variant: 'secondary' },
    published: { label: 'Open', variant: 'default' },
    proposals_open: { label: 'Proposals Open', variant: 'default' },
    voting_open: { label: 'Voting Open', variant: 'default' },
    scheduling: { label: 'Scheduling', variant: 'amber' },
    live: { label: 'Live Now', variant: 'destructive' },
    completed: { label: 'Completed', variant: 'secondary' },
    archived: { label: 'Archived', variant: 'outline' },
  };

  const badge = statusConfig[event.status] || statusConfig.draft;

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <SiteHeader />

      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 geodesic-mesh opacity-[0.04]" />
        <div className="relative container mx-auto max-w-4xl px-4 py-16 sm:py-20 lg:py-24">
          <div className="text-center">
            {/* Logo */}
            {event.logoUrl && (
              <div className="flex justify-center mb-6">
                <img
                  src={event.logoUrl}
                  alt={event.name}
                  className="h-16 w-16 sm:h-20 sm:w-20 rounded-xl object-contain border border-border"
                />
              </div>
            )}

            <Badge variant={badge.variant} className="mb-4">
              {badge.label}
            </Badge>

            <h1 className="font-display text-4xl sm:text-5xl lg:text-6xl font-bold tracking-tight mb-3">
              {event.name}
            </h1>

            {event.tagline && (
              <p className="text-lg sm:text-xl text-muted-foreground mb-6 max-w-2xl mx-auto">
                {event.tagline}
              </p>
            )}

            {/* Event spec — monospace metadata */}
            <div className="flex flex-wrap justify-center gap-4 sm:gap-6 font-mono text-xs uppercase tracking-wider text-muted-foreground mb-8">
              <span className="flex items-center gap-1.5">
                <Calendar className="h-3.5 w-3.5" strokeWidth={1.5} />
                {formatEventDate(event.startDate, event.timezone, { month: 'short', day: 'numeric' })}
                {' – '}
                {formatEventDate(event.endDate, event.timezone, { month: 'short', day: 'numeric', year: 'numeric' })}
              </span>
              {event.locationName && (
                <span className="flex items-center gap-1.5">
                  <MapPin className="h-3.5 w-3.5" strokeWidth={1.5} />
                  {event.locationName}
                </span>
              )}
              <span className="flex items-center gap-1.5">
                <Clock className="h-3.5 w-3.5" strokeWidth={1.5} />
                {dayCount} day{dayCount > 1 ? 's' : ''}
              </span>
            </div>

            {/* CTAs */}
            <div className="flex flex-col sm:flex-row justify-center gap-3 px-4 sm:px-0">
              <Button asChild size="lg" className="w-full sm:w-auto">
                <Link href={`/e/${event.slug}/sessions`}>
                  Browse Sessions
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Link>
              </Button>
              <Button asChild variant="outline" size="lg" className="w-full sm:w-auto">
                <Link href={`/e/${event.slug}/schedule`}>
                  View Schedule
                </Link>
              </Button>
              {isAdmin && (
                <Button asChild variant="secondary" size="lg">
                  <Link href={`/e/${event.slug}/admin`}>
                    <Settings className="mr-2 h-4 w-4" strokeWidth={1.5} />
                    Admin
                  </Link>
                </Button>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* Stats strip */}
      <section className="border-y border-border bg-card/50">
        <div className="container mx-auto max-w-4xl px-4 py-6">
          {isLoading ? (
            <div className="flex justify-center">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : stats && (
            <div className="grid grid-cols-3 gap-6 text-center">
              <div>
                <div className="font-mono text-2xl sm:text-3xl font-bold tabular-nums">
                  {stats.sessionCount}
                </div>
                <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground mt-1">
                  Sessions
                </div>
              </div>
              <div>
                <div className="font-mono text-2xl sm:text-3xl font-bold tabular-nums">
                  {stats.participantCount}
                </div>
                <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground mt-1">
                  Participants
                </div>
              </div>
              <div>
                <div className="font-mono text-2xl sm:text-3xl font-bold tabular-nums">
                  {stats.trackCount}
                </div>
                <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground mt-1">
                  Tracks
                </div>
              </div>
            </div>
          )}
        </div>
      </section>

      {/* Main content */}
      <div className="container mx-auto max-w-4xl px-4 py-10 space-y-10 flex-1">
        {/* Top Sessions */}
        {topSessions.length > 0 && (
          <section>
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-display text-lg font-bold flex items-center gap-2">
                <TrendingUp className="h-5 w-5 text-primary" strokeWidth={1.5} />
                Top Sessions
              </h2>
              <Link
                href={`/e/${event.slug}/sessions`}
                className="text-xs font-mono uppercase tracking-wider text-muted-foreground hover:text-primary transition-colors"
              >
                View all →
              </Link>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {topSessions.map((session, i) => (
                <Link key={session.id} href={`/e/${event.slug}/sessions/${session.id}`}>
                  <Card
                    accent="left"
                    accentColor={session.track?.color || 'hsl(var(--signal))'}
                    interactive
                    className="h-full"
                  >
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            {session.format && (
                              <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                                {session.format}
                              </span>
                            )}
                            {session.track && (
                              <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                                <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: session.track.color || undefined }} />
                                {session.track.name}
                              </span>
                            )}
                          </div>
                          <h3 className="font-display font-semibold text-sm leading-snug line-clamp-2">
                            {session.title}
                          </h3>
                          {session.host_name && (
                            <p className="text-xs text-muted-foreground mt-1">{session.host_name}</p>
                          )}
                        </div>
                        <div className="text-right flex-shrink-0">
                          <div className="font-mono text-lg font-bold tabular-nums text-primary">
                            {session.total_votes}
                          </div>
                          <div className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground">
                            votes
                          </div>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </Link>
              ))}
            </div>
          </section>
        )}

        {/* About */}
        {event.description && (
          <section>
            <div className="section-rule mb-4">About</div>
            <p className="text-muted-foreground whitespace-pre-wrap leading-relaxed">
              {event.description}
            </p>
          </section>
        )}

        {/* Protocol spec block */}
        <section>
          <div className="protocol-box border-border max-w-lg">
            <div className="text-primary font-bold mb-2">{event.name.toUpperCase()}</div>
            <div className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1 text-xs text-muted-foreground">
              <span>STATUS</span>
              <span className="text-foreground">{badge.label.toUpperCase()}</span>
              <span>DATE</span>
              <span className="text-foreground">
                {formatEventDate(event.startDate, event.timezone, { month: 'short', day: 'numeric' })}
                {' – '}
                {formatEventDate(event.endDate, event.timezone, { month: 'short', day: 'numeric', year: 'numeric' })}
              </span>
              {event.locationName && (
                <>
                  <span>LOCATION</span>
                  <span className="text-foreground">{event.locationName}</span>
                </>
              )}
              <span>VOTING</span>
              <span className="text-foreground">{event.votingMechanism.toUpperCase()} · {event.voteCreditsPerUser} CREDITS</span>
              <span>FORMATS</span>
              <span className="text-foreground">{event.allowedFormats.map(f => f.toUpperCase()).join(', ')}</span>
            </div>
          </div>
        </section>

        {/* Quick actions (logged in members) */}
        {isMember && (
          <section>
            <div className="section-rule mb-4">Quick Actions</div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[
                { href: `/e/${event.slug}/propose`, icon: FileText, label: 'Propose' },
                { href: `/e/${event.slug}/my-votes`, icon: Vote, label: 'My Votes' },
                { href: `/e/${event.slug}/my-schedule`, icon: Calendar, label: 'Saved' },
                { href: `/e/${event.slug}/participants`, icon: Users, label: 'People' },
              ].map(({ href, icon: Icon, label }) => (
                <Link key={href} href={href}>
                  <Card interactive className="h-full">
                    <CardContent className="p-4 text-center">
                      <Icon className="h-5 w-5 mx-auto mb-2 text-primary" strokeWidth={1.5} />
                      <span className="text-xs font-mono uppercase tracking-wider text-muted-foreground">
                        {label}
                      </span>
                    </CardContent>
                  </Card>
                </Link>
              ))}
            </div>
          </section>
        )}
      </div>

      <Footer variant="minimal" event={event} />
    </div>
  );
}
