'use client';

import { useEffect } from 'react';

export function useMonitoringEvents(onEvent: () => void) {
  useEffect(() => {
    onEvent();
    const source = new EventSource('/api/monitoring/events');
    source.onmessage = () => onEvent();
    const timer = window.setInterval(onEvent, 12000);
    return () => {
      source.close();
      window.clearInterval(timer);
    };
  }, [onEvent]);
}

export function formatDuration(seconds: number | null | undefined) {
  const total = Math.max(0, seconds || 0);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  if (hours > 0) return `${hours}h ${String(minutes).padStart(2, '0')}m`;
  return `${minutes}m ${String(total % 60).padStart(2, '0')}s`;
}

export function formatWhen(value: string | null | undefined) {
  if (!value) return '—';
  return new Date(value).toLocaleString();
}
