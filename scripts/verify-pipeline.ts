/**
 * QA — Slice 5: the §11 automated test suite for the Two-Phase Visual Lesson
 * Pipeline. No DB, no LLM key — every dependency is a pure mock injected
 * through the orchestrator's ports.
 *
 * Run: `bun run scripts/verify-pipeline.ts`. Exits non-zero on any failure.
 *
 * Covers §11.1-4: orchestrator fan-out/retry-drop/assemble/persist, the
 * no-draw Author-contract (ASCII structurally impossible), SVG worker
 * sanitize+retry-then-drop, and the renderer block-walk invariant.
 */

import {
  runLessonPipeline,
  assemble,
} from "../lib/journey/lesson/orchestrator";
import type {
  Author,
  VisualWorker,
  VisualWorkerInput,
  VisualWorkers,
  OrchestratorPorts,
} from "../lib/services/interfaces/lessonOrchestrator.interface";
import {
  isVisualBlock,
  isProseBlock,
  visualBlocks,
  type DraftLessonDoc,
  type LessonDoc,
} from "../lib/services/lessonDoc";
import type { LessonContentInput } from "../lib/services/lessonContent";
import type { ResolvedVisual } from "../lib/services/visualMedia";
import type { LessonGenerationState } from "../lib/journey/lesson/generationState";
import { mediumForKind } from "../lib/services/visual/gate";
import { authoredBlockSchema } from "../lib/services/providers/lessonAuthor.service";
import { SvgWorker, judgeSanitizedSvg } from "../lib/services/providers/visualWorkers.service";
import { sanitizeSvg } from "../lib/services/visual/svgSanitizer";
import type { LLMClient, CompletionResult } from "../lib/llm";

// ---------------------------------------------------------------------------
// Tiny assertion harness (same console PASS/FAIL convention as verify-*.ts).
// ---------------------------------------------------------------------------
let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) {
    pass++;
    console.log(`PASS | ${name}`);
  } else {
    fail++;
    console.log(`FAIL | ${name}${detail ? ` | ${detail}` : ""}`);
  }
}

const INPUT: LessonContentInput = {
  conceptKey: "gp1",
  subject: { canonicalName: "Test subject", scopeNote: "scope" },
  goalpost: { order: 1, title: "GP", objective: "obj" },
  experiencePrompt: "do the thing",
  endAchievement: "be able to do the thing",
  assessment: [],
  profile: null,
};

/** A draft with: prose, svg-routed visual, image-routed visual, video-routed visual. */
function makeDraft(): DraftLessonDoc {
  return {
    sections: [
      {
        id: "s0",
        heading: "Section A",
        blocks: [
          { type: "prose", id: "p0", md: "First prose." },
          { type: "visual", id: "v-svg", kind: "diagram", spec: "a labelled box", status: "pending" },
          { type: "prose", id: "p1", md: "Second prose." },
          { type: "visual", id: "v-img", kind: "photographic", spec: "a honeybee", status: "pending" },
        ],
      },
      {
        id: "s1",
        heading: "Section B",
        blocks: [
          { type: "visual", id: "v-vid", kind: "process", spec: "a process", status: "pending" },
          { type: "prose", id: "p2", md: "Third prose." },
        ],
      },
    ],
  };
}

class MockAuthor implements Author {
  constructor(private readonly draft: DraftLessonDoc | null, private readonly throws = false) {}
  async author(): Promise<DraftLessonDoc> {
    if (this.throws || !this.draft) throw new Error("author terminal failure");
    return this.draft;
  }
}

/** A worker whose behaviour is scripted per id (resolve | drop-none | throw), with a call counter. */
class ScriptedWorker implements VisualWorker {
  calls = 0;
  constructor(private readonly behaviour: (input: VisualWorkerInput) => "ok" | "none" | "throw") {}
  async resolve(input: VisualWorkerInput): Promise<ResolvedVisual> {
    this.calls++;
    const b = this.behaviour(input);
    if (b === "throw") throw new Error("worker boom");
    if (b === "none") {
      return { medium: "none", id: input.id, caption: input.spec, reason: "scripted_drop" };
    }
    // Return a medium-correct, renderable payload.
    const medium = mediumForKind(input.kind);
    if (medium === "svg") return { medium: "svg", id: input.id, svg: "<svg><rect/></svg>", caption: input.spec };
    if (medium === "image")
      return {
        medium: "image",
        id: input.id,
        url: "https://example.com/x.jpg",
        caption: input.spec,
        attribution: { creator: null, licenseName: "CC0", licenseUrl: null, sourcePage: null, source: "Mock", title: null },
      };
    return { medium: "video", id: input.id, embedUrl: "https://example.com/e", caption: input.spec, provider: "mock" };
  }
}

