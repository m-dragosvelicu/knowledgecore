-- AlterEnum
-- Outcome revision (founder ruling 2026-07-16): the learner can push back on
-- the synthesized outcome before the knowledge probe. Dedicated telemetry
-- purpose for the OutcomeReviser's single-shot revise call.
ALTER TYPE "LlmCallPurpose" ADD VALUE 'outcome_revision';
