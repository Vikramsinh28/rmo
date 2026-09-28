-- CreateEnum
CREATE TYPE "AIProcessingStatus" AS ENUM ('STARTING', 'RUNNING', 'STOPPING', 'STOPPED', 'ERROR');

-- CreateTable
CREATE TABLE "AIProcessingJob" (
    "id" SERIAL NOT NULL,
    "lobbyCallId" INTEGER NOT NULL,
    "divisionId" INTEGER NOT NULL,
    "lobbyId" INTEGER NOT NULL,
    "startedById" INTEGER NOT NULL,
    "status" "AIProcessingStatus" NOT NULL DEFAULT 'STARTING',
    "framesReceived" INTEGER NOT NULL DEFAULT 0,
    "framesProcessed" INTEGER NOT NULL DEFAULT 0,
    "processingFps" DOUBLE PRECISION,
    "lastFrameAt" TIMESTAMP(3),
    "errorMessage" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "stoppedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AIProcessingJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AIProcessingJob_lobbyCallId_status_idx" ON "AIProcessingJob"("lobbyCallId", "status");

-- CreateIndex
CREATE INDEX "AIProcessingJob_divisionId_status_idx" ON "AIProcessingJob"("divisionId", "status");

-- CreateIndex
CREATE INDEX "AIProcessingJob_lobbyId_idx" ON "AIProcessingJob"("lobbyId");

-- AddForeignKey
ALTER TABLE "AIProcessingJob" ADD CONSTRAINT "AIProcessingJob_lobbyCallId_fkey" FOREIGN KEY ("lobbyCallId") REFERENCES "LobbyCall"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AIProcessingJob" ADD CONSTRAINT "AIProcessingJob_divisionId_fkey" FOREIGN KEY ("divisionId") REFERENCES "Division"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AIProcessingJob" ADD CONSTRAINT "AIProcessingJob_lobbyId_fkey" FOREIGN KEY ("lobbyId") REFERENCES "Lobby"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AIProcessingJob" ADD CONSTRAINT "AIProcessingJob_startedById_fkey" FOREIGN KEY ("startedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
