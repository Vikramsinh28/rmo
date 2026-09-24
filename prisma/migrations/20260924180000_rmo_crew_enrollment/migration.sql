-- CreateEnum
CREATE TYPE "FormPurpose" AS ENUM ('GENERAL', 'CREW_ENROLLMENT');

-- CreateEnum
CREATE TYPE "EnrollmentStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');

-- AlterTable
ALTER TABLE "Form" ADD COLUMN "purpose" "FormPurpose" NOT NULL DEFAULT 'GENERAL';

-- CreateIndex
CREATE INDEX "Form_purpose_idx" ON "Form"("purpose");

-- CreateTable
CREATE TABLE "CrewEnrollment" (
    "id" SERIAL NOT NULL,
    "publicCode" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "staffNumber" TEXT NOT NULL,
    "loginId" TEXT NOT NULL,
    "requestedZoneId" INTEGER NOT NULL,
    "requestedDivisionId" INTEGER NOT NULL,
    "requestedLobbyId" INTEGER NOT NULL,
    "formId" INTEGER,
    "formVersionId" INTEGER,
    "formSubmissionId" INTEGER,
    "answers" JSONB NOT NULL,
    "status" "EnrollmentStatus" NOT NULL DEFAULT 'PENDING',
    "passwordHash" TEXT NOT NULL,
    "reviewedById" INTEGER,
    "reviewedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "createdUserId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CrewEnrollment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CrewEnrollment_publicCode_key" ON "CrewEnrollment"("publicCode");

-- CreateIndex
CREATE UNIQUE INDEX "CrewEnrollment_formSubmissionId_key" ON "CrewEnrollment"("formSubmissionId");

-- CreateIndex
CREATE UNIQUE INDEX "CrewEnrollment_createdUserId_key" ON "CrewEnrollment"("createdUserId");

-- CreateIndex
CREATE INDEX "CrewEnrollment_status_idx" ON "CrewEnrollment"("status");

-- CreateIndex
CREATE INDEX "CrewEnrollment_requestedDivisionId_status_idx" ON "CrewEnrollment"("requestedDivisionId", "status");

-- CreateIndex
CREATE INDEX "CrewEnrollment_email_idx" ON "CrewEnrollment"("email");

-- CreateIndex
CREATE INDEX "CrewEnrollment_loginId_idx" ON "CrewEnrollment"("loginId");

-- CreateIndex
CREATE INDEX "CrewEnrollment_createdAt_idx" ON "CrewEnrollment"("createdAt");

-- One pending application per email or login id.
CREATE UNIQUE INDEX "CrewEnrollment_pending_email_key" ON "CrewEnrollment"("email") WHERE "status" = 'PENDING';

CREATE UNIQUE INDEX "CrewEnrollment_pending_login_key" ON "CrewEnrollment"("loginId") WHERE "status" = 'PENDING';

-- AddForeignKey
ALTER TABLE "CrewEnrollment" ADD CONSTRAINT "CrewEnrollment_requestedZoneId_fkey" FOREIGN KEY ("requestedZoneId") REFERENCES "Zone"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrewEnrollment" ADD CONSTRAINT "CrewEnrollment_requestedDivisionId_fkey" FOREIGN KEY ("requestedDivisionId") REFERENCES "Division"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrewEnrollment" ADD CONSTRAINT "CrewEnrollment_requestedLobbyId_fkey" FOREIGN KEY ("requestedLobbyId") REFERENCES "Lobby"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrewEnrollment" ADD CONSTRAINT "CrewEnrollment_formId_fkey" FOREIGN KEY ("formId") REFERENCES "Form"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrewEnrollment" ADD CONSTRAINT "CrewEnrollment_formVersionId_fkey" FOREIGN KEY ("formVersionId") REFERENCES "FormVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrewEnrollment" ADD CONSTRAINT "CrewEnrollment_formSubmissionId_fkey" FOREIGN KEY ("formSubmissionId") REFERENCES "Submission"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrewEnrollment" ADD CONSTRAINT "CrewEnrollment_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrewEnrollment" ADD CONSTRAINT "CrewEnrollment_createdUserId_fkey" FOREIGN KEY ("createdUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
