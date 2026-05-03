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

export class MockIntentParser implements IntentParser {
  async parse(rawText: string): Promise<ParsedSubject> {
    return {
      canonicalName: cleanCapitalize(rawText),
      scopeNote: "Estimated scope: introductory to intermediate",
    };
  }
}
