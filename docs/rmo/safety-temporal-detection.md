# Temporal Safety Detection — Implementation Note

Date: 2026-10-02. Local Kostra/RMO only.

## Root cause of weak detection (before this change)

Live Phase 6/10 monitoring **could not** alert on closed eyes or head-down posture:

1. `FaceFeatureExtractor` stubbed `eyes.available=False` and `headPose.pitch=None`.
2. `FrameProcessingPipeline` hard-coded `visualStatus` / `impairment` to `INSUFFICIENT_EVIDENCE`.
3. Phase 9A impairment POC is a **separate** mock endpoint — not on the live frame path.
4. No temporal timers, hysteresis, alert cooldown, or multi-signal escalation existed.

Frame rate and identity cooldown were **not** the blockers — the safety engine did not exist.

## Detection path (after)

```
~1 fps JPEG sample (CallMedia)
  → POST /api/monitoring/calls/:id/ai/frames
  → AI SessionStore.ingest_frame
  → FrameProcessingPipeline
       PersonDetector → Tracker → Face/Pose/Movement/Quality
       → SafetyDetectionEngine.evaluate (timestamp-based)
       → persons[].safety / visualStatus / impairment
  → GET /ai/status → PeopleTrackingPanel
```

Identity (Phase 11 AWS) remains a **separate** async path and is never invoked by safety detection.

## What changed

| Area | Change |
| --- | --- |
| Eyes | Haar eye probe → `openProbability` (local heuristic) |
| Head pose | Pluggable provider (`heuristic` / `mock` / `unavailable`) |
| Engine | `ai-service/app/safety/engine.py` — temporal per-track state |
| Strict mode | `AI_STRICT_MODE=true` uses short thresholds; `false` scales ×3 |
| UI | People panel shows safety state, signals, durations |
| Alerts | Session counters `warningCount` / `criticalCount` (in-memory) |

## Product wording

Uses: “Potential impairment indicator — requires human verification.”

Never: drunk / alcohol confirmed / intoxicated.

## Defaults (strict)

- Eye closure WARNING @ 2s, CRITICAL @ 4s
- Head-down WARNING @ 2s, CRITICAL @ 5s
- Confirmation 2 frames / recovery 3 frames
- Quality gap tolerance 1s
- Alert cooldown 10s (escalation WARNING→CRITICAL still emits)
- Multi-signal (2) → CRITICAL
