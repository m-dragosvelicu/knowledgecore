/**
 * Minimal multi-provider JSON caller for the judge-validation study.
 *
 * WHY NOT REUSE THE SERVICE LAYER
 * GeminiCheckpointEvaluator writes an LlmCall telemetry row through Prisma on
 * every call. This study must run without a database and must record its OWN
 * token/latency numbers per call, so it reuses the production PROMPT and
 * production SCHEMA but calls the model directly. Fidelity that matters (the
 * exact system prompt, the exact response schema, the exact temperature) is
 * preserved; the database side effect is not.
 *
 * Every call returns measured input/output tokens and wall-clock latency, which
 * is what the cost/latency/token deliverable is computed from. No token count
 * in the output of this study is estimated.
 */

export type ProviderId = "google" | "openrouter";

export interface JudgeModel {
  /** Stable key used in output files. */
  key: string;
  label: string;
  provider: ProviderId;
  /** Provider-specific model id. */
  model: string;
  /** USD per 1M input tokens, list price. */
  inputPerMTokUsd: number;
  /** USD per 1M output tokens, list price. */
  outputPerMTokUsd: number;
  priceSource: string;
}

export interface JsonCallResult<T> {
  value: T;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  rawText: string;
}

function requireEnv(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) throw new Error(`${name} is not set`);
  return v;
}

/**
 * Google Generative Language API, v1beta generateContent.
 * Mirrors lib/llm/gemini.ts completeStructured: responseMimeType JSON,
 * responseSchema, thinkingBudget 0, and a 4096 visible-output floor. Those
 * settings are load-bearing for output shape, so they are replicated exactly
 * rather than left to defaults.
 */
async function callGoogle(args: {
  model: string;
  system: string;
  user: string;
  schema: Record<string, unknown>;
  temperature: number;
}): Promise<{ text: string; inputTokens: number; outputTokens: number }> {
  const key = requireEnv("GOOGLE_GENAI_API_KEY");
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${args.model}:generateContent?key=${key}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: args.system }] },
        contents: [{ role: "user", parts: [{ text: args.user }] }],
        generationConfig: {
          temperature: args.temperature,
          maxOutputTokens: 4096,
          responseMimeType: "application/json",
          responseSchema: args.schema,
          thinkingConfig: { thinkingBudget: 0 },
        },
      }),
    },
  );
  const body = (await res.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[];
    usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
    error?: { message?: string };
  };
  if (!res.ok) {
    throw new Error(`Google ${args.model} HTTP ${res.status}: ${body.error?.message ?? JSON.stringify(body).slice(0, 200)}`);
  }
  const finish = body.candidates?.[0]?.finishReason;
  const text = body.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
  if (!text) throw new Error(`Google ${args.model} returned no text (finishReason=${finish ?? "none"})`);
  if (finish === "MAX_TOKENS") throw new Error(`Google ${args.model} truncated output (MAX_TOKENS)`);
  return {
    text,
    inputTokens: body.usageMetadata?.promptTokenCount ?? 0,
    outputTokens: body.usageMetadata?.candidatesTokenCount ?? 0,
  };
}

/**
 * OpenRouter chat completions with a strict json_schema response format.
 * Used for the cross-family judges. Note OpenRouter's schema dialect is plain
 * JSON Schema, unlike Google's uppercase-typed dialect, so the caller passes a
 * dialect-appropriate schema in.
 */
async function callOpenRouter(args: {
  model: string;
  system: string;
  user: string;
  schema: Record<string, unknown>;
  schemaName: string;
  temperature: number;
}): Promise<{ text: string; inputTokens: number; outputTokens: number }> {
  const key = requireEnv("OPENROUTER_API_KEY");
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: args.model,
      temperature: args.temperature,
      // 8192 rather than 4096: the KC schema requires six evidence quotes, and
      // on the longer mastery artifacts a judge that quotes generously truncated
      // its JSON mid-object at 4096. Truncation showed up as unparseable output
      // rather than as a bad score, so it was visible, but it cost whole items.
      max_tokens: 8192,
      messages: [
        { role: "system", content: args.system },
        { role: "user", content: args.user },
      ],
      response_format: {
        type: "json_schema",
        json_schema: { name: args.schemaName, strict: true, schema: args.schema },
      },
    }),
  });
  const body = (await res.json()) as {
    choices?: { message?: { content?: string }; finish_reason?: string; native_finish_reason?: string }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number };
    error?: { message?: string };
  };
  if (!res.ok) {
    throw new Error(`OpenRouter ${args.model} HTTP ${res.status}: ${body.error?.message ?? JSON.stringify(body).slice(0, 200)}`);
  }
  const choice = body.choices?.[0];
  const finish = choice?.finish_reason ?? choice?.native_finish_reason ?? "unknown";
  const text = choice?.message?.content ?? "";
  // Surface truncation explicitly. A length-truncated response yields malformed
  // JSON, and diagnosing that as a parse error rather than a token-budget
  // problem wasted a run, so the cause is named in the message.
  if (finish === "length") {
    throw new Error(`OpenRouter ${args.model} truncated output (finish_reason=length, completion_tokens=${body.usage?.completion_tokens ?? "?"})`);
  }
  if (!text) {
    throw new Error(`OpenRouter ${args.model} returned empty content (finish_reason=${finish}, completion_tokens=${body.usage?.completion_tokens ?? "?"})`);
  }
  return {
    text,
    inputTokens: body.usage?.prompt_tokens ?? 0,
    outputTokens: body.usage?.completion_tokens ?? 0,
  };
}

