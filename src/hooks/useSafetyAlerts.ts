'use client';

import { useAuthStore } from '@/store/auth';
import { useSafetyAlertStore } from '@/store/safety-alerts';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect } from 'react';
import { toast } from 'sonner';

const ALERT_ROLES = ['SYSTEM_ADMIN', 'SUPER_ADMIN', 'DIVISION_ADMIN', 'DIVISION_MONITOR'];
const PENDING_REFRESH_MS = 60_000;

interface SafetyStreamEvent {
  type: string;
  callId?: number;
  safety?: {
    eventId: number;
    kind?: string;
    severity: string;
    status: string;
    trackId: string;
    subjectName: string | null;
    lobbyName: string | null;
  };
}

function playAlertTone(high: boolean) {
  try {
    const context = new AudioContext();
    const tones = high ? [880, 660, 880] : [660];
    tones.forEach((frequency, index) => {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      const start = context.currentTime + index * 0.22;
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.2, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.18);
      oscillator.connect(gain).connect(context.destination);
      oscillator.start(start);
      oscillator.stop(start + 0.2);
    });
    window.setTimeout(() => void context.close(), tones.length * 250 + 100);
  } catch {
    // Audio may be blocked until the user interacts with the page.
  }
}

function notifyDesktop(title: string, body: string) {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  if (document.visibilityState === 'visible') return;
  try {
    new Notification(title, { body, tag: title });
  } catch {
    // Some browsers only allow notifications from a service worker.
  }
}

/**
 * Live safety alerts for division staff: toast + tone on new or escalated events,
 * and a pending-review count for the sidebar badge.
 */
export function useSafetyAlerts() {
  const role = useAuthStore(state => state.user?.rmoRole);
  const setPending = useSafetyAlertStore(state => state.setPending);
  const bump = useSafetyAlertStore(state => state.bump);
  const router = useRouter();
  const enabled = !!role && ALERT_ROLES.includes(role);

  const refreshPending = useCallback(() => {
    fetch('/api/safety-events?status=PENDING_REVIEW&pageSize=1')
      .then(response => (response.ok ? response.json() : null))
      .then(body => {
        if (typeof body?.data?.pending === 'number') setPending(body.data.pending);
      })
      .catch(() => {});
  }, [setPending]);

  useEffect(() => {
    if (!enabled) return;
    refreshPending();
    const source = new EventSource('/api/monitoring/events');
    source.onmessage = message => {
      let event: SafetyStreamEvent;
      try {
        event = JSON.parse(message.data);
      } catch {
        return;
      }
      if (!event.type?.startsWith('safety.') || !event.safety) return;
      bump();
      refreshPending();
      if (event.type === 'safety.reviewed') {
        toast.dismiss(`safety-${event.safety.eventId}`);
        return;
      }

      const drowsy = event.safety.kind === 'DROWSINESS';
      const high = !drowsy && event.safety.severity === 'HIGH_INDICATORS';
      const who = event.safety.subjectName || `Unidentified person (${event.safety.trackId})`;
      const where = event.safety.lobbyName || 'a lobby';
      const title = drowsy
        ? 'Possible drowsiness'
        : high
          ? 'High visual impairment indicators'
          : 'Elevated visual impairment indicators';
      const description = drowsy
        ? `${who} · ${where}. Eyes closed or head slumped for a sustained period — review required.`
        : `${who} · ${where}. Visual indicators only — review required.`;
      const eventId = event.safety.eventId;
      const callId = event.callId;
      const show = high ? toast.error : toast.warning;
      const onThisCall = callId != null && useSafetyAlertStore.getState().activeCallId === callId;
      show(title, {
        id: `safety-${eventId}`,
        description: onThisCall ? `${description} Review now without leaving the call.` : description,
        duration: high ? Infinity : 20_000,
        action: {
          label: onThisCall ? 'Review now' : 'Review',
          onClick: () => {
            if (useSafetyAlertStore.getState().activeCallId === callId) {
              useSafetyAlertStore.getState().openReview(eventId);
              return;
            }
            router.push(`/safety-events?id=${eventId}`);
          },
        },
        cancel: callId && !onThisCall
          ? { label: 'Open call', onClick: () => router.push(`/monitoring/calls/${callId}`) }
          : undefined,
      });
      playAlertTone(high);
      notifyDesktop(title, description);
    };
    const timer = window.setInterval(refreshPending, PENDING_REFRESH_MS);
    return () => {
      source.close();
      window.clearInterval(timer);
    };
  }, [enabled, bump, refreshPending, router]);
}
