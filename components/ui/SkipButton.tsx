"use client";

// Lightest workbench-tier button: text-only at rest; hover draws a freehand
// teal loop only (no hatch fill, unlike WobbleButton).
// kcBuildSkip() ported verbatim from design-system/ui_kits/web-app/Controls.jsx
// (buildSkip()). CSS (.kc-skip / .kc-loop-stroke) lives in app/globals.css.

import { useLayoutEffect, useRef } from "react";
import type { ReactNode } from "react";

let KC_SKIP_UID = 0;
const kcRnd = () => Math.floor(Math.random() * 900);

// Freehand loop: a single open stroke that circles the word and overshoots past
// its start. Ported verbatim from Controls.jsx kcLoopPath().
function kcLoopPath(w: number, h: number) {
  const cx = w / 2;
  const cy = h / 2;
  const rx = w / 2 - 2;
  const ry = h / 2 - 1;
  const p = (a: number, b: number) => `${a.toFixed(1)} ${b.toFixed(1)}`;
  return (
    `M ${p(cx - rx * 0.62, cy + ry * 0.78)}` +
    ` C ${p(cx - rx * 1.06, cy + ry * 0.24)}, ${p(
      cx - rx * 0.96,
      cy - ry * 0.92,
    )}, ${p(cx - rx * 0.08, cy - ry * 0.96)}` +
    ` C ${p(cx + rx * 0.82, cy - ry * 1.0)}, ${p(
      cx + rx * 1.07,
      cy - ry * 0.12,
    )}, ${p(cx + rx * 0.9, cy + ry * 0.52)}` +
    ` C ${p(cx + rx * 0.76, cy + ry * 1.04)}, ${p(
      cx - rx * 0.28,
      cy + ry * 1.08,
    )}, ${p(cx - rx * 0.92, cy + ry * 0.4)}`
  );
}

function kcBuildSkip(btn: HTMLButtonElement | null) {
  if (!btn) return;
  const old = btn.querySelector(".kc-art");
  if (old) old.remove();
  const w = Math.round(btn.offsetWidth);
  const h = Math.round(btn.offsetHeight);
  if (w < 20 || h < 20 || w > 600) return;
  const id = ++KC_SKIP_UID;
  const fId = "sf" + id;
  const d = kcLoopPath(w, h);
  const defs = `<filter id="${fId}"><feTurbulence type="fractalNoise" baseFrequency="0.03" numOctaves="2" seed="${kcRnd()}" result="n"/><feDisplacementMap in="SourceGraphic" in2="n" scale="3" xChannelSelector="R" yChannelSelector="G"/></filter>`;
  const s = `<svg class="kc-art" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none"><defs>${defs}</defs><g filter="url(#${fId})"><path class="kc-loop-stroke" pathLength="1" d="${d}"/></g></svg>`;
  btn.insertAdjacentHTML("afterbegin", s);
  const turb = btn.querySelector("feTurbulence");
  btn.addEventListener("mouseenter", () => {
    if (turb) turb.setAttribute("seed", String(kcRnd()));
  });
}

export type SkipButtonProps = {
  children: ReactNode;
  onClick?: () => void;
  type?: "button" | "submit";
  disabled?: boolean;
  "aria-label"?: string;
};

export default function SkipButton({
  children,
  onClick,
  type = "button",
  disabled,
  "aria-label": ariaLabel,
}: SkipButtonProps) {
  const ref = useRef<HTMLButtonElement>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    kcBuildSkip(el);
    if (typeof document !== "undefined" && document.fonts?.ready) {
      document.fonts.ready.then(() => kcBuildSkip(el));
    }
  }, [children]);

  return (
    <button
      ref={ref}
      type={type}
      className="kc-skip"
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
    >
      <span className="kc-wb-lbl">{children}</span>
    </button>
  );
}
