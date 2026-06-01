# L2 Research Spec — AI Engineer Domain: Grounded Generation & Provenance Threading

Author: AI Engineer (KnowledgeCore). Phase: L2 (speccing, research-only). Date: 2026-06-02.

Scope of this document: how the generation layer (Path Outliner, Information / lesson-content Generator, and the adjust_plan path) **consumes** a research bundle so output is grounded, how **every claim carries a real `sourceId`**, the **prompting / structured-output** design that binds claims to sources on Gemini, and the **re-trigger / amend** mechanism that detects a gap from Goalpost 1 and patches the bundle plus downstream content. This is my (generation + provenance) lane; source retrieval/ranking and the Library store schema are the Research Engineer's and Backend Engineer's lanes respectively, and I flag the seams where we must agree.

---

## 1. Principles & current state (what the code does today)

### 1.1 Where content is generated

There are **three generation seams**, all on Gemini via `lib/llm/gemini.ts` `completeStructured`:

| Seam | File | Output | Has `sourceIds`? |
|---|---|---|---|
| **Path structure (Call A)** | `lib/services/live/livePathOutliner.ts` | 3 goalposts: title, objective, the information-step `content`, the experience prompt | Information step payload hard-codes `sourceIds: []` (`livePathOutliner.ts:235`) |
| **Lesson content (Call B)** | `lib/services/live/liveLessonContentGenerator.ts` | Per-goalpost markdown + visual needs, profile-adapted, written when the learner enters the goalpost | `lib/journey/lessonGeneration.ts:127` writes `sourceIds: payload.sourceIds ?? []` — i.e. preserves whatever Call A seeded, which is `[]` |
| **adjust_plan remediation** | `lib/services/live/livePathAdjuster.ts` | Inserted remediation goalpost(s) | `livePathAdjuster.ts:272` defaults `sourceIds: step.sourceIds ?? []` |

**Conclusion:** `sourceId` is an *empty placeholder everywhere*. Generation today draws entirely on Gemini's parametric knowledge. The Step model docstring already reserves the contract: `information` payload = `{ content: string; sourceIds?: string[] }` (`prisma/schema.prisma:276`).

### 1.2 What infrastructure already exists (do not rebuild)

- **Research clients are written but UNWIRED.** `lib/research/{openalex,semanticScholar,tavily,firecrawl}.ts` are clean fetch wrappers returning typed results (title, abstract, authors, year, url, citationCount, openAccessPdf). Grep confirms **zero callers** in `app/` or `lib/` outside `lib/research/` itself. There is no Research Agent orchestrator, no bundle, no Library, no `Source` table.
- **Qdrant** (`lib/vector/qdrant.ts`) exposes a client + `ensureCollection(name, vectorSize, distance)`. Provisioned, unused, no embedding code anywhere.
- **Gemini structured output** is solid: Zod→Gemini `responseSchema` converter (`gemini.ts:153`), thinking disabled for schema calls, `STRUCTURED_OUTPUT_TOKEN_FLOOR=4096`, one retry on truncation. **Key constraint discovered:** the converter **cannot represent `z.record`, `z.unknown`, `z.any`, or mixed/non-literal `z.union`** — it throws loudly. Provenance schemas must be *closed* `z.object`/`z.array`/literal-enum shapes. This rules out an "open map of claim→sourceId" schema; we must use an **array of `{claimId/span, sourceIds}` rows**.
- **Implicit prompt caching** only (no explicit `caches.create`). The Gemini client's own TODO (`gemini.ts:90`) flags that **explicit context caching pays off "when a large shared prefix appears (L2 Research/Library)"** — the bundle is exactly that prefix. L2 should wire `ai.caches.create` for the bundle.
- **The LOCKED boundary** is `lib/services/types.ts`. `PathOutlinerInput`, `LessonContentInput`, `PathAdjusterInput` have **no bundle/source field**. L2 needs additive inputs; per the role rules these go through OPEN_QUESTIONS for CEO sign-off, but `LessonContentInput` and `PathConfirmationInput` precedent shows additive contracts *alongside* the locked file are acceptable (both were added in L1 without touching `types.ts`).

### 1.3 Model

Gemini (`gemini-3.5-flash` default, `GEMINI_MODEL` override). Structured output and inline multimodal (audio) already proven. Tool use is **not** yet used anywhere in the codebase — the L0 plan (`L0.md:133`) imagined "Sonnet 4.6 + tool use" for the Research Agent, but our as-built clients are direct fetch wrappers, so the Research Agent can be a **deterministic orchestrator that calls the typed clients in code** (no model tool-calling loop needed). That is simpler, cheaper, more testable, and avoids the no-LangChain rule entirely.

