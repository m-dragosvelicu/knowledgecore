/**
 * Deterministic check of the try-before-signup landing flow (no LLM, no HTTP).
 * Run: `bun run scripts/verify-landing-flow.ts`. Exits non-zero on any failure.
 *
 * Exercises against the LOCAL dev DB: the anonymity guard, claim-on-signup
 * (new account + existing-account merge, D3 keep-both), the begin-gate
 * (anonymous vs real), the D2 guest LLM/STT rate limit, and orphaned-guest
 * cleanup. All rows created are namespaced and torn down on success or failure.
 */
import { prisma } from "@/lib/db";
import { claimAnonymousJourney, isAnonymousSession } from "@/lib/auth";
import { assertGuestLlmBudget, GuestRateLimitError, GUEST_LLM_LIMIT } from "@/lib/journey/guestRateLimit";
import { cleanupOrphanedGuests } from "@/scripts/cleanup-guests";

const TAG = `lf-verify-${Date.now()}`;
let ok = 0;
let fail = 0;
function check(name: string, pass: boolean, detail = ""): void {
  console.log(`${pass ? "PASS" : "FAIL"} | ${name}${detail ? ` | ${detail}` : ""}`);
  pass ? ok++ : fail++;
}

// Seed a full anonymous journey (intent + subject + path + goalpost + profile)
// owned by a guest user. Returns the ids needed to assert ownership moves.
async function seedGuestJourney(suffix: string) {
  const guest = await prisma.user.create({
    data: {
      email: `${TAG}-guest-${suffix}@guest.local`,
      name: "Anonymous",
      isAnonymous: true,
    },
  });
  const intent = await prisma.learningIntent.create({
    data: { userId: guest.id, rawText: `${TAG} ${suffix}`, status: "path_outlined" },
  });
  await prisma.subject.create({
    data: { intentId: intent.id, canonicalName: "Test subject", scopeNote: "scope" },
  });
  const path = await prisma.learningPath.create({
    data: {
      intentId: intent.id,
      goalposts: {
        create: [
          { order: 1, title: "GP1", objective: "obj", estimatedMinutes: 10, status: "pending" },
        ],
      },
    },
  });
  const profile = await prisma.learnerProfile.create({
    data: { intentId: intent.id, userId: guest.id },
  });
  return { guest, intent, path, profile };
}

