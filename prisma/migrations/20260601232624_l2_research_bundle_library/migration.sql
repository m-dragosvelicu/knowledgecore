-- CreateEnum
CREATE TYPE "SourceKind" AS ENUM ('academic', 'web');

-- CreateEnum
CREATE TYPE "SourceStatus" AS ENUM ('fetched', 'failed');

-- CreateEnum
CREATE TYPE "BundleStatus" AS ENUM ('researching', 'ready', 'failed');

-- CreateTable
CREATE TABLE "Source" (
    "id" TEXT NOT NULL,
    "kind" "SourceKind" NOT NULL,
    "status" "SourceStatus" NOT NULL DEFAULT 'fetched',
    "dedupKey" TEXT NOT NULL,
    "doi" TEXT,
    "canonicalUrl" TEXT,
    "title" TEXT NOT NULL,
    "authors" JSONB,
    "venue" TEXT,
    "publishedYear" INTEGER,
    "retrievedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rawText" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Source_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SourceChunk" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "text" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "embeddedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SourceChunk_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResearchBundle" (
    "id" TEXT NOT NULL,
    "topicFingerprint" TEXT NOT NULL,
    "topicLabel" TEXT NOT NULL,
    "status" "BundleStatus" NOT NULL DEFAULT 'researching',
    "embeddingModel" TEXT,
    "embeddingDim" INTEGER,
    "isPublic" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ResearchBundle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BundleSource" (
    "bundleId" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "scopeNote" TEXT,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BundleSource_pkey" PRIMARY KEY ("bundleId","sourceId")
);

-- CreateTable
CREATE TABLE "JourneyBundle" (
    "intentId" TEXT NOT NULL,
    "bundleId" TEXT NOT NULL,
    "boundAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JourneyBundle_pkey" PRIMARY KEY ("intentId","bundleId")
);

-- CreateTable
CREATE TABLE "BundleAmendment" (
    "id" TEXT NOT NULL,
    "bundleId" TEXT NOT NULL,
    "gap" TEXT NOT NULL,
    "goalpostId" TEXT,
    "addedSourceIds" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BundleAmendment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Source_dedupKey_key" ON "Source"("dedupKey");

-- CreateIndex
CREATE INDEX "Source_kind_status_idx" ON "Source"("kind", "status");

-- CreateIndex
CREATE INDEX "Source_doi_idx" ON "Source"("doi");

-- CreateIndex
CREATE UNIQUE INDEX "SourceChunk_contentHash_key" ON "SourceChunk"("contentHash");

-- CreateIndex
CREATE INDEX "SourceChunk_sourceId_ordinal_idx" ON "SourceChunk"("sourceId", "ordinal");

-- CreateIndex
CREATE UNIQUE INDEX "ResearchBundle_topicFingerprint_key" ON "ResearchBundle"("topicFingerprint");

-- CreateIndex
CREATE INDEX "ResearchBundle_status_idx" ON "ResearchBundle"("status");

-- CreateIndex
CREATE INDEX "BundleSource_sourceId_idx" ON "BundleSource"("sourceId");

-- CreateIndex
CREATE INDEX "JourneyBundle_bundleId_idx" ON "JourneyBundle"("bundleId");

-- CreateIndex
CREATE INDEX "BundleAmendment_bundleId_createdAt_idx" ON "BundleAmendment"("bundleId", "createdAt");

-- AddForeignKey
ALTER TABLE "SourceChunk" ADD CONSTRAINT "SourceChunk_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "Source"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BundleSource" ADD CONSTRAINT "BundleSource_bundleId_fkey" FOREIGN KEY ("bundleId") REFERENCES "ResearchBundle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BundleSource" ADD CONSTRAINT "BundleSource_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "Source"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JourneyBundle" ADD CONSTRAINT "JourneyBundle_intentId_fkey" FOREIGN KEY ("intentId") REFERENCES "LearningIntent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JourneyBundle" ADD CONSTRAINT "JourneyBundle_bundleId_fkey" FOREIGN KEY ("bundleId") REFERENCES "ResearchBundle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BundleAmendment" ADD CONSTRAINT "BundleAmendment_bundleId_fkey" FOREIGN KEY ("bundleId") REFERENCES "ResearchBundle"("id") ON DELETE CASCADE ON UPDATE CASCADE;
