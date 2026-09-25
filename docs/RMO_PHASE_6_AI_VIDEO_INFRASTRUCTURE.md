# RMO Phase 6 — AI Video Infrastructure

Date: 2026-09-26. Local Kostra/RMO only. Railway Monitor and production databases were not changed.

## 1. Existing media architecture discovered

Live lobby video is **browser peer WebRTC**:

- `CallMedia.tsx` creates `RTCPeerConnection`
- Signaling is HTTP poll/POST (`/api/monitoring/calls/:id/signal`), not Socket.IO
- ICE from `GET /api/monitoring/ice` (STUN + TURN)
- Recording is browser `MediaRecorder` desk capture, not server egress
- **MediaMTX is not used** in this repository
- LiveKit exists in docker-compose for optional/local SFU scaffolding and is **not** on the live call path

```
Monitor browser ──getUserMedia──┐
                                ├── RTCPeerConnection (P2P / TURN)
Lobby browser  ──getUserMedia──┘
         ▲
         └── HTTP SDP/ICE via Next.js (in-memory signals)
```

Fixed CCTV/kiosk HLS tiles are a separate feed class and are not used for Phase 6 lobby AI.

## 2. How AI consumes the stream

AI is a **side-channel consumer**, not a third WebRTC peer.

1. Division Monitor starts AI processing (entitlement required).
2. Monitor browser samples the displayed remote video (`canvas` → JPEG) about once per second.
3. Frames POST to `POST /api/monitoring/calls/:id/ai/frames`.
4. RMO forwards authorized frames to the Python AI service.
5. AI service counts/rate-limits frames and discards pixels (no inference).

Optional **DEVELOPMENT ONLY** mode: `AI_DEV_TEST_STREAM=true` synthesizes frames inside the AI service without a camera.

## 3. Why AI is separated from the live session

| Concept | Owner | Lifecycle |
| --- | --- | --- |
| Live session (`LobbyCall`) | Monitor ↔ Lobby WebRTC | Continuous; independent |
| Recording (`RecordingSegment`) | Monitor MediaRecorder | Optional |
| AI processing (`AIProcessingJob`) | Entitlement + AI service | Optional |

Stopping or crashing AI must never end the live call.

## 4. Docker services

`docker-compose.yml` now includes:

- `postgres` (local RMO DB)
- `livekit` (unchanged optional SFU)
- `ai-service` (new, port **8090**)

```bash
docker compose up -d postgres ai-service
```

## 5. AI service endpoints

Base URL: `http://127.0.0.1:8090`

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| GET | `/health` | none | Liveness |
| GET | `/ready` | none | Readiness |
| GET | `/capabilities` | none | Declares frame extraction only |
| POST | `/sessions/start` | Bearer token | Register job |
| POST | `/sessions/{id}/stop` | Bearer token | Stop job |
| POST | `/sessions/{id}/frames` | Bearer token | Ingest frame bytes |
| GET | `/sessions/{id}/status` | Bearer token | Metrics |

Capabilities explicitly set face/fatigue/impairment/behavior to **false**.

## 6. AI processing lifecycle

Statuses: `STARTING` → `RUNNING` → `STOPPING` → `STOPPED` (or `ERROR`).

RMO APIs:

- `POST /api/monitoring/calls/:id/ai/start`
- `POST /api/monitoring/calls/:id/ai/stop`
- `GET /api/monitoring/calls/:id/ai/status`
- `POST /api/monitoring/calls/:id/ai/frames`

## 7. Entitlement enforcement

Start uses `getDivisionAICapabilities(divisionId)` from `ai-entitlement.ts`.

If unavailable → `403` with `error: "AI_MONITORING_NOT_ENABLED"`.

Division Monitor cannot start AI for another division's call.

## 8. Failure / reconnect behavior

- AI service down on start → job `ERROR`, live call stays `CONNECTED`
- Frame POST failures are swallowed by the client sampler
- Stop is idempotent and still marks the job stopped if AI service is unreachable
- Rate limit via `AI_FRAME_INTERVAL_MS` (default 1000)

## 9. Local development

```bash
# Terminal A — infra
docker compose up -d postgres ai-service

# Terminal B — app
cp .env.example .env   # ensure AI_SERVICE_URL / AI_SERVICE_TOKEN
npx prisma migrate deploy
npx prisma generate
npm run dev
```

UI check:

1. System Admin enables AI for a division
2. Division Monitor opens a live call
3. Start AI Monitoring → Processing + frame counters
4. Stop AI Monitoring → call remains Live

## 10. What is NOT implemented

- Face recognition / identification inference
- Fatigue detection
- Impairment / alcohol detection
- Behavior detection
- AWS Rekognition / S3 / Kinesis / SageMaker
- MediaMTX
- AI as a WebRTC peer
- Payment / billing

Phase 6 is stream consumption, frame extraction, lifecycle, entitlement, Docker, and observability only.
