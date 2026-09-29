-- CreateEnum
CREATE TYPE "MasterStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "QuestionStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- AlterEnum
ALTER TYPE "FormPurpose" ADD VALUE 'CREW_REGISTRATION';

-- AlterTable User
ALTER TABLE "User" ADD COLUMN "crewTypeId" INTEGER;

-- AlterTable Submission
ALTER TABLE "Submission" ADD COLUMN "crewTypeId" INTEGER;
ALTER TABLE "Submission" ADD COLUMN "crewTypeName" TEXT;
ALTER TABLE "Submission" ADD COLUMN "dutyTypeId" INTEGER;
ALTER TABLE "Submission" ADD COLUMN "dutyTypeName" TEXT;

-- CreateTable CrewType
CREATE TABLE "CrewType" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "status" "MasterStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CrewType_pkey" PRIMARY KEY ("id")
);

-- CreateTable DutyType
CREATE TABLE "DutyType" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "status" "MasterStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DutyType_pkey" PRIMARY KEY ("id")
);

-- CreateTable RegisterType
CREATE TABLE "RegisterType" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "status" "MasterStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RegisterType_pkey" PRIMARY KEY ("id")
);

-- CreateTable Question
CREATE TABLE "Question" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "required" BOOLEAN NOT NULL DEFAULT false,
    "helpText" TEXT NOT NULL DEFAULT '',
    "options" JSONB NOT NULL DEFAULT '[]',
    "status" "QuestionStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Question_pkey" PRIMARY KEY ("id")
);

-- CreateTable QuestionConfiguration
CREATE TABLE "QuestionConfiguration" (
    "id" SERIAL NOT NULL,
    "questionId" INTEGER NOT NULL,
    "crewTypeId" INTEGER NOT NULL,
    "dutyTypeId" INTEGER NOT NULL,
    "formVersionId" INTEGER NOT NULL,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "required" BOOLEAN NOT NULL DEFAULT false,
    "status" "QuestionStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QuestionConfiguration_pkey" PRIMARY KEY ("id")
);

-- CreateTable QuestionRegister
CREATE TABLE "QuestionRegister" (
    "id" SERIAL NOT NULL,
    "questionId" INTEGER NOT NULL,
    "registerTypeId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QuestionRegister_pkey" PRIMARY KEY ("id")
);

-- CreateTable SubmissionAnswer
CREATE TABLE "SubmissionAnswer" (
    "id" SERIAL NOT NULL,
    "submissionId" INTEGER NOT NULL,
    "questionId" INTEGER NOT NULL,
    "answer" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SubmissionAnswer_pkey" PRIMARY KEY ("id")
);

-- Indexes and uniques
CREATE UNIQUE INDEX "CrewType_code_key" ON "CrewType"("code");
CREATE INDEX "CrewType_status_idx" ON "CrewType"("status");

CREATE UNIQUE INDEX "DutyType_code_key" ON "DutyType"("code");
CREATE INDEX "DutyType_status_idx" ON "DutyType"("status");

CREATE UNIQUE INDEX "RegisterType_code_key" ON "RegisterType"("code");
CREATE INDEX "RegisterType_status_idx" ON "RegisterType"("status");

CREATE UNIQUE INDEX "Question_code_key" ON "Question"("code");
CREATE INDEX "Question_status_idx" ON "Question"("status");

CREATE UNIQUE INDEX "QuestionConfiguration_questionId_crewTypeId_dutyTypeId_formVersionId_key" ON "QuestionConfiguration"("questionId", "crewTypeId", "dutyTypeId", "formVersionId");
CREATE INDEX "QuestionConfiguration_crewTypeId_idx" ON "QuestionConfiguration"("crewTypeId");
CREATE INDEX "QuestionConfiguration_dutyTypeId_idx" ON "QuestionConfiguration"("dutyTypeId");
CREATE INDEX "QuestionConfiguration_formVersionId_idx" ON "QuestionConfiguration"("formVersionId");
CREATE INDEX "QuestionConfiguration_crewTypeId_dutyTypeId_formVersionId_idx" ON "QuestionConfiguration"("crewTypeId", "dutyTypeId", "formVersionId");
CREATE INDEX "QuestionConfiguration_status_idx" ON "QuestionConfiguration"("status");

CREATE UNIQUE INDEX "QuestionRegister_questionId_registerTypeId_key" ON "QuestionRegister"("questionId", "registerTypeId");
CREATE INDEX "QuestionRegister_questionId_idx" ON "QuestionRegister"("questionId");
CREATE INDEX "QuestionRegister_registerTypeId_idx" ON "QuestionRegister"("registerTypeId");

CREATE UNIQUE INDEX "SubmissionAnswer_submissionId_questionId_key" ON "SubmissionAnswer"("submissionId", "questionId");
CREATE INDEX "SubmissionAnswer_submissionId_idx" ON "SubmissionAnswer"("submissionId");
CREATE INDEX "SubmissionAnswer_questionId_idx" ON "SubmissionAnswer"("questionId");

CREATE INDEX "User_crewTypeId_idx" ON "User"("crewTypeId");
CREATE INDEX "Submission_crewTypeId_idx" ON "Submission"("crewTypeId");
CREATE INDEX "Submission_dutyTypeId_idx" ON "Submission"("dutyTypeId");
CREATE INDEX "Submission_submittedAt_idx" ON "Submission"("submittedAt");
CREATE INDEX "Submission_crewTypeId_dutyTypeId_idx" ON "Submission"("crewTypeId", "dutyTypeId");
CREATE INDEX "Submission_divisionId_crewTypeId_submittedAt_idx" ON "Submission"("divisionId", "crewTypeId", "submittedAt");

-- Foreign keys
ALTER TABLE "User" ADD CONSTRAINT "User_crewTypeId_fkey" FOREIGN KEY ("crewTypeId") REFERENCES "CrewType"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "CrewType" ADD CONSTRAINT "CrewType_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "DutyType" ADD CONSTRAINT "DutyType_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "RegisterType" ADD CONSTRAINT "RegisterType_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Question" ADD CONSTRAINT "Question_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "QuestionConfiguration" ADD CONSTRAINT "QuestionConfiguration_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "Question"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "QuestionConfiguration" ADD CONSTRAINT "QuestionConfiguration_crewTypeId_fkey" FOREIGN KEY ("crewTypeId") REFERENCES "CrewType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "QuestionConfiguration" ADD CONSTRAINT "QuestionConfiguration_dutyTypeId_fkey" FOREIGN KEY ("dutyTypeId") REFERENCES "DutyType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "QuestionConfiguration" ADD CONSTRAINT "QuestionConfiguration_formVersionId_fkey" FOREIGN KEY ("formVersionId") REFERENCES "FormVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "QuestionRegister" ADD CONSTRAINT "QuestionRegister_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "Question"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "QuestionRegister" ADD CONSTRAINT "QuestionRegister_registerTypeId_fkey" FOREIGN KEY ("registerTypeId") REFERENCES "RegisterType"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Submission" ADD CONSTRAINT "Submission_crewTypeId_fkey" FOREIGN KEY ("crewTypeId") REFERENCES "CrewType"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Submission" ADD CONSTRAINT "Submission_dutyTypeId_fkey" FOREIGN KEY ("dutyTypeId") REFERENCES "DutyType"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "SubmissionAnswer" ADD CONSTRAINT "SubmissionAnswer_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "Submission"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SubmissionAnswer" ADD CONSTRAINT "SubmissionAnswer_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "Question"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
