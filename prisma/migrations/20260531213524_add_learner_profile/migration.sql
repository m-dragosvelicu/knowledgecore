-- CreateTable
CREATE TABLE "LearnerProfile" (
    "id" TEXT NOT NULL,
    "intentId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "conceptMastery" JSONB NOT NULL DEFAULT '{}',
    "latestPaasEffort" INTEGER,
    "totalRetries" INTEGER NOT NULL DEFAULT 0,
    "totalTimeOnTaskMs" INTEGER NOT NULL DEFAULT 0,
    "visualNotHelpfulCount" INTEGER NOT NULL DEFAULT 0,
    "derivedSignals" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LearnerProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LearnerProfileSnapshot" (
    "id" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "evidence" JSONB,
    "conceptMastery" JSONB NOT NULL,
    "latestPaasEffort" INTEGER,
    "totalRetries" INTEGER NOT NULL,
    "totalTimeOnTaskMs" INTEGER NOT NULL,
    "visualNotHelpfulCount" INTEGER NOT NULL,
    "derivedSignals" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LearnerProfileSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LearnerProfile_intentId_key" ON "LearnerProfile"("intentId");

-- CreateIndex
CREATE INDEX "LearnerProfile_userId_idx" ON "LearnerProfile"("userId");

-- CreateIndex
CREATE INDEX "LearnerProfileSnapshot_profileId_createdAt_idx" ON "LearnerProfileSnapshot"("profileId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "LearnerProfileSnapshot_profileId_seq_key" ON "LearnerProfileSnapshot"("profileId", "seq");

-- AddForeignKey
ALTER TABLE "LearnerProfile" ADD CONSTRAINT "LearnerProfile_intentId_fkey" FOREIGN KEY ("intentId") REFERENCES "LearningIntent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LearnerProfileSnapshot" ADD CONSTRAINT "LearnerProfileSnapshot_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "LearnerProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
