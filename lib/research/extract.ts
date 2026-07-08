/**
 * Clean-text extraction (Phase-1 extractor tier).
 * Primary: Trafilatura sidecar (docker-compose.eval.yml, :8055).
 * Fallback: public Jina Reader (https://r.jina.ai/<url>) for JS-heavy pages or
 * Trafilatura failures.
 */
import type { Extraction } from "./eval/types";

const TRAFILATURA_URL = process.env.TRAFILATURA_URL ?? "http://localhost:8055";
const JINA_BASE = "https://r.jina.ai/";

interface TrafilaturaResponse {
  ok: boolean;
  error?: string;
  text?: string;
  title?: string | null;
  author?: string | null;
  date?: string | null;
  sitename?: string | null;
}

async function viaTrafilatura(url: string): Promise<Extraction | null> {
  try {
    const res = await fetch(`${TRAFILATURA_URL}/extract`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as TrafilaturaResponse;
    if (!data.ok || !data.text) return null;
    return {
      url,
      ok: true,
      source: "trafilatura",
      text: data.text,
      title: data.title ?? null,
      author: data.author ?? null,
      date: data.date ?? null,
      sitename: data.sitename ?? null,
    };
  } catch {
    return null;
  }
}

/** Jina returns Markdown with a leading "Title:/URL Source:/Published Time:" header. */
async function viaJina(url: string): Promise<Extraction | null> {
  try {
    const res = await fetch(`${JINA_BASE}${url}`, {
      headers: { Accept: "text/plain" },
      signal: AbortSignal.timeout(40_000),
    });
    if (!res.ok) return null;
    const raw = await res.text();
    if (!raw.trim()) return null;

    const titleMatch = raw.match(/^Title:\s*(.+)$/m);
    const dateMatch = raw.match(/^Published Time:\s*(.+)$/m);
    const bodyStart = raw.indexOf("Markdown Content:");
    const text = bodyStart >= 0 ? raw.slice(bodyStart + "Markdown Content:".length).trim() : raw.trim();
    if (!text) return null;

    return {
      url,
      ok: true,
      source: "jina",
      text,
      title: titleMatch?.[1]?.trim() ?? null,
      author: null,
      date: dateMatch?.[1]?.trim() ?? null,
      sitename: null,
    };
  } catch {
    return null;
  }
}

export async function extract(url: string): Promise<Extraction> {
  const traf = await viaTrafilatura(url);
  if (traf) return traf;
  const jina = await viaJina(url);
  if (jina) return jina;
  return { url, ok: false, source: "none", error: "both_extractors_failed", text: "" };
}
