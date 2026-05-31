/**
 * L1 Slice 4 — the DEDICATED SVG sanitization path (SECURITY BOUNDARY).
 *
 * WHY THIS EXISTS
 * ---------------
 * A generated SVG is CODE, not text. SVG can carry <script>, event-handler
 * attributes (onload, onclick, ...), <foreignObject> (which embeds arbitrary
 * HTML), and external references (href/xlink:href, url(...), <use> to remote
 * documents) that fetch or execute attacker-controlled content. The lesson-text
 * markdown sanitizer (components/Markdown.tsx) is tuned for prose + LaTeX + code
 * fences; it is the WRONG tool for SVG and must NEVER see SVG. This is that
 * separate, purpose-built path.
 *
 * DESIGN: DEFAULT-DENY, ALLOWLIST.
 *   - Only an explicit allowlist of SVG drawing elements survives. Anything not
 *     on the list (script, foreignObject, image, use, a, iframe, style, ...) is
 *     dropped entirely.
 *   - Only an explicit allowlist of presentational attributes survives. Every
 *     event handler (on*) and every external/script-bearing attribute is dropped.
 *   - Any attribute VALUE containing a dangerous scheme (javascript:, data: that
 *     is not an inline image we explicitly forbid anyway, etc.) is dropped.
 *   - The result is re-serialized from the allowlisted shape, so even malformed
 *     or smuggled markup cannot survive — only what the allowlist re-emits does.
 *
 * This module is PURE and has NO React / DOM-runtime dependency, so it runs in
 * the verify script, on the server, and in tests identically. It does its own
 * lightweight tokenization rather than relying on a browser DOMParser so it is
 * deterministic and server-safe.
 */

// ---------------------------------------------------------------------------
// Allowlists. Conservative on purpose: this is the set needed for explanatory
// line/box/arrow/label diagrams + simple charts. Add to it deliberately, never
// by reflex — every addition widens the attack surface.
// ---------------------------------------------------------------------------

/** SVG elements that are SAFE to render (drawing + grouping + text + defs). */
const ALLOWED_ELEMENTS = new Set<string>([
  "svg",
  "g",
  "defs",
  "title",
  "desc",
  "path",
  "rect",
  "circle",
  "ellipse",
  "line",
  "polyline",
  "polygon",
  "text",
  "tspan",
  "marker",
  "linearGradient",
  "radialGradient",
  "stop",
  "clipPath",
  "symbol", // referenced only via allowlisted, in-document means; <use> is DENIED
]);

/**
 * EXPLICITLY DENIED elements. Not strictly necessary given default-deny, but
 * listed so the intent is auditable and so the verify script can assert each is
 * neutralized. <foreignObject> embeds arbitrary HTML; <script> executes; <image>
 * / <use> / <a> can pull or navigate to external content; <style> can smuggle
 * CSS-driven script in some engines.
 */
export const DENIED_ELEMENTS = new Set<string>([
  "script",
  "foreignObject",
  "foreignobject",
  "image",
  "use",
  "a",
  "iframe",
  "style",
  "animate",
  "animatetransform",
  "animatemotion",
  "set",
  "handler",
]);

/** Presentational attributes that are SAFE on the allowed elements. */
const ALLOWED_ATTRS = new Set<string>([
  // geometry
  "x",
  "y",
  "x1",
  "y1",
  "x2",
  "y2",
  "cx",
  "cy",
  "r",
  "rx",
  "ry",
  "width",
  "height",
  "d",
  "points",
  "dx",
  "dy",
  "transform",
  "viewbox",
  "preserveaspectratio",
  "offset",
  // presentation
  "fill",
  "fill-opacity",
  "fill-rule",
  "stroke",
  "stroke-width",
  "stroke-opacity",
  "stroke-linecap",
  "stroke-linejoin",
  "stroke-dasharray",
  "stroke-dashoffset",
  "opacity",
  "color",
  "stop-color",
  "stop-opacity",
  "gradientunits",
  "gradienttransform",
  "spreadmethod",
  "clip-path",
  "clip-rule",
  "marker-end",
  "marker-start",
  "marker-mid",
  "orient",
  "refx",
  "refy",
  "markerwidth",
  "markerheight",
  "markerunits",
  // text
  "text-anchor",
  "dominant-baseline",
  "alignment-baseline",
  "font-size",
  "font-family",
  "font-weight",
  "font-style",
  "letter-spacing",
  "xml:space",
  // identity (in-document only; values are sanitized below)
  "id",
  "class",
  "version",
  "xmlns",
]);

