export type StreamPlayback = 'hls' | 'file' | 'page' | 'unsupported';

/** How a device stream URL should be shown in the browser. */
export function streamPlayback(url: string): StreamPlayback {
  const value = url.trim().toLowerCase();
  if (!value) return 'unsupported';
  if (value.startsWith('rtsp://') || value.startsWith('rtmp://')) return 'unsupported';
  if (value.includes('.m3u8')) return 'hls';
  if (/\.(mp4|webm|ogg)(\?|$)/.test(value)) return 'file';
  if (value.startsWith('https://') || value.startsWith('http://')) return 'page';
  return 'unsupported';
}
