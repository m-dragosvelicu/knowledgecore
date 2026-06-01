# AI Engineer — WORKLOG

## 2026-06-01 — Goalpost (+ can-do) title sentence-case fix (branch feat/goalpost-title-casing)

**Root cause (confirmed):** the live path outliner's SYSTEM prompt had NO casing
instruction, so Gemini Title-Cased every goalpost `title`/`objective` it generated. The
design system mandates SENTENCE CASE for titles/headings/statements (proper nouns kept).
The display layer was NOT the culprit (the only `text-transform:capitalize` rules are on
small status chips, not titles). The intent parser already emits sentence case; this gap
was downstream of it in the curriculum step.

**Files changed**
1. `lib/services/live/livePathOutliner.ts` — added a "TITLE & HEADING CASING — CRITICAL"
   block to SYSTEM instructing sentence case for every goalpost `title` and `objective`:
   capitalize ONLY the first word and genuine proper nouns (Art Nouveau, French, React,
   Python), do NOT Title-Case Every Word, ordinary technical terms stay lowercase
   mid-sentence (default mode network, balance sheet, dot product), with 3 worked examples.
2. `lib/services/live/liveGoalInterviewer.ts` — the can-do statements are the "you'll be
   able to" achievement copy on the path/outcome pages. They already start with "I can"
   (first word fine) but nouns mid-sentence were at risk of Title Case, so added the same
   sentence-case rule to the can-do statement rules.
3. `lib/services/mock/mockPathOutliner.ts` — generic fallback title was `${subject} -
   Goalpost ${i}`, which now starts lowercase (subjects are sentence-cased, e.g. "the
   default mode network - Goalpost 1"). Changed to `Foundations of ${subject} (part ${i})`
   so it leads with a capitalized word and reads sensibly. Hardcoded linear-algebra titles
   were already sentence case (left untouched).

**Outcome generator:** the "you'll be able to" / "Where this trail ends" HEADINGS on
`app/(app)/journey/path/page.tsx` and `outcome/OutcomeClient.tsx` are static UI copy
(already sentence case) — not generated, not touched. The generated outcome PROSE is the
goal interviewer's can-do statements, which DID get the sentence-case instruction (item 2).
Eyebrows/labels left uppercase per the design system.

**Before/after (proven against live Gemini, GOOGLE_GENAI_API_KEY present):**
- "the default mode network": BEFORE "Anatomy and Core Hubs of the DMN" / "Cognitive
  Functions: The Self and Mental Time Travel" / "DMN Dysregulation in Clinical Cases" ->
  AFTER "Discovering the brain's default state" / "The cognitive roles of internal
  mentation" / "Applying default mode network dynamics to clinical and behavioral states".
- "Art Nouveau": BEFORE "The Whiplash Line and Total Art (Gesamtkunstwerk)" / "Materials
  and Motifs: Translating Nature into Industry" / "Designing the Nouveau: Applying the
  Aesthetic to a Modern Object" -> AFTER "The roots and key characteristics of Art Nouveau"
  / "Identifying Art Nouveau across different media" / "Applying Art Nouveau principles to
  a modern design challenge" (proper noun preserved).
- "reading a balance sheet": BEFORE "The Foundation: Mastering the Accounting Equation" /
  "Liquidity and the Art of Short-Term Survival" / "Financial Diagnosis: Evaluating
  Leverage and Overall Health" -> AFTER "The anatomy of a balance sheet and the accounting
  equation" / "Measuring financial health with liquidity and leverage ratios" / "Evaluating
  business stability and creditworthiness".
- Can-do statements (Art Nouveau, live): "I can recall at least three major Art Nouveau
  artists...", "I can explain the core design principles and motifs of Art Nouveau...",
  "I can analyze a building's facade..." — sentence case, proper noun preserved.
- MOCK fallback: "Foundations of the default mode network (part 1/2/3)" — sensible.

**Verify:** tsc 0; `next build` clean (18 routes); all 9 verify-* PASS (decision 9, loop,
presenter 18, learner-profile 24, adaptation 18, path-confirmation, stt 11, visual-media 50,
landing-flow 27). Throwaway proof script removed after the run.

**Blockers:** none. Branch committed locally, not pushed (founder rule).

## 2026-06-01 — Subject extraction + sentence-case fix (branch feat/home-nav-journeys-fixes)

**Work done**
- Root cause of founder report ("I Want To Learn About The Default Mode Network" rendered
  verbatim, Title Cased): BOTH extraction and casing lived in the parser DATA, not the UI.
  Display sites render `subject.canonicalName` verbatim (no `text-transform:capitalize` on
  titles — the only `capitalize` rules are single-word Bloom-level chips, left untouched).
  - MOCK parser (`lib/services/mock/mockIntentParser.ts`): `cleanCapitalize` title-cased
    every word of the WHOLE raw sentence. Founder preview was mock-mode, so this is what
    he saw.
  - LIVE parser (`lib/services/live/liveIntentParser.ts`): SYSTEM prompt literally said
    "Title case" and did not strip lead-ins.
- Fixes:
  1. LIVE: rewrote SYSTEM to EXTRACT the subject noun phrase (strip "I want to learn
     about", "teach me", "how do I", "how does X work", etc.) and emit SENTENCE CASE.
     Switched the intent-parse call to the cheapest structured-output Gemini —
     `gemini-3.1-flash-lite` (overridable via `GEMINI_INTENT_MODEL`) — passed explicitly
     as `model` to `completeStructured`. Structured output (responseSchema) preserved.
  2. MOCK: replaced `cleanCapitalize` with `stripLeadIn` + `toSentenceCase`; ambiguity
     check now runs on the EXTRACTED subject so "i want to learn physics" still flags broad.
  3. CASING: handled by the data fix (sentence case at the source); UI unchanged.
  4. BANNER (`app/(app)/layout.tsx`): reworded — no longer claims the key is missing;
     states mock mode may be on due to no key OR a `LIVE_*` opt-out.
  5. PRICING (`lib/llm/pricing.ts`): added flash-lite rates (~$0.10/$0.40 per 1M) keyed
     before "flash" so telemetry costs the lite tier correctly (was 0).

**Cheap model choice:** `gemini-3.1-flash-lite` — same generation family as the current
`gemini-3.5-flash` default, cheapest tier that still supports `responseSchema` structured
output, available on this key (verified via /v1beta/models). Live telemetry confirmed
model id + non-zero cost (~89 microUSD/call).

**Before/after (proven, both parsers):**
- "I Want To Learn About The Default Mode Network" -> MOCK "The default mode network",
  LIVE "The default mode network" (was: "I Want To Learn About The Default Mode Network").
- "teach me stoicism for a bad day" -> MOCK "Stoicism for a bad day", LIVE same.
- "how does color actually work" -> MOCK "Color actually work", LIVE "How color works".
- "i want to learn physics" -> "Physics", ambiguous=true (broad-field guard intact).

**Verify:** tsc 0; `next build` clean (18 routes); all 9 verify-* PASS (decision 9,
loop, presenter 18, learner-profile 24, adaptation 18, path-confirmation, stt 11,
visual-media 50, landing-flow 27).

**Work next:** none required for this fix. Optional follow-up: consider tuning the mock
"how does X work" strip (drops "how/does" but keeps "work") — live parser handles it
better; mock is deterministic-good-enough.

**Blockers:** none.
