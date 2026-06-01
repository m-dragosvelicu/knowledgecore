# L2 Research Report: Grounding, Provenance, and the Academic-Integrity Backbone

**Author:** Academic Researcher (KnowledgeCore team)
**Date:** 2026-06-02
**Phase:** L2 (Research Agent, Provenance, the Library) — SPECCING, research only
**Scope of this document:** the integrity backbone and thesis defensibility of L2. It defines what "grounded in sources / provenance" should mean for this product, recommends a defensible claim-to-source granularity, sets out source-quality criteria, proposes how to evaluate grounding quality, and frames how to defend L2 in the thesis without over-claiming.

> Style note: this report follows the CEO standing rule of no em or en dashes in body prose. The companion HTML deliverable for the Founder will be produced from the `report-template.html` template separately; this markdown is the working research record.

---

## 1. Where we are, and what we must stay consistent with

L2 is not a clean slate. Three internal commitments already constrain the design, and the thesis prose has already promised them. Any L2 spec that contradicts them creates a defensibility problem at defence time.

**1.1 L2 was scoped out of L0 honestly, and the thesis says so.**
`L0.md` §1 states that L0 "defers source-grounded provenance and quote-traceability (L2)." §13 lists as explicit non-goals: "No source citations or quote-traceback in the user-visible UI (L2)" and "No grounding-provenance enforcement on generated content beyond opaque source IDs (L2)." The data model carries this forward: `InformationStep` has `sourceRefs: string[]` described as a "placeholder for L2; populated as opaque IDs in L0." I verified in the current codebase that `sourceIds` are indeed empty (`lib/services/mock/mockPathAdjuster.ts` sets `sourceIds: []`; `lib/journey/lessonGeneration.ts` defaults to `[]`), and there is no `Source` entity in `prisma/schema.prisma` yet. So the placeholder is real, and L2 is exactly the phase that fills it.

**1.2 The Design chapter has already framed provenance as an honest deferral, not a missing feature.**
Chapter 4 (`04-design.md` §4.8 / the "second seam" passage) states: "The core mechanic generates information content, but in this phase it does not enforce grounding provenance or expose quote-level traceability to the learner; source references are carried as opaque identifiers so a later provenance layer can attach without reshaping the data model. This is an honest scoping decision." Critically, it adds the defensibility hedge that **provenance is orthogonal to the central thesis claim**: "the claim under test is about the information-plus-experience mechanic, and provenance enforcement, while important for a deployed system, is orthogonal to whether experience grounds information into knowledge." This is the single most important framing constraint on L2. The thesis claim (CHARTER §2.3) is *experience grounds information into knowledge*. L2 does NOT defend that claim. L2 defends a different, secondary claim about the **trustworthiness of the information half** of the loop. We must keep these two claims separate or risk over-claiming.

**1.3 The Research Agent already has a routing design and an owner.**
`L0.md` §7 specifies the Research Agent as "Sonnet 4.6 + tool use" with routing: academic/concept query to OpenAlex (then Semantic Scholar for the citation graph); current-events/how-to to Tavily; structured extraction from a known URL to Firecrawl; "Returns ranked snippets with source IDs." CHARTER §4.1 assigns OpenAlex, Semantic Scholar, Tavily, Firecrawl integration, routing logic, and "source-quality heuristics" to the **Research Engineer**. So L2 has a designated mechanism owner. My domain is the principled definition, the granularity decision, the source-quality criteria, the evaluation method, and the thesis framing. The Research Engineer owns the retrieval plumbing. The AI Engineer owns generation that consumes the retrieved bundle.

**1.4 The reading list flagged vector stores as an L2 concern.**
`readinglist.md` Tier 4 defers "Vector databases deeply (matters at L2/L3)." `roadmap/L2.html` notes L2 "likely uses the Qdrant vector store already provisioned but unused in L0." So retrieval-over-a-stored-bundle is the anticipated architecture, which matches the "core source material bundle researched, stored in the Library, then content generated grounded in it" vision.

