/**
 * Chunking for the embedding eval / Phase-2 ingestion. Paragraph-packed,
 * ~512-token target windows with ~64-token overlap; tokens approximated as
 * words / 0.75 (no tokenizer dep, directional bench only). Paragraphs are kept
 * whole when they fit; an oversized one is split on sentence boundaries.
 */
export const CHUNK_SCHEME = {
  targetTokens: 512,
  overlapTokens: 64,
  tokenApprox: "words / 0.75 (English heuristic, no tokenizer dep)",
  unit: "paragraph-packed with sentence-split fallback",
} as const;

const TARGET_WORDS = Math.round(512 * 0.75); // ~384 words
const OVERLAP_WORDS = Math.round(64 * 0.75); // ~48 words

export interface Chunk {
  id: string;
  sourceUrl: string;
  text: string;
}

function splitSentences(p: string): string[] {
  return p.match(/[^.!?]+[.!?]+(\s|$)|[^.!?]+$/g)?.map((s) => s.trim()).filter(Boolean) ?? [p];
}

function wordCount(s: string): number {
  return s.split(/\s+/).filter(Boolean).length;
}

export function chunkText(sourceUrl: string, text: string, idPrefix: string): Chunk[] {
  const paragraphs = text
    .split(/\n{2,}/)
    .map((p) => p.replace(/\s+/g, " ").trim())
    .filter((p) => p.length > 0);

  // Expand oversized paragraphs into sentence groups first.
  const units: string[] = [];
  for (const p of paragraphs) {
    if (wordCount(p) <= TARGET_WORDS) {
      units.push(p);
    } else {
      let buf: string[] = [];
      let n = 0;
      for (const sent of splitSentences(p)) {
        const sn = wordCount(sent);
        if (n + sn > TARGET_WORDS && buf.length) {
          units.push(buf.join(" "));
          buf = [];
          n = 0;
        }
        buf.push(sent);
        n += sn;
      }
      if (buf.length) units.push(buf.join(" "));
    }
  }

  // Pack units into ~target windows with word-level overlap between windows.
  const chunks: Chunk[] = [];
  let buf: string[] = [];
  let n = 0;
  let idx = 0;
  const flush = () => {
    if (!buf.length) return;
    const t = buf.join(" ");
    chunks.push({ id: `${idPrefix}-c${idx++}`, sourceUrl, text: t });
    // carry overlap words into the next window
    const words = t.split(/\s+/);
    const carry = words.slice(Math.max(0, words.length - OVERLAP_WORDS));
    buf = carry.length ? [carry.join(" ")] : [];
    n = carry.length;
  };

  for (const u of units) {
    const un = wordCount(u);
    if (n + un > TARGET_WORDS && buf.length) flush();
    buf.push(u);
    n += un;
  }
  if (buf.length && wordCount(buf.join(" ")) > OVERLAP_WORDS + 5) {
    chunks.push({ id: `${idPrefix}-c${idx++}`, sourceUrl, text: buf.join(" ") });
  }
  return chunks;
}

export function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na && nb ? dot / (Math.sqrt(na) * Math.sqrt(nb)) : 0;
}
