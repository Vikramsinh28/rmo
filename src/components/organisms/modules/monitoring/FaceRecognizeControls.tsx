'use client';

import { Button } from '@/components/ui/button';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { apiRequest } from '../administration/api';

interface FaceResult {
  match: boolean;
  userId: number | null;
  displayName: string | null;
  confidence: number | null;
  status: 'identified' | 'unknown' | 'low_confidence';
}

interface RecognitionResponse {
  recognizedAt: string;
  recognitionRequestCount: number;
  cooldownMs: number;
  faces: FaceResult[];
}

export function FaceRecognizeControls({
  callId,
  videoRef,
  enabled,
}: {
  callId: number;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  enabled: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [cooldownUntil, setCooldownUntil] = useState(0);
  const [result, setResult] = useState<RecognitionResponse | null>(null);
  const [now, setNow] = useState(Date.now());
  const [featureAvailable, setFeatureAvailable] = useState(false);

  const loadCapability = useCallback(async () => {
    try {
      const status = await apiRequest<{
        ai: { enabled: boolean; features: { faceIdentification: boolean } };
      }>(`/api/monitoring/calls/${callId}/ai/status`);
      setFeatureAvailable(Boolean(status.ai.enabled && status.ai.features.faceIdentification));
    } catch {
      setFeatureAvailable(false);
    }
  }, [callId]);

  useEffect(() => {
    void loadCapability();
  }, [loadCapability]);

  useEffect(() => {
    if (cooldownUntil <= Date.now()) return undefined;
    const timer = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, [cooldownUntil]);

  if (!enabled || !featureAvailable) return null;

  const cooling = cooldownUntil > now;
  const remaining = Math.max(0, Math.ceil((cooldownUntil - now) / 1000));

  async function recognize() {
    const video = videoRef.current;
    if (!video || video.readyState < 2 || video.videoWidth < 2) {
      toast.error('Wait for the live video before recognizing faces.');
      return;
    }
    setBusy(true);
    try {
      const canvas = document.createElement('canvas');
      canvas.width = Math.min(video.videoWidth, 960);
      canvas.height = Math.round((canvas.width / video.videoWidth) * video.videoHeight);
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Could not capture the current frame.');
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise<Blob | null>(resolve => {
        canvas.toBlob(resolve, 'image/jpeg', 0.9);
      });
      if (!blob) throw new Error('Could not capture the current frame.');

      const form = new FormData();
      form.append('frame', blob, 'frame.jpg');
      const response = await fetch(`/api/monitoring/calls/${callId}/ai/recognize`, {
        method: 'POST',
        body: form,
      });
      const body = await response.json() as {
        success?: boolean;
        message?: string;
        error?: string;
        data?: RecognitionResponse;
      };
      if (!response.ok || body.success === false || !body.data) {
        throw new Error(body.message || 'Recognition failed.');
      }
      setResult(body.data);
      setCooldownUntil(Date.now() + (body.data.cooldownMs || 5000));
      console.info(
        `[rmo-ai] FACE_RECOGNITION_CLIENT_OK callId=${callId} `
        + `faces=${body.data.faces.length} requests=${body.data.recognitionRequestCount}`,
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Recognition failed.');
      console.warn(
        `[rmo-ai] FACE_RECOGNITION_CLIENT_FAIL callId=${callId} `
        + `reason=${error instanceof Error ? error.message : 'unknown'} liveCallAffected=false`,
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <aside className="w-full max-w-sm rounded-xl border border-white/10 bg-black/50 px-3 py-3 text-xs text-zinc-100">
      <div className="flex items-center justify-between gap-2">
        <p className="font-semibold uppercase tracking-wide text-orange-200/80">Face recognition</p>
        <Button
          type="button"
          className="h-8 text-xs"
          disabled={busy || cooling}
          onClick={() => void recognize()}
        >
          {busy ? 'Recognizing…' : cooling ? `Wait ${remaining}s` : 'Recognize Faces'}
        </Button>
      </div>
      {result ? (
        <div className="mt-3 space-y-2">
          {result.faces.map((face, index) => (
            <div key={`${face.userId || 'u'}-${index}`} className="rounded-lg bg-white/5 px-2 py-2">
              {face.status === 'identified' ? (
                <>
                  <p className="font-medium text-emerald-300">✓ {face.displayName}</p>
                  <p className="text-zinc-400">
                    Confidence: {face.confidence != null ? `${face.confidence.toFixed(1)}%` : '—'}
                  </p>
                </>
              ) : face.status === 'low_confidence' ? (
                <p className="text-amber-200">? Unknown / Low confidence</p>
              ) : (
                <p className="text-zinc-300">? Unknown person</p>
              )}
            </div>
          ))}
          <p className="text-[10px] text-zinc-500">
            Recognized {new Date(result.recognizedAt).toLocaleTimeString()}
            {' · '}
            Requests this call: {result.recognitionRequestCount}
          </p>
        </div>
      ) : (
        <p className="mt-2 text-zinc-400">
          Click once to identify faces in the current frame. AWS is not called automatically.
        </p>
      )}
    </aside>
  );
}
