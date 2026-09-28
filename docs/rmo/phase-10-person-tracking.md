# Phase 10 — Real-Time Person Tracking Foundation

Date: 2026-09-26. Local Kostra/RMO only.

## Objective

Detect and track people in Phase 6 sampled frames, maintain bounded rolling
state, extract visual feature placeholders, and surface temporary track IDs
on the Division Monitor dashboard.

**Not implemented:** continuous AWS recognition, impairment classification,
alcohol/intoxication claims.

## Architecture

```
WebRTC live call (untouched)
   └── AI frame sampler (Phase 6)
          ↓
       RMO /api/.../ai/frames
          ↓
       AI service :8090
          ├── PersonDetector (HOG | mock)
          ├── IoU PersonTracker → Person-N
          ├── Face / Pose / Movement / Quality features
          ├── RollingPersonState (AI_TRACKING_WINDOW_SECONDS)
          └── IdentityResolver → UNKNOWN (no AWS)
```

## API

- `POST /sessions/{id}/frames` — Phase 6 ingest; now also runs tracking when enabled
- `POST /sessions/{id}/process-frame` — explicit multipart tracking endpoint
- Session status includes `persons`, `personCount`, `tracking`

## RMO UI

When AI Monitoring is **Processing**, `PeopleTrackingPanel` shows track cards:
track ID, Unknown/Recognized, identity confidence, visual status
(`Insufficient Evidence`), evidence quality.

Manual **Recognize Faces** remains unchanged and is the only AWS path.

## Config

```
AI_TRACKING_ENABLED=true
AI_TRACKING_PROVIDER=hog|mock
AI_TRACKING_WINDOW_SECONDS=30
AI_TRACKING_MAX_LOST_FRAMES=15
AI_TRACKING_IOU_THRESHOLD=0.3
```

## Limitations

- HOG person detection is coarse; mock provider used in tests
- Pose keypoints / eye / mouth / head-pose angles are null without specialized models
- Gait always disabled without lower-body keypoints
- Identity always UNKNOWN until a later periodic Rekognition phase
- Impairment always `INSUFFICIENT_EVIDENCE` with `confidence: null`

## Phase 11 candidates

- Periodic / quality-gated identity resolution via existing Rekognition enrollment
- Temporal feature aggregation across the rolling window
- Optional lightweight pose model
- Still: no alcohol determination, no continuous AWS every frame
