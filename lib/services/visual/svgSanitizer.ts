/**
 * Dedicated SVG sanitization path (security boundary). Generated SVG is code,
 * not text: it can carry <script>, event-handler attributes, <foreignObject>
 * (arbitrary HTML), and external refs (href/url()/<use>) that fetch or
 * execute attacker content. The markdown sanitizer (components/Markdown.tsx)
 * must never see SVG — this is the separate, purpose-built path.
 *
 * Default-deny, allowlist only (elements, then attributes, then attribute
 * values), re-serialized from the allowlisted shape so malformed/smuggled
 * markup cannot survive. Pure, no DOM/React dependency — runs identically in
 * the verify script, server, and tests; does its own tokenization rather than
 * a browser DOMParser for determinism.
 */

// Allowlists — conservative on purpose (the set needed for explanatory
// line/box/arrow/label diagrams + simple charts). Extend deliberately, never
// by reflex: every addition widens the attack surface.

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
 * Explicitly denied (redundant given default-deny, but keeps intent auditable
 * and lets the verify script assert each is neutralized). <foreignObject>
 * embeds arbitrary HTML; <script> executes; <image>/<use>/<a> pull or
 * navigate to external content; <style> can smuggle CSS-driven script.
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
 * Curated allowlist of inline CSS properties permitted inside `style="..."`.
 * `style` is otherwise a smuggling vector: parsed property-by-property and
 * rebuilt from this list; anything with url(), expression(), or javascript:
 * is dropped.
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
 * Sanitize untrusted SVG markup on the dedicated path (default-deny +
 * allowlist). Re-serializes from the allowlisted token stream so
 * smuggled/malformed markup cannot survive: an unknown element's tags are
 * dropped (its allowlisted text children may remain as harmless inert text),
 * disallowed attributes and dangerous values are dropped. Non-empty output is
 * a single sanitized <svg>...</svg> tree safe to inline.
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
    emitText(cleaned.slice(lastIndex, m.index));
    lastIndex = tagRe.lastIndex;

    const tag = m[0];
    const isClose = tag.startsWith("</");
    const selfClose = /\/>\s*$/.test(tag);
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
  emitText(cleaned.slice(lastIndex));

  let svg = out.join("");

  // Final safety net: ensure no <script as a substring and no on*= survived the
  // re-serialization. If anything slipped through, fail closed (return empty).
  if (/<\s*script/i.test(svg) || /\son\w+\s*=/i.test(svg) || /<\s*foreignobject/i.test(svg)) {
    return { svg: "", ok: false, removed: [...removed, "FAILSAFE_TRIGGERED"] };
  }

  const ok = /<svg[\s>]/i.test(svg) && /<\/svg>/i.test(svg);
  if (!ok) svg = "";

  return { svg, ok, removed };
}
