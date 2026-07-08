"use client";

// KnowledgeCore — HeadlineUnderline (Slice 1, wrapped-line fix, variant B).
//
// Wraps an inline headline and draws the signature wobbly HandUnderline mark
// beneath it. Use around a span/heading whose width should define the
// underline.
//
//   <HeadlineUnderline>
//     <Typography variant="h3" component="span">The ideas behind Art Nouveau</Typography>
//   </HeadlineUnderline>
//
// Sizing: the wrapper shrink-wraps to the rendered TEXT width via
// `width: fit-content` (with `maxWidth: 100%` so it still wraps inside narrow
// columns). That is enough while the headline stays on one line, but CSS has
// no notion of "the width of the longest RENDERED line" once a fit-content box
// is forced to wrap: it resolves to the full available width instead, so a
// two-line headline drew the mark at container width under the short final
// line, floating past the actual text.
//
// Variant B: every rendered line gets its own swoosh, each hugging that
// line's text. Line geometry comes from Range.getClientRects() over the
// headline's text nodes (one rect per line fragment, grouped by vertical
// band). The FINAL line keeps the variant A mechanism — an invisible
// zero-size marker as the headline's last child, measured against the
// wrapper — so a one-line headline renders exactly the variant A markup
// (one swoosh, same width source, same delay semantics). Earlier lines are
// extra HandUnderlines in zero-height positioned spans, vertically calibrated
// so each sits at the same offset below its line as the final swoosh sits
// below the wrapper. Draw-on stays alive on every line; lines stagger
// top-to-bottom by 120ms each (animationDelay accepts calc(), so a
// caller-supplied base delay composes with the stagger).

import {
  cloneElement,
  isValidElement,
  useLayoutEffect,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";
import { HandUnderline } from "@/components/marks/Marks";

type LineBand = { left: number; right: number; top: number; bottom: number };
type ExtraLine = { left: number; top: number; width: number };

const STAGGER_MS = 120;

// One rect per rendered line fragment of every text node under `root`,
// merged into per-line bands (nested inline elements yield several fragments
// on the same line; group by vertical-center containment).
function collectLineBands(root: HTMLElement): LineBand[] {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const rects: DOMRect[] = [];
  let node: Node | null;
  while ((node = walker.nextNode())) {
    if (!node.textContent || !node.textContent.trim()) continue;
    const range = document.createRange();
    range.selectNodeContents(node);
    for (const rect of range.getClientRects()) {
      if (rect.width > 1) rects.push(rect);
    }
  }
  rects.sort((a, b) => a.top - b.top);

  const bands: LineBand[] = [];
  for (const rect of rects) {
    const band = bands[bands.length - 1];
    const centre = (rect.top + rect.bottom) / 2;
    if (band && centre > band.top && centre < band.bottom) {
      band.left = Math.min(band.left, rect.left);
      band.right = Math.max(band.right, rect.right);
      band.top = Math.min(band.top, rect.top);
      band.bottom = Math.max(band.bottom, rect.bottom);
    } else {
      bands.push({
        left: rect.left,
        right: rect.right,
        top: rect.top,
        bottom: rect.bottom,
      });
    }
  }
  return bands;
}

export function HeadlineUnderline({
  children,
  play = true,
  strokeWidth = 2.4,
  delay,
}: {
  children: ReactNode;
  play?: boolean;
  strokeWidth?: number;
  delay?: string;
}) {
  const wrapRef = useRef<HTMLSpanElement>(null);
  const endMarkerRef = useRef<HTMLSpanElement>(null);
  const [lineWidth, setLineWidth] = useState<number | null>(null);
  const [extraLines, setExtraLines] = useState<ExtraLine[]>([]);

  useLayoutEffect(() => {
    const wrap = wrapRef.current;
    const marker = endMarkerRef.current;
    if (!wrap || !marker) return;

    const measure = () => {
      const wrapRect = wrap.getBoundingClientRect();
      const width = Math.round(marker.getBoundingClientRect().left - wrapRect.left);
      if (width > 0) setLineWidth(width);

      const bands = collectLineBands(wrap);
      if (bands.length < 2) {
        setExtraLines((prev) => (prev.length ? [] : prev));
        return;
      }
      // The final swoosh is centred on the wrapper's bottom edge (bottom:-7,
      // height 14). Offset every earlier line by the same distance below its
      // own text bottom so all swooshes sit at a consistent depth.
      const calibration = wrapRect.bottom - bands[bands.length - 1].bottom;
      setExtraLines(
        bands.slice(0, -1).map((band) => ({
          left: Math.round(band.left - wrapRect.left),
          top: Math.round(band.bottom - wrapRect.top + calibration),
          width: Math.round(band.right - band.left),
        })),
      );
    };

    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(wrap);
    // Fraunces is a variable display font; a late swap can nudge line breaks.
    document.fonts?.ready?.then(measure).catch(() => {});
    return () => ro.disconnect();
  }, [children]);

  const endMarker = (
    <span
      key="kc-uline-end"
      ref={endMarkerRef}
      aria-hidden="true"
      style={{ display: "inline-block", width: 0, height: 0 }}
    />
  );

  // Inject the end marker as the headline's own trailing child (not a sibling
  // after it) so it renders on the same line as the headline's last word,
  // even when the headline itself is a block element (e.g. an <h1>).
  const headline = isValidElement(children)
    ? cloneElement(children as ReactElement<{ children?: ReactNode }>, {
        children: (
          <>
            {(children as ReactElement<{ children?: ReactNode }>).props.children}
            {endMarker}
          </>
        ),
      })
    : (
        <>
          {children}
          {endMarker}
        </>
      );

  // Stagger the draw-on top-to-bottom; a single line keeps the caller's delay
  // untouched (variant A parity).
  const delayFor = (index: number) => {
    const extra = index * STAGGER_MS;
    if (delay) return extra ? `calc(${delay} + ${extra}ms)` : delay;
    return extra ? `${extra}ms` : undefined;
  };

  return (
    <span
      ref={wrapRef}
      style={{
        position: "relative",
        display: "inline-block",
        width: "fit-content",
        maxWidth: "100%",
        margin: "0 0 2px",
      }}
    >
      {headline}
      {extraLines.map((line, i) => (
        <span
          key={`${line.top}-${line.left}`}
          aria-hidden="true"
          style={{
            position: "absolute",
            left: line.left,
            top: line.top,
            width: line.width,
            height: 0,
            pointerEvents: "none",
          }}
        >
          <HandUnderline play={play} strokeWidth={strokeWidth} delay={delayFor(i)} />
        </span>
      ))}
      <HandUnderline
        play={play}
        strokeWidth={strokeWidth}
        delay={delayFor(extraLines.length)}
        width={lineWidth != null ? `${lineWidth}px` : "100%"}
      />
    </span>
  );
}
