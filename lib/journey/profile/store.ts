/**
 * L1 Slice 1 — the living-loop persistence layer for the LearnerProfile: the
 * DB-facing bridge between the pure profile logic (./model.ts, no
 * Prisma) and the journey server actions. Lazily creates the per-intent
 * LearnerProfile row (seeded from the empty state, writing an `init`
 * snapshot), reads it back into the plain `LearnerProfileState` shape, and
 * applies evidence via the pure functions — always writing a new append-only
 * `LearnerProfileSnapshot`, never overwriting one.
 *
 * Writes here are best-effort at the call site (signal capture must never
 * break the learner's flow — callers wrap in try/catch). Each function uses
 * a transaction + `@@unique([profileId, seq])` to keep the per-profile
 * sequence gap-free under normal sequential journey flow.
 */

import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  applyMasteryEvidence,
  decisionToMasteryEvidence,
  emptyProfileState,
  incrementVisualNotHelpful,
  type ConceptMasteryMap,
  type DerivedSignals,
  type LearnerProfileState,
  type SignalVector,
} from "./model";

type Tx = PrismaClient | Prisma.TransactionClient;

/** Coerce a persisted Json column into the typed mastery map (defensive). */
function asMasteryMap(value: unknown): ConceptMasteryMap {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as ConceptMasteryMap;
  }
  return {};
}

function asDerivedSignals(value: unknown): DerivedSignals | null {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as DerivedSignals;
  }
  return null;
}

function rowToState(row: {
  conceptMastery: unknown;
  latestPaasEffort: number | null;
  totalRetries: number;
  totalTimeOnTaskMs: number;
  visualNotHelpfulCount: number;
  derivedSignals: unknown;
}): LearnerProfileState {
  return {
    conceptMastery: asMasteryMap(row.conceptMastery),
    signals: {
      latestPaasEffort: row.latestPaasEffort,
      totalRetries: row.totalRetries,
      totalTimeOnTaskMs: row.totalTimeOnTaskMs,
      visualNotHelpfulCount: row.visualNotHelpfulCount,
    },
    derivedSignals: asDerivedSignals(row.derivedSignals),
  };
}

/**
 * Ensure the journey's LearnerProfile row exists (creating it + its `init`
 * snapshot on first use), and return its id. Idempotent: a second call returns
 * the existing row. `userId` is required only to populate the denormalised L4
 * extension-point column on creation.
 */
export async function ensureProfile(
  intentId: string,
  userId: string,
): Promise<string> {
  const existing = await prisma.learnerProfile.findUnique({
    where: { intentId },
    select: { id: true },
  });
  if (existing) return existing.id;

  const fresh = emptyProfileState();
  return prisma.$transaction(async (tx) => {
    // Guard against a race: another request may have created it concurrently.
    const raced = await tx.learnerProfile.findUnique({
      where: { intentId },
      select: { id: true },
    });
    if (raced) return raced.id;

    const created = await tx.learnerProfile.create({
      data: {
        intentId,
        userId,
        conceptMastery: fresh.conceptMastery as unknown as object,
        latestPaasEffort: fresh.signals.latestPaasEffort,
        totalRetries: fresh.signals.totalRetries,
        totalTimeOnTaskMs: fresh.signals.totalTimeOnTaskMs,
        visualNotHelpfulCount: fresh.signals.visualNotHelpfulCount,
        derivedSignals: fresh.derivedSignals as unknown as object,
      },
      select: { id: true },
    });
    await writeSnapshot(tx, created.id, fresh, "init", null);
    return created.id;
  });
}

/** Read the journey's profile as the plain domain state, or null if none yet. */
export async function readProfile(
  intentId: string,
): Promise<LearnerProfileState | null> {
  const row = await prisma.learnerProfile.findUnique({ where: { intentId } });
  return row ? rowToState(row) : null;
}

/**
 * Read the profile, creating it lazily if absent so generation always has a
 * concrete (cold-start) profile to inject.
 */
export async function readOrCreateProfile(
  intentId: string,
  userId: string,
): Promise<LearnerProfileState> {
  await ensureProfile(intentId, userId);
  const state = await readProfile(intentId);
  return state ?? emptyProfileState();
}

/**
 * Append a new immutable snapshot for a profile. Computes the next per-profile
 * `seq` inside the same transaction. Never overwrites: each call inserts one row.
 */
async function writeSnapshot(
  tx: Tx,
  profileId: string,
  state: LearnerProfileState,
  reason: string,
  evidence: object | null,
): Promise<void> {
  const last = await tx.learnerProfileSnapshot.findFirst({
    where: { profileId },
    orderBy: { seq: "desc" },
    select: { seq: true },
  });
  const seq = (last?.seq ?? 0) + 1;
  await tx.learnerProfileSnapshot.create({
    data: {
      profileId,
      seq,
      reason,
      evidence: (evidence ?? undefined) as unknown as object | undefined,
      conceptMastery: state.conceptMastery as unknown as object,
      latestPaasEffort: state.signals.latestPaasEffort,
      totalRetries: state.signals.totalRetries,
      totalTimeOnTaskMs: state.signals.totalTimeOnTaskMs,
      visualNotHelpfulCount: state.signals.visualNotHelpfulCount,
      derivedSignals: state.derivedSignals as unknown as object,
    },
  });
}

