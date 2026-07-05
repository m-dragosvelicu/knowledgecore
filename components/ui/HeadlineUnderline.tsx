"use client";

// KnowledgeCore — HeadlineUnderline (Slice 1, wrapped-line fix).
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
// The fix: an invisible zero-size marker renders as the headline's own last
// child, right after its text, so it lands on the true final line. A layout
// effect measures the marker's offset from the wrapper's left edge and hands
// that pixel width down to HandUnderline. On a one-line headline this
// measured width equals the CSS fit-content width, so the single-line look is
// byte-for-byte unchanged; this is a client component only for that
// measurement (Eyebrow/SectionLabel stay server-safe in ./Type).

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

  useLayoutEffect(() => {
    const wrap = wrapRef.current;
    const marker = endMarkerRef.current;
    if (!wrap || !marker) return;

    const measure = () => {
      const width = Math.round(
        marker.getBoundingClientRect().left - wrap.getBoundingClientRect().left,
      );
      if (width > 0) setLineWidth(width);
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
      <HandUnderline
        play={play}
        strokeWidth={strokeWidth}
        delay={delay}
        width={lineWidth != null ? `${lineWidth}px` : "100%"}
      />
    </span>
  );
}
