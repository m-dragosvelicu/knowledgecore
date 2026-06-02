import Stack from "@mui/material/Stack";
import Box from "@mui/material/Box";
import Markdown from "@/components/Markdown";
import VisualMedia from "@/components/journey/VisualMedia";
import { isProseBlock, isVisualBlock } from "@/lib/services/lessonDoc";
import type { LessonDoc, Section } from "@/lib/services/lessonDoc";

/**
 * L1 — Two-Phase Visual Lesson Pipeline (Slice 4: the block-walk renderer).
 *
 * Replaces the FOUNDATION glue that flattened all prose into one markdown string
 * and appended every visual in a trailing block. This walks the LessonDoc in
 * DOCUMENT ORDER, so each section's heading, prose, and visuals render exactly
 * where the Author placed them: prose -> its diagram -> the next prose, never a
 * wall of text followed by a wall of pictures.
 *
 * REVEAL INVARIANT (redesign §5). This renderer is invoked ONLY on a COMPLETE
 * doc. The orchestrator's assemble step already omits dropped slots from the
 * persisted doc, but we GUARD anyway: a visual block renders ONLY when its
 * status is "ready" AND it carries a payload. Anything else (pending, dropped,
 * payload-less) is skipped SILENTLY -- no placeholder, no "loading visual", no
 * dangling reference. Because the Author writes prose that stands alone, a
 * section that lost its visual still reads complete.
 *
 * This is a server component: it renders markdown and the resolved ResolvedVisual
 * payloads that the pipeline already produced server-side. The only client seam
 * is VisualMedia's "not helpful" control, wired through the passed server action.
 */

type Props = {
  doc: LessonDoc;
  // The resolved journey id (from ?j), forwarded to the visual feedback action so
  // the not-helpful signal is recorded against the journey the learner opened.
  intentId: string;
  // Server action that records the not-helpful signal for a visual id. Omit for
  // read-only contexts (review) to hide the feedback control.
  onNotHelpful?: (visualId: string, intentId?: string | null) => void | Promise<void>;
};

// The section heading reads in the display voice, matching the markdown h2 that
// InformationView already styles, so an authored heading and an in-prose heading
// share one type system on the reading surface.
function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <Box
      component="h2"
      sx={{
        fontFamily: "var(--font-display)",
        fontVariationSettings: "var(--soft-ui)",
        fontWeight: 500,
        letterSpacing: "-.01em",
        color: "var(--ink)",
        lineHeight: 1.2,
        fontSize: "23px",
        m: 0,
        mt: "0.2em",
      }}
    >
      {children}
    </Box>
  );
}

function SectionView({
  section,
  intentId,
  onNotHelpful,
}: {
  section: Section;
  intentId: string;
  onNotHelpful?: (visualId: string, intentId?: string | null) => void | Promise<void>;
}) {
  return (
    <Stack spacing={2.5} component="section">
      {section.heading ? <SectionHeading>{section.heading}</SectionHeading> : null}
      {section.blocks.map((block) => {
        if (isProseBlock(block)) {
          return <Markdown key={block.id}>{block.md}</Markdown>;
        }
        // REVEAL-INVARIANT GUARD: only a resolved, ready visual ever reaches the
        // learning surface. A pending / dropped / payload-less block is skipped
        // silently -- the prose around it stands alone.
        if (isVisualBlock(block) && block.status === "ready" && block.payload) {
          return (
            <VisualMedia
              key={block.id}
              visual={block.payload}
              intentId={intentId}
              onNotHelpful={onNotHelpful}
            />
          );
        }
        return null;
      })}
    </Stack>
  );
}

export default function LessonDocView({ doc, intentId, onNotHelpful }: Props) {
  return (
    <Stack spacing={4}>
      {doc.sections.map((section) => (
        <SectionView
          key={section.id}
          section={section}
          intentId={intentId}
          onNotHelpful={onNotHelpful}
        />
      ))}
    </Stack>
  );
}
