# RMO Phase 4B — 24×7 lobby monitoring status

Local only. Railway Monitor, its database, its APIs, and its authentication were not changed. No production database or object storage is used.

## Architecture

A lobby has one persistent room. A division monitor calls that room. The lobby user accepts. Crew members join the open call. Recording is a separate interval on that call.

```text
Lobby
  └── LobbyRoom          persistent, one per lobby
        └── LobbyCall    long-lived monitor ↔ lobby connection
              ├── RoomParticipant
              │     ├── Division monitor
              │     ├── Lobby user
              │     └── Crew members
              └── RecordingSegment
                    ├── Recording 1
                    ├── Recording 2
                    └── Recording 3
```

The call is not a crew session. Crew members do not create, accept, reject, or end the call, and they do not start or stop recording. Stopping a recording does not end the call. Leaving the call as a crew member does not end it.

## Lobby room

`LobbyRoom` stores `lobbyId`, a stable `roomKey` (`lobby-{id}`), `status` (`ACTIVE` or `DISABLED`), device presence, and `lastSeenAt`. The room is created the first time that lobby is loaded for monitoring. It is not created per call. A disabled lobby, or a disabled room, cannot accept a new call. Historical calls stay in the database.

Device presence is separate from the call:

| Presence | Meaning |
| --- | --- |
| `ONLINE` | The lobby desk sent a heartbeat in the last 45 seconds |
| `CONNECTING` | The desk reported that it is coming online |
| `OFFLINE` | No recent heartbeat |

An online lobby can still have no call. A connected call can outlive a short offline blip. Presence going offline does not end the call.

## Lobby call

`LobbyCall` stores the room, lobby, division, and the monitor who placed the call. Status is `RINGING`, `CONNECTED`, `ENDED`, `FAILED`, or `CANCELLED`. Connection is stored separately as `IDLE`, `CONNECTED`, `RECONNECTING`, or `DISCONNECTED`.

| Step | Result |
| --- | --- |
| Monitor calls an active lobby in their division | `RINGING` |
| Lobby user accepts | `CONNECTED` |
| Lobby user rejects, or the monitor cancels while it is ringing | `CANCELLED` |
| Monitor or lobby user ends a connected call | `ENDED` |
| Temporary media loss | status stays `CONNECTED`, connection becomes `RECONNECTING`, then `CONNECTED` |
| Client reports an unrecoverable media failure | `FAILED` |

The interface also shows `IDLE` when there is no call. `CONNECTING` is the short period while the media client is joining. Those labels are not collapsed into one field.

There is at most one open call per lobby (`RINGING` or `CONNECTED`). If the same monitor calls again, the existing call is returned. A second call row is not created.

## Participants

`RoomParticipant` is a monitor, a lobby user, or a crew member. The monitor is added when the call is placed. The lobby user is added when they accept. Crew members join only while the call is `CONNECTED`, and only when their home lobby is that room's lobby. A crew member can leave. The call stays `CONNECTED`.

## Recording

`RecordingSegment` is the source of truth. `LobbyCall` has no recording boolean. A connected call can have many segments. Each segment is `RECORDING`, `COMPLETED`, or `FAILED`.

The monitor for that division can start a segment only while the call is `CONNECTED`, and can stop it later. The lobby user and crew cannot. One segment can be `RECORDING` at a time. After it is stopped, another can start. A failed start leaves the call `CONNECTED` and the screen says "Recording could not be started."

The database stores `storageKey`, `fileSize`, `duration`, timestamps, and status. The bytes are not stored in PostgreSQL. The monitor's Record button captures this browser tab (the call picture, kiosk, and cameras) and mixes the call audio. Stopping the recording uploads that file to `storage/recordings/{id}.webm` or `.mp4` (gitignored) and leaves the call connected. APIs never return the storage key or a filesystem path. Play and download use `GET /api/monitoring/recordings/:id/file` after an authorization check.

If the media upload does not happen, stop still completes the segment with a JSON fallback and the call stays connected. A failed start does the same.

## Reconnection

A lost browser or network link is not an end. The client reports `RECONNECTING`, then `CONNECTED`, on the same call id and the same `roomKey`. Asking to call the lobby again returns that same open call. Sending `FAILED` without `unrecoverable: true` is rejected and the call stays `CONNECTED`.

The interface does not mark a call failed on its own. `FAILED` is only for an explicit unrecoverable report. No automatic timeout ends a long call. A dropped video peer reconnects on the same call.

## Authorization

The server derives scope from the signed-in user. Client-supplied division, lobby, and monitor ids are not trusted.

| Role | Access |
| --- | --- |
| `DIVISION_MONITOR` | Call, cancel, end, record, and read lobbies, calls, history, and recordings in their home division |
| `LOBBY_USER` | Heartbeat, accept, reject, and end calls for their own lobby. Own microphone and camera. No recording control |
| `CREW_USER` | Join and leave the connected call for their own lobby. Own microphone and camera |
| `DIVISION_ADMIN` | Read their division, including history and recordings. The camera workspace stays on `/monitoring`. They do not place calls |
| `SYSTEM_ADMIN` | Read every division, with zone, division, and lobby filters. They do not control an active call |
| `SUPER_ADMIN` | No live-monitoring permission |

A monitor whose division does not match the lobby receives 403. A lobby user or crew member from another lobby receives 403.

## APIs

All of these require an authenticated session.

