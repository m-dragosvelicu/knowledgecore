# UX/Frontend WORKLOG

## 2026-06-01 — Dedup the active question in the turn-taking dialogue (shared engine)

Branch: `feat/home-nav-journeys-fixes`. No push, no co-authors, no commit to main.

Founder-reported (screenshot): on the goal-interview step the current question
rendered TWICE — once as a small "Your guide" chat bubble, and AGAIN as the big
Fraunces heading on the input card directly below it. Same sentence, two competing
elements.

### Root cause (shared rendering pattern, double-emitted in two clients)
The turn-taking dialogue is rendered by two clients that share the same inline
pattern: `OutcomeClient` (Goal Interview) and `PathConfirmationGate` (the path
confirmation "not quite right" clarifying dialogue). In BOTH, `runTurn` appends
the new guide question to the running `transcript` as the trailing `assistant`
turn AND stores it in `question`. The render then drew the WHOLE transcript as
"Your guide"/"You" bubbles (so the trailing active question became a bubble) and
ALSO drew `question` as the `AskHeadline` on the input card — the duplicate. The
transcript always ends with the active question because the client re-sends the
full transcript each stateless turn.

The third surface named in the brief — the Checkpoint Socratic remediation — does
NOT currently render this turn-taking transcript primitive. In the shipped M6a
build the `repeat` decision re-runs the Experience build (`ExperienceForm`, which
shows its prompt once in the reading voice, no "Your guide" bubble + heading
pair), and `adjust_plan` hands off to the Path Adjuster. Live transcript dialogue
exists only in the two clients above (confirmed: only OutcomeClient,
PathConfirmationGate, and the new DialogueTurns reference role==="assistant"
turn rendering / the "You" bubble label anywhere in app + components). The fix is
made in a SHARED component so when Socratic remediation adopts the turn-taking
primitive (M6c) it is deduped by construction.

### Fix (presentation only; logic, server actions, and questions unchanged)
New shared component `components/journey/DialogueTurns.tsx` — the single source of
truth for the transcript bubbles. It renders ONLY the PRIOR turns: it drops the
trailing active assistant question via the exported pure helper `priorTurns()`
(slice off the last turn iff it is an `assistant` turn). The ACTIVE question is
now emitted EXACTLY ONCE, by the input card's `AskHeadline`. Per the founder
decision the input card is one collapsed unit: a "Your guide" eyebrow ->
the question in Fraunces (once) -> the answer input + mic + Continue/Send.

- `app/(app)/journey/outcome/OutcomeClient.tsx`: replaced the inline transcript
  loop with `<DialogueTurns transcript={transcript} />`; added a "Your guide"
  `Eyebrow` above the `AskHeadline` on the input card.
- `components/journey/PathConfirmationGate.tsx`: same swap; added the "Your guide"
  eyebrow on the dialogue input card.

### Verification
- `tsc --noEmit`: 0 errors (exit 0).
- `next build`: compiled, 19/19 routes, middleware bundled (exit 0).
- All 9 verify scripts pass (none in the diff path, none regressed):
  decision 9/9, loop ALL PASS, presenter 18/18, learner-profile 24/24,
  adaptation 18/18, path-confirmation ALL PASS, stt 11/11, visual-media 50/50,
  landing-flow 27/27.
- Dedup confirmed two ways with a multi-turn transcript [Q1, A1, ACTIVE]:
  (1) `priorTurns()` unit checks — active question excluded, earlier Q1/A1 kept
  once each; (2) `renderToStaticMarkup(<DialogueTurns/>)` served-HTML inspection —
  the active question string appears ZERO times in the transcript region and
  EXACTLY ONCE across the full surface (the heading). The earlier guide question
  renders as one "Your guide" bubble and the prior answer as one "You" bubble, so
  genuine multi-turn history is preserved above the input card. Temp verify
  scripts removed after running.

## 2026-06-01 — Fix nested-<form> hydration error + dead hero submit on landing

Branch: `feat/home-nav-journeys-fixes`. No push, no co-authors, no commit to main.

Two founder-reported runtime bugs that the verify scripts and served-HTML checks
missed (both on the PUBLIC landing seen by a fresh anonymous visitor):

1. Console hydration error: "In HTML, <form> cannot be a descendant of <form>".
2. "Started a journey, gave a subject, it did nothing." — the hero Begin submit
   did not start a journey.

