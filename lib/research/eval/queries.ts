/**
 * Query sets for the L2 ingestion bench (CEO plan §3; retrieval-layer bench
 * per reading-room/eval-metrics-verification-2026-08-07.html §5).
 *
 * V1 (QUERIES/TOPICS below) is the FROZEN original 3 topics x 5 queries used
 * by the search-engine (ADR 9) and embedding-model (D4) eval that already ran
 * and was ratified by the CEO 2026-06-03. Do not edit it — run-search.ts and
 * embeddings/run-embeddings.ts both import it by name and its results are
 * archived in out/ as a reproducibility record.
 *
 * V2 (QUERIES_V2/TOPICS_V2 below) is the powered set for the retrieval-layer
 * bench (nDCG/Recall@k/MRR against synthetic qrels, see qrels/): 9 topics x 7
 * queries = 63 queries, spanning 3 domains (stem/humanities/applied) and 3
 * difficulty levels (intro/intermediate/advanced) per topic, so retrieval
 * quality can be sliced by both domain and difficulty instead of averaged
 * over a single small sample. Added 2026-08-07, versioned so V1 stays a
 * reproducible fixed point.
 */

export type Level = "intro" | "intermediate" | "advanced";
export type Domain = "stem" | "humanities" | "applied";

export interface EvalQuery {
  id: string;
  topic: string;
  level: Level;
  query: string;
  /** Optional: only populated on V2+ queries. V1 rows predate domain tagging. */
  domain?: Domain;
}

export const TOPICS = [
  "default mode network",
  "lean manufacturing",
  "Art Nouveau",
] as const;

export const QUERIES: EvalQuery[] = [
  { id: "dmn-1", topic: "default mode network", level: "intro", query: "what is the default mode network in the brain" },
  { id: "dmn-2", topic: "default mode network", level: "intro", query: "default mode network explained simply for beginners" },
  { id: "dmn-3", topic: "default mode network", level: "intermediate", query: "default mode network brain regions and functions" },
  { id: "dmn-4", topic: "default mode network", level: "intermediate", query: "how does the default mode network relate to mind wandering and self-referential thought" },
  { id: "dmn-5", topic: "default mode network", level: "intermediate", query: "default mode network connectivity in depression and Alzheimer's" },

  { id: "lean-1", topic: "lean manufacturing", level: "intro", query: "what is lean manufacturing" },
  { id: "lean-2", topic: "lean manufacturing", level: "intro", query: "lean manufacturing principles explained for beginners" },
  { id: "lean-3", topic: "lean manufacturing", level: "intermediate", query: "the seven wastes (muda) in lean manufacturing" },
  { id: "lean-4", topic: "lean manufacturing", level: "intermediate", query: "Toyota Production System kanban and just-in-time how it works" },
  { id: "lean-5", topic: "lean manufacturing", level: "intermediate", query: "value stream mapping and kaizen continuous improvement in lean" },

  { id: "artn-1", topic: "Art Nouveau", level: "intro", query: "what is Art Nouveau" },
  { id: "artn-2", topic: "Art Nouveau", level: "intro", query: "Art Nouveau art movement explained for beginners" },
  { id: "artn-3", topic: "Art Nouveau", level: "intermediate", query: "characteristics and motifs of Art Nouveau style" },
  { id: "artn-4", topic: "Art Nouveau", level: "intermediate", query: "key Art Nouveau artists Alphonse Mucha and Gustav Klimt" },
  { id: "artn-5", topic: "Art Nouveau", level: "intermediate", query: "Art Nouveau architecture Victor Horta and Antoni Gaudi" },
];

// ---------------------------------------------------------------------------
// V2: powered retrieval-layer set. 9 topics x 7 queries = 63. 2 intro / 3
// intermediate / 2 advanced per topic. 3 topics per domain.
// ---------------------------------------------------------------------------

export const TOPICS_V2 = [
  "photosynthesis",
  "linear algebra eigenvalues",
  "quantum entanglement",
  "the Renaissance",
  "existentialism",
  "the French Revolution",
  "agile software development",
  "personal finance budgeting",
  "supply and demand",
] as const;

