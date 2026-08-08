/**
 * QA — Slice 5: verify-no-ascii (redesign §11, the headline scale test).
 *
 * Runs N ASCII-trap concepts (BST, flowchart, bar chart, sort, org chart,
 * graph) through the real Phase-1 Author and asserts zero ASCII-art code
 * fences in any prose block. Requires GOOGLE_GENAI_API_KEY, fails fast if
 * absent.
 *
 * Run: `bun run scripts/verify-no-ascii.ts`. Exits non-zero on any ASCII-art
 * finding or Author error.
 */

import { getLessonOrchestratorPorts } from "../lib/services";
import { isProseBlock, isVisualBlock } from "../lib/services/lessonDoc";
import type { DraftLessonDoc } from "../lib/services/lessonDoc";
import type { LessonContentInput } from "../lib/services/lessonContent";

// ---------------------------------------------------------------------------
// The N ASCII-trap concepts. Each is a self-contained goalpost context.
// ---------------------------------------------------------------------------
type Concept = { key: string; subject: string; scope: string; title: string; objective: string; exp: string };

const CONCEPTS: Concept[] = [
  {
    key: "bst",
    subject: "Data structures",
    scope: "Binary search trees",
    title: "How a binary search tree organizes data",
    objective: "Explain the ordering invariant of a BST and how lookup descends the tree.",
    exp: "Insert the values 8, 3, 10, 1, 6, 14 into an empty BST and describe the resulting structure.",
  },
  {
    key: "flowchart",
    subject: "Software process",
    scope: "Control flow",
    title: "Reading a decision flowchart",
    objective: "Explain how a process branches at decision points from start to end.",
    exp: "Trace a login flow: check credentials, branch on success/failure, end states.",
  },
  {
    key: "barchart",
    subject: "Data literacy",
    scope: "Quantitative comparison",
    title: "Comparing quantities with a bar chart",
    objective: "Explain how a bar chart encodes magnitude and supports comparison.",
    exp: "Given monthly sales (Jan 40, Feb 55, Mar 30, Apr 70), describe what a bar chart would show.",
  },
  {
    key: "sorting",
    subject: "Algorithms",
    scope: "Sorting",
    title: "How bubble sort orders a list",
    objective: "Explain the compare-and-swap passes of bubble sort and why it terminates.",
    exp: "Sort the list [5, 1, 4, 2, 8] with bubble sort and give the value sequence after each pass.",
  },
  {
    key: "org",
    subject: "Organizational design",
    scope: "Hierarchy",
    title: "How an org chart shows reporting lines",
    objective: "Explain how a hierarchy encodes authority and reporting relationships.",
    exp: "Describe a company with a CEO, two VPs, and three engineers under one VP.",
  },
  {
    key: "graph",
    subject: "Networks",
    scope: "Graphs",
    title: "Nodes and edges in a small network",
    objective: "Explain how a graph represents entities and the connections between them.",
    exp: "Describe a 4-node friendship network where A knows B and C, and B knows D.",
  },
];

function inputFor(c: Concept): LessonContentInput {
  return {
    conceptKey: c.key,
    subject: { canonicalName: c.subject, scopeNote: c.scope },
    goalpost: { order: 1, title: c.title, objective: c.objective },
    experiencePrompt: c.exp,
    endAchievement: c.objective,
    assessment: [],
    profile: null,
  };
}

// ASCII-art detection: scan fenced code blocks in every prose block. A fence
// counts as ASCII art when it's a drawn shape (dense box-drawing/connector
// glyphs) rather than prose, real code, or a literal value sequence — mirrors
// what a human reviewer would call "ASCII art".
const FENCE_RE = /```[^\n]*\n([\s\S]*?)```/g;

/** Unicode box-drawing / arrow glyphs that are unambiguous diagram characters. */
const BOX_GLYPHS = /[─-╿←-⇿■-◿]/g;