### Root cause (one cause, two symptoms)
`HomeHero` wrapped `<SearchPill>` in its OWN `<form action={startJourneyWithIntentAction}>`,
but `SearchPill` (components/ui/PillInput.tsx) is itself a `<form onSubmit=...>`
(its design contract; it is reused standalone in /specimens). That nested
`<form>` inside `<form>` — exactly the hydration error. React then regenerated
the broken tree on the client, which dropped the outer form's `action` + the
`formRef.requestSubmit()` wiring, so Begin did nothing. So bug 2 was CAUSED by
bug 1, as suspected. (AccountMenu's hidden sign-out form was investigated and is
NOT a source: AppHeader has no form and is rendered at layout/page top level, and
the menu only renders for a real account, not the anonymous landing path.)

### Fix (one file)
`components/HomeHero.tsx`: removed the redundant outer `<form>` wrapper (kept a
plain `<Box>` for the margin). Submission is now driven from `SearchPill`'s
`onSubmit`: `ensureSessionThenSubmit` mints the guest (unchanged) and then calls
the `startJourneyWithIntentAction` server action PROGRAMMATICALLY with a
constructed `FormData` — the same client-invokes-server-action pattern already
used in `journey/begin/BeginClient.tsx` (`await acceptPathAction()`). Dropped the
now-unused `useRef`/`formRef` and hidden `rawText` input. `SearchPill` is left
exactly as-is (its self-contained form is its contract; /specimens still works).

### Proof — actual flow walk (MOCK mode, local DB :5440, dev on :3210)
BEFORE/AFTER served-HTML nested-form check (curl + form-depth parser):
- BEFORE (stashed fix): 2 `<form>` tags, max nesting depth 2 -> NESTED FORM.
- AFTER (fix): 1 `<form>` tag, max nesting depth 1 -> no nested form.

Live walk in a real browser as a fresh anonymous visitor:
- Loaded `/`, console had NO hydration/nested-form error (only unrelated MetaMask
  extension warnings).
