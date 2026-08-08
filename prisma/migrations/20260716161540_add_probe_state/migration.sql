-- CreateTable
CREATE TABLE "ProbeState" (
    "id" TEXT NOT NULL,
    "intentId" TEXT NOT NULL,
    "questions" JSONB,
    "questionsGeneratedAt" TIMESTAMP(3),
    "answers" JSONB,
    "generationState" JSONB,

    CONSTRAINT "ProbeState_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProbeState_intentId_key" ON "ProbeState"("intentId");

-- AddForeignKey
ALTER TABLE "ProbeState" ADD CONSTRAINT "ProbeState_intentId_fkey" FOREIGN KEY ("intentId") REFERENCES "LearningIntent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