export const QUERIES_V2: EvalQuery[] = [
  // --- STEM ---------------------------------------------------------------
  { id: "photo-1", topic: "photosynthesis", domain: "stem", level: "intro", query: "what is photosynthesis" },
  { id: "photo-2", topic: "photosynthesis", domain: "stem", level: "intro", query: "photosynthesis explained simply for beginners" },
  { id: "photo-3", topic: "photosynthesis", domain: "stem", level: "intermediate", query: "light-dependent and light-independent reactions of photosynthesis" },
  { id: "photo-4", topic: "photosynthesis", domain: "stem", level: "intermediate", query: "role of chlorophyll and the thylakoid membrane in photosynthesis" },
  { id: "photo-5", topic: "photosynthesis", domain: "stem", level: "intermediate", query: "how does the Calvin cycle fix carbon dioxide" },
  { id: "photo-6", topic: "photosynthesis", domain: "stem", level: "advanced", query: "photosystem II water-splitting mechanism and the oxygen-evolving complex" },
  { id: "photo-7", topic: "photosynthesis", domain: "stem", level: "advanced", query: "C3 vs C4 vs CAM photosynthesis carbon fixation pathways compared" },

  { id: "linalg-1", topic: "linear algebra eigenvalues", domain: "stem", level: "intro", query: "what are eigenvalues and eigenvectors" },
  { id: "linalg-2", topic: "linear algebra eigenvalues", domain: "stem", level: "intro", query: "eigenvalues explained simply with an example" },
  { id: "linalg-3", topic: "linear algebra eigenvalues", domain: "stem", level: "intermediate", query: "how to compute eigenvalues of a matrix step by step" },
  { id: "linalg-4", topic: "linear algebra eigenvalues", domain: "stem", level: "intermediate", query: "diagonalization of a matrix using eigenvectors" },
  { id: "linalg-5", topic: "linear algebra eigenvalues", domain: "stem", level: "intermediate", query: "eigenvalues and principal component analysis in machine learning" },
  { id: "linalg-6", topic: "linear algebra eigenvalues", domain: "stem", level: "advanced", query: "spectral theorem for symmetric matrices proof" },
  { id: "linalg-7", topic: "linear algebra eigenvalues", domain: "stem", level: "advanced", query: "generalized eigenvalue problems and Jordan normal form" },

  { id: "qent-1", topic: "quantum entanglement", domain: "stem", level: "intro", query: "what is quantum entanglement" },
  { id: "qent-2", topic: "quantum entanglement", domain: "stem", level: "intro", query: "quantum entanglement explained for beginners" },
  { id: "qent-3", topic: "quantum entanglement", domain: "stem", level: "intermediate", query: "EPR paradox and Bell's theorem explained" },
  { id: "qent-4", topic: "quantum entanglement", domain: "stem", level: "intermediate", query: "how quantum entanglement is used in quantum teleportation" },
  { id: "qent-5", topic: "quantum entanglement", domain: "stem", level: "intermediate", query: "entanglement versus superposition what is the difference" },
  { id: "qent-6", topic: "quantum entanglement", domain: "stem", level: "advanced", query: "CHSH inequality violation experiments and loophole-free Bell tests" },
  { id: "qent-7", topic: "quantum entanglement", domain: "stem", level: "advanced", query: "entanglement entropy and its role in quantum information theory" },

  // --- Humanities -----------------------------------------------------------
  { id: "ren-1", topic: "the Renaissance", domain: "humanities", level: "intro", query: "what was the Renaissance" },
  { id: "ren-2", topic: "the Renaissance", domain: "humanities", level: "intro", query: "the Renaissance explained simply for beginners" },
  { id: "ren-3", topic: "the Renaissance", domain: "humanities", level: "intermediate", query: "causes of the Renaissance in Italy" },
  { id: "ren-4", topic: "the Renaissance", domain: "humanities", level: "intermediate", query: "key Renaissance artists Leonardo da Vinci and Michelangelo" },
  { id: "ren-5", topic: "the Renaissance", domain: "humanities", level: "intermediate", query: "how humanism shaped Renaissance thought" },
  { id: "ren-6", topic: "the Renaissance", domain: "humanities", level: "advanced", query: "patronage systems and the Medici family's influence on Renaissance art" },
  { id: "ren-7", topic: "the Renaissance", domain: "humanities", level: "advanced", query: "the Northern Renaissance and how it differed from the Italian Renaissance" },

  { id: "exist-1", topic: "existentialism", domain: "humanities", level: "intro", query: "what is existentialism" },
  { id: "exist-2", topic: "existentialism", domain: "humanities", level: "intro", query: "existentialism explained for beginners" },
  { id: "exist-3", topic: "existentialism", domain: "humanities", level: "intermediate", query: "Sartre's concept of existence precedes essence" },
  { id: "exist-4", topic: "existentialism", domain: "humanities", level: "intermediate", query: "Kierkegaard and the leap of faith in existentialist thought" },
  { id: "exist-5", topic: "existentialism", domain: "humanities", level: "intermediate", query: "absurdism versus existentialism Camus and Sartre compared" },
  { id: "exist-6", topic: "existentialism", domain: "humanities", level: "advanced", query: "Heidegger's Being and Time and its influence on existentialist philosophy" },
  { id: "exist-7", topic: "existentialism", domain: "humanities", level: "advanced", query: "critiques of existentialism from structuralist and phenomenological traditions" },

  { id: "frrev-1", topic: "the French Revolution", domain: "humanities", level: "intro", query: "what caused the French Revolution" },
  { id: "frrev-2", topic: "the French Revolution", domain: "humanities", level: "intro", query: "the French Revolution explained simply for beginners" },
  { id: "frrev-3", topic: "the French Revolution", domain: "humanities", level: "intermediate", query: "timeline of major events in the French Revolution" },
  { id: "frrev-4", topic: "the French Revolution", domain: "humanities", level: "intermediate", query: "the Reign of Terror and Robespierre's role" },
  { id: "frrev-5", topic: "the French Revolution", domain: "humanities", level: "intermediate", query: "how the French Revolution led to Napoleon's rise to power" },
  { id: "frrev-6", topic: "the French Revolution", domain: "humanities", level: "advanced", query: "the economic and Enlightenment causes of the French Revolution debated by historians" },
  { id: "frrev-7", topic: "the French Revolution", domain: "humanities", level: "advanced", query: "comparing the French Revolution and the American Revolution's political outcomes" },

  // --- Applied ----------------------------------------------------------
  { id: "agile-1", topic: "agile software development", domain: "applied", level: "intro", query: "what is agile software development" },
  { id: "agile-2", topic: "agile software development", domain: "applied", level: "intro", query: "agile methodology explained simply for beginners" },
  { id: "agile-3", topic: "agile software development", domain: "applied", level: "intermediate", query: "Scrum vs Kanban differences in agile practice" },
  { id: "agile-4", topic: "agile software development", domain: "applied", level: "intermediate", query: "how sprint planning and retrospectives work in Scrum" },
  { id: "agile-5", topic: "agile software development", domain: "applied", level: "intermediate", query: "the twelve principles behind the Agile Manifesto" },
  { id: "agile-6", topic: "agile software development", domain: "applied", level: "advanced", query: "scaling agile frameworks like SAFe and LeSS for large organizations" },
  { id: "agile-7", topic: "agile software development", domain: "applied", level: "advanced", query: "criticisms of agile adoption and common anti-patterns in enterprise teams" },

  { id: "pfin-1", topic: "personal finance budgeting", domain: "applied", level: "intro", query: "what is a budget and why do I need one" },
  { id: "pfin-2", topic: "personal finance budgeting", domain: "applied", level: "intro", query: "personal budgeting basics explained for beginners" },
  { id: "pfin-3", topic: "personal finance budgeting", domain: "applied", level: "intermediate", query: "the 50/30/20 budgeting rule explained" },
  { id: "pfin-4", topic: "personal finance budgeting", domain: "applied", level: "intermediate", query: "building an emergency fund how much should I save" },
  { id: "pfin-5", topic: "personal finance budgeting", domain: "applied", level: "intermediate", query: "zero-based budgeting versus envelope budgeting methods" },
  { id: "pfin-6", topic: "personal finance budgeting", domain: "applied", level: "advanced", query: "how compound interest and asset allocation affect long-term retirement budgeting" },
  { id: "pfin-7", topic: "personal finance budgeting", domain: "applied", level: "advanced", query: "tax-advantaged accounts and their role in an optimized personal budget strategy" },

  { id: "sd-1", topic: "supply and demand", domain: "applied", level: "intro", query: "what is supply and demand" },
  { id: "sd-2", topic: "supply and demand", domain: "applied", level: "intro", query: "supply and demand explained simply for beginners" },
  { id: "sd-3", topic: "supply and demand", domain: "applied", level: "intermediate", query: "how equilibrium price is determined by supply and demand curves" },
  { id: "sd-4", topic: "supply and demand", domain: "applied", level: "intermediate", query: "price elasticity of demand explained with examples" },
  { id: "sd-5", topic: "supply and demand", domain: "applied", level: "intermediate", query: "how shifts in supply and demand curves affect market price" },
  { id: "sd-6", topic: "supply and demand", domain: "applied", level: "advanced", query: "market failure and deadweight loss caused by price controls" },
  { id: "sd-7", topic: "supply and demand", domain: "applied", level: "advanced", query: "general equilibrium theory versus partial equilibrium analysis in microeconomics" },
];
