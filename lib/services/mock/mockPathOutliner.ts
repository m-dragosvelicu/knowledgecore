import type {
  GoalpostPlan,
  PathOutliner,
  PathOutlinerInput,
} from "@/lib/services/types";

function isLinearAlgebraSubject(name: string): boolean {
  const lower = name.toLowerCase();
  return lower.includes("linear algebra") || lower.includes("math") || lower.includes("ml");
}

const GOALPOST_1_INFO_CONTENT = `# Vectors and dot products

A **vector** is the simplest object in linear algebra and, somewhat surprisingly, also one of the most useful in machine learning. You can think of a vector in two complementary ways: as an arrow with a direction and a length living in space, or as an ordered list of numbers. Both pictures matter, and switching fluently between them is most of the skill you are building in this goalpost.

Take a 2D vector \`v = (10, 2)\`. Geometrically it is an arrow that goes 10 units to the right and 2 units up from the origin. Numerically it is just a pair of components. Now imagine those two numbers describe a customer: the first component is dollars-per-month they spend with you, the second is how many times per month they order. Suddenly the vector is not abstract at all - it is a customer's behaviour rendered as a point in a "spend-frequency" plane. A second customer \`u = (2, 10)\` lives in a different region of that plane: low spend, high frequency. You can already feel that \`v\` and \`u\` are *different kinds* of customer even though both are 2D vectors with the same total of 12.

The **dot product** is the operation that makes that intuition rigorous. For two vectors \`v = (v1, v2)\` and \`u = (u1, u2)\`, their dot product is \`v . u = v1*u1 + v2*u2\`. That is it - multiply matching components, add them up, get a single number. The magic is in what that number means. The dot product is large and positive when the two vectors point in similar directions, near zero when they are roughly perpendicular, and negative when they point in opposing directions. Equivalently, \`v . u = |v| * |u| * cos(theta)\`, where \`theta\` is the angle between them. This is the bridge between the "list of numbers" picture and the "arrow in space" picture: an algebraic sum encodes a geometric angle.

Worked micro-example one. Let \`v = (10, 2)\` and \`u = (2, 10)\` (our two customers from above). Compute \`v . u = 10*2 + 2*10 = 20 + 20 = 40\`. Now compute \`v . v = 10*10 + 2*2 = 104\` and \`u . u = 2*2 + 10*10 = 104\`. The dot product of \`v\` with itself is the squared length of \`v\`, which gives \`|v| = sqrt(104) ~ 10.2\`. The same for \`u\`. So the cosine of the angle between \`v\` and \`u\` is \`40 / (10.2 * 10.2) ~ 0.385\`, which corresponds to an angle of about 67 degrees. The two customers are *somewhat* similar but clearly distinct - exactly what we suspected by eye.

Worked micro-example two. Add a third customer \`w = (9, 3)\`. Compute \`v . w = 10*9 + 2*3 = 96\` and \`|w| = sqrt(81 + 9) = sqrt(90) ~ 9.49\`. The cosine between \`v\` and \`w\` is \`96 / (10.2 * 9.49) ~ 0.992\`, an angle of just 7 degrees. Customers \`v\` and \`w\` are *almost* the same kind of customer - both spend a lot, both order rarely. The dot product, normalised by the lengths, has just given us a *similarity score*. This is precisely the trick behind cosine similarity in recommendation systems, search, and the internals of large language models.

A few practical notes before you move to the experience step. The dot product generalises cleanly to vectors of any dimension - not just 2 components but 100 or 10,000. Most of the time when machine-learning code reads \`np.dot(a, b)\` or the \`@\` operator, this is the operation being performed. The dot product is symmetric: \`v . u = u . v\`. It is linear in each argument: \`(v + w) . u = v . u + w . u\`. And it is the building block from which matrix-vector multiplication, projections, and eventually neural-network layers are constructed. You will see it again and again.

Your goal in the next step is not to memorise these facts but to actually *do* the arithmetic on a tiny example, and articulate why the answer means what it means.`;

