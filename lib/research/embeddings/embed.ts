/**
 * Production passage-embedding service. Reuses the ADR-9-ratified Gemini
 * embedding call exactly as proven by the D4 eval (gemini-embedding-001, dim
 * 3072, Cosine — see clients.ts and decisions/2026-06-03-adr9-web-search-
 * source-strategy). No params are re-derived; this only productionizes the
 * proven call into a reusable, dim-checked function for kc_passages ingestion.
 */
import { GoogleGenAI } from "@google/genai";

export const EMBEDDING_MODEL = "gemini-embedding-001";
export const EMBEDDING_DIM = 3072;

// Gemini API hard limit on batchEmbedContents (undocumented in SDK types,
// confirmed against the live API: "at most 100 requests can be in one batch").
const MAX_BATCH_SIZE = 100;

declare global {
  // eslint-disable-next-line no-var
  var __geminiEmbed: GoogleGenAI | undefined;
}

function client(): GoogleGenAI {
  const key = process.env.GOOGLE_GENAI_API_KEY;
  if (!key) throw new Error("GOOGLE_GENAI_API_KEY is not set");
  const c = globalThis.__geminiEmbed ?? new GoogleGenAI({ apiKey: key });
  if (process.env.NODE_ENV !== "production") globalThis.__geminiEmbed = c;
  return c;
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

/**
 * Embed passages with gemini-embedding-001 at dim 3072, in batches of up to
 * MAX_BATCH_SIZE. Order is preserved per the Gemini API's documented guarantee
 * ("embeddings for each request, in the same order as provided"). Throws if any
 * vector isn't EMBEDDING_DIM so drift never lands mismatched vectors in the
 * dim-locked collection.
 */
export async function embedPassages(texts: string[]): Promise<number[][]> {
  const gemini = client();
  const out: number[][] = [];
  for (const batch of chunk(texts, MAX_BATCH_SIZE)) {
    const r = await gemini.models.embedContent({ model: EMBEDDING_MODEL, contents: batch });
    const embeddings = r.embeddings;
    if (!embeddings || embeddings.length !== batch.length) {
      throw new Error(
        `Gemini embedContent returned ${embeddings?.length ?? 0} embeddings for a batch of ${batch.length}`,
      );
    }
    for (const e of embeddings) {
      const values = e.values;
      if (!values) throw new Error(`Gemini embedContent returned no values for ${EMBEDDING_MODEL}`);
      if (values.length !== EMBEDDING_DIM) {
        throw new Error(
          `Embedding dim mismatch: got ${values.length}, expected ${EMBEDDING_DIM} (ADR 9 lock)`,
        );
      }
      out.push(values);
    }
  }
  return out;
}