/** Strip a markdown code fence if a model wrapped its JSON in one. */
function unfence(text: string): string {
  const t = text.trim();
  const m = t.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  return m ? m[1] : t;
}

export async function callJson<T>(args: {
  judge: JudgeModel;
  system: string;
  user: string;
  /** Google-dialect schema (uppercase types). */
  googleSchema: Record<string, unknown>;
  /** Standard JSON Schema for OpenRouter. */
  jsonSchema: Record<string, unknown>;
  schemaName: string;
  temperature: number;
  parse: (raw: unknown) => T;
}): Promise<JsonCallResult<T>> {
  const started = Date.now();
  const out =
    args.judge.provider === "google"
      ? await callGoogle({
          model: args.judge.model,
          system: args.system,
          user: args.user,
          schema: args.googleSchema,
          temperature: args.temperature,
        })
      : await callOpenRouter({
          model: args.judge.model,
          system: args.system,
          user: args.user,
          schema: args.jsonSchema,
          schemaName: args.schemaName,
          temperature: args.temperature,
        });
  const latencyMs = Date.now() - started;
  let parsed: unknown;
  try {
    parsed = JSON.parse(unfence(out.text));
  } catch {
    throw new Error(`${args.judge.key} did not return valid JSON. First 200 chars: ${out.text.slice(0, 200)}`);
  }
  return {
    value: args.parse(parsed),
    inputTokens: out.inputTokens,
    outputTokens: out.outputTokens,
    latencyMs,
    rawText: out.text,
  };
}

/** Retry wrapper. Transient provider errors must not silently drop an item. */
export async function withRetry<T>(fn: () => Promise<T>, attempts = 3, baseDelayMs = 1500): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const msg = (err as Error).message ?? "";
      // Content blocks and schema rejections are deterministic; retrying wastes spend.
      if (/blocked|SAFETY|PROHIBITED/i.test(msg)) break;
      if (i < attempts - 1) await new Promise((r) => setTimeout(r, baseDelayMs * (i + 1)));
    }
  }
  throw lastErr;
}

export function usdFor(judge: JudgeModel, inputTokens: number, outputTokens: number): number {
  return (
    (inputTokens / 1_000_000) * judge.inputPerMTokUsd +
    (outputTokens / 1_000_000) * judge.outputPerMTokUsd
  );
}

/**
 * The judge panel. Three different model FAMILIES: agreement between two
 * checkpoints of the same family would mostly measure shared training rather
 * than convergent validity, which is the whole point of the substitution for
 * human raters.
 *
 * Prices are OpenRouter/Google list prices read on 2026-07-30 and recorded here
 * so the cost table is reproducible from the token counts alone.
 *
 * BIAS MITIGATIONS (E05, reading-room/eval-metrics-verification-2026-08-07.html
 * section 5, citing Wang et al. 2024 position-bias and Panickssery/Bowman/Feng
 * 2024 self-preference):
 *   - Independence/blinding: every judge call in callJson() is a stateless,
 *     single-artifact completion with no shared conversation state and no
 *     other judge's score in the prompt. No judge is ever shown another
 *     judge's output, so there is no anchoring channel between panel members.
 *   - Item order: run.ts shuffles the (judge, item) job list with a seeded
 *     PRNG before dispatch, so no judge or item consistently occupies a fixed
 *     serial position in a run (position bias, Wang et al. 2024, was
 *     documented for within-call answer ordering; this run has no
 *     within-call ordering to bias since each call scores exactly one
 *     artifact, but cross-call serial-position effects are mitigated anyway).
 *   - Self-preference: this is a risk specifically when a judge family is
 *     also the AUTHOR of the artifact it is scoring. The judge-validation
 *     corpus (corpus.ts) is 100% human-authored (see its header), so no
 *     panel judge here is ever scoring its own family's output. This does
 *     NOT generalize automatically to a future panel run over LLM-GENERATED
 *     KnowledgeCore content (e.g. Gemini-authored lesson text): that use
 *     would need the generating family excluded from judging its own output,
 *     or the effect reported explicitly rather than assumed away.
 */
export const JUDGE_PANEL: JudgeModel[] = [
  {
    key: "gemini-3.5-flash",
    label: "Gemini 3.5 Flash (production judge, direct Google API)",
    provider: "google",
    model: "gemini-3.5-flash",
    inputPerMTokUsd: 0.3,
    outputPerMTokUsd: 2.5,
    priceSource: "lib/llm/pricing.ts PRICE_TABLE, matching ai.google.dev/gemini-api/docs/pricing",
  },
  {
    key: "gpt-5.4-mini",
    label: "OpenAI GPT-5.4-mini (via OpenRouter)",
    provider: "openrouter",
    model: "openai/gpt-5.4-mini",
    inputPerMTokUsd: 0.75,
    outputPerMTokUsd: 4.5,
    priceSource: "openrouter.ai/api/v1/models, read 2026-07-30",
  },
  {
    key: "claude-sonnet-5",
    label: "Anthropic Claude Sonnet 5 (via OpenRouter)",
    provider: "openrouter",
    model: "anthropic/claude-sonnet-5",
    inputPerMTokUsd: 2.0,
    outputPerMTokUsd: 10.0,
    priceSource: "openrouter.ai/api/v1/models, read 2026-07-30",
  },
];

export const PRIMARY_JUDGE = JUDGE_PANEL[0];
