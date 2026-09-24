import { streamPlayback } from './stream';

describe('stream playback', () => {
  it('plays an HLS address as video', () => {
    expect(streamPlayback('https://live.example/camera1/index.m3u8')).toBe('hls');
  });

  it('plays a video file directly', () => {
    expect(streamPlayback('https://live.example/clip.mp4')).toBe('file');
  });

  it('opens an http page for a kiosk', () => {
    expect(streamPlayback('https://kiosk.example/desk')).toBe('page');
  });

  it('leaves rtsp for a player outside the browser', () => {
    expect(streamPlayback('rtsp://10.0.0.8/entrance')).toBe('unsupported');
  });
});
