let cameraStream: MediaStream | null = null;

function liveVideo(stream: MediaStream | null) {
  const track = stream?.getVideoTracks()[0];
  return Boolean(track && track.readyState === 'live');
}

export function currentLobbyMedia() {
  return cameraStream;
}

export async function prepareLobbyMedia() {
  if (!liveVideo(cameraStream)) {
    cameraStream = await navigator.mediaDevices.getUserMedia({
      audio: true,
      video: true,
    });
  }
  return cameraStream;
}

export function stopLobbyMedia() {
  cameraStream?.getTracks().forEach(track => track.stop());
  cameraStream = null;
}
