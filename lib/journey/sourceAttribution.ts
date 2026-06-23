/**
 * Builds the human-readable attribution line for a citable Source, shared by the
 * goalpost sources read API and its verification harness (E01.S07). Lives in lib/
 * because a Next route file may only export HTTP-method handlers and config.
 */
export function buildAttribution(source: {
  kind: string;
  authors: unknown;
  venue: string | null;
  publishedYear: number | null;
  canonicalUrl: string | null;
}): string {
  if (source.kind === "academic") {
    // Source.authors is canonically Array<{ name: string }> (see lib/services/
    // research.ts). Read the name field; tolerate a bare-string legacy row.
    const names = (Array.isArray(source.authors) ? source.authors : [])
      .map((a) => (typeof a === "string" ? a : (a as { name?: string })?.name))
      .filter((n): n is string => typeof n === "string" && n.trim().length > 0);
    const authorPart =
      names.length > 0
        ? names.length > 2
          ? `${names[0]} et al.`
          : names.join(" & ")
        : null;
    const parts: string[] = [];
    if (authorPart) parts.push(authorPart);
    if (source.venue) parts.push(source.venue);
    if (source.publishedYear) parts.push(String(source.publishedYear));
    return parts.join(", ") || "Academic source";
  }
  // web: show the host name as attribution (enough for one-click link-out)
  if (source.canonicalUrl) {
    try {
      return new URL(source.canonicalUrl).hostname.replace(/^www\./, "");
    } catch {
      // malformed URL — fall through
    }
  }
  return "Web source";
}
