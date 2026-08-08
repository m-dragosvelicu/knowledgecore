/**
 * Shared retry-with-backoff helper for the E05 eval bench orchestrator
 * (run-bench.ts) and the embedding clients it shares with the surface layer.
 * A single transient blip (429 rate limit, 5xx server error, or a network
 * failure such as a DNS/timeout/connection-reset) must not kill a multi-hour
 * bench run -- see run-bench.ts's header for the incident this fixes.
 *
 * No new dependency: plain setTimeout-based exponential backoff with jitter.
 * Non-transient errors (4xx other than 429, schema/parse errors, safety
 * blocks, "not set" env errors) are NOT retried -- they are deterministic and
 * retrying only wastes wall-clock time and spend.
 */

const TRANSIENT_PATTERN =
  /\b(429|500|502|503|504)\b|rate.?limit|too many requests|ServerError|ServiceUnavailable|ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|ECONNREFUSED|fetch failed|network|socket hang up|UND_ERR|timeout/i;

/** Errors that look transient (deterministic 4xx like a bad schema, a safety
 *  block, or a missing API key are excluded on purpose). */
export function isTransientError(err: unknown): boolean {
  const e = err as { status?: number; statusCode?: number; code?: string; name?: string; message?: string };
  const status = e?.status ?? e?.statusCode;
  if (typeof status === "number") {
    if (status === 429 || (status >= 500 && status < 600)) return true;
    if (status >= 400 && status < 500) return false; // other 4xx: not retryable
  }
  if (/blocked|SAFETY|PROHIBITED|is not set/i.test(e?.message ?? "")) return false;
  const text = `${e?.name ?? ""} ${e?.code ?? ""} ${e?.message ?? String(err)}`;
  return TRANSIENT_PATTERN.test(text);
}

export interface RetryOptions {
  /** Total attempts including the first try. Default 4 (1 try + 3 retries). */
  attempts?: number;
  /** Base delay in ms before the first retry; doubles each subsequent retry. */
  baseDelayMs?: number;
  /** Label used in the default console log line; purely cosmetic. */
  label?: string;
  /** Override the default console logging on each retry. */
  onRetry?: (attempt: number, attempts: number, delayMs: number, err: unknown) => void;
}

/**
 * Retries `fn` on transient errors with exponential backoff + full jitter.
 * Delay before retry i (0-indexed, i.e. before the (i+1)-th attempt) is
 * baseDelayMs * 2^i, plus up to 50% random jitter, so concurrent callers
 * don't all retry in lockstep against a rate-limited API.
 */
export async function withRetry<T>(fn: () => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const attempts = opts.attempts ?? 4;
  const baseDelayMs = opts.baseDelayMs ?? 2000;
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const isLastAttempt = i === attempts - 1;
      if (!isTransientError(err) || isLastAttempt) throw err;
      const backoff = baseDelayMs * 2 ** i;
      const jitter = Math.random() * backoff * 0.5;
      const delayMs = Math.round(backoff + jitter);
      if (opts.onRetry) {
        opts.onRetry(i + 1, attempts, delayMs, err);
      } else {
        const msg = (err as Error)?.message ?? String(err);
        console.log(
          `  [retry] ${opts.label ?? "call"} attempt ${i + 1}/${attempts} failed transiently (${msg.slice(0, 140)}); retrying in ${delayMs}ms...`,
        );
      }
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  throw lastErr;
}
