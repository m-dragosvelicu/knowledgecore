/**
 * Cost-attribution context for LlmCall telemetry (userId + journey/intentId).
 *
 * Design: an AsyncLocalStorage-scoped context, NOT a change to any service
 * interface method signature. The locked `Services` registry type (see
 * lib/services/index.ts) and every provider's public contract stay untouched;
 * only each provider's already-private `recordLlmCall` reads this context.
 * The caller (a server action or route handler, where userId/intentId are
 * already resolved) wraps the specific service call with
 * `withLlmTelemetryContext`; the context then propagates transparently
 * through any intermediate async call chain (e.g. ensureLessonContent ->
 * runLessonPipeline -> LessonAuthor/VisualWorkers) with no plumbing changes
 * to those intermediate functions.
 *
 * Node-only: AsyncLocalStorage is unsupported on the Edge runtime. Every call
 * site that uses this lives on the Node.js runtime (server actions default to
 * Node; app/api/transcribe/route.ts explicitly sets `runtime = "nodejs"`).
 */

import { AsyncLocalStorage } from "node:async_hooks";

export type LlmTelemetryContext = {
  userId?: string | null;
  intentId?: string | null;
};

const storage = new AsyncLocalStorage<LlmTelemetryContext>();

/** Runs `fn` with `context` available to any recordLlmCall nested inside it. */
export function withLlmTelemetryContext<T>(
  context: LlmTelemetryContext,
  fn: () => Promise<T>,
): Promise<T> {
  return storage.run(context, fn);
}

/** Reads the current attribution context, or undefined outside any wrap. */
export function getLlmTelemetryContext(): LlmTelemetryContext | undefined {
  return storage.getStore();
}
