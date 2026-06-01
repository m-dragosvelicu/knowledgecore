# L2 — Research Agent, Provenance & the Library — Design Spec

**Date:** 2026-06-02 · **Phase:** L2 · **Status:** DRAFT for founder review (built autonomously overnight; decisions flagged for veto)
**Inputs:** 5 team research reports in `docs/l2-research/` (research-engineer, ai-engineer, backend-engineer, ux-frontend, academic-researcher)

---

## 0. What L2 is (one paragraph)

In L0 and L1, all learning content is generated from the model's own parametric knowledge — in the code, `Step.payload.sourceIds` is written `[]` everywhere. L2 changes that: a **Research Agent** goes online, finds real credible sources, and assembles a **core source material bundle** stored in **the Library**. Goalpost content is then generated **grounded in that bundle**, and every substantive claim is **traceable to a real source** (provenance). The Library is architected for **topic-level reuse** so the same research serves later learners on the same topic (becomes public/shared in a later phase). This is the academic-integrity backbone of the product, and — per the academic-researcher — it is consistent with what `L0.md`, thesis Chapter 4, and the roadmap already promise.

---

## 1. Founder-confirmed requirements (from this session)

1. The Research Agent goes **online** to find information, references, and sources of truth. Generation stays **grounded in sources**, not just model training.
2. It **organizes** findings into sources.
3. **When it runs:** after the learner **confirms the path is correct**, the agent produces a **core source material bundle** stored in the Library.
4. **Goalpost 1** is generated from the bundle. **Goalpost 2** adapts from *GP1 learnings + the bundle* (ties into the L1 adaptation loop).
5. If GP1 surfaces an **important gap**, the agent can be **re-triggered to amend specific parts / add to the bundle** — targeted, not a full re-research.
6. The Library is a **shared, reusable** knowledge store (reuse research by topic across users; public later).
7. **Out of scope (L3):** user-uploaded materials (e.g. MIT public courses) and highlight-to-ask-questions. Keep the door open; design nothing for them.

---

## 2. Current-state facts (verified in the codebase by the team)

These are load-bearing and were independently confirmed by multiple agents:

- **`sourceIds` is empty at exactly three generation seams:**
  - `lib/services/live/livePathOutliner.ts:235` (Call A, path structure)
  - `lib/journey/lessonGeneration.ts:127` (Call B, the real lesson content)
  - `lib/services/live/livePathAdjuster.ts:272` (adjust_plan remediation)
  The `Step` payload contract `{ content, sourceIds?: string[] }` already exists (`prisma/schema.prisma:276`).
- **Research clients already exist but are completely unwired** (zero callers): `lib/research/{openalex,semanticScholar,tavily,firecrawl}.ts` — thin typed `fetch` wrappers, no SDK, no LangChain.
- **Qdrant is provisioned but idle** (`lib/vector/qdrant.ts`, `ensureCollection(name, vectorSize, distance)`), **zero callers**, and **there is no embedding client anywhere** in the project.
- **Generation is already two-phase and lazy:** Call A outlines 3 goalposts up front; Call B (`ensureLessonContent`) authors real content when the learner enters a goalpost, idempotent via `contentGeneratedAt`, and already injects the L1 `LearnerProfile`.
- **The trigger point exists:** `acceptPathAction` (`app/(app)/journey/_actions.ts:538`) is the single gate from path-confirm into goalpost 1.
- **The Gemini structured-output converter throws on maps / `z.record` / non-literal unions** (`gemini.ts:206,239`). Provenance schemas MUST be closed objects / arrays / literal-enums. (This forces the claim→source design below to be an **array of rows, not a map**.)
- `lib/services/types.ts` is the **locked** service boundary; L2 adds **additive** sibling contracts alongside it (L1 precedent: `lessonContent.ts`, `visualMedia.ts`, `transcription.ts`).

---

## 3. Architecture (4 subsystems + the seam)

