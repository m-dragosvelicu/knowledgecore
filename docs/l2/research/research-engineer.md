# L2 Source Layer — Research-Engineer Spec (research only, no code)

**Author:** Research Engineer · **Date:** 2026-06-02 · **Phase:** L2 (Research Agent, Provenance & the Library) · **Status:** SPEC — do not implement.
**Scope of this doc:** the Research Agent's **source layer** (`lib/research/`) — which sources to use, how to route, how to score/rank, how citations are extracted, and how the "core source material bundle" is assembled, stored, and re-triggered. LLM clients, generator prompts, schema migrations, and the thesis literature review are explicitly OUT of my domain (owned by ai-engineer / backend-engineer / academic-researcher).

> Hard governance reminder (from `STACK_DECISIONS.md` #9 and `WORKSPACE.md`): the source hierarchy is **binding** — OpenAlex primary, Semantic Scholar secondary, Tavily + Firecrawl web fallback only. The CEO explicitly rejected "ready and dumb" generic web sources. No new source class enters without a Decision record. No LangChain (founder rule). Academic/credible sources only. Bun preferred.

---

## 1. Principles & direction (what the codebase forces on the design)

These are constraints I extracted from the repo and docs that the source layer MUST respect.

1. **Open topics, by design.** Learners pick arbitrary subjects (the live prompts name *default mode network*, *lean manufacturing*, *Art Nouveau*). The source layer cannot assume a STEM/paper-shaped world. Some topics are paper-rich (neuroscience), some are practitioner/encyclopedic (lean manufacturing → standards, case studies), some are humanities/visual (Art Nouveau → museums, encyclopedias). **Routing must degrade gracefully to credible web** for non-academic topics, and that path is exactly what Tavily/Firecrawl are sanctioned for.

2. **`sourceIds` is the provenance seam, and it is empty today.** The schema docstring (`prisma/schema.prisma`, `Step`) defines the information payload as `{ content: string; sourceIds?: string[] }`. Every place that writes information content writes `sourceIds: []`:
   - `lib/services/live/livePathOutliner.ts:235` (Call A, path structure seed)
   - `lib/journey/lessonGeneration.ts:127` (Call B, the real lesson content — `sourceIds: payload.sourceIds ?? []`)
   - the live/mock path adjuster and outliner mocks, and the verify scripts.
   L2's job is to **make `sourceIds` real**: populate it with stable identifiers into the Library, and let the generators (ai-engineer) ground claims against the bundle. I own producing the bundle and the IDs; I do not own the generator prompt that consumes them.

3. **Generation is already two-phase, and the bundle slots cleanly into it.** Call A (`LivePathOutliner.outline`) builds the 3-goalpost structure up front; Call B (`ensureLessonContent`) authors the real lesson content lazily **when the learner enters a goalpost**, idempotently (guarded by `contentGeneratedAt`). The founder's L2 vision maps onto this exactly:
   - **Research runs once the path is confirmed/accepted** (between path acceptance and the first Call B). `LearningPath.acceptedAt` / `status` (`PathStatus`) is the natural trigger boundary — `verify-path-confirmation.ts` shows the pre-acceptance gate already exists and that `acceptedAt == null` until the learner clicks "Looks good, start".
   - **GP1 is generated grounded in the bundle** (Call B for goalpost order 1 reads the bundle).
   - **GP2 adapts from GP1 learnings + the bundle** — the L1 `LearnerProfile` already feeds Call B (`readOrCreateProfile`), so adaptation reads profile + bundle together.
   - **Re-trigger / amend** is a *targeted* second research pass, not a full redo — driven by a checkpoint-revealed gap (see §3.5).

4. **Telemetry discipline is already a house style.** Every live service records an `LlmCall` row (purpose enum, tokens, cost in microUSD, latency, success). Research API calls are not LLM calls, but the source layer should mirror this discipline with its own lightweight call/usage logging so rate-limit and outage behaviour is observable (the bundle build can hit 4 upstreams). A new `LlmCallPurpose` value (e.g. `research_bundle`) for any LLM-side query-expansion/snippet-selection call is a backend-engineer schema decision; flag it, don't add it.

5. **Qdrant is provisioned but has ZERO callers.** `lib/vector/qdrant.ts` exposes a client + `ensureCollection`, but nothing in `lib/`, `app/`, or `scripts/` imports it (verified by grep). There is **no embedding client anywhere** — deps include `@anthropic-ai/sdk` and `@qdrant/js-client-rest` only; no Voyage/OpenAI/`text-embedding` import exists. So "use Qdrant for the bundle" is greenfield and needs an embedding-provider decision (see §3.4 + Risk R3). The relational store already holds all journey artefacts; the vector store is meant for "retrieval over external knowledge" (STACK_DECISIONS #5) — i.e. exactly the Library's source chunks.

6. **Source-quality is the differentiator** (ROLE.md): the value proposition is *grounded, credible* content. The ranking/credibility heuristics (§2.4) are the part of this layer that most defends the thesis claim, more so than raw recall.

7. **L3 door, kept shut.** User uploads and highlight-to-ask are L3. The Library schema should not *preclude* a future `origin = upload` source kind, but I design nothing for it here.

---

## 2. External SOTA (2026): the source stack, routing, and heuristics

### 2.1 The four sanctioned upstreams (current state, verified 2026)

| Tier | Source | Role | Why / current API facts (2026) | Repo client |
|---|---|---|---|---|
| **Primary** | **OpenAlex** | Academic discovery + structured metadata | ~250M+ works, free REST, `search` spans title/abstract/**fulltext** (subset, see `has_fulltext`), returns DOI + structured authorship + `cited_by_count` + `open_access.oa_url`. Abstracts come as an **inverted index** (legal constraint), already reconstructed in our client. **MAJOR 2026 CHANGE:** the polite pool / `mailto` is gone, replaced by **credit-based rate limits**, and an **API key is REQUIRED from 13 Feb 2026** (singleton = 1 credit, list = 10 credits). | `openalex.ts` (needs key migration, R1) |
| **Secondary** | **Semantic Scholar (S2 Graph API)** | Citation graph + paper recommendations for follow-up queries | No key required, but key raises limits. Unauthenticated is a **shared** pool (throttled, unreliable under load); a project key grants ~1 RPS. Gives `paper/search`, `openAccessPdf`, and `recommendations/forpaper/{id}` (already wired). Best used for *expansion* ("find adjacent seminal work to this OpenAlex hit"), not first-pass recall. | `semanticScholar.ts` (OK) |
| **Fallback** | **Tavily** | Credible-web search for non-academic topics + doc/standard pages | LLM-oriented search API; returns ranked results with a relevance `score` and optional `raw_content`. Use ONLY when the topic is non-academic or OpenAlex/S2 return thin results. **Do not** use Tavily's image results for displayed images (license-unknown — already flagged in WORKLOG; that's the L1 Openverse line, not L2). | `tavily.ts` (OK) |
| **Fallback** | **Firecrawl** | Fetch + clean a *specific* chosen URL into markdown/JSON | v2 `/scrape` returns markdown/HTML and supports **schema-guided JSON** (`formats: [{type:"json", schema}]`, ~5 credits) to pull structured fields (title, author, publish date, citations) from a page. `/extract` can search-and-extract without a URL but overlaps Tavily — prefer scrape-a-known-URL to stay cheap and deterministic. | `firecrawl.ts` (scrape only; JSON-mode is an enhancement, R5) |

All four clients already exist as thin typed `fetch` wrappers (no SDK, no LangChain) — the founder rule is already honoured. What is missing is everything *above* the clients: routing, ranking, citation normalization, bundle assembly, persistence.

### 2.2 Two more sources worth a Decision record (recommended additions)

The hierarchy is binding, but two gaps justify a Decision doc rather than silent omission:

- **Crossref REST API (recommended, low-risk).** OpenAlex *sources from* Crossref, but Crossref is the authoritative DOI metadata registry and is excellent for **citation normalization / verification** — given a DOI or a fuzzy title, return canonical title, authors, container-title (venue), issued date. Use it as a **provenance-finalizer**, not a discovery source: after I pick a work, resolve its DOI through Crossref to lock down the citation string the provenance UI shows. This directly strengthens the "every claim traceable" story and is keyless (polite via `mailto` header still works for Crossref; key/Plus optional). It does NOT violate the hierarchy because it's metadata cleanup, not a competing search tier. **No `lib/research/crossref.ts` exists yet.**
- **arXiv (optional, niche).** For fast-moving CS/physics/math topics, arXiv has preprints OpenAlex may index slowly. But arXiv's API is rate-limited to **1 request / 3 seconds**, single connection, XML (Atom) responses — operationally heavier and narrow. **Recommendation: defer.** OpenAlex already indexes most arXiv works with DOIs. Only add if a CS-heavy demo topic exposes a recall gap. Flag as open question, don't build.

### 2.3 Routing logic (which source for which query)

A deterministic **classify → route → expand → finalize** pipeline. No LLM is required for the classifier, but a cheap LLM query-expansion step is allowed (it would be an ai-engineer-owned call; I define the contract).

```
confirmed path  ──►  per-goalpost query set (from title+objective+weak competencies)
                         │
                  (1) CLASSIFY topic-academicness
                         │   signals: subject canonicalName/scopeNote, outcome bloom levels,
                         │   and a cheap probe — run OpenAlex search; if it returns
                         │   N>=K results with mean cited_by_count above a floor → "academic".
                         ▼
          ┌──────────────┴───────────────┐
       ACADEMIC                       NON-ACADEMIC / PRACTITIONER
          │                                  │
   (2a) OpenAlex search (primary)     (2b) Tavily search (credible web)
          │  rank works (§2.4)               │  rank results by score + domain credibility
   (3a) S2 expand: recommendations          │
        for top works → fill gaps           ▼
          │                          (3b) Firecrawl scrape the chosen URLs → clean markdown
          ▼                                  │
   (4) Crossref finalize DOIs/citations  ◄───┘  (finalize: capture publisher, author, date)
          │
          ▼
   assemble CORE SOURCE MATERIAL BUNDLE (§3.2) → Library
```

Routing rules, concretely:
- **Default to OpenAlex first** for every topic (it's the cheapest credible probe and doubles as the academicness classifier). Only fall through to Tavily when OpenAlex recall is thin or the topic is clearly non-scholarly (e.g. a branded tool, a hobby, a current-events subject).
- **S2 is expansion-only**, never first-pass — it's throttled and its strength is the citation graph (`getRecommendations`), used to pull adjacent seminal works for a confirmed OpenAlex hit.
- **Firecrawl only scrapes URLs already chosen** by OpenAlex `oa_url` / S2 `openAccessPdf` / Tavily results — it is never a discovery tool. This keeps web fetching deterministic and within the "fallback only" mandate.
- **Crossref runs on the final shortlist only** (DOI normalization), so its traffic is tiny.
- **Re-trigger queries** (§3.5) reuse the same pipeline but scoped to a single concept/gap, with the existing bundle as a dedup/exclusion set.

### 2.4 Source-quality / credibility heuristics (the differentiator)

A transparent, documented scoring function — *no opaque ML*, mirroring the project's BKT-style "documented parameters" ethos (`LearnerProfile`). Two scorers:

**Academic credibility score** (for OpenAlex/S2 works):
- **Citation signal** — `cited_by_count`, but *age-normalized* (citations per year since `publication_year`) so a strong 2024 paper isn't buried by a mediocre 1990 one.
- **Recency vs. canon balance** — keep a small quota of recent works AND a quota of high-citation canonical works; a learner bundle wants both the textbook backbone and the current view.
- **Open-access bonus** — prefer works with `open_access.oa_url` / `openAccessPdf` so the snippet/fulltext is actually fetchable and the learner can follow the link (closed paywalls are weak provenance). Net the OA filter is available as `open_access.is_oa:true`.
- **Has-abstract / has-fulltext gate** — a work with no abstract is near-useless for grounding; deprioritize hard.
- **Venue/author presence** — authorship structured fields present (non-empty) as a light quality signal.

**Web credibility score** (for Tavily/Firecrawl results — needed *because* the web is the risky tier):
- **Domain allowlist tiers**: `.edu` / `.gov` / known encyclopedic (e.g. Stanford Encyclopedia of Philosophy, Britannica), standards bodies, and official vendor docs score high; SEO/content-farm and UGC domains score low or are dropped.
- **Tavily relevance `score`** as the base, multiplied by the domain tier.
- **Publish-date presence** (extracted via Firecrawl JSON mode) — undated web pages are weaker provenance.
- **Hard reject** anything that can't be attributed to an identifiable publisher/author — consistent with "no ready-and-dumb web."

**Snippet ranking (within a chosen source):** once a work/page is selected, the *passage* that grounds a specific claim is what matters for provenance. Rank candidate passages by lexical+semantic similarity to the goalpost objective and weak competencies. This is where embeddings (Qdrant) earn their keep: chunk the abstract/fulltext/scraped markdown, embed, and at generation time the generator (or a retrieve step) pulls the top-k passages per concept. The passage offset/quote is stored so the provenance UI can show the exact grounding text.

**Citation extraction / normalization:** prefer structured upstream fields over parsing (OpenAlex/S2 give DOI, authors, year, venue directly). Firecrawl JSON-mode pulls author/date/publisher from web pages. Crossref finalizes a clean citation string from the DOI. Build one normalized `Citation` shape (`{ doi?, title, authors[], year?, venue?, url, oaUrl?, retrievedAt }`) so provenance rendering is source-agnostic.

---

## 3. Current state + the build plan

### 3.1 What exists in the repo right now (verified)

- **Clients (done, thin):** `lib/research/{openalex,semanticScholar,tavily,firecrawl}.ts` + `index.ts` barrel. Typed, no SDKs, env-keyed. **No router, no ranking, no persistence, no bundle, no Crossref, no arXiv.**
- **Provenance seam (placeholder):** `sourceIds: string[]` defined on the information-step payload; written empty in `livePathOutliner.ts`, `lessonGeneration.ts`, mocks, and verify scripts. **Nothing produces real source IDs.**
- **Generation phases (done):** Call A `LivePathOutliner.outline`; Call B `ensureLessonContent` (idempotent, profile-fed, lazy at goalpost entry).
- **Trigger boundary (done):** path acceptance via `LearningPath.acceptedAt` / `PathStatus`; pre-acceptance revision loop verified in `scripts/verify-path-confirmation.ts`.
- **Vector store (provisioned, unused):** `lib/vector/qdrant.ts` (client + `ensureCollection`), **zero callers**, **no embedding client in the project**.
- **Env keys staged:** `OPENALEX_EMAIL`, `SEMANTIC_SCHOLAR_API_KEY`, `TAVILY_API_KEY`, `FIRECRAWL_API_KEY`, `QDRANT_URL`, `QDRANT_API_KEY` all in `.env.example`. **Missing: `OPENALEX_API_KEY` (now mandatory), `CROSSREF_MAILTO`, and an embedding-provider key.**

### 3.2 The "core source material bundle" — proposed shape

A bundle is the per-path researched, organized set of sources produced once the path is confirmed. Proposed conceptual shape (final schema is backend-engineer's call; this is the contract I need):

```
SourceBundle (1:1 with LearningPath, or topic-keyed for reuse — see §3.6)
  ├─ bundleId, pathId / topicKey, builtAt, version
  ├─ Source[]                      // the deduped, ranked, credibility-scored set
  │    ├─ sourceId (stable, this is what fills Step.sourceIds)
  │    ├─ origin: "openalex" | "s2" | "web"   // (L3 reserves: "upload")
  │    ├─ Citation { doi?, title, authors[], year?, venue?, url, oaUrl?, retrievedAt }
  │    ├─ credibilityScore + the component sub-scores (transparent/auditable)
  │    └─ Passage[] { text, charOffset, embeddingId (Qdrant point id) }
  └─ coverageMap: weakCompetency/goalpost-objective → [sourceId...]   // grounding plan
```

Two stores, clean boundary (matches STACK_DECISIONS #5):
- **Relational (Postgres/Prisma):** the bundle metadata, sources, citations, coverage map. This is the auditable provenance record and what `Step.sourceIds` references.
- **Vector (Qdrant):** one collection of **passage embeddings**, payload = `{ sourceId, bundleId/topicKey, goalpostHint }`. Used for snippet retrieval at generation time and for the re-trigger gap search.

### 3.3 Bundle assembly flow (on path acceptance)

1. Build the **per-goalpost query set** from each goalpost `title` + `objective` + the path's weak competencies (`KnowledgeAssessment.competencies` with `estimatedLevel <= 1`, the same gap signal `LivePathOutliner` already computes).
2. Run the **classify→route→expand** pipeline (§2.3) per query; collect candidate sources.
3. **Dedup** (by DOI, then normalized title, then URL host+path), **score** (§2.4), keep top-N per goalpost with the recency/canon quota.
4. **Finalize** citations via Crossref for any DOI-bearing source.
5. **Chunk + embed** abstracts/fulltext/scraped markdown into Qdrant passages.
6. Build the **coverageMap** (which sources ground which weak competency / objective) so Call B can be told "ground GP-k against these sourceIds."
7. Persist the bundle; **return source IDs keyed by goalpost** so Call A/Call B can stamp `Step.sourceIds`.

**Timing decision (open, §Risks R2):** building the *whole* bundle synchronously on acceptance adds latency to the "Looks good, start" moment (and the existing "Getting things ready" loading state is already flagged as feeling frozen — MEMORY `bug_getting_ready_static`). Recommended: research **GP1 deeply and synchronously** (it's needed first), and build the rest of the bundle **in the background** before the learner reaches GP2 — symmetric with the existing lazy Call B pattern. This keeps the confirm→start path snappy.

### 3.4 Embeddings — the missing piece

There is no embedding client. For snippet ranking and re-trigger retrieval, one is required. Options (no LangChain, Bun-friendly, thin fetch wrapper like the existing clients):
- **Voyage AI** (`voyage-3` family) — strong retrieval quality, simple REST; my lean recommendation for quality.
- **OpenAI `text-embedding-3-small/large`** — cheap, ubiquitous, simple REST.
- **Gemini embeddings** — the project already uses Gemini for generation (`lib/llm/gemini.ts`, `GEMINI_MODEL`), so reusing that provider minimizes new keys/vendors.
This is a **stack decision** (new vendor + key + cost), so it needs a Decision record and CEO input — I will not pick unilaterally. Whatever is chosen, the Qdrant collection `vectorSize` must match the model's dimension (`ensureCollection(name, vectorSize)` already takes it).

### 3.5 Re-trigger / amend flow (targeted, not full re-research)

When GP1's checkpoint reveals an important gap, the agent amends the bundle for *that gap only*:
- **Trigger:** a `CheckpointEvaluation` with weak dimension scores / a recalibration flag (`KnowledgeAssessment.recalibrationFlags` already exists for "the initial estimate was off"), or the Path Adjuster surfacing a missing concept. The exact trigger contract is shared with ai-engineer (who owns the evaluator/adjuster).
- **Action:** run the §2.3 pipeline scoped to the single gap concept, passing the **existing bundle as an exclusion/dedup set** (don't re-fetch what's already there), and **append** new sources + passages to the same bundle (version-bump, never destroy prior provenance — append-only mirrors the `LearnerProfileSnapshot` ethos).
- **Result:** the amended sources get new `sourceId`s; the next Call B for the affected/downstream goalpost grounds against the enlarged coverage map. This is cheap (one concept, dedup-guarded) and respects the "targeted, not full redo" requirement.

### 3.6 The Library + topic-level reuse

The founder wants the Library "architected for topic-level reuse across users (public/shared later)." Design implication for the source layer:
- Key bundles (or at least the source/passage records) by a **normalized topicKey** (derived from `Subject.canonicalName` + scope), not solely by `pathId`, so a second learner on the same topic can **reuse** the researched sources instead of re-paying the API cost. The per-path bundle then becomes a *view*/selection over shared topic sources plus the path-specific coverage map.
- This is the single most consequential schema decision and is **backend-engineer-owned**; I provide the dedup key and the reuse semantics (sources are topic-scoped and shareable; coverage maps are path-scoped and private). Keep it as an explicit Library-architecture question, not an L2-source-layer assumption.
- Sharing/public exposure is later; for L2 the requirement is only that the schema **doesn't preclude** reuse (don't hard-bind a source row to one user/path).

### 3.7 Proposed file layout (for when build is greenlit — not built now)

```
lib/research/
  openalex.ts        (exists) + migrate mailto → API key (R1)
  semanticScholar.ts (exists)
  tavily.ts          (exists)
  firecrawl.ts       (exists) + optional JSON-mode for web citation fields (R5)
  crossref.ts        (NEW) citation finalizer/normalizer
  router.ts          (NEW) classify → route → expand
  credibility.ts     (NEW) transparent scoring (academic + web), documented params
  rank.ts            (NEW) snippet/passage ranking (uses embeddings + Qdrant)
  bundle.ts          (NEW) assembly orchestration → Library persistence
  embeddings.ts      (NEW) thin embedding-provider wrapper (vendor TBD, §3.4)
  types.ts           (NEW) Source, Citation, Passage, SourceBundle contracts
```

---

## 4. Top risks & open questions (for the spec gate)

| # | Risk / question | Impact | Recommendation |
|---|---|---|---|
| **R1** | **OpenAlex now REQUIRES an API key (from 13 Feb 2026) and dropped the polite pool / `mailto`.** Our `openalex.ts` only sends `mailto`. | The *primary, binding* source breaks/throttles without migration. | Add `OPENALEX_API_KEY`; migrate the client to key auth + credit-aware backoff. Pre-build blocker. |
| **R2** | Synchronous full-bundle build at path acceptance adds latency to an already-frozen-feeling "Getting things ready" moment. | Worsens a known UX bug; long confirm→start wait. | Research GP1 sync, background-fill GP2+ (mirror lazy Call B). |
| **R3** | **No embedding client exists; vendor undecided.** Snippet ranking + re-trigger retrieval depend on it. | Blocks Qdrant use → blocks high-quality provenance grounding. | CEO/stack Decision: Voyage vs OpenAI vs reuse-Gemini. Qdrant `vectorSize` follows the choice. |
| **R4** | **Topic-level reuse is a schema decision I don't own.** Bundle keyed by path vs topicKey changes everything downstream. | Re-architecture cost if decided late. | Decide topicKey + reuse semantics *before* persistence is built; backend-engineer-owned, I supply the dedup key. |
| **R5** | Web-tier provenance is the weakest link (undated/unattributable pages); Firecrawl JSON-mode + domain-tier scoring mitigate but cost credits. | Provenance story is only as strong as its worst source. | Hard-reject unattributable web; enable Firecrawl JSON-mode only on the shortlist. |
| **R6** | S2 unauthenticated pool is a shared throttle; arXiv is 1 req/3s. | Flaky expansion under demo load. | Get an S2 project key; defer arXiv unless a CS demo exposes a recall gap (Decision record). |
| **R7** | Open topics → some have thin academic coverage (Art Nouveau, lean manufacturing). | Hierarchy says academic-first, but academic-first can return little. | The classifier's fall-through to credible web is essential and sanctioned; document the academicness threshold (`K`, citation floor) and have QA test it on the three named topics. |
| **R8** | Rate-limit / credit cost of building a 3-goalpost bundle across 4 upstreams per learner. | Cost + outage exposure at scale. | Topic-level reuse (R4) is the main lever; add per-upstream call telemetry mirroring `LlmCall` discipline. |

**Definition of done for me (per ROLE.md):** QA signs off on routing correctness against test queries (incl. the three named open topics) and on credibility-heuristic outputs before PM reports complete. No "done" without QA via PM.
