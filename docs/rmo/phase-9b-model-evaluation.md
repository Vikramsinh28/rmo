# Phase 9B — Real Impairment Detection Model Evaluation

Date: 2026-09-26. Local Kostra/RMO only.

## 1. Objective

Evaluate whether a **real** computer-vision / ML approach can provide useful
**potential visual impairment indicators** that warrant human review.

This phase does **not** produce production impairment detection.

This phase does **not** claim that a person consumed alcohol, is intoxicated,
or is drunk.

Correct terminology remains:

- Potential Impairment
- Potential Impairment Indicators
- Requires Human Verification

## 2. Existing architecture

```
RMO/Kostra
  ├── Live WebRTC (untouched)
  ├── Face enrollment / recognition → AWS Rekognition (untouched)
  └── AI Service :8090
        └── Phase 9A ImpairmentDetector
              ├── MockImpairmentDetector
              ├── LocalImpairmentDetector
              └── CandidateImpairmentDetector  ← Phase 9B
```

Phase 9B adds offline evaluation only:

```
Synthetic/test image
  → AI service detector / benchmark runner
  → metrics + evaluation/results/latest.json
```

No live session hooks. No `/api/monitoring/calls/:id/ai/impairment`.

## 3. Repository constraints inspected

| Item | Finding |
| --- | --- |
| Python (venv) | 3.9.x locally; Docker image `python:3.12-slim` |
| Existing deps | FastAPI, Pydantic, Pillow, httpx, pytest |
| OpenCV / torch / mediapipe | **Not** installed |
| GPU / CUDA | Not available in this local environment (`no-torch`) |
| Docker | Single `ai-service` on port 8090 |
| Phase 9A | Interface + mock + local placeholder already present |

### Dependency policy for Phase 9B

| Package | Version | Purpose | Size / runtime | License | Decision |
| --- | --- | --- | --- | --- | --- |
| Pillow | 11.1.0 (existing) | Decode + technical probes | Small, CPU | HPND-ish / PIL | Keep |
| opencv-python-headless | — | Face detect | Large wheel | Apache-2.0 | **Not installed** (size; not an impairment model) |
| mediapipe | — | Landmarks | Large + native | Apache-2.0 | **Not installed** |
| torch / torchvision | — | DNN inference | Very large; GPU preferred | BSD-3 | **Not installed** |
| deepface | — | Face attrs | Pulls TF/torch | MIT | **Not installed** |

No large ML packages were added. Docker image size change for Phase 9B code-only: **negligible** (no new pip deps).

## 4. Candidate models evaluated

### Summary table

| Model | Task | Evidence | License | CPU | GPU | Latency | Decision |
| --- | --- | --- | --- | --- | --- | --- | --- |
| MockImpairmentDetector | Deterministic POC fixtures | Dev-only; not clinical | In-repo | Yes | No | &lt;5ms | ACCEPT_FOR_POC |
| LocalImpairmentDetector | Placeholder | Returns ANALYSIS_UNAVAILABLE | In-repo | Yes | No | &lt;1ms | ACCEPT_FOR_POC (honest unavailable) |
| CandidateImpairmentDetector (Pillow technical probe) | Quality / signal readiness | Not alcohol evidence | In-repo | Yes | No | ~1–20ms | ACCEPT_FOR_POC (technical only) |
| MediaPipe Face Mesh | Facial landmarks | Landmarks ≠ alcohol | Apache-2.0 | Yes | Optional | tens of ms | REJECT (as alcohol detector); NEEDS_MORE_VALIDATION as future feature extractor |
| OpenCV Haar / DNN face | Face detection | Presence only | Apache-2.0 / model-specific | Yes | Optional | low–medium | REJECT (not impairment) |
| DeepFace emotion/age/gender | Face attributes | No validated alcohol task | MIT + deps | Heavy | Optional | high | REJECT |
| Published BAC / “drunk detection” CV papers | Often binary intoxicated labels | Small/biased datasets; unclear camera transfer; high FPR risk | Mixed / often closed | Varies | Often | Varies | NEEDS_MORE_VALIDATION / REJECT for bundling |
| AWS Rekognition | Face identity / celebs / labels | Identity product, not impairment | AWS ToS | Cloud | Cloud | network | REJECT (forbidden for impairment; reserved for Phases 7A/8) |
| Eye Aspect Ratio / head-pose heuristics | Drowsiness / pose proxies | Drowsiness literature exists; **not** alcohol proof | Heuristic | Yes | No | low | REJECT as alcohol detector |

