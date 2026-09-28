# Phase 11 — Quality-Gated Crew Identity Resolution

Date: 2026-09-27. Local Kostra/RMO only.

## Architecture

```
Phase 6 frame sampler
        ↓
POST /api/monitoring/calls/:id/ai/frames
        ↓
AI service tracking (Phase 10)
        ↓
persons + face boxes + quality
        ↓
RMO identity scheduler (async, non-blocking)
        ↓
IdentityQualityGate
        ↓
cooldown / session limits
        ↓
crop face (temporary)
        ↓
SearchFacesByImage (division collection only)
        ↓
UserFaceEnrollment → CREW_USER
        ↓
in-memory track identity overlay
        ↓
AI status / People panel
```

Manual **Recognize Faces** (Phase 8) remains a separate, explicit path.

## AWS call conditions

AWS runs only when all are true:

1. `IDENTITY_RESOLUTION_ENABLED=true`
2. Face Identification entitlement active
3. Track has visible face + box
4. Face quality ≥ `IDENTITY_RESOLUTION_MIN_FACE_QUALITY`
5. Per-track cooldown elapsed
6. Track not already confidently recognized
7. Session request limit not exceeded
8. Concurrent slots available

Otherwise AWS is **not** called.

## Cost control

| Signal | Behavior |
| --- | --- |
| Frame rate ~1/s | Tracking only |
| Identity | ~15s cooldown per track |
| Max faces / frame batch | `IDENTITY_RESOLUTION_MAX_FACES_PER_REQUEST` |
| Max AWS / session | `IDENTITY_RESOLUTION_MAX_REQUESTS_PER_SESSION` |
| Max concurrent | `IDENTITY_MAX_CONCURRENT_REQUESTS` |

## Entitlement

`assertDivisionAIFeature(divisionId, 'faceIdentification')`

## Privacy

No face crops, frames, FaceIds, or AWS payloads persisted. Session overlay is in-memory and cleared when AI monitoring stops.

## Identity lifecycle

`UNKNOWN` → `CHECKING` → `RECOGNIZED` | `UNKNOWN` | `UNAVAILABLE`

Stability: recognized identity retained through temporary misses until `IDENTITY_MAX_MISSED_CONFIRMATIONS`. Conflicting user requires 2 confirmations before switch.

## Configuration

```
IDENTITY_RESOLUTION_ENABLED=true
IDENTITY_RESOLUTION_PROVIDER=aws|mock
IDENTITY_RESOLUTION_COOLDOWN_MS=15000
IDENTITY_RESOLUTION_MIN_FACE_QUALITY=0.70
IDENTITY_RESOLUTION_MIN_MATCH_CONFIDENCE=90
IDENTITY_RESOLUTION_MAX_FACES_PER_REQUEST=5
IDENTITY_RESOLUTION_MAX_REQUESTS_PER_SESSION=100
IDENTITY_MAX_CONCURRENT_REQUESTS=2
IDENTITY_MAX_MISSED_CONFIRMATIONS=3
```

## Failure behavior

AWS / entitlement / missing collection → identity unavailable or unknown; **WebRTC continues**.

## Testing

`src/test/ai/identity-resolution.test.ts` with `IDENTITY_RESOLUTION_PROVIDER=mock`.
