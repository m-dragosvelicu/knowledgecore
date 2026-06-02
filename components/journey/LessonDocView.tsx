import Stack from "@mui/material/Stack";
import Box from "@mui/material/Box";
import Markdown from "@/components/Markdown";
import VisualMedia from "@/components/journey/VisualMedia";
import { isProseBlock, isVisualBlock } from "@/lib/services/lessonDoc";
import type { LessonDoc, Section } from "@/lib/services/lessonDoc";

// Block-walk renderer for a COMPLETE LessonDoc: walks sections in document order
// so prose and visuals render where the Author placed them.

type Props = {
  doc: LessonDoc;
  intentId: string;
  // Omit for read-only contexts (review) to hide the feedback control.
  onNotHelpful?: (visualId: string, intentId?: string | null) => void | Promise<void>;
};

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
        // Reveal invariant: only render a ready visual that carries a payload;
        // skip pending/dropped/payload-less blocks silently (prose stands alone).
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
