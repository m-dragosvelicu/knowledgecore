import type { IntentParser, ParsedSubject } from "@/lib/services/types";

// Conversational lead-ins the parser should strip so the SUBJECT survives, not
// the whole sentence. Ordered longest-first so the most specific phrase wins.
// Anchored to the start of the (lower-cased) input. Mirrors the live parser's
// extraction intent so mock-mode previews are not misleading.
const LEAD_INS = [
  "i would like to learn about",
  "i would like to learn",
  "i'd like to learn about",
  "i'd like to learn",
  "i want to learn about",
  "i want to learn",
  "i wanna learn about",
  "i wanna learn",
  "i'd like to understand",
  "i want to understand",
  "help me understand",
  "help me learn",
  "help me with",
  "teach me about",
  "teach me",
  "show me how to",
  "show me",
  "explain",
  "tell me about",
  "learn about",
  "how do i",
  "how does",
  "how do",
  "what is",
  "what are",
];

// Acronyms we uppercase when they appear as a standalone word.
const ACRONYMS = new Set(["ml", "ai", "ui", "api", "css", "html", "sql", "url"]);

function stripLeadIn(input: string): string {
  let s = input.trim().replace(/\s+/g, " ");
  const lower = s.toLowerCase();
  for (const lead of LEAD_INS) {
    if (lower === lead || lower.startsWith(lead + " ")) {
      s = s.slice(lead.length).trim();
      break;
    }
  }
  // Drop a trailing "work"/"works" left over from "how does X work" framing,
  // and any trailing punctuation.
  s = s.replace(/[.?!]+$/g, "").trim();
  return s;
}

// SENTENCE CASE: lower-case the phrase, then capitalize only the first word
// (and re-upper any standalone acronym). This matches the design-system voice —
// "the default mode network", "stoicism for a bad day" — instead of
// Title-Casing Every Word.
function toSentenceCase(input: string): string {
  const trimmed = stripLeadIn(input);
  if (trimmed.length === 0) return "Untitled subject";
  const words = trimmed.split(" ").map((word, i) => {
    if (word.length === 0) return word;
    const lower = word.toLowerCase();
    if (ACRONYMS.has(lower)) return lower.toUpperCase();
    if (i === 0) return word[0].toUpperCase() + word.slice(1).toLowerCase();
    return lower;
  });
  return words.join(" ");
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
    const canonicalName = toSentenceCase(rawText);

    // L0.md §3 Stage 2: surface ambiguity for obviously-broad / vague inputs
    // (very short, or a single whole-field word) instead of silently narrowing.
    // Judge ambiguity against the EXTRACTED subject (lead-in stripped), not the
    // raw sentence, so "i want to learn physics" is still flagged as too broad.
    const subjectLower = stripLeadIn(rawText).toLowerCase();
    const broadWord = BROAD_SUBJECTS.has(subjectLower);
    const tooShort = subjectLower.length < 4;
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
