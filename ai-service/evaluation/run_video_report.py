"""
Replay video files through the live FrameProcessingPipeline and summarise the
visual-indicator output per video.

Frames are sampled at --fps using the video's own clock, so persistence and
hysteresis behave exactly as they would on a live call at that frame rate.

Usage:
    python -m evaluation.run_video_report manifest.json --out results/online
Manifest entries: {"id", "file", "label", "expected", "start", "end", "title", "license", "page"}
"""

from __future__ import annotations

import argparse
import json
import time
from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

import cv2

from app.processing.pipeline import FrameProcessingPipeline

RANK = {
    'INSUFFICIENT_EVIDENCE': 0,
    'NORMAL': 1,
    'MONITORING': 2,
    'ELEVATED_INDICATORS': 3,
    'HIGH_INDICATORS': 4,
}
COLORS = {
    'INSUFFICIENT_EVIDENCE': (160, 160, 160),
    'NORMAL': (80, 200, 80),
    'MONITORING': (0, 220, 255),
    'ELEVATED_INDICATORS': (0, 140, 255),
    'HIGH_INDICATORS': (0, 0, 255),
}


def _annotate(frame, persons: List[Dict[str, Any]]):
    height, width = frame.shape[:2]
    out = frame.copy()
    for person in persons:
        box = person['tracking']['boundingBox']
        status = person['visualStatus']
        color = COLORS.get(status, (255, 255, 255))
        x1, y1 = int(box['x'] * width), int(box['y'] * height)
        x2, y2 = int((box['x'] + box['width']) * width), int((box['y'] + box['height']) * height)
        cv2.rectangle(out, (x1, y1), (x2, y2), color, 2)
        keypoints = person['body'].get('keypoints') or {}
        points = keypoints.values() if isinstance(keypoints, dict) else keypoints
        for point in points:
            if isinstance(point, dict) and point.get('confidence', 0) >= 0.5:
                cv2.circle(out, (int(point['x'] * width), int(point['y'] * height)), 2, color, -1)
        label = f"{person['trackId']} {status.replace('_INDICATORS', '')}"
        cv2.putText(out, label, (x1, max(12, y1 - 4)), cv2.FONT_HERSHEY_SIMPLEX, 0.45, color, 1)
    return out