---

## 2. External SOTA (2026) — what to copy

### 2.1 Attribute-first beats generate-then-cite (the central design choice)

The most actionable 2025 result for us is **"Attribute First, then Generate" (Slobodkin et al., arXiv:2403.17104)**: decompose generation into (1) **content selection** — pick the specific source spans that will be used — then (2) **attributable generation** conditioned on those selected spans. Because the claim is generated *from* a pinned span, citation becomes a *generation constraint*, not a post-hoc guess; this is the failure mode that produces "cited source doesn't actually contain the claim." This maps cleanly onto our split: **bundle = the pre-selected, pre-chunked evidence; the generator may only write from chunks it cites.**

### 2.2 Generation-time vs post-hoc citation: use BOTH, in layers

"Generation-Time vs. Post-hoc Citation" (arXiv:2509.21557) measured the trade-off:
- **G-Cite** (cite while drafting): high citation *precision/correctness* (94% on FEVER) but low *coverage* (claims cite too few sources).
- **P-Cite** (draft, then attach/verify citations): much higher *coverage* (74–75%) and **lower hallucination in human eval (37% vs 41%)**, at moderate latency cost.
- Recommendation: **"retrieval-centric, P-Cite-first for high-stakes; reserve G-Cite for precision-critical claim verification."**

For a thesis product whose entire claim is academic integrity, the right design is **G-Cite at generation time** (the generator emits sourceIds inline per chunk it used — cheap because we already do one structured call) **plus a lightweight P-Cite verification pass** (a second, cheap structured call that checks each emitted claim↔source pair against the actual chunk text and drops/flags unfaithful ones). This gives precision from G-Cite and a faithfulness gate from P-Cite without a second full generation.

### 2.3 Faithfulness ≠ correctness; verify attribution explicitly

"Correctness is not Faithfulness in RAG Attributions" (Wallat et al., SIGIR ICTIR 2025) found **up to 57% of citations are post-rationalized** — the model had the answer from parametric memory and bolted on a plausible-looking citation. Mitigations we adopt:
1. **Closed-book-then-grounded discipline:** the generator is *told* the bundle is the only permitted evidence and that claims it cannot ground must be cut or hedged (mirrors our existing "this is the only place the learner receives information" prompt language).
2. **A verification pass** (NLI-style "does chunk X entail claim Y?") on a sample or all claim↔source pairs — the cheap second call in §2.2. TRACe / statement-decomposition style metrics (TREC 2025 RAG track: *Sentence-Support Rate*) are the eval target the QA Engineer can adopt.
3. **Span-level, not document-level, citation.** "Ground Every Sentence" (arXiv, interleaved reference-claim) and "Learning Fine-Grained Grounded Citations" (arXiv:2408.04568) both show sentence/span-level attribution materially raises faithfulness over whole-doc citation. Our bundle should be **chunked** so a `sourceId` points at a chunk, not just a paper.

### 2.4 Net pattern for KnowledgeCore

**Retrieve → chunk → select → attribute-first generate (G-Cite) → verify (P-Cite NLI gate) → persist claim-level provenance.** No LangChain; all deterministic orchestration in TS + two Gemini structured calls.

---

## 3. Proposed design

### 3.1 The bundle: shape and where it lives

A **core source material bundle** is produced **after path confirmation** (the natural trigger: `lib/services/pathConfirmation.ts` completes, path moves `draft → accepted` per `PathStatus`). It is the "large shared prefix" for all downstream generation in this journey.

Proposed bundle shape (Backend owns the table; I own the consumed shape):

```
Bundle {
  bundleId
  topicKey            // canonical subject → enables Library reuse across users
  chunks: Chunk[]
}
Chunk {
  sourceId            // STABLE id — this is the value that lands in Step.payload.sourceIds
  text                // the extracted passage (<= ~500 tokens) the generator may quote/paraphrase
  sourceMeta          // title, authors, year, url, venue, citationCount  (for display + the Library)
  provenanceTier      // "academic" (OpenAlex/SemScholar) | "web" (Tavily) | "extracted" (Firecrawl)
}
```

`sourceId` is the join key threaded end to end. The chunk `text` is what the generator is conditioned on — this is the "content selection" half of attribute-first.

**Library = persisted bundles keyed by `topicKey`.** Reuse: before researching, look up an existing bundle for the canonical subject; amend rather than rebuild. (Cross-user reuse + dedup is Backend/Research lane; I only require a stable `sourceId` and chunk `text` to read.)

