import type { LLMClient } from "@/lib/llm";
import type { IntentParser, ParsedSubject } from "@/lib/services/types";
import { parsedSubjectSchema } from "./schemas";

const SYSTEM = `You are the intake step of an AI learning platform. A learner has
typed, in their own words, what they want to learn. Your job is to turn that raw
phrase into a single canonical subject and a short scope note.

- canonicalName: the standard, well-formed name of the subject (e.g. "Linear
  Algebra for Machine Learning", "Introductory French", "React Hooks"). Title
  case. Do not invent scope the learner did not imply.
- scopeNote: one short sentence estimating the breadth/level the learner seems to
  want (e.g. "Estimated scope: introductory, focused on practical application").`;

export class LiveIntentParser implements IntentParser {
  constructor(private readonly llm: LLMClient) {}

  async parse(rawText: string): Promise<ParsedSubject> {
    return this.llm.completeStructured({
      system: SYSTEM,
      messages: [
        {
          role: "user",
          content: `Learner's raw input: "${rawText}"\n\nReturn the canonical subject and scope note.`,
        },
      ],
      temperature: 0.2,
      schema: parsedSubjectSchema,
      schemaName: "ParsedSubject",
    });
  }
}