- Typed "the ideas behind Art Nouveau", clicked Begin -> app minted a guest,
  created the LearningIntent + Subject, and REDIRECTED to `/journey/outcome`
  (step 2 "Outcome" active, Intent checked, "YOUR SUBJECT: The Ideas Behind Art
  Nouveau", "Running in mock mode" banner). No hydration error during the flow.
- DB before: anon_users=0, intents=2. After the walk: anon_users grew, a new
  intent `rawText="the ideas behind Art Nouveau"`, `status=goal_assessed`, owner
  isAnonymous=true, subject "The Ideas Behind Art Nouveau". Test guests cleaned up
  afterward (back to anon_users=0, intents=2).

### Gate (all green)
`bun run typecheck` -> 0 errors. `bun run build` -> success (19 routes). All nine
verify scripts pass: decision 9/9, loop ALL PASS, presenter 18/18,
learner-profile 24/24, adaptation 18/18, path-confirmation ALL PASS, stt 11/11,
visual-media 50/50, landing-flow 27/27.

## 2026-06-01 — Close D2 rate-limit gap on guest STT (/api/transcribe)

Branch: `feat/home-nav-journeys-fixes`. No push, no co-authors, no commit to main.

QA gap: anonymous guests reach `/api/transcribe` (the MicButton is on the outcome
and probe pre-journey steps) and each press is a real Gemini-audio call, but
`stt_transcribe` was NOT in `GUEST_PURPOSES`, so guest transcription bypassed the
D2 budget. Closed it.

Changes:
- `lib/journey/guestRateLimit.ts`: added `stt_transcribe` to `GUEST_PURPOSES` so
  guest transcription counts in the same rolling-window budget (WINDOW_MS/MAX_CALLS
  unchanged).
- `app/api/transcribe/route.ts`: after the session check, call
  `assertGuestLlmBudget(isAnonymousSession(session))` BEFORE transcribing
  (mirrors the pre-journey server actions). Over-budget returns the same graceful
  `GuestRateLimitError` message as a `429`. No-op for real (non-anonymous)
  accounts — they are never limited. Nothing else about STT changed.
- `scripts/verify-landing-flow.ts`: added section (4b) proving with ONLY
  `stt_transcribe` rows that a guest's transcription now counts toward the budget
  and is refused over the cap with the graceful typed error, while a real account
  is unaffected; teardown broadened to clear any `${TAG}`-prefixed `LlmCall.model`.

Gate (all green): `bun run typecheck` -> 0 errors; `bun run build` -> success (19
routes, `/api/transcribe` builds); `verify:stt` 11/11; `verify:landing-flow` 27/27
(was 24, +3 STT checks); `verify:path-confirmation` ALL PASS; `verify:visual-media`
50/50.

## 2026-06-01 — Try-before-signup landing flow (anonymous guest -> account gate -> claim)

Branch: `feat/home-nav-journeys-fixes` (built additively on top of the home/header
fixes at b1ea4c2). No push, no co-authors, no commit to main. Implements
CEO/landing-flow-plan.html + checklist to the locked decisions D1-D5.

### What shipped (the 7 pieces)
1. PUBLIC SURFACE. `middleware.ts` widened from the single auth-route exemption
   to a public allow-list (`/`, `/signin`, `/api/auth/*`, dev `/specimens`,
   `/journey/intent|outcome|probe|path`, `/journey/begin`); stays Edge-safe /
   optimistic-only. `app/page.tsx` renders the public landing (HomeHero +
   new `components/HowItWorks.tsx` strip + "already have an account? sign in")
   whenever there is no REAL account (no session OR anonymous). The public
   pre-journey pages now redirect a no-session visitor to `/` (the hero / guest
   bootstrap point) instead of `/signin`.
2. ANONYMOUS BOOTSTRAP. Better Auth `anonymous()` plugin in `lib/auth.ts`
   (before `nextCookies()`), `anonymousClient()` in `lib/auth-client.ts`. Schema
   gained `User.isAnonymous` (migration `20260601074504_add_user_is_anonymous`,
   LOCAL dev DB). `HomeHero` mints the guest lazily on hero SUBMIT (not on render
   — bots that only load `/` create no guest), then submits the existing server
   action; the journey persists under the guest userId via the unchanged
   `getOrCreateActiveIntent` machinery.
3. THE GATE. New `lib/auth-guards.ts`: `requireOwnerId()` (accepts guest, used by
   the pre-journey actions) and `requireRealUserId()` (rejects guest -> redirects
   to `/journey/begin`). `acceptPathAction` ("Looks good, start") uses
   requireRealUserId (PRIMARY gate). The learning surfaces (`/journey/goalpost`,
   `/resume`, `/adjusted`, `/complete`, `/account`, `/journeys` + its delete
   action, and every goalpost-mutating action) reject anonymous (SECONDARY gate,
   closes the optimistic-cookie hole). New `app/(app)/journey/begin/` page +
   `BeginClient.tsx`: design-system create-account step (Fraunces heading, pill
   inputs, solid teal commit) that restates `subject · N goalposts · ~M min`,
   email+password only, "create account & begin" primary + "sign in instead"
   secondary; on success it resumes the pending begin by calling
   `acceptPathAction` (now a real user) -> goalpost 1.
4. CLAIM-ON-SIGNUP. `onLinkAccount` in `lib/auth.ts` -> `claimAnonymousJourney`:
   one `prisma.$transaction` re-points `LearningIntent.userId` (carries the whole
   journey via intentId cascade) + `LearnerProfile.userId` (denormalised) from
   guest to the new/real user. Covers BOTH the new-account signup and the
   existing-account merge (D3 keep-both: the dashboard already surfaces the
   freshest active intent). Plugin deletion of the spent guest stays ON (move
   happens first, so the cascade removes nothing of value).
5. RATE LIMIT (D2). `lib/journey/guestRateLimit.ts`: `assertGuestLlmBudget` reads
   the existing `LlmCall` log (the five pre-journey purposes) over a rolling
   window (1h / 60 calls, env-tunable) and throws a graceful `GuestRateLimitError`
   for guests over budget; real accounts are never limited. Called at the top of
   every guest-driven, cost-bearing pre-journey action.
6. MIGRATION. `User.isAnonymous Boolean @default(false)` applied to the LOCAL dev
   DB only (`prisma migrate dev`).
7. EDGE CASES. Orphaned-guest cleanup `scripts/cleanup-guests.ts` (deletes
   `isAnonymous=true AND updatedAt < now-30d`, cascades journeys, idempotent,
   `--dry`); bot load mints no guest (lazy bootstrap); signup failure stays on the
   begin step with the journey untouched; deep-link to a learning surface is
   bounced to `/journey/begin`.

### Verification
- `tsc --noEmit`: 0 errors. `next build`: success (`/journey/begin` route present,
  middleware compiled). Built via `bunx next build` to avoid the `build` script's
  `prisma migrate deploy` against the remote prod DB.
- All existing verify scripts pass: decision 9/9, loop ALL PASS, presenter 18/18,
  learner-profile 24/24, adaptation 18/18, path-confirmation ALL PASS, stt 11/11,
  visual-media 50/50.
- New `scripts/verify-landing-flow.ts` (`bun run verify:landing-flow`): 23/23 —
  anonymity guard, claim (new-account + existing-account merge D3 keep-both,
  atomic), gate semantics, D2 rate limit (refuses over cap, never a real account),
  cleanup (only stale guests, cascades journeys, never real/fresh users).
- SERVED-APP CHECK (`next dev` on the LOCAL DB): anonymous bootstrap returns a
  guest with `isAnonymous:true`; guest `/` renders the hero (200, no signin
  bounce); guest deep-link `/journey/goalpost` and `/account` -> 307
  `/journey/begin`; guest `/journey/begin` renders the summary + form;
  sign-up-while-anonymous (with Origin header) re-owned the seeded journey to the
  new real account and deleted the guest (0 orphans); sign-in-to-existing
  (merge) left the existing account owning BOTH journeys and deleted the guest.
  Note: `auth-smoke.ts` sign-out asserts 403 under curl because Better Auth
  requires an `Origin` header on POSTs; sign-out returns 200 with Origin (and the
  real sign-out runs server-side via `auth.api.signOut`), so this is a pre-existing
  smoke-script artifact, not a regression.

### Files
- New: `lib/auth-guards.ts`, `lib/journey/guestRateLimit.ts`,
  `components/HowItWorks.tsx`, `app/(app)/journey/begin/page.tsx`,
  `app/(app)/journey/begin/BeginClient.tsx`, `scripts/cleanup-guests.ts`,
  `scripts/verify-landing-flow.ts`,
  `prisma/migrations/20260601074504_add_user_is_anonymous/`.
- Changed: `prisma/schema.prisma`, `lib/auth.ts`, `lib/auth-client.ts`,
  `middleware.ts`, `app/page.tsx`, `components/AppHeader.tsx`, `app/signin/page.tsx`,
  `app/(app)/layout.tsx`, `app/(app)/journey/_actions.ts`, the pre-journey pages
  (`intent`, `outcome`, `probe`, `path`), the learning pages (`goalpost`,
  `resume`, `adjusted`, `complete`), `app/account/page.tsx`,
  `app/journeys/page.tsx`, `app/journeys/_actions.ts`, `components/HomeHero.tsx`,
  `package.json`.

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

## 2026-06-01 — QA independent sign-off: round-1 UX fixes + landing flow (GO WITH CAVEAT)

Independent end-to-end re-verification of `feat/home-nav-journeys-fixes` @ bff3f2b
(2 commits ahead of origin/main @ 2c04862: b1ea4c2 round-1 UX + bff3f2b landing
flow). Re-ran the whole suite from scratch; did not trust the build agents.
Read-only git + local DB only. Deliverable:
`CEO/round1-landing-QA-signoff-2026-06-01.html` (house style, TOC).

### Suite (all green, exact)
- `tsc --noEmit`: 0 errors (exit 0)
- `next build`: compiled, 19/19 pages, middleware bundled (exit 0)
- `verify:landing-flow` (NEW): 23 passed, 0 failed
- `verify:path-confirmation`: ALL PASS
- `verify:stt`: 11 passed, 0 failed
- `verify:visual-media`: 50 passed, 0 failed
- No pre-existing verify script regressed.

### Security audit
- Anonymous guest blocked from every learning surface + /account at BOTH layers:
  middleware allow-list (optimistic) + requireRealUserId/isAnonymousSession on the
  goalpost page, /account, acceptPathAction, and ALL goalpost-mutating actions +
  delete. Live test confirms guest predicate -> 307 to /journey/begin; real -> proceeds.
- Gate fires at acceptPathAction (begin) ONLY; intent/interview/outcome/probe/path
  all accept a guest via ownerContext/requireOwnerId. Confirmed.
- claimAnonymousJourney: single $transaction, both updateMany scoped by
  where:{userId:anonymousUserId} — own-journey only, no caller-supplied target,
  cannot claim another user's intent. New-account AND existing-account merge (D3
  keep-both) both verified live.
