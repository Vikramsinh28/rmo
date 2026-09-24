-- CreateEnum
CREATE TYPE "LobbyRoomStatus" AS ENUM ('ACTIVE', 'DISABLED');

-- CreateEnum
CREATE TYPE "LobbyPresence" AS ENUM ('ONLINE', 'OFFLINE', 'CONNECTING');

-- CreateEnum
CREATE TYPE "LobbyCallStatus" AS ENUM ('RINGING', 'CONNECTED', 'ENDED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "CallConnection" AS ENUM ('IDLE', 'CONNECTED', 'RECONNECTING', 'DISCONNECTED');

-- CreateEnum
CREATE TYPE "ParticipantType" AS ENUM ('DIVISION_MONITOR', 'LOBBY_USER', 'CREW_MEMBER');

-- CreateEnum
CREATE TYPE "ParticipantStatus" AS ENUM ('JOINED', 'LEFT');

-- CreateEnum
CREATE TYPE "RecordingStatus" AS ENUM ('RECORDING', 'COMPLETED', 'FAILED');

-- CreateTable
CREATE TABLE "LobbyRoom" (
    "id" SERIAL NOT NULL,
    "lobbyId" INTEGER NOT NULL,
    "roomKey" TEXT NOT NULL,
    "status" "LobbyRoomStatus" NOT NULL DEFAULT 'ACTIVE',
    "presence" "LobbyPresence" NOT NULL DEFAULT 'OFFLINE',
    "lastSeenAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LobbyRoom_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LobbyCall" (
    "id" SERIAL NOT NULL,
    "roomId" INTEGER NOT NULL,
    "lobbyId" INTEGER NOT NULL,
    "divisionId" INTEGER NOT NULL,
    "monitorUserId" INTEGER NOT NULL,
    "status" "LobbyCallStatus" NOT NULL DEFAULT 'RINGING',
    "connection" "CallConnection" NOT NULL DEFAULT 'IDLE',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acceptedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "endedById" INTEGER,
    "endReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LobbyCall_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RoomParticipant" (
    "id" SERIAL NOT NULL,
    "roomId" INTEGER NOT NULL,
    "callId" INTEGER NOT NULL,
    "userId" INTEGER,
    "crewEnrollmentId" INTEGER,
    "participantType" "ParticipantType" NOT NULL,
    "status" "ParticipantStatus" NOT NULL DEFAULT 'JOINED',
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leftAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RoomParticipant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecordingSegment" (
    "id" SERIAL NOT NULL,
    "lobbyCallId" INTEGER NOT NULL,
    "roomId" INTEGER NOT NULL,
    "lobbyId" INTEGER NOT NULL,
    "startedById" INTEGER NOT NULL,
    "stoppedById" INTEGER,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "stoppedAt" TIMESTAMP(3),
    "duration" INTEGER,
    "status" "RecordingStatus" NOT NULL DEFAULT 'RECORDING',
    "storageKey" TEXT,
    "fileSize" INTEGER,
    "failureReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RecordingSegment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LobbyRoom_lobbyId_key" ON "LobbyRoom"("lobbyId");

-- CreateIndex
CREATE UNIQUE INDEX "LobbyRoom_roomKey_key" ON "LobbyRoom"("roomKey");

-- CreateIndex
CREATE INDEX "LobbyRoom_status_idx" ON "LobbyRoom"("status");

-- CreateIndex
CREATE INDEX "LobbyRoom_presence_idx" ON "LobbyRoom"("presence");

-- CreateIndex
CREATE INDEX "LobbyCall_roomId_idx" ON "LobbyCall"("roomId");

-- CreateIndex
CREATE INDEX "LobbyCall_lobbyId_status_idx" ON "LobbyCall"("lobbyId", "status");

-- CreateIndex
CREATE INDEX "LobbyCall_divisionId_status_idx" ON "LobbyCall"("divisionId", "status");

-- CreateIndex
CREATE INDEX "LobbyCall_monitorUserId_idx" ON "LobbyCall"("monitorUserId");

-- CreateIndex
CREATE INDEX "LobbyCall_startedAt_idx" ON "LobbyCall"("startedAt");

-- One open call per lobby. A reconnect must reuse this row.
CREATE UNIQUE INDEX "LobbyCall_one_open_per_lobby"
ON "LobbyCall"("lobbyId")
WHERE "status" IN ('RINGING', 'CONNECTED');

-- CreateIndex
CREATE INDEX "RoomParticipant_callId_status_idx" ON "RoomParticipant"("callId", "status");

-- CreateIndex
CREATE INDEX "RoomParticipant_roomId_idx" ON "RoomParticipant"("roomId");

-- CreateIndex
CREATE INDEX "RoomParticipant_userId_idx" ON "RoomParticipant"("userId");

-- CreateIndex
CREATE INDEX "RoomParticipant_crewEnrollmentId_idx" ON "RoomParticipant"("crewEnrollmentId");

-- CreateIndex
CREATE INDEX "RecordingSegment_lobbyCallId_status_idx" ON "RecordingSegment"("lobbyCallId", "status");

-- CreateIndex
CREATE INDEX "RecordingSegment_lobbyId_idx" ON "RecordingSegment"("lobbyId");

-- CreateIndex
CREATE INDEX "RecordingSegment_startedAt_idx" ON "RecordingSegment"("startedAt");

-- One active recording segment per call. Stopping it does not end the call.
CREATE UNIQUE INDEX "RecordingSegment_one_open_per_call"
ON "RecordingSegment"("lobbyCallId")
WHERE "status" = 'RECORDING';

-- AddForeignKey
ALTER TABLE "LobbyRoom" ADD CONSTRAINT "LobbyRoom_lobbyId_fkey" FOREIGN KEY ("lobbyId") REFERENCES "Lobby"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LobbyCall" ADD CONSTRAINT "LobbyCall_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "LobbyRoom"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LobbyCall" ADD CONSTRAINT "LobbyCall_lobbyId_fkey" FOREIGN KEY ("lobbyId") REFERENCES "Lobby"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LobbyCall" ADD CONSTRAINT "LobbyCall_divisionId_fkey" FOREIGN KEY ("divisionId") REFERENCES "Division"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LobbyCall" ADD CONSTRAINT "LobbyCall_monitorUserId_fkey" FOREIGN KEY ("monitorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LobbyCall" ADD CONSTRAINT "LobbyCall_endedById_fkey" FOREIGN KEY ("endedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoomParticipant" ADD CONSTRAINT "RoomParticipant_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "LobbyRoom"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoomParticipant" ADD CONSTRAINT "RoomParticipant_callId_fkey" FOREIGN KEY ("callId") REFERENCES "LobbyCall"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoomParticipant" ADD CONSTRAINT "RoomParticipant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoomParticipant" ADD CONSTRAINT "RoomParticipant_crewEnrollmentId_fkey" FOREIGN KEY ("crewEnrollmentId") REFERENCES "CrewEnrollment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecordingSegment" ADD CONSTRAINT "RecordingSegment_lobbyCallId_fkey" FOREIGN KEY ("lobbyCallId") REFERENCES "LobbyCall"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecordingSegment" ADD CONSTRAINT "RecordingSegment_lobbyId_fkey" FOREIGN KEY ("lobbyId") REFERENCES "Lobby"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecordingSegment" ADD CONSTRAINT "RecordingSegment_startedById_fkey" FOREIGN KEY ("startedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecordingSegment" ADD CONSTRAINT "RecordingSegment_stoppedById_fkey" FOREIGN KEY ("stoppedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
