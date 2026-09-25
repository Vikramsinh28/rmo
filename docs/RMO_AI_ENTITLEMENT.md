# RMO Division AI Monitoring Entitlement

## What AI entitlement means

AI monitoring is a **paid, division-level capability**. Enabling it does not start any AI processing. It only records that a division is entitled to use future AI modules during live sessions.

Live video and audio between Division Monitor and Lobby User continue whether AI entitlement is on or off.

## Why it is division-level

A railway zone can contain many divisions. Commercial entitlement and rollout are decided per division (for example Ahmedabad enabled, Surat disabled). Every lobby and live session under that division inherits the same capability set.

## Who can manage it

| Role | Read | Write |
| --- | --- | --- |
| SYSTEM_ADMIN | All divisions | Enable/disable, plan, status, dates, feature flags |
| SUPER_ADMIN | All divisions (read only) | No |
| DIVISION_ADMIN | Own home division only | No |
| DIVISION_MONITOR | Own division / session capability | No |
| LOBBY_USER | Own lobby session capability | No |
| CREW_USER | No AI administration | No |

Write APIs are enforced on the server. Hiding UI controls is not sufficient.

## Feature flags

Each division entitlement stores independent flags:

- `faceIdentification`
- `fatigueDetection`
- `impairmentDetection`
- `behaviorMonitoring`

Plans (`BASIC`, `PREMIUM`, `ENTERPRISE`) are stored for future commercial packaging. Status is `ACTIVE` or `INACTIVE`.

## How live sessions consume capabilities

When a live session is opened, clients call:

- `GET /api/monitoring/ai` — capability for the authenticated user's home division
- `GET /api/monitoring/calls/:id/ai` — capability for that call's division

Response shape (conceptual):

```json
{
  "sessionId": 12,
  "divisionId": 3,
  "ai": {
    "enabled": true,
    "features": {
      "faceIdentification": true,
      "fatigueDetection": true,
      "potentialImpairment": false,
      "behaviorMonitoring": false
    }
  }
}
```

Field names in code use `impairmentDetection` to match the Prisma model. The UI labels it "Potential Impairment".

No AI worker, Rekognition call, or media analysis is started by these endpoints.

## How future AI services must use entitlement

All future AI APIs must call the centralized resolver in `src/services/internal/rmo/ai-entitlement.ts`:

- `getDivisionAICapabilities(divisionId)`
- `assertDivisionAIFeature(divisionId, feature)`

Do not scatter `if (division.aiEnabled)` checks. Flow:

```
authorization → division entitlement service → feature capability → allow/deny
```

## How expiry works

Effective availability is computed on every read:

1. Entitlement row must exist
2. `enabled === true`
3. `status === ACTIVE`
4. `startsAt` must be null or in the past
5. `expiresAt` must be null or in the future
6. Individual feature flags gate each module

An entitlement may remain `ACTIVE` in the database while the resolver returns unavailable because it has not started or has expired. Storage status is not auto-flipped by a scheduler in this phase.

## Admin APIs

- `GET /api/admin/divisions/:divisionId/ai`
- `PATCH /api/admin/divisions/:divisionId/ai`

System Admin changes are audited (`ai.entitlement.*`, `ai.feature.*`) via the existing `AuditLog` table. Passwords, tokens, and secrets are never logged.

## UI

- Divisions list shows AI Monitoring, Plan, AI Status, Expiry, and Manage AI / Enable AI
- `/divisions/[id]/ai` configures entitlement and feature flags
- Live monitor and lobby desk show an AI capability badge (configuration only)

## What is NOT implemented yet

- Face recognition / identification runtime
- Fatigue detection runtime
- Potential impairment detection runtime
- Behavior detection runtime
- AWS Rekognition or other AI SDKs
- Payment gateway / billing / invoices / subscription checkout

This phase is entitlement + authorization + UI + audit + live-session capability exposure only.