function isAsciiArtFence(body: string): { art: boolean; reason: string } {
  const text = body.replace(/\s+$/g, "");
  if (!text.trim()) return { art: false, reason: "empty" };

  // 1) Any Unicode box-drawing / arrow glyph -> drawn figure.
  const box = text.match(BOX_GLYPHS);
  if (box && box.length >= 2) return { art: true, reason: `box-drawing glyphs x${box.length}` };

  const lines = text.split("\n").filter((l) => l.length > 0);
  if (lines.length === 0) return { art: false, reason: "empty" };

  // 2) Real-code signal: if the fence looks like code (assignments, keywords,
  //    function calls, semicolons), do NOT flag it.
  const codeSignal = /(=>|;|\b(function|return|const|let|var|def|class|import|for|while|if|print|console)\b|[a-zA-Z_]\w*\s*\()/;
  const codeLines = lines.filter((l) => codeSignal.test(l)).length;
  const looksLikeCode = codeLines / lines.length > 0.4;

  // 3) Connector-density: count lines that are predominantly drawing connectors
  //    (/, \, |, _, +, -, between letters/numbers) — the slash/pipe trees, the
  //    +----+ boxes, the pipe-arrow flowcharts. Require multiple such lines so a
  //    single "a -> b" arrow in prose-ish text is not over-flagged.
  const connectorLine = (l: string) => {
    const connectors = (l.match(/[\/\\|_+]/g) || []).length;
    const dashes = (l.match(/-/g) || []).length;
    const nonSpace = l.replace(/\s/g, "").length || 1;
    // A drawn line: connectors (or a long dash run forming a box edge) dominate.
    return connectors >= 2 || (dashes >= 4 && dashes / nonSpace > 0.6) || (connectors + dashes) / nonSpace > 0.5;
  };
  const drawn = lines.filter(connectorLine).length;
  if (!looksLikeCode && drawn >= 2) return { art: true, reason: `${drawn}/${lines.length} drawn connector lines` };

  return { art: false, reason: "prose/code/literal" };
}

type Finding = { concept: string; reason: string; snippet: string };

async function authorOne(c: Concept): Promise<{ draft: DraftLessonDoc; prose: number; visuals: number; findings: Finding[] }> {
  const ports = getLessonOrchestratorPorts();
  const draft = await ports.author.author(inputFor(c));
  let prose = 0;
  let visuals = 0;
  const findings: Finding[] = [];
  for (const section of draft.sections) {
    for (const block of section.blocks) {
      if (isVisualBlock(block)) {
        visuals++;
        continue;
      }
      if (!isProseBlock(block)) continue;
      prose++;
      let m: RegExpExecArray | null;
      FENCE_RE.lastIndex = 0;
      while ((m = FENCE_RE.exec(block.md)) !== null) {
        const verdict = isAsciiArtFence(m[1]);
        if (verdict.art) {
          findings.push({ concept: c.key, reason: verdict.reason, snippet: m[1].slice(0, 200) });
        }
      }
    }
  }
  return { draft, prose, visuals, findings };
}

async function main() {
  if (!process.env.GOOGLE_GENAI_API_KEY) {
    throw new Error(
      "GOOGLE_GENAI_API_KEY is not set; the empirical no-ASCII N-run requires the live Gemini Author.",
    );
  }
  console.log("verify-no-ascii — live empirical N-run (real Gemini Author)");
  console.log(`Concepts (N=${CONCEPTS.length}): ${CONCEPTS.map((c) => c.key).join(", ")}\n`);

  // Self-test the detector so a green run is trustworthy: a known ASCII tree MUST
  // trip it, and a real code fence + a literal value sequence MUST NOT.
  const treeArt = "      8\n     / \\\n    3   10\n   / \\    \\\n  1   6    14";
  const realCode = "function lookup(node, x) {\n  if (x < node.val) return lookup(node.left, x);\n  return node;\n}";
  const literalSeq = "5 1 4 2 8\n1 4 2 5 8\n1 2 4 5 8";
  let detOk = true;
  if (!isAsciiArtFence(treeArt).art) { detOk = false; console.log("FAIL | detector self-test: ASCII tree not detected"); }
  else console.log(`PASS | detector self-test: ASCII tree detected (${isAsciiArtFence(treeArt).reason})`);
  if (isAsciiArtFence(realCode).art) { detOk = false; console.log("FAIL | detector self-test: real code false-positive"); }
  else console.log("PASS | detector self-test: real code NOT flagged");
  if (isAsciiArtFence(literalSeq).art) { detOk = false; console.log("FAIL | detector self-test: literal value sequence false-positive"); }
  else console.log("PASS | detector self-test: literal value sequence NOT flagged");
  console.log("");

  let totalProse = 0;
  let totalVisuals = 0;
  const allFindings: Finding[] = [];
  let authorErrors = 0;

  for (const c of CONCEPTS) {
    try {
      const r = await authorOne(c);
      totalProse += r.prose;
      totalVisuals += r.visuals;
      allFindings.push(...r.findings);
      const verdict = r.findings.length === 0 ? "clean" : `ASCII-ART x${r.findings.length}`;
      console.log(
        `${r.findings.length === 0 ? "PASS" : "FAIL"} | ${c.key.padEnd(10)} | sections=${r.draft.sections.length} prose=${r.prose} visuals=${r.visuals} | ${verdict}`,
      );
    } catch (err) {
      authorErrors++;
      console.log(`ERROR | ${c.key.padEnd(10)} | Author threw: ${(err as Error).message}`);
    }
  }

  console.log("\n--- summary ---");
  console.log(`lessons authored : ${CONCEPTS.length - authorErrors}/${CONCEPTS.length}`);
  console.log(`prose blocks      : ${totalProse}`);
  console.log(`visual specs      : ${totalVisuals}`);
  console.log(`ASCII-art fences  : ${allFindings.length}`);

  if (allFindings.length > 0) {
    console.log("\nFINDINGS:");
    for (const f of allFindings) {
      console.log(`  [${f.concept}] ${f.reason}\n    ${f.snippet.replace(/\n/g, "\n    ")}`);
    }
  }

  const failed = !detOk || allFindings.length > 0 || authorErrors > 0;
  console.log(`\n${failed ? "RESULT: FAIL" : "RESULT: PASS"} (live empirical)`);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error("verify-no-ascii crashed:", err);
  process.exit(1);
});
