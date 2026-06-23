/**
 * Production passage-embedding service.
 *
 * Reuses the ADR-9-ratified Gemini embedding call EXACTLY as proven by the D4
 * eval (gemini-embedding-001, dim 3072, Cosine — see lib/research/embeddings/
 * clients.ts and decisions/2026-06-03-adr9-web-search-source-strategy). No
 * embedding params are re-derived here: this module only productionizes the
 * proven call into a reusable, dim-checked function for kc_passages ingestion.
 */
import { GoogleGenAI } from "@google/genai";

export const EMBEDDING_MODEL = "gemini-embedding-001";
export const EMBEDDING_DIM = 3072;

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

/**
 * Embed passages with gemini-embedding-001 at dim 3072. The SDK embeds one
 * content per call, so texts are mapped sequentially (same shape the eval
 * proved). Throws if any vector is not EMBEDDING_DIM so a model/param drift can
 * never silently land mismatched vectors in the dim-locked collection.
 */
export async function embedPassages(texts: string[]): Promise<number[][]> {
  const gemini = client();
  const out: number[][] = [];
  for (const t of texts) {
    const r = await gemini.models.embedContent({ model: EMBEDDING_MODEL, contents: t });
    const values =
      (r as { embeddings?: { values?: number[] }[] }).embeddings?.[0]?.values ??
      (r as { embedding?: { values?: number[] } }).embedding?.values;
    if (!values) throw new Error(`Gemini embedContent returned no values for ${EMBEDDING_MODEL}`);
    if (values.length !== EMBEDDING_DIM) {
      throw new Error(
        `Embedding dim mismatch: got ${values.length}, expected ${EMBEDDING_DIM} (ADR 9 lock)`,
      );
    }
    out.push(values);
  }
  return out;
}