function workersFrom(
  svg: VisualWorker,
  image: VisualWorker,
  video: VisualWorker,
): VisualWorkers {
  return { svg, image, video };
}

// ---------------------------------------------------------------------------
// §11.1 — Orchestrator units.
// ---------------------------------------------------------------------------
async function testOrchestrator() {
  console.log("\n== §11.1 Orchestrator units ==");

  // (a) Happy path: every worker resolves; fan-out hits each medium worker once;
  //     assemble keeps all 3 visuals + all prose, in order; sink fires staged.
  {
    const svg = new ScriptedWorker(() => "ok");
    const image = new ScriptedWorker(() => "ok");
    const video = new ScriptedWorker(() => "ok");
    const states: LessonGenerationState[] = [];
    const ports: OrchestratorPorts = {
      author: new MockAuthor(makeDraft()),
      workers: workersFrom(svg, image, video),
      onProgress: (s) => { states.push(s); },
    };
    const doc = await runLessonPipeline(INPUT, ports);

    check("fan-out: svg worker called once", svg.calls === 1, `calls=${svg.calls}`);
    check("fan-out: image worker called once", image.calls === 1, `calls=${image.calls}`);
    check("fan-out: video worker called once", video.calls === 1, `calls=${video.calls}`);

    const flat = doc.sections.flatMap((s) => s.blocks);
    const vis = flat.filter(isVisualBlock);
    const prose = flat.filter(isProseBlock);
    check("assemble: all 3 visuals survive (ready)", vis.length === 3 && vis.every((v) => v.status === "ready" && !!v.payload));
    check("assemble: all 3 prose survive", prose.length === 3);

    // Order preserved within section A: prose, svg, prose, image.
    const sA = doc.sections[0].blocks.map((b) => b.id);
    check("assemble: document order preserved in section A", JSON.stringify(sA) === JSON.stringify(["p0", "v-svg", "p1", "v-img"]), JSON.stringify(sA));

    check("persist: contentGeneratedAt stamped (ISO)", typeof doc.contentGeneratedAt === "string" && !Number.isNaN(Date.parse(doc.contentGeneratedAt)));

    // Progress sink: authoring -> composing(total=3) -> composing done advances -> assembling.
    const stages = states.map((s) => s.stage);
    check("progress: emits authoring first", stages[0] === "authoring");
    check("progress: emits composing with total=3", states.some((s) => s.stage === "composing" && s.total === 3));
    const composingDones = states.filter((s) => s.stage === "composing").map((s) => s.done);
    check("progress: composing 'done' reaches total (3)", composingDones.includes(3), `dones=${composingDones}`);
    check("progress: emits assembling", stages.includes("assembling"));
  }

  // (b) retry-then-drop: a worker that returns `none` AND a worker that THROWS both
  //     drop their slot; the OTHER visual + all prose survive. Terminal worker
  //     failure is NOT terminal for the lesson.
  {
    const svg = new ScriptedWorker(() => "none"); // v-svg dropped via none
    const image = new ScriptedWorker(() => "throw"); // v-img dropped via throw
    const video = new ScriptedWorker(() => "ok"); // v-vid survives
    const doc = await runLessonPipeline(INPUT, {
      author: new MockAuthor(makeDraft()),
      workers: workersFrom(svg, image, video),
    });
    const vis = doc.sections.flatMap((s) => s.blocks).filter(isVisualBlock);
    check("drop: none-result slot omitted", !vis.some((v) => v.id === "v-svg"));
    check("drop: thrown-worker slot omitted", !vis.some((v) => v.id === "v-img"));
    check("drop: surviving slot kept (ready+payload)", vis.length === 1 && vis[0].id === "v-vid" && vis[0].status === "ready");
    const prose = doc.sections.flatMap((s) => s.blocks).filter(isProseBlock);
    check("drop: all prose still present (prose stands alone)", prose.length === 3);
    // No dangling ref: every surviving visual block carries a payload.
    check("drop: no payload-less visual block survives", vis.every((v) => !!v.payload));
  }

  // (c) Author throw is TERMINAL: the pipeline rejects (caller records `failed`).
  {
    let threw = false;
    try {
      await runLessonPipeline(INPUT, {
        author: new MockAuthor(null, true),
        workers: workersFrom(new ScriptedWorker(() => "ok"), new ScriptedWorker(() => "ok"), new ScriptedWorker(() => "ok")),
      });
    } catch {
      threw = true;
    }
    check("terminal: Author throw propagates (pipeline rejects)", threw);
  }

  // (d) assemble() in isolation: a missing resolution AND a `none` both drop.
  {
    const draft = makeDraft();
    const all = visualBlocks(draft);
    check("helper: visualBlocks finds all 3 visuals in order", all.map((b) => b.id).join(",") === "v-svg,v-img,v-vid");
    const byId = new Map<string, ResolvedVisual>();
    // resolve only v-vid; leave v-svg missing; v-img -> none.
    byId.set("v-vid", { medium: "video", id: "v-vid", embedUrl: "https://e", caption: "c", provider: "p" });
    byId.set("v-img", { medium: "none", id: "v-img", caption: "c", reason: "x" });
    const doc: LessonDoc = assemble(draft, byId);
    const vis = doc.sections.flatMap((s) => s.blocks).filter(isVisualBlock);
    check("assemble-isolated: missing resolution dropped", !vis.some((v) => v.id === "v-svg"));
    check("assemble-isolated: none dropped", !vis.some((v) => v.id === "v-img"));
    check("assemble-isolated: resolved kept", vis.length === 1 && vis[0].id === "v-vid");
  }
}

