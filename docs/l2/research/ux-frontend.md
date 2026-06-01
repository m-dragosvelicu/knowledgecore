# L2 — Provenance & the Library: UX/Frontend Research

**Author:** UX/Frontend Engineer
**Phase:** L2 (Research Agent, Provenance, the Library) — SPECCING, research-only
**Date:** 2026-06-02
**Status:** Draft for PM/CEO review. No code changed.

> Scope of this doc: how **provenance** (where a claim came from) and the **Library** (the store of sourced material the learner can return to) surface to the learner, consistent with our paper / hand-drawn aesthetic. Backend retrieval, the Research Agent router, source-quality heuristics, and vector storage are the Research Engineer's and Backend's domains — referenced here only where they constrain the UI. L3 (user uploads, highlight-to-ask) is explicitly out of scope; I note the seams where it will hook in.

---

## 1. Principles & current state (what we are building on)

### 1.1 The aesthetic, in one paragraph

Warm paper (`bone #ECEAE4` page, `surface #F8F6F1` cards), a warm three-step ink scale, and exactly **one** chromatic hue: deep teal (`teal #1F6E67`, `tealDeep #14534D`, `tealSoft #D6E4E1`). Fraunces (variable serif) *speaks* — display, headings, numbers, scores. Hanken Grotesk *operates and reads* — body, labels, buttons, **and the long-form reading font** (decided: no reading serif). There is **no second decorative hue and no gradients**. The status palette is deliberately collapsed onto ink + teal so the product reads as one calm voice, not a traffic-light UI. The one hand-drawn "ink edge" (the shared `#rough` SVG filter + `.kc-draw` self-drawing keyframes) belongs to signature marks only — the trail nodes, the score ellipse, the headline underline, the corner squiggle (`components/marks/Marks.tsx`). It is a flourish vocabulary, not an icon set.

**Design implication for provenance:** a citation is *metadata*, not a signature surface. It must read in the **quiet middot-meta voice** (`.kc-meta` / `kcLabel`: Hanken, muted ink, uppercase micro-labels), never in the roughened hand. Links go `tealDeep` with a `tealSoft` underline. We do **not** introduce a citation "blue", a colored chip per source type, or any new hue — that would break the single-teal rule (theme note, `lib/theme/theme.ts`).

### 1.2 The reading surface today

The goalpost reading half is `InformationView` (`components/journey/InformationView.tsx`): a calm paper card, ~62ch measure, 17px Hanken at line-height 1.75, a lead paragraph in full ink, teal-edged pull-quotes, a gentle dwell gate. Lesson body is LLM-generated markdown rendered through `components/Markdown.tsx` (react-markdown → remark-gfm/math → **rehype-sanitize** → katex/highlight). Critically, this is a **React Server Component that builds an element tree** — there is no `dangerouslySetInnerHTML` for lesson text. Any inline citation marker must therefore be either (a) a markdown construct the renderer maps to a custom component, or (b) injected by the generator as a known token. (See §4.1.)

Visuals already have a fully-built attribution pattern worth reusing as the **provenance precedent**: `components/journey/VisualMedia.tsx` renders a `<figcaption>` in `.kc-meta` assembling *real, checkable* attribution — title, creator, license (linked, teal), source page (linked, teal) — and is explicit that attribution is "**assembled ONLY from resolved fields, never fabricated**". Video carries an upfront `reference · unevaluated suggestion` label so it never reads as endorsed. **This is the house style for "where this came from" and L2 provenance should extend it, not invent a parallel one.**

### 1.3 The data reality

`sourceIds` already exists in the schema as an **empty placeholder** on the information step: `Step.payload` for `type: information` is `{ content: string; sourceIds?: string[] }` (`prisma/schema.prisma:276`, `lib/journey/lessonGeneration.ts:26`). Every Mock generator writes `sourceIds: []` today (`mockPathOutliner.ts`, `mockPathAdjuster.ts`). So L2's UI job is: **give `sourceIds` a real referent (a Source record), bind claims to it, and surface that binding.** There is no Source model yet — Backend/Research own creating it; the UI contract below assumes a minimal `Source { id, title, author?, publisher?, url, kind, retrievedAt, snippet? }`.

### 1.4 The naming collision to resolve NOW

