-- Public lobby QR tokens + submission source tracking.

CREATE TYPE "SubmissionSource" AS ENUM ('AUTHENTICATED', 'PUBLIC_QR');

ALTER TABLE "Lobby"
  ADD COLUMN "publicToken" TEXT,
  ADD COLUMN "publicTokenRevokedAt" TIMESTAMP(3);

CREATE UNIQUE INDEX "Lobby_publicToken_key" ON "Lobby"("publicToken");
CREATE INDEX "Lobby_publicToken_idx" ON "Lobby"("publicToken");

ALTER TABLE "Submission"
  ADD COLUMN "source" "SubmissionSource" NOT NULL DEFAULT 'AUTHENTICATED',
  ADD COLUMN "publicReference" TEXT;

CREATE UNIQUE INDEX "Submission_publicReference_key" ON "Submission"("publicReference");
CREATE INDEX "Submission_source_idx" ON "Submission"("source");

-- Backfill active lobby tokens (non-guessable).
UPDATE "Lobby"
SET "publicToken" = 'RMO-LBY-' || substr(md5(random()::text || id::text || clock_timestamp()::text), 1, 24)
WHERE "publicToken" IS NULL;
