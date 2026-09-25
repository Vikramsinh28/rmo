'use client';

import { Button } from '@/components/ui/button';
import { useAuthStore } from '@/store/auth';
import {
  Maximize2,
  Mic,
  MicOff,
  Minimize2,
  PhoneOff,
  Video,
  VideoOff,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { apiRequest } from '../administration/api';
import { AICapabilityBadge } from './AICapabilityBadge';
import { captureLiveDesk, recordDesk } from './desk-recorder';
import { currentLobbyMedia, prepareLobbyMedia } from './lobby-media';

interface Signal {
  seq: number;
  fromUserId: number;
  type: 'offer' | 'answer' | 'ice';
  description: { type: string; sdp: string } | null;
  candidate: { candidate: string; sdpMid: string | null; sdpMLineIndex: number | null } | null;
}

const STUN_ONLY: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];

async function loadIceServers() {
  try {
    const config = await apiRequest<{ iceServers: RTCIceServer[] }>('/api/monitoring/ice');
    if (config.iceServers?.length) return config.iceServers;
  } catch {
    // A same-network call can still connect with STUN.
  }
  return STUN_ONLY;
}

function sessionDescription(description: { type: string; sdp: string }): RTCSessionDescriptionInit {
  const type = description.type === 'answer' ? 'answer' : 'offer';
  return { type, sdp: description.sdp };
}

function saveRecordingFile(blob: Blob, recordingId: number) {
  const extension = blob.type.includes('mp4') ? 'mp4' : 'webm';
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `recording-${recordingId}.${extension}`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1500);
}

function attach(element: HTMLMediaElement | null, stream: MediaStream | null) {
  if (!element || element.srcObject === stream) return;
  element.srcObject = stream;
  if (stream) void element.play().catch(() => undefined);
}