**Consistency verdict:** the founder's L2 vision (online Research Agent, a stored core source bundle in the Library, goalposts generated grounded in it, amendable on gaps, every claim traceable) is fully consistent with what the docs already promise. The one thing we must hold the line on is keeping the L2 trustworthiness claim distinct from the L0 learning claim.

---

## 2. External state of the art (literature, current to 2025/2026)

The relevant literature sits in four clusters: (a) what "attribution" even means formally; (b) benchmarks and metrics for citation/attribution quality; (c) the empirical finding that current systems attribute badly; (d) source-quality and credibility assessment. All references below are peer-reviewed venues (ACL, EMNLP, SIGIR, Computational Linguistics, ACM TOIS) or recognised survey/standard material, per the academic-sources-only rule.

### 2.1 The formal definition of attribution: the AIS framework (the anchor)

The foundational, most-cited formalisation is **Rashkin et al. (2023), "Measuring Attribution in Natural Language Generation Models,"** *Computational Linguistics* 49(4), 777-840 (also arXiv:2112.12870). They define **Attributable to Identified Sources (AIS)**: a generated statement is attributable to a source if a generic listener would affirm "According to [source], [statement]" given the source. They formalise this with the notion of *explicatures* (resolving context-dependent meaning before testing attribution) and validate a two-stage human annotation pipeline across conversational QA, summarisation, and table-to-text. AIS is the definition essentially all later work builds on. **This is the citation we anchor our provenance definition to.** Its key conceptual gift: attribution is about *support*, not *truth*. A statement can be faithfully attributed to a source that is itself wrong. This separation (attribution vs factuality) is exactly the distinction we need to keep the thesis honest.

### 2.2 Benchmarks and metrics for citation/attribution quality

- **Gao et al. (2023), "Enabling Large Language Models to Generate Text with Citations" (ALCE),** EMNLP 2023 (arXiv:2305.14627). The first automatic benchmark for citation evaluation. Defines the two operational metrics we should adopt: **citation recall** (is the output fully supported by its cited passages?) and **citation precision** (are there irrelevant citations that do not support the statement?). It scores along fluency, correctness, and citation quality, and shows these automatic metrics correlate with human judgement. Finding: even the best models lacked complete citation support roughly half the time on long-form (ELI5) answers. **This gives us our headline grounding metrics.**

- **Liu, Zhang, and Liang (2023), "Evaluating Verifiability in Generative Search Engines,"** Findings of EMNLP 2023 (arXiv:2304.09848). Defines **verifiability** operationally: a system should cite *comprehensively* (high citation recall, every statement supported) and *accurately* (high citation precision, every citation supports its statement). Human audit of four commercial generative search engines found, on average, only 51.5% of sentences fully supported by their citations and only 74.5% of citations actually supporting their sentence. This is the canonical "current systems attribute badly" datapoint and a strong motivator for why an explicit integrity backbone is worth building.

- **Min et al. (2023), "FActScore: Fine-grained Atomic Evaluation of Factual Precision in Long Form Text Generation,"** EMNLP 2023 (arXiv:2305.14251). Decomposes a generation into **atomic facts** (each a single piece of information), then labels each as supported or not by a knowledge source. This is the canonical argument for *atomic/claim-level* granularity in evaluation and the method we should borrow for our grounding evaluation harness. Note the cost message: automation is needed because human atomic-fact labelling is expensive, and even automated FActScore relies on retrieval plus a strong judge model.

- **RAGAS (Es et al., 2023), "Ragas: Automated Evaluation of Retrieval Augmented Generation,"** arXiv:2309.15217. A reference-free RAG evaluation framework whose **faithfulness** metric is directly reusable: decompose the answer into statements and check each against the retrieved context. Also defines context precision / context recall (retriever-side) and answer relevancy. Useful as an off-the-shelf operationalisation we can cite and partially reuse, while being honest that it is software with methodology docs rather than a single canonical peer-reviewed result (same caveat we already apply to DeepEval/Inspect in the existing RESEARCH.md).

### 2.3 Faithfulness vs correctness, and recent (2025) refinements

