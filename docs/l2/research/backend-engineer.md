# L2 Backend Engineer — Persistence, Data Flow & Library Storage Architecture

Spec-only research note for L2 (Research Agent, Provenance & the Library).
Author: Backend Engineer. Date: 2026-06-02. Status: RESEARCH ONLY — no code changes.

Scope boundary: this note owns PERSISTENCE, DATA FLOW, and LIBRARY STORAGE. It does
NOT design the research source clients (OpenAlex/Semantic Scholar/Tavily/Firecrawl —
that is research-engineer), the embedding/generation prompts (ai-engineer), or the
provenance UI (ux-frontend). Where those domains touch persistence, I define the
SEAM only and flag the open question.

---

## 0. Executive summary

- **Vector store: keep Qdrant** (STACK_DECISIONS ADR 5 is binding and already
  provisioned, idle, in `lib/vector/qdrant.ts`). Do NOT switch to pgvector. But the
  *authoritative record* of every Source, ResearchBundle, and Library entry lives in
  **Postgres/Prisma**; Qdrant holds only embedding vectors + a thin payload that
  points back to Postgres rows. Postgres is the source of truth; Qdrant is a
  derived, rebuildable index.
- **Reuse/dedup model: topic-level, content-addressable.** A `ResearchBundle` is
  keyed by a normalized **topic fingerprint** (a deterministic hash of the canonical
  subject + outcome shape). Sources are deduped globally by **DOI / canonical URL**.
  A bundle is owned by no single user — it is referenced from a journey via a join
  row, so the same research is reused across users and later made public.
- **Lifecycle integration: research runs at path-confirm**, inside (or fired by)
  `acceptPathAction` in `app/(app)/journey/_actions.ts`, BEFORE goalpost 1. It is the
  one transition the founder named ("after the learner confirms the journey path").
  Generation (existing Call A / Call B) then reads the bundle and writes real
  `sourceIds` instead of today's `[]` placeholder.
- **Re-trigger/amend** is a targeted, persisted operation: a `BundleAmendment` row
  records the gap that triggered it and the sources added, so the bundle grows
  monotonically and the re-trigger is idempotent and auditable.
- **Latency strategy** (founder flagged slow resume/loads): research is the slow
  step, so it runs ONCE per topic and is cached by fingerprint; second learner on the
  same topic pays zero research cost. Generation stays lazy per-goalpost (the L1
  Call-B pattern already in place). Resume never re-runs research — it reads the
  already-stored bundle.

---

## 1. Principles & direction (current state)

### 1.1 What persists today

The relational model (`prisma/schema.prisma`) is a clean journey aggregate:

```
User
  └─ LearningIntent (aggregate root, status FSM: created → … → in_progress → complete)
       ├─ Subject (canonicalName, scopeNote)          1:1
       ├─ LearningGoal (motivation, outcome drafts)    1:1
       ├─ ExpectedOutcome (canDoStatements JSON)       1:1
       ├─ KnowledgeAssessment (competencies JSON)      1:1
       ├─ LearnerProfile (+ append-only snapshots)     1:1   (L1)
       └─ LearningPath                                 1:1
            └─ Goalpost[]  (order, status)
                 └─ Step[]  (type, payload JSON)
                      payload.information = { content, sourceIds?: string[] }  ← the seam
```

`Step.payload.sourceIds` already exists in the type system and is written as `[]`
everywhere today:
- `lib/journey/lessonGeneration.ts:127` → `sourceIds: payload.sourceIds ?? []`
- `lib/services/live/livePathOutliner.ts:235` → `sourceIds: []`
- `lib/services/mock/*` and `livePathAdjuster.ts` → all `[]`

**This is the provenance hook L2 fills.** `sourceIds` becomes a list of `Source.id`
values, and the persistence layer must guarantee referential integrity between a
step's claimed sources and the bundle the journey is bound to.

### 1.2 The service boundary

`lib/services/types.ts` is LOCKED (changes need a PM Decision doc). It is the right
boundary: L2 adds new ADDITIVE service contracts (a `ResearchAgent` interface owned
by research-engineer, and a `BundleStore`/persistence helper owned by me) ALONGSIDE
the locked file, exactly as L1 did with `lib/services/lessonContent.ts`,
`visualMedia.ts`, `transcription.ts`. No signature on the locked interface changes.

