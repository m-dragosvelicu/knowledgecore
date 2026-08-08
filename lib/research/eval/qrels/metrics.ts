/**
 * IR metrics for the retrieval layer (Recall@k, MRR, nDCG@k) — verdict
 * STANDARD per reading-room/eval-metrics-verification-2026-08-07.html §3.1.
 *
 * These formulas are intentionally duplicated from
 * ../../embeddings/run-embeddings.ts rather than imported: that file's module
 * body calls main().catch(...) at the top level, so importing anything from
 * it would execute the whole D4 embedding-eval script (live embedding calls,
 * Qdrant writes) as a side effect. Duplicating three small pure functions
 * here is cheaper and safer than restructuring a script owned by a parallel
 * work stream. Keep both copies in sync if the formulas ever change.
 */

export function recallAt(retrievedIds: string[], relevant: Set<string>, k: number): number {
  if (relevant.size === 0) return NaN;
  const hit = retrievedIds.slice(0, k).filter((id) => relevant.has(id)).length;
  return hit / Math.min(relevant.size, k);
}

export function mrr(retrievedIds: string[], relevant: Set<string>): number {
  for (let i = 0; i < retrievedIds.length; i++) {
    if (relevant.has(retrievedIds[i])) return 1 / (i + 1);
  }
  return 0;
}

export function ndcgAt(retrievedIds: string[], relevant: Set<string>, k: number): number {
  let dcg = 0;
  for (let i = 0; i < Math.min(k, retrievedIds.length); i++) {
    if (relevant.has(retrievedIds[i])) dcg += 1 / Math.log2(i + 2);
  }
  let idcg = 0;
  const ideal = Math.min(relevant.size, k);
  for (let i = 0; i < ideal; i++) idcg += 1 / Math.log2(i + 2);
  return idcg > 0 ? dcg / idcg : NaN;
}

export const mean = (a: number[]): number => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
