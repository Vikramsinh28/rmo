# Phase 8 — Manual Face Recognition

Date: 2026-09-26. Local Kostra/RMO only.

Canonical detail: [../RMO_PHASE_8_MANUAL_FACE_RECOGNITION.md](../RMO_PHASE_8_MANUAL_FACE_RECOGNITION.md).

## Architecture

```
Division Monitor clicks "Recognize Faces"
        │ capture ONE canvas JPEG
        ▼
POST /api/monitoring/calls/:id/ai/recognize
        │ auth + entitlement + cooldown
        ▼
DetectFaces → (optional crop) → SearchFacesByImage
        │ DivisionFaceCollection for call.divisionId
        ▼
providerFaceId → UserFaceEnrollment → ACTIVE CREW_USER (same division)
        ▼
Safe UI result (no providerFaceId / AWS payload / credentials)
```

AWS Rekognition runs only on an explicit monitor click. Phase 6 continuous frame sampling never calls Rekognition.

## Manual recognition flow

1. Monitor opens a connected live call.
2. Face Identification entitlement must be active for the call's division.
3. Click **Recognize Faces**.
4. One frame is captured from the displayed remote video.
5. One recognition request runs (DetectFaces + SearchFacesByImage per face).
6. Results appear in the panel; button returns after cooldown.

No `useEffect` auto-recognize. No `setInterval` recognition. No connection to `AI_FRAME_INTERVAL_MS`.

## AWS Rekognition

- `DetectFaces` — locate faces in the frame
- `SearchFacesByImage` — match against the division collection
- Collection: Phase 7A `DivisionFaceCollection.collectionId` (`rmo-local-division-{divisionId}`)

Config:

- `FACE_RECOGNITION_MATCH_THRESHOLD` (default `90`)
- `FACE_RECOGNITION_COOLDOWN_MS` (default `5000`)
- `FACE_RECOGNITION_PROVIDER=mock` for Jest

## Division collection strategy

Collection is derived from `call.divisionId` on the server. The browser must not send `collectionId`, `divisionId`, or `userId` as authorization inputs.

## Authorization

1. Authenticated RMO session
2. Role: `DIVISION_MONITOR` (same division as call) or system admin
3. Call exists and is `CONNECTED`
4. Monitor cannot recognize another division's call

## AI entitlement

Uses `assertDivisionAIFeature(divisionId, 'faceIdentification')`.

Disabled / expired / not started → `403` with `FACE_IDENTIFICATION_NOT_ENABLED`.

## Rate limiting

- Client: button disabled for cooldown (default 5s)
- Server: one recognition request per call per `FACE_RECOGNITION_COOLDOWN_MS` → `429` `RECOGNITION_RATE_LIMITED`

## Image lifecycle

JPEG validated (SOI, max 2MB), processed in memory, discarded. Not written to `public/`, uploads, or PostgreSQL.

## Privacy

No recognition images stored. No embeddings in RMO DB. Audit events omit `providerFaceId`, raw AWS responses, and image bytes.

Audit: `face.recognition.requested` / `completed` / `failed`.

## Failure isolation

AWS/AI/recognition failures return HTTP errors only. WebRTC, call lifecycle, recording, and lobby session stay connected.

## Cost-control strategy

| Action | AWS recognition |
| --- | --- |
| Live session idle | 0 |
| Phase 6 AI frame sampler | 0 |
| One "Recognize Faces" click | DetectFaces + SearchFacesByImage (per detected face) |
| Immediate second click | 0 (429) |

`recognitionRequestCount` is returned and logged (`FACE_RECOGNITION_*`).

## API

`POST /api/monitoring/calls/:id/ai/recognize` — multipart field `frame` (JPEG).

## UI

`FaceRecognizeControls` on the Division Monitor live stage: **Recognize Faces** / **Recognizing…** / results panel (identified / unknown / low confidence).

## Tests

`src/test/api/rmo/face-recognition.test.ts` — auth, entitlement, match, rate limit, response hygiene (mock provider).

## What is NOT implemented

Continuous recognition, automatic tracking, fatigue / impairment / behavior detection, biometric history, payments, Railway Monitor or production DB changes.
