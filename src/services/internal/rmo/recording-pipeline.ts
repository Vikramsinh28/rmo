import { mkdir, readFile, stat, unlink, writeFile } from 'fs/promises';
import path from 'path';
import { RmoError } from '@/lib/rmo/errors';

const ROOT = path.join(process.cwd(), 'storage', 'recordings');

export interface RecordingArtifact {
  id: number;
  lobbyCallId: number;
  lobbyId: number;
  roomKey: string;
  startedAt: string;
  stoppedAt?: string | null;
  status: string;
  startedById: number;
  stoppedById?: number | null;
}

export function recordingStorageKey(id: number) {
  return `local/recordings/${id}.json`;
}

export function recordingMediaKey(id: number, extension: 'webm' | 'mp4') {
  return `local/recordings/${id}.${extension}`;
}

function artifactPath(storageKey: string) {
  if (!/^local\/recordings\/\d+\.(json|webm|mp4)$/.test(storageKey)) {
    throw new RmoError('Recording file is not available.', 404);
  }
  const file = path.resolve(ROOT, path.basename(storageKey));
  if (!file.startsWith(path.resolve(ROOT) + path.sep)) {
    throw new RmoError('Recording file is not available.', 404);
  }
  return file;
}

/**
 * Local filesystem store. The database keeps only the storage key and file size.
 * A completed call recording is a WebM or MP4 of the live desk.
 * The JSON file is only a fallback when no media was uploaded.
 */
export async function writeRecordingArtifact(artifact: RecordingArtifact) {
  await mkdir(ROOT, { recursive: true });
  const storageKey = recordingStorageKey(artifact.id);
  const body = JSON.stringify(
    {
      recordingId: artifact.id,
      lobbyCallId: artifact.lobbyCallId,
      lobbyId: artifact.lobbyId,
      roomKey: artifact.roomKey,
      status: artifact.status,
      startedAt: artifact.startedAt,
      stoppedAt: artifact.stoppedAt || null,
      pipeline: 'local-filesystem',
      note: 'Media bytes are produced by the LiveKit recording pipeline when egress is enabled.',
    },
    null,
    2,
  );
  await writeFile(artifactPath(storageKey), body, 'utf8');
  const info = await stat(artifactPath(storageKey));
  return { storageKey, fileSize: info.size };
}

export async function writeRecordingMedia(id: number, bytes: Buffer, extension: 'webm' | 'mp4') {
  await mkdir(ROOT, { recursive: true });
  const storageKey = recordingMediaKey(id, extension);
  const target = artifactPath(storageKey);
  await writeFile(target, bytes);
  await unlink(artifactPath(recordingStorageKey(id))).catch(() => undefined);
  const info = await stat(target);
  return { storageKey, fileSize: info.size };
}

export function recordingContentType(storageKey: string) {
  if (storageKey.endsWith('.webm')) return { contentType: 'video/webm', extension: '.webm' };
  if (storageKey.endsWith('.mp4')) return { contentType: 'video/mp4', extension: '.mp4' };
  return { contentType: 'application/json; charset=utf-8', extension: '.json' };
}

export function isPlayableRecording(storageKey: string | null | undefined) {
  return Boolean(storageKey && /\.(webm|mp4)$/.test(storageKey));
}

export async function readRecordingArtifact(storageKey: string) {
  const bytes = await readFile(artifactPath(storageKey));
  return { bytes, ...recordingContentType(storageKey) };
}