const LINEAR_ALGEBRA_PATH: GoalpostPlan[] = [
  {
    order: 1,
    title: "Vectors and dot products",
    objective: "Understand vectors as both lists of numbers and arrows in space, and compute dot products to measure similarity.",
    estimatedMinutes: 60,
    steps: [
      {
        order: 1,
        type: "information",
        payload: { content: GOALPOST_1_INFO_CONTENT, sourceIds: [] },
      },
      {
        order: 2,
        type: "experience_applied_problem",
        payload: {
          prompt: "Here are three customers as 2D vectors: A=(10, 2), B=(2, 10), C=(9, 3). Without using a library, compute the pairwise dot products and tell me which two customers are most similar. Show your arithmetic, and in one or two sentences explain why the dot product is a reasonable measure of similarity here.",
          rubricFocus: ["application", "conceptual", "communication"],
        },
      },
    ],
  },
  {
    order: 2,
    title: "Vector spaces and linear independence",
    objective: "Recognize when a set of vectors spans a space and when one vector is redundant, building intuition for basis and dimension.",
    estimatedMinutes: 60,
    steps: [
      {
        order: 1,
        type: "information",
        payload: {
          content: "A vector space is a set of vectors closed under addition and scalar multiplication. A set of vectors is linearly independent when no vector in the set can be written as a combination of the others. Independence is what lets a small set of vectors describe an entire space without redundancy - this is the idea of a basis. In two dimensions, (1, 0) and (0, 1) form the standard basis: every 2D vector is a unique combination of those two. Add a third vector like (1, 1) and the set becomes dependent - (1, 1) = 1*(1, 0) + 1*(0, 1). Independence matters in ML because it tells you whether your features carry distinct information or whether some are just rephrasings of others.",
          sourceIds: [],
        },
      },
      {
        order: 2,
        type: "experience_applied_problem",
        payload: {
          prompt: "Decide whether each of the following sets of vectors is linearly independent. For each set, justify your answer in one or two sentences. (1) v1=(1, 2), v2=(2, 4). (2) v1=(1, 0), v2=(0, 1), v3=(3, 4). (3) v1=(1, 1, 0), v2=(0, 1, 1), v3=(1, 0, -1).",
          rubricFocus: ["application", "conceptual"],
        },
      },
    ],
  },
  {
    order: 3,
    title: "Matrix operations and gradient descent intuition",
    objective: "Multiply matrices and vectors fluently, and connect the linear-algebra machinery to the gradient-descent loop used to fit a linear-regression model.",
    estimatedMinutes: 75,
    steps: [
      {
        order: 1,
        type: "information",
        payload: {
          content: "A matrix is a stack of row vectors (or equivalently, a side-by-side arrangement of column vectors). Multiplying a matrix M by a vector x produces a new vector whose i-th entry is the dot product of the i-th row of M with x. This single operation is the workhorse of nearly all of machine learning: a linear model's prediction is just M @ x + b. To fit such a model, gradient descent computes how the loss changes with each weight, then nudges every weight a small step against the gradient. The gradient itself is a vector of partial derivatives, one per weight, and the update step is again just vector arithmetic. So linear algebra is not a *prerequisite* for understanding gradient descent - it is the language in which gradient descent is written.",
          sourceIds: [],
        },
      },
      {
        order: 2,
        type: "experience_applied_problem",
        payload: {
          prompt: "Given M = [[1, 2], [3, 4]] and x = (5, 6), compute M @ x by hand. Then explain in two or three sentences how this same operation underlies a linear-regression prediction y_hat = M @ x + b, where x is an input feature vector and M is a learned weight matrix.",
          rubricFocus: ["application", "transfer", "communication"],
        },
      },
    ],
  },
];

function genericPath(subject: string): GoalpostPlan[] {
  return [1, 2, 3].map((i) => ({
    order: i,
    title: `${subject} - Goalpost ${i}`,
    objective: `Build the foundational ${subject} skill targeted at level ${i}.`,
    estimatedMinutes: 45,
    steps: [
      {
        order: 1,
        type: "information",
        payload: {
          content: `Placeholder explainer for ${subject}, goalpost ${i}. Live services will replace this with researched content.`,
          sourceIds: [],
        },
      },
      {
        order: 2,
        type: "experience_applied_problem",
        payload: {
          prompt: `Apply what you just read about ${subject} (goalpost ${i}) to a small concrete task you can complete in under fifteen minutes. Describe what you did and what you observed.`,
          rubricFocus: ["application", "communication"],
        },
      },
    ],
  }));
}

export class MockPathOutliner implements PathOutliner {
  async outline(input: PathOutlinerInput): Promise<GoalpostPlan[]> {
    if (isLinearAlgebraSubject(input.subject.canonicalName)) {
      return LINEAR_ALGEBRA_PATH;
    }
    return genericPath(input.subject.canonicalName);
  }
}
