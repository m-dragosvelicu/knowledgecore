# Retrieval-layer qrels

Ground truth for the retrieval layer of the layered eval bench (CEO plan §5,
`reading-room/eval-metrics-verification-2026-08-07.html`, ratified): "Retrieval
layer: nDCG/Recall@k/MRR against a synthetic qrels set built from known
RAG-library chunks."

## What this is

A **qrels set** (query relevance judgments) maps each query id to the ids of
the chunks a judge marked as directly relevant, out of a topic-scoped
candidate pool. `nDCG@k`, `Recall@k`, `MRR` are all computed against this set:
retrieve top-k chunk ids for a query, check them against
`relevantChunkIds`.

## How it is constructed (honest method statement)

1. **Corpus**: per topic, extracted web-page text is chunked with the same
   ~512-token paragraph-packed scheme already used by the D4 embedding eval
   (`../../embeddings/chunk.ts`, unchanged, reused as-is). This is
   "known RAG-library chunks" in the sense the CEO plan means: real
   passage-sized text the L2 pipeline could actually ingest, not hand-written
   synthetic sentences.
2. **Labelling**: a single LLM judge (Gemini, `labelRelevantChunks` in
   `../judge.ts`, temperature 0) reads a query plus its topic's full
   candidate-chunk pool and returns the ids of chunks that directly answer the
   query at the stated learner level. This is the exact same function and
   prompt the already-ratified D4 embedding eval used for its 15-query ground
   truth — this module scales that same pattern to the 78-query set
   (`QUERIES` + `QUERIES_V2`).
3. **Guard**: any chunk id the judge returns that is not in the candidate pool
   it was shown (a hallucinated id) is dropped before the entry is stored.

## Cross-check status — read before citing this as validated ground truth

**This is single-LLM-judge silver labelling, not human-verified, and there is
currently no independent second-judge or human cross-check at the chunk
level.** This is an honest limitation carried over unchanged from the D4 eval
(which also used one judge, unchecked, for its chunk labels) — scaling the
query count does not by itself add a validation step. Two things exist
elsewhere in this codebase that are related but NOT the same thing and should
not be cited as if they cover this:

- The CEO kappa mechanism (`../make-kappa-sheet.ts`, `eval:kappa`) measures
  agreement between the judge and a human rater, but only for the *search
  result* relevance/credibility rubric (`RubricScore` in `../judge.ts`), not
  for chunk-level qrels labels.
- `../judge-validation/` (owned by a parallel work stream on this Story, not
  touched here) validates judge robustness on a *perturbation* corpus, not on
  qrels labels specifically.

**Recommendation for whoever wires the harness**: before reporting
Recall@k/MRR/nDCG@k numbers as a bench result (not just a smoke check), spot
check a sample of qrels entries by hand, or extend the kappa mechanism to
cover chunk-level relevance labels. Until then, treat retrieval-layer numbers
built from this module as directional, same caveat the layered-bench report
already applies to any single-model LLM-as-judge signal.

## Layout

- `types.ts` — `QrelsEntry` / `QrelsSet`.
- `corpus.ts` — build a topic's chunk pool, either from a real
  extractions/raw-search bundle (`buildTopicCorpusFromExtractions`,
  `buildAllTopicCorpora`) or from raw text for tests
  (`buildCorpusFromTexts`). No network I/O.
- `build.ts` — `buildQrelsForQuery` / `buildQrelsSet`: calls
  `../judge.ts`'s `labelRelevantChunks` and shapes the result.
- `metrics.ts` — `recallAt` / `mrr` / `ndcgAt` (duplicated intentionally from
  `../../embeddings/run-embeddings.ts`; see the comment in that file for why
  it isn't imported directly).
- `smoke.ts` — `bun run lib/research/eval/qrels/smoke.ts`. n=2 synthetic
  corpus, one live judge call, proves the pipeline runs end to end without
  running the full bench.

## Not yet wired here (harness's job)

This module does not fetch web content and does not run the 78-query set. A
real run needs, per topic in `TOPICS_V2`: a `run-search.ts`-style
fetch+extract pass over `QUERIES_V2` writing `extractions.json`/
`raw-search.json` in the existing shape, then
`buildAllTopicCorpora(TOPICS_V2, QUERIES_V2, rawSearch, extractions)` ->
`buildQrelsSet(client, QUERIES_V2, corpora)` -> embed + retrieve per model
(reusing `../../embeddings/clients.ts`) -> `metrics.ts`. Left for whoever
builds the harness layer so this Task doesn't spend API budget on a full run.