### Detailed records

#### MockImpairmentDetector
- **Source:** Phase 9A in-repo
- **Task:** Deterministic fixture responses
- **Dataset:** Marker / env fixtures
- **Training objective:** None
- **License:** Project
- **Evidence of relevance:** Development testing only
- **Known limitations:** Not a detector
- **Decision:** ACCEPT_FOR_POC

#### LocalImpairmentDetector
- **Source:** Phase 9A placeholder
- **Task:** Explicit unavailable
- **Decision:** ACCEPT_FOR_POC (correct honest behavior)

#### CandidateImpairmentDetector (Pillow technical probe)
- **Source:** Phase 9B in-repo
- **Task:** Image quality / contrast / presence-signal gates
- **Dataset:** Synthetic geometric fixtures
- **Training objective:** None (no weights)
- **License:** Project
- **Input:** Single JPEG/PNG frame
- **Output:** `INSUFFICIENT_QUALITY` / `NO_PERSON_DETECTED` / `ANALYSIS_UNAVAILABLE`
- **Confidence:** Always `null` (no invented scores)
- **CPU/GPU:** CPU only
- **Evidence of relevance:** Pipeline readiness only — **not** impairment evidence
- **Known limitations:** Cannot detect alcohol; geometric “presence” ≠ person/face identity
- **Decision:** ACCEPT_FOR_POC (technical evaluation harness)

#### MediaPipe Face Mesh
- **Task:** 468 facial landmarks
- **Training objective:** Landmark regression / face geometry
- **Evidence:** Useful for eye openness / head pose **features**, not BAC
- **Limitations:** Domain shift; single-frame; no alcohol label
- **Decision:** REJECT as impairment/alcohol model; NEEDS_MORE_VALIDATION as optional feature backbone later

#### OpenCV face detectors
- **Task:** Face bounding boxes
- **Evidence:** Person/face presence for quality gating
- **Decision:** REJECT as impairment model (size + wrong task). Not installed in 9B.

#### DeepFace
- **Task:** Recognition / emotion / age / gender
- **Evidence:** None for alcohol impairment suitable for RMO cameras
- **Decision:** REJECT (dependency weight + wrong claims risk)

#### Published “alcohol/BAC from face” models
- **Evidence:** Academic prototypes often use constrained datasets; poor generalization to lobby CCTV/WebRTC frames; ethical/legal risk if oversold
- **Decision:** NEEDS_MORE_VALIDATION — do not bundle or claim readiness

#### AWS Rekognition
- **Decision:** REJECT for impairment (product boundary + this phase’s hard rule)

## 5. Model selection criteria

A candidate must have:

1. Clear training task and dataset documentation
2. Evidence relevant to **impairment indicators** (not just landmarks)
3. License allowing local deployment
4. Acceptable CPU latency for eventual offline/batch use
5. Documented false-positive / false-negative risks
6. No requirement to invent medical thresholds

**Finding:** No open, validated, license-clear alcohol/impairment model suitable for RMO lobby cameras is available in this repository or as a safe default dependency.

Therefore the correct production-shaped result remains:

`ANALYSIS_UNAVAILABLE`

unless quality/no-person technical gates apply.

## 6. Dataset methodology

Location:

```
ai-service/evaluation/
  samples/          # generated synthetic JPEGs (gitignored binaries)
  metadata/samples.json
  results/          # latest.json gitignored
```

Rules followed:

