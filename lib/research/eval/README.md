# L2 Ingestion Bench

In-house eval settling two L2 picks at once (CEO/L2-inhouse-eval-plan-2026-06-03.html):
the general-web **search engine** (ADR 9) and the **embedding model** (D4). The same
modules are the first working prototype of the Phase-1 extractor tier + Phase-2
Qdrant ingestion path — not throwaway scripts.

## Reproduce

```bash
# 1. Sidecars: SearXNG (:8088 JSON) + Trafilatura (:8055). Jina = public r.jina.ai.
bun run eval:sidecars:up        # docker compose -f docker-compose.eval.yml up -d --build

# 2. Search eval: fan-out 4 engines x 15 queries -> extract -> Open PageRank ->
#    LLM judge (relevance/credibility) + deterministic groundability -> bands.
bun run eval:search             # writes out/{raw-search,extractions,search-results}.json

# 3. Embedding eval (D4): chunk extracted text -> judge labels relevant chunks ->
#    embed + retrieve per model -> Recall@5/MRR/nDCG@10 -> ingest into Qdrant.
bun run eval:embeddings         # writes out/embedding-results.json + Qdrant collections

# 4. Human-readable summary applying the §6 decision rules.
bun run eval:summary            # writes out/RESULTS-SUMMARY.md

# 5. CEO kappa: blank rating sheet + hidden answer key.
bun run eval:kappa-sheet        # writes out/kappa-rating-sheet.html + kappa-judge-scores.json
# ...founder opens the HTML, rates ~28 items, clicks "copy results as JSON", saves to a file:
bun run eval:kappa founder-ratings.json   # Cohen's kappa vs the answer key

bun run eval:sidecars:down      # tear down
```

## Layout
- `queries.ts` — frozen 3-topic x 5-query set.
- `../searxng.ts` `../braveSearch.ts` `../exa.ts` `../tavily.ts` — engine adapters.
- `../extract.ts` — Trafilatura primary, public Jina Reader fallback.
- `../openPageRank.ts` — domain-authority enrichment.
- `judge.ts` — Gemini LLM-as-judge (rubric scores + relevant-chunk labelling).
- `../embeddings/{clients,chunk,ingest,run-embeddings}.ts` — D4 eval + Qdrant path.
- `run-search.ts` `make-summary.ts` `make-kappa-sheet.ts` — orchestrators.
- `out/` — result bundles (extractions.json gitignored; it is large + regenerable).
