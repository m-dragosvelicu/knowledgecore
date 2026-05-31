import type { IntentParser, ParsedSubject } from "@/lib/services/types";

function cleanCapitalize(input: string): string {
  const trimmed = input.trim().replace(/\s+/g, " ");
  if (trimmed.length === 0) return "Untitled subject";
  return trimmed
    .split(" ")
    .map((word) => {
      if (word.length === 0) return word;
      const lower = word.toLowerCase();
      if (lower === "ml" || lower === "ai" || lower === "ui" || lower === "api") {
        return lower.toUpperCase();
      }
      return word[0].toUpperCase() + word.slice(1).toLowerCase();
    })
    .join(" ");
}

// Whole-field words that cannot be a single learning journey (too broad).
const BROAD_SUBJECTS = new Set([
  "physics",
  "math",
  "maths",
  "mathematics",
  "history",
  "chemistry",
  "biology",
  "programming",
  "coding",
  "business",
  "science",
  "art",
  "music",
  "philosophy",
  "economics",
  "psychology",
  "stuff",
  "things",
]);

export class MockIntentParser implements IntentParser {
  async parse(rawText: string): Promise<ParsedSubject> {
    const trimmed = rawText.trim().replace(/\s+/g, " ");
    const canonicalName = cleanCapitalize(rawText);

    // L0.md §3 Stage 2: surface ambiguity for obviously-broad / vague inputs
    // (very short, or a single whole-field word) instead of silently narrowing.
    const lower = trimmed.toLowerCase();
    const broadWord = BROAD_SUBJECTS.has(lower);
    const tooShort = trimmed.length < 15;
    const ambiguous = broadWord || tooShort;

    return {
      canonicalName,
      scopeNote: "Estimated scope: introductory to intermediate",
      ambiguous,
      clarification: ambiguous
        ? `"${canonicalName}" is quite broad — can you narrow it to the specific slice or level you want to focus on?`
        : undefined,
    };
  }
}
