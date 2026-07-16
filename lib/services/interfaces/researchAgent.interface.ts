import type {
  Bundle,
  GapQueries,
  ResearchProgressSink,
} from "@/lib/services/research";

/**
 * The Research Agent service. `amend` (targeted gap-fill) is not yet
 * implemented; see the provider for its current placeholder behaviour.
 */
export interface ResearchAgent {
  /**
   * Assemble (or research live) the bundle for a topic. `goalpostQueries` is
   * the per-goalpost query set generation grounds against. `onProgress` is
   * optional and advisory only — omitting it changes nothing about the result.
   */
  research(
    topicKey: string,
    topicLabel: string,
    goalpostQueries: string[],
    onProgress?: ResearchProgressSink,
  ): Promise<Bundle>;

  /** Targeted amend of an existing bundle (later phase, not yet implemented). */
  amend(bundleId: string, gapQueries: GapQueries): Promise<Bundle>;
}