```
                 path confirmed (acceptPathAction)
                          │
   ┌──────────────────────▼───────────────────────┐
   │ A. RESEARCH AGENT (lib/research/)             │   deterministic orchestrator,
   │   classify → route → expand → finalize        │   NO model tool-loop, NO LangChain
   │   OpenAlex → S2 (expand) → Tavily/Firecrawl    │
   │   → Crossref (DOI finalize) → chunk → embed   │
   └──────────────────────┬───────────────────────┘
                          │ produces
   ┌──────────────────────▼───────────────────────┐
   │ C. THE LIBRARY (Postgres authoritative +      │   topic-fingerprint cache:
   │    Qdrant index)                              │   research ONCE per topic,
   │   Source · SourceChunk · ResearchBundle ·     │   reused across users
   │   BundleSource · JourneyBundle · Amendment    │
   └──────────────────────┬───────────────────────┘
                          │ bundle chunks [S1..Sn]
   ┌──────────────────────▼───────────────────────┐
   │ B. GROUNDED GENERATION (lib/services/live)    │   attribute-first + verify gate
   │   Call A / Call B / Adjuster read the bundle, │
   │   emit citations[], P-Cite NLI verify,        │
   │   write REAL sourceIds (was [])               │
   └──────────────────────┬───────────────────────┘
                          │ surfaced by
   ┌──────────────────────▼───────────────────────┐
   │ D. PROVENANCE & LIBRARY UX (app + components) │   "Sourced from" panel per
   │   per-goalpost sources panel + /library route │   goalpost; read-only Library
   └───────────────────────────────────────────────┘

   re-trigger: GP1 evaluation = adjust_plan + gap → amend bundle (targeted) → regen affected step
```

### A. Research Agent — source layer (`lib/research/`)
Deterministic **classify → route → expand → finalize** pipeline (research-engineer report §2.3):
- **OpenAlex primary** (academic discovery + the academicness probe), **Semantic Scholar expansion-only** (citation-graph follow-ups), **Tavily + Firecrawl web fallback** for non-academic topics, **Crossref** as a DOI/citation finalizer (new, low-risk; needs a Decision record).
- Two transparent credibility scorers (academic: age-normalized citations + OA + has-abstract; web: domain-tier + relevance + publish-date). Hard-reject unattributable web pages.
- Assembles the bundle: per-goalpost query set → route → dedup → score → chunk → embed → coverage map.
- `amend(gapQueries)` reuses the same pipeline scoped to one concept, with the existing bundle as a dedup/exclusion set (append-only).

### B. Grounded generation + provenance (`lib/services/live/*`, `lib/journey/lessonGeneration.ts`)
Pattern (ai-engineer report §2): **retrieve → chunk → select → attribute-first generate (G-Cite) → verify (P-Cite NLI gate) → persist claim-level provenance.**
- Bundle chunks injected as `[S1..Sn]` into the existing prompts; the model emits the prose `content` **plus** a structured `citations: [{ claim, sourceIds }]` array (closed schema — no maps, per the Gemini constraint).
- A second cheap structured call (`provenance_verify`) NLI-checks each claim↔chunk pair and **drops unfaithful citations** (mitigates the documented ~57% post-rationalization rate). Best-effort/non-fatal, like all telemetry paths.
- The verified union of resolved `sourceId`s replaces the `[]` at the three seams.
- Explicit Gemini **context caching** on the bundle prefix (`gemini.ts:90` TODO) so GP2/GP3 bill the bundle at cached rate.

### C. The Library — storage (`prisma/schema.prisma` + `lib/vector/qdrant.ts`)
**Postgres authoritative, Qdrant a disposable index** (backend-engineer report §2.1). Qdrant stores only `{ id, vector, payload:{ sourceId, bundleIds, topicFingerprint } }`; every byte is rebuildable from Postgres. New additive tables: `Source` (globally deduped by DOI→canonical URL→text hash), `SourceChunk` (content-addressed, mirrored 1:1 into Qdrant), `ResearchBundle` (topic-fingerprinted, `isPublic` flag for later), `BundleSource` + `JourneyBundle` (M:N reuse joins), `BundleAmendment` (re-trigger audit record). **Topic-fingerprint UNIQUE constraint** gives DB-enforced idempotency and the read-through cache (Nth learner on a topic = zero research cost).

