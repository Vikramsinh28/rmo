'use client';

import { useCallback, useEffect, useState } from 'react';
import { apiRequest } from '../administration/api';

interface AICapabilities {
  available: boolean;
  reason: string | null;
  moduleNote: string;
  plan: string | null;
  features: {
    faceIdentification: boolean;
    fatigueDetection: boolean;
    impairmentDetection: boolean;
    behaviorMonitoring: boolean;
  };
}

const LABELS = [
  { key: 'faceIdentification', label: 'Face Identification' },
  { key: 'fatigueDetection', label: 'Fatigue Detection' },
  { key: 'impairmentDetection', label: 'Potential Impairment' },
  { key: 'behaviorMonitoring', label: 'Behavior Monitoring' },
] as const;

export function AICapabilityBadge({ callId }: { callId?: number | null }) {
  const [ai, setAi] = useState<AICapabilities | null>(null);

  const load = useCallback(async () => {
    try {
      if (callId) {
        const page = await apiRequest<{
          ai: {
            enabled: boolean;
            reason: string | null;
            moduleNote: string;
            plan: string | null;
            features: AICapabilities['features'];
          };
        }>(`/api/monitoring/calls/${callId}/ai`);
        setAi({
          available: page.ai.enabled,
          reason: page.ai.reason,
          moduleNote: page.ai.moduleNote,
          plan: page.ai.plan,
          features: page.ai.features,
        });
        return;
      }
      const mine = await apiRequest<AICapabilities>('/api/monitoring/ai');
      setAi(mine);
    } catch {
      setAi(null);
    }
  }, [callId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!ai) return null;

  return (
    <aside className="rounded-xl border border-white/10 bg-black/40 px-3 py-3 text-xs text-zinc-200">
      <div className="flex items-center justify-between gap-2">
        <p className="font-semibold uppercase tracking-wide text-orange-200/80">AI Monitoring</p>
        <span className={ai.available ? 'text-emerald-400' : 'text-zinc-400'}>
          {ai.available ? '● Enabled' : '○ Not enabled'}
        </span>
      </div>
      {ai.plan ? <p className="mt-1 text-zinc-400">Plan {ai.plan}</p> : null}
      {!ai.available ? (
        <p className="mt-2 text-zinc-400">{ai.reason || 'Not enabled for this division.'}</p>
      ) : (
        <ul className="mt-2 space-y-1">
          {LABELS.map(item => (
            <li key={item.key} className="flex items-center gap-2">
              <span>{ai.features[item.key] ? '✓' : '○'}</span>
              <span>{item.label}</span>
            </li>
          ))}
        </ul>
      )}
      {ai.available ? (
        <p className="mt-2 text-[10px] text-zinc-500">{ai.moduleNote}</p>
      ) : null}
    </aside>
  );
}
