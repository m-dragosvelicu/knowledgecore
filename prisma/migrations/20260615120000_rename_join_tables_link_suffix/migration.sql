-- Rename the two M:N join tables to the explicit ...Link convention.
-- These are data-preserving ALTER TABLE RENAMEs (NOT drop+recreate): existing
-- rows on the dev DB are kept. Prisma's default diff for a model rename is a
-- drop+recreate, which would lose every link row; this migration is hand-written
-- to rename the table and its constraints/indexes in place instead.

-- BundleSource -> BundleSourceLink
ALTER TABLE "BundleSource" RENAME TO "BundleSourceLink";
ALTER TABLE "BundleSourceLink" RENAME CONSTRAINT "BundleSource_pkey" TO "BundleSourceLink_pkey";
ALTER TABLE "BundleSourceLink" RENAME CONSTRAINT "BundleSource_bundleId_fkey" TO "BundleSourceLink_bundleId_fkey";
ALTER TABLE "BundleSourceLink" RENAME CONSTRAINT "BundleSource_sourceId_fkey" TO "BundleSourceLink_sourceId_fkey";
ALTER INDEX "BundleSource_sourceId_idx" RENAME TO "BundleSourceLink_sourceId_idx";

-- JourneyBundle -> JourneyBundleLink
ALTER TABLE "JourneyBundle" RENAME TO "JourneyBundleLink";
ALTER TABLE "JourneyBundleLink" RENAME CONSTRAINT "JourneyBundle_pkey" TO "JourneyBundleLink_pkey";
ALTER TABLE "JourneyBundleLink" RENAME CONSTRAINT "JourneyBundle_intentId_fkey" TO "JourneyBundleLink_intentId_fkey";
ALTER TABLE "JourneyBundleLink" RENAME CONSTRAINT "JourneyBundle_bundleId_fkey" TO "JourneyBundleLink_bundleId_fkey";
ALTER INDEX "JourneyBundle_bundleId_idx" RENAME TO "JourneyBundleLink_bundleId_idx";