### D. Provenance & Library UX (`app/`, `components/`)
ux-frontend report:
- **Required:** a per-goalpost **"Sourced from" panel** in the existing `.kc-meta` attribution voice, reusing the `VisualMedia` "real, checkable, never-fabricated" pattern; bundle-research liveness copy reusing the `GettingReady` screen (also addresses the deferred static-loading bug).
- **Required (small):** a read-only **`/library` route** — cross-journey deduped source index (reusing `JourneyListRow` grammar) + a source-detail panel + a "Sources for this journey" view, all linking out in a new tab.
- **Stretch:** inline `[n]` markers with hover source-cards (only if claim→source bindings prove reliable; never fake precision; build via a custom react-markdown token, not by widening the HTML sanitizer).
- **Naming collision:** `app/journeys/page.tsx` currently labels itself "Your library" — rename journeys → "Your journeys", reserve "Library" for the source store.

### The seam: re-trigger / amend (cross-lane)
Hook the existing **`adjust_plan`** branch (ai-engineer report §3.5): GP1 evaluation `adjust_plan` + gap → tiny **gap-extraction** structured call → if `needsResearch`, run only the gap queries → **dedup-merge** into the bundle (monotonic growth, `BundleAmendment` row) → existing Path Adjuster runs with the augmented bundle → clear `contentGeneratedAt` only for affected goalposts so Call B re-authors them. Completed goalposts are never touched. **GP2 = GP1-learnings (via the L1 profile already injected) + the amended bundle**, with no new orchestration.

---

## 4. Provenance contract (academic-researcher — the integrity definition)

Adopt a **two-level grounding contract**:
1. **Bundle-level grounding (absolute, enforceable):** no information is generated without a stored, retrieved bundle in scope.
2. **Claim-level attribution (measured, reported — not asserted as perfect):** a claim is attributed to a span if the span *supports* it (AIS sense, Rashkin et al. 2023) — support, not truth, and not a claim about the model's process (avoids the Wallat "correct-but-unfaithful" trap).

- **Granularity:** **passage-level citations user-facing**, **atomic/claim-level for evaluation only**, **quotation for high-stakes/definitional claims**.
- **Evaluation (for the thesis):** citation recall + precision (ALCE), faithfulness-to-bundle (RAGAS), source-quality score; LLM-as-judge entailment reusing existing bias mitigations, validated by founder dual-rating with Cohen's kappa (mirrors CHARTER C.2). Headline: L0 recall = 0 by construction vs L2 measured X%, read against the ~51%/74% realistic bar (Liu et al. 2023).
- **Honest framing:** L2 defends the *trustworthiness of the information half*; keep that rigorously separate from the central "experience grounds knowledge" thesis claim, exactly as Chapter 4 already states.

---

## 5. DECISIONS — defaults chosen autonomously (FLAG ANY FOR VETO IN THE MORNING)

Since you were offline, I resolved the open forks with sensible defaults. Each is reversible; veto any and I adjust.

| # | Fork | **Default chosen** | Why | Reversible? |
|---|------|--------------------|-----|-------------|
| D1 | Source origin | **Live online retrieval** (you confirmed) | Learners pick arbitrary topics | n/a |
| D2 | When research runs | **At `acceptPathAction` (path-confirm)**; GP1 needs synchronous, GP2+ background-fill | Your stated flow + matches existing lazy Call-B | yes |
| D3 | Vector store | **Keep Qdrant, Postgres authoritative** (Qdrant = disposable index) | ADR-5 binding; kills two-store drift | yes (but contradicts ADR to change) |
| D4 | Embedding vendor | **Reuse Gemini embeddings** (no new vendor/key) | Avoids a new key/cost; one provider | **yes — easy veto to Voyage/OpenAI** |
| D5 | Library reuse key | **Topic-fingerprint** (normalized subject + outcome shape), UNIQUE | Cross-user reuse + DB idempotency | yes |
| D6 | Provenance granularity | **Passage-level user-facing, claim-level for eval** | academic-researcher recommendation | yes |
| D7 | Citation UI | **"Sourced from" panel (required)**, inline `[n]` hovercards (stretch only) | Faithfulness over false precision | yes |
| D8 | Library UI scope in L2 | **Read-only `/library` index + source detail + per-journey sources** | Uploads/sharing are L3 | yes |
| D9 | Research orchestration | **Deterministic TS orchestrator** (no model tool-loop) | Simpler, testable, no-LangChain rule | yes |
| D10 | Cold-topic research execution | **Lazy on goalpost-1 entry, gated on `bundle.status`** (no new job infra) | No cron/queue exists today | yes |
| D11 | Add Crossref + journeys/library rename | **Yes** (Crossref needs a Decision record) | Hardens provenance; frees the "Library" name | yes |