The journeys list page (`app/journeys/page.tsx:149`) **already uses the word "library"** — its eyebrow reads `Your library` and the page is titled "All your journeys". L2 introduces "**The Library**" as a *store of sources and sourced material*. Two different things both called "Library" will confuse learners and us. **Decision needed (founder):** either rename the journeys page label (e.g. "Your journeys") and reserve "Library" for the source store, or name the source store something distinct (e.g. "Sources", "The Shelf", "Source library"). My recommendation: rename the journeys-page eyebrow to **"Your journeys"** and keep **"Library"** for the L2 source store, because "Library = where sources live" matches the founder's vision and the public/shared future. Logged as the top open question.

---

## 2. External SOTA (2026): how leading tools surface provenance & libraries

### 2.1 Inline citation / provenance patterns

The convergent pattern across retrieval-first tools (Perplexity, ShapeofAI's documented "Citations" pattern, the shadcn AI inline-citation component) is:

1. **Numbered superscript markers `[n]`** placed at the end of the claim they support — the marker maintains the *claim-to-source bond* in-line without interrupting the reading rhythm. Typically 5–10 per answer.
2. **A marker is a hover/press target.** Hovering reveals a **source card**: favicon/domain or publication, title, and ideally a **pull-quote of the exact supporting passage**. ShapeofAI and the deep-link guidance both stress: *deep-link to the relevant part of the source, or pull the quote up into the hover*, specifically to counter the AI-misattribution failure mode.
3. **Multiple sources for one claim → a small carousel / stacked chip** inside the hover, rather than a row of markers cluttering the text.
4. **A "Sources" panel/footer** lists the full set once, numbered to match the inline markers — the canonical bibliography for that piece of content.
5. **Philosophy:** retrieval-built systems put citations *at the center*; model-only systems hide them until they switch to retrieval. KnowledgeCore L2 is explicitly retrieval-grounded, so citations are first-class — but our *aesthetic* demands they stay calm, not loud.

### 2.2 Personal-library / revisit patterns

From the PKM / reading-app survey (Zotero, ReadHero, Obsidian-class tools):

- **Auto-extracted bibliographic metadata** (author, title, date, publisher) is the unit; the learner never types it.
- **Revisit is the point, not the log.** ReadHero's framing — "truly remember, not just record that you finished" — matches our thesis claim (experience → knowledge). The Library should be a *return-to-and-reflect* surface, not a download folder.
- **Provenance back-links:** a source in the library links back to *where it was used* (which goalpost), and a goalpost links *out* to its sources. Bidirectional.
- **Tagging/grouping** by topic or collection is standard but is **scope creep for a thesis** — defer.

---

## 3. Recommended provenance display in the goalpost read

Three layers, from least to most intrusive. **L2 ships layers A and C; layer B is the stretch goal.**

### A. The per-goalpost "Sources" panel (REQUIRED — the spine of provenance)

At the end of `InformationView`, below the reading body and before the continue gate, a quiet **"Sourced from"** block:

- An `Eyebrow` ("Sourced from") — the existing uppercase teal-deep eyebrow.
- A numbered list of the goalpost's sources, each row in `.kc-meta` voice: `[1] Title — Author · Publisher (year)`, the title a teal link opening the source in a new tab (`rel="noopener noreferrer"`, mirroring VisualMedia exactly).
- No roughened marks, no card-per-source grid. A hairline-`--line` separated list on the paper surface.
- This reuses the **VisualMedia attribution voice verbatim**, so visuals and text provenance read as one system.
- Accessibility: it is a real `<ol>` of real links — keyboard-navigable, no color-only meaning (the `[n]` numerals carry the binding, not hue).

This alone satisfies "every claim is traceable" at the **goalpost grain** and is honest about what the Research Agent actually returns (a *bundle* per goalpost), without over-promising sentence-level precision the generator may not reliably produce.

### B. Inline `[n]` markers bound to claims (STRETCH — only if the generator is reliable)

If (and only if) the AI Engineer's generator can emit **trustworthy** claim→source bindings, render superscript teal `[n]` markers inline, matching the panel numbering:

- The marker is a small Hanken superscript in `teal`, **not** a roughened mark — it is metadata.
- On hover/focus it opens a **source hover-card** (MUI `Popover`/`Tooltip` styled to a paper card with `--line` border and `shadow-sm`): source title, author/publisher, and the **pull-quote** snippet the claim rests on. This is the SOTA anti-misattribution move and the most thesis-defensible provenance artifact.
- **Rendering path:** because lesson text is a react-markdown *element tree* (not raw HTML), the cleanest implementation is a custom token the generator emits (e.g. `[[cite:1]]`) mapped to a `<Citation/>` component via react-markdown's `components` map, OR a small remark plugin — **NOT** widening the rehype-sanitize allowlist for raw `<sup>` (that weakens the untrusted-content boundary). This is a non-trivial build; hence stretch.
- **Honesty guardrail (matches our culture):** if a binding's confidence is low, **omit the inline marker** and let the panel (layer A) carry it. Never render a fabricated precise citation. This mirrors VisualMedia's "never fabricated" and the `adjust_plan` "honest escape" ethos.

**Recommendation:** spec layer B, build layer A first, gate B on generator reliability evidence from the Research/AI engineers. For a bachelor's thesis, **A + a working B on one or two demo goalposts** is a strong, defensible demonstration; full-corpus B is not required.

### C. The bundle-confirmation seam (REQUIRED — lightweight)

The founder's flow: after the learner confirms the path, a "core source material bundle" is researched and stored, then goalpost content is generated grounded in it. The path-confirmation gate already exists (`PathConfirmationGate.tsx`) and is the natural seam. L2's minimal UI addition there:

- After "Looks good, start", the existing `GettingReady` ("getting things ready") state covers bundle research. **Add a line of liveness copy** naming the step — e.g. "Gathering and checking your sources…" — which also addresses the deferred static-loading bug (memory: `bug_getting_ready_static`). No new screen.
- A goalpost whose content was grounded in the bundle carries no special chrome beyond its Sources panel (A). The bundle is plumbing; the learner meets it as per-goalpost provenance, not as a separate ceremony.
- **"Amend the bundle if gaps appear"** (founder) maps to the *existing* `adjust_plan` / path-revision machinery conceptually, but a learner-facing "this section is missing a source / find more on X" affordance is **L2-stretch-or-L3** — note the seam (a quiet workbench-tier "ask for another source" link beside the Sources panel) but do not build it in L2.

---

## 4. The Library UI — L2 scope vs deferred

### 4.1 What the Library IS in L2 (minimal, thesis-honest)

A new route (proposed `/library`, reached from `AppHeader` / `AccountMenu`) that is a **read-only, per-learner store of the sources that grounded their journeys**, plus the journeys those sources belong to. It is the "return to and revisit" surface.

**In scope for L2:**

1. **Source list / index.** All sources cited across the learner's journeys, de-duplicated. Each row in the established list style (hairline-separated, `.kc-meta` voice): title (teal link out), author/publisher, kind, and a back-link "used in: *{goalpost / journey}*". Reuses the `JourneyListRow` visual grammar (row + quiet metadata + overflow), not a new card system.
2. **Source detail (lightweight).** Tapping a source opens a paper panel: full metadata, the stored snippet(s)/pull-quotes that were used, the external link, and the list of goalposts it grounded (bidirectional provenance, §2.2). **This panel is the natural L3 hook** for "highlight a passage and ask a question" — leave a comment marking where that affordance attaches, build nothing.
3. **Per-journey "Sources for this journey" view.** From a completed/in-progress journey (the path trail or complete page), a link to the subset of the Library scoped to that journey. This is the most learner-meaningful revisit entry point and the cheapest to build (it is the union of the goalpost Sources panels).

**Empty state:** until a journey has been grounded by the Research Agent, the Library is empty. Use the existing warm empty-state pattern (paper card + Fraunces line + a pointer back to starting a journey), mirroring the journeys page's `HomeHero` fallback.

### 4.2 What is DEFERRED

| Item | Defer to | Why |
|---|---|---|
| User-uploaded sources + highlight-to-ask | **L3** (founder-stated OOS) | Out of scope; Library source-detail panel marks the hook. |
| Shared / public Library across users | **post-L2** (founder: "later becomes shared/public") | Needs a sharing/permissions model; not a thesis requirement. |
| Tagging, collections, manual organization | **post-L2** | PKM nicety; scope creep for a thesis. |
| Learner-facing "amend the bundle" / request-more-sources | **L2-stretch or L3** | Note the seam beside the Sources panel; gate on Research Agent maturity. |
| Inline `[n]` markers across the full corpus (layer B at scale) | **L2-stretch** | Gate on generator binding reliability; demo on 1–2 goalposts suffices. |
| Full-text in-app source reader / annotation | **out** | We link out; we are not a reader app. |

### 4.3 Where "where did this come from" lives, end to end

1. **In the read:** Sources panel under each goalpost (always), inline `[n]` hover-cards (where reliable).
2. **At journey grain:** "Sources for this journey" link from the trail / complete page.
3. **At learner grain:** the Library route — the cross-journey store you return to.
4. **Reopening a source:** every appearance of a source is a real external link (new tab, `noopener`), and from the Library, a detail panel with the stored snippet so the learner sees *why it mattered* before leaving the app.

---

## 5. Component reuse map (no new design system needed)

| Need | Reuse | New work |
|---|---|---|
| Source attribution voice | `VisualMedia` `<figcaption>` `.kc-meta` pattern | extract a shared `<SourceCite/>` for text + visuals |
| Sources panel in read | `Eyebrow` + hairline list + `InformationView` surface | small `<SourcesPanel sources={...}/>` |
| Inline marker (stretch) | react-markdown `components` map / remark token | `<Citation/>` + paper-card `Popover` |
| Library route shell | `app/journeys/page.tsx` layout, `JourneyListRow`, `SectionTitle` | `/library` page + `SourceListRow` |
| Source detail panel | `PathConfirmationGate` `Surface` paper-panel pattern | `<SourceDetail/>` (marks L3 highlight hook) |
| Bundle-research liveness | `GettingReady` | one copy/animation line (also fixes deferred bug) |

Nothing here is a *signature surface* under the MUI-trap rule (those are assessment, path-viz, checkpoint, Execution UX). Provenance is metadata chrome, so building from MUI primitives + existing tokens is correct and low-risk.

---

## 6. Top risks & open questions

- **R1 — "Library" name collision (BLOCKING-ISH).** `app/journeys/page.tsx` already labels itself "Your library". Must rename one before L2 ships. Recommendation: journeys → "Your journeys"; reserve "Library" for sources. *Founder decision needed.*
- **R2 — Inline citation reliability.** Layer B is only honest if the generator's claim→source bindings are trustworthy. If they are not, render layer A only and never fake precision. *Gate on AI/Research engineer evidence.*
- **R3 — Sanitization boundary.** Do **not** widen `rehype-sanitize` to allow raw `<sup>`/HTML in lesson markdown for citations — use a custom token mapped via react-markdown's `components`, preserving the untrusted-content boundary.
- **R4 — Single-teal discipline.** Resist per-source-type colored chips / a citation "blue". Provenance reads in ink + teal + the `.kc-meta` voice only.
- **R5 — Provenance grain mismatch.** The Research Agent returns *bundles per goalpost*, but SOTA citations imply *per-claim*. Default to goalpost-grain (panel) as the truth; only claim down to inline markers where bindings are real.
- **Q1 (founder):** Confirm naming (R1) and confirm L2 = layer A + Library read-only + per-journey sources, with layer B as a demo-only stretch. Is "shared/public Library" definitely post-L2?
- **Q2 (Backend/Research):** Minimal `Source` model shape and whether per-claim bindings (offsets/quote spans) will be persisted, or only a per-goalpost source set. This decides whether layer B is even buildable.

---

*Companion precedent files: `components/journey/VisualMedia.tsx` (attribution voice), `components/journey/InformationView.tsx` (read surface), `components/Markdown.tsx` (render/sanitize boundary), `prisma/schema.prisma:276` (`sourceIds` placeholder), `app/journeys/page.tsx:149` (name collision).*

**Sources (external SOTA):**
- [ShapeofAI — Citations pattern](https://www.shapeof.ai/patterns/citations)
- [shadcn AI — Inline Citation component](https://www.shadcn.io/ai/inline-citation)
- [How AI Engines Cite Sources (ChatGPT/Claude/Perplexity/SGE)](https://medium.com/@aivsrank/how-ai-engines-cite-sources-patterns-across-chatgpt-claude-perplexity-and-sge-8c317777c71d)
- [Perplexity Platform Guide — Citation-Forward Answers](https://www.unusual.ai/blog/perplexity-platform-guide-design-for-citation-forward-answers)
- [Personal Knowledge Management 2025](https://www.glukhov.org/post/2025/07/personal-knowledge-management/)
- [Best PKM tools 2026 (Audionotes)](https://www.audionotes.app/blog/best-personal-knowledge-management-tools)
