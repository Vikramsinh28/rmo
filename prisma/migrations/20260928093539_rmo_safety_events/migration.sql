-- CreateEnum
CREATE TYPE "SafetyEventSeverity" AS ENUM ('ELEVATED_INDICATORS', 'HIGH_INDICATORS');

-- CreateEnum
CREATE TYPE "SafetyEventStatus" AS ENUM ('PENDING_REVIEW', 'CONFIRMED', 'DISMISSED', 'INCONCLUSIVE');

-- CreateEnum
CREATE TYPE "SafetyEventOutcome" AS ENUM ('IMPAIRMENT_CONFIRMED', 'NOT_IMPAIRED', 'OTHER_CAUSE', 'INSUFFICIENT_VIDEO');

-- CreateTable
CREATE TABLE "SafetyEvent" (
    "id" SERIAL NOT NULL,
    "divisionId" INTEGER NOT NULL,
    "lobbyId" INTEGER NOT NULL,
    "lobbyCallId" INTEGER NOT NULL,
    "aiJobId" INTEGER NOT NULL,
    "episodeKey" TEXT NOT NULL,
    "trackId" TEXT NOT NULL,
    "subjectUserId" INTEGER,
    "subjectName" TEXT,
    "identityConfidence" DOUBLE PRECISION,
    "severity" "SafetyEventSeverity" NOT NULL,
    "peakScore" DOUBLE PRECISION NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "evidence" JSONB NOT NULL,
    "signalGroups" JSONB NOT NULL,
    "featureWindow" JSONB NOT NULL,
    "modelVersion" TEXT NOT NULL,
    "status" "SafetyEventStatus" NOT NULL DEFAULT 'PENDING_REVIEW',
    "startedAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3),
    "reviewOutcome" "SafetyEventOutcome",
    "reviewNote" TEXT,
    "breathTestPerformed" BOOLEAN,
    "breathTestPositive" BOOLEAN,
    "reviewedById" INTEGER,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SafetyEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SafetyEvent_divisionId_status_idx" ON "SafetyEvent"("divisionId", "status");

-- CreateIndex
CREATE INDEX "SafetyEvent_lobbyId_idx" ON "SafetyEvent"("lobbyId");

-- CreateIndex
CREATE INDEX "SafetyEvent_lobbyCallId_idx" ON "SafetyEvent"("lobbyCallId");

-- CreateIndex
CREATE INDEX "SafetyEvent_subjectUserId_idx" ON "SafetyEvent"("subjectUserId");

-- CreateIndex
CREATE INDEX "SafetyEvent_startedAt_idx" ON "SafetyEvent"("startedAt");

-- CreateIndex
CREATE UNIQUE INDEX "SafetyEvent_aiJobId_episodeKey_key" ON "SafetyEvent"("aiJobId", "episodeKey");

-- AddForeignKey
ALTER TABLE "SafetyEvent" ADD CONSTRAINT "SafetyEvent_divisionId_fkey" FOREIGN KEY ("divisionId") REFERENCES "Division"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SafetyEvent" ADD CONSTRAINT "SafetyEvent_lobbyId_fkey" FOREIGN KEY ("lobbyId") REFERENCES "Lobby"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SafetyEvent" ADD CONSTRAINT "SafetyEvent_lobbyCallId_fkey" FOREIGN KEY ("lobbyCallId") REFERENCES "LobbyCall"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SafetyEvent" ADD CONSTRAINT "SafetyEvent_aiJobId_fkey" FOREIGN KEY ("aiJobId") REFERENCES "AIProcessingJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SafetyEvent" ADD CONSTRAINT "SafetyEvent_subjectUserId_fkey" FOREIGN KEY ("subjectUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SafetyEvent" ADD CONSTRAINT "SafetyEvent_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
