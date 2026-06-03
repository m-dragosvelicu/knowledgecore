/**
 * Frozen query set for the L2 ingestion bench (CEO plan §3).
 * 3 topics x 5 realistic learner queries (intro + intermediate phrasings).
 * Version-controlled so the bench is reproducible.
 */

export type Level = "intro" | "intermediate";

export interface EvalQuery {
  id: string;
  topic: string;
  level: Level;
  query: string;
}

export const TOPICS = [
  "default mode network",
  "lean manufacturing",
  "Art Nouveau",
] as const;

export const QUERIES: EvalQuery[] = [
  // --- Default mode network ---
  { id: "dmn-1", topic: "default mode network", level: "intro", query: "what is the default mode network in the brain" },
  { id: "dmn-2", topic: "default mode network", level: "intro", query: "default mode network explained simply for beginners" },
  { id: "dmn-3", topic: "default mode network", level: "intermediate", query: "default mode network brain regions and functions" },
  { id: "dmn-4", topic: "default mode network", level: "intermediate", query: "how does the default mode network relate to mind wandering and self-referential thought" },
  { id: "dmn-5", topic: "default mode network", level: "intermediate", query: "default mode network connectivity in depression and Alzheimer's" },

  // --- Lean manufacturing ---
  { id: "lean-1", topic: "lean manufacturing", level: "intro", query: "what is lean manufacturing" },
  { id: "lean-2", topic: "lean manufacturing", level: "intro", query: "lean manufacturing principles explained for beginners" },
  { id: "lean-3", topic: "lean manufacturing", level: "intermediate", query: "the seven wastes (muda) in lean manufacturing" },
  { id: "lean-4", topic: "lean manufacturing", level: "intermediate", query: "Toyota Production System kanban and just-in-time how it works" },
  { id: "lean-5", topic: "lean manufacturing", level: "intermediate", query: "value stream mapping and kaizen continuous improvement in lean" },

  // --- Art Nouveau ---
  { id: "artn-1", topic: "Art Nouveau", level: "intro", query: "what is Art Nouveau" },
  { id: "artn-2", topic: "Art Nouveau", level: "intro", query: "Art Nouveau art movement explained for beginners" },
  { id: "artn-3", topic: "Art Nouveau", level: "intermediate", query: "characteristics and motifs of Art Nouveau style" },
  { id: "artn-4", topic: "Art Nouveau", level: "intermediate", query: "key Art Nouveau artists Alphonse Mucha and Gustav Klimt" },
  { id: "artn-5", topic: "Art Nouveau", level: "intermediate", query: "Art Nouveau architecture Victor Horta and Antoni Gaudi" },
];