// ---------------------------------------------------------------------------
// §11.2 — Author-contract: NO draw field in the authored block schema.
// ---------------------------------------------------------------------------
function testAuthorContract() {
  console.log("\n== §11.2 Author-contract (no-draw, ASCII structurally impossible) ==");
  // The Zod schema's shape is the contract. Assert its key set contains ONLY the
  // no-draw fields and NONE of the draw-bearing ones.
  const shape = (authoredBlockSchema as unknown as { shape: Record<string, unknown> }).shape;
  const keys = Object.keys(shape).sort();
  check("schema keys are exactly {type, md, kind, spec}", JSON.stringify(keys) === JSON.stringify(["kind", "md", "spec", "type"]), JSON.stringify(keys));

  const FORBIDDEN = ["svg", "svgsource", "svgSource", "draw", "image", "imageData", "image-data", "canvas", "ascii", "figure", "diagramSource"];
  const lowerKeys = keys.map((k) => k.toLowerCase());
  const leaked = FORBIDDEN.filter((f) => lowerKeys.includes(f.toLowerCase()));
  check("schema has NO draw-bearing field", leaked.length === 0, `leaked=${leaked.join(",")}`);

  // Behavioural: the schema must accept a {type:visual, kind, spec} block and a
  // {type:prose, md} block, and must NOT carry through any extra draw payload.
  const visParse = authoredBlockSchema.safeParse({ type: "visual", kind: "diagram", spec: "a box" });
  check("schema parses a no-draw visual block", visParse.success);
  if (visParse.success) {
    check("parsed visual block exposes no svg/draw key", !("svg" in visParse.data) && !("svgSource" in visParse.data) && !("draw" in visParse.data));
  }
  // Zod object strips unknown keys by default, so even if a model emits svgSource it
  // is DROPPED, not carried. Prove the strip.
  const sneaky = authoredBlockSchema.safeParse({ type: "visual", kind: "diagram", spec: "x", svgSource: "<svg/>" });
  check("schema STRIPS a smuggled svgSource (not carried through)", sneaky.success && !("svgSource" in (sneaky.data as object)));
}

// ---------------------------------------------------------------------------
// §11.3 — SVG worker: sanitization + retry-on-junk -> drop.
// ---------------------------------------------------------------------------

