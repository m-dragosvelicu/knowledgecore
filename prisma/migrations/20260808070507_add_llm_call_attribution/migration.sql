-- AlterTable
ALTER TABLE "LlmCall" ADD COLUMN     "intentId" TEXT,
ADD COLUMN     "userId" TEXT;

-- CreateIndex
CREATE INDEX "LlmCall_userId_createdAt_idx" ON "LlmCall"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "LlmCall_intentId_createdAt_idx" ON "LlmCall"("intentId", "createdAt");

-- AddForeignKey
ALTER TABLE "LlmCall" ADD CONSTRAINT "LlmCall_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LlmCall" ADD CONSTRAINT "LlmCall_intentId_fkey" FOREIGN KEY ("intentId") REFERENCES "LearningIntent"("id") ON DELETE SET NULL ON UPDATE CASCADE;
