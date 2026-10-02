'use client';

import { apiRequest } from '@/components/organisms/modules/administration/api';
import { Button } from '@/components/ui/button';
import { useAuthStore } from '@/store/auth';
import { useSafetyAlertStore } from '@/store/safety-alerts';
import { ShieldAlert, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { EventDetail, severityBadge, type SafetyEventRow } from './SafetyEventsScreen';

const SAFETY_READ_ROLES = ['SYSTEM_ADMIN', 'SUPER_ADMIN', 'DIVISION_ADMIN', 'DIVISION_MONITOR'];

interface Page {
  items: SafetyEventRow[];
}

/**
 * Safety events raised during this call, reviewable in place so the live call is never left.
 */
export function LiveSafetyReviewDrawer({ callId }: { callId: number }) {
  const role = useAuthStore(state => state.user?.rmoRole);
  const version = useSafetyAlertStore(state => state.version);
  const reviewEventId = useSafetyAlertStore(state => state.reviewEventId);
  const setActiveCall = useSafetyAlertStore(state => state.setActiveCall);
  const openReview = useSafetyAlertStore(state => state.openReview);
  const closeReview = useSafetyAlertStore(state => state.closeReview);
  const [events, setEvents] = useState<SafetyEventRow[]>([]);
  const [listOpen, setListOpen] = useState(false);
  const enabled = !!role && SAFETY_READ_ROLES.includes(role);

  useEffect(() => {
    if (!enabled) return undefined;
    setActiveCall(callId);
    return () => setActiveCall(null);
  }, [callId, enabled, setActiveCall]);

  useEffect(() => {
    if (!enabled) return undefined;
    let cancelled = false;
    apiRequest<Page>(`/api/safety-events?callId=${callId}&pageSize=50`)
      .then(page => {
        if (!cancelled) setEvents(page.items);
      })
      .catch(() => {
        // The call continues even if the safety list cannot load.
      });
    return () => {
      cancelled = true;
    };
  }, [callId, enabled, version]);

  if (!enabled) return null;

  const pending = events.filter(event => event.status === 'PENDING_REVIEW').length;
  const selected = reviewEventId != null
    ? events.find(event => event.id === reviewEventId) || null
    : null;
  const open = listOpen || reviewEventId != null;

  const replace = (saved: SafetyEventRow) => {
    setEvents(current => current.map(event => (event.id === saved.id ? saved : event)));
  };

  return (
    <>
      {events.length ? (
        <button
          type="button"
          onClick={() => setListOpen(true)}
          className={`absolute left-4 top-24 z-20 flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-semibold text-white shadow ${
            pending ? 'animate-pulse bg-red-600' : 'bg-black/60'
          }`}
        >
          <ShieldAlert className="size-4" />
          {pending
            ? `${pending} safety alert${pending === 1 ? '' : 's'} to review`
            : `Safety events (${events.length})`}
        </button>
      ) : null}
      {open ? (
        <div className="absolute inset-y-0 right-0 z-30 flex w-full max-w-md flex-col overflow-y-auto bg-background p-4 text-foreground shadow-2xl">
          <div className="mb-3 flex items-center justify-between">
            <p className="text-base font-semibold">Safety review — this call</p>
            <Button
              variant="ghost"
              size="sm"
              aria-label="Close safety review"
              onClick={() => {
                closeReview();
                setListOpen(false);
              }}
            >
              <X className="size-4" />
            </Button>
          </div>
          {selected ? (
            <EventDetail
              event={selected}
              onSaved={replace}
              onClose={closeReview}
            />
          ) : reviewEventId != null ? (
            <p className="text-sm text-muted-foreground">Loading safety event…</p>
          ) : events.length ? (
            <ul className="space-y-2">
              {events.map(event => {
                const badge = severityBadge(event.severity, event.kind);
                return (
                  <li key={event.id}>
                    <button
                      type="button"
                      onClick={() => openReview(event.id)}
                      className="w-full rounded-lg border p-3 text-left text-sm hover:bg-muted/50"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium">
                          {event.subject?.name || `Unidentified (${event.trackId})`}
                        </span>
                        <span className={`rounded-full px-2 py-0.5 text-xs ${badge.className}`}>
                          {badge.label}
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {new Date(event.startedAt).toLocaleTimeString()} ·{' '}
                        {event.status === 'PENDING_REVIEW' ? 'Pending review' : 'Reviewed'}
                      </p>
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">No safety events on this call yet.</p>
          )}
        </div>
      ) : null}
    </>
  );
}