---

## 6. Pre-build BLOCKERS (need you / a decision)

1. **OpenAlex now requires an API key (since 13 Feb 2026)** and dropped the `mailto` polite pool. Our `openalex.ts` uses `mailto` only — the **primary source breaks/throttles** without a key. → Needs an `OPENALEX_API_KEY` (free signup) or a fallback-first build. **The first slice avoids this dependency** (see §8).
2. **Embedding vendor undecided** (D4 default = Gemini). Fixes the Qdrant collection dimension. The first slice does **not** require embeddings (it lands schema + source layer + a non-semantic grounding path first).
3. **`fingerprint()` definition** is the reuse contract — must be versioned + unit-tested (research-engineer + backend-engineer). Specced in the plan.

---

## 7. Scope — in L2 vs deferred to L3

**In L2:** Research Agent (source layer + router + credibility), bundle assembly, Library storage (schema + Qdrant index), grounded generation with real `sourceIds`, P-Cite verification gate, re-trigger/amend on `adjust_plan`, "Sourced from" panel, read-only `/library`, topic-level reuse, grounding evaluation harness.

**Deferred to L3 (door kept open, not designed):** user uploads (`Source.kind = user_upload` + owner FK), highlight-to-ask-questions, public/shared Library exposure (`isPublic` flip), tags/collections, learner-facing "amend the bundle", in-app source reader.

---

## 8. Proposed first slice (what gets built tonight as a PR for your review)

A **foundational, safe, test-gated** slice that proves the spine without the blockers:

1. **Schema + migration (local only):** the 5 additive models + 2 enums + `LearningIntent.bundles` back-relation. `prisma migrate dev`, no prod DB exists.
2. **Source-layer scaffolding:** `lib/research/{router,credibility,bundle,types}.ts` + `crossref.ts`, wiring the existing clients behind a `ResearchAgent` service interface registered in `getServices()` with a **mock** that returns a canned bundle (so CI/offline runs never hit the network — and so the slice needs no API keys).
3. **Provenance threading (real `sourceIds`):** add the closed `citations[]` schema and replace `sourceIds: []` at the three seams, driven by the mock bundle end-to-end. This makes the whole spine demonstrable without OpenAlex/embeddings.
4. **Tests:** fingerprint unit tests, dedup tests, a journey-through-the-mock-bundle test showing non-empty `sourceIds`, typecheck + build green.

What the first slice deliberately omits (needs the blockers / is larger): live OpenAlex/web retrieval at scale, embeddings + Qdrant semantic ranking, the `/library` UI, the P-Cite live verification, the full re-trigger. Those are sequenced in the implementation plan for after your review.

This way the morning PR is **real, reviewable, green, and risk-free** (mock-backed, no keys, no prod touch), while the spec + plan define the full phase.

---

## 9. References (academic-researcher + ai-engineer)

Rashkin et al. 2023 (AIS); Gao et al. 2023 (ALCE); Liu/Zhang/Liang 2023 (verifiability audit); Min et al. 2023 (FActScore); RAGAS 2023; Huang et al. 2025 (factuality vs faithfulness); Wallat et al. 2025 (correct-but-unfaithful); Slobodkin et al. 2024 (Attribute-First, arXiv:2403.17104); arXiv:2509.21557 (Generation-time vs post-hoc); arXiv:2408.04568 (fine-grained grounded citations); Wineburg & McGrew 2019 + CRAAP (source quality). Full annotated list in `docs/l2-research/academic-researcher.md`.
