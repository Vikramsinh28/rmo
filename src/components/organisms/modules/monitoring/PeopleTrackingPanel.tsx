'use client';

interface TrackedPersonView {
  trackId: string;
  role?: 'subject' | 'other';
  notices?: string[];
  drowsiness?: {
    status?: string;
    closedFraction?: number | null;
    slumpedFraction?: number | null;
    headStill?: boolean | null;
  } | null;
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
    pose?.yaw != null
      ? `Head ${degrees(pose.pitch)}/${degrees(pose.yaw)}/${degrees(pose.roll)}`
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
    case 'NOT_ASSESSED':
      return 'Not assessed (not the interview subject)';
    case 'INSUFFICIENT_EVIDENCE':
    default:
      return 'Insufficient Evidence';
  }
}

function visualClass(status: string | undefined) {
  switch (status) {
    case 'HIGH_INDICATORS':
      return 'font-medium text-red-300';
    case 'ELEVATED_INDICATORS':
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
  const status = person.visualStatus || impairment?.status;
  if (!impairment && !status) return null;
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

function Drowsiness({ person }: { person: TrackedPersonView }) {
  const status = person.drowsiness?.status;
  if (!status) return null;
  const closed = person.drowsiness?.closedFraction;
  const slumped = person.drowsiness?.headStill ? person.drowsiness?.slumpedFraction : null;
  const parts = [
    closed == null ? null : `eyes closed ${Math.round(closed * 100)}%`,
    slumped ? `head slumped ${Math.round(slumped * 100)}%` : null,
  ].filter(Boolean);
  const detail = parts.length ? ` · ${parts.join(', ')} of last 20 s` : '';
  if (status === 'POSSIBLE_DROWSINESS') {
    return <p className="font-medium text-fuchsia-300">Possible drowsiness{detail}</p>;
  }
  if (status === 'NONE') {
    return <p className="text-zinc-400">Drowsiness: none{detail}</p>;
  }
  return <p className="text-zinc-500">Drowsiness: not enough face or head data yet</p>;
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

function subjectFirst(persons: TrackedPersonView[]) {
  return [...persons].sort(
    (a, b) => Number(b.role === 'subject') - Number(a.role === 'subject'),
  );
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
          {subjectFirst(persons).map(person => {
            const headline = identityHeadline(person);
            const recognized = person.identity?.status === 'RECOGNIZED';
            const other = person.role === 'other';
            const lying = person.notices?.includes('LYING_DOWN');
            return (
              <div
                key={person.trackId}
                className={`rounded-lg border px-2 py-2 ${other ? 'border-white/5 bg-white/[0.02] opacity-80' : 'border-white/10 bg-white/5'}`}
              >
                <p className="font-medium text-zinc-100">
                  {person.trackId}
                  {person.role ? (
                    <span className={`ml-2 rounded px-1.5 py-0.5 text-[10px] font-normal ${other ? 'bg-zinc-700 text-zinc-300' : 'bg-sky-700 text-sky-100'}`}>
                      {other ? 'Other person' : 'Interview subject'}
                    </span>
                  ) : null}
                </p>
                {lying ? (
                  <p className="font-medium text-violet-300">Lying down — check the person is safe</p>
                ) : null}
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
                <VisualStatus person={person} />
                <Drowsiness person={person} />
                {other ? null : (
                  <>
                    <p className="text-zinc-400">
                      Evidence quality: {qualityLabel(person.quality?.score)}
                    </p>
                    <SignalRow person={person} />
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}
      <p className="mt-2 text-[10px] text-zinc-500">
        Only the interview subject (largest, most central person) is assessed. Automatic
        identity is quality-gated (~15s). Track IDs are temporary.
      </p>
    </aside>
  );
}
