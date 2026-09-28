# Phase 7A — Crew Face Enrollment

Date: 2026-09-26. Local Kostra/RMO only.

## 1. Architecture

```
Crew browser (webcam capture)
        │ authenticated multipart POST
        ▼
RMO /api/crew/face-enrollment
        │ assert CREW_USER + homeDivisionId + entitlement
        ▼
AWS Rekognition IndexFaces (server-side)
        │
        ▼
UserFaceEnrollment mapping in Postgres
```

No raw face images are stored. Live WebRTC and Phase 6 AI frame pipeline are unchanged.

## 2. AWS Rekognition

- SDK: `@aws-sdk/client-rekognition` (same major line as S3/SES)
- Operations: `DescribeCollection`, `CreateCollection`, `IndexFaces`, `DeleteFaces` (re-enroll)
- **Not** implemented: `SearchFacesByImage` (Phase 8)

## 3. Collection strategy

One collection per division:

    rmo-local-division-{divisionId}

Stored in `DivisionFaceCollection`.

## 4. Database

- `UserFaceEnrollment` — status, provider, collectionId, providerFaceId (server-only)
- `DivisionFaceCollection` — division → collection mapping

Migration: `20260926030000_rmo_crew_face_enrollment`

## 5. APIs

| Method | Path | Who |
| --- | --- | --- |
| GET | `/api/crew/face-enrollment` | CREW_USER (self) |
| POST | `/api/crew/face-enrollment` | CREW_USER (self), multipart `sample0`…`sample4`, optional `confirmReenroll` |

Responses never include `providerFaceId` or AWS secrets.

## 6. Authorization

Only the authenticated CREW_USER enrolls their own face. Division is derived from `homeDivisionId`. Other roles receive 403.

## 7. Entitlement

Requires `getDivisionAICapabilities` / `assertDivisionAIFeature(..., 'faceIdentification')`.

403 `FACE_IDENTIFICATION_NOT_ENABLED` when AI or face flag is off / expired / not started.

## 8–9. Browser capture

`/crew/face-enrollment` — intro → camera → 3–5 JPEG captures inside an oval guide → submit.

## 10. Image handling

JPEG only, max ~1.5MB per sample, 3–5 samples. Bytes discarded after IndexFaces.

## 11. Security

Server-side role, account, entitlement, size, and type checks. Credentials only in env.

## 12. Privacy

Biometric enrollment mapping only. No legal compliance claims. No image retention in app storage.

## 13. Local AWS configuration

```
AWS_REGION=
AWS_ACCESS_KEY_ID=
AWS_SECRET_ACCESS_KEY=
```

For Jest: `FACE_ENROLLMENT_PROVIDER=mock` (never use mock in production).

## 14. Testing

See `src/test/api/rmo/face-enrollment.test.ts`.

## 15. Failure behavior

Safe user messages for no-face, AWS missing, entitlement off. Live call unaffected (separate system).

## What is NOT implemented

- Live face recognition / SearchFacesByImage
- Fatigue, impairment, behavior detection
- Admin face capture
- Railway Monitor changes
