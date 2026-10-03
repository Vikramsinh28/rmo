-- Flexible multi-form register question mappings.
-- Extends RegisterField with form/version/field/crew/duty context.
-- Register.formId becomes optional (legacy primary form).

ALTER TABLE "Register" ALTER COLUMN "formId" DROP NOT NULL;

-- Deduplicate register names within a division before unique index.
UPDATE "Register" r
SET "name" = r."name" || ' (' || r."id"::text || ')'
WHERE EXISTS (
  SELECT 1 FROM "Register" o
  WHERE o."divisionId" = r."divisionId"
    AND o."name" = r."name"
    AND o."id" < r."id"
);

CREATE UNIQUE INDEX IF NOT EXISTS "Register_divisionId_name_key" ON "Register"("divisionId", "name");

ALTER TABLE "RegisterField"
  ADD COLUMN IF NOT EXISTS "formId" INTEGER,
  ADD COLUMN IF NOT EXISTS "formVersionId" INTEGER,
  ADD COLUMN IF NOT EXISTS "fieldId" TEXT,
  ADD COLUMN IF NOT EXISTS "crewTypeId" INTEGER,
  ADD COLUMN IF NOT EXISTS "dutyTypeId" INTEGER;

-- Backfill from parent register + published version + schema field id/key.
UPDATE "RegisterField" rf
SET
  "formId" = COALESCE(rf."formId", r."formId"),
  "formVersionId" = COALESCE(
    rf."formVersionId",
    f."currentVersionId",
    (
      SELECT fv."id"
      FROM "FormVersion" fv
      WHERE fv."formId" = r."formId"
      ORDER BY fv."versionNumber" DESC
      LIMIT 1
    )
  ),
  "fieldId" = COALESCE(rf."fieldId", rf."fieldKey"),
  "crewTypeId" = COALESCE(rf."crewTypeId", f."crewTypeId"),
  "dutyTypeId" = COALESCE(rf."dutyTypeId", f."dutyTypeId")
FROM "Register" r
LEFT JOIN "Form" f ON f."id" = r."formId"
WHERE rf."registerId" = r."id"
  AND (rf."formId" IS NULL OR rf."formVersionId" IS NULL OR rf."fieldId" IS NULL);

-- Drop rows that still cannot be resolved (orphan mappings).
DELETE FROM "RegisterField"
WHERE "formId" IS NULL OR "formVersionId" IS NULL OR "fieldId" IS NULL;

ALTER TABLE "RegisterField" ALTER COLUMN "formId" SET NOT NULL;
ALTER TABLE "RegisterField" ALTER COLUMN "formVersionId" SET NOT NULL;
ALTER TABLE "RegisterField" ALTER COLUMN "fieldId" SET NOT NULL;

DROP INDEX IF EXISTS "RegisterField_registerId_fieldKey_key";
CREATE UNIQUE INDEX "RegisterField_registerId_formVersionId_fieldId_key"
  ON "RegisterField"("registerId", "formVersionId", "fieldId");

CREATE INDEX IF NOT EXISTS "RegisterField_formId_idx" ON "RegisterField"("formId");
CREATE INDEX IF NOT EXISTS "RegisterField_formVersionId_idx" ON "RegisterField"("formVersionId");
CREATE INDEX IF NOT EXISTS "RegisterField_crewTypeId_idx" ON "RegisterField"("crewTypeId");
CREATE INDEX IF NOT EXISTS "RegisterField_dutyTypeId_idx" ON "RegisterField"("dutyTypeId");

ALTER TABLE "RegisterField"
  ADD CONSTRAINT "RegisterField_formId_fkey"
  FOREIGN KEY ("formId") REFERENCES "Form"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "RegisterField"
  ADD CONSTRAINT "RegisterField_formVersionId_fkey"
  FOREIGN KEY ("formVersionId") REFERENCES "FormVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "RegisterField"
  ADD CONSTRAINT "RegisterField_crewTypeId_fkey"
  FOREIGN KEY ("crewTypeId") REFERENCES "CrewType"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "RegisterField"
  ADD CONSTRAINT "RegisterField_dutyTypeId_fkey"
  FOREIGN KEY ("dutyTypeId") REFERENCES "DutyType"("id") ON DELETE SET NULL ON UPDATE CASCADE;
