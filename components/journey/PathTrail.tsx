"use client";

import Link from "next/link";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Chip from "@mui/material/Chip";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";

// B.6 Q3 (resolved 2026-05-30): a VERTICAL, Duolingo-style skill trail -- a
// winding column of nodes with one obvious next step, a sticky "you are here"
// marker, completed nodes tappable for review, and future nodes locked. We
// adopt only the navigational affordance: NO streaks, XP, lives, or points.

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
};

const STEP_TYPE_LABEL: Record<TrailStepKind, string> = {
  information: "Information",
  experience_socratic: "Socratic dialogue",
  experience_applied_problem: "Applied problem",
  experience_mini_project: "Mini-project",
};

// The trail winds left/right so it reads as a path, not a list. Even-indexed
// nodes hug the left; odd-indexed nodes shift right.
const SHIFT = 56; // px horizontal offset for the winding effect

function nodeColor(state: TrailNode["state"]) {
  if (state === "completed") return "success.main";
  if (state === "current") return "primary.main";
  return "text.disabled";
}

function Marker({ node }: { node: TrailNode }) {
  const color = nodeColor(node.state);
  return (
    <Box
      aria-hidden
      sx={{
        position: "relative",
        flex: "0 0 auto",
        width: 44,
        height: 44,
        borderRadius: "50%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        bgcolor: node.state === "locked" ? "action.hover" : color,
        color: node.state === "locked" ? "text.disabled" : "common.white",
        border: 3,
        borderColor: node.state === "current" ? "primary.light" : "transparent",
        boxShadow: node.state === "current" ? 4 : 0,
      }}
    >
      {node.state === "completed" ? (
        <Box
          component="svg"
          viewBox="0 0 24 24"
          width={22}
          height={22}
          sx={{ fill: "none", stroke: "currentColor", strokeWidth: 3 }}
        >
          <polyline points="20 6 9 17 4 12" />
        </Box>
      ) : node.state === "locked" ? (
        <Box
          component="svg"
          viewBox="0 0 24 24"
          width={20}
          height={20}
          sx={{ fill: "none", stroke: "currentColor", strokeWidth: 2 }}
        >
          <rect x="5" y="11" width="14" height="9" rx="2" />
          <path d="M8 11V8a4 4 0 0 1 8 0v3" />
        </Box>
      ) : (
        <Typography sx={{ fontWeight: 700, fontSize: "1.05rem" }}>
          {node.order}
        </Typography>
      )}
    </Box>
  );
}

function NodeCard({ node }: { node: TrailNode }) {
  const isCurrent = node.state === "current";
  const isLocked = node.state === "locked";

  const card = (
    <Box
      sx={{
        flex: 1,
        minWidth: 0,
        borderRadius: 2,
        border: 1,
        borderColor: isCurrent ? "primary.main" : "divider",
        borderWidth: isCurrent ? 2 : 1,
        bgcolor: isLocked ? "action.hover" : "background.paper",
        opacity: isLocked ? 0.7 : 1,
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
            sx={{ fontWeight: 600, color: isLocked ? "text.secondary" : "text.primary" }}
          >
            {node.title}
          </Typography>
          <Typography variant="caption" color="text.secondary" sx={{ flexShrink: 0 }}>
            ~{node.estimatedMinutes} min
          </Typography>
        </Stack>

        <Stack direction="row" spacing={1} alignItems="center" sx={{ flexWrap: "wrap", rowGap: 0.5 }}>
          {isCurrent && (
            <Chip label="You are here" color="primary" size="small" />
          )}
          {node.state === "completed" && (
            <Chip label="Completed" color="success" size="small" variant="outlined" />
          )}
          {isLocked && (
            <Chip label="Locked" size="small" variant="outlined" />
          )}
          {node.added && (
            <Chip label="Added for you" color="info" size="small" />
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

  // Completed goalposts are tappable for read-only review; the current goalpost
  // links into the live execution loop; locked goalposts are inert (tooltip).
  if (node.state === "completed") {
    return (
      <Box
        component={Link}
        href={`/journey/goalpost?review=${node.id}`}
        sx={{ display: "flex", flex: 1, minWidth: 0, textDecoration: "none" }}
        aria-label={`Review goalpost ${node.order}: ${node.title}`}
      >
        {card}
      </Box>
    );
  }
  if (node.state === "current") {
    return (
      <Box
        component={Link}
        href="/journey/goalpost"
        sx={{ display: "flex", flex: 1, minWidth: 0, textDecoration: "none" }}
        aria-label={`Continue goalpost ${node.order}: ${node.title}`}
      >
        {card}
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
        {card}
      </Box>
    </Tooltip>
  );
}

export default function PathTrail({ nodes }: { nodes: TrailNode[] }) {
  return (
    <Box role="list" aria-label="Your learning path">
      {nodes.map((node, i) => {
        const shift = i % 2 === 0 ? 0 : SHIFT;
        const isLast = i === nodes.length - 1;
        return (
          <Box
            key={node.id}
            role="listitem"
            sx={{
              position: "relative",
              display: "flex",
              alignItems: "flex-start",
              gap: 2,
              ml: { xs: 0, sm: `${shift}px` },
              transition: "margin-left 200ms ease",
              pb: isLast ? 0 : 3,
            }}
          >
            {/* Connector line + marker column */}
            <Box
              sx={{
                position: "relative",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                flex: "0 0 auto",
              }}
            >
              <Marker node={node} />
              {!isLast && (
                <Box
                  aria-hidden
                  sx={{
                    width: 4,
                    flex: 1,
                    minHeight: 36,
                    mt: 0.5,
                    borderRadius: 2,
                    bgcolor:
                      node.state === "completed" ? "success.light" : "divider",
                  }}
                />
              )}
            </Box>
            <NodeCard node={node} />
          </Box>
        );
      })}
    </Box>
  );
}
