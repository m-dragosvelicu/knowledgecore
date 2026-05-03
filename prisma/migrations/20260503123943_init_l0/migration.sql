-- CreateEnum
CREATE TYPE "JourneyStatus" AS ENUM ('created', 'goal_assessed', 'outcome_assessed', 'knowledge_assessed', 'path_outlined', 'in_progress', 'paused', 'complete', 'abandoned');

-- CreateEnum
CREATE TYPE "Motivation" AS ENUM ('curiosity', 'fun', 'school', 'work', 'other');

-- CreateEnum
CREATE TYPE "GoalpostStatus" AS ENUM ('pending', 'in_progress', 'complete', 'skipped');

-- CreateEnum
CREATE TYPE "StepType" AS ENUM ('information', 'experience_socratic', 'experience_applied_problem', 'experience_mini_project');

-- CreateEnum
CREATE TYPE "Decision" AS ENUM ('advance', 'repeat', 'adjust_plan');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "name" TEXT,
    "email" TEXT,
    "emailVerified" TIMESTAMP(3),
    "image" TEXT,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Account" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerAccountId" TEXT NOT NULL,
    "refresh_token" TEXT,
    "access_token" TEXT,
    "expires_at" INTEGER,
    "token_type" TEXT,
    "scope" TEXT,
    "id_token" TEXT,
    "session_state" TEXT,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "sessionToken" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VerificationToken" (
    "identifier" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL
);

-- CreateTable
CREATE TABLE "LearningIntent" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "rawText" TEXT NOT NULL,
    "status" "JourneyStatus" NOT NULL DEFAULT 'created',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LearningIntent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Subject" (
    "id" TEXT NOT NULL,
    "intentId" TEXT NOT NULL,
    "canonicalName" TEXT NOT NULL,
    "scopeNote" TEXT NOT NULL,

    CONSTRAINT "Subject_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LearningGoal" (
    "id" TEXT NOT NULL,
    "intentId" TEXT NOT NULL,
    "motivation" "Motivation" NOT NULL,
    "elaboration" TEXT NOT NULL,
    "timeHorizon" TEXT,

    CONSTRAINT "LearningGoal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExpectedOutcome" (
    "id" TEXT NOT NULL,
    "intentId" TEXT NOT NULL,
    "canDoStatements" JSONB NOT NULL,

    CONSTRAINT "ExpectedOutcome_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KnowledgeAssessment" (
    "id" TEXT NOT NULL,
    "intentId" TEXT NOT NULL,
    "competencies" JSONB NOT NULL,

    CONSTRAINT "KnowledgeAssessment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LearningPath" (
    "id" TEXT NOT NULL,
    "intentId" TEXT NOT NULL,
    "acceptedAt" TIMESTAMP(3),

    CONSTRAINT "LearningPath_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Goalpost" (
    "id" TEXT NOT NULL,
    "pathId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "objective" TEXT NOT NULL,
    "estimatedMinutes" INTEGER NOT NULL,
    "status" "GoalpostStatus" NOT NULL DEFAULT 'pending',

    CONSTRAINT "Goalpost_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Step" (
    "id" TEXT NOT NULL,
    "goalpostId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "type" "StepType" NOT NULL,
    "payload" JSONB NOT NULL,
    "userArtifact" TEXT,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "Step_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CheckpointEvaluation" (
    "id" TEXT NOT NULL,
    "goalpostId" TEXT NOT NULL,
    "attempt" INTEGER NOT NULL,
    "scores" JSONB NOT NULL,
    "evidence" JSONB NOT NULL,
    "decision" "Decision" NOT NULL,
    "rationale" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CheckpointEvaluation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PathRevision" (
    "id" TEXT NOT NULL,
    "pathId" TEXT NOT NULL,
    "triggerEvalId" TEXT,
    "changes" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PathRevision_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Account_provider_providerAccountId_key" ON "Account"("provider", "providerAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "Session_sessionToken_key" ON "Session"("sessionToken");

-- CreateIndex
CREATE UNIQUE INDEX "VerificationToken_identifier_token_key" ON "VerificationToken"("identifier", "token");

-- CreateIndex
CREATE UNIQUE INDEX "Subject_intentId_key" ON "Subject"("intentId");

-- CreateIndex
CREATE UNIQUE INDEX "LearningGoal_intentId_key" ON "LearningGoal"("intentId");

-- CreateIndex
CREATE UNIQUE INDEX "ExpectedOutcome_intentId_key" ON "ExpectedOutcome"("intentId");

-- CreateIndex
CREATE UNIQUE INDEX "KnowledgeAssessment_intentId_key" ON "KnowledgeAssessment"("intentId");

-- CreateIndex
CREATE UNIQUE INDEX "LearningPath_intentId_key" ON "LearningPath"("intentId");

-- CreateIndex
CREATE UNIQUE INDEX "Goalpost_pathId_order_key" ON "Goalpost"("pathId", "order");

-- CreateIndex
CREATE UNIQUE INDEX "Step_goalpostId_order_key" ON "Step"("goalpostId", "order");

-- CreateIndex
CREATE UNIQUE INDEX "PathRevision_triggerEvalId_key" ON "PathRevision"("triggerEvalId");

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LearningIntent" ADD CONSTRAINT "LearningIntent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subject" ADD CONSTRAINT "Subject_intentId_fkey" FOREIGN KEY ("intentId") REFERENCES "LearningIntent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LearningGoal" ADD CONSTRAINT "LearningGoal_intentId_fkey" FOREIGN KEY ("intentId") REFERENCES "LearningIntent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExpectedOutcome" ADD CONSTRAINT "ExpectedOutcome_intentId_fkey" FOREIGN KEY ("intentId") REFERENCES "LearningIntent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeAssessment" ADD CONSTRAINT "KnowledgeAssessment_intentId_fkey" FOREIGN KEY ("intentId") REFERENCES "LearningIntent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LearningPath" ADD CONSTRAINT "LearningPath_intentId_fkey" FOREIGN KEY ("intentId") REFERENCES "LearningIntent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Goalpost" ADD CONSTRAINT "Goalpost_pathId_fkey" FOREIGN KEY ("pathId") REFERENCES "LearningPath"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Step" ADD CONSTRAINT "Step_goalpostId_fkey" FOREIGN KEY ("goalpostId") REFERENCES "Goalpost"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CheckpointEvaluation" ADD CONSTRAINT "CheckpointEvaluation_goalpostId_fkey" FOREIGN KEY ("goalpostId") REFERENCES "Goalpost"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PathRevision" ADD CONSTRAINT "PathRevision_pathId_fkey" FOREIGN KEY ("pathId") REFERENCES "LearningPath"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PathRevision" ADD CONSTRAINT "PathRevision_triggerEvalId_fkey" FOREIGN KEY ("triggerEvalId") REFERENCES "CheckpointEvaluation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
