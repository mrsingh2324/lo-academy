-- AlterTable
ALTER TABLE "StageAttempt" ADD COLUMN     "needsReviewReason" TEXT,
ADD COLUMN     "notifiedAt" TIMESTAMP(3),
ADD COLUMN     "notifyAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "releasedAt" TIMESTAMP(3);
