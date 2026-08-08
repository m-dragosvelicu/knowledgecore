-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "LlmCallPurpose" ADD VALUE 'embed_ingest';
ALTER TYPE "LlmCallPurpose" ADD VALUE 'embed_query';
ALTER TYPE "LlmCallPurpose" ADD VALUE 'external_tavily_search';
ALTER TYPE "LlmCallPurpose" ADD VALUE 'external_openalex_search';
ALTER TYPE "LlmCallPurpose" ADD VALUE 'external_semantic_scholar_search';
