-- AlterEnum
-- L1 Slice 3 (speech-to-text): a dedicated telemetry purpose for the Gemini
-- AUDIO transcription call. Recorded learner speech in, clean transcript out;
-- the audio is discarded after transcription (never persisted).
ALTER TYPE "LlmCallPurpose" ADD VALUE 'stt_transcribe';