- **Huang et al. (2025), "A Survey on Hallucination in Large Language Models: Principles, Taxonomy, Challenges, and Open Questions,"** *ACM Transactions on Information Systems* 43(2) (arXiv:2311.05232). The standard hallucination survey. Its load-bearing distinction for us is the **factuality vs faithfulness** split: factuality hallucination = wrong about the world; faithfulness hallucination = unfaithful to the provided source/context. RAG and grounding target *faithfulness*; they reduce but do not eliminate *factuality* error, because the source itself can be wrong. This is the citation we use to state our honest limitation.

- **Wallat et al. (2025), "Correctness is not Faithfulness in Retrieval Augmented Generation Attributions,"** ICTIR 2025 (ACM, doi:10.1145/3731120.3744592). Directly relevant and recent. Shows a model can emit a *correct* citation (the cited source does support the claim) that is nonetheless *unfaithful* (the model did not actually use that source; it post-rationalised the citation after generating from parametric memory). This is the deepest defensibility trap for L2: a learner-visible citation can be correct yet not reflect how the content was produced. We should name this explicitly as a known limitation and decide how strong a claim we make about *faithfulness of process* vs *correctness of support*.

- **Schreieder et al. (2025), "Attribution, Citation, and Quotation: A Survey of Evidence-based Text Generation with Large Language Models,"** arXiv:2508.15396. The most current synthesis. Cleanly separates three concepts we should adopt as vocabulary:
  - **Attribution** = connecting generated text to source evidence (the semantic relation);
  - **Citation** = the formal identifier of the source (link/reference shown to the user);
  - **Quotation** = verbatim reproduction of source text (the strongest, most precise form).

  It enumerates the granularity ladder (document / passage / sentence / atomic-claim) and names the precision-vs-cost tradeoff. It lists evaluation dimensions of correctness, completeness, factuality, faithfulness, and retrievability. And it names the open challenges most relevant to us: distinguishing memorised training data from genuinely retrieved evidence (the faithfulness trap again), long-context dense-passage attribution, hallucinated citations, granularity-vs-efficiency, and multi-hop attribution needing multiple sources. **This is our umbrella citation for the granularity decision and the limitations section.**

- **A Survey of Large Language Models Attribution (Li et al., 2023/2024, arXiv:2311.03731)** and the community-maintained **awesome-llm-attributions** index (HITsz-TMG) are useful secondary maps for breadth, but we cite the peer-reviewed primaries above for weight.

### 2.4 Source quality and credibility assessment

The product's claim is not only "traceable to *a* source" but "traceable to a *credible* source." Two strands matter:

- **Information-literacy frameworks (recognised pedagogy, citable as method, not as empirical result):** the **CRAAP test** (Currency, Relevance, Authority, Accuracy, Purpose; Blakeslee / CSU Chico, 2004) and the **SIFT method / lateral reading** (Caulfield, 2017; Wineburg and McGrew, 2019, "Lateral Reading and the Nature of Expertise," *Teachers College Record* 121(11)). Wineburg and McGrew is peer-reviewed and shows expert fact-checkers evaluate credibility by *leaving the page and reading laterally* (checking what other sources say about the source) rather than by on-page cues. This is directly operationalisable: our source-quality heuristic should privilege corroboration across independent sources over single-source surface features.

