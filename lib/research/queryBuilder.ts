/**
 * Search query construction + length guarding shared by all L2 search clients.
 *
 * Root cause (fixed here): LiveResearchAgent used to build its query by
 * naively joining every goalpost objective into one string. Long paths blow
 * past Tavily's hard 400-character query cap, Tavily rejects with a 400, and
 * that 400 used to be swallowed by the "degrade gracefully" catch, producing
 * a silently empty bundle. buildSearchQuery() keeps the query under the cap
 * while staying semantically useful; clampQuery() is the last-mile backstop
 * so no caller (present or future) can bypass the guard.
 */

// Tavily's documented hard cap. Other search APIs have no documented limit,
// but reuse the same cap defensively: the query is already sized for Tavily
// upstream, and a shorter, topic-first query is a reasonable input everywhere.
export const DEFAULT_MAX_QUERY_LENGTH = 400;

/** Truncate `text` to at most `maxLength` chars, cutting at a word boundary. */
function truncateAtWordBoundary(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  const slice = text.slice(0, maxLength);
  const lastSpace = slice.lastIndexOf(" ");
  return lastSpace > 0 ? slice.slice(0, lastSpace) : "";
}

/**
 * Build a search query from a topic label and a list of goalpost objectives,
 * staying within `maxLength` characters.
 *
 * Strategy: topic label first (truncated at a word boundary if it alone
 * exceeds the cap), then append objectives in order while they fit whole.
 * The first objective that would overflow the cap is truncated at a word
 * boundary to fill the remaining space (if enough space remains to be
 * useful); objectives after that are dropped. Never emits a mid-word cut.
 */
export function buildSearchQuery(
  topicLabel: string,
  goalpostQueries: string[],
  maxLength: number = DEFAULT_MAX_QUERY_LENGTH,
): string {
  const label = topicLabel.trim();
  let result = truncateAtWordBoundary(label, maxLength) || label.slice(0, maxLength);

  const MIN_USEFUL_REMAINDER = 15; // don't bother appending a near-empty fragment

  for (const objective of goalpostQueries) {
    const trimmed = objective.trim();
    if (!trimmed) continue;

    const candidate = `${result} ${trimmed}`;
    if (candidate.length <= maxLength) {
      result = candidate;
      continue;
    }

    const remaining = maxLength - result.length - 1; // 1 for the joining space
    if (remaining >= MIN_USEFUL_REMAINDER) {
      const fragment = truncateAtWordBoundary(trimmed, remaining);
      if (fragment) result = `${result} ${fragment}`;
    }
    break; // cap reached: stop processing further objectives
  }

  return result.trim();
}

/**
 * Last-mile backstop: clamp any outgoing query to `maxLength`, logging a
 * loud warning if clamping actually happened. Defends search clients against
 * callers that bypass buildSearchQuery().
 */
export function clampQuery(
  query: string,
  clientName: string,
  maxLength: number = DEFAULT_MAX_QUERY_LENGTH,
): string {
  if (query.length <= maxLength) return query;

  const clamped = truncateAtWordBoundary(query, maxLength) || query.slice(0, maxLength);
  // eslint-disable-next-line no-console
  console.warn(
    `[${clientName}] query exceeded ${maxLength} chars (${query.length}) and was clamped; ` +
      "the caller should build a shorter query with buildSearchQuery() instead of relying on this backstop.",
  );
  return clamped;
}
