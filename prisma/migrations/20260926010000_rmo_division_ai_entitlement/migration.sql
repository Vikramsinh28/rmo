-- CreateEnum
CREATE TYPE "AIEntitlementStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "AIPlan" AS ENUM ('BASIC', 'PREMIUM', 'ENTERPRISE');

-- CreateTable
CREATE TABLE "DivisionAIEntitlement" (
    "id" SERIAL NOT NULL,
    "divisionId" INTEGER NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "plan" "AIPlan" NOT NULL DEFAULT 'BASIC',
    "status" "AIEntitlementStatus" NOT NULL DEFAULT 'INACTIVE',
    "startsAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "faceIdentification" BOOLEAN NOT NULL DEFAULT false,
    "fatigueDetection" BOOLEAN NOT NULL DEFAULT false,
    "impairmentDetection" BOOLEAN NOT NULL DEFAULT false,
    "behaviorMonitoring" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DivisionAIEntitlement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DivisionAIEntitlement_divisionId_key" ON "DivisionAIEntitlement"("divisionId");

-- CreateIndex
CREATE INDEX "DivisionAIEntitlement_status_idx" ON "DivisionAIEntitlement"("status");

-- CreateIndex
CREATE INDEX "DivisionAIEntitlement_enabled_idx" ON "DivisionAIEntitlement"("enabled");

-- AddForeignKey
ALTER TABLE "DivisionAIEntitlement" ADD CONSTRAINT "DivisionAIEntitlement_divisionId_fkey" FOREIGN KEY ("divisionId") REFERENCES "Division"("id") ON DELETE CASCADE ON UPDATE CASCADE;
