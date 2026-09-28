# Phase 8 — Manual Face Recognition

Date: 2026-09-26. Local Kostra/RMO only.

## 1. Architecture

```
Division Monitor clicks "Recognize Faces"
        │ capture ONE canvas JPEG
        ▼
POST /api/monitoring/calls/:id/ai/recognize
        │ auth + entitlement + cooldown
        ▼
DetectFaces → crop (sharp) → SearchFacesByImage
        │ division collection only
        ▼
Resolve providerFaceId → UserFaceEnrollment → CREW_USER
        ▼
Safe UI result (no provider IDs / AWS payload)
```

AWS is called only on explicit monitor click. Phase 6 frame sampling never calls Rekognition.

## 2. Manual recognition flow

1. Monitor opens connected live call
2. Face Identification entitlement must be active
3. Click **Recognize Faces**
4. Exactly one recognition request path runs
5. Results show in the live panel
6. 5s client + server cooldown

## 3. AWS APIs

- `DetectFaces`
- `SearchFacesByImage`
- Existing Phase 7A collection: `rmo-local-division-{divisionId}`

## 4. Division collection

`DivisionFaceCollection` for `call.divisionId` only. Browser cannot supply collection/division IDs.

## 5–7. Authorization / entitlement / rate limit

- DIVISION_MONITOR (same division) or SYSTEM_ADMIN
- `assertDivisionAIFeature(divisionId, 'faceIdentification')`
- Server cooldown: `FACE_RECOGNITION_COOLDOWN_MS` (default 5000) → HTTP 429

## 8–10. Image lifecycle / privacy / failure isolation

JPEG validated, cropped temporarily, discarded. No DB/public storage of frames. Recognition failures never end WebRTC/recording.

## 11. Cost control

| Action | AWS recognition |
| --- | --- |
| Live session idle | 0 |
| Phase 6 AI frame sampler | 0 |
| One "Recognize Faces" click | DetectFaces + up to 5 SearchFacesByImage (one per detected face) |
| Immediate second click | 0 (429) |

`recognitionRequestCount` is returned per call and logged as `FACE_RECOGNITION_*`.

## 12. API

`POST /api/monitoring/calls/:id/ai/recognize` — multipart field `frame`

## 13. UI

`FaceRecognizeControls` beside the live AI badge on the monitor call stage.

## 14. Tests

`src/test/api/rmo/face-recognition.test.ts` (mock provider).

## 15. What is NOT implemented

Continuous recognition, tracking, fatigue/impairment/behavior, SearchFaces polling, biometric history, payments, Railway Monitor changes.
