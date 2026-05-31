-- AlterTable
ALTER TABLE "ExpectedOutcome" ADD COLUMN     "successCriterion" TEXT;

-- AlterTable
ALTER TABLE "KnowledgeAssessment" ADD COLUMN     "probeTranscript" JSONB,
ADD COLUMN     "recalibrationFlags" JSONB;

-- AlterTable
ALTER TABLE "LearningGoal" ADD COLUMN     "externalConstraints" TEXT,
ADD COLUMN     "timeHorizonDays" INTEGER;

-- AlterTable
ALTER TABLE "Step" ADD COLUMN     "expectedArtifactSchema" JSONB;
