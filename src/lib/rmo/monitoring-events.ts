export interface MonitoringEvent {
  type: string;
  divisionId: number;
  lobbyId: number;
  callId?: number;
  recordingId?: number;
  at: string;
}

type Listener = (event: MonitoringEvent) => void;

const listeners = new Set<Listener>();

/**
 * In-process bus for the local Next.js server.
 * Production should publish the same events through a shared broker.
 * Media itself stays on the LiveKit room, not on this bus.
 */
export function publishMonitoringEvent(
  event: Omit<MonitoringEvent, 'at'> & { at?: string },
) {
  const message: MonitoringEvent = { ...event, at: event.at || new Date().toISOString() };
  for (const listener of listeners) {
    listener(message);
  }
}

export function subscribeMonitoringEvents(listener: Listener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
