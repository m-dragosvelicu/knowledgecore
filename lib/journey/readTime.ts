/**
 * Reading-time estimate for the information-step eyebrow ("Read · about N
 * min"). Computed from the LessonDoc's own prose, not the LLM's claimed
 * estimate — a long article must not read "about 1 min".
 */

import { isProseBlock } from "@/lib/services/lessonDoc";
import type { DraftLessonDoc } from "@/lib/services/lessonDoc";

// Silent-reading average for adult prose; the 200-230 wpm range is standard,
// picking the midpoint.
export const READING_WPM = 215;

// Markdown syntax that would otherwise inflate the word count (code fences,
// image/link markup, emphasis markers).
function stripMarkdown(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`[^`]*`/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[#>*_~-]/g, " ")
    .trim();
}

export function countWords(text: string): number {
  const stripped = stripMarkdown(text);
  return stripped.length === 0 ? 0 : stripped.split(/\s+/).length;
}

/** Word count across every rendered section heading and prose block. */
export function lessonWordCount(doc: DraftLessonDoc): number {
  let words = 0;
  for (const section of doc.sections) {
    if (section.heading) words += countWords(section.heading);
    for (const block of section.blocks) {
      if (isProseBlock(block)) words += countWords(block.md);
    }
  }
  return words;
}

/** Whole minutes, rounded, floor of 1 — never "0 min". */
export function estimateReadMinutes(
  doc: DraftLessonDoc,
  wpm: number = READING_WPM,
): number {
  const words = lessonWordCount(doc);
  return Math.max(1, Math.round(words / wpm));
}
