import type { ParsedSubject } from "@/lib/services/types";

export interface IntentParser {
  parse(rawText: string): Promise<ParsedSubject>;
}
