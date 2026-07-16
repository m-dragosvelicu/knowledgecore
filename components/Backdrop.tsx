// Mounted once in app/layout.tsx, before any consumer. The defs live in a 0x0
// hidden SVG so hand-drawn marks elsewhere can reference url(#rough) /
// url(#hatchT).

// Pure markup, no client interactivity — safe as a server component.
export default function Backdrop() {
  return (
    <>
      {/* Texture layers — behind everything, non-interactive. */}
      <div className="kc-dotgrid" aria-hidden="true" />
      <div className="kc-grain" aria-hidden="true" />

      {/* Shared hand-mark defs. Ported verbatim from
          design-system/assets/rough-defs.svg. */}
      <svg
        width="0"
        height="0"
        style={{ position: "absolute" }}
        aria-hidden="true"
        focusable="false"
      >
        <defs>
          {/* The wobble: feTurbulence noise field feeding feDisplacementMap,
              giving any clean vector path an unsteady, inky edge. */}
          <filter id="rough">
            <feTurbulence
              type="fractalNoise"
              baseFrequency="0.02"
              numOctaves="2"
              seed="4"
              result="n"
            />
            <feDisplacementMap
              in="SourceGraphic"
              in2="n"
              scale="2.6"
              xChannelSelector="R"
              yChannelSelector="G"
            />
          </filter>

          {/* Diagonal hatch fill for checkpoint circles / score badges. */}
          <pattern
            id="hatchT"
            width="5"
            height="5"
            patternTransform="rotate(45)"
            patternUnits="userSpaceOnUse"
          >
            <line x1="0" y1="0" x2="0" y2="5" stroke="#1F6E67" strokeWidth="1.1" />
          </pattern>
        </defs>
      </svg>
    </>
  );
}