- No real face images committed
- No `intoxicated` / `sober` / `drunk` labels
- `expectedStatus` is **technical pipeline expectation** only
- `containsImpairmentGroundTruth: false` → precision/recall for alcohol **not calculated**

## 7. Benchmark methodology

Command:

```bash
cd ai-service
python -m evaluation.run_impairment_benchmark --provider candidate-model
# or: python -m evaluation --provider candidate-model
```

Produces: `evaluation/results/latest.json`

Measures:

- preprocess / inference / total latency
- average / p50 / p95
- failures / qualityFailures
- images/sec
- RSS memory delta
- environment (CPU, RAM, CUDA availability)

Does **not** fabricate alcohol accuracy metrics.

## 8–9. Hardware & latency (local run)

Reported by the benchmark environment probe (values vary by machine):

- Device configured: `cpu`
- CUDA: typically unavailable in this local setup
- Candidate probe latency: typically **low tens of milliseconds or less** on synthetic 96–128px images

See `evaluation/results/latest.json` after running the command for exact numbers on your machine.

## 10. Accuracy metrics

**Not claimed.** Dataset has no legitimate impairment ground truth.

Technical expectation match (pipeline gates) may be reported; it is **not** alcohol-detection accuracy.

## 11. Limitations

- Single-frame analysis is insufficient to establish impairment
- No validated impairment weights bundled
- Synthetic fixtures ≠ operational lobby video
- Landmark/eye heuristics ≠ alcohol consumption
- Continuous / temporal analysis is **out of scope** (Phase 9C+)

## 12. Privacy

- Benchmark images processed in memory
- Results JSON stores statuses/latencies, not image bytes
- Sample binaries gitignored; no `public/` or Postgres storage
- No base64 image logging

## 13. Security

- `IMPAIRMENT_DETECTOR_PROVIDER`, `IMPAIRMENT_MODEL_PATH`, `IMPAIRMENT_MODEL_DEVICE`, `IMPAIRMENT_MODEL_TIMEOUT_MS` are **server-side env only**
- HTTP clients cannot select model path / device
- No AWS credentials on impairment path
- Loading arbitrary unverified weight files is **disabled**

## 14. Model license

In-repo code: project license. No third-party impairment model weights are redistributed.

## 15. Decision

| Component | Decision |
| --- | --- |
| Mock / Local / Candidate technical probe | ACCEPT_FOR_POC |
| Any bundled “alcohol detector” | REJECT |
| MediaPipe/OpenCV/DeepFace as alcohol detector | REJECT |
| Academic BAC-from-face models | NEEDS_MORE_VALIDATION |

**Overall Phase 9B product decision:** there is **insufficient evidence** to ship a real impairment model.

## 16. Recommendation for Phase 9C

### **DO_NOT_PROCEED** (live / automatic impairment monitoring)

Reasons:

1. No validated, license-clear, camera-appropriate impairment model identified
2. Single-frame claims would be scientifically and operationally misleading
3. False-positive risk on safety workflows is unacceptable without evidence
4. Terminology discipline requires avoiding “alcohol detected” without support

### Optional research track (not Phase 9C live)

If product owners later acquire a **licensed dataset with legitimate labels** and a **peer-reviewed or vendor-validated** model under an acceptable license, reopen evaluation under Phase 9B’s harness (`PROCEED_WITH_LIMITATIONS` for offline research only).

Until then: keep `ANALYSIS_UNAVAILABLE` for non-mock providers and do **not** wire live WebRTC sampling.

## Configuration

```bash
IMPAIRMENT_DETECTOR_PROVIDER=mock|local-model|candidate-model
IMPAIRMENT_MODEL_PATH=          # ignored unless a validated loader is added later
IMPAIRMENT_MODEL_DEVICE=cpu
IMPAIRMENT_MODEL_TIMEOUT_MS=5000
```

## Tests

- `ai-service/tests/test_impairment.py` — provider selection, candidate gates, mock regression
- Existing Phase 6/7A/8/9A suites must remain green
