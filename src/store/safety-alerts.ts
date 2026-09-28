import { create } from 'zustand';

interface SafetyAlertState {
  pending: number | null;
  /** Increments on every safety event from the live stream so screens can refresh. */
  version: number;
  /** Call currently open on this monitor's screen; alerts for it are reviewed in place. */
  activeCallId: number | null;
  /** Safety event open in the in-call review drawer. */
  reviewEventId: number | null;
  setPending: (pending: number) => void;
  bump: () => void;
  setActiveCall: (callId: number | null) => void;
  openReview: (eventId: number) => void;
  closeReview: () => void;
}

export const useSafetyAlertStore = create<SafetyAlertState>()(set => ({
  pending: null,
  version: 0,
  activeCallId: null,
  reviewEventId: null,
  setPending: pending => set(() => ({ pending })),
  bump: () => set(state => ({ version: state.version + 1 })),
  setActiveCall: callId => set(() => ({ activeCallId: callId, reviewEventId: null })),
  openReview: eventId => set(() => ({ reviewEventId: eventId })),
  closeReview: () => set(() => ({ reviewEventId: null })),
}));