/** Persist the live profile row from a domain state (no snapshot — see callers). */
async function writeLiveRow(
  tx: Tx,
  profileId: string,
  state: LearnerProfileState,
): Promise<void> {
  await tx.learnerProfile.update({
    where: { id: profileId },
    data: {
      conceptMastery: state.conceptMastery as unknown as object,
      latestPaasEffort: state.signals.latestPaasEffort,
      totalRetries: state.signals.totalRetries,
      totalTimeOnTaskMs: state.signals.totalTimeOnTaskMs,
      visualNotHelpfulCount: state.signals.visualNotHelpfulCount,
      derivedSignals: state.derivedSignals as unknown as object,
    },
  });
}

/** The evidence a single checkpoint decision folds into the profile. */
export interface CheckpointEvidence {
  /** Stable concept key for the goalpost (we use the goalpost id). */
  conceptKey: string;
  /** The authoritative §8 decision (advance | repeat | adjust_plan). */
  decision: "advance" | "repeat" | "adjust_plan";
  /** True when this decision also counts as a repeat (folds totalRetries). */
  isRepeat: boolean;
  /** Time spent on this goalpost's experience step, in ms (>=0). Optional. */
  timeOnTaskMs?: number;
  /** Latest Paas effort tap (1..9), if one was captured. Optional. */
  paasEffort?: number | null;
}

/**
 * Apply one checkpoint's evidence to the journey profile and persist it,
 * writing a new append-only snapshot. Pure folding is delegated to
 * ./model.ts; this only sequences read -> fold -> write-row ->
 * write-snapshot in a single transaction. `adjust_plan` is NOT mastery
 * evidence (Coverage Mismatch = the plan was wrong), so no BKT update is
 * applied, but the snapshot is still written for the audit stream.
 */
export async function applyCheckpointEvidence(
  intentId: string,
  userId: string,
  evidence: CheckpointEvidence,
): Promise<void> {
  const profileId = await ensureProfile(intentId, userId);

  await prisma.$transaction(async (tx) => {
    const row = await tx.learnerProfile.findUnique({ where: { id: profileId } });
    if (!row) return;
    const state = rowToState(row);

    const at = new Date();
    let conceptMastery = state.conceptMastery;
    const correctness = decisionToMasteryEvidence(evidence.decision);
    let priorMastery: number | null = null;
    if (correctness !== null) {
      priorMastery = state.conceptMastery[evidence.conceptKey]?.mastery ?? null;
      conceptMastery = applyMasteryEvidence(
        state.conceptMastery,
        evidence.conceptKey,
        correctness,
        at,
      );
    }

    const signals: SignalVector = {
      latestPaasEffort:
        evidence.paasEffort != null
          ? evidence.paasEffort
          : state.signals.latestPaasEffort,
      totalRetries: state.signals.totalRetries + (evidence.isRepeat ? 1 : 0),
      totalTimeOnTaskMs:
        state.signals.totalTimeOnTaskMs +
        Math.max(0, Math.round(evidence.timeOnTaskMs ?? 0)),
      visualNotHelpfulCount: state.signals.visualNotHelpfulCount,
    };

    const next: LearnerProfileState = {
      conceptMastery,
      signals,
      derivedSignals: state.derivedSignals,
    };

    await writeLiveRow(tx, profileId, next);
    await writeSnapshot(tx, profileId, next, "checkpoint_result", {
      conceptKey: evidence.conceptKey,
      decision: evidence.decision,
      correct: correctness,
      priorMastery,
      posteriorMastery:
        correctness !== null
          ? next.conceptMastery[evidence.conceptKey]?.mastery ?? null
          : null,
      isRepeat: evidence.isRepeat,
      timeOnTaskMs: evidence.timeOnTaskMs ?? null,
      paasEffort: evidence.paasEffort ?? null,
    });
  });
}

/**
 * Record a repeat attempt as a retry signal: increments `totalRetries` and
 * writes a `retry` snapshot. No BKT fold here — the mastery update already
 * happened on the failing submission; the retry is a signal-vector / struggle
 * event. Best-effort at the call site.
 */
export async function recordRetry(
  intentId: string,
  userId: string,
  conceptKey: string,
): Promise<void> {
  const profileId = await ensureProfile(intentId, userId);
  await prisma.$transaction(async (tx) => {
    const row = await tx.learnerProfile.findUnique({ where: { id: profileId } });
    if (!row) return;
    const state = rowToState(row);
    const next: LearnerProfileState = {
      ...state,
      signals: {
        ...state.signals,
        totalRetries: state.signals.totalRetries + 1,
      },
    };
    await writeLiveRow(tx, profileId, next);
    await writeSnapshot(tx, profileId, next, "retry", { conceptKey });
  });
}

/**
 * Record a learner marking a visual as "not helpful": increments
 * `visualNotHelpfulCount` and writes a new append-only `visual_not_helpful`
 * snapshot. A content/feedback-driven modality signal, not a VARK /
 * learner-type label. Best-effort (feedback must never break the learner's flow).
 */
export async function recordVisualNotHelpful(
  intentId: string,
  userId: string,
  visualId: string,
): Promise<void> {
  const profileId = await ensureProfile(intentId, userId);
  await prisma.$transaction(async (tx) => {
    const row = await tx.learnerProfile.findUnique({ where: { id: profileId } });
    if (!row) return;
    const state = rowToState(row);
    const next = incrementVisualNotHelpful(state);
    await writeLiveRow(tx, profileId, next);
    await writeSnapshot(tx, profileId, next, "visual_not_helpful", { visualId });
  });
}
