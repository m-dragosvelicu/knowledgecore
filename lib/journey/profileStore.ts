/**
 * L1 Slice 1 — the LIVING LOOP persistence layer for the LearnerProfile.
 *
 * WHAT THIS IS
 * ------------
 * The DB-facing bridge between the pure profile logic (lib/journey/learnerProfile.ts,
 * which never touches Prisma) and the journey server actions. It:
 *
 *   1. Lazily creates the journey-level LearnerProfile row (one per intent) the
 *      first time it is needed, seeding it from the empty profile state and
 *      writing the initial `init` snapshot.
 *   2. Reads the live row back into the plain `LearnerProfileState` shape that
 *      generation + the presenter seam consume.
 *   3. Applies evidence via the pure functions and persists the result, ALWAYS
 *      writing a new append-only `LearnerProfileSnapshot` (never overwriting an
 *      existing snapshot) so the snapshot stream is the empirical artifact.
 *
 * All writes here are best-effort at the call site: signal capture must never
 * break the learner's flow, so callers wrap these in try/catch. The functions
 * themselves use a transaction + the snapshot `@@unique([profileId, seq])` so the
 * per-profile sequence stays gap-free under the normal sequential journey flow.
 */

import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  applyMasteryEvidence,
  decisionToMasteryEvidence,
  emptyProfileState,
  type ConceptMasteryMap,
  type DerivedSignals,
  type LearnerProfileState,
  type SignalVector,
} from "./learnerProfile";

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

/** Map a persisted LearnerProfile row onto the plain domain state. */
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
 * Apply one checkpoint's evidence to the journey profile and persist it, writing
 * a new append-only snapshot. Pure folding is delegated to learnerProfile.ts;
 * this function only sequences the read → fold → write-row → write-snapshot in a
 * single transaction.
 *
 * `adjust_plan` is NOT mastery evidence about the learner (Coverage Mismatch =
 * the plan was wrong), so no BKT update is applied for it — but the snapshot is
 * still written (the signal vector / retry count may have moved) so the audit
 * stream records the event.
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
 * Server-side hook for the post-experience Paas effort tap (the UI that captures
 * it is a later UX task; this leaves the capture path ready). Records the latest
 * effort rating and writes a snapshot. Clamps to the Paas 1..9 range.
 */
export async function recordPaasEffort(
  intentId: string,
  userId: string,
  rating: number,
): Promise<void> {
  const clamped = Math.min(9, Math.max(1, Math.round(rating)));
  const profileId = await ensureProfile(intentId, userId);
  await prisma.$transaction(async (tx) => {
    const row = await tx.learnerProfile.findUnique({ where: { id: profileId } });
    if (!row) return;
    const state = rowToState(row);
    const next: LearnerProfileState = {
      ...state,
      signals: { ...state.signals, latestPaasEffort: clamped },
    };
    await writeLiveRow(tx, profileId, next);
    await writeSnapshot(tx, profileId, next, "paas_effort", { rating: clamped });
  });
}
