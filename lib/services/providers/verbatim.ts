/**
 * Verbatim-quote matching for the evidence contract.
 *
 * Extracted from checkpointEvaluator.service.ts (behaviour unchanged) so that
 * offline analyses can reuse the EXACT production matcher without importing the
 * service module, which pulls in Prisma and therefore a live database.
 */

/**
 * Normalize for substring comparison: lowercase, collapse whitespace, and fold
 * smart quotes / dashes to ASCII. We compare normalized forms but always RETURN
 * the original learner text span so the stored quote stays faithful.
 */
export function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[‘’‛′]/g, "'")
    .replace(/[“”″]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Returns the original-cased substring of `artifact` that matches `quote`
 * (after normalization), or null if it is not a verbatim substring.
 */
export function findVerbatim(artifact: string, quote: string): string | null {
  const q = quote.trim();
  if (q.length === 0) return null;

  // Fast path: exact substring.
  if (artifact.includes(q)) return q;

  // Normalized substring search. We normalize the artifact while keeping an
  // index map back to the original string so we can return the original span.
  const normQuote = normalize(q);
  if (normQuote.length === 0) return null;

  const map: number[] = []; // normalized index -> original index
  let norm = "";
  let prevWasSpace = false;
  for (let i = 0; i < artifact.length; i++) {
    let ch = artifact[i].toLowerCase();
    if ("‘’‛′".includes(ch)) ch = "'";
    else if ("“”″".includes(ch)) ch = '"';
    else if ("–—".includes(ch)) ch = "-";
    if (/\s/.test(ch)) {
      if (prevWasSpace) continue;
      ch = " ";
      prevWasSpace = true;
    } else {
      prevWasSpace = false;
    }
    norm += ch;
    map.push(i);
  }
  const trimmedNorm = norm.trim();
  const leadingTrim = norm.length - norm.trimStart().length;

  const idx = trimmedNorm.indexOf(normQuote);
  if (idx === -1) return null;

  const startNormIdx = idx + leadingTrim;
  const endNormIdx = startNormIdx + normQuote.length - 1;
  if (endNormIdx >= map.length) return null;
  const origStart = map[startNormIdx];
  const origEnd = map[endNormIdx];
  return artifact.slice(origStart, origEnd + 1);
}

/** The sentinel a model may legitimately return when a dimension has no support. */
export const NO_EVIDENCE = "(no evidence in artifact)";
