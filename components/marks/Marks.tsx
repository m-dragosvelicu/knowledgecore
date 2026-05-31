// KnowledgeCore — signature hand-drawn marks (Slice 1).
//
// Ported from design-system/ui_kits/web-app/Marks.jsx. These are bespoke SVG
// illustrations (NOT a reusable icon system): the thin arrow that lives inside
// solid buttons, the self-drawing headline underline, the roughened score
// ellipse, and the featured-card corner squiggle.
//
// The underline / squiggle reference the shared #rough filter and the .kc-draw
// keyframes mounted in Slice 0 (components/Backdrop.tsx + app/globals.css), so
// they inherit the one inky-edge "hand" the whole product shares. Reduced
// motion is handled by .kc-draw (it resolves to the finished stroke).
//
// These are server-safe (pure markup, no hooks/handlers).

import type { CSSProperties } from "react";

const TEAL = "#1F6E67";

/* ---------------------------------------------------------------------------
 * Arrow — the only true "icon" in the system. A thin stroke that slides right
 * inside solid commit buttons. stroke-width 1.8, round caps, currentColor so it
 * takes the button's label color.
 * ------------------------------------------------------------------------- */
export function Arrow({ size = 16 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M3 8h9M8 4l4 4-4 4"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/* ---------------------------------------------------------------------------
 * HandUnderline — the signature wobbly underline that draws itself in beneath a
 * headline. Designed to be absolutely positioned under inline text (see the
 * HeadlineUnderline wrapper). `play` toggles the draw-on; turn it off to render
 * the finished stroke immediately (e.g. for a re-render that should not redraw).
 * ------------------------------------------------------------------------- */
export function HandUnderline({
  play = true,
  strokeWidth = 2.4,
  color = TEAL,
  delay,
}: {
  play?: boolean;
  strokeWidth?: number;
  color?: string;
  delay?: string;
}) {
  return (
    <svg
      className="kc-uline"
      viewBox="0 0 360 16"
      preserveAspectRatio="none"
      aria-hidden="true"
      focusable="false"
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        bottom: -7,
        width: "100%",
        height: 14,
        overflow: "visible",
        pointerEvents: "none",
      }}
    >
      <path
        className={play ? "kc-draw" : ""}
        pathLength={1}
        d="M3 9 C 90 3, 180 3, 250 8 S 340 14, 357 6"
        fill="none"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        style={delay ? { animationDelay: delay } : undefined}
      />
    </svg>
  );
}

/* ---------------------------------------------------------------------------
 * ScoreBadge — a roughened ellipse (NOT a perfect circle) wrapping a Fraunces
 * figure and an uppercase sublabel. The ellipse path is run through the shared
 * #rough displacement filter for the inky edge.
 * ------------------------------------------------------------------------- */
export function ScoreBadge({
  big,
  sub,
  color = TEAL,
}: {
  big: React.ReactNode;
  sub?: React.ReactNode;
  color?: string;
}) {
  return (
    <div
      className="kc-rs"
      style={{
        position: "relative",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: 84,
        height: 58,
      }}
    >
      <svg
        width="84"
        height="58"
        viewBox="0 0 84 58"
        aria-hidden="true"
        focusable="false"
        style={{ position: "absolute", inset: 0, filter: "url(#rough)" }}
      >
        <path
          d="M12 29 C 12 13, 40 10, 53 11 C 73 13, 74 26, 71 34 C 67 50, 40 52, 25 49 C 12 46, 11 39, 14 29"
          fill="none"
          stroke={color}
          strokeWidth="2"
          strokeLinecap="round"
        />
      </svg>
      <div style={{ position: "relative", textAlign: "center", lineHeight: 1 }}>
        <div
          style={{
            fontFamily: "var(--font-display)",
            fontVariationSettings: "var(--soft-ui)",
            fontSize: 24,
            fontWeight: 500,
            color: "var(--ink)",
          }}
        >
          {big}
        </div>
        {sub != null && (
          <div
            style={{
              fontSize: 9.5,
              letterSpacing: ".08em",
              textTransform: "uppercase",
              color: "var(--ink-3)",
              marginTop: 2,
            }}
          >
            {sub}
          </div>
        )}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------------
 * CornerSquiggle — the small hand-drawn flourish that tucks into the corner of
 * the featured card. Run through #rough so it reads as the same hand.
 * ------------------------------------------------------------------------- */
export function CornerSquiggle({
  color = TEAL,
  style,
}: {
  color?: string;
  style?: CSSProperties;
}) {
  return (
    <svg
      width="46"
      height="46"
      viewBox="0 0 46 46"
      aria-hidden="true"
      focusable="false"
      style={{ filter: "url(#rough)", pointerEvents: "none", ...style }}
    >
      <path
        d="M6 40 C 16 30, 14 18, 24 14 M24 14 C 30 12, 36 16, 38 10 M16 38 C 26 34, 30 24, 40 22"
        fill="none"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
        opacity="0.7"
      />
    </svg>
  );
}
