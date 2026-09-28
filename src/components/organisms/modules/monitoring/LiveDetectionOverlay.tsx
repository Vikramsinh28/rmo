'use client';

import { useEffect, useState, type RefObject } from 'react';

export interface LiveOverlayPerson {
  trackId: string;
  box: { x: number; y: number; width: number; height: number } | null;
  name: string | null;
  identityStatus: string | null;
  visualStatus: string | null;
}

interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

const STATUS_STYLE: Record<string, { border: string; label: string; text: string }> = {
  HIGH_INDICATORS: { border: 'border-red-500', label: 'bg-red-600', text: 'High indicators' },
  ELEVATED_INDICATORS: {
    border: 'border-orange-400',
    label: 'bg-orange-500',
    text: 'Elevated indicators',
  },
  MONITORING: { border: 'border-yellow-300', label: 'bg-yellow-500', text: 'Monitoring' },
  NORMAL: { border: 'border-emerald-400', label: 'bg-emerald-600', text: 'Normal' },
  INSUFFICIENT_EVIDENCE: {
    border: 'border-zinc-300',
    label: 'bg-zinc-600',
    text: 'Insufficient evidence',
  },
};
const DEFAULT_STYLE = { border: 'border-sky-400', label: 'bg-sky-600', text: '' };

/** Area actually covered by an object-contain video inside its element. */
function containedRect(video: HTMLVideoElement): Rect | null {
  const { videoWidth, videoHeight, clientWidth, clientHeight } = video;
  if (!videoWidth || !videoHeight || !clientWidth || !clientHeight) return null;
  const scale = Math.min(clientWidth / videoWidth, clientHeight / videoHeight);
  const width = videoWidth * scale;
  const height = videoHeight * scale;
  return {
    left: video.offsetLeft + (clientWidth - width) / 2,
    top: video.offsetTop + (clientHeight - height) / 2,
    width,
    height,
  };
}

/**
 * Draws AI person boxes with identity and visual status over the live lobby video.
 * Boxes come from the most recent processed frame (normalized coordinates).
 */
export function LiveDetectionOverlay({
  videoRef,
  persons,
}: {
  videoRef: RefObject<HTMLVideoElement | null>;
  persons: LiveOverlayPerson[];
}) {
  const [rect, setRect] = useState<Rect | null>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return undefined;
    const update = () => setRect(containedRect(video));
    update();
    const observer = new ResizeObserver(update);
    observer.observe(video);
    video.addEventListener('loadedmetadata', update);
    video.addEventListener('resize', update);
    return () => {
      observer.disconnect();
      video.removeEventListener('loadedmetadata', update);
      video.removeEventListener('resize', update);
    };
  }, [videoRef]);

  if (!rect) return null;

  return (
    <div
      className="pointer-events-none absolute z-[5]"
      style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height }}
      aria-hidden="true"
    >
      {persons.map(person => {
        if (!person.box) return null;
        const style = (person.visualStatus && STATUS_STYLE[person.visualStatus]) || DEFAULT_STYLE;
        const who = person.identityStatus === 'RECOGNIZED' && person.name
          ? person.name
          : `Unknown · ${person.trackId}`;
        return (
          <div
            key={person.trackId}
            className={`absolute rounded-sm border-2 ${style.border} transition-all duration-150`}
            style={{
              left: `${person.box.x * 100}%`,
              top: `${person.box.y * 100}%`,
              width: `${person.box.width * 100}%`,
              height: `${person.box.height * 100}%`,
            }}
          >
            <span
              className={`absolute -top-6 left-0 whitespace-nowrap rounded px-1.5 py-0.5 text-[11px] font-medium text-white ${style.label}`}
            >
              {who}
              {style.text ? ` · ${style.text}` : ''}
            </span>
          </div>
        );
      })}
    </div>
  );
}
