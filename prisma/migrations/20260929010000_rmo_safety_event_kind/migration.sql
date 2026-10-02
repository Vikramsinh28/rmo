-- CreateEnum
CREATE TYPE "SafetyEventKind" AS ENUM ('VISUAL_INDICATORS', 'DROWSINESS');

-- AlterTable
ALTER TABLE "SafetyEvent" ADD COLUMN     "kind" "SafetyEventKind" NOT NULL DEFAULT 'VISUAL_INDICATORS';
