'use client';

import { Button } from '@/components/ui/button';
import { useAuthStore } from '@/store/auth';
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { apiRequest } from '../administration/api';
import { PeopleTrackingPanel } from './PeopleTrackingPanel';

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

interface IdentityResolutionSummary {
  enabled?: boolean;
  provider?: string;
  requestCount?: number;
  recognizedCount?: number;
  unknownCount?: number;
  awsAvailable?: boolean;
}

interface SafetySummary {
  warningCount?: number;
  criticalCount?: number;
  activeAlerts?: unknown[];
  lastAlertAt?: string | null;
  strictMode?: boolean;
  enabled?: boolean;
}

interface TrackedPersonView {
  trackId: string;
  identity?: {
    status?: string;
    displayName?: string | null;
    confidence?: number | null;
    reason?: string | null;
    lastCheckedAt?: string | null;
  };
  quality?: { score?: number | null };
  visualStatus?: string;
  impairment?: { status?: string };
  safety?: {
    state?: string;
    signals?: Array<{
      type?: string;
      durationMs?: number;
      severity?: string;
      label?: string;
    }>;
    requiresHumanVerification?: boolean;
    guidance?: string | null;
  };
}

const LABELS = [
  { key: 'faceIdentification', label: 'Face Identification' },
  { key: 'fatigueDetection', label: 'Fatigue Detection' },
  { key: 'impairmentDetection', label: 'Potential Impairment' },
  { key: 'behaviorMonitoring', label: 'Behavior Monitoring' },
] as const;

const AUTO_START_ENABLED = process.env.NEXT_PUBLIC_AI_AUTO_START !== 'false';

export function AICapabilityBadge({
  callId,
  canControl = false,
  autoStart = false,
}: {
  callId?: number | null;
  canControl?: boolean;
  /** Start AI once when the call opens and no job has ever run for it. */
  autoStart?: boolean;
}) {
  const role = useAuthStore(state => state.user?.rmoRole);
  const [ai, setAi] = useState<AICapabilities | null>(null);
  const [job, setJob] = useState<ProcessingJob | null>(null);
  const [people, setPeople] = useState<TrackedPersonView[]>([]);
  const [identity, setIdentity] = useState<IdentityResolutionSummary | null>(null);
  const [safety, setSafety] = useState<SafetySummary | null>(null);
  const [busy, setBusy] = useState(false);
  const [callState, setCallState] = useState<{
    callId: number;
    connected: boolean;
    everStarted: boolean;
  } | null>(null);
  const autoStarted = useRef<number | null>(null);
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
          callStatus?: string;
          everStarted?: boolean;
          processing: ProcessingJob | null;
          people?: { persons?: TrackedPersonView[]; count?: number };
          identityResolution?: IdentityResolutionSummary;
          safety?: SafetySummary | null;
        }>(`/api/monitoring/calls/${callId}/ai/status`);
        setAi({
          available: page.ai.enabled,
          reason: page.ai.reason,
          moduleNote: page.ai.moduleNote,
          plan: null,
          features: page.ai.features,
        });
        setJob(page.processing);
        setPeople(Array.isArray(page.people?.persons) ? page.people.persons : []);
        setIdentity(page.identityResolution || null);
        setSafety(page.safety || null);
        setCallState({
          callId,
          connected: page.callStatus === 'CONNECTED',
          everStarted: page.everStarted ?? page.processing !== null,
        });
        return;
      }
      const mine = await apiRequest<AICapabilities>('/api/monitoring/ai');
      setAi(mine);
      setJob(null);
      setPeople([]);
      setIdentity(null);
      setSafety(null);
      setCallState(null);
    } catch {
      setAi(null);
      setJob(null);
      setPeople([]);
      setIdentity(null);
      setSafety(null);
      setCallState(null);
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

  const start = useCallback(async (automatic = false) => {
    if (!callId) return;
    setBusy(true);
    try {
      await apiRequest(`/api/monitoring/calls/${callId}/ai/start`, { method: 'POST' });
      toast.success(
        automatic
          ? 'AI monitoring started automatically for this call.'
          : 'AI processing started. The live call continues.',
      );
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not start AI processing.');
    } finally {
      setBusy(false);
    }
  }, [callId, load]);

  const wantsAutoStart = AUTO_START_ENABLED && autoStart && allowControl && !!callId
    && callState?.callId === callId && !!ai?.available && !callState.everStarted
    && autoStarted.current !== callId;
  const waitingForConnection = wantsAutoStart && !callState?.connected;

  useEffect(() => {
    if (!wantsAutoStart || waitingForConnection || !callId) return;
    autoStarted.current = callId;
    void start(true);
  }, [wantsAutoStart, waitingForConnection, callId, start]);

  useEffect(() => {
    if (!waitingForConnection) return undefined;
    const timer = window.setInterval(() => void load(), 3000);
    return () => window.clearInterval(timer);
  }, [waitingForConnection, load]);

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
    <div className="flex flex-col items-end gap-2">
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
                <p>People: {people.length}</p>
                <p>
                  Recognized:{' '}
                  {people.filter(person => person.identity?.status === 'RECOGNIZED').length}
                </p>
                <p>
                  Safety warnings: {safety?.warningCount ?? 0}
                  {' · '}
                  critical: {safety?.criticalCount ?? 0}
                </p>
                <p className="mt-1 font-medium uppercase tracking-wide text-orange-200/70">
                  AI Identity
                </p>
                <p>
                  {ai.features.faceIdentification && identity?.enabled !== false
                    ? '● Active'
                    : '○ Inactive'}
                </p>
                <p>
                  {(identity?.requestCount ?? 0)} / 100 identity checks
                </p>
                <p className="text-[10px] text-zinc-500">
                  Temporal safety ≠ alcohol diagnosis. Identity is quality-gated separately.
                </p>
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
      <PeopleTrackingPanel
        persons={people}
        processing={processing}
        safetySummary={safety}
      />
    </div>
  );
}