/**
 * A curated, SAFE subset of inline CSS properties allowed inside a `style="..."`
 * attribute. `style` is otherwise a common smuggling vector, so it is parsed
 * property-by-property and rebuilt from this allowlist; anything with a url(),
 * expression(), or javascript: is dropped.
 */
const ALLOWED_STYLE_PROPS = new Set<string>([
  "fill",
  "stroke",
  "stroke-width",
  "opacity",
  "fill-opacity",
  "stroke-opacity",
  "color",
  "font-size",
  "font-family",
  "font-weight",
  "font-style",
  "text-anchor",
]);

/** Schemes / tokens that must never appear in any surviving attribute value. */
const DANGEROUS_VALUE = /(javascript:|vbscript:|data:text\/html|expression\(|url\s*\()/i;

/** Strip C-style and HTML comments, CDATA, and processing instructions. */
function stripCommentsAndPis(input: string): string {
  return input
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, "")
    .replace(/<\?[\s\S]*?\?>/g, "")
    .replace(/<!DOCTYPE[^>]*>/gi, "");
}

type Attr = { name: string; value: string };

/** Parse an attribute list from a start tag's inner text (best-effort, safe). */
function parseAttrs(raw: string): Attr[] {
  const attrs: Attr[] = [];
  // name = "value" | name = 'value' | name (boolean)
  const re = /([a-zA-Z_:][\w:.-]*)\s*(?:=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw)) !== null) {
    if (!m[1]) continue;
    const name = m[1];
    const value = m[3] ?? m[4] ?? m[5] ?? "";
    attrs.push({ name, value });
  }
  return attrs;
}

/** Sanitize a single style attribute down to the property allowlist. */
function sanitizeStyle(value: string): string | null {
  const out: string[] = [];
  for (const decl of value.split(";")) {
    const idx = decl.indexOf(":");
    if (idx === -1) continue;
    const prop = decl.slice(0, idx).trim().toLowerCase();
    const val = decl.slice(idx + 1).trim();
    if (!ALLOWED_STYLE_PROPS.has(prop)) continue;
    if (DANGEROUS_VALUE.test(val)) continue;
    out.push(`${prop}:${val}`);
  }
  return out.length ? out.join(";") : null;
}

/** Decide whether an attribute survives, and with what (sanitized) value. */
function sanitizeAttr(attr: Attr): Attr | null {
  const lname = attr.name.toLowerCase();

  // 1) Event handlers — DENY ALL. on*, plus the legacy xlink event-ish ones.
  if (lname.startsWith("on")) return null;

  // 2) External-reference / navigation attributes — DENY. These are how an SVG
  //    pulls remote content even on otherwise-allowed elements.
  if (
    lname === "href" ||
    lname === "xlink:href" ||
    lname === "src" ||
    lname === "xlink:role" ||
    lname === "xlink:arcrole" ||
    lname === "xlink:actuate" ||
    lname === "xlink:show" ||
    lname === "from" ||
    lname === "to" ||
    lname === "values" ||
    lname === "begin" ||
    lname === "attributename"
  ) {
    return null;
  }

  // 3) style — rebuild from the property allowlist.
  if (lname === "style") {
    const safe = sanitizeStyle(attr.value);
    return safe ? { name: "style", value: safe } : null;
  }

  // 4) default-deny: not on the allowlist -> drop.
  if (!ALLOWED_ATTRS.has(lname)) return null;

  // 5) any surviving value carrying a dangerous scheme -> drop the attribute.
  if (DANGEROUS_VALUE.test(attr.value)) return null;

  return { name: lname, value: attr.value };
}