`getServices()` (`lib/services/index.ts`) is a default-to-live registry keyed on a
single Gemini key, with per-service `LIVE_*` opt-out flags and graceful mock
fallback. The Research Agent must register the same way (mock returns a fixed canned
bundle so the journey runs offline / in CI without hitting OpenAlex).

### 1.3 The idle Qdrant

`lib/vector/qdrant.ts` is fully provisioned: a singleton REST client (`QDRANT_URL`,
optional `QDRANT_API_KEY`, ports 6433/6434 per `.env.example`) and an
`ensureCollection(name, vectorSize, distance="Cosine")` helper. It is imported
nowhere in the live path today. L2 is its first real consumer. Cosine + a single
collection is the right default for dense retrieval over source chunks.

### 1.4 Binding stack decisions (do not relitigate)

- ADR 5: **Qdrant**, separate service, chosen over pgvector deliberately for
  separation of concerns and hybrid (dense+sparse) search. To switch to pgvector I
  would have to file an OPEN_QUESTION; I am NOT proposing that — see §2.1.
- ADR 9: research stack is **OpenAlex (primary) → Semantic Scholar (secondary) →
  Tavily + Firecrawl (fallback)**. OpenAlex returns DOIs + structured authorship,
  which is exactly what the provenance schema below stores as first-class columns.
- ADR 3/4: **Prisma 6 + Postgres 16**, JSONB for semi-structured LLM output.

---

## 2. External SOTA (2026) and the choices it forces

### 2.1 Qdrant vs pgvector — given we already have BOTH available

We have Postgres (could add the `pgvector` extension) AND a running Qdrant. The 2026
consensus for a thesis-scale RAG/provenance system:

| Concern | pgvector (in Postgres) | Qdrant (separate) | Verdict for L2 |
|---|---|---|---|
| Operational simplicity | One DB, one backup, one pool | Extra service to run/monitor | pgvector wins, but… |
| Hybrid (dense+sparse/BM25) | Bolt-on, awkward | Native | Qdrant wins |
| Payload filtering at scale | SQL `WHERE` (great) | Native payload filters (good) | tie |
| Transactional consistency with journey data | Same tx as Prisma writes | Eventually consistent, separate write | pgvector wins |
| Thesis defensibility ("why a real vector DB") | "I used a column" | "purpose-built, metrics" | Qdrant wins |
| Already provisioned + ADR | needs new extension + migration | already wired, ADR-blessed | **Qdrant wins** |

**Decision: keep Qdrant, but make Postgres authoritative.** The decisive factor is
not raw capability (at thesis scale both are fine) — it is that ADR 5 is binding and
Qdrant is already provisioned and idle. Switching to pgvector would burn a Decision
doc and contradict a written ADR for marginal gain.

The critical SOTA pattern that resolves the consistency concern: **do not store any
ground truth in Qdrant.** Qdrant holds `{ id, vector, payload:{ sourceId, chunkId,
bundleId, topicFingerprint } }`. Every byte is reconstructable from Postgres. If
Qdrant is wiped, a re-index script replays chunks from Postgres. This removes the
"two databases drift" failure mode that usually argues for pgvector — the vector DB
is a disposable cache, the relational DB is the system of record.

### 2.2 Storing sources + embeddings — the content-addressable pattern