### 3.2 Consuming the bundle in the Path Outliner (Call A)

Today `LivePathOutliner.outline` builds a plain-text user block from typed fields. Add a **BUNDLE block** the same way (no new prompt mechanic, just more context), and add a parallel **claim-provenance** field to the output schema.

Prompt additions to `SYSTEM`:
- "You are given a SOURCE BUNDLE: numbered chunks `[S1] … [Sn]`, each with an id. The information content you write MUST be grounded in these chunks. Every substantive claim must be traceable to at least one chunk id. Do not introduce facts absent from the bundle; if the bundle is thin on a needed point, write conservatively and mark it."
- "Output, alongside the information `content`, a `citations` array mapping each claim to the chunk id(s) that support it."

Structured-output design (respecting the Gemini converter limits in §1.2 — **no maps, closed objects only**):

```ts
// added to schemas.ts informationStepSchema (or a sibling)
const citationSchema = z.object({
  claim: z.string().min(1),        // the exact sentence/claim as written in `content`
  sourceIds: z.array(z.string()).min(1), // chunk ids [S1..Sn] supporting it
});
// information step now also emits:
citations: z.array(citationSchema)
```

We do **not** ask the model to inline `[S1]` markers inside the markdown (brittle to parse, pollutes the learner-facing prose). Instead the model emits the prose `content` AND a structured `citations[]` whose `claim` strings are verbatim spans of `content`. Code then:
1. Resolves each `claim`'s `sourceIds` (the `[S1]`-style ids) back to real Library `sourceId`s.
2. Computes the **union of resolved sourceIds** → that is `Step.payload.sourceIds` (replaces the `[]` at `livePathOutliner.ts:235`).
3. Optionally persists the per-claim map in the payload (`{ content, sourceIds, claimMap }`) for the verification pass and for a future "highlight a sentence → see its source" UI (L3 door, not built).

### 3.3 Consuming the bundle in the Lesson Content Generator (Call B)

This is the **primary grounding seam** because in L1 the real, profile-adapted prose is authored here lazily per goalpost. `LiveLessonContentGenerator.generate` already takes `LessonContentInput`; add (additively, OPEN_QUESTION for the locked-boundary review):

```ts
// lessonContent.ts LessonContentInput, additive:
bundleChunks?: { sourceId: string; text: string; meta: {...} }[];
```

`lessonGeneration.ts ensureLessonContent` already loads goalpost + intent; it would also load the journey's bundle (by `intentId`/`topicKey`) and pass the **relevant chunks** (Research lane may pre-select per-goalpost; otherwise pass all and let the model select). The generator's `SYSTEM` gets the same attribute-first instruction and the same `citations[]` output addition as §3.2. The result write at `lessonGeneration.ts:124` changes from `sourceIds: payload.sourceIds ?? []` to the **union of resolved sourceIds from the citations array**.

This is also where **explicit Gemini context caching** earns its keep: the bundle chunks are a large, stable prefix shared across all 3 goalposts of a journey. Wire `ai.caches.create` on the bundle (the TODO at `gemini.ts:90` anticipated exactly this), key by `bundleId`, so goalposts 2 and 3 bill the bundle at the cached rate.

### 3.4 The P-Cite verification gate (faithfulness)

After generation, a **second cheap structured call** (purpose `provenance_verify`, new `LlmCallPurpose`) takes each `{claim, chunkText[]}` pair and returns a closed schema:

```ts
z.object({ verdicts: z.array(z.object({
  claimIndex: z.number().int(),
  supported: z.boolean(),     // does the chunk entail the claim?
  confidence: rubricLevelSchema, // reuse 0..4 literal union (converter-safe)
})) })
```

