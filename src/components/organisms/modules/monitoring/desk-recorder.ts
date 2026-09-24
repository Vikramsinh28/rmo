function recorderMime() {
  const types = [
    'video/webm;codecs=vp8,opus',
    'video/webm;codecs=vp9,opus',
    'video/webm',
    'video/mp4',
  ];
  if (typeof MediaRecorder === 'undefined') return '';
  return types.find(type => MediaRecorder.isTypeSupported(type)) || '';
}

export async function captureLiveDesk() {
  const attempts: DisplayMediaStreamOptions[] = [
    {
      video: { frameRate: { ideal: 30 } },
      audio: true,
      preferCurrentTab: true,
      selfBrowserSurface: 'include',
    } as DisplayMediaStreamOptions,
    { video: true, audio: true },
    { video: true },
  ];
  let last: unknown;
  for (const options of attempts) {
    try {
      return await navigator.mediaDevices.getDisplayMedia(options);
    } catch (error) {
      last = error;
      const cancelled = error instanceof DOMException
        && (error.name === 'NotAllowedError' || error.name === 'AbortError');
      if (cancelled) throw error;
    }
  }
  throw last instanceof Error ? last : new Error('Could not capture this screen.');
}

function connectAudio(mix: AudioContext, destination: MediaStreamAudioDestinationNode, stream: MediaStream | null) {
  if (!stream || stream.getAudioTracks().length === 0) return;
  try {
    mix.createMediaStreamSource(stream).connect(destination);
  } catch {
    // An ended track cannot be mixed into the recording.
  }
}

export function recordDesk(input: {
  display: MediaStream;
  remote: MediaStream | null;
  microphone: MediaStreamTrack[];
}) {
  const mix = new AudioContext();
  const destination = mix.createMediaStreamDestination();
  const remoteHasAudio = Boolean(input.remote && input.remote.getAudioTracks().length > 0);
  if (!remoteHasAudio) connectAudio(mix, destination, input.display);
  connectAudio(mix, destination, input.remote);
  if (input.microphone.length > 0) {
    connectAudio(mix, destination, new MediaStream(input.microphone));
  }
  const tracks = [...input.display.getVideoTracks(), ...destination.stream.getAudioTracks()];
  const mimeType = recorderMime();
  const recorder = new MediaRecorder(
    new MediaStream(tracks),
    mimeType ? { mimeType } : undefined,
  );
  const chunks: Blob[] = [];
  recorder.ondataavailable = event => {
    if (event.data.size > 0) chunks.push(event.data);
  };
  void mix.resume().catch(() => undefined);
  recorder.start(1000);
  return {
    async blob() {
      if (recorder.state !== 'inactive') {
        await new Promise<void>(resolve => {
          recorder.addEventListener('stop', () => resolve(), { once: true });
          recorder.stop();
        });
      }
      input.display.getTracks().forEach(track => track.stop());
      await mix.close().catch(() => undefined);
      return new Blob(chunks, { type: recorder.mimeType || 'video/webm' });
    },
  };
}
