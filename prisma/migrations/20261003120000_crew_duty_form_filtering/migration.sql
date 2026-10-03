-- CrewType / DutyType catalogs and form filtering.
-- Existing Form/Submission rows keep NULL crewTypeId/dutyTypeId (legacy admin-only forms).
-- Admins must assign crewType + dutyType for a form to become crew-facing.

CREATE TABLE "CrewType" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CrewType_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DutyType" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DutyType_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CrewType_code_key" ON "CrewType"("code");
CREATE INDEX "CrewType_isActive_idx" ON "CrewType"("isActive");
CREATE INDEX "CrewType_sortOrder_idx" ON "CrewType"("sortOrder");

CREATE UNIQUE INDEX "DutyType_code_key" ON "DutyType"("code");
CREATE INDEX "DutyType_isActive_idx" ON "DutyType"("isActive");
CREATE INDEX "DutyType_sortOrder_idx" ON "DutyType"("sortOrder");

ALTER TABLE "User" ADD COLUMN "crewTypeId" INTEGER;
CREATE INDEX "User_crewTypeId_idx" ON "User"("crewTypeId");
ALTER TABLE "User" ADD CONSTRAINT "User_crewTypeId_fkey" FOREIGN KEY ("crewTypeId") REFERENCES "CrewType"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Form" ADD COLUMN "crewTypeId" INTEGER;
ALTER TABLE "Form" ADD COLUMN "dutyTypeId" INTEGER;
CREATE INDEX "Form_crewTypeId_idx" ON "Form"("crewTypeId");
CREATE INDEX "Form_dutyTypeId_idx" ON "Form"("dutyTypeId");
CREATE INDEX "Form_divisionId_crewTypeId_dutyTypeId_idx" ON "Form"("divisionId", "crewTypeId", "dutyTypeId");
ALTER TABLE "Form" ADD CONSTRAINT "Form_crewTypeId_fkey" FOREIGN KEY ("crewTypeId") REFERENCES "CrewType"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Form" ADD CONSTRAINT "Form_dutyTypeId_fkey" FOREIGN KEY ("dutyTypeId") REFERENCES "DutyType"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- One published form per division + crew type + duty type.
CREATE UNIQUE INDEX "Form_published_division_crew_duty_uidx"
ON "Form" ("divisionId", "crewTypeId", "dutyTypeId")
WHERE "status" = 'PUBLISHED'
  AND "crewTypeId" IS NOT NULL
  AND "dutyTypeId" IS NOT NULL
  AND "divisionId" IS NOT NULL;

ALTER TABLE "Submission" ADD COLUMN "crewTypeId" INTEGER;
ALTER TABLE "Submission" ADD COLUMN "dutyTypeId" INTEGER;
CREATE INDEX "Submission_crewTypeId_idx" ON "Submission"("crewTypeId");
CREATE INDEX "Submission_dutyTypeId_idx" ON "Submission"("dutyTypeId");
ALTER TABLE "Submission" ADD CONSTRAINT "Submission_crewTypeId_fkey" FOREIGN KEY ("crewTypeId") REFERENCES "CrewType"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Submission" ADD CONSTRAINT "Submission_dutyTypeId_fkey" FOREIGN KEY ("dutyTypeId") REFERENCES "DutyType"("id") ON DELETE SET NULL ON UPDATE CASCADE;