def run_video(entry: Dict[str, Any], video_dir: Path, out_dir: Path, fps: float) -> Dict[str, Any]:
    capture = cv2.VideoCapture(str(video_dir / entry['file']))
    if not capture.isOpened():
        raise RuntimeError(f"cannot open {entry['file']}")
    source_fps = capture.get(cv2.CAP_PROP_FPS) or 25.0
    total = capture.get(cv2.CAP_PROP_FRAME_COUNT) / source_fps
    start = float(entry.get('start') or 0.0)
    end = min(float(entry.get('end') or total), total)
    pipeline = FrameProcessingPipeline()
    base = datetime(2026, 1, 1, tzinfo=timezone.utc)

    step = 1.0 / fps
    t = start
    samples = 0
    elapsed = 0.0
    status_seconds: Counter = Counter()
    track_seconds: Counter = Counter()
    track_peak: Dict[str, str] = {}
    evidence: Counter = Counter()
    limitations: Counter = Counter()
    group_peaks: Dict[str, float] = defaultdict(float)
    episodes: Dict[str, Dict[str, Any]] = {}
    timeline: List[Dict[str, Any]] = []
    quality_sum = 0.0
    quality_n = 0
    face_visible = 0
    gait_visible = 0
    person_samples = 0
    peak: Optional[Dict[str, Any]] = None
    first_alert: Optional[float] = None
    last_second = -1

    while t < end:
        capture.set(cv2.CAP_PROP_POS_MSEC, t * 1000.0)
        ok, frame = capture.read()
        if not ok:
            break
        began = time.perf_counter()
        result = pipeline.process(entry['id'], frame, timestamp=base + timedelta(seconds=t))
        elapsed += time.perf_counter() - began
        samples += 1
        persons = result['persons']

        frame_best = 'INSUFFICIENT_EVIDENCE'
        for person in persons:
            status = person['visualStatus']
            risk = person['impairment']
            track = person['trackId']
            person_samples += 1
            track_seconds[track] += step
            if RANK[status] > RANK.get(track_peak.get(track, 'INSUFFICIENT_EVIDENCE'), 0):
                track_peak[track] = status
            if RANK[status] > RANK[frame_best]:
                frame_best = status
            quality = (person.get('quality') or {}).get('score')
            if quality is not None:
                quality_sum += quality
                quality_n += 1
            face_visible += 1 if person['face'].get('visible') else 0
            gait_visible += 1 if person['body'].get('gaitAvailable') else 0
            for item in risk.get('evidence') or []:
                evidence[item.split(' (')[0]] += 1
            for item in risk.get('limitations') or []:
                limitations[item] += 1
            for group, score in (risk.get('groups') or {}).items():
                if score is not None:
                    group_peaks[group] = max(group_peaks[group], round(score, 3))
            episode = risk.get('episode')
            if episode:
                key = episode['id']
                episodes[key] = {
                    'id': key,
                    'peakStatus': episode['peakStatus'],
                    'peakScore': round(episode['peakScore'], 3),
                    'peakConfidence': round(episode['peakConfidence'], 3),
                    'startedAt': round(
                        (datetime.fromisoformat(episode['startedAt']) - base).total_seconds(), 1,
                    ),
                    'endedAt': round(
                        (datetime.fromisoformat(episode['endedAt']) - base).total_seconds(), 1,
                    ) if episode.get('endedAt') else None,
                    'evidence': episode['evidence'],
                    'groups': {k: (round(v, 3) if v is not None else None) for k, v in episode['groups'].items()},
                }
            if status in ('ELEVATED_INDICATORS', 'HIGH_INDICATORS') and first_alert is None:
                first_alert = round(t - start, 1)
            score = risk.get('score') or 0.0
            if peak is None or (RANK[status], score) > (RANK[peak['status']], peak['score']):
                peak = {'status': status, 'score': score, 't': round(t, 1), 'frame': frame, 'persons': persons}

        status_seconds[frame_best if persons else 'NO_PERSON'] += step
        second = int(t - start)
        if second != last_second:
            last_second = second
            primary = max(persons, key=lambda p: p['historyLength'], default=None)
            timeline.append({
                't': second,
                'persons': len(persons),
                'status': frame_best if persons else 'NO_PERSON',
                'score': round((primary or {}).get('impairment', {}).get('score') or 0.0, 3),
                'quality': round(((primary or {}).get('quality') or {}).get('score') or 0.0, 3),
            })
        t += step

    capture.release()
    pipeline.close()

    snapshot = None
    if peak is not None:
        snapshot = out_dir / f"{entry['id']}_peak.jpg"
        cv2.imwrite(str(snapshot), _annotate(peak['frame'], peak['persons']))

    peak_status = max(
        track_peak.values(), key=RANK.get,
        default='INSUFFICIENT_EVIDENCE' if track_seconds else 'NO_PERSON',
    )
    return {
        'id': entry['id'],
        'title': entry.get('title'),
        'label': entry.get('label'),
        'expected': entry.get('expected'),
        'license': entry.get('license'),
        'page': entry.get('page'),
        'segment': [round(start, 1), round(end, 1)],
        'secondsAnalysed': round(end - start, 1),
        'samples': samples,
        'msPerFrame': round(1000 * elapsed / max(samples, 1), 1),
        'tracks': len(track_seconds),
        'longTracks': sum(1 for seconds in track_seconds.values() if seconds >= 5),
        'peakStatus': peak_status,
        'firstAlertSeconds': first_alert,
        'statusSeconds': {k: round(v, 1) for k, v in status_seconds.items()},
        'meanQuality': round(quality_sum / quality_n, 3) if quality_n else None,
        'faceVisibleFraction': round(face_visible / person_samples, 3) if person_samples else None,
        'gaitVisibleFraction': round(gait_visible / person_samples, 3) if person_samples else None,
        'groupPeaks': dict(group_peaks),
        'topEvidence': evidence.most_common(5),
        'topLimitations': limitations.most_common(5),
        'episodes': sorted(episodes.values(), key=lambda e: e['startedAt']),
        'timeline': timeline,
        'peakSnapshot': str(snapshot) if snapshot else None,
        'peakAt': peak['t'] if peak else None,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument('manifest')
    parser.add_argument('--videos', default='.')
    parser.add_argument('--out', default='evaluation/results/online')
    parser.add_argument('--fps', type=float, default=5.0)
    parser.add_argument('--only', nargs='*')
    args = parser.parse_args()

    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)
    entries = json.loads(Path(args.manifest).read_text())
    results = []
    for entry in entries:
        if args.only and entry['id'] not in args.only:
            continue
        began = time.perf_counter()
        summary = run_video(entry, Path(args.videos), out_dir, args.fps)
        results.append(summary)
        print(
            f"{entry['id']:<22} {summary['peakStatus']:<22} alert@{summary['firstAlertSeconds']} "
            f"episodes={len(summary['episodes'])} tracks={summary['tracks']} "
            f"q={summary['meanQuality']} {summary['msPerFrame']}ms/f "
            f"({time.perf_counter() - began:.0f}s)",
            flush=True,
        )
        (out_dir / 'report.json').write_text(json.dumps(results, indent=1))


if __name__ == '__main__':
    main()
