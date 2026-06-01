# L2 — Research Agent, Provenance & the Library — Implementation Plan

**Date:** 2026-06-02 · **Companion to:** `2026-06-02-l2-research-agent-design.md`
**Status:** DRAFT for founder review. Phase 0 built autonomously overnight as a PR; Phases 1–6 await your go.

Sequencing principle: land the **spine first behind a mock** (no API keys, no embeddings, no prod, green CI), then layer live retrieval, embeddings/Qdrant, verification, re-trigger, and UI. Each phase is independently shippable to `development` via PR.

---

## Phase 0 — Spine behind a mock (BUILT TONIGHT → PR)

Goal: prove `path-confirm → bundle → grounded generation → real sourceIds` end to end with zero external dependencies.

1. **Schema + migration (local only).** Add to `prisma/schema.prisma`: `Source`, `SourceChunk`, `ResearchBundle`, `BundleSource`, `JourneyBundle`, `BundleAmendment`; enums `SourceKind`, `SourceStatus`, `BundleStatus`; `LearningIntent.bundles` back-relation. `bunx prisma migrate dev --name l2_research_bundle_library` + `prisma generate`.
2. **Service contract (additive, alongside locked `types.ts`).** New `lib/services/research.ts` defining `ResearchAgent` (`research(topic) → Bundle`, `amend(bundleId, gapQueries) → Bundle`) and `BundleStore` persistence helper. Register in `getServices()` with a **mock** returning a fixed canned bundle (2–3 fake but well-formed sources + chunks). `LIVE_RESEARCH` opt-out flag, default mock in Phase 0.
3. **Fingerprint.** `lib/research/fingerprint.ts` — versioned, deterministic `fingerprint(subject, outcome)`; unit tested (collision + stability cases).
4. **Bind at path-confirm.** In `acceptPathAction`: compute fingerprint, read-through cache, create+bind `JourneyBundle`. On miss, create bundle and (Phase 0) fill it from the mock synchronously.
5. **Provenance threading.** Add closed `citationSchema` + `citations[]` to `schemas.ts`; thread `bundleChunks` additively into `LessonContentInput`; load the bound bundle in `lessonGeneration.ts`; replace `sourceIds: []` at the three seams with the resolved union. Backend `sourceIds` validation/scrub against the journey's bound `BundleSource` set.
6. **Tests + gates.** Fingerprint units; dedup unit; a journey test asserting non-empty `sourceIds` after a goalpost generates against the mock; `bun run typecheck` + `bun run build` green.

Acceptance: a mock-backed journey produces information steps whose `sourceIds` reference real `Source` rows in the bound bundle. No keys, no network, no prod.

---

## Phase 1 — Live source layer (needs OpenAlex key — BLOCKER R1)

1. Migrate `openalex.ts` from `mailto` to `OPENALEX_API_KEY` + credit-aware backoff.
2. `lib/research/router.ts` (classify → route → expand → finalize), `credibility.ts` (academic + web scorers, documented params), `crossref.ts` (DOI finalizer — file the Decision record).
3. `lib/research/bundle.ts` real assembly: per-goalpost query set from goalpost title/objective + weak competencies; dedup → score → coverage map.
4. Flip `LIVE_RESEARCH` on; mock stays for CI. QA fixtures for the three named topics (default mode network, lean manufacturing, Art Nouveau) to test academic↔web fall-through.

---

## Phase 2 — Embeddings + Qdrant retrieval (needs embedding-vendor decision — BLOCKER R2)

1. `lib/research/embeddings.ts` thin wrapper (default Gemini per D4; swappable).
2. `ensureCollection("source_chunks", <dim>, "Cosine")` bootstrap; persist `embeddingModel`+`embeddingDim` on the bundle.
3. Chunk + embed on assembly; content-hash dedup so re-embedding is a no-op.
4. `lib/research/rank.ts` snippet/passage retrieval filtered by bound bundle; feed top-k per concept into generation.

---

## Phase 3 — Latency: background research + liveness (D10)

1. Drive cold-topic research lazily on goalpost-1 entry gated on `bundle.status` (no new infra), GP1 sync / GP2+ background-fill.
2. Liveness copy on the `GettingReady` screen during `researching` (also fixes `bug_getting_ready_static`).
3. Gemini explicit context caching on the bundle prefix (`gemini.ts:90`).

---

## Phase 4 — Faithfulness gate (P-Cite)

1. `lib/services/live/liveProvenanceVerifier.ts` — NLI claim↔chunk check, closed schema, drops unfaithful citations, best-effort/non-fatal.
2. New `LlmCallPurpose` values (`research_query`, `embed_chunk`, `provenance_verify`, `gap_extract`).
3. Thin-bundle policy: widen to web, else explicitly mark a section ungrounded — never fake sourcing.

---

## Phase 5 — Re-trigger / amend on `adjust_plan`

1. Gap-extraction structured call (conservative; default `needsResearch=false`).
2. Targeted `amend()` (dedup against existing bundle, append-only, `BundleAmendment` row, idempotency guard on the gap).
3. Path Adjuster runs with the augmented bundle; clear `contentGeneratedAt` only for affected goalposts.

---

## Phase 6 — Provenance & Library UX

1. Per-goalpost "Sourced from" panel (`.kc-meta` voice, `VisualMedia` pattern).
2. Read-only `/library` route (deduped source index + source detail + per-journey sources).
3. Rename journeys page "Your library" → "Your journeys"; reserve "Library".
4. Stretch: inline `[n]` hovercards via a custom react-markdown token (only if bindings are reliable; never widen the sanitizer).

---

## Phase 7 — Evaluation (thesis)

Citation recall/precision (ALCE), faithfulness-to-bundle (RAGAS), source-quality score; LLM-as-judge entailment + founder dual-rating (Cohen's kappa, batched with CHARTER C.2). Headline: L0 recall = 0 vs L2 measured X% against the ~51%/74% bar.

---

## Cross-cutting

- No LangChain. Bun. Academic/credible sources only. Additive contracts only; locked `types.ts` changes go through OPEN_QUESTIONS.
- QA sign-off gates "done" per role rules; no PM "complete" without QA.
- All work on feature branches → PR into `development` (never direct-merge without the founder phrase).