| Method | Path |
| --- | --- |
| GET | `/api/monitoring/lobbies` |
| GET | `/api/monitoring/lobbies/:id` |
| POST | `/api/monitoring/lobbies/:id/call` |
| POST | `/api/monitoring/calls/:id/accept` |
| POST | `/api/monitoring/calls/:id/reject` |
| POST | `/api/monitoring/calls/:id/end` |
| GET | `/api/monitoring/calls/:id` |
| POST | `/api/monitoring/calls/:id/connection` |
| POST | `/api/monitoring/calls/:id/token` |
| GET, POST | `/api/monitoring/calls/:id/participants` |
| POST | `/api/monitoring/calls/:id/participants/:participantId/leave` |
| POST | `/api/monitoring/calls/:id/recording/start` |
| POST | `/api/monitoring/calls/:id/recording/:recordingId/media` |
| POST | `/api/monitoring/calls/:id/recording/:recordingId/stop` |
| GET | `/api/monitoring/calls/:id/recordings` |
| GET | `/api/monitoring/recordings` |
| GET | `/api/monitoring/recordings/:id` |
| GET | `/api/monitoring/recordings/:id/file` |
| GET | `/api/monitoring/history` |
| GET | `/api/monitoring/events` |
| GET | `/api/monitoring/ice` |
| POST | `/api/monitoring/presence` |

## Real-time events

Kostra had no Socket.IO server. Call events use a server-sent stream at `/api/monitoring/events`. The browser also refreshes every 12 seconds so a restarted process does not leave the screen stale. The local bus is in-process. A production deployment with more than one Node process needs a shared broker for the same event names.

Events: `lobby.call.incoming`, `lobby.call.accepted`, `lobby.call.rejected`, `lobby.call.connected`, `lobby.call.ended`, `participant.joined`, `participant.left`, `recording.started`, `recording.stopped`, `recording.failed`, `connection.reconnecting`, `connection.reconnected`, `connection.failed`.

Audit actions use the same names for calls, participants, and recordings. The audit row stores the actor, lobby, division, call id, and recording id. Passwords, hashes, tokens, and cookies are not written.

## Media

The live lobby call matches the existing monitor and lobby apps. The server only forwards the session description. The browsers connect directly.

The division monitor is the caller. After the lobby accepts, each side publishes its camera and microphone and receives the other side's camera and microphone. The remote camera fills the picture, and the local camera is the small preview. Audio plays with the video.

Signaling is `GET` and `POST /api/monitoring/calls/:id/signal` with `offer`, `answer`, and `ice`. Only a joined participant on a connected call can use it. A dropped peer asks the monitor to send a new offer. That does not end the call. ICE uses the same STUN and DigitalOcean TURN server as the railway monitoring apps (`turn.railwaymonitor.in:3478`, UDP and TCP). `GET /api/monitoring/ice` gives that list to a signed-in monitor, lobby user, or crew member. If a direct path fails across networks, the monitor retries with TURN relay only. A temporary disconnect stays on the same call.

Fixed CCTV cameras stay on the camera workspace. An HLS or file address plays in a video element. A kiosk web page stays in a frame. Those feeds are not part of the lobby call.

LiveKit remains in local Docker for a later server-side recorder. The call picture does not depend on it.

## Docker

```bash
docker compose up -d
```

That starts local Postgres on `127.0.0.1:5434` and the local LiveKit server. It does not connect to Railway or any other remote host.

## Screens

| Path | Who |
| --- | --- |
| `/monitoring` | Division monitor and system admin see the lobby call board. Division admin still sees the camera workspace |
| `/monitoring/cameras` | Existing camera and kiosk workspace |
| `/monitoring/desk` | Lobby user incoming call, and crew join / leave |
| `/monitoring/calls/:id` | Live call, mute, recording, end |
| `/monitoring/history` | Call history |
| `/monitoring/recordings` | Recording history, download, and play when a media file exists |

Ending a call asks for confirmation. The lobby user's home path is `/monitoring/desk`.

## Local test procedure

This is the long-running check, not a 30-second demo:

1. Sign in as the lobby user and confirm the desk is online.
2. Sign in as the division monitor, call that lobby, and accept on the desk.
3. Leave the call connected.
4. Join a crew member, then another. Confirm both are participants and there is still one call.
5. Remove one crew member. Confirm the call stays connected.
6. Start recording, stop it, start again, and stop again.
7. Disconnect the monitor's network or close the media client. Confirm the same call id returns to connected. Do not create a second room or a second open call.
8. End the call from the monitor or the lobby user.
9. Confirm call history and both recording segments.

`src/test/api/rmo/lobby-monitoring.test.ts` covers the room, cross-division 403s, accept, reject, end, multiple crew, recording segments, recording failure, and reconnect. `scripts/phase4b-browser-check.mjs` walks the same roles in the browser.

`RMO_RECORDING_FAIL=1` forces the next start to fail without ending the call. It is a local test switch.

## Known limitations

- LiveKit Egress is not in the local compose file. Recording metadata and a local segment file are real. The media bytes of the room are captured when egress is pointed at private storage later.
- The event bus is in-process. Run one Next.js server locally.
- System admin can read calls and cannot accept, reject, record, or end them.
- Face recognition, alcohol or impairment detection, behavior detection, and safety events are not part of this phase.

## Future AI

A later monitor can subscribe to the same LiveKit room or read the stored recording. That consumer is not built here. The future check is whether a crew member appears impaired during the monitoring call. It is not bottle detection, and it is not this phase.
