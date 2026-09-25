'use client';

import { Button } from '@/components/ui/button';
import { useAuthStore } from '@/store/auth';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
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

interface ProcessingJob {
  id: number;
  status: string;
  framesReceived: number;
  framesProcessed: number;
  processingFps: number | null;
  lastFrameAt: string | null;
}

const LABELS = [
  { key: 'faceIdentification', label: 'Face Identification' },
  { key: 'fatigueDetection', label: 'Fatigue Detection' },
  { key: 'impairmentDetection', label: 'Potential Impairment' },
  { key: 'behaviorMonitoring', label: 'Behavior Monitoring' },
] as const;

export function AICapabilityBadge({
  callId,
  canControl = false,
}: {
  callId?: number | null;
  canControl?: boolean;
}) {
  const role = useAuthStore(state => state.user?.rmoRole);
  const [ai, setAi] = useState<AICapabilities | null>(null);
  const [job, setJob] = useState<ProcessingJob | null>(null);
  const [busy, setBusy] = useState(false);
  const allowControl = canControl && (role === 'DIVISION_MONITOR' || role === 'SYSTEM_ADMIN');

  const load = useCallback(async () => {
    try {
      if (callId) {
        const page = await apiRequest<{
          ai: {
            enabled: boolean;
            reason: string | null;
            moduleNote: string;
            features: AICapabilities['features'];
          };
          processing: ProcessingJob | null;
        }>(`/api/monitoring/calls/${callId}/ai/status`);
        setAi({
          available: page.ai.enabled,
          reason: page.ai.reason,
          moduleNote: page.ai.moduleNote,
          plan: null,
          features: page.ai.features,
        });
        setJob(page.processing);
        return;
      }
      const mine = await apiRequest<AICapabilities>('/api/monitoring/ai');
      setAi(mine);
      setJob(null);
    } catch {
      setAi(null);
      setJob(null);
    }
  }, [callId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!callId || !job || (job.status !== 'RUNNING' && job.status !== 'STARTING')) {
      return undefined;
    }
    const timer = window.setInterval(() => {
      void load();
    }, 2000);
    return () => window.clearInterval(timer);
  }, [callId, job?.status, load]);

  async function start() {
    if (!callId) return;
    setBusy(true);
    try {
      await apiRequest(`/api/monitoring/calls/${callId}/ai/start`, { method: 'POST' });
      toast.success('AI processing started. The live call continues.');
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not start AI processing.');
    } finally {
      setBusy(false);
    }
  }

  async function stop() {
    if (!callId) return;
    setBusy(true);
    try {
      await apiRequest(`/api/monitoring/calls/${callId}/ai/stop`, { method: 'POST' });
      toast.success('AI processing stopped. The live call continues.');
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not stop AI processing.');
    } finally {
      setBusy(false);
    }
  }

  if (!ai) return null;

  const processing = job?.status === 'RUNNING' || job?.status === 'STARTING';

  return (
    <aside className="rounded-xl border border-white/10 bg-black/40 px-3 py-3 text-xs text-zinc-200">
      <div className="flex items-center justify-between gap-2">
        <p className="font-semibold uppercase tracking-wide text-orange-200/80">AI Monitoring</p>
        <span className={processing ? 'text-emerald-400' : ai.available ? 'text-emerald-400' : 'text-zinc-400'}>
          {processing ? '● Processing' : ai.available ? '● Available' : '○ Not enabled'}
        </span>
      </div>
      {!ai.available ? (
        <p className="mt-2 text-zinc-400">{ai.reason || 'Not enabled for this division.'}</p>
      ) : (
        <>
          <ul className="mt-2 space-y-1">
            {LABELS.map(item => (
              <li key={item.key} className="flex items-center gap-2">
                <span>{ai.features[item.key] ? '✓' : '○'}</span>
                <span>{item.label}</span>
              </li>
            ))}
          </ul>
          {processing && job ? (
            <div className="mt-2 space-y-1 text-zinc-300">
              <p>Frames: {job.framesProcessed.toLocaleString()}</p>
              <p>Processing FPS: {job.processingFps ?? 0}</p>
            </div>
          ) : (
            <p className="mt-2 text-[10px] text-zinc-500">{ai.moduleNote}</p>
          )}
          {allowControl && callId ? (
            <div className="mt-3">
              {processing ? (
                <Button
                  type="button"
                  variant="outline"
                  className="h-8 border-white/20 bg-transparent text-xs text-zinc-100"
                  disabled={busy}
                  onClick={() => void stop()}
                >
                  Stop AI Monitoring
                </Button>
              ) : (
                <Button
                  type="button"
                  className="h-8 text-xs"
                  disabled={busy}
                  onClick={() => void start()}
                >
                  Start AI Monitoring
                </Button>
              )}
            </div>
          ) : null}
        </>
      )}
    </aside>
  );
}
