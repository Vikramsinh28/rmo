# RMO Phase 12–13 — Pose Signals, Visual Indicator Risk Engine, Safety Events

Implements the live recognition + visual impairment indicator design
(`AI_Live_Intoxication_Recognition_Design.pdf`) up to a rule-based, human-reviewed baseline.

> Outputs are **visual indicators**, never a diagnosis. Every alert becomes a safety event
> that a supervisor must review; breath testing remains the confirmation step.

## Pipeline

```
Browser (CallMedia, ~5 fps JPEG)
  → POST /api/monitoring/calls/[id]/ai/frames          (Next.js, RBAC + entitlement)
  → ai-service /sessions/{jobId}/frames
      YOLO11n-pose  → ByteTrack  → per-track pose features (COCO-17 keypoints)
      MediaPipe FaceLandmarker  → head pose, eye/mouth openness (blendshapes)
      TemporalFeatureExtractor (10 s window) → posture, sway, gait, head, eyes, coordination
      RiskEngine → status + episode (persistence, hysteresis, abstention)
  ← persons[] { tracking, body, face, movement, quality, impairment, visualStatus }
  → identity overlay (Rekognition, Phase 11) + SafetyEvent persistence (Phase 13)
```

Fallbacks: `yolo → hog`, `bytetrack → iou`, `mediapipe → haar` (logged as
`AI_POSE_MODEL_UNAVAILABLE`, `AI_BYTETRACK_UNAVAILABLE`, `AI_FACE_MESH_UNAVAILABLE`).

## Risk engine (`ai-service/app/temporal/risk.py`, `visual-indicators-rules-v1`)

| Group        | Weight | Main signals                                           |
| ------------ | ------ | ------------------------------------------------------ |
| gait         | 0.30   | step interval variability, symmetry, path deviation    |
| sway         | 0.20   | hip lateral sway (standing or path residual walking)   |
| posture      | 0.20   | torso angle variation, abrupt corrections              |
| head         | 0.10   | frame-to-frame jitter, sustained roll                  |
| eyes         | 0.10   | closed fraction (PERCLOS), longest closure             |
| coordination | 0.10   | wrist jerk ratio                                       |

- **Insufficient evidence** when fewer than 8 samples, window < 4 s, mean quality < 0.35,
  or less than 25% of the weighted groups are observable.
- **Multi-group rule:** Elevated needs score ≥ 0.5 and two groups ≥ 0.6; High needs
  score ≥ 0.7 with two strong groups. A single signal can only reach Monitoring.
- **Persistence:** Monitoring 3 s, Elevated 8 s, High 10 s. **Release** after 8 s below.
- **Episodes:** each Elevated/High period gets an id `{trackId}-e{n}` with peak status,
  score, confidence, evidence, group scores and the feature window.

Statuses shown in the dashboard: Normal, Monitoring, Elevated / High Visual Impairment
Indicators, Insufficient Evidence.

## Safety events (Next.js)

- Model `SafetyEvent` (migration `20260928093539_rmo_safety_events`), unique per
  `(aiJobId, episodeKey)`.
- `src/services/internal/rmo/safety-events.ts`
  - `recordSafetyEpisodes` — called from `ingestCallAIFrame`, off the request path, writes
    serialised per job, only when the episode changes (new, escalated, ended, identity added).
    Subject is filled in once identity resolution recognises the track.
  - Open events close when the track has been missing > 10 s or AI processing stops.
  - `stripImpairment` — impairment output is removed from `/ai/status` and no events are
    stored when the division's `impairmentDetection` entitlement is off.
  - Audit: `safety_event.created` (system actor) and `safety_event.reviewed`.
- API
  - `GET /api/safety-events` — filters `status`, `severity`, `search`, `lobbyId`,
    `divisionId`, `dateFrom`, `dateTo`, pagination; returns `pending` count.
  - `GET /api/safety-events/[id]` — includes the feature window.
  - `POST /api/safety-events/[id]/review` — `{ outcome, note, breathTestPerformed,
    breathTestPositive }`. Outcome sets status: `IMPAIRMENT_CONFIRMED → CONFIRMED`,
    `NOT_IMPAIRED | OTHER_CAUSE → DISMISSED`, `INSUFFICIENT_VIDEO → INCONCLUSIVE`.
    Confirming impairment requires a note.
- Live alerts: new, escalated and reviewed events are published on the existing
  `/api/monitoring/events` SSE stream as `safety.alert`, `safety.escalated` and
  `safety.reviewed`. Only SYSTEM_ADMIN, SUPER_ADMIN and the division's DIVISION_ADMIN /
  DIVISION_MONITOR receive them — never lobby or crew users. `SafetyAlertCenter` (mounted in
  the dashboard layout) shows a toast with **Review** / **Open call** actions and an audio
  tone (High alerts stay until dismissed or reviewed), sends a desktop notification when the
  tab is hidden and permission was granted, and keeps the sidebar pending-review badge
  current. The Safety events page refreshes live and opens `?id=` links.
- UI: `/safety-events` (`SafetyEventsScreen`) — list, filters, detail with indicators and
  signal group bars, review form. Live person cards show status, confidence and evidence.

| Role             | List / view         | Review          |
| ---------------- | ------------------- | --------------- |
| SYSTEM_ADMIN     | all                 | yes             |
| SUPER_ADMIN      | all                 | no (read only)  |
| DIVISION_ADMIN   | own division        | own division    |
| DIVISION_MONITOR | own division        | own division    |
| LOBBY_USER, CREW | no                  | no              |

## Configuration

| Variable                   | Default                         |
| -------------------------- | ------------------------------- |
| `AI_TRACKING_PROVIDER`     | `yolo`                          |
| `AI_TRACKER_PROVIDER`      | `bytetrack`                     |
| `AI_FACE_PROVIDER`         | `mediapipe`                     |
| `AI_POSE_THREADS`          | `0` (min(4, cpu))               |
| `AI_FRAME_INTERVAL_MS`     | `200`                           |
| `AI_RISK_ENABLED`          | `true`                          |
| `AI_RISK_WINDOW_SECONDS`   | `10`                            |
| `AI_RISK_EVAL_INTERVAL_MS` | `1000`                          |

## Verification

- `cd ai-service && .venv/bin/python -m pytest -q` — pose signals, temporal features, risk
  engine (persistence, hysteresis, abstention, episodes).
- `pnpm test:local -- src/test/api/rmo/safety-events.test.ts` — persistence, escalation,
  closing on stop, division scoping, review validation, audit, entitlement gating.
- Manual: enable `impairmentDetection` for the division (Division AI screen), start AI on a
  live call, sway/stagger in view for ~10 s, then open **Safety events**.

## Not done yet (needs data, not code)

- Thresholds are hand-set. They must be calibrated on labelled lobby footage
  (`ai-service/evaluation`) before operational use; track false-positive rate per lobby.
- A learned temporal model (e.g. GRU/TCN over the feature window) should replace the rules
  once enough reviewed events exist — review outcomes are the training labels.
- Evidence clips/snapshots are not stored (privacy decision pending); events keep numeric
  features only.
- Transport is HTTP frame POSTs; a WebRTC/LiveKit media tap would cut latency and DB load.
