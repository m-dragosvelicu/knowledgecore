"use client";

import Link from "next/link";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Chip from "@mui/material/Chip";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import {
  CheckpointNode,
  TrailConnector,
  TrailScore,
} from "@/components/marks/Marks";

// Vertical skill trail (B.6 Q3): navigational affordance only, no
// streaks/XP/points. Visual marks live in components/marks/Marks.tsx;
// presentation only — states/ordering/scores/aria are driven by the same
// journey data as before.

export type TrailStepKind =
  | "information"
  | "experience_socratic"
  | "experience_applied_problem"
  | "experience_mini_project";

export type TrailNode = {
  id: string;
  order: number;
  title: string;
  objective: string;
  estimatedMinutes: number;
  // Visual + interaction state derived on the server.
  state: "completed" | "current" | "locked";
  // Tagged when this goalpost was inserted by an adjust_plan revision.
  added: boolean;
  // Step-type chips (information + experience) for the goalpost.
  stepTypes: TrailStepKind[];
  // Score out of 4 (mean of rubric dims), present only for completed
  // goalposts that were evaluated; absent renders the hatched node without
  // an ellipse.
  score?: number;
};

const STEP_TYPE_LABEL: Record<TrailStepKind, string> = {
  information: "Information",
  experience_socratic: "Socratic dialogue",
  experience_applied_problem: "Applied problem",
  experience_mini_project: "Mini-project",
};

function NodeCard({ node }: { node: TrailNode }) {
  const isCurrent = node.state === "current";
  const isLocked = node.state === "locked";

  return (
    <Box
      sx={{
        flex: 1,
        minWidth: 0,
        borderRadius: "var(--r-md)",
        border: "1px solid var(--line)",
        borderColor: isCurrent ? "var(--teal)" : "var(--line)",
        borderWidth: isCurrent ? 2 : 1,
        bgcolor: isLocked ? "var(--surface-2)" : "var(--surface)",
        opacity: isLocked ? 0.78 : 1,
        p: 2,
        transition: "box-shadow 120ms ease, transform 120ms ease",
        ...(!isLocked && {
          "&:hover": { boxShadow: 2 },
        }),
      }}
    >
      <Stack spacing={1}>
        <Stack
          direction="row"
          justifyContent="space-between"
          alignItems="baseline"
          spacing={1}
        >
          <Typography
            variant="subtitle1"
            sx={{
              fontFamily: "var(--font-display)",
              fontVariationSettings: "var(--soft-ui)",
              fontWeight: 500,
              color: isLocked ? "var(--ink-2)" : "var(--ink)",
            }}
          >
            {node.title}
          </Typography>
          <Typography variant="caption" className="kc-meta" sx={{ flexShrink: 0 }}>
            ~{node.estimatedMinutes} min
          </Typography>
        </Stack>

        <Stack direction="row" spacing={1} alignItems="center" sx={{ flexWrap: "wrap", rowGap: 0.5 }}>
          {isCurrent && (
            <Chip label="You are here" color="primary" size="small" />
          )}
          {node.state === "completed" && (
            <Chip label="Cleared" size="small" variant="outlined" />
          )}
          {isLocked && (
            <Chip label="Locked" size="small" variant="outlined" />
          )}
          {node.added && (
            <Chip label="Added for you" size="small" />
          )}
        </Stack>

        <Typography
          variant="body2"
          color="text.secondary"
          sx={{
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
          }}
        >
          {node.objective}
        </Typography>

        <Stack direction="row" spacing={0.5} sx={{ flexWrap: "wrap", rowGap: 0.5, mt: 0.5 }}>
          {node.stepTypes.map((t) => (
            <Chip
              key={t}
              label={STEP_TYPE_LABEL[t]}
              size="small"
              variant="outlined"
              sx={{ fontSize: "0.7rem", height: 22 }}
            />
          ))}
        </Stack>
      </Stack>
    </Box>
  );
}

// The card, wrapped in its interaction affordance. Completed goalposts are
// tappable for read-only review; the current goalpost links into the live
// execution loop; locked goalposts are inert (tooltip).
function NodeCardLink({
  node,
  intentId,
}: {
  node: TrailNode;
  intentId?: string | null;
}) {
  // Carry the journey id into the goalpost so a trail tap stays on the journey
  // the learner is viewing rather than drifting onto the most-recent one.
  const jParam = intentId ? `&j=${intentId}` : "";
  if (node.state === "completed") {
    return (
      <Box
        component={Link}
        href={`/journey/goalpost?review=${node.id}${jParam}`}
        sx={{ display: "flex", flex: 1, minWidth: 0, textDecoration: "none" }}
        aria-label={`Review goalpost ${node.order}: ${node.title}`}
      >
        <NodeCard node={node} />
      </Box>
    );
  }
  if (node.state === "current") {
    return (
      <Box
        component={Link}
        href={intentId ? `/journey/goalpost?j=${intentId}` : "/journey/goalpost"}
        sx={{ display: "flex", flex: 1, minWidth: 0, textDecoration: "none" }}
        aria-label={`Continue goalpost ${node.order}: ${node.title}`}
      >
        <NodeCard node={node} />
      </Box>
    );
  }
  return (
    <Tooltip
      title="We'll get there. The path opens one goalpost at a time as you progress."
      placement="top"
      arrow
    >
      <Box sx={{ display: "flex", flex: 1, minWidth: 0, cursor: "not-allowed" }}>
        <NodeCard node={node} />
      </Box>
    </Tooltip>
  );
}

export default function PathTrail({
  nodes,
  intentId,
}: {
  nodes: TrailNode[];
  // The resolved journey id (from ?j), forwarded into each node's link.
  intentId?: string | null;
}) {
  return (
    <Box role="list" aria-label="Your learning path">
      {nodes.map((node, i) => {
        const isLast = i === nodes.length - 1;
        // A connector leg below this node is part of the walked path (teal,
        // self-drawing) when this node is already cleared OR is the current
        // "you are here" goalpost; everything beyond stays a quiet dotted leg.
        const legDrawn = node.state === "completed" || node.state === "current";
        return (
          <Box
            key={node.id}
            role="listitem"
            sx={{
              position: "relative",
              display: "flex",
              alignItems: "flex-start",
              gap: 2,
              pb: isLast ? 0 : 3,
            }}
          >
            {/* Hand-drawn marker column: the checkpoint node + the wobbly leg
                down to the next node. */}
            <Box
              sx={{
                position: "relative",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                flex: "0 0 auto",
                alignSelf: "stretch",
                // Lift the column so the node circle (drawn low in its box to
                // leave flag headroom) lines up with the card's title row.
                mt: "-8px",
              }}
            >
              <CheckpointNode state={node.state} />
              {!isLast && (
                <TrailConnector
                  drawn={legDrawn}
                  delay={`${0.15 + i * 0.12}s`}
                />
              )}
            </Box>

            <Stack direction="row" spacing={1.5} alignItems="flex-start" sx={{ flex: 1, minWidth: 0 }}>
              <NodeCardLink node={node} intentId={intentId} />
              {node.state === "completed" && node.score != null && (
                <Box sx={{ flex: "none", mt: 0.5 }} aria-hidden>
                  <TrailScore value={node.score} />
                </Box>
              )}
            </Stack>
          </Box>
        );
      })}
    </Box>
  );
}