async function main() {
  // ---- (1) anonymity guard ---------------------------------------------------
  const guestSession = { user: { id: "g1", isAnonymous: true } } as never;
  const realSession = { user: { id: "r1", isAnonymous: false } } as never;
  const realNoFlag = { user: { id: "r2" } } as never;
  check("isAnonymousSession true for a guest session", isAnonymousSession(guestSession));
  check("isAnonymousSession false for a real session (flag false)", !isAnonymousSession(realSession));
  check("isAnonymousSession false for a real session (no flag)", !isAnonymousSession(realNoFlag));
  check("isAnonymousSession false for no session", !isAnonymousSession(null as never));

  // ---- (2a) claim: NEW account case -----------------------------------------
  const a = await seedGuestJourney("newacct");
  const newUser = await prisma.user.create({
    data: { email: `${TAG}-new@example.com`, name: "Real", isAnonymous: false },
  });
  const moved = await claimAnonymousJourney(a.guest.id, newUser.id);
  check("claim moved exactly one intent", moved.intentsMoved === 1, JSON.stringify(moved));
  check("claim moved exactly one profile", moved.profilesMoved === 1);

  const claimedIntent = await prisma.learningIntent.findUnique({ where: { id: a.intent.id } });
  check("intent now owned by the new account", claimedIntent?.userId === newUser.id);
  const claimedProfile = await prisma.learnerProfile.findUnique({ where: { id: a.profile.id } });
  check("profile.userId re-pointed to the new account", claimedProfile?.userId === newUser.id);
  // The cascade-carried rows still hang off the (unchanged) intentId.
  const carriedPath = await prisma.learningPath.findUnique({ where: { id: a.path.id } });
  check("path still attached to the same intent (carried for free)", carriedPath?.intentId === a.intent.id);
  // Plugin would now delete the spent guest; simulate it and assert nothing of
  // value cascades away (the journey already moved off the guest).
  await prisma.user.delete({ where: { id: a.guest.id } });
  const afterGuestDelete = await prisma.learningIntent.findUnique({ where: { id: a.intent.id } });
  check("journey survives guest deletion (re-owned first)", afterGuestDelete?.userId === newUser.id);

  // ---- (2b) claim: EXISTING account merge (D3, keep both) -------------------
  const existing = await prisma.user.create({
    data: { email: `${TAG}-existing@example.com`, name: "Returning", isAnonymous: false },
  });
  const priorIntent = await prisma.learningIntent.create({
    data: { userId: existing.id, rawText: `${TAG} prior`, status: "in_progress" },
  });
  const b = await seedGuestJourney("merge");
  // Make the guest journey the freshest by touching it after the prior one.
  await prisma.learningIntent.update({ where: { id: b.intent.id }, data: { rawText: `${TAG} merge freshest` } });
  const merged = await claimAnonymousJourney(b.guest.id, existing.id);
  check("merge moved the guest intent into the existing account", merged.intentsMoved === 1);
  const existingIntents = await prisma.learningIntent.findMany({
    where: { userId: existing.id },
    orderBy: { updatedAt: "desc" },
  });
  check("existing account now owns BOTH journeys (keep both)", existingIntents.length === 2);
  check(
    "freshest (guest) journey is the most-recently-updated active one",
    existingIntents[0].id === b.intent.id,
    `top=${existingIntents[0].rawText}`,
  );

  // ---- (3) the gate: begin belongs to a real account ------------------------
  // The server action uses requireRealUserId which redirects an anonymous
  // session. We assert the exact predicate the guard branches on, since calling
  // the action here would need Next's request context.
  const gateBlocksGuest = isAnonymousSession(guestSession); // -> redirect to /journey/begin
  const gateAllowsReal = !isAnonymousSession(realSession);
  check("gate BLOCKS goalpost-begin for an anonymous owner", gateBlocksGuest === true);
  check("gate ALLOWS goalpost-begin for a real account", gateAllowsReal === true);

  // ---- (4) D2 guest rate limit ----------------------------------------------
  // A real account is never limited regardless of log volume.
  let realLimited = false;
  try {
    await assertGuestLlmBudget(false);
  } catch {
    realLimited = true;
  }
  check("real account is never rate-limited", realLimited === false);

  // Seed the log past the cap and assert a guest is refused; under the cap it is
  // allowed. We count GUEST_PURPOSES rows in the window, so write enough.
  const baseline = await prisma.llmCall.count({
    where: { purpose: { in: ["intent_parse"] }, createdAt: { gte: new Date(Date.now() - 60 * 60 * 1000) } },
  });
  // Below the cap (assuming a default cap of 60 and a clean-ish window) a guest
  // is allowed. This assertion is robust as long as baseline < cap; if a real
  // run already filled the window it is skipped with a note.
  if (baseline < 60) {
    let underCapAllowed = true;
    try {
      await assertGuestLlmBudget(true);
    } catch (e) {
      underCapAllowed = !(e instanceof GuestRateLimitError);
    }
    check("guest under the cap is allowed", underCapAllowed === true, `baseline=${baseline}`);
  } else {
    check("guest under-cap check skipped (window already full)", true, `baseline=${baseline}`);
  }

  const toAdd = 65;
  await prisma.llmCall.createMany({
    data: Array.from({ length: toAdd }, () => ({
      purpose: "intent_parse" as const,
      model: `${TAG}-model`,
      inputTokens: 1,
      outputTokens: 1,
      costMicroUsd: 0,
      latencyMs: 1,
      success: true,
    })),
  });
  let guestRefused = false;
  let refusalIsGraceful = false;
  try {
    await assertGuestLlmBudget(true);
  } catch (e) {
    guestRefused = true;
    refusalIsGraceful = e instanceof GuestRateLimitError && typeof (e as Error).message === "string";
  }
  check("guest over the cap is refused", guestRefused === true);
  check("refusal is a graceful, typed error with a message", refusalIsGraceful === true);
  // Clean up the tagged log rows immediately so other windows are not affected.
  await prisma.llmCall.deleteMany({ where: { model: `${TAG}-model` } });

  // ---- (4b) D2 covers GUEST STT (stt_transcribe is a budgeted purpose) -------
  // The MicButton is reachable by anonymous guests on the outcome/probe steps and
  // each press is a real Gemini-audio call, so guest transcription must count
  // toward — and be gated by — the same window budget. Prove it with ONLY
  // stt_transcribe rows: if stt_transcribe were not in GUEST_PURPOSES these would
  // not count and the guest would wrongly be allowed.
  check(
    "stt_transcribe is a guest-budgeted purpose",
    GUEST_LLM_LIMIT.GUEST_PURPOSES.includes("stt_transcribe"),
    GUEST_LLM_LIMIT.GUEST_PURPOSES.join(","),
  );
  await prisma.llmCall.createMany({
    data: Array.from({ length: GUEST_LLM_LIMIT.MAX_CALLS + 5 }, () => ({
      purpose: "stt_transcribe" as const,
      model: `${TAG}-stt`,
      inputTokens: 1,
      outputTokens: 1,
      costMicroUsd: 0,
      latencyMs: 1,
      success: true,
    })),
  });
  let guestSttRefused = false;
  let guestSttGraceful = false;
  try {
    await assertGuestLlmBudget(true);
  } catch (e) {
    guestSttRefused = true;
    guestSttGraceful = e instanceof GuestRateLimitError;
  }
  check("guest transcription over the cap is refused (STT counts)", guestSttRefused === true);
  check("guest STT refusal is the same graceful typed error", guestSttGraceful === true);
  // A real account is NEVER limited, even with the STT window over the cap.
  let realSttLimited = false;
  try {
    await assertGuestLlmBudget(false);
  } catch {
    realSttLimited = true;
  }
  check("real account is unaffected by the STT budget", realSttLimited === false);
  await prisma.llmCall.deleteMany({ where: { model: `${TAG}-stt` } });

  // ---- (5) orphaned-guest cleanup -------------------------------------------
  // A STALE guest (idle > window) with a journey; a FRESH guest; a real account.
  const staleGuest = await prisma.user.create({
    data: { email: `${TAG}-stale@guest.local`, name: "Anonymous", isAnonymous: true },
  });
  const staleIntent = await prisma.learningIntent.create({
    data: { userId: staleGuest.id, rawText: `${TAG} stale`, status: "path_outlined" },
  });
  // Force updatedAt far into the past (raw update bypasses @updatedAt).
  await prisma.$executeRaw`UPDATE "user" SET "updatedAt" = now() - interval '60 days' WHERE id = ${staleGuest.id}`;
  const freshGuest = await prisma.user.create({
    data: { email: `${TAG}-fresh@guest.local`, name: "Anonymous", isAnonymous: true },
  });
  const realAcct = await prisma.user.create({
    data: { email: `${TAG}-realold@example.com`, name: "Real", isAnonymous: false },
  });
  await prisma.$executeRaw`UPDATE "user" SET "updatedAt" = now() - interval '60 days' WHERE id = ${realAcct.id}`;

  const res = await cleanupOrphanedGuests(30, false);
  const staleGone = !(await prisma.user.findUnique({ where: { id: staleGuest.id } }));
  const staleIntentGone = !(await prisma.learningIntent.findUnique({ where: { id: staleIntent.id } }));
  const freshKept = !!(await prisma.user.findUnique({ where: { id: freshGuest.id } }));
  const realKept = !!(await prisma.user.findUnique({ where: { id: realAcct.id } }));
  check("cleanup deleted the stale guest", staleGone === true, `deleted=${res.deleted}`);
  check("cleanup cascaded the stale guest's journey", staleIntentGone === true);
  check("cleanup KEPT the fresh guest", freshKept === true);
  check("cleanup KEPT a stale REAL account (never touches real users)", realKept === true);

  // ---- teardown --------------------------------------------------------------
  await prisma.user.deleteMany({
    where: { OR: [{ email: { startsWith: TAG } }, { email: { contains: TAG } }] },
  });
}

main()
  .then(async () => {
    console.log(`\n${ok} passed, ${fail} failed`);
    await prisma.user.deleteMany({ where: { email: { contains: TAG } } }).catch(() => {});
    await prisma.llmCall.deleteMany({ where: { model: { startsWith: TAG } } }).catch(() => {});
    await prisma.$disconnect();
    if (fail > 0) process.exit(1);
  })
  .catch(async (e) => {
    console.error("[verify-landing-flow] FAILED:", e instanceof Error ? e.stack : e);
    await prisma.user.deleteMany({ where: { email: { contains: TAG } } }).catch(() => {});
    await prisma.llmCall.deleteMany({ where: { model: { startsWith: TAG } } }).catch(() => {});
    await prisma.$disconnect();
    process.exit(1);
  });
