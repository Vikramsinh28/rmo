'use client';

import { Button } from '@/components/ui/button';
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { apiRequest } from '@/components/organisms/modules/administration/api';

type EnrollmentStatus = 'NOT_ENROLLED' | 'PENDING' | 'ENROLLED' | 'FAILED' | 'DISABLED';

interface EnrollmentState {
  status: EnrollmentStatus;
  enrolledAt: string | null;
  canEnroll: boolean;
  canReenroll: boolean;
  failureReason: string | null;
  entitlement: {
    available: boolean;
    reason: string | null;
    code: string | null;
  };
}

const TARGET_SAMPLES = 5;
const MIN_SAMPLES = 3;

export function FaceEnrollmentScreen() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [state, setState] = useState<EnrollmentState | null>(null);
  const [step, setStep] = useState<'intro' | 'camera' | 'capture' | 'done'>('intro');
  const [samples, setSamples] = useState<Blob[]>([]);
  const [busy, setBusy] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [confirmReenroll, setConfirmReenroll] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await apiRequest<EnrollmentState>('/api/crew/face-enrollment');
      setState(data);
      if (data.status === 'ENROLLED' && !confirmReenroll) setStep('done');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not load enrollment status.');
    }
  }, [confirmReenroll]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => () => {
    streamRef.current?.getTracks().forEach(track => track.stop());
  }, []);

  async function startCamera() {
    setCameraError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => undefined);
      }
      setStep('capture');
    } catch {
      setCameraError('Camera permission is required to continue.');
      setStep('camera');
    }
  }

  async function captureSample() {
    const video = videoRef.current;
    if (!video || video.readyState < 2) {
      toast.error('Wait for the camera preview before capturing.');
      return;
    }
    const canvas = document.createElement('canvas');
    canvas.width = Math.min(video.videoWidth, 960);
    canvas.height = Math.round((canvas.width / video.videoWidth) * video.videoHeight);
    const context = canvas.getContext('2d');
    if (!context) return;
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.92));
    if (!blob || blob.size < 2000) {
      toast.error('Capture looked empty. Improve lighting and try again.');
      return;
    }
    setSamples(current => [...current, blob].slice(0, TARGET_SAMPLES));
  }

  async function submit() {
    if (samples.length < MIN_SAMPLES) {
      toast.error(`Capture at least ${MIN_SAMPLES} samples before submitting.`);
      return;
    }
    setBusy(true);
    try {
      const form = new FormData();
      samples.forEach((sample, index) => form.append(`sample${index}`, sample, `sample-${index}.jpg`));
      if (confirmReenroll || state?.status === 'ENROLLED') form.append('confirmReenroll', 'true');
      const response = await fetch('/api/crew/face-enrollment', {
        method: 'POST',
        body: form,
      });
      const body = await response.json() as {
        success?: boolean;
        message?: string;
        error?: string;
        data?: EnrollmentState;
      };
      if (!response.ok || body.success === false) {
        throw new Error(body.message || 'Enrollment failed.');
      }
      setState(body.data || null);
      setStep('done');
      setConfirmReenroll(false);
      setSamples([]);
      streamRef.current?.getTracks().forEach(track => track.stop());
      streamRef.current = null;
      toast.success('Face enrollment completed.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Enrollment failed.');
      await load();
    } finally {
      setBusy(false);
    }
  }

  const entitled = state?.entitlement.available !== false;
  const enrolled = state?.status === 'ENROLLED' && step === 'done' && !confirmReenroll;

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-8">
      <div>
        <p className="text-xs font-medium uppercase tracking-[0.18em] text-orange-600/80">Crew</p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight">Face enrollment</h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          Enroll your face for RMO monitoring in your division. This stores an identity mapping with
          AWS Rekognition. It does not start live face recognition by itself.
        </p>
      </div>

      {!entitled ? (
        <section className="rounded-2xl border bg-card p-6">
          <p className="font-medium">Face identification is not available</p>
          <p className="mt-2 text-sm text-muted-foreground">
            {state?.entitlement.reason || 'Your division does not currently have this feature enabled.'}
          </p>
        </section>
      ) : null}

      {entitled && enrolled ? (
        <section className="rounded-2xl border bg-card p-6">
          <p className="text-lg font-semibold text-emerald-700">✓ Face enrollment completed</p>
          <p className="mt-2 text-sm text-muted-foreground">
            Your face has been enrolled for AI monitoring in your division.
            {state?.enrolledAt ? ` Enrolled ${new Date(state.enrolledAt).toLocaleString()}.` : ''}
          </p>
          <Button
            className="mt-4"
            variant="outline"
            onClick={() => {
              setConfirmReenroll(true);
              setSamples([]);
              setStep('intro');
            }}
          >
            Re-enroll face
          </Button>
        </section>
      ) : null}

      {entitled && step === 'intro' ? (
        <section className="rounded-2xl border bg-card p-6">
          <h2 className="text-lg font-semibold">Before you begin</h2>
          <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
            <li>Look directly at the camera.</li>
            <li>Keep your face clearly visible and centered.</li>
            <li>Use good lighting and remove anything obstructing your face.</li>
            <li>You will capture {MIN_SAMPLES}–{TARGET_SAMPLES} samples, then confirm enrollment.</li>
          </ul>
          {confirmReenroll ? (
            <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
              Re-enrollment will replace your existing face identity after you confirm and submit.
            </p>
          ) : null}
          <Button className="mt-5" onClick={() => void startCamera()}>
            Start enrollment
          </Button>
        </section>
      ) : null}

      {entitled && (step === 'camera' || step === 'capture') ? (
        <section className="rounded-2xl border bg-card p-6">
          {cameraError ? (
            <p className="mb-4 text-sm text-red-600">{cameraError}</p>
          ) : null}
          <div className="relative overflow-hidden rounded-2xl bg-zinc-950">
            <video
              ref={videoRef}
              className="aspect-[4/3] w-full object-cover"
              playsInline
              muted
              autoPlay
            />
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <div className="h-56 w-40 rounded-[50%] border-2 border-orange-300/80 shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]" />
            </div>
          </div>
          <p className="mt-4 text-sm text-muted-foreground">
            Keep your face inside the guide. Sample {samples.length} of {TARGET_SAMPLES}.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={busy || samples.length >= TARGET_SAMPLES}
              onClick={() => void captureSample()}
            >
              Capture
            </Button>
            {samples.length > 0 ? (
              <Button type="button" variant="ghost" disabled={busy} onClick={() => setSamples([])}>
                Clear samples
              </Button>
            ) : null}
            <Button
              type="button"
              disabled={busy || samples.length < MIN_SAMPLES}
              onClick={() => void submit()}
            >
              {busy ? 'Enrolling…' : confirmReenroll ? 'Confirm re-enrollment' : 'Submit enrollment'}
            </Button>
          </div>
        </section>
      ) : null}
    </div>
  );
}
