'use client';

import { useEffect } from 'react';

export function useCallRingtone(active: boolean) {
  useEffect(() => {
    if (!active || typeof window === 'undefined') return undefined;
    const Ctx = window.AudioContext;
    const ctx = new Ctx();
    let stopped = false;

    const tone = (frequency: number, when: number) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = frequency;
      gain.gain.setValueAtTime(0.0001, when);
      gain.gain.exponentialRampToValueAtTime(0.05, when + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.0001, when + 0.32);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(when);
      osc.stop(when + 0.34);
    };

    const ring = () => {
      if (stopped) return;
      void ctx.resume().catch(() => undefined);
      const now = ctx.currentTime;
      tone(440, now);
      tone(480, now);
      tone(440, now + 0.42);
      tone(480, now + 0.42);
    };

    ring();
    const timer = window.setInterval(ring, 2400);
    const unlock = () => {
      void ctx.resume().catch(() => undefined);
    };
    window.addEventListener('pointerdown', unlock);
    return () => {
      stopped = true;
      window.clearInterval(timer);
      window.removeEventListener('pointerdown', unlock);
      void ctx.close().catch(() => undefined);
    };
  }, [active]);
}