export function CallMedia({
  callId,
  role,
  peerName,
  startedAt,
  recording = false,
  recordingId = null,
  canRecord = false,
  onEnd,
}: {
  callId: number;
  role: 'monitor' | 'lobby';
  peerName: string;
  startedAt?: string | null;
  recording?: boolean;
  recordingId?: number | null;
  canRecord?: boolean;
  onEnd?: () => void;
}) {
  const userId = Number(useAuthStore(state => state.user?.id));
  const [status, setStatus] = useState('Starting the video call...');
  const [muted, setMuted] = useState(false);
  const [cameraOn, setCameraOn] = useState(true);
  const [remoteMuted, setRemoteMuted] = useState(false);
  const [volume, setVolume] = useState(1);
  const [needsCamera, setNeedsCamera] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [elapsed, setElapsed] = useState('00:00');
  const [capturing, setCapturing] = useState(false);
  const [saving, setSaving] = useState(false);
  const mainRef = useRef<HTMLVideoElement>(null);
  const previewRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const answerRef = useRef<(() => Promise<void>) | null>(null);
  const cameraRef = useRef<(() => Promise<void>) | null>(null);
  const localAudio = useRef<MediaStreamTrack[]>([]);
  const localVideo = useRef<MediaStreamTrack[]>([]);
  const sessionRef = useRef<{ blob: () => Promise<Blob> } | null>(null);
  const recordingIdRef = useRef<number | null>(null);
  const finishing = useRef<Promise<void> | null>(null);
  const finishRef = useRef<() => Promise<void>>(async () => undefined);

  async function finishRecording() {
    if (finishing.current) return finishing.current;
    const session = sessionRef.current;
    const activeId = recordingIdRef.current;
    if (!session || !activeId) return undefined;
    const work = (async () => {
      setSaving(true);
      let uploaded = false;
      try {
        const blob = await session.blob();
        sessionRef.current = null;
        setCapturing(false);
        saveRecordingFile(blob, activeId);
        await apiRequest(`/api/monitoring/calls/${callId}/recording/${activeId}/media`, {
          method: 'POST',
          headers: { 'Content-Type': blob.type || 'video/webm' },
          body: blob,
        });
        uploaded = true;
        await apiRequest(`/api/monitoring/calls/${callId}/recording/${activeId}/stop`, {
          method: 'POST',
        });
        toast.success('Recording downloaded. The call is still connected.');
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Recording could not be saved.';
        if (!uploaded) {
          toast.error(`${message} The call is still connected.`);
          await apiRequest(`/api/monitoring/calls/${callId}/recording/${activeId}/stop`, {
            method: 'POST',
          }).catch(() => undefined);
        } else {
          toast.error('The video was saved. Stop the recording once more to close it.');
        }
      } finally {
        recordingIdRef.current = null;
        setSaving(false);
        finishing.current = null;
      }
    })();
    finishing.current = work;
    return work;
  }

  finishRef.current = finishRecording;

  useEffect(() => () => {
    void finishRef.current();
  }, []);

  async function beginRecording() {
    if (sessionRef.current || saving) return;
    let display: MediaStream;
    try {
      display = await captureLiveDesk();
    } catch {
      toast.error('Allow this tab so the recording includes the desk, video, and audio.');
      return;
    }
    try {
      const started = await apiRequest<{
        message: string | null;
        call: { recording: { activeId: number | null } };
      }>(`/api/monitoring/calls/${callId}/recording/start`, { method: 'POST' });
      if (started.message || !started.call.recording.activeId) {
        display.getTracks().forEach(track => track.stop());
        toast.error(started.message || 'Recording could not be started. The call is still connected.');
        return;
      }
      const remote = audioRef.current?.srcObject;
      const session = recordDesk({
        display,
        remote: remote instanceof MediaStream ? remote : null,
        microphone: localAudio.current,
      });
      recordingIdRef.current = started.call.recording.activeId;
      sessionRef.current = session;
      setCapturing(true);
      display.getVideoTracks()[0]?.addEventListener('ended', () => {
        void finishRef.current();
      });
    } catch (error) {
      display.getTracks().forEach(track => track.stop());
      toast.error(error instanceof Error ? error.message : 'Recording could not be started.');
    }
  }

  async function onRecordClick() {
    if (saving) return;
    if (sessionRef.current) {
      await finishRecording();
      return;
    }
    if (recording && recordingId) {
      try {
        await apiRequest(`/api/monitoring/calls/${callId}/recording/${recordingId}/stop`, {
          method: 'POST',
        });
        toast.message('That recording had no video. Record again to save this desk.');
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'Recording could not be stopped.');
      }
      return;
    }
    await beginRecording();
  }

  useEffect(() => {
    let closed = false;
    let timer = 0;
    let after = 0;
    let pc: RTCPeerConnection | null = null;
    let answeredOffer = 0;
    let offerSeq = Number.POSITIVE_INFINITY;
    const pendingIce: RTCIceCandidateInit[] = [];
    const remoteVideos: MediaStream[] = [];
    const owned: MediaStream[] = [];
    let iceServers = STUN_ONLY;
    let icePolicy: RTCIceTransportPolicy = 'all';
    let relayTried = false;

    const report = (state: 'RECONNECTING' | 'CONNECTED') => {
      void apiRequest(`/api/monitoring/calls/${callId}/connection`, {
        method: 'POST',
        body: JSON.stringify({ state }),
      }).catch(() => undefined);
    };

    const post = (body: unknown) => apiRequest(`/api/monitoring/calls/${callId}/signal`, {
      method: 'POST',
      body: JSON.stringify(body),
    });

    const showVideos = () => {
      attach(mainRef.current, remoteVideos[0] || null);
    };

    const closePeer = () => {
      pc?.close();
      pc = null;
    };

    const wirePeer = () => {
      closePeer();
      remoteVideos.splice(0, remoteVideos.length);
      showVideos();
      pc = new RTCPeerConnection({
        iceServers,
        iceTransportPolicy: icePolicy,
        iceCandidatePoolSize: 4,
      });
      pc.onicecandidate = event => {
        if (!event.candidate) return;
        void post({
          type: 'ice',
          candidate: {
            candidate: event.candidate.candidate,
            sdpMid: event.candidate.sdpMid,
            sdpMLineIndex: event.candidate.sdpMLineIndex,
          },
        }).catch(() => undefined);
      };
      pc.oniceconnectionstatechange = () => {
        if (closed || !pc) return;
        if (pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed') {
          setStatus(icePolicy === 'relay' ? 'Live through relay' : 'Live');
          report('CONNECTED');
        }
        if (pc.iceConnectionState === 'checking') {
          setStatus(icePolicy === 'relay' ? 'Connecting through TURN...' : 'Connecting across networks...');
        }
        if (pc.iceConnectionState === 'failed') {
          setStatus('Connection lost. Reconnecting...');
          report('RECONNECTING');
          if (role === 'monitor') {
            if (!relayTried && iceServers.length > 1) {
              relayTried = true;
              icePolicy = 'relay';
              window.setTimeout(() => {
                if (!closed) void startMonitor();
              }, 400);
              return;
            }
            icePolicy = 'all';
            window.setTimeout(() => {
              if (!closed) void startMonitor();
            }, 2000);
          }
        }
      };
      pc.ontrack = event => {
        if (event.track.kind === 'audio') {
          attach(audioRef.current, new MediaStream([event.track]));
          return;
        }
        const show = () => {
          if (!remoteVideos.some(stream => stream.getTracks().includes(event.track))) {
            remoteVideos.push(new MediaStream([event.track]));
          }
          const playing = remoteVideos.find(stream => (
            stream.getVideoTracks().some(track => track.readyState === 'live' && !track.muted)
          ));
          attach(mainRef.current, playing || remoteVideos[remoteVideos.length - 1] || null);
          if (!closed) setStatus(icePolicy === 'relay' ? 'Live through relay' : 'Live');
          report('CONNECTED');
        };
        event.track.onunmute = show;
        show();
      };
      pc.onconnectionstatechange = () => {
        if (closed || !pc) return;
        if (pc.connectionState === 'connected') {
          setStatus(icePolicy === 'relay' ? 'Live through relay' : 'Live');
          report('CONNECTED');
        }
        if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
          setStatus('Connection lost. Reconnecting...');
          report('RECONNECTING');
          const failing = pc;
          window.setTimeout(() => {
            if (closed || role !== 'monitor' || failing !== pc) return;
            if (failing.connectionState === 'failed' || failing.connectionState === 'disconnected') {
              if (!relayTried && iceServers.length > 1) {
                relayTried = true;
                icePolicy = 'relay';
              }
              void startMonitor();
            }
          }, 2000);
        }
      };
    };

    const addIce = async (candidate: RTCIceCandidateInit) => {
      if (!pc) return;
      if (!pc.remoteDescription) {
        pendingIce.push(candidate);
        return;
      }
      await pc.addIceCandidate(candidate).catch(() => undefined);
    };

    const flushIce = async () => {
      while (pendingIce.length > 0 && pc?.remoteDescription) {
        const next = pendingIce.shift();
        if (next) await pc.addIceCandidate(next).catch(() => undefined);
      }
    };

    async function startMonitor() {
      if (closed) return;
      owned.forEach(stream => stream.getTracks().forEach(track => track.stop()));
      owned.splice(0, owned.length);
      setNeedsCamera(false);
      setStatus('Starting your camera...');
      let camera: MediaStream;
      try {
        camera = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
      } catch {
        if (!closed) {
          setNeedsCamera(true);
          setStatus('Allow the camera and microphone to start the video call.');
        }
        return;
      }
      if (closed) {
        camera.getTracks().forEach(track => track.stop());
        return;
      }
      owned.push(camera);
      localAudio.current = camera.getAudioTracks();
      localVideo.current = camera.getVideoTracks();
      attach(previewRef.current, camera);
      wirePeer();
      if (!pc) return;
      camera.getTracks().forEach(track => pc?.addTrack(track, camera));
      pc.addTransceiver('video', { direction: 'recvonly' });
      pc.addTransceiver('audio', { direction: 'recvonly' });
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      const posted = await apiRequest<{ seq: number }>(`/api/monitoring/calls/${callId}/signal`, {
        method: 'POST',
        body: JSON.stringify({ type: 'offer', description: pc.localDescription }),
      });
      offerSeq = posted.seq;
      if (!closed) setStatus('Waiting for the lobby camera...');
    }

    async function answerOffer(signal: Signal) {
      if (!signal.description || signal.seq <= answeredOffer) return;
      let camera = currentLobbyMedia();
      if (!camera) {
        try {
          camera = await prepareLobbyMedia();
        } catch {
          if (!closed) {
            setNeedsCamera(true);
            setStatus('Allow the camera and microphone to join the video call.');
          }
          answerRef.current = async () => {
            const latest = currentLobbyMedia();
            if (!latest) return;
            await answerOffer(signal);
          };
          return;
        }
      }
      if (!camera) return;
      answeredOffer = signal.seq;
      setNeedsCamera(false);
      setStatus('Connecting video...');
      wirePeer();
      if (!pc) return;
      await pc.setRemoteDescription(sessionDescription(signal.description));
      await flushIce();
      for (const track of camera.getTracks()) {
        const slot = pc.getTransceivers().find(item => (
          item.receiver.track?.kind === track.kind
          && !item.sender.track
          && (item.direction === 'recvonly' || item.direction === 'inactive')
        ));
        if (slot) {
          await slot.sender.replaceTrack(track);
          slot.direction = 'sendrecv';
        } else {
          pc.addTrack(track, camera);
        }
      }
      localAudio.current = camera.getAudioTracks();
      localVideo.current = camera.getVideoTracks();
      attach(previewRef.current, camera);
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      await post({ type: 'answer', description: pc.localDescription });
    }

    async function onSignal(signal: Signal) {
      if (signal.fromUserId === userId) return;
      if (signal.type === 'ice' && signal.candidate) {
        await addIce(signal.candidate);
        return;
      }
      if (role === 'lobby' && signal.type === 'offer') await answerOffer(signal);
      if (role === 'monitor' && signal.type === 'answer' && signal.description && pc) {
        if (signal.seq <= offerSeq) return;
        if (pc.signalingState === 'have-local-offer') {
          await pc.setRemoteDescription(sessionDescription(signal.description));
          await flushIce();
        }
      }
    }

    async function poll() {
      const page = await apiRequest<{ signals: Signal[] }>(
        `/api/monitoring/calls/${callId}/signal?after=${after}`,
      );
      for (const signal of page.signals) {
        after = signal.seq;
        await onSignal(signal);
      }
    }

    void loadIceServers().then(servers => {
      if (closed) return;
      iceServers = servers;
      cameraRef.current = startMonitor;
      if (role === 'monitor') {
        void startMonitor().catch(() => {
          if (!closed) setStatus('Connection lost. Reconnecting...');
        });
      }
      if (role === 'lobby') setStatus('Waiting for the monitor...');
      timer = window.setInterval(() => {
        void poll().catch(() => undefined);
      }, 250);
    });

    return () => {
      closed = true;
      window.clearInterval(timer);
      answerRef.current = null;
      cameraRef.current = null;
      closePeer();
      owned.forEach(stream => stream.getTracks().forEach(track => track.stop()));
    };
  }, [callId, role, userId]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.muted = remoteMuted;
    audio.volume = volume;
  }, [remoteMuted, volume]);

  useEffect(() => {
    const tick = () => {
      if (!startedAt) {
        setElapsed('00:00');
        return;
      }
      const seconds = Math.max(0, Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000));
      const hours = Math.floor(seconds / 3600);
      const minutes = Math.floor((seconds % 3600) / 60);
      const rest = seconds % 60;
      const clock = `${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`;
      setElapsed(hours > 0 ? `${hours}:${clock}` : clock);
    };
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [startedAt]);

  useEffect(() => {
    const onChange = () => setFullscreen(document.fullscreenElement === stageRef.current);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  // Phase 6: sample displayed video frames for the AI consumer. Does not alter WebRTC.
  useEffect(() => {
    if (role !== 'monitor') return undefined;
    let cancelled = false;
    let posting = false;
    let sampled = 0;
    console.info(`[rmo-ai] AI_CLIENT_SAMPLER_ARMED callId=${callId}`);
    const canvas = document.createElement('canvas');
    const timer = window.setInterval(() => {
      if (cancelled || posting) return;
      const video = mainRef.current;
      if (!video || video.readyState < 2 || video.videoWidth < 2) return;
      void (async () => {
        try {
          const status = await apiRequest<{
            processing: { status: string; framesProcessed?: number } | null;
          }>(`/api/monitoring/calls/${callId}/ai/status`);
          if (cancelled || status.processing?.status !== 'RUNNING') return;
          canvas.width = Math.min(video.videoWidth, 640);
          canvas.height = Math.round(
            (canvas.width / video.videoWidth) * video.videoHeight,
          );
          const context = canvas.getContext('2d');
          if (!context) return;
          context.drawImage(video, 0, 0, canvas.width, canvas.height);
          const blob = await new Promise<Blob | null>(resolve => {
            canvas.toBlob(resolve, 'image/jpeg', 0.7);
          });
          if (!blob || cancelled) return;
          posting = true;
          await apiRequest(`/api/monitoring/calls/${callId}/ai/frames`, {
            method: 'POST',
            headers: { 'Content-Type': 'image/jpeg' },
            body: blob,
          });
          sampled += 1;
          if (sampled === 1 || sampled % 5 === 0) {
            console.info(
              `[rmo-ai] AI_CLIENT_FRAME_SENT callId=${callId} samples=${sampled} `
              + `bytes=${blob.size} video=${video.videoWidth}x${video.videoHeight}`,
            );
          }
        } catch (error) {
          console.warn(
            `[rmo-ai] AI_CLIENT_FRAME_SKIPPED callId=${callId} `
            + `reason=${error instanceof Error ? error.message : 'unknown'} liveCallAffected=false`,
          );
        } finally {
          posting = false;
        }
      })();
    }, 1000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      console.info(`[rmo-ai] AI_CLIENT_SAMPLER_STOPPED callId=${callId} samples=${sampled}`);
    };
  }, [callId, role]);

  return (
    <div ref={stageRef} className="relative flex min-h-0 flex-1 flex-col bg-zinc-950 text-white">
      <video ref={mainRef} className="absolute inset-0 h-full w-full bg-black object-contain" autoPlay playsInline muted />
      <audio ref={audioRef} autoPlay />
      <div className="relative z-10 flex items-start justify-between gap-3 p-4">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.18em] text-orange-200/80">
            {role === 'monitor' ? 'Lobby' : 'Monitor'}
          </p>
          <h2 className="text-xl font-semibold">{peerName}</h2>
          <p className="text-sm text-zinc-300" role="status">{status}</p>
        </div>
        <div className="flex max-w-md flex-col items-end gap-2">
          <div className="flex items-center gap-2">
            {recording ? (
              <span className="rounded-full bg-red-600 px-2 py-1 text-xs font-semibold">REC</span>
            ) : null}
            <span className="rounded-full bg-black/50 px-3 py-1 text-sm tabular-nums">{elapsed}</span>
            <span className="rounded-full bg-red-600 px-2 py-1 text-xs font-semibold">
              {status.startsWith('Connection lost') ? 'Reconnecting' : 'Live'}
            </span>
          </div>
          <AICapabilityBadge callId={callId} canControl={role === 'monitor'} />
        </div>
      </div>
      <div className="relative z-10 mt-auto flex flex-col items-center gap-3 px-4 pb-5">
        {needsCamera ? (
          <Button
            onClick={() => {
              if (role === 'lobby') {
                void prepareLobbyMedia()
                  .then(() => answerRef.current?.())
                  .catch(() => setStatus('Camera or microphone permission was not granted. The call stays connected.'));
                return;
              }
              void cameraRef.current?.();
            }}
          >
            Allow camera and microphone
          </Button>
        ) : null}
        <div className="flex max-w-3xl flex-wrap items-center justify-center gap-2 rounded-full bg-black/70 px-3 py-2 backdrop-blur">
          <RoundControl
            label={muted ? 'Unmute microphone' : 'Mute microphone'}
            active={muted}
            onClick={() => {
              const next = !muted;
              setMuted(next);
              localAudio.current.forEach(track => {
                track.enabled = !next;
              });
            }}
          >
            {muted ? <MicOff className="size-5" /> : <Mic className="size-5" />}
          </RoundControl>
          <RoundControl
            label={cameraOn ? 'Turn camera off' : 'Turn camera on'}
            active={!cameraOn}
            onClick={() => {
              const next = !cameraOn;
              setCameraOn(next);
              localVideo.current.forEach(track => {
                track.enabled = next;
              });
            }}
          >
            {cameraOn ? <Video className="size-5" /> : <VideoOff className="size-5" />}
          </RoundControl>
          <RoundControl
            label={remoteMuted ? 'Hear the other side' : 'Mute the other side'}
            active={remoteMuted}
            onClick={() => setRemoteMuted(current => !current)}
          >
            {remoteMuted ? <VolumeX className="size-5" /> : <Volume2 className="size-5" />}
          </RoundControl>
          <label className="flex items-center gap-2 px-2 text-xs text-zinc-200">
            Volume
            <input
              aria-label="Call volume"
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={remoteMuted ? 0 : volume}
              onChange={event => {
                setRemoteMuted(false);
                setVolume(Number(event.target.value));
              }}
              className="w-24 accent-orange-400"
            />
          </label>
          <RoundControl
            label={fullscreen ? 'Exit fullscreen' : 'Fullscreen'}
            onClick={() => {
              const stage = stageRef.current;
              if (!stage) return;
              if (document.fullscreenElement === stage) {
                void document.exitFullscreen().catch(() => undefined);
                return;
              }
              void stage.requestFullscreen().catch(() => undefined);
            }}
          >
            {fullscreen ? <Minimize2 className="size-5" /> : <Maximize2 className="size-5" />}
          </RoundControl>
          {canRecord ? (
            <RoundControl
              label={saving ? 'Saving recording' : capturing || recording ? 'Stop recording' : 'Record this desk'}
              active={capturing || recording}
              onClick={() => {
                void onRecordClick();
              }}
            >
              <span className={`size-3 rounded-full ${capturing || recording ? 'animate-pulse bg-red-500' : 'bg-white'}`} />
            </RoundControl>
          ) : null}
          {onEnd ? (
            <button
              type="button"
              aria-label="End call"
              onClick={() => {
                void (async () => {
                  if (sessionRef.current) await finishRef.current();
                  onEnd();
                })();
              }}
              className="inline-flex size-12 items-center justify-center rounded-full bg-red-600 text-white hover:bg-red-500"
            >
              <PhoneOff className="size-5" />
            </button>
          ) : null}
        </div>
      </div>
      <video
        ref={previewRef}
        className={`absolute bottom-24 right-4 z-10 h-28 w-40 rounded-xl border border-white/20 bg-zinc-900 object-cover shadow-lg ${cameraOn ? '' : 'opacity-40'}`}
        autoPlay
        playsInline
        muted
      />
    </div>
  );
}

function RoundControl({
  label,
  active = false,
  onClick,
  children,
}: {
  label: string;
  active?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={`inline-flex size-12 items-center justify-center rounded-full ${active ? 'bg-red-600 text-white' : 'bg-white/15 text-white hover:bg-white/25'}`}
    >
      {children}
    </button>
  );
}
