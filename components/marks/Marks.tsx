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
 *
 * The roughened ellipse is the SCORE mark: it should only wrap a genuine score
 * (e.g. a checkpoint evaluation result). For un-scored values — like a plain
 * goalpost PROGRESS count in the journey lists — pass `ring={false}` to render
 * the same Fraunces figure + uppercase sublabel WITHOUT the circle, so progress
 * is never mistaken for a score. `ring` defaults to true to keep the genuine
 * score call sites (trail, complete page, specimens) visually unchanged.
 * ------------------------------------------------------------------------- */
export function ScoreBadge({
  big,
  sub,
  color = TEAL,
  ring = true,
}: {
  big: React.ReactNode;
  sub?: React.ReactNode;
  color?: string;
  /** Wrap the figure in the roughened score ellipse. False = un-circled progress. */
  ring?: boolean;
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
      {ring && (
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
      )}
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
 * Trail marks (Slice 5) — the literal hand-drawn journey trail vocabulary,
 * ported from design-system/ui_kits/web-app/Marks.jsx Trail() + assets/marks.svg.
 * The PathTrail composes these per-node; each mark references the shared #rough
 * filter / #hatchT pattern mounted globally (components/Backdrop.tsx), so the
 * whole trail belongs to the same inky hand.
 *
 *   completed  -> hatched circle (fill url(#hatchT)) + teal check
 *   current    -> filled teal circle + a planted flag rising out of it
 *   locked     -> bone circle, muted silhouette stroke (a future goalpost)
 *
 * These are pure markup (server-safe). The node circles each sit inside a fixed
 * viewBox so a flag can rise above the marker column without clipping.
 * ------------------------------------------------------------------------- */

const MUTED = "#8C8B82"; // --ink-3 / silhouette family for future legs
const BONE = "#F8F6F1"; // --surface, the warm fill of an undrawn node

export type TrailNodeState = "completed" | "current" | "locked";

export function CheckpointNode({ state }: { state: TrailNodeState }) {
  // A 44x60 box: the circle sits low (cy 44) leaving headroom for the flag.
  return (
    <svg
      width={44}
      height={60}
      viewBox="0 0 44 60"
      aria-hidden="true"
      focusable="false"
      style={{ display: "block", overflow: "visible" }}
    >
      <g style={{ filter: "url(#rough)" }}>
        {state === "completed" && (
          <>
            <circle cx={22} cy={44} r={12} fill="url(#hatchT)" stroke={TEAL} strokeWidth={2} />
            <path
              d="M16 44.5l4 4L29 39"
              fill="none"
              stroke={TEAL}
              strokeWidth={2.4}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </>
        )}

        {state === "current" && (
          <>
            <circle cx={22} cy={44} r={13} fill={TEAL} stroke={TEAL} strokeWidth={2} />
            {/* the planted flag: a pole rising from the node with a fluttering pennant */}
            <path d="M22 32 L22 6" stroke={TEAL} strokeWidth={2} strokeLinecap="round" />
            <path
              d="M22 7 q 16 3 23 -2 q -8 9 0 14 q -14 -3 -23 0"
              fill={TEAL}
              stroke="none"
            />
          </>
        )}

        {state === "locked" && (
          <circle cx={22} cy={44} r={11} fill={BONE} stroke={MUTED} strokeWidth={2} />
        )}
      </g>
    </svg>
  );
}

/* ---------------------------------------------------------------------------
 * TrailConnector — the wobbly vertical leg between two nodes. A completed leg is
 * a self-drawing teal stroke (pathLength + .kc-draw, retracts to finished under
 * reduced motion); an upcoming leg is a quiet muted dotted line. Run through
 * #rough so even the straight run reads as hand-laid.
 * ------------------------------------------------------------------------- */
export function TrailConnector({
  drawn,
  play = true,
  delay,
}: {
  // `drawn` = the leg is part of the path already walked (teal, self-drawing).
  drawn: boolean;
  play?: boolean;
  delay?: string;
}) {
  return (
    <svg
      width={4}
      height="100%"
      viewBox="0 0 4 40"
      preserveAspectRatio="none"
      aria-hidden="true"
      focusable="false"
      style={{ display: "block", overflow: "visible", flex: 1, minHeight: 36 }}
    >
      <path
        className={drawn && play ? "kc-draw" : ""}
        pathLength={1}
        d="M2 1 C 0 12, 4 22, 2 39"
        fill="none"
        stroke={drawn ? TEAL : MUTED}
        strokeWidth={drawn ? 2.4 : 2}
        strokeLinecap="round"
        strokeDasharray={drawn ? undefined : "2 7"}
        opacity={drawn ? 1 : 0.6}
        style={{
          filter: "url(#rough)",
          ...(delay ? { animationDelay: delay } : null),
        }}
      />
    </svg>
  );
}

/* ---------------------------------------------------------------------------
 * TrailScore — a compact roughened score ellipse for a cleared goalpost (the
 * "goalpost cleared" mark). Same ellipse hand as ScoreBadge, sized down to sit
 * beside a node. `value` is the goalpost score out of 4.
 * ------------------------------------------------------------------------- */
export function TrailScore({ value }: { value: number }) {
  const big = Number.isInteger(value) ? String(value) : value.toFixed(1);
  return (
    <div
      style={{
        position: "relative",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: 58,
        height: 42,
        flex: "none",
      }}
    >
      <svg
        width="58"
        height="42"
        viewBox="0 0 84 58"
        aria-hidden="true"
        focusable="false"
        style={{ position: "absolute", inset: 0, filter: "url(#rough)" }}
      >
        <path
          d="M12 29 C 12 13, 40 10, 53 11 C 73 13, 74 26, 71 34 C 67 50, 40 52, 25 49 C 12 46, 11 39, 14 29"
          fill="none"
          stroke={TEAL}
          strokeWidth="2.4"
          strokeLinecap="round"
        />
      </svg>
      <div style={{ position: "relative", textAlign: "center", lineHeight: 1 }}>
        <div
          style={{
            fontFamily: "var(--font-display)",
            fontVariationSettings: "var(--soft-ui)",
            fontSize: 16,
            fontWeight: 500,
            color: "var(--ink)",
          }}
        >
          {big}
          <span style={{ fontSize: 11, color: "var(--ink-3)" }}>/4</span>
        </div>
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