/** A scripted LLM client: returns the queued raw outputs in order (one per attempt). */
class ScriptedLLM implements LLMClient {
  attempt = 0;
  constructor(private readonly outputs: string[]) {}
  async complete(): Promise<CompletionResult> {
    const text = this.outputs[Math.min(this.attempt, this.outputs.length - 1)] ?? "";
    this.attempt++;
    return { text, usage: { inputTokens: 0, outputTokens: 0 }, model: "mock" };
  }
  async completeStructured<T>(): Promise<T> {
    throw new Error("not used");
  }
}

async function testSvgWorker() {
  console.log("\n== §11.3 SVG worker (sanitize + retry-on-junk -> drop) ==");

  // Pure sanitizer assertions: strips script / on* / foreignObject / external refs.
  {
    const dirty = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
      <script>alert(1)</script>
      <rect x="0" y="0" width="50" height="50" onclick="steal()" fill="#333"/>
      <foreignObject><div xmlns="http://www.w3.org/1999/xhtml">HTML</div></foreignObject>
      <image href="https://evil.example/x.png"/>
      <use xlink:href="#thing"/>
      <a href="https://evil.example/page">navigate</a>
      <text x="10" y="80">label</text>
    </svg>`;
    const { svg, ok, removed } = sanitizeSvg(dirty);
    check("sanitize: returns ok with an <svg> root", ok && /<svg[\s>]/i.test(svg));
    check("sanitize: strips <script>", !/<\s*script/i.test(svg));
    check("sanitize: strips event handlers (onclick)", !/\son\w+\s*=/i.test(svg));
    check("sanitize: strips <foreignObject> + its HTML", !/foreignobject/i.test(svg) && !/<div/i.test(svg));
    check("sanitize: strips <image>/<use>/<a> external-ref elements", !/<image/i.test(svg) && !/<use/i.test(svg) && !/<a[\s>]/i.test(svg));
    check("sanitize: strips href / xlink:href external refs", !/href\s*=/i.test(svg) && !/javascript:/i.test(svg));
    // The top-level safe <rect> keeps its geometry/fill (onclick stripped) and the
    // top-level <text> survives; text nested in a DENIED element is correctly dropped.
    check("sanitize: keeps the safe <rect> and top-level <text>", /<rect/i.test(svg) && /<text/i.test(svg));
    check("sanitize: audit trail records removals", removed.includes("script") && removed.includes("foreignobject"));
  }

  // judgeSanitizedSvg: empty / unsafe / too-small / no-drawing-element are unusable.
  {
    check("judge: !ok -> unusable", !judgeSanitizedSvg("<svg></svg>", false).usable);
    check("judge: empty -> unusable", !judgeSanitizedSvg("", true).usable);
    check("judge: too small -> unusable", !judgeSanitizedSvg("<svg></svg>", true).usable);
    const noShape = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">${" ".repeat(140)}</svg>`;
    check("judge: no drawing element -> unusable", !judgeSanitizedSvg(noShape, true).usable);
    const good = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 120"><rect x="10" y="10" width="80" height="40" fill="#444"/><text x="20" y="35">node</text></svg>`;
    check("judge: real shape + bytes -> usable", judgeSanitizedSvg(good, true).usable);
  }

  // Worker retry-then-drop behaviour, driven by a scripted LLM:
  const spec = { id: "v1", kind: "diagram" as const, spec: "a labelled box with two arrows" };

  // (a) First attempt junk (no <svg>), then a clean SVG -> succeeds on retry.
  {
    const clean = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 160"><rect x="20" y="20" width="120" height="60" fill="#446" stroke="#222"/><text x="40" y="55" font-size="14">Box A</text><line x1="140" y1="50" x2="220" y2="50" stroke="#222"/></svg>`;
    const llm = new ScriptedLLM(["sorry, here is a description and no svg", clean]);
    const worker = new SvgWorker(llm);
    const res = await worker.resolve(spec);
    check("worker: junk-then-clean retries and SUCCEEDS", res.medium === "svg", `medium=${res.medium}, attempts=${llm.attempt}`);
    check("worker: retried (2 attempts consumed)", llm.attempt === 2, `attempts=${llm.attempt}`);
    if (res.medium === "svg") {
      check("worker: success payload is sanitized (no script/handlers)", !/<script/i.test(res.svg) && !/\son\w+=/i.test(res.svg));
    }
  }

  // (b) All attempts junk -> DROP (none) after SVG_MAX_ATTEMPTS.
  {
    const llm = new ScriptedLLM(["no svg here", "still nothing", "<svg></svg>"]); // 3rd is degenerate
    const worker = new SvgWorker(llm);
    const res = await worker.resolve(spec);
    check("worker: all-junk -> DROP (none)", res.medium === "none", `medium=${res.medium}`);
    check("worker: exhausted all 3 attempts before drop", llm.attempt === 3, `attempts=${llm.attempt}`);
    if (res.medium === "none") check("worker: drop reason is retries-exhausted", res.reason === "svg_unrenderable_after_retries");
  }

  // (c) A model that emits an UNSAFE svg (script) that sanitizes to junk -> drop.
  {
    const malicious = `<svg xmlns="http://www.w3.org/2000/svg"><script>evil()</script></svg>`;
    const llm = new ScriptedLLM([malicious, malicious, malicious]);
    const worker = new SvgWorker(llm);
    const res = await worker.resolve(spec);
    check("worker: unsafe-only svg sanitizes to junk -> DROP", res.medium === "none", `medium=${res.medium}`);
  }
}

