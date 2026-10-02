'use client';

interface SafetySignalView {
  type?: string;
  durationMs?: number;
  severity?: string;
  label?: string;
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
  identityStatus?: string;
  tracking?: { confidence?: number };
  quality?: { score?: number | null };
  visualStatus?: string;
  impairment?: {
    status?: string;
    confidence?: number | null;
    evidence?: string[];
    limitations?: string[];
    requiresHumanVerification?: boolean;
    guidance?: string | null;
  };
  safety?: {
    state?: string;
    signals?: SafetySignalView[];
    requiresHumanVerification?: boolean;
    guidance?: string | null;
  };
  face?: {
    visible?: boolean;
    headPose?: { pitch?: number | null; yaw?: number | null; roll?: number | null };
    eyes?: { openProbability?: number | null };
  };
  body?: {
    torsoAngle?: number | null;
    lowerBodyVisible?: boolean;
    gaitAvailable?: boolean;
  };
  movement?: { lateralSway?: number | null };
}

function degrees(value: number | null | undefined) {
  return value == null ? '—' : `${Math.round(value)}°`;
}

function SignalRow({ person }: { person: TrackedPersonView }) {
  const pose = person.face?.headPose;
  const eyes = person.face?.eyes?.openProbability;
  const sway = person.movement?.lateralSway;
  const signals = [
    `Torso ${degrees(person.body?.torsoAngle)}`,
    pose?.yaw != null || pose?.pitch != null
      ? `Head ${degrees(pose?.pitch)}/${degrees(pose?.yaw)}/${degrees(pose?.roll)}`
      : 'Head —',
    `Eyes ${eyes == null ? '—' : `${Math.round(eyes * 100)}%`}`,
    `Sway ${sway == null ? '—' : sway.toFixed(3)}`,
    person.body?.gaitAvailable ? 'Gait visible' : 'No gait',
  ];
  return <p className="text-[10px] text-zinc-500">{signals.join(' · ')}</p>;
}

function qualityLabel(score: number | null | undefined) {
  if (score == null) return '—';
  if (score >= 0.7) return 'Good';
  if (score >= 0.4) return 'Fair';
  return 'Low';
}

function formatDuration(ms: number | null | undefined) {
  if (ms == null || !Number.isFinite(ms)) return '—';
  return `${(ms / 1000).toFixed(1)} sec`;
}

function visualLabel(status: string | undefined) {
  switch (status) {
    case 'NORMAL':
      return 'Normal';
    case 'MONITORING':
      return 'Monitoring';
    case 'ELEVATED_INDICATORS':
    case 'WARNING':
      return 'Elevated Visual Impairment Indicators';
    case 'HIGH_INDICATORS':
    case 'CRITICAL':
      return 'High Visual Impairment Indicators';
    case 'INSUFFICIENT_EVIDENCE':
    default:
      return 'Insufficient Evidence';
  }
}

function visualClass(status: string | undefined) {
  switch (status) {
    case 'HIGH_INDICATORS':
    case 'CRITICAL':
      return 'font-medium text-red-300';
    case 'ELEVATED_INDICATORS':
    case 'WARNING':
      return 'font-medium text-amber-300';
    case 'MONITORING':
      return 'text-yellow-200';
    case 'NORMAL':
      return 'text-emerald-300';
    default:
      return 'text-zinc-400';
  }
}

function VisualStatus({ person }: { person: TrackedPersonView }) {
  const impairment = person.impairment;
  const status = person.visualStatus || impairment?.status || person.safety?.state;
  if (!impairment && !status && !person.safety) return null;
  const details = impairment?.evidence?.length ? impairment.evidence : impairment?.limitations;
  return (
    <>
      <p className={visualClass(status)}>
        Visual status: {visualLabel(status)}
        {impairment?.confidence != null ? ` · ${formatConfidence(impairment.confidence)}` : ''}
      </p>
      {details?.length ? (
        <p className="text-[10px] text-zinc-500">{details.slice(0, 2).join(' · ')}</p>
      ) : null}
    </>
  );
}

function formatConfidence(confidence: number | null | undefined) {
  if (confidence == null) return '—';
  const pct = confidence > 1 ? confidence : confidence * 100;
  return `${Math.round(pct)}%`;
}

function checkedAgo(iso: string | null | undefined) {
  if (!iso) return '—';
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return 'just now';
  const sec = Math.floor(ms / 1000);
  if (sec < 5) return 'just now';
  if (sec < 60) return `${sec} sec ago`;
  return `${Math.floor(sec / 60)} min ago`;
}

function identityHeadline(person: TrackedPersonView) {
  const status = person.identity?.status || person.identityStatus || 'UNKNOWN';
  if (status === 'RECOGNIZED') {
    return {
      title: `Recognized: ${person.identity?.displayName || 'Crew Member'}`,
      subtitle: 'Recognized',
      className: 'text-emerald-300',
    };
  }
  if (status === 'CHECKING') {
    return {
      title: 'Checking identity...',
      subtitle: 'Checking identity...',
      className: 'text-amber-200',
    };
  }
  if (status === 'UNAVAILABLE') {
    return {
      title: 'Identity service unavailable',
      subtitle: 'Identity service unavailable',
      className: 'text-zinc-400',
    };
  }
  if (person.identity?.reason === 'LOW_FACE_QUALITY' || person.identity?.reason === 'LOW_QUALITY'
    || person.identity?.reason === 'NO_FACE'
    || person.identity?.reason === 'FACE_TOO_SMALL'
    || person.identity?.reason === 'INVALID_FACE_BOX'
    || person.identity?.reason === 'INVALID_CROP') {
    return {
      title: 'Unknown',
      subtitle: 'Insufficient face quality',
      className: 'text-zinc-300',
    };
  }
  return {
    title: 'Unknown',
    subtitle: 'Identity not resolved',
    className: 'text-zinc-300',
  };
}

