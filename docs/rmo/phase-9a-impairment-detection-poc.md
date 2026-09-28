# Phase 9A — Potential Impairment Detection POC

Date: 2026-09-26. Local Kostra/RMO only.

## 1. Purpose

Establish a **research/POC** interface for analyzing a single image for
**potential visual impairment indicators**.

This POC does **not** establish alcohol consumption or intoxication.
Outputs are assistive safety signals that require human verification.

## 2. Scope

In scope:

- Python AI-service endpoint `POST /impairment/analyze`
- Pluggable `ImpairmentDetector` interface
- `MockImpairmentDetector` (default, development only)
- `LocalImpairmentDetector` placeholder → `ANALYSIS_UNAVAILABLE`
- Image validation / preprocessing
- Normalized JSON response
- Optional RMO proxy `POST /api/ai/impairment/analyze` (INTERNAL / DEV ONLY)
- Tests and documentation

Out of scope:

- Live WebRTC integration
- Continuous / automatic analysis
- Fatigue or behavior detection
- AWS Rekognition for impairment
- Database persistence of frames or results
- Production deployment

## 3. Architecture

```
Test client / DEV proxy
        │ multipart frame
        ▼
Python AI Service  :8090
        │ validate + decode
        ▼
ImpairmentDetector (interface)
        ├── MockImpairmentDetector   (default)
        └── LocalImpairmentDetector  (no model → ANALYSIS_UNAVAILABLE)
        ▼
Normalized JSON (status / risk / indicators)
        │
        ▼
Discard image bytes (never stored)
```

Face identification (Phases 7A/8) remains on AWS Rekognition in RMO.
Impairment POC does **not** call AWS.

## 4. API

### AI service

`POST /impairment/analyze`  
Auth: `Authorization: Bearer <AI_SERVICE_TOKEN>`  
Body: `multipart/form-data` field `frame` (JPEG/PNG)

### RMO proxy (INTERNAL / DEVELOPMENT ONLY)

`POST /api/ai/impairment/analyze`  
Requires:

- Authenticated `SYSTEM_ADMIN`
- `IMPAIRMENT_POC_ENABLED=true`
- Non-production `NODE_ENV`

Not shown in the live Division Monitor UI.

## 5. Detector interface

```python
class ImpairmentDetector(ABC):
    provider_name: str
    development_only: bool
    def analyze(self, frame: PreprocessedFrame) -> ImpairmentAnalysisResult: ...
```

Provider selected server-side via `IMPAIRMENT_DETECTOR_PROVIDER`
(`mock` | `local-model`). Clients cannot choose the implementation.

## 6. Mock provider

`MockImpairmentDetector` is deterministic for tests:

| Trigger | Status |
| --- | --- |
| default / `POC_IMPAIRMENT:clear\|` | `NO_CLEAR_INDICATOR` |
| `POC_IMPAIRMENT:potential\|` or `MOCK_IMPAIRMENT_RESULT=potential` | `POTENTIAL_IMPAIRMENT` |
| `no_person` | `NO_PERSON_DETECTED` |
| `low_quality` | `INSUFFICIENT_QUALITY` |
| `unavailable` | `ANALYSIS_UNAVAILABLE` |

Labeled `provider=mock`, `developmentOnly=true`. **Not** a real alcohol detector.

## 7. Real-model provider status

`LocalImpairmentDetector` exists as a plug-in point.
No validated pretrained impairment/alcohol model is shipped.
It always returns `ANALYSIS_UNAVAILABLE` and does not invent scores.

## 8. Image lifecycle

1. Validate magic bytes, size, decode (Pillow), dimensions
2. Run detector
3. Discard bytes
4. Never write to `public/`, uploads, or PostgreSQL

## 9. Limitations

- Single-frame analysis only
- POC / mock by default
- Cannot confirm alcohol consumption or intoxication
- Cannot replace human judgment
- Future production may need multi-frame temporal analysis (not in 9A)

## 10. Privacy

- Frames processed temporarily in memory
- Results not persisted in Phase 9A
- Mock results are development-only
- Human review required for potential impairment signals
- No legal/compliance claims are made by this POC

## 11. Security

- Provider configured server-side only
- No client-supplied model path / command / URL
- AI service token required
- RMO proxy admin-only + feature flag
- Responses scrubbed of credential-like fields
- No AWS credentials involved in impairment path

## 12. Testing

- Python: `ai-service/tests/test_impairment.py`
- Jest: `src/test/ai/impairment.test.ts`
- Existing Phase 6 session tests remain green

## 13. Future production architecture (not implemented)

```
Live call (optional later)
  → entitlement assertDivisionAIFeature(..., 'impairmentDetection')
  → multi-frame capture
  → validated model
  → human review workflow
  → audit (no raw biometrics)
```

Phase 9A stops before any of that.

See also Phase 9B model evaluation:
[phase-9b-model-evaluation.md](./phase-9b-model-evaluation.md)
(**DO_NOT_PROCEED** to live monitoring until a validated model exists).

## Terminology

Use: *Potential Impairment*, *potential impairment indicators*, *requires human verification*.

Do **not** use: *Alcohol detected*, *Person consumed alcohol*, *Person is intoxicated*, *DRUNK*, *ALCOHOL_CONFIRMED*.