// ---------------------------------------------------------------------------
// §11.4 — Renderer block-walk invariant (asserted structurally on assemble's output).
// ---------------------------------------------------------------------------
async function testRendererInvariant() {
  console.log("\n== §11.4 Renderer block-walk / reveal invariant ==");
  // The renderer (LessonDocView) renders a visual block ONLY when
  // status === "ready" && payload present, and walks blocks in array order. The
  // orchestrator's assemble guarantees the persisted doc the renderer sees carries
  // NO pending/dropped/payload-less visual block. Assert that guarantee on a doc
  // built from a mix of ok/none/throw so a real "dropped slot renders nothing".
  const svg = new ScriptedWorker(() => "ok");
  const image = new ScriptedWorker(() => "none"); // dropped
  const video = new ScriptedWorker(() => "ok");
  const doc = await runLessonPipeline(INPUT, { author: new MockAuthor(makeDraft()), workers: workersFrom(svg, image, video) });

  const allBlocks = doc.sections.flatMap((s) => s.blocks);
  // Invariant the renderer relies on:
  check("invariant: no visual block is 'pending' in persisted doc", !allBlocks.some((b) => isVisualBlock(b) && b.status === "pending"));
  check("invariant: no visual block is 'dropped' in persisted doc", !allBlocks.some((b) => isVisualBlock(b) && b.status === "dropped"));
  check("invariant: every surviving visual has status 'ready' + a payload (renderable)", allBlocks.filter(isVisualBlock).every((b) => b.status === "ready" && !!b.payload));
  // The dropped image slot renders nothing AND leaves no dangling ref: its id is gone.
  check("invariant: dropped slot omitted entirely (no dangling ref)", !allBlocks.some((b) => b.id === "v-img"));

  // Order is preserved exactly: prose p0, svg v-svg, prose p1, [v-img dropped], then
  // section B [v-vid, p2]. So the rendered sequence is the array order with the drop
  // simply absent.
  const idsA = doc.sections[0].blocks.map((b) => b.id);
  check("invariant: section A renders in order with drop absent", JSON.stringify(idsA) === JSON.stringify(["p0", "v-svg", "p1"]), JSON.stringify(idsA));
  const idsB = doc.sections[1].blocks.map((b) => b.id);
  check("invariant: section B renders in order", JSON.stringify(idsB) === JSON.stringify(["v-vid", "p2"]), JSON.stringify(idsB));

  // Mixed prose+each-visual-kind render in order on the happy path (all media kinds present).
  const docAll = await runLessonPipeline(INPUT, {
    author: new MockAuthor(makeDraft()),
    workers: workersFrom(new ScriptedWorker(() => "ok"), new ScriptedWorker(() => "ok"), new ScriptedWorker(() => "ok")),
  });
  const media = docAll.sections.flatMap((s) => s.blocks).filter(isVisualBlock).map((b) => b.payload?.medium);
  check("invariant: each visual medium (svg,image,video) present in order", JSON.stringify(media) === JSON.stringify(["svg", "image", "video"]), JSON.stringify(media));
}

// ---------------------------------------------------------------------------
async function main() {
  await testOrchestrator();
  testAuthorContract();
  await testSvgWorker();
  await testRendererInvariant();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

main().catch((err) => {
  console.error("verify-pipeline crashed:", err);
  process.exit(1);
});
