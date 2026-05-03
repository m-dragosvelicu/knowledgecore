import type {
  CanDoStatement,
  Competency,
  KnowledgeProbe,
  ParsedSubject,
  ProbeAnswer,
  ProbeQuestion,
} from "@/lib/services/types";

function isLinearAlgebraSubject(name: string): boolean {
  const lower = name.toLowerCase();
  return lower.includes("linear algebra") || lower.includes("math") || lower.includes("ml");
}

const LINEAR_ALGEBRA_QUESTIONS: ProbeQuestion[] = [
  {
    id: "la-q1",
    prompt: "Solve for x: 3x + 7 = 22. Show one line of work.",
    kind: "open",
    competencyTag: "high-school-algebra",
  },
  {
    id: "la-q2",
    prompt: "In your own words, what does it mean for two arrows in a 2D plane to be 'vectors'? What information do they carry?",
    kind: "open",
    competencyTag: "vector-intuition",
  },
  {
    id: "la-q3",
    prompt: "Which of the following best describes the dot product of two vectors?",
    kind: "multiple_choice",
    options: [
      "The sum of the two vectors element-wise",
      "A scalar that grows when the vectors point in similar directions",
      "A new vector perpendicular to both",
      "I am not sure",
    ],
    competencyTag: "dot-product-knowledge",
  },
  {
    id: "la-q4",
    prompt: "Are the vectors (1, 0) and (2, 0) linearly independent? Briefly justify your answer.",
    kind: "open",
    competencyTag: "linear-independence",
  },
  {
    id: "la-q5",
    prompt: "When you multiply a 2x3 matrix by a 3x1 vector, what is the shape of the result?",
    kind: "multiple_choice",
    options: ["2x1", "3x2", "2x3", "Cannot be multiplied"],
    competencyTag: "matrix-multiplication",
  },
  {
    id: "la-q6",
    prompt: "An eigenvector of a matrix is, intuitively, a direction that is... (pick the closest description).",
    kind: "multiple_choice",
    options: [
      "Rotated by 90 degrees by the matrix",
      "Scaled but not rotated by the matrix",
      "Sent to the zero vector by the matrix",
      "I have not seen this concept before",
    ],
    competencyTag: "eigenvalue-intuition",
  },
];

const LINEAR_ALGEBRA_COMPETENCIES: Competency[] = [
  { competency: "high-school-algebra", estimatedLevel: 3, confidence: 0.9 },
  { competency: "vector-intuition", estimatedLevel: 0, confidence: 0.85 },
  { competency: "calculus", estimatedLevel: 1, confidence: 0.7 },
  { competency: "programming-basics", estimatedLevel: 3, confidence: 0.8 },
];

function genericQuestions(subject: string): ProbeQuestion[] {
  return [
    {
      id: "g-q1",
      prompt: `What do you already know about ${subject}? Briefly describe in one or two sentences.`,
      kind: "open",
      competencyTag: "self-report",
    },
    {
      id: "g-q2",
      prompt: `Have you ever applied ${subject} to a real problem before?`,
      kind: "multiple_choice",
      options: ["Never", "Once or twice", "Several times", "Regularly"],
      competencyTag: "prior-application",
    },
    {
      id: "g-q3",
      prompt: `Name one core concept you associate with ${subject} and explain it in your own words.`,
      kind: "open",
      competencyTag: "core-concept",
    },
    {
      id: "g-q4",
      prompt: `How comfortable are you reading introductory material about ${subject}?`,
      kind: "multiple_choice",
      options: ["Not at all", "A little", "Comfortable", "Very comfortable"],
      competencyTag: "reading-comfort",
    },
    {
      id: "g-q5",
      prompt: `Describe a question about ${subject} you would like to be able to answer by the end of this journey.`,
      kind: "open",
      competencyTag: "goal-clarity",
    },
    {
      id: "g-q6",
      prompt: `Which adjacent area do you think relates most to ${subject}?`,
      kind: "open",
      competencyTag: "adjacent-knowledge",
    },
  ];
}

const GENERIC_COMPETENCIES: Competency[] = [
  { competency: "foundational-vocabulary", estimatedLevel: 2, confidence: 0.6 },
  { competency: "core-concept-understanding", estimatedLevel: 1, confidence: 0.6 },
  { competency: "applied-experience", estimatedLevel: 0, confidence: 0.7 },
  { competency: "adjacent-knowledge", estimatedLevel: 2, confidence: 0.5 },
];

export class MockKnowledgeProbe implements KnowledgeProbe {
  private lastSubject: ParsedSubject | null = null;

  async questions(
    subject: ParsedSubject,
    _outcome: CanDoStatement[],
  ): Promise<ProbeQuestion[]> {
    void _outcome;
    this.lastSubject = subject;
    if (isLinearAlgebraSubject(subject.canonicalName)) {
      return LINEAR_ALGEBRA_QUESTIONS;
    }
    return genericQuestions(subject.canonicalName);
  }

  async score(answers: ProbeAnswer[]): Promise<Competency[]> {
    void answers;
    if (this.lastSubject && isLinearAlgebraSubject(this.lastSubject.canonicalName)) {
      return LINEAR_ALGEBRA_COMPETENCIES;
    }
    // If questions() was never called (e.g., scoring fed in directly), inspect
    // answers to decide which fixed map to return.
    const looksLikeLinearAlgebra = answers.some((a) => a.questionId.startsWith("la-"));
    return looksLikeLinearAlgebra ? LINEAR_ALGEBRA_COMPETENCIES : GENERIC_COMPETENCIES;
  }
}
