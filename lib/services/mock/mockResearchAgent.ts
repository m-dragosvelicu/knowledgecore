import { createHash } from "node:crypto";
import type {
  Bundle,
  Chunk,
  GapQueries,
  ResearchAgent,
  Source,
} from "@/lib/services/research";

/**
 * L2 Phase 0 — the MOCK Research Agent.
 *
 * Returns a DETERMINISTIC canned bundle of well-formed fake sources with chunks:
 * zero network, zero API keys, zero embeddings. This is what proves the spine
 * `path-confirm -> bundle -> grounded generation -> real sourceIds` offline / in
 * CI. The live agent (later phase) implements the same `ResearchAgent` contract.
 *
 * The canned sources are TOPIC-PARAMETERIZED off `topicLabel` so different topics
 * yield distinct (but stable) bundles; the `dedupKey`s are content-addressed so
 * the BundleStore's dedup path is exercised consistently.
 */
export class MockResearchAgent implements ResearchAgent {
  async research(
    topicKey: string,
    topicLabel: string,
    _goalpostQueries: string[],
  ): Promise<Bundle> {
    return this.cannedBundle(topicKey, topicLabel);
  }

  async amend(bundleId: string, _gapQueries: GapQueries): Promise<Bundle> {
    // Phase 0: amend is not exercised end to end (later phase). Return a stable
    // canned bundle keyed off the bundle id so the contract type-checks.
    return this.cannedBundle(bundleId, `Amendment for ${bundleId}`);
  }

  /**
   * Build a fixed, deterministic 3-source bundle for the topic. Source `ref`s and
   * chunk `contentHash`es are stable across calls for the same topic so persistence
   * dedup is a no-op on re-research.
   */
  private cannedBundle(topicKey: string, topicLabel: string): Bundle {
    const sources: Source[] = [
      this.academicSource(
        topicKey,
        topicLabel,
        1,
        `Foundations of ${topicLabel}`,
        "10.1000/mock.foundations",
        "Journal of Mock Studies",
        2021,
        "Grounds the foundational goalpost: core definitions and first principles.",
      ),
      this.academicSource(
        topicKey,
        topicLabel,
        2,
        `Applied methods in ${topicLabel}`,
        "10.1000/mock.applied",
        "Proceedings of Applied Mock Research",
        2023,
        "Grounds the applied goalpost: worked methods and concrete procedure.",
      ),
      this.webSource(
        topicKey,
        topicLabel,
        3,
        `A practitioner overview of ${topicLabel}`,
        `https://example.org/overview/${encodeURIComponent(topicLabel)}`,
        "Grounds the transfer goalpost: practitioner framing and real-world context.",
      ),
    ];
    return { topicKey, topicLabel, sources };
  }

  private academicSource(
    topicKey: string,
    topicLabel: string,
    n: number,
    title: string,
    doi: string,
    venue: string,
    year: number,
    scopeNote: string,
  ): Source {
    const ref = `s${n}`;
    const fullDoi = `${doi}.${this.shortHash(topicKey)}`;
    const rawText =
      `${title}. This is canned reference text for "${topicLabel}" used by the ` +
      `Phase 0 mock Research Agent. It states the central idea, defines the key ` +
      `terms, and gives one worked illustration so grounded generation has real ` +
      `passage text to attribute to.`;
    return {
      ref,
      kind: "academic",
      dedupKey: `doi:${fullDoi}`,
      doi: fullDoi,
      canonicalUrl: `https://doi.org/${fullDoi}`,
      title,
      authors: [{ name: "A. Mockauthor" }, { name: "B. Cannedresearcher" }],
      venue,
      publishedYear: year,
      rawText,
      scopeNote,
      chunks: this.chunksFor(ref, topicKey, rawText),
    };
  }

  private webSource(
    topicKey: string,
    topicLabel: string,
    n: number,
    title: string,
    canonicalUrl: string,
    scopeNote: string,
  ): Source {
    const ref = `s${n}`;
    const rawText =
      `${title}. A canned practitioner-style overview of "${topicLabel}" for the ` +
      `Phase 0 mock. It frames why the topic matters in practice and connects the ` +
      `core idea to a real-world setting the learner can picture.`;
    return {
      ref,
      kind: "web",
      dedupKey: `url:${canonicalUrl}`,
      doi: null,
      canonicalUrl,
      title,
      authors: [{ name: "Practitioner Mock" }],
      venue: null,
      publishedYear: 2024,
      rawText,
      scopeNote,
      chunks: this.chunksFor(ref, topicKey, rawText),
    };
  }

  /** Two deterministic, content-addressed chunks per source. */
  private chunksFor(ref: string, topicKey: string, rawText: string): Chunk[] {
    const halfway = Math.ceil(rawText.length / 2);
    const parts = [rawText.slice(0, halfway), rawText.slice(halfway)];
    return parts.map((text, ordinal) => ({
      contentHash: this.hash(`${topicKey}:${ref}:${ordinal}:${text}`),
      ordinal,
      text,
    }));
  }

  private hash(input: string): string {
    return createHash("sha256").update(input, "utf8").digest("hex");
  }

  private shortHash(input: string): string {
    return this.hash(input).slice(0, 12);
  }
}
