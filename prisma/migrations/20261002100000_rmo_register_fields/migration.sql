-- CreateTable
CREATE TABLE "RegisterField" (
    "id" SERIAL NOT NULL,
    "registerId" INTEGER NOT NULL,
    "fieldKey" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "columnLabel" TEXT,
    "isKeyField" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RegisterField_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RegisterField_registerId_sortOrder_idx" ON "RegisterField"("registerId", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "RegisterField_registerId_fieldKey_key" ON "RegisterField"("registerId", "fieldKey");

-- AddForeignKey
ALTER TABLE "RegisterField" ADD CONSTRAINT "RegisterField_registerId_fkey" FOREIGN KEY ("registerId") REFERENCES "Register"("id") ON DELETE CASCADE ON UPDATE CASCADE;