- Guest rate limit: throws typed GuestRateLimitError over budget, never limits real
  accounts (verified). GLOBAL window count is a documented design choice, not a bug.
- deleteJourneyAction: deleteMany scoped by {id,userId} — ownership enforced
  server-side, zero rows for non-owner.
- No audio/secrets persisted (transcribe = in-request Uint8Array -> transcript JSON
  only; verify:stt asserts no leak). Markdown + SVG sanitizers NOT in the diff vs
  main — unchanged.

### Prod-backup file
- `knowledgecore_prod_backup_2026-06-01.sql`: UNTRACKED (`?? ` in git status), NOT
  in git ls-files, NOT staged, NOT in either commit. Safe. BUT not in .gitignore —
  a future `git add -A` would catch it. Recommend deleting or gitignoring it.

### Git state
- `git fetch` clean. feat branch = 2 ahead / 0 behind origin/main; merge-base ==
  origin/main (2c04862). Clean fast-forward, no rebase needed.

### Verdict: GO WITH CAVEAT
Ship. Two non-blocking hygiene follow-ups: (1) gitignore/delete the prod-DB dump;
(2) /api/transcribe (guest-reachable on outcome/probe) is outside GUEST_PURPOSES —
add stt_transcribe to the rate-limit set. Neither is in the commits under review.
