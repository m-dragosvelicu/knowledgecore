"use client";

// kcBuildWB() ported verbatim from design-system/ui_kits/web-app/Controls.jsx
// (buildWB()). CSS for the invisible-at-rest / draw-on-hover strokes lives in
// app/globals.css (.kc-wb / .kc-ink-stroke / .kc-wb-base).
//
// Imperative DOM injection (not declarative JSX) because mark geometry depends
// on the button's measured pixel width/height, only known after layout.

import { useLayoutEffect, useRef } from "react";
import type { ReactNode } from "react";

let KC_WB_UID = 0;
const kcRnd = () => Math.floor(Math.random() * 900);

function kcPill(w: number, h: number) {
  const r = h / 2;
  return `M ${r} 1.5 H ${w - r} A ${r - 1.5} ${r - 1.5} 0 0 1 ${w - r} ${
    h - 1.5
  } H ${r} A ${r - 1.5} ${r - 1.5} 0 0 1 ${r} 1.5 Z`;
}

function kcHatch(w: number, h: number) {
  const lines: string[] = [];
  const step = 15;
  for (let c = step; c < w + h; c += step) {
    lines.push(`M ${c} -3 L ${c - h - 3} ${h + 3}`);
  }
  return lines;
}

// Ported verbatim from Controls.jsx kcBuildWB().
function kcBuildWB(btn: HTMLButtonElement | null) {
  if (!btn) return;
  const old = btn.querySelector(".kc-art");
  if (old) old.remove();
  const w = Math.round(btn.offsetWidth);
  const h = Math.round(btn.offsetHeight);
  if (w < 20 || h < 20 || w > 600) return;
  const lbl = btn.querySelector(".kc-wb-lbl");
  if (!lbl) return;
  const d = kcPill(w, h);
  const id = ++KC_WB_UID;
  const fId = "f" + id;
  const cId = "c" + id;
  const mId = "m" + id;
  const bId = "b" + id;
  const defs =
    `<filter id="${fId}"><feTurbulence type="fractalNoise" baseFrequency="0.025" numOctaves="2" seed="${kcRnd()}" result="n"/><feDisplacementMap in="SourceGraphic" in2="n" scale="2.4" xChannelSelector="R" yChannelSelector="G"/></filter>` +
    `<clipPath id="${cId}"><path d="${d}"/></clipPath>` +
    `<filter id="${bId}" x="-30%" y="-80%" width="160%" height="260%"><feMorphology operator="dilate" radius="2.4"/><feGaussianBlur stdDeviation="1.4"/></filter>` +
    `<mask id="${mId}"><rect width="${w}" height="${h}" fill="white"/><text x="${
      w / 2
    }" y="${
      h / 2 + 5.2
    }" text-anchor="middle" font-family="Hanken Grotesk" font-weight="600" font-size="14.5" fill="black" filter="url(#${bId})">${lbl.textContent}</text></mask>`;
  let s =
    `<svg class="kc-art" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none"><defs>${defs}</defs><g filter="url(#${fId})">` +
    `<path class="kc-wb-base" d="${d}"/><path class="kc-ink-stroke" pathLength="1" d="${d}" stroke-width="2.4"/>` +
    `<g clip-path="url(#${cId})" mask="url(#${mId})">`;
  kcHatch(w, h).forEach((l, i) => {
    s += `<path class="kc-ink-stroke" pathLength="1" d="${l}" stroke-width="1.4" style="transition-delay:${(
      0.26 +
      i * 0.035
    ).toFixed(2)}s,0s"/>`;
  });
  s += `</g></g></svg>`;
  btn.insertAdjacentHTML("afterbegin", s);
  const turb = btn.querySelector("feTurbulence");
  // Re-roll the wobble seed on every hover so the mark never repeats.
  btn.addEventListener("mouseenter", () => {
    if (turb) turb.setAttribute("seed", String(kcRnd()));
  });
}

export type WobbleButtonProps = {
  children: ReactNode;
  onClick?: () => void;
  /** Bare = no resting silhouette, just the label until hover. */
  bare?: boolean;
  type?: "button" | "submit";
  disabled?: boolean;
  "aria-label"?: string;
};

export default function WobbleButton({
  children,
  onClick,
  bare,
  type = "button",
  disabled,
  "aria-label": ariaLabel,
}: WobbleButtonProps) {
  const ref = useRef<HTMLButtonElement>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    kcBuildWB(el);
    // Re-measure once the webfont is ready: glyph widths shift the layout, which
    // changes the mask + pill geometry.
    if (typeof document !== "undefined" && document.fonts?.ready) {
      document.fonts.ready.then(() => kcBuildWB(el));
    }
  }, [children]);

  return (
    <button
      ref={ref}
      type={type}
      className={"kc-wb" + (bare ? " kc-bare" : "")}
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
    >
      <span className="kc-wb-lbl">{children}</span>
    </button>
  );
}
