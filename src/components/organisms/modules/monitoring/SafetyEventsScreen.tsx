'use client';

import { apiRequest } from '@/components/organisms/modules/administration/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useSafetyAlertStore } from '@/store/safety-alerts';
import { useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

type Severity = 'ELEVATED_INDICATORS' | 'HIGH_INDICATORS';
type EventStatus = 'PENDING_REVIEW' | 'CONFIRMED' | 'DISMISSED' | 'INCONCLUSIVE';
type Outcome = 'IMPAIRMENT_CONFIRMED' | 'NOT_IMPAIRED' | 'OTHER_CAUSE' | 'INSUFFICIENT_VIDEO';

export interface SafetyEventRow {
  id: number;
  callId: number;
  trackId: string;
  division: { id: number; code: string; name: string };
  lobby: { id: number; code: string; name: string };
  subject: { userId: number | null; name: string | null; confidence: number | null } | null;
  severity: Severity;
  peakScore: number;
  confidence: number;
  evidence: unknown;
  signalGroups: unknown;
  modelVersion: string;
  status: EventStatus;
  startedAt: string;
  endedAt: string | null;
  review: {
    outcome: Outcome | null;
    note: string | null;
    breathTestPerformed: boolean | null;
    breathTestPositive: boolean | null;
    reviewedBy: { id: number; name: string } | null;
    reviewedAt: string;
  } | null;
  featureWindow?: unknown;
}

interface Page {
  items: SafetyEventRow[];
  total: number;
  page: number;
  pageSize: number;
  pending: number;
}

const STATUS_LABEL: Record<EventStatus, string> = {
  PENDING_REVIEW: 'Pending review',
  CONFIRMED: 'Confirmed',
  DISMISSED: 'Dismissed',
  INCONCLUSIVE: 'Inconclusive',
};

const OUTCOME_LABEL: Record<Outcome, string> = {
  IMPAIRMENT_CONFIRMED: 'Impairment confirmed',
  NOT_IMPAIRED: 'Not impaired',
  OTHER_CAUSE: 'Other cause (medical, fatigue, injury…)',
  INSUFFICIENT_VIDEO: 'Insufficient video to decide',
};

const GROUP_LABEL: Record<string, string> = {
  gait: 'Gait',
  sway: 'Sway',
  posture: 'Posture',
  trunk: 'Upper-body sway',
  head: 'Head',
  eyes: 'Eyes',
  coordination: 'Coordination',
};

const SELECT_CLASS = 'h-9 rounded-md border bg-background px-3 text-sm';

export function severityBadge(severity: Severity) {
  return severity === 'HIGH_INDICATORS'
    ? { label: 'High indicators', className: 'bg-red-50 text-red-800' }
    : { label: 'Elevated indicators', className: 'bg-amber-50 text-amber-800' };
}

function percent(value: number | null | undefined) {
  if (value == null) return '—';
  return `${Math.round((value > 1 ? value / 100 : value) * 100)}%`;
}

function duration(startedAt: string, endedAt: string | null) {
  if (!endedAt) return 'Ongoing';
  const seconds = Math.max(0, Math.round(
    (new Date(endedAt).getTime() - new Date(startedAt).getTime()) / 1000,
  ));
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

function evidenceList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function groupEntries(value: unknown): Array<[string, number | null]> {
  if (!value || typeof value !== 'object') return [];
  return Object.entries(value as Record<string, unknown>).map(([key, score]) => [
    key,
    typeof score === 'number' ? score : null,
  ]);
}

function ReviewForm({
  event,
  onSaved,
}: {
  event: SafetyEventRow;
  onSaved: (event: SafetyEventRow) => void;
}) {
  const [outcome, setOutcome] = useState<Outcome | ''>(event.review?.outcome || '');
  const [note, setNote] = useState(event.review?.note || '');
  const [breathTest, setBreathTest] = useState<'none' | 'negative' | 'positive'>(
    !event.review?.breathTestPerformed
      ? 'none'
      : event.review.breathTestPositive ? 'positive' : 'negative',
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const submit = async () => {
    setSaving(true);
    setError('');
    try {
      const saved = await apiRequest<SafetyEventRow>(`/api/safety-events/${event.id}/review`, {
        method: 'POST',
        body: JSON.stringify({
          outcome,
          note,
          breathTestPerformed: breathTest !== 'none',
          breathTestPositive: breathTest === 'none' ? null : breathTest === 'positive',
        }),
      });
      onSaved(saved);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to save review');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-3 rounded-lg border p-3">
      <p className="text-sm font-medium">{event.review ? 'Update review' : 'Review'}</p>
      <label className="flex flex-col gap-1 text-xs text-muted-foreground">
        Outcome
        <select
          className={SELECT_CLASS}
          value={outcome}
          onChange={change => setOutcome(change.target.value as Outcome | '')}
        >
          <option value="">Choose outcome…</option>
          {(Object.keys(OUTCOME_LABEL) as Outcome[]).map(key => (
            <option key={key} value={key}>{OUTCOME_LABEL[key]}</option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-xs text-muted-foreground">
        Breath test
        <select
          className={SELECT_CLASS}
          value={breathTest}
          onChange={change => setBreathTest(change.target.value as typeof breathTest)}
        >
          <option value="none">Not performed</option>
          <option value="negative">Performed — negative</option>
          <option value="positive">Performed — positive</option>
        </select>
      </label>
      <label className="flex flex-col gap-1 text-xs text-muted-foreground">
        Note
        <Textarea
          value={note}
          maxLength={2000}
          placeholder="What did the supervisor observe? Required when confirming impairment."
          onChange={change => setNote(change.target.value)}
        />
      </label>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
      <Button size="sm" disabled={!outcome || saving} onClick={submit}>
        {saving ? 'Saving…' : 'Save review'}
      </Button>
    </div>
  );
}

export function EventDetail({
  event,
  onSaved,
  onClose,
}: {
  event: SafetyEventRow;
  onSaved: (event: SafetyEventRow) => void;
  onClose: () => void;
}) {
  const badge = severityBadge(event.severity);
  const evidence = evidenceList(event.evidence);
  const groups = groupEntries(event.signalGroups);
  return (
    <aside className="flex flex-col gap-4 rounded-xl border bg-card p-4 lg:sticky lg:top-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-lg font-semibold">Safety event #{event.id}</p>
          <p className="text-xs text-muted-foreground">
            {event.lobby.name} · {event.division.name} · Call {event.callId}
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={onClose}>Close</Button>
      </div>
      <div className="flex flex-wrap gap-2 text-xs">
        <span className={`rounded-full px-2 py-0.5 font-medium ${badge.className}`}>
          {badge.label}
        </span>
        <span className="rounded-full bg-muted px-2 py-0.5">{STATUS_LABEL[event.status]}</span>
      </div>
      <dl className="grid grid-cols-2 gap-2 text-sm">
        <dt className="text-muted-foreground">Person</dt>
        <dd>
          {event.subject?.name || `Unidentified (${event.trackId})`}
          {event.subject?.confidence != null ? ` · ${percent(event.subject.confidence)}` : ''}
        </dd>
        <dt className="text-muted-foreground">Started</dt>
        <dd>{new Date(event.startedAt).toLocaleString()}</dd>
        <dt className="text-muted-foreground">Duration</dt>
        <dd>{duration(event.startedAt, event.endedAt)}</dd>
        <dt className="text-muted-foreground">Peak score</dt>
        <dd>{event.peakScore.toFixed(2)}</dd>
        <dt className="text-muted-foreground">Confidence</dt>
        <dd>{percent(event.confidence)}</dd>
        <dt className="text-muted-foreground">Model</dt>
        <dd className="text-xs">{event.modelVersion}</dd>
      </dl>
      <div>
        <p className="text-sm font-medium">Observed indicators</p>
        {evidence.length ? (
          <ul className="mt-1 list-disc space-y-1 pl-5 text-sm">
            {evidence.map(item => <li key={item}>{item}</li>)}
          </ul>
        ) : (
          <p className="mt-1 text-sm text-muted-foreground">No indicator details recorded.</p>
        )}
      </div>
      {groups.length ? (
        <div>
          <p className="text-sm font-medium">Signal groups</p>
          <div className="mt-2 space-y-1.5">
            {groups.map(([key, score]) => (
              <div key={key} className="flex items-center gap-2 text-xs">
                <span className="w-24 text-muted-foreground">{GROUP_LABEL[key] || key}</span>
                <div className="h-2 flex-1 rounded-full bg-muted">
                  {score != null ? (
                    <div
                      className={`h-2 rounded-full ${score >= 0.6 ? 'bg-red-500' : 'bg-amber-400'}`}
                      style={{ width: `${Math.round(score * 100)}%` }}
                    />
                  ) : null}
                </div>
                <span className="w-10 text-right">
                  {score == null ? 'n/a' : score.toFixed(2)}
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : null}
      {event.review ? (
        <div className="rounded-lg bg-muted/40 p-3 text-sm">
          <p className="font-medium">
            {event.review.outcome ? OUTCOME_LABEL[event.review.outcome] : 'Reviewed'}
          </p>
          <p className="text-xs text-muted-foreground">
            {event.review.reviewedBy?.name || 'Unknown'} ·{' '}
            {new Date(event.review.reviewedAt).toLocaleString()}
          </p>
          <p className="mt-1 text-xs">
            Breath test:{' '}
            {!event.review.breathTestPerformed
              ? 'not performed'
              : event.review.breathTestPositive ? 'positive' : 'negative'}
          </p>
          {event.review.note ? <p className="mt-2 whitespace-pre-wrap">{event.review.note}</p> : null}
        </div>
      ) : null}
      <ReviewForm key={`${event.id}-${event.review?.reviewedAt || 'new'}`} event={event} onSaved={onSaved} />
      <p className="text-[11px] text-muted-foreground">
        These are visual indicators from video only. They are not a diagnosis and must not be
        used as the sole basis for any action — confirm with a supervisor and approved testing.
      </p>
    </aside>
  );
}

export function SafetyEventsScreen() {
  const [page, setPage] = useState<Page | null>(null);
  const [status, setStatus] = useState<EventStatus | ''>('PENDING_REVIEW');
  const [severity, setSeverity] = useState<Severity | ''>('');
  const [search, setSearch] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [selected, setSelected] = useState<SafetyEventRow | null>(null);
  const [error, setError] = useState('');
  const [notifyPermission, setNotifyPermission] = useState<string | null>(null);
  const liveVersion = useSafetyAlertStore(state => state.version);
  const searchParams = useSearchParams();
  const linkedId = Number(searchParams.get('id')) || null;

  useEffect(() => {
    if (typeof Notification !== 'undefined') setNotifyPermission(Notification.permission);
  }, []);

  const load = useCallback(() => {
    const params = new URLSearchParams({ page: String(currentPage), pageSize: '20' });
    if (status) params.set('status', status);
    if (severity) params.set('severity', severity);
    if (search) params.set('search', search);
    apiRequest<Page>(`/api/safety-events?${params.toString()}`)
      .then(result => {
        setPage(result);
        setError('');
      })
      .catch(cause => setError(cause instanceof Error ? cause.message : 'Unable to load'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPage, status, severity]);

  useEffect(() => {
    load();
  }, [load, liveVersion]);

  const openEvent = useCallback((id: number) => {
    apiRequest<SafetyEventRow>(`/api/safety-events/${id}`)
      .then(setSelected)
      .catch(cause => setError(cause instanceof Error ? cause.message : 'Unable to load event'));
  }, []);

  useEffect(() => {
    if (linkedId) openEvent(linkedId);
  }, [linkedId, openEvent]);

  const enableDesktopAlerts = () => {
    void Notification.requestPermission().then(setNotifyPermission);
  };

  const onSaved = (saved: SafetyEventRow) => {
    setSelected(saved);
    load();
  };

  const totalPages = page ? Math.max(1, Math.ceil(page.total / page.pageSize)) : 1;

  return (
    <div className="flex flex-col gap-4 px-4 lg:px-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Safety events</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Sustained elevated or high visual impairment indicators detected during live AI
          monitoring. Every event needs human review.
          {page ? ` ${page.pending} pending review.` : ''}
        </p>
        {notifyPermission === 'default' ? (
          <Button variant="outline" size="sm" className="mt-2" onClick={enableDesktopAlerts}>
            Enable desktop alerts
          </Button>
        ) : null}
      </div>
      <div className="flex flex-wrap gap-2">
        <select
          aria-label="Filter by status"
          className={SELECT_CLASS}
          value={status}
          onChange={change => {
            setCurrentPage(1);
            setStatus(change.target.value as EventStatus | '');
          }}
        >
          <option value="">All statuses</option>
          {(Object.keys(STATUS_LABEL) as EventStatus[]).map(key => (
            <option key={key} value={key}>{STATUS_LABEL[key]}</option>
          ))}
        </select>
        <select
          aria-label="Filter by severity"
          className={SELECT_CLASS}
          value={severity}
          onChange={change => {
            setCurrentPage(1);
            setSeverity(change.target.value as Severity | '');
          }}
        >
          <option value="">All severities</option>
          <option value="HIGH_INDICATORS">High indicators</option>
          <option value="ELEVATED_INDICATORS">Elevated indicators</option>
        </select>
        <Input
          aria-label="Search safety events"
          className="max-w-xs"
          placeholder="Search person, track or lobby"
          value={search}
          onChange={change => setSearch(change.target.value)}
          onKeyDown={key => {
            if (key.key === 'Enter') {
              setCurrentPage(1);
              load();
            }
          }}
        />
        <Button variant="outline" className="h-9" onClick={() => { setCurrentPage(1); load(); }}>
          Search
        </Button>
      </div>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="overflow-x-auto rounded-xl border bg-card">
          {!page ? (
            <p className="px-4 py-8 text-sm text-muted-foreground">Loading safety events…</p>
          ) : page.items.length === 0 ? (
            <p className="px-4 py-10 text-sm text-muted-foreground">
              No safety events match these filters.
            </p>
          ) : (
            <table className="w-full min-w-[720px] text-sm">
              <thead className="border-b bg-muted/40 text-left">
                <tr>
                  <th className="px-4 py-3 font-medium">Started</th>
                  <th className="px-4 py-3 font-medium">Person</th>
                  <th className="px-4 py-3 font-medium">Lobby</th>
                  <th className="px-4 py-3 font-medium">Severity</th>
                  <th className="px-4 py-3 font-medium">Confidence</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {page.items.map(row => {
                  const badge = severityBadge(row.severity);
                  return (
                    <tr
                      key={row.id}
                      tabIndex={0}
                      className={`cursor-pointer border-b last:border-0 hover:bg-muted/30 ${
                        selected?.id === row.id ? 'bg-muted/40' : ''
                      }`}
                      onClick={() => openEvent(row.id)}
                      onKeyDown={key => {
                        if (key.key === 'Enter') openEvent(row.id);
                      }}
                    >
                      <td className="px-4 py-3 text-xs">
                        {new Date(row.startedAt).toLocaleString()}
                        <span className="block text-muted-foreground">
                          {duration(row.startedAt, row.endedAt)}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        {row.subject?.name || (
                          <span className="text-muted-foreground">Unidentified · {row.trackId}</span>
                        )}
                      </td>
                      <td className="px-4 py-3">{row.lobby.name}</td>
                      <td className="px-4 py-3">
                        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${badge.className}`}>
                          {badge.label}
                        </span>
                      </td>
                      <td className="px-4 py-3">{percent(row.confidence)}</td>
                      <td className="px-4 py-3 text-xs">{STATUS_LABEL[row.status]}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          {page && page.total > page.pageSize ? (
            <div className="flex items-center justify-between border-t px-4 py-2 text-xs">
              <span>Page {page.page} of {totalPages}</span>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={currentPage <= 1}
                  onClick={() => setCurrentPage(value => value - 1)}
                >
                  Previous
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={currentPage >= totalPages}
                  onClick={() => setCurrentPage(value => value + 1)}
                >
                  Next
                </Button>
              </div>
            </div>
          ) : null}
        </div>
        {selected ? (
          <EventDetail event={selected} onSaved={onSaved} onClose={() => setSelected(null)} />
        ) : (
          <div className="hidden rounded-xl border border-dashed p-6 text-sm text-muted-foreground lg:block">
            Select an event to see the observed indicators and record a review.
          </div>
        )}
      </div>
    </div>
  );
}
