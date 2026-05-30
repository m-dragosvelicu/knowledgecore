-- CreateEnum
CREATE TYPE "PathStatus" AS ENUM ('draft', 'accepted', 'in_progress', 'complete', 'abandoned');

-- CreateEnum
CREATE TYPE "LlmCallPurpose" AS ENUM ('intent_parse', 'goal_interview', 'knowledge_probe_questions', 'knowledge_probe_score', 'path_outline', 'checkpoint_evaluate', 'other');

-- AlterTable
ALTER TABLE "CheckpointEvaluation" ADD COLUMN     "userOverride" JSONB;

-- AlterTable
ALTER TABLE "LearningPath" ADD COLUMN     "revisionCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "status" "PathStatus" NOT NULL DEFAULT 'draft';

-- CreateTable
CREATE TABLE "LlmCall" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "purpose" "LlmCallPurpose" NOT NULL,
    "model" TEXT NOT NULL,
    "inputTokens" INTEGER NOT NULL,
    "outputTokens" INTEGER NOT NULL,
    "costMicroUsd" INTEGER NOT NULL,
    "latencyMs" INTEGER NOT NULL,
    "success" BOOLEAN NOT NULL,
    "errorMessage" TEXT,
    "request" JSONB,
    "response" JSONB,
    "evaluationId" TEXT,

    CONSTRAINT "LlmCall_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LlmCall_createdAt_idx" ON "LlmCall"("createdAt");

-- CreateIndex
CREATE INDEX "LlmCall_purpose_createdAt_idx" ON "LlmCall"("purpose", "createdAt");

-- CreateIndex
CREATE INDEX "LlmCall_evaluationId_idx" ON "LlmCall"("evaluationId");

-- CreateIndex
CREATE UNIQUE INDEX "CheckpointEvaluation_goalpostId_attempt_key" ON "CheckpointEvaluation"("goalpostId", "attempt");

-- CreateIndex
CREATE INDEX "Goalpost_pathId_status_idx" ON "Goalpost"("pathId", "status");

-- CreateIndex
CREATE INDEX "LearningIntent_userId_status_idx" ON "LearningIntent"("userId", "status");

-- AddForeignKey
ALTER TABLE "LlmCall" ADD CONSTRAINT "LlmCall_evaluationId_fkey" FOREIGN KEY ("evaluationId") REFERENCES "CheckpointEvaluation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
