/**
 * Telemetry for non-LLM external API calls (Tavily, OpenAlex, Semantic
 * Scholar) — the production Research Agent's per-request retrieval calls.
 * Mirrors the recordLlmCall pattern each provider already has (see e.g.
 * lib/services/providers/intentParser.service.ts): best-effort, wrapped in
 * try/catch so a logging failure can never break the caller's real work, and
 * attribution comes from the same ambient lib/llm/telemetryContext.ts
 * AsyncLocalStorage context, not a plumbed-through parameter.
 *
 * Reuses the LlmCall table (purpose=external_<source>_search, zero tokens,
 * a configured per-request cost from lib/llm/pricing.ts) rather than a new
 * table, so the existing /api/admin/llm-costs aggregation and dashboard work
 * unmodified — see prisma/schema.prisma's LlmCallPurpose doc comment.
 */

import { prisma } from "@/lib/db";
import type { LlmCallPurpose } from "@prisma/client";
import { computeExternalCallCostMicroUsd, type ExternalCallSource } from "./pricing";
import { getLlmTelemetryContext } from "./telemetryContext";

const PURPOSE_BY_SOURCE: Readonly<Record<ExternalCallSource, LlmCallPurpose>> = {
  tavily: "external_tavily_search",
  openalex: "external_openalex_search",
  semantic_scholar: "external_semantic_scholar_search",
};

export type RecordExternalCallArgs = {
  source: ExternalCallSource;
  latencyMs: number;
  success: boolean;
  errorMessage?: string | null;
};

/** Log one external API request as an LlmCall row (zero tokens, flat per-request cost). */
export async function recordExternalCall(args: RecordExternalCallArgs): Promise<void> {
  try {
    const ctx = getLlmTelemetryContext();
    await prisma.llmCall.create({
      data: {
        purpose: PURPOSE_BY_SOURCE[args.source],
        model: args.source,
        inputTokens: 0,
        outputTokens: 0,
        costMicroUsd: computeExternalCallCostMicroUsd(args.source),
        latencyMs: args.latencyMs,
        success: args.success,
        errorMessage: args.errorMessage ?? null,
        userId: ctx?.userId ?? null,
        intentId: ctx?.intentId ?? null,
      },
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(
      `[llm-telemetry] failed to persist external_${args.source}_search row: ${
        (err as Error).message
      }`,
    );
  }
}