/** Escape an attribute value for safe re-serialization in a double-quoted attr. */
function escAttr(v: string): string {
  return v
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** Escape text content. */
function escText(v: string): string {
  return v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export type SvgSanitizeResult = {
  /** The safe, re-serialized SVG, or "" if nothing survived (default-deny). */
  svg: string;
  /** True if the input was reduced to a usable <svg> root. */
  ok: boolean;
  /** Audit trail: element/attribute names that were stripped. */
  removed: string[];
};

/**
 * Sanitize untrusted SVG markup on the DEDICATED path. Default-deny + allowlist.
 *
 * Re-serializes from the allowlisted token stream so smuggled/malformed markup
 * cannot survive: an unknown element's TAGS are dropped (its allowlisted text
 * children may remain as inert text, which is harmless), every disallowed
 * attribute is dropped, and dangerous values are dropped. The output, if
 * non-empty, is a single sanitized <svg>...</svg> tree safe to inline.
 */
export function sanitizeSvg(input: string): SvgSanitizeResult {
  const removed: string[] = [];
  if (!input || typeof input !== "string") {
    return { svg: "", ok: false, removed };
  }

  const cleaned = stripCommentsAndPis(input);

  // Track depth of DENIED elements so we drop their entire subtree (e.g. the
  // HTML inside a <foreignObject>, the JS inside a <script>).
  let deniedDepth = 0;
  const out: string[] = [];

  // Tokenize into tags and text. The regex never executes anything; it only
  // splits the string.
  const tagRe = /<\/?[a-zA-Z][^>]*?\/?>/g;
  let lastIndex = 0;
  let m: RegExpExecArray | null;

  const emitText = (text: string) => {
    if (deniedDepth > 0) return; // inside a denied subtree -> drop everything
    if (text.length === 0) return;
    out.push(escText(text));
  };

  while ((m = tagRe.exec(cleaned)) !== null) {
    // text before this tag
    emitText(cleaned.slice(lastIndex, m.index));
    lastIndex = tagRe.lastIndex;

    const tag = m[0];
    const isClose = tag.startsWith("</");
    const selfClose = /\/>\s*$/.test(tag);
    // element name
    const nameMatch = /^<\/?\s*([a-zA-Z][\w:.-]*)/.exec(tag);
    const rawName = nameMatch ? nameMatch[1] : "";
    const lname = rawName.toLowerCase();

    // DENIED element handling: open increments depth, close decrements; nothing
    // inside is emitted.
    if (DENIED_ELEMENTS.has(lname)) {
      if (!removed.includes(lname)) removed.push(lname);
      if (isClose) {
        if (deniedDepth > 0) deniedDepth--;
      } else if (!selfClose) {
        deniedDepth++;
      }
      continue;
    }

    if (deniedDepth > 0) {
      // We are inside a denied subtree: drop this tag too (even if allowlisted).
      continue;
    }

    if (!ALLOWED_ELEMENTS.has(lname)) {
      // Unknown / not-allowlisted element: drop the TAG (default-deny). Its text
      // children, if any, are emitted as inert escaped text by the loop.
      if (!removed.includes(lname)) removed.push(lname);
      continue;
    }

    if (isClose) {
      out.push(`</${lname}>`);
      continue;
    }

    // Open (or self-closing) allowlisted element: sanitize its attributes.
    const inner = tag
      .replace(/^<\s*[a-zA-Z][\w:.-]*/, "")
      .replace(/\/?>\s*$/, "");
    const attrs = parseAttrs(inner);
    const safeAttrs: string[] = [];
    for (const a of attrs) {
      const s = sanitizeAttr(a);
      if (s) {
        safeAttrs.push(`${s.name}="${escAttr(s.value)}"`);
      } else if (!removed.includes(`@${a.name.toLowerCase()}`)) {
        removed.push(`@${a.name.toLowerCase()}`);
      }
    }
    const attrStr = safeAttrs.length ? " " + safeAttrs.join(" ") : "";
    out.push(selfClose ? `<${lname}${attrStr}/>` : `<${lname}${attrStr}>`);
  }
  // trailing text
  emitText(cleaned.slice(lastIndex));

  let svg = out.join("");

  // Final safety net: ensure no <script as a substring and no on*= survived the
  // re-serialization. If anything slipped through, fail closed (return empty).
  if (/<\s*script/i.test(svg) || /\son\w+\s*=/i.test(svg) || /<\s*foreignobject/i.test(svg)) {
    return { svg: "", ok: false, removed: [...removed, "FAILSAFE_TRIGGERED"] };
  }

  // The result is only usable if it actually contains an <svg> root.
  const ok = /<svg[\s>]/i.test(svg) && /<\/svg>/i.test(svg);
  if (!ok) svg = "";

  return { svg, ok, removed };
}