- **Scholarly-source signals (for the academic/concept route via OpenAlex / Semantic Scholar):** venue type (peer-reviewed journal vs preprint vs blog), citation count and the citation graph (Semantic Scholar's `influentialCitationCount`), recency for fast-moving fields, and retraction status. These are objective, queryable signals the Research Engineer already has access to. The academic governance rule for the *thesis* (peer-reviewed papers, recognised textbooks, standards only) is a useful template for the *product's* source-tier policy, though the product must serve non-academic subjects too, so it needs a softer tiering (see §4).

- **Recent automated approach:** multi-tool LLM agent frameworks for credibility (e.g., the 2025 "Toward Verifiable Misinformation Detection" line, arXiv:2508.03092) combine web search, a source-credibility tool, and claim verification with an evidence log. Useful as prior art for *how* an agentic credibility check is structured, but we should treat these as design inspiration rather than settled science, and not over-rely on a single LLM's credibility judgement.

---

## 3. A rigorous definition of "grounded in sources / provenance" for KnowledgeCore

I propose the following layered definition, with explicit vocabulary borrowed from §2 so it is defensible by citation.

### 3.1 The vocabulary (adopt Schreieder et al. 2025 + Rashkin et al. 2023)

- **Source.** A retrieved, stored, addressable unit of external material in the Library, with stable identity and locatable spans (e.g., a paper, a textbook excerpt, a vetted web page), carrying credibility metadata. This is the entity L0's empty `sourceRefs` will finally point to.
- **Attribution (the relation).** A generated claim is *attributed* to a source span if that span **supports** the claim in the AIS sense: a reasonable reader affirms "According to [span], [claim]" (Rashkin et al. 2023). Attribution is about *support*, not about truth, and not (by itself) about whether the model literally used the span while generating.
- **Citation (the artifact).** The user-visible, addressable reference that realises an attribution (e.g., an inline marker linking the claim to the source span in the Library). Citations are what the learner sees and can click.
- **Quotation (the strongest form).** Verbatim reproduction of a source span. Where feasible, quotation makes attribution checkable by inspection and is the gold standard for high-stakes claims.
- **Provenance (the system property).** The end-to-end, persisted, auditable record that links each generated unit of information back through its citations to source spans in the Library, *including* the retrieval event that produced the bundle. Provenance is the database-and-pipeline fact; attribution is the per-claim relation; citation is the per-claim artifact.

### 3.2 The grounding contract (what we will and will not promise)

I recommend KnowledgeCore commit to a **two-level grounding contract**, stated honestly:

1. **Bundle-level grounding (the strong, defensible promise).** Every goalpost's `InformationStep` is generated *from a specific, stored core source bundle* retrieved for that subject/competency, and the system persists which bundle was used. This is a process guarantee we can fully enforce and verify: no information content is generated without a retrieved bundle in scope. This is the honest, testable backbone.

2. **Claim-level attribution (the per-claim promise, with measured, not asserted, quality).** Each substantive claim in the information content carries a citation to a source span that *supports* it in the AIS sense, and we **report** citation recall and citation precision rather than asserting perfection. We promise *verifiable* support (the learner can check), not *flawless* support.

The reason to split these: bundle-level grounding is a guarantee we can make absolute and is the genuine integrity advance over L0's empty placeholders. Claim-level attribution quality is empirical and, per Liu et al. (2023), even commercial systems only hit ~50 to 75%. Promising "every claim is perfectly grounded" is the over-claim that a committee will puncture. Promising "every claim carries a checkable citation, and here is our measured recall/precision" is defensible and honest.

### 3.3 What "amend on gaps" means in this vocabulary

The founder's "amend the bundle on gaps" maps to: when the generator cannot attribute a required claim to any span in the current bundle (a **coverage gap** = a claim with citation recall 0), the system either (a) re-invokes the Research Agent to amend the bundle, or (b) refuses to assert the claim and flags it. This is the provenance analogue of the L0 evaluator's honest `adjust_plan` escape: the integrity move is to *not fabricate support*. This is a strong thesis point because it mirrors a design principle the thesis already defends (honest stopping rules over forced success).

---

## 4. Recommended claim-to-source granularity

The granularity ladder (document / passage / sentence / atomic-claim) and its precision-vs-cost tradeoff are from Schreieder et al. (2025); the atomic-fact end is FActScore (Min et al. 2023); the sentence/passage operationalisation is ALCE (Gao et al. 2023).

**Recommendation: passage-level citation as the user-facing default, claim-level (atomic) as the evaluation granularity, with quotation reserved for high-stakes claims.**

Rationale:

- **User-facing citation at passage level (a cited span of the source, not the whole document, not every atom).** Document-level is too coarse to be verifiable (the learner cannot check a 30-page PDF). Atomic-per-claim citations in the *reading UI* create visual clutter and a false impression of precision that the underlying support may not justify (the faithfulness trap, Wallat et al. 2025). Passage-level (ALCE's unit) is the sweet spot: each information paragraph cites the specific source span(s) that support it, and the learner can click through to the exact passage in the Library. This is what generative search engines do and what learners already understand.

- **Atomic/claim level for *evaluation only*.** When we *measure* grounding quality (the C-stream evaluation, §5), we decompose the generated information into atomic facts (FActScore method) and compute citation recall/precision per atom. This finer granularity is where rigour lives; it does not need to be exposed in the UI. Separating display granularity (passage) from evaluation granularity (atomic) is the key move that keeps the product usable and the thesis rigorous at once.

- **Quotation for high-stakes or definitional claims.** Where a claim is a definition, a formula, a date, or otherwise verbatim-checkable, prefer quotation (verbatim span shown) over paraphrase-plus-citation. Quotation is the strongest attribution (Schreieder et al. 2025) and the cheapest to verify.

- **Do not promise faithful *process* attribution.** We attribute by *support* (AIS), verified post-hoc against the bundle, not by claiming the model literally read span X while writing claim Y. Wallat et al. (2025) show the latter is often unverifiable and frequently false even when citations are correct. Our claim is "every displayed citation has been verified to support its claim against the stored source," which is checkable, rather than "the model used this source," which is not.

This gives a clean, defensible three-line statement for the thesis: *display at passage level, evaluate at atomic level, escalate to quotation for high-stakes claims, and attribute by verified support rather than by asserted process.*

---

## 5. How to evaluate grounding quality

The evaluation must be defensible to a CS-education-research reviewer and must reuse the team's existing LLM-as-judge discipline (RESEARCH.md area 3; G-Eval; Zheng et al.; the known biases). The proposed harness has four metrics plus a human-validation step.

### 5.1 The four core metrics (all citable)

| Metric | What it measures | Granularity | Source |
|---|---|---|---|
| **Citation recall** | Fraction of generated claims fully supported by their cited source span(s) | atomic claim | Gao et al. 2023 (ALCE) |
| **Citation precision** | Fraction of citations that actually support their associated claim (no irrelevant cites) | per citation | Gao et al. 2023; Liu et al. 2023 |
| **Faithfulness (to bundle)** | Fraction of claims entailed by the retrieved bundle as a whole | atomic claim | RAGAS (Es et al. 2023); Huang et al. 2025 |
| **Source-quality score** | Credibility tier of the cited sources (corroboration, venue, citation graph) | per source | Wineburg & McGrew 2019; CRAAP; Semantic Scholar signals |

Citation recall and precision are the headline pair (they map exactly to the founder's "every claim traceable to a source"). Faithfulness-to-bundle catches the case where a claim is supported by *the bundle* but mis-cited at the span level. Source-quality keeps "traceable to a *credible* source" honest.

### 5.2 The judge, and how we keep it honest

Compute the metrics with an **LLM-as-judge entailment check** (does span S support claim C: supported / partially / not), the same architecture as the CheckpointEvaluator. Reuse the existing bias mitigations already documented for area 3 (position, verbosity, self-preference). Crucially, **validate the grounding judge the same way CHARTER C.2 validates the evaluator judge**: dual-rate a sample of claim-source pairs (judge + CEO) and report an inter-rater agreement statistic (Cohen's kappa). This makes the grounding evaluation as rigorous as the learning evaluation and reuses an approved methodology rather than inventing one.

### 5.3 A small, honest benchmark

Build a fixed evaluation set of, for example, 5 subjects times a few goalposts each, run the full L2 pipeline, and report the four metrics with the kappa-validated judge. Compare against the L0 baseline (where citation recall is by definition 0 because `sourceIds` are empty). The story "L0 grounding recall = 0 by construction; L2 grounding recall = X% measured" is a clean, defensible empirical result for the Evaluation chapter, and it explicitly frames L2 as an *increment in trustworthiness*, not a claim of perfection. Anchor the "current systems are far from perfect" context with Liu et al. (2023)'s 51.5% / 74.5% so our own numbers are read against a realistic bar.

---

## 6. How to frame and defend L2 in the thesis (without over-claiming)

### 6.1 Keep the two claims separate

- **Primary thesis claim (unchanged, CHARTER §2.3):** experience grounds information into knowledge. L2 does **not** strengthen or depend on this.
- **Secondary L2 claim (new, narrower):** *the information half of the loop can be made source-grounded and provenance-bearing, and we can measure how grounded it is.* This is a claim about trustworthiness/integrity of generated information, defended by §5's metrics.

State this separation explicitly in the chapter. It is the same move Chapter 4 already makes ("provenance is orthogonal to whether experience grounds information into knowledge"). It protects the thesis: a reviewer who attacks L2's grounding numbers cannot thereby touch the central claim.

### 6.2 The defensible positive story

Frame L2 as closing a gap the thesis already named honestly. L0 deliberately left `sourceRefs` as empty placeholders and said so; L2 fills them with a real Research Agent, a stored Library bundle, passage-level citations, and a measured grounding quality. The narrative "we scoped this out honestly in L0, named it as future work, and here it is, measured" is itself a credibility signal to a committee.

### 6.3 The limitations to state up front (so no one can spring them on you)

1. **Grounding reduces faithfulness error, not factuality error.** A credible source can still be wrong; attribution guarantees support, not truth (Rashkin et al. 2023; Huang et al. 2025). We do not claim the content is *correct*, only that it is *traceable* to a vetted source.
2. **Correct citations can be unfaithful to the generation process.** We verify support post-hoc against the bundle; we do not and cannot guarantee the model literally used the cited span while generating (Wallat et al. 2025). Our claim is about *verified support*, not *causal process*.
3. **Source-quality judgement is itself a model judgement.** Credibility tiering uses heuristics and an LLM; it can misjudge. We mitigate with corroboration-based (lateral-reading) signals and objective scholarly metadata, but we name it as a residual risk (Wineburg & McGrew 2019).
4. **Granularity is a design choice with a cost.** Passage-level display under-specifies which atom is supported; atomic evaluation is expensive. We chose the split deliberately and report it as a tradeoff (Schreieder et al. 2025), not as the only possible design.
5. **Soft subjects remain hard.** Just as L0 flagged history/art as where experience design is weakest, L2 should flag that high-quality, citable sources are abundant for technical subjects and patchier or more contested for soft or current-events subjects, where the Tavily route and source-quality tiering are weakest. Name it; do not paper over it.
6. **Bundle staleness and amendment honesty.** A stored bundle can go stale; the "amend on gap" loop can fail to find a supporting source. The integrity-preserving behaviour in that case is to refuse the claim, which is a designed branch, not a bug.

### 6.4 Suggested chapter placement

L2 grounding belongs as a clearly-bounded section in the Design and Implementation chapters (the second seam already exists in Chapter 4 to graduate from "deferred" to "realised in L2") and as a distinct, separately-reported result set in the Evaluation chapter (the four metrics with kappa-validated judge), kept visibly apart from the learning-claim results so the two claims never blur.

---

## 7. Annotated reference set (for the BibTeX file)

All peer-reviewed venues or recognised method/standard sources, per the academic-sources-only rule.

1. **Rashkin, H., Nikolaev, V., Lamm, M., Aroyo, L., Collins, M., Das, D., Petrov, S., Tomar, G. S., Turc, I., Reitter, D. (2023).** *Measuring Attribution in Natural Language Generation Models.* Computational Linguistics 49(4), 777-840. arXiv:2112.12870. — The AIS framework; our definition of attribution-by-support. **Anchor citation for §3.**
2. **Gao, T., Yen, H., Yu, J., Chen, D. (2023).** *Enabling Large Language Models to Generate Text with Citations (ALCE).* EMNLP 2023. arXiv:2305.14627. — Citation recall and citation precision metrics. **Anchor for §4 and §5.**
3. **Liu, N. F., Zhang, T., Liang, P. (2023).** *Evaluating Verifiability in Generative Search Engines.* Findings of EMNLP 2023. arXiv:2304.09848. — Verifiability = comprehensive + accurate citation; the 51.5% / 74.5% audit. **The realistic-bar citation.**
4. **Min, S., Krishna, K., Lyu, X., Lewis, M., Yih, W., Koh, P. W., Iyyer, M., Zettlemoyer, L., Hajishirzi, H. (2023).** *FActScore: Fine-grained Atomic Evaluation of Factual Precision in Long Form Text Generation.* EMNLP 2023. arXiv:2305.14251. — Atomic-fact decomposition; our evaluation granularity.
5. **Es, S., James, J., Espinosa-Anke, L., Schockaert, S. (2023).** *Ragas: Automated Evaluation of Retrieval Augmented Generation.* arXiv:2309.15217. — Reference-free faithfulness / context precision-recall; reusable metric. (Cite with the software-methodology caveat already applied to DeepEval/Inspect.)
6. **Huang, L., et al. (2025).** *A Survey on Hallucination in Large Language Models: Principles, Taxonomy, Challenges, and Open Questions.* ACM Transactions on Information Systems 43(2). arXiv:2311.05232. — Factuality vs faithfulness; our limitations anchor.
7. **Wallat, J., et al. (2025).** *Correctness is not Faithfulness in Retrieval Augmented Generation Attributions.* ICTIR 2025, ACM. doi:10.1145/3731120.3744592. — Correct-but-unfaithful citations; the process-faithfulness limitation.
8. **Schreieder, T., et al. (2025).** *Attribution, Citation, and Quotation: A Survey of Evidence-based Text Generation with Large Language Models.* arXiv:2508.15396. — Vocabulary (attribution/citation/quotation), granularity ladder, evaluation dimensions, open challenges. **Umbrella citation for §4 and §6.3.**
9. **Wineburg, S., McGrew, S. (2019).** *Lateral Reading and the Nature of Expertise: Reading Less and Learning More When Evaluating Digital Information.* Teachers College Record 121(11). — Corroboration-based source evaluation; basis for our credibility heuristic.
10. **Blakeslee, S. (2004).** *The CRAAP Test.* LOEX Quarterly 31(3). — Recognised information-literacy source-evaluation framework; the source-quality criteria scaffold.

Secondary/breadth (cite sparingly, prefer primaries): Li et al. (2023/2024), *A Survey of Large Language Models Attribution*, arXiv:2311.03731; the awesome-llm-attributions community index.

---

## 8. Top risks and open questions

1. **Faithfulness vs support framing (HIGH).** If we claim "the model used this source," Wallat et al. (2025) will sink it. Decision needed: commit in writing to the *verified-support* claim, not the *process* claim. (Open question for the Founder.)
2. **Display vs evaluation granularity (MEDIUM).** Confirm the split: passage-level citations in the UI, atomic-level only in the evaluation harness. The Research Engineer and UX/Frontend need this decision before they build the Library UI and the source-span store.
3. **Source-quality tiering for non-academic subjects (MEDIUM).** The academic-route signals (venue, citation graph) do not transfer to the Tavily/how-to route. We need a defensible softer tier for web sources, grounded in lateral-reading corroboration rather than on-page cues. Currently unspecified.
4. **Grounding-judge validation cost (MEDIUM).** §5.2 requires CEO dual-rating of claim-source pairs (same CEO-time bottleneck as CHARTER R.2). Batch with the existing C.2 rating sessions to amortise.
5. **"Amend on gap" failure behaviour (MEDIUM).** Confirm the integrity-preserving default is *refuse-and-flag the claim*, not *assert ungrounded*. This is the provenance analogue of `adjust_plan` and should be specced as a designed branch.
6. **Scope creep into the central claim (LOW but important).** Keep restating that L2 defends trustworthiness of information, not the experience-grounds-knowledge claim. Easy to blur in prose; guard it in review.
7. **Qdrant/vector-store dependency (LOW, owner = Research/Backend Engineer).** The "stored bundle, retrieve-over-it" architecture implies the provisioned Qdrant store gets used. Not my domain, but the grounding evaluation assumes a stored, span-addressable bundle exists.

---

*Working record only. The Founder-facing version of this report will be produced from `team/_pm/templates/report-template.html` per the Reporting Standard. WORKLOG and OPEN_QUESTIONS entries to follow in the academic-researcher workspace.*