function safetyPresentation(person: TrackedPersonView) {
  const state = person.safety?.state
    || (person.visualStatus === 'HIGH_INDICATORS' ? 'CRITICAL'
      : person.visualStatus === 'ELEVATED_INDICATORS' ? 'WARNING'
        : person.visualStatus === 'NORMAL' ? 'NORMAL'
          : person.visualStatus === 'MONITORING' ? 'WARNING'
            : 'INSUFFICIENT_EVIDENCE');

  if (state === 'CRITICAL' || state === 'HIGH_INDICATORS') {
    return { label: 'CRITICAL', className: 'text-red-300', icon: '⛔' };
  }
  if (state === 'WARNING' || state === 'ELEVATED_INDICATORS' || state === 'MONITORING') {
    return { label: 'WARNING', className: 'text-amber-300', icon: '⚠' };
  }
  if (state === 'NORMAL') {
    return { label: 'NORMAL', className: 'text-emerald-300', icon: '●' };
  }
  return { label: 'INSUFFICIENT EVIDENCE', className: 'text-zinc-400', icon: '○' };
}

function signalLabel(signal: SafetySignalView) {
  if (signal.type === 'EYE_CLOSURE') return 'Eyes closed';
  if (signal.type === 'HEAD_DOWN') return 'Head down';
  return signal.label || signal.type || 'Signal';
}

export function PeopleTrackingPanel({
  persons,
  processing,
  safetySummary,
}: {
  persons: TrackedPersonView[];
  processing: boolean;
  safetySummary?: {
    warningCount?: number;
    criticalCount?: number;
    activeAlerts?: unknown[];
    lastAlertAt?: string | null;
  } | null;
}) {
  if (!processing) return null;

  return (
    <aside className="w-full max-w-sm rounded-xl border border-white/10 bg-black/50 px-3 py-3 text-xs text-zinc-100">
      <div className="flex items-center justify-between gap-2">
        <p className="font-semibold uppercase tracking-wide text-orange-200/80">People</p>
        <span className="text-emerald-400">● Processing</span>
      </div>
      <p className="mt-1 text-zinc-400">People detected: {persons.length}</p>
      {safetySummary ? (
        <p className="mt-1 text-zinc-500">
          Alerts: {safetySummary.warningCount ?? 0} warning / {safetySummary.criticalCount ?? 0} critical
        </p>
      ) : null}
      {persons.length === 0 ? (
        <p className="mt-2 text-zinc-500">No people in the current sample.</p>
      ) : (
        <div className="mt-2 max-h-72 space-y-2 overflow-y-auto">
          {persons.map(person => {
            const headline = identityHeadline(person);
            const recognized = person.identity?.status === 'RECOGNIZED';
            const safety = safetyPresentation(person);
            const signals = person.safety?.signals || [];
            const needsVerify = Boolean(
              person.safety?.requiresHumanVerification
              || person.impairment?.requiresHumanVerification
              || person.visualStatus === 'ELEVATED_INDICATORS'
              || person.visualStatus === 'HIGH_INDICATORS',
            );
            return (
              <div
                key={person.trackId}
                className="rounded-lg border border-white/10 bg-white/5 px-2 py-2"
              >
                <p className="font-medium text-zinc-100">{person.trackId}</p>
                <p className={headline.className}>{headline.title}</p>
                <p className="text-zinc-400">
                  {recognized ? 'Recognized' : headline.subtitle}
                </p>
                {recognized ? (
                  <p className="text-zinc-400">
                    Confidence {formatConfidence(person.identity?.confidence)}
                  </p>
                ) : null}
                <p className="text-zinc-400">
                  Last checked: {checkedAgo(person.identity?.lastCheckedAt)}
                </p>
                <p className={`mt-1 font-medium ${safety.className}`}>
                  Safety: {safety.icon} {safety.label}
                </p>
                {signals.length > 0 ? (
                  <ul className="mt-1 space-y-0.5 text-zinc-300">
                    {signals.map(signal => (
                      <li key={`${person.trackId}-${signal.type}-${signal.durationMs}`}>
                        • {signalLabel(signal)} — {formatDuration(signal.durationMs)}
                      </li>
                    ))}
                  </ul>
                ) : null}
                <VisualStatus person={person} />
                <p className="text-zinc-400">
                  Evidence quality: {qualityLabel(person.quality?.score)}
                </p>
                <SignalRow person={person} />
                {needsVerify ? (
                  <p className="mt-1 text-[11px] text-amber-200/90">
                    Potential impairment indicator — requires human verification.
                  </p>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
      <p className="mt-2 text-[10px] text-zinc-500">
        Temporal safety uses eye-closure / head-down duration. Not alcohol diagnosis.
        Identity is quality-gated separately. Manual Recognize Faces remains separate.
      </p>
    </aside>
  );
}
