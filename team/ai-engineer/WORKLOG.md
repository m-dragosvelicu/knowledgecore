# AI Engineer — WORKLOG

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