SOTA for grounded-generation systems in 2026 (and the cheapest path given the
founder's latency/cost pressure) is **content-addressable storage of research
artifacts**:

- A *source* is identified by its natural global key: **DOI** when present (academic,
  via OpenAlex), else a **canonicalized URL** (strip tracking params, normalize
  host/scheme), else a SHA-256 of the fetched normalized text. This makes source
  dedup global and automatic — two journeys that both cite the same paper share one
  `Source` row.
- A *chunk* (the unit that gets embedded) is content-addressed by
  `sha256(sourceId + normalizedChunkText)`, so re-embedding the same chunk is a
  no-op and embedding spend is paid once per distinct chunk ever.
- A *research bundle* is addressed by a **topic fingerprint** (see §3.3), so the
  expensive online research for a topic is computed once and reused by every later
  learner on that topic. This is the founder's "topic-level reuse" requirement,
  realized as a cache key.

### 2.3 Idempotent retrieval reuse across users

The reuse rule is a simple read-through cache keyed by topic fingerprint:

```
on path-confirm(topic):
  fp = fingerprint(subject, outcome)
  bundle = SELECT ResearchBundle WHERE topicFingerprint = fp AND status = ready
  if bundle exists:                      # cache HIT — zero research cost
      bind journey → bundle (join row)
  else:                                  # cache MISS
      bundle = create ResearchBundle(fp, status=researching)
      bind journey → bundle
      enqueue/run Research Agent  → fills Sources, Chunks, embeddings, status=ready
```

A **unique constraint on `topicFingerprint`** makes concurrent path-confirms for the
same new topic safe: the second `create` fails the unique check, catches, and re-reads
the winner's bundle. That is the idempotency guarantee, enforced by the DB, not by
application luck.

### 2.4 Embedding model + dimension note (seam for ai-engineer)

Qdrant collections are fixed-dimension. The embedding model choice (dimension, and
whether dense-only or dense+sparse hybrid) is ai-engineer's call, but it has a
PERSISTENCE consequence: the chosen dimension is baked into `ensureCollection(name,
vectorSize)`. Persist the model id + dimension on the `ResearchBundle` (or a small
`EmbeddingConfig` singleton) so a future model change can create a v2 collection
without corrupting the v1 vectors. OPEN QUESTION O-3.

---

## 3. Proposed schema + Qdrant usage

All new tables are ADDITIVE; no existing column changes except writing real values
into the already-present `Step.payload.sourceIds`. Migration is local-only
(`bunx prisma migrate dev`), no prod DB exists (ADR 4: local Docker Postgres).

### 3.1 `Source` — a single citable artifact, globally deduped

```prisma
enum SourceKind {
  academic   // OpenAlex / Semantic Scholar work (has DOI)
  web        // Tavily/Firecrawl page (official docs, vendor sites)
}

enum SourceStatus {
  fetched    // metadata + text retrieved
  failed     // upstream error; kept for audit, not used for grounding
}

/// A globally-deduped citable source. Owned by NO user — shared across bundles and
/// journeys. Dedup key is the natural global identity (DOI → canonical URL → text hash).
model Source {
  id            String       @id @default(cuid())
  kind          SourceKind
  status        SourceStatus @default(fetched)

  /// Global dedup key. DOI when present, else canonicalized URL, else sha256(text).
  /// UNIQUE: the same paper/page is one row no matter how many bundles reference it.
  dedupKey      String       @unique

  /// First-class provenance fields (ADR 9 — OpenAlex gives these structured).
  doi           String?
  canonicalUrl  String?
  title         String
  authors       Json?        // [{ name, ... }]
  venue         String?
  publishedYear Int?
  retrievedAt   DateTime     @default(now())

  /// Normalized full text / extracted content kept for re-chunk / re-embed.
  /// May be large; truncate per a documented cap. Postgres TEXT/JSONB is fine at scale.
  rawText       String?      @db.Text

  chunks        SourceChunk[]
  bundleLinks   BundleSource[]

  createdAt     DateTime     @default(now())

  @@index([kind, status])
  @@index([doi])
}
```

### 3.2 `SourceChunk` — the embeddable unit, mirrored into Qdrant

```prisma
/// The unit that gets embedded and retrieved. Content-addressed so re-embedding is
/// a no-op. The vector itself lives in QDRANT, not here — this row is the relational
/// anchor Qdrant payloads point back to (Postgres = source of truth).
model SourceChunk {
  id          String  @id @default(cuid())
  sourceId    String
  source      Source  @relation(fields: [sourceId], references: [id], onDelete: Cascade)

  ordinal     Int     // position within the source
  text        String  @db.Text

  /// sha256(sourceId + normalizedText). Re-chunking the same content is idempotent.
  contentHash String  @unique

  /// Mirror flag: true once the vector is upserted into Qdrant. Lets a re-index
  /// script find unembedded chunks without asking Qdrant. NULL embeddedAt = pending.
  embeddedAt  DateTime?

  createdAt   DateTime @default(now())

  @@index([sourceId, ordinal])
}
```

Qdrant side (single collection, e.g. `source_chunks`, dimension = embedding model
dim, Cosine):

```
point.id      = SourceChunk.id          // 1:1 with the Postgres row
point.vector  = embedding(chunk.text)
point.payload = { sourceId, bundleIds: string[], topicFingerprint, doi?, kind }
```

Payload carries `bundleIds`/`topicFingerprint` so retrieval can FILTER to the
journey's bound bundle(s) — a learner only retrieves over sources in their bundle,
which is both correct (provenance scoping) and faster (smaller candidate set).

### 3.3 `ResearchBundle` — the topic-level reuse unit

```prisma
enum BundleStatus {
  researching  // Research Agent running; sources being filled
  ready        // usable for grounding
  failed       // research failed; journey falls back to ungrounded generation
}

/// "Core source material bundle" for ONE topic. Owned by no user. Reused across
/// journeys/users via BundleSource + JourneyBundle. Content-addressed by topic.
model ResearchBundle {
  id               String       @id @default(cuid())

  /// Deterministic hash of the canonical topic (see fingerprint() below). UNIQUE so
  /// concurrent path-confirms for the same topic converge on one bundle (idempotent).
  topicFingerprint String       @unique

  /// Human-readable echo of what was fingerprinted (debug / Library browse).
  topicLabel       String
  status           BundleStatus @default(researching)

  /// Embedding model id + dimension this bundle's vectors were built with (so a
  /// model change can branch to a new collection without corrupting old vectors).
  embeddingModel   String?
  embeddingDim     Int?

  /// L2-extensibility toward public/shared Library (founder: "becomes public later").
  /// Default false in L2; flipping it later needs no schema change.
  isPublic         Boolean      @default(false)

  sources          BundleSource[]
  journeys         JourneyBundle[]
  amendments       BundleAmendment[]

  createdAt        DateTime     @default(now())
  updatedAt        DateTime     @updatedAt

  @@index([status])
}

/// M:N join — a source can belong to many bundles (global dedup), a bundle has many sources.
model BundleSource {
  bundleId  String
  bundle    ResearchBundle @relation(fields: [bundleId], references: [id], onDelete: Cascade)
  sourceId  String
  source    Source         @relation(fields: [sourceId], references: [id], onDelete: Cascade)

  /// Why this source is in this bundle (which goalpost/objective it grounds). Lets a
  /// targeted amendment add sources scoped to one goalpost without touching others.
  scopeNote String?
  addedAt   DateTime @default(now())

  @@id([bundleId, sourceId])
  @@index([sourceId])
}

/// M:N — binds a journey to the bundle(s) it draws provenance from. THIS is the
/// reuse seam: two users on the same topic both point at one ResearchBundle.
model JourneyBundle {
  intentId  String
  intent    LearningIntent @relation(fields: [intentId], references: [id], onDelete: Cascade)
  bundleId  String
  bundle    ResearchBundle @relation(fields: [bundleId], references: [id], onDelete: Cascade)
  boundAt   DateTime @default(now())

  @@id([intentId, bundleId])
  @@index([bundleId])
}
```

`LearningIntent` gains one back-relation: `bundles JourneyBundle[]`. No other change
to the existing aggregate. (Whether to also keep a 1:1 "primary bundle" pointer is
OPEN_QUESTION O-1; the M:N is the safe superset.)

### 3.4 `BundleAmendment` — the re-trigger/amend record

```prisma
/// A targeted re-trigger of the Research Agent because a GAP was found (e.g. GP1
/// generation lacked grounding for a claim). Records the gap and what was added so
/// the bundle grows MONOTONICALLY and the re-trigger is auditable + idempotent.
model BundleAmendment {
  id            String         @id @default(cuid())
  bundleId      String
  bundle        ResearchBundle @relation(fields: [bundleId], references: [id], onDelete: Cascade)

  /// What was missing (free-text or structured gap descriptor). The founder's
  /// "amend specific parts (targeted)" — scoped, not a full re-research.
  gap           String
  /// Optional pointer to the goalpost whose generation surfaced the gap.
  goalpostId    String?

  /// Source ids added by this amendment (audit: the bundle diff).
  addedSourceIds Json          @default("[]")
  createdAt     DateTime       @default(now())

  @@index([bundleId, createdAt])
}
```

### 3.5 The provenance write — filling `sourceIds`

No schema change. After generation, the information step's payload becomes:

```
payload.information = { content, sourceIds: [Source.id, ...], contentGeneratedAt, ... }
```

Persistence-side invariant to ENFORCE (in the write helper, not the DB — JSON can't
FK): every id written into `sourceIds` MUST be a `Source` reachable from a
`BundleSource` of a bundle the journey is bound to (`JourneyBundle`). A small
validation in the lesson-persistence path rejects/scrubs dangling ids. This is the
backend's contribution to provenance integrity; the claim→source *matching* itself
is ai-/research-engineer's generation concern.

---

## 4. Lifecycle integration — where research runs

```
Wizard (unchanged):
  intent → subject → outcome → knowledge probe → generatePathAction (Call A, structure)
                                                       status = path_outlined
  ┌─────────────────────────────────────────────────────────────────────┐
  │ PATH CONFIRM  ← the founder's "after the learner confirms the path"  │
  │ acceptPathAction (app/(app)/journey/_actions.ts:538)                 │
  │   1. fp = fingerprint(subject, outcome)                              │
  │   2. read-through cache (§2.3): bind JourneyBundle → bundle          │
  │      - HIT  : bundle ready, zero research cost                       │
  │      - MISS : create bundle(status=researching), fire Research Agent │
  │   3. status = in_progress; activate goalpost 1; redirect            │
  └─────────────────────────────────────────────────────────────────────┘
        │
        ▼  (lazy, on goalpost entry — existing L1 Call-B pattern)
  ensureLessonContent (lib/journey/lessonGeneration.ts)
    reads the bound, READY bundle → generates GP content → writes real sourceIds
        │
        ▼  GP2 adapts from GP1 learnings + the SAME bundle (no re-research)
        │
        ▼  gap found in GP1?
  re-trigger: BundleAmendment(gap, goalpostId) → Research Agent adds scoped sources
             → bundle grows → regenerate ONLY the affected step
```

### 4.1 Why path-confirm, and the plumbing

`acceptPathAction` is already the single gate from the public path overview into
goalpost 1 (it also enforces the account gate via `requireRealUserId`). It is the
exact "path confirmed" moment. The minimal-change plumbing:

1. Compute fingerprint + do the read-through bind synchronously (cheap — two indexed
   queries). This guarantees the journey is bound to a bundle before goalpost 1.
2. On cache miss, the actual online research is the slow part. Two options
   (OPEN_QUESTION O-2): (a) **inline/awaited** — simplest, but blocks the confirm
   click for the research duration (bad for the founder's latency complaint on a
   cold topic); (b) **fire-and-forget / background** — return immediately with the
   bundle in `researching`, and the goalpost page waits on `status=ready` (reusing
   the existing "Getting things ready" loading state). I recommend (b): research is
   bundle-scoped, not blocking, and the loading surface already exists. Note: no
   cron/queue infra exists today (state.ts does inactivity transitions lazily on
   read); a true background job would be the first such thing. A pragmatic L2 path is
   to drive research from the goalpost-1 entry the same lazy way Call-B is driven,
   gated on bundle status — no new infra.

### 4.2 Re-trigger persistence

The amend is targeted: write a `BundleAmendment`, run the agent for just the gap,
upsert the new `Source`/`SourceChunk`/`BundleSource` rows (dedup applies — a source
already present is reused), then regenerate only the affected step. Because sources
are append-only and globally deduped, an amend never invalidates prior grounding; it
strictly grows the bundle. Idempotent on `(bundleId, gap)` if we add a dedup guard
(O-4).

---

## 5. Migration plan (local only)

1. Add the five new models + two enums + the `LearningIntent.bundles` back-relation
   to `prisma/schema.prisma`.
2. `bunx prisma migrate dev --name l2_research_bundle_library` (local Docker
   Postgres per ADR 4; no prod DB exists, so no prod migration risk).
3. `bunx prisma generate`.
4. Add a one-time `ensureCollection("source_chunks", <dim>, "Cosine")` bootstrap
   (idempotent — the helper already no-ops if the collection exists). Run it from a
   `scripts/` bootstrap or lazily on first upsert.
5. Add the mock `ResearchAgent` to `getServices()` returning a fixed canned bundle so
   CI / offline runs never call OpenAlex (mirrors every other service's mock).
6. Backfill is unnecessary: existing journeys keep `sourceIds: []` (ungrounded,
   exactly as today). L2 grounding applies to journeys confirmed after the migration.

No `Step` payload migration needed — `sourceIds` already exists and defaults empty.

---

## 6. Cost & latency strategy

- **Research once per topic.** The topic-fingerprint cache is the single biggest
  lever: the Nth learner on a topic pays zero research/embedding cost. This directly
  answers the founder's slow-load concern for any non-novel topic.
- **Embedding spend paid once per distinct chunk** (content-hash dedup); re-embedding
  is a no-op.
- **Qdrant retrieval filtered by bundle** keeps the candidate set tiny → low latency
  at generation time.
- **Resume never re-researches.** Resume reads the bound bundle; the slow path
  (online research) is strictly a cold-topic, first-confirm event.
- **Generation stays lazy per goalpost** (existing Call-B), so confirm doesn't pay
  for content the learner may never reach.
- **Telemetry:** research + embedding calls should record `LlmCall`-style rows for
  cost accounting. The `LlmCallPurpose` enum would need new values
  (`research_query`, `embed_chunk`) — that is an enum addition (ai-engineer owns the
  enum content; I own the migration). OPEN_QUESTION O-5.

---

## 7. Top risks & open questions

| # | Risk / question | Recommendation |
|---|---|---|
| R-1 | **Two-store drift** (Postgres vs Qdrant). | Postgres is sole source of truth; Qdrant payloads are derived + rebuildable via a re-index script keyed on `SourceChunk.embeddedAt IS NULL`. |
| R-2 | **No background-job infra** exists; research is slow. | Drive research lazily on goalpost-1 entry gated on `bundle.status` (same pattern as Call-B), OR add the first real job. O-2. |
| R-3 | **Topic fingerprint collisions / over-sharing.** Too-coarse a fingerprint reuses a bundle for genuinely different intents; too-fine kills reuse. | Start with `normalize(subject.canonicalName) + outcome bloom-shape`; make the fingerprint function versioned and unit-tested. O-6. |
| R-4 | **Provenance integrity** — generation could emit `sourceIds` not in the bundle. | Backend validates/scrubs `sourceIds` against the journey's bound `BundleSource` set on write. |
| R-5 | **L3 extensibility** (user uploads + highlight-to-ask). | `Source.kind` enum and the M:N bundle joins extend cleanly (add `kind=user_upload`, an owner FK on those rows only). Do NOT design it now; the schema does not block it. |
| O-1 | Keep M:N `JourneyBundle` only, or also a 1:1 primary-bundle pointer? | M:N now; add a denormalized primary pointer only if a query needs it. |
| O-2 | Inline-await vs lazy/background research on cache miss? | Lazy on goalpost-1 entry, gated on status (reuse existing loading UI; no new infra). Needs PM sign-off. |
| O-3 | Embedding model + dimension? (fixes Qdrant collection size) | ai-engineer to pick; persist model+dim on the bundle so a change branches a v2 collection. |
| O-4 | Amendment idempotency key. | Add a dedup guard on `(bundleId, gap)` or a content hash of the gap. |
| O-5 | New `LlmCallPurpose` values for research/embedding telemetry. | Add `research_query`, `embed_chunk`; ai-engineer owns naming, I own the migration. |
| O-6 | Exact `fingerprint()` definition (the reuse contract). | Versioned, deterministic, unit-tested; cross-team (research-engineer + me). |

---

## 8. What I am NOT speccing (other roles)

- The Research Agent's query routing / source selection / OpenAlex+SemanticScholar+
  Tavily+Firecrawl orchestration → **research-engineer**.
- The embedding model, the claim→source matching prompt, generation grounding →
  **ai-engineer**.
- Provenance display / "where this came from" UI and the Library browse surface →
  **ux-frontend**.
- Eval of grounding faithfulness → **qa-engineer**.

My deliverable is the persistence shape, the reuse/dedup contract, the Qdrant-vs-
Postgres split, and the lifecycle write points that connect them.
