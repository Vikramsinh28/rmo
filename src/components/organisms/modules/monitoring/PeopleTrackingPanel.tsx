'use client';

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
  impairment?: { status?: string; confidence?: number | null };
  face?: { visible?: boolean };
}

function qualityLabel(score: number | null | undefined) {
  if (score == null) return '—';
  if (score >= 0.7) return 'Good';
  if (score >= 0.4) return 'Fair';
  return 'Low';
}

function visualLabel(status: string | undefined) {
  switch (status) {
    case 'NORMAL':
      return 'Normal';
    case 'MONITORING':
      return 'Monitoring';
    case 'ELEVATED_INDICATORS':
      return 'Elevated Visual Impairment Indicators';
    case 'HIGH_INDICATORS':
      return 'High Visual Impairment Indicators';
    case 'INSUFFICIENT_EVIDENCE':
    default:
      return 'Insufficient Evidence';
  }
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
      title: `✓ ${person.identity?.displayName || 'Crew Member'}`,
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

export function PeopleTrackingPanel({
  persons,
  processing,
}: {
  persons: TrackedPersonView[];
  processing: boolean;
}) {
  if (!processing) return null;

  return (
    <aside className="w-full max-w-sm rounded-xl border border-white/10 bg-black/50 px-3 py-3 text-xs text-zinc-100">
      <div className="flex items-center justify-between gap-2">
        <p className="font-semibold uppercase tracking-wide text-orange-200/80">People</p>
        <span className="text-emerald-400">● Processing</span>
      </div>
      <p className="mt-1 text-zinc-400">People detected: {persons.length}</p>
      {persons.length === 0 ? (
        <p className="mt-2 text-zinc-500">No people in the current sample.</p>
      ) : (
        <div className="mt-2 max-h-56 space-y-2 overflow-y-auto">
          {persons.map(person => {
            const headline = identityHeadline(person);
            const recognized = person.identity?.status === 'RECOGNIZED';
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
                <p className="text-zinc-400">
                  Visual status: {visualLabel(person.visualStatus || person.impairment?.status)}
                </p>
                <p className="text-zinc-400">
                  Evidence quality: {qualityLabel(person.quality?.score)}
                </p>
              </div>
            );
          })}
        </div>
      )}
      <p className="mt-2 text-[10px] text-zinc-500">
        Automatic identity is quality-gated (~15s). Manual Recognize Faces remains separate.
        Track IDs are temporary.
      </p>
    </aside>
  );
}
