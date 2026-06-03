# L2 Ingestion Bench — Results Summary

Generated 2026-06-03T12:35:16.420Z. Judge model: `gemini-3.5-flash`. Directional bench: 15 learner queries x 3 topics x 4 engines; extraction success 284/294. Not the thesis-grade C.1 study.

## Search engine (ADR 9)

**Winner: tavily** — Highest grounding-quality useful% (81.3%, band Best).

Useful = relevance>=1 AND credibility(PageRank-adjusted)>=1 AND groundability>=1 AND (relevance==2 OR credibility==2). Bands: Poor <40% | Mid 40-60% | Good 60-80% | Best >80% (of scored top-5 useful).

### Overall (top-5 scored per query)
| Engine | Useful% | Band | mean Rel | mean Cred | mean Ground | mean latency | vs Tavily |
|---|---|---|---|---|---|---|---|
| tavily | 81.3% | Best | 1.78 | 1.61 | 1.75 | 1028ms | +0.0pp |
| exa | 77.3% | Good | 1.63 | 1.75 | 1.68 | 1059ms | -4.0pp |
| searxng | 73.3% | Good | 1.73 | 1.49 | 1.88 | 1746ms | -8.0pp |
| brave | 68% | Good | 1.68 | 1.52 | 1.79 | 880ms | -13.3pp |

### Per-topic useful% (band)
| Engine | default mode network | lean manufacturing | Art Nouveau |
|---|---|---|---|
| tavily | 76% (Good) | 96% (Best) | 72% (Good) |
| exa | 68% (Good) | 88% (Best) | 76% (Good) |
| searxng | 72% (Good) | 92% (Best) | 56% (Mid) |
| brave | 64% (Good) | 84% (Best) | 56% (Mid) |

## Embedding model (D4)

**Embedding winner (D4): gemini-embedding-001 (Gemini Embedding)**

Default per §6 (no new key, simplest); not decisively beaten.

Corpus: 180 chunks (default mode network: 60, lean manufacturing: 60, Art Nouveau: 60). Chunk scheme: {"targetTokens":512,"overlapTokens":64,"tokenApprox":"words / 0.75 (English heuristic, no tokenizer dep)","unit":"paragraph-packed with sentence-split fallback"}. Ground truth: 15 of 15 queries had >=1 judge-labelled relevant chunk.

| Model | dim | Recall@5 | MRR | nDCG@10 | $/1M tok | mean query latency | n |
|---|---|---|---|---|---|---|---|
| Gemini Embedding (gemini-embedding-001) | 3072 | 0.5067 | 0.8444 | 0.6426 | $0.15 | 450ms | 15 |
| Qwen3-Embedding-8B (OpenRouter) | 4096 | 0.27 | 0.4276 | 0.2972 | $0.01 | 4391ms | 15 |
| Qwen3-Embedding-4B (OpenRouter) | 2560 | 0.2667 | 0.3969 | 0.2893 | $0.02 | 1806ms | 15 |

Price sources: Gemini Embedding (gemini-embedding-001): ai.google.dev/gemini-api/docs/pricing (paid tier, 2026-06-03): $0.15 / 1M input tokens · Qwen3-Embedding-8B (OpenRouter): openrouter.ai/qwen/qwen3-embedding-8b (2026-06-03): $0.01 / 1M tokens · Qwen3-Embedding-4B (OpenRouter): openrouter.ai/qwen/qwen3-embedding-4b (2026-06-03): $0.02 / 1M tokens

**Qdrant ingestion (Phase-2 path, proven end-to-end):**
- `l2_eval_gemini_embedding_001` — 180 points, dim 3072 (gemini-embedding-001)
- `l2_eval_qwen_qwen3_embedding_8b` — 180 points, dim 4096 (qwen/qwen3-embedding-8b)
- `l2_eval_qwen_qwen3_embedding_4b` — 180 points, dim 2560 (qwen/qwen3-embedding-4b)

> Gap: Qwen3-Embedding-0.6B excluded: OpenRouter returns HTTP 404 'no endpoints' for qwen/qwen3-embedding-0.6b (verified 2026-06-03).


## Decision rules applied (§6)
- **Search:** highest grounding quality at acceptable latency/cost; if SearXNG (free) is within noise (~5pp) of the best paid engine, SearXNG wins on cost.
- **Embedding:** default Gemini Embedding; switch to Qwen only if it clearly wins on retrieval quality (we used a >0.03 nDCG@10 margin as "clear").

## Honest limitations
- Directional only: ~15 queries, small per-topic n; not a powered study.
- The LLM judge scored relevance/credibility; the CEO kappa sample (`kappa-rating-sheet.html`) must be rated by the founder before the judge is validated. Kappa is NOT yet computed.
- Groundability + Open PageRank are deterministic; Britannica and some publisher pages block extraction (counted as groundability 0, not fabricated).
- Qwen3-Embedding-0.6B is unavailable on OpenRouter's embeddings endpoint (404) — recorded as a gap, not faked.
- **Qwen caveat (important):** Qwen3-Embedding models expect an instruction prefix on the QUERY side ("Instruct: ...\nQuery: ...") for retrieval; OpenRouter's raw `/embeddings` endpoint embeds the bare string with no instruction hook. The large Gemini margin therefore partly reflects Qwen being run without its intended query-instruction format, not purely model quality. A fair Qwen re-test (self-hosted with the instruct template) is the honest follow-up before ruling Qwen out for cost optimization. The §6 conclusion (default Gemini now) still holds for the as-tested API path.