Policy on `supported: false`: **drop the sourceId for that claim** (do not let an unfaithful citation persist) and, if a claim ends up with zero supported sources, flag it (telemetry + optionally soften the sentence). This is the §2.3 mitigation against post-rationalized citations. Keep it best-effort/non-fatal like every other telemetry path in the codebase — a verification failure must never break the journey spine (same contract as `ensureLessonContent`'s swallow-and-keep).

### 3.5 The re-trigger / amend mechanism (the hard part)

**Goal:** GP1's checkpoint reveals an important gap → form a *targeted* research request → fetch + chunk only the missing material → **merge** into the existing bundle → regenerate only the affected downstream content. Targeted, never full re-research.

The trigger already exists: the Checkpoint Evaluator emits `decision ∈ {advance, repeat, adjust_plan}` with a `rationale` and 6-dimension `scores`. The natural hook is the **`adjust_plan` branch** — which today calls `LivePathAdjuster`. L2 inserts a **bundle-amend step before/alongside** the path adjustment:

```
GP1 evaluation (adjust_plan, low conceptual/transfer, rationale="missing prerequisite X")
   │
   ▼
[1] Gap-extraction call  (structured): rationale + scores + currentGoalpost
        → { needsResearch: bool, gapQueries: string[], gapConceptKeys: string[] }
   │ needsResearch?
   ▼ yes
[2] Targeted research (Research lane): run gapQueries through the SAME clients,
        chunk results, dedup against existing bundle.chunks by sourceId
   │
   ▼
[3] Bundle merge: append new chunks → bundle (Library updated under topicKey)
   │
   ▼
[4] Path Adjuster (existing) runs WITH the augmented bundle in context →
        inserted remediation goalpost is now GROUNDED; its information step gets
        real sourceIds from the new chunks (replaces livePathAdjuster.ts:272 [])
   │
   ▼
[5] Downstream regeneration: any not-yet-generated goalpost whose conceptKey
        intersects gapConceptKeys is marked stale (clear contentGeneratedAt) so
        Call B re-authors it from the augmented bundle on entry. Already-completed
        goalposts are left untouched.
```

Design notes:
- **Step [1] gap-extraction** is a new tiny structured call. It reuses the data the Path Adjuster already receives (`PathAdjusterInput`: rationale, scores, currentGoalpost, remainingGoalposts). It decides *whether* a bundle gap exists (vs. a pure learner-effort issue, which stays `repeat` and needs no research). This keeps re-research **targeted**: only `adjust_plan` with `needsResearch=true` triggers it.
- **Step [3] merge is additive** — append+dedup, never rebuild. The `topicKey` keys the Library so the amendment persists and benefits future learners on the same topic (the "important gap" becomes part of the canonical bundle).
- **Step [5] staleness via `contentGeneratedAt`** reuses the *existing* idempotency marker in `lessonGeneration.ts:89`. Clearing it for affected goalposts is the entire "regenerate downstream" mechanism — no new state machine. Completed goalposts (already have artifacts) are never regenerated; this respects the "70% intact" Path Adjuster principle at the content layer too.
- **GP2 adaptation (L1 tie-in):** when GP2 is generated, Call B already injects the learner profile (mastery/signals from GP1). Adding the bundle (now possibly amended) to that same call means **GP2 = (GP1 learnings via profile) + (bundle via context)** exactly as the founder described, with no new orchestration.

### 3.6 Provenance threading summary (the `sourceId` lifecycle)

```
OpenAlex/SemScholar/Tavily/Firecrawl result
  → chunk.sourceId  (stable, minted at bundle build)
  → bundle in Library (keyed by topicKey)
  → injected as [S1..Sn] into Path Outliner / Lesson Generator / Path Adjuster prompts
  → model emits citations[] referencing [Sn]
  → P-Cite verify gate drops unfaithful pairs
  → resolved + verified sourceIds written to Step.payload.sourceIds  (was [])
  → (door for L3) per-claim claimMap enables highlight→source
```

---

## 4. Exact code seams to change

| # | File:line | Change |
|---|---|---|
| 1 | `lib/services/live/livePathOutliner.ts:235` | Replace `sourceIds: []` with union of resolved+verified ids from a new `citations[]` output; add BUNDLE block to the user message and grounding rules to `SYSTEM`. |
| 2 | `lib/services/live/schemas.ts` (`informationStepSchema`, `lessonContentResultSchema`) | Add `citationSchema` and a `citations: z.array(...)` field — closed objects only (Gemini converter forbids maps; see `gemini.ts:206,239`). |
| 3 | `lib/services/live/liveLessonContentGenerator.ts:124` + `lib/services/lessonContent.ts` | Add `bundleChunks` to `LessonContentInput`; add grounding rules + BUNDLE block; emit `citations[]`. |
| 4 | `lib/journey/lessonGeneration.ts:124-127` | Load the journey bundle, pass chunks in, and write the verified sourceId union instead of `sourceIds ?? []`. |
| 5 | `lib/services/live/livePathAdjuster.ts:272` | Pass augmented bundle in context; resolve inserted-goalpost `sourceIds` from the new chunks instead of `[]`. |
| 6 | `lib/llm/gemini.ts:90-104` | Implement explicit context caching (`ai.caches.create/get`) keyed by `bundleId` for the large bundle prefix (the TODO already names L2). |
| 7 | NEW `lib/research/agent.ts` (Research lane) | Deterministic orchestrator: route query → clients → chunk → mint sourceIds → bundle. Plus `amend(gapQueries)`. No model tool-loop. |
| 8 | NEW `lib/services/live/liveProvenanceVerifier.ts` (my lane) | The P-Cite NLI gate (§3.4). |
| 9 | `prisma/schema.prisma` (Backend lane) | `Source` / `Bundle` / `BundleChunk` tables + `topicKey`; new `LlmCallPurpose` values `bundle_build`, `provenance_verify`, `gap_extract`. The `Step` docstring contract (`:276`) already matches. |
| 10 | `lib/services/types.ts` (LOCKED) | Bundle inputs are additive — surface via OPEN_QUESTIONS for CEO sign-off (precedent: `lessonContent.ts`, `pathConfirmation.ts` added additively in L1). |

---

## 5. Top risks & open questions

1. **Gemini structured-output cannot express maps or non-literal unions** (`gemini.ts:206,239`). All provenance schemas MUST be closed objects/arrays/literal-enums. The `claim↔sourceIds` design is an **array of rows**, not a map, specifically because of this. Confirmed from the code, not assumed.
2. **`claim` strings must be verbatim spans of `content`** for the verifier to align them. The model may paraphrase its own claims. Mitigation: instruct verbatim, and fuzzy-match (normalized substring) in code; fall back to whole-paragraph attribution if alignment fails. Open: accept paragraph-level granularity when span alignment is low-confidence?
3. **Latency budget.** L0.md gives Information Generator <8s, Path Outliner <20s. Adding a verification call + a larger (bundle) prompt risks the budget. Mitigations: explicit context caching for the bundle prefix; run the verifier async/best-effort (don't block first render); verify a sample, not every claim, on the hot path. Open: is async post-hoc verification (flag-then-correct) acceptable, or must the gate be synchronous before the learner sees content?
4. **Faithfulness vs. arbitrary topics.** Learners pick any topic; for niche/non-academic topics the academic clients may return thin bundles, pushing the generator toward parametric fallback (the 57% post-rationalization risk). Open: when the bundle is too thin to ground a goalpost, do we (a) widen to Tavily web, (b) explicitly tell the learner "this section is model-generated, not sourced," or (c) block generation? My recommendation: (a) then (b) — never silently pretend ungrounded prose is sourced.
5. **`sourceId` stability across Library reuse/amend.** Dedup on amend must not re-mint ids for already-cited chunks, or persisted `Step.payload.sourceIds` go dangling. Backend/Research lane: sourceIds must be content-addressed (hash of url+chunk-offset) or otherwise stable. Flagging as a cross-lane contract.
6. **Locked boundary.** `PathOutlinerInput` / `PathAdjusterInput` need a bundle field. Whether to extend the locked `types.ts` or carry the bundle via additive sibling inputs (L1 precedent) is a CEO decision → OPEN_QUESTION.
7. **Gap-extraction precision (re-trigger).** Misclassifying a pure learner-effort failure as "needs research" wastes a research cycle and inserts an unnecessary remediation goalpost. The gap-extraction call must be conservative (default `needsResearch=false`); QA needs fixtures distinguishing "missing prerequisite in the material" from "learner didn't apply it."

---

## Sources

- Slobodkin et al., *Attribute First, then Generate: Locally-attributable Grounded Text Generation* — https://arxiv.org/pdf/2403.17104
- *Generation-Time vs. Post-hoc Citation: A Holistic Evaluation of LLM Attribution* — https://arxiv.org/html/2509.21557v2
- Wallat et al., *Correctness is not Faithfulness in Retrieval Augmented Generation Attributions* (SIGIR ICTIR 2025) — https://staff.fnwi.uva.nl/m.derijke/wp-content/papercite-data/pdf/wallat-2025-correctness.pdf
- *CiteGuard: Faithful Citation Attribution for LLMs via Retrieval-Augmented Validation* — https://arxiv.org/pdf/2510.17853
- *Learning Fine-Grained Grounded Citations for Attributed Large Language Models* — https://arxiv.org/pdf/2408.04568
- *Ground Every Sentence: Improving Retrieval-Augmented LLMs with Interleaved Reference-Claim Generation* — https://www.researchgate.net/publication/392496934
- ALCE benchmark, Gao et al. — https://ar5iv.labs.arxiv.org/html/2305.14627
- TREC 2025 RAG Track (Sentence-Support Rate / nugget metrics) — https://pages.nist.gov/trec-browser/trec34/rag/proceedings/
