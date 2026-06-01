# UX/Frontend WORKLOG

## 2026-06-01 — Three founder UX fixes (home CTA, profile dropdown, journeys page + delete)

Branch: `feat/home-nav-journeys-fixes` (off `main`). Built on the merged L1 +
design-system. No push, no co-authors, no commit to main.

### Fix 1 — "Start a different journey" moved to the TOP
- Was a buried skip-tier link at the bottom of the home dashboard. Removed it.
- Added a prominent workbench (`WobbleButton`, resting outline) "Start a new
  journey" CTA in the top section of the active-journey dashboard, on the same
  row as the "Pick up where you left off" heading (right-aligned, wraps below on
  xs). A quiet `--ink-3` caption under it keeps the "sets aside the one in
  progress" explanation. Runs the existing `startNewJourneyAction`.
- Empty-state hero behavior left unchanged (no active journey -> hero question).
- File: `app/page.tsx`.

### Fix 2 — profile-icon dropdown
- Removed the inline "Account" (wobble) + "Sign out" (skip) actions from the nav
  bar. The avatar is now the only top-right affordance.
- New client component `components/AccountMenu.tsx`: avatar opens a styled MUI
  `Menu` (NOT window.confirm/native dialog) anchored to the avatar, with exactly
  two items — "Profile" (-> /account) and "Sign out". Design-system styling:
  `--surface` paper card, 1px `--line` border, `--shadow` soft warm shadow,
  `--r-md` rounding, calm ink Hanken type, `--surface-2` hover. Keyboard
  accessible (aria-haspopup/controls/expanded, MenuList aria-labelledby), closes
  on outside-click/escape (MUI Menu). Avatar keeps its 2px teal hover ring and a
  persistent ring while open.
- Sign-out: the Better Auth server action is bound in the server `AppHeader` and
  threaded into `AccountMenu` as a prop; it lives on a hidden `<form>` the menu
  item submits via `requestSubmit()`. Behavior unchanged.
- Files: `components/AccountMenu.tsx` (new), `components/AppHeader.tsx`.

### Fix 3 — /journeys page + quiet delete
- New route `app/journeys/page.tsx` (server component) reached from the "View
  all journeys" affordance (home links now point to `/journeys`, in both the
  active and empty-state branches). Lists ALL of the user's journeys using the
  same design-system journey rows as home (Fraunces title, middot status +
  relative-time metadata, roughened `ScoreBadge`, hover nudge), split into
  "In progress" and "Finished and set aside". Empty -> falls back to the hero.
- New client row `components/journey/JourneyListRow.tsx`: the row is a Link; a
  QUIET vertical-ellipsis ("...") overflow control sits as an absolutely-
  positioned sibling (so it never navigates), revealed/firmed on row hover and
  on focus. NOT a prominent red button. Opens a calm styled MUI `Dialog`
  (design-system surfaces, NOT window.confirm) that NAMES the journey
  ("Delete “<title>”?") before anything is removed; "Keep it" (wobble) /
  "Delete journey" (solid ink) actions.
- Delete server action `app/journeys/_actions.ts` `deleteJourneyAction`:
  ownership enforced server-side at the DB boundary via
  `prisma.learningIntent.deleteMany({ where: { id, userId } })` — a non-owner or
  bad id deletes 0 rows. Then `revalidatePath("/journeys")` + `revalidatePath("/")`.
- Data model: every child of `LearningIntent` is `onDelete: Cascade` (Subject,
  LearningGoal, ExpectedOutcome, KnowledgeAssessment, LearnerProfile ->
  LearnerProfileSnapshot, LearningPath -> Goalpost -> Step + CheckpointEvaluation,
  PathRevision). The two FKs pointing INTO that graph from outside are
  `onDelete: SetNull` (LlmCall.evaluationId, PathRevision.triggerEvalId), so a
  single delete removes the whole journey with no orphans / FK errors. NO
  migration needed (the local dev DB is already up to date with all 8
  migrations; the cascades already exist in the schema).

### Verification (all green)
- `bun run typecheck` (tsc --noEmit): 0 errors.
- `bunx next build`: success; `/journeys` present (7.43 kB / 182 kB first load).
- verify scripts (all via bun): decision 9/9, loop ALL PASS, presenter 18/18,
  learner-profile 24/24, adaptation 18/18, path-confirmation ALL PASS, stt 11/11,
  visual-media 50/50.
- Served-app check on the LOCAL dev DB (port 5440) via `next dev` (NOT the
  production `.env.production.local` remote DB): minted a real session through
  `/api/auth/sign-up/email`; `/journeys` 200 renders the seeded journey + the
  "More actions for <title>" overflow; home active-dashboard 200 shows the
  relocated "Start a new journey" CTA + the "sets aside" caption + the
  "Account menu" avatar dropdown, with the old inline Account/Sign out buttons
  gone and "View all journeys" -> /journeys. No runtime errors in the dev log.
- Delete exercised against the DB with a fully-seeded completed journey
  (subject, goal, outcome, assessment, path -> goalpost -> step + evaluation ->
  llmcall, profile -> snapshot): wrong-user deleteMany = 0 rows; owner
  deleteMany = 1 row; every dependent row -> 0 (no orphans); the LlmCall pointing
  at the deleted evaluation SURVIVED with `evaluationId` nulled (SetNull). Test
  user + data cleaned up afterward.
