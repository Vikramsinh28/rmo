-- CreateEnum
CREATE TYPE "FaceEnrollmentStatus" AS ENUM ('NOT_ENROLLED', 'PENDING', 'ENROLLED', 'FAILED', 'DISABLED');

-- CreateEnum
CREATE TYPE "FaceEnrollmentProvider" AS ENUM ('AWS_REKOGNITION');

-- CreateTable
CREATE TABLE "DivisionFaceCollection" (
    "id" SERIAL NOT NULL,
    "divisionId" INTEGER NOT NULL,
    "collectionId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DivisionFaceCollection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserFaceEnrollment" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "divisionId" INTEGER NOT NULL,
    "status" "FaceEnrollmentStatus" NOT NULL DEFAULT 'NOT_ENROLLED',
    "provider" "FaceEnrollmentProvider" NOT NULL DEFAULT 'AWS_REKOGNITION',
    "collectionId" TEXT,
    "providerFaceId" TEXT,
    "failureReason" TEXT,
    "enrolledAt" TIMESTAMP(3),
    "lastVerifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserFaceEnrollment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DivisionFaceCollection_divisionId_key" ON "DivisionFaceCollection"("divisionId");

-- CreateIndex
CREATE UNIQUE INDEX "DivisionFaceCollection_collectionId_key" ON "DivisionFaceCollection"("collectionId");

-- CreateIndex
CREATE INDEX "UserFaceEnrollment_userId_status_idx" ON "UserFaceEnrollment"("userId", "status");

-- CreateIndex
CREATE INDEX "UserFaceEnrollment_divisionId_status_idx" ON "UserFaceEnrollment"("divisionId", "status");

-- CreateIndex
CREATE INDEX "UserFaceEnrollment_providerFaceId_idx" ON "UserFaceEnrollment"("providerFaceId");

-- AddForeignKey
ALTER TABLE "DivisionFaceCollection" ADD CONSTRAINT "DivisionFaceCollection_divisionId_fkey" FOREIGN KEY ("divisionId") REFERENCES "Division"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserFaceEnrollment" ADD CONSTRAINT "UserFaceEnrollment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserFaceEnrollment" ADD CONSTRAINT "UserFaceEnrollment_divisionId_fkey" FOREIGN KEY ("divisionId") REFERENCES "Division"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
