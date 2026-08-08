/**
 * Designed-tier artifact corpus for the human-free judge-validation study.
 *
 * WHY THIS EXISTS
 * The thesis (ch.6 §6.2) marks the CheckpointEvaluator calibration study as
 * PENDING because it was specified as a dual-rating study against a human
 * rater. No human rater is available. This corpus replaces the human ground
 * truth with a CONSTRUCTED ground truth: for each goalpost we author four
 * artifacts at deliberately separated quality tiers, written directly against
 * the rubric's own level descriptors.
 *
 * WHAT THIS BUYS AND WHAT IT DOES NOT
 * A judge that cannot recover a designed ordering is definitely not valid, so
 * tier recovery is a NECESSARY condition. It is NOT a sufficient one: the tier
 * labels are author-assigned with the rubric in hand, so recovering them does
 * not show the judge agrees with an independent expert, nor that the artifacts
 * resemble real learner writing. This limitation is reported, not hidden.
 *
 * TIERS (chosen to map onto the rubric's own 0-4 anchors)
 *   T0 - off-topic or non-answer. Rubric expectation: mostly 0-1.
 *   T1 - recognition only: restates definitions, no mechanism, no why.
 *   T2 - proficient: correct mechanism in own words with an example.
 *   T3 - mastery: mechanism, causal why, transfer, and boundary conditions.
 *
 * Domains deliberately span technical and "soft" subjects, because ch.6 §6.7
 * names soft domains as an acknowledged weak spot. If the judge discriminates
 * worse there, the study should show it.
 */

export interface Scenario {
  id: string;
  domain: "technical" | "soft";
  goalpostTitle: string;
  goalpostObjective: string;
  /** The "information" half of the goalpost: what the learner read. */
  informationContent: string;
  /** The closed-book experience prompt the artifact answers. */
  experiencePrompt: string;
  /** Designed-tier artifacts, index = tier 0..3. */
  artifacts: [string, string, string, string];
  /**
   * Correct term -> plausible-but-wrong term. Drives the deterministic
   * `term_corrupt` perturbation. Ordered longest-first at apply time so a
   * longer phrase is not clobbered by a shorter overlapping key.
   */
  termSwaps: Array<[string, string]>;
  /**
   * Concrete specifics (numbers, named entities, exact quantities) present in
   * the T3 artifact. Drives the deterministic `despecify` perturbation.
   */
  specifics: string[];
  /** Reference answer for the retrieval-similarity baseline (ALT-C). */
  referenceAnswer: string;
}

export const SCENARIOS: Scenario[] = [
  {
    id: "binary-search",
    domain: "technical",
    goalpostTitle: "Binary search on a sorted array",
    goalpostObjective:
      "Explain how binary search locates a value in a sorted array, why the sorted precondition is required, and state its time complexity with a justification.",
    informationContent:
      "Binary search finds a target value in a sorted array by repeatedly halving the search interval. It compares the target to the middle element: if they are equal the search ends; if the target is smaller the search continues in the left half; if larger, in the right half. Each comparison discards half of the remaining candidates. Because the array is sorted, a single comparison against the midpoint is enough to decide which half can contain the target, and the other half can be discarded without inspecting it. Starting from n candidates, after k halvings there are n / 2^k candidates left, so the search terminates after about log2(n) comparisons, giving O(log n) time. Linear search, by contrast, inspects elements one at a time and runs in O(n).",
    experiencePrompt:
      "Without looking back at the material, explain in your own words how binary search finds a value in a sorted array, why the array has to be sorted for it to work, and what its time complexity is and why.",
    artifacts: [
      "I think this is about searching for stuff on a computer. Computers are really fast these days so they can find things almost instantly. If I wanted to find something I would probably just use the search bar or a loop of some kind. Sorting is when you put things in order, like alphabetical. I am not sure how the two connect.",
      "Binary search is an algorithm that searches a sorted array. It works by dividing the array in half each time. The array has to be sorted for binary search to work. Its time complexity is O(log n), which is faster than linear search which is O(n). Binary search is used a lot in computer science because it is efficient.",
      "Binary search works by looking at the middle element of the array and comparing it to the value you want. If the middle element is bigger than your target, you know the target must be in the left half, so you throw away the right half and repeat on what is left. If it is smaller you throw away the left half instead. You keep halving until you either land on the value or run out of elements. For example, searching for 7 in [1, 3, 5, 7, 9, 11, 13]: the middle is 7, so you find it immediately. Searching for 3 instead, the middle is 7, 3 is smaller, so you only keep [1, 3, 5], whose middle is 3. The array must be sorted because the whole trick is that one comparison against the middle tells you which side the target is on. In an unsorted array a comparison against the middle tells you nothing about the rest. The time complexity is O(log n) because each step cuts the number of remaining candidates in half.",
      "The mechanism is interval halving. You keep a lo and hi boundary around the part of the array that could still contain the target, look at the midpoint, and use one comparison to decide which side to keep. If the midpoint equals the target you stop; if the target is smaller you move hi to just left of the midpoint; if larger you move lo to just right. The interval shrinks until it is empty, which means the target is absent. The sorted precondition is doing all the work here, and it is worth being precise about why: sortedness is what makes a single comparison at the midpoint informative about every element you are about to discard. In a sorted array, if the target is less than the midpoint, then by transitivity it is less than every element to the right, so the entire right half can be eliminated without being touched. Remove sortedness and that inference collapses, because knowing the target is less than one arbitrary element says nothing about the others, and you are forced back to inspecting every element, which is exactly linear search at O(n). The complexity follows from counting halvings rather than from memorising it. You start with n candidates and each iteration leaves n / 2 of them, so after k iterations you have n / 2^k. The loop ends when that reaches 1, so 2^k = n and k = log2(n). Constant work per iteration times log2(n) iterations gives O(log n). The same halving idea transfers directly to guessing a number in a range and to finding the insertion point for a new element, and it generalises to any monotone predicate over an ordered domain, which is why binary search over the answer space works for optimisation problems that are not obviously searches at all. It is worth naming where it does NOT apply: on a linked list, because you cannot reach the midpoint in constant time and the log2(n) comparisons cost O(n) traversal anyway; and on data that is sorted by a key other than the one you are querying, where the array is sorted but not with respect to your comparison, so the halving inference is invalid even though the data looks ordered.",
    ],
    termSwaps: [
      ["sorted", "unsorted"],
      ["midpoint", "first element"],
      ["middle element", "last element"],
      ["half", "third"],
      ["O(log n)", "O(n^2)"],
      ["log2(n)", "n^2"],
      ["transitivity", "coincidence"],
    ],
    specifics: [
      "n / 2^k",
      "2^k = n",
      "k = log2(n)",
      "O(log n)",
      "O(n)",
      "log2(n)",
      "lo and hi",
    ],
    referenceAnswer:
      "Binary search keeps a lo/hi interval over the part of a sorted array that can still contain the target, compares the target to the midpoint, and discards the half that cannot contain it. Sortedness is required because it makes one midpoint comparison informative about every discarded element by transitivity; without it the inference fails and you are back to linear search. Each iteration halves the candidate count, so after k iterations n / 2^k remain, terminating at k = log2(n), giving O(log n). It does not apply to linked lists (no constant-time midpoint access) or to data sorted on a different key.",
  },

  {
    id: "database-3nf",
    domain: "technical",
    goalpostTitle: "Third normal form in relational database design",
    goalpostObjective:
      "Explain what third normal form requires, which anomaly it removes, and demonstrate decomposing a table that violates it.",
    informationContent:
      "A relation is in third normal form (3NF) when it is in second normal form and no non-key attribute is transitively dependent on the primary key. A transitive dependency exists when a non-key attribute determines another non-key attribute. For example, in Order(order_id, customer_id, customer_city), customer_id determines customer_city, and customer_id is not the key, so customer_city depends on the key only transitively through customer_id. This causes update anomalies: a customer's city is repeated on every one of their orders, so changing it requires updating many rows and risks leaving inconsistent copies. It also causes insertion anomalies (a customer with no orders cannot be recorded) and deletion anomalies (deleting the last order loses the city). The fix is decomposition: split the offending attributes into their own relation keyed by their real determinant, here Customer(customer_id, customer_city), leaving Order(order_id, customer_id) with a foreign key.",
    experiencePrompt:
      "Without looking back at the material, explain what third normal form requires and which problem it solves, then take a table of your own choosing that violates it and show how you would decompose it.",
    artifacts: [
      "Databases store data in tables with rows and columns. Normal form sounds like it means the data is normal or standard. I know SQL is used to query databases and you can use SELECT to get data out. I think there are several normal forms numbered one to three or maybe more but I do not remember what they require.",
      "Third normal form means a table is in second normal form and there are no transitive dependencies on the primary key. A transitive dependency is when a non-key attribute determines another non-key attribute. 3NF removes update anomalies. To fix a violation you decompose the table into two tables. This is part of database normalization which is important for good database design.",
      "3NF says that once you are already in 2NF, no non-key column is allowed to depend on the key only indirectly, through another non-key column. So if column A is the key and it determines B, and B in turn determines C, then C is transitively dependent and the table is not in 3NF. The problem it fixes is redundancy leading to update anomalies: the same fact gets stored many times, and if you update one copy and miss another the database contradicts itself. Take a table Employee(emp_id, dept_id, dept_name). emp_id is the key and determines dept_id, but dept_id determines dept_name, so dept_name is transitively dependent. If the Engineering department is renamed, every employee row in that department has to be updated. To decompose, I split out Department(dept_id, dept_name) and leave Employee(emp_id, dept_id) with dept_id as a foreign key. Now the department name is stored exactly once.",
      "3NF requires that a relation already be in 2NF and that every non-key attribute depend on the key directly rather than through another non-key attribute. Stated as the usual slogan, every non-key attribute depends on the key, the whole key, and nothing but the key, where 3NF is specifically the nothing-but-the-key clause. The precise condition is that for every functional dependency X to Y that holds, either X is a superkey or Y is a prime attribute. The anomaly it removes is a redundancy anomaly with three distinct faces, and separating them matters because they fail at different times. The update anomaly is that a fact stored in many rows can be changed in some and not others, so the database can hold two contradictory answers to the same question. The insertion anomaly is that a fact cannot be recorded until an unrelated row exists to hang it on. The deletion anomaly is the mirror image, where removing the last row that happens to carry a fact destroys the fact itself. Concretely, take Enrollment(student_id, course_id, instructor_id, instructor_office). The key is the composite student_id plus course_id. instructor_id depends on course_id, and instructor_office depends on instructor_id, and neither instructor_id nor instructor_office is prime, so instructor_office reaches the key only through two hops and the relation is not in 3NF. Every student enrolled in the same course duplicates the instructor's office. Moving an instructor to a new office means touching one row per enrolled student, and an instructor with no current enrolments cannot have an office recorded at all. The decomposition follows the dependencies rather than intuition. Instructor(instructor_id, instructor_office) captures the second hop, Course(course_id, instructor_id) captures the first, and Enrollment(student_id, course_id) keeps only the genuine many-to-many fact, with foreign keys restoring the joins. The decomposition is lossless because each split is on a determinant that functionally determines the attributes moved with it, which is exactly the condition guaranteeing the natural join reconstructs the original relation. It is worth being clear about where the normalization argument stops applying, because the rule is often over-applied. 3NF is not the strongest form: it tolerates certain overlapping-candidate-key cases that BCNF forbids, so being in 3NF is not a guarantee of being anomaly-free. And normalization optimises for write consistency, not read speed. A read-heavy analytical warehouse routinely denormalises back into star schemas on purpose, accepting the update anomaly because the data is loaded in bulk and never edited in place, which is the case where the anomaly 3NF prevents simply cannot occur.",
    ],
    termSwaps: [
      ["third normal form", "first normal form"],
      ["3NF", "1NF"],
      ["2NF", "5NF"],
      ["transitive", "direct"],
      ["non-key", "key"],
      ["lossless", "lossy"],
      ["superkey", "foreign key"],
      ["BCNF", "2NF"],
    ],
    specifics: [
      "Enrollment(student_id, course_id, instructor_id, instructor_office)",
      "Instructor(instructor_id, instructor_office)",
      "Course(course_id, instructor_id)",
      "Enrollment(student_id, course_id)",
      "X to Y",
      "BCNF",
    ],
    referenceAnswer:
      "Third normal form requires a relation to be in 2NF with no non-key attribute transitively dependent on the key: for every functional dependency X to Y, X is a superkey or Y is prime. It removes redundancy anomalies of update, insertion and deletion. A violating table such as Enrollment(student_id, course_id, instructor_id, instructor_office) is decomposed along its determinants into Instructor(instructor_id, instructor_office), Course(course_id, instructor_id) and Enrollment(student_id, course_id), which is lossless because each split is on a determinant. 3NF is weaker than BCNF, and denormalization is deliberate in read-heavy analytical schemas.",
  },

  {
    id: "photosynthesis-light",
    domain: "technical",
    goalpostTitle: "The light-dependent reactions of photosynthesis",
    goalpostObjective:
      "Explain where the light-dependent reactions occur, what they consume and produce, and how the proton gradient drives ATP synthesis.",
    informationContent:
      "The light-dependent reactions take place in the thylakoid membranes of the chloroplast. Photons excite electrons in the chlorophyll of photosystem II. The lost electrons are replaced by splitting water, which releases oxygen as a by-product and deposits protons inside the thylakoid lumen. Excited electrons travel down an electron transport chain to photosystem I, and the energy released is used to pump additional protons from the stroma into the lumen. This builds a proton concentration gradient across the thylakoid membrane. Protons flow back into the stroma through ATP synthase, and that flow drives the enzyme to phosphorylate ADP into ATP, a process called chemiosmosis. At photosystem I a second photon re-energises the electrons, which reduce NADP+ to NADPH. The ATP and NADPH produced are then consumed by the Calvin cycle in the stroma.",
    experiencePrompt:
      "Without looking back at the material, explain where the light-dependent reactions happen, what goes in and what comes out, and how the proton gradient ends up producing ATP.",
    artifacts: [
      "Photosynthesis is how plants make food from sunlight. Plants are green because of chlorophyll. They take in carbon dioxide and give out oxygen which is good for us. It happens in the leaves. I think water is involved too because plants need watering. That is why we should protect forests.",
      "The light-dependent reactions happen in the thylakoid membrane of the chloroplast. They use light energy and water and produce ATP, NADPH and oxygen. There is an electron transport chain and photosystem II and photosystem I. A proton gradient is formed and ATP synthase makes ATP. The products go to the Calvin cycle.",
      "These reactions run in the thylakoid membranes inside the chloroplast. Light hits photosystem II and knocks electrons out of chlorophyll. Those electrons have to be replaced, and the plant replaces them by splitting water, which is where the oxygen we breathe comes from and also dumps protons inside the thylakoid space. The electrons then move along the electron transport chain toward photosystem I, and as they drop in energy that energy is used to pump more protons from the stroma into the lumen. So you end up with a lot more protons inside the thylakoid than outside. That difference is stored energy, like water held behind a dam. Protons then flow back out through ATP synthase, and that flow physically drives the enzyme to stick a phosphate onto ADP and make ATP. Meanwhile at photosystem I another photon re-energises the electrons so they can reduce NADP+ into NADPH. Inputs are light, water and NADP+ and ADP; outputs are ATP, NADPH and oxygen, and the ATP and NADPH go on to the Calvin cycle.",
      "Location first, because the location is the mechanism here. The light-dependent reactions run in the thylakoid membrane, and what matters is that the thylakoid encloses a separate compartment, the lumen, distinct from the surrounding stroma. Without that enclosed compartment there is nothing to build a gradient across and the whole scheme fails, which is why these reactions cannot simply happen in solution. The inputs are photons, water, ADP with inorganic phosphate, and NADP+; the outputs are ATP, NADPH, and oxygen as a by-product. Tracing the path, a photon excites a chlorophyll electron in photosystem II to an energy high enough to leave. Photosystem II is now electron-deficient and is a strong enough oxidant to strip electrons from water, which is the only reason an organism can use water as an electron source at all. Splitting two water molecules yields four electrons, four protons released into the lumen, and one molecule of oxygen. The excited electrons then pass down the electron transport chain through plastoquinone, the cytochrome b6f complex and plastocyanin to photosystem I, losing energy at each handoff, and the cytochrome complex uses that released energy to pump additional protons from the stroma into the lumen. Two mechanisms therefore load the lumen with protons, water splitting inside it and active pumping into it, while proton consumption at photosystem I removes them from the stroma, so the gradient is steepened from both sides and the lumen becomes markedly acidic relative to the stroma. The gradient is the actual energy currency at this stage, and the key idea is that the membrane is impermeable to protons except through one channel. The electrochemical gradient combines a concentration difference and a charge difference, together the proton-motive force. The only route back to the stroma is the ATP synthase channel, so protons flowing down their gradient must pass through it, mechanically rotating the enzyme's rotor and driving conformational changes in the catalytic head that condense ADP and phosphate into ATP. This is chemiosmosis, and the crucial conceptual point is that light energy is never converted directly into ATP; it is first converted into a gradient, and the gradient is then cashed in. At photosystem I a second photon re-excites the arriving electrons, which are handed to ferredoxin and then via NADP+ reductase to NADP+, forming NADPH. The reason two photosystems are needed in series rather than one is that no single photon carries enough energy to lift an electron all the way from water to NADP+, so the Z-scheme raises it in two stages. The same chemiosmotic principle transfers directly to mitochondrial oxidative phosphorylation, which builds a gradient across the inner mitochondrial membrane and cashes it through the same class of enzyme, and to the proton-motive force driving bacterial flagellar rotation, which shows the gradient is a general energy currency and not a photosynthesis-specific trick. The boundary condition is instructive: an uncoupler such as dinitrophenol makes the membrane permeable to protons, and electron transport then continues at full rate while ATP production stops entirely, which is the cleanest evidence that it is the gradient rather than the electron flow that makes the ATP.",
    ],
    termSwaps: [
      ["thylakoid", "ribosomal"],
      ["stroma", "nucleus"],
      ["lumen", "cytoplasm"],
      ["photosystem II", "photosystem IV"],
      ["ATP synthase", "DNA polymerase"],
      ["chemiosmosis", "osmosis"],
      ["NADPH", "glucose"],
      ["protons", "neutrons"],
    ],
    specifics: [
      "plastoquinone",
      "cytochrome b6f",
      "plastocyanin",
      "ferredoxin",
      "NADP+ reductase",
      "four electrons",
      "Z-scheme",
      "dinitrophenol",
      "proton-motive force",
    ],
    referenceAnswer:
      "The light-dependent reactions occur in the thylakoid membrane, which encloses the lumen as a compartment separate from the stroma. Inputs are photons, water, ADP with phosphate, and NADP+; outputs are ATP, NADPH and oxygen. Photons excite photosystem II electrons; water splitting replaces them, releasing oxygen and protons into the lumen. Electrons pass down the transport chain to photosystem I while the cytochrome complex pumps more protons into the lumen, creating a proton-motive force. Protons return only through ATP synthase, mechanically driving ADP phosphorylation, which is chemiosmosis. Light energy becomes a gradient first and ATP second. The same principle operates in mitochondrial oxidative phosphorylation.",
  },

  {
    id: "opportunity-cost",
    domain: "soft",
    goalpostTitle: "Opportunity cost in economic decision-making",
    goalpostObjective:
      "Explain what opportunity cost is, why it is measured against the next-best forgone alternative, and apply it to a decision.",
    informationContent:
      "Opportunity cost is the value of the next-best alternative that is given up when a choice is made. It is not the sum of all alternatives forgone, only the single best one, because you could only have taken one of them anyway. Opportunity cost includes implicit costs (the forgone wage of running your own business rather than taking a job) as well as explicit money outlays. Economic profit subtracts both explicit and implicit costs from revenue, whereas accounting profit subtracts only explicit costs, which is why a business can be accounting-profitable and economically unprofitable at the same time. Sunk costs, money already spent and unrecoverable, carry no opportunity cost and should be excluded from forward-looking decisions, because no future choice can recover them.",
    experiencePrompt:
      "Without looking back at the material, explain what opportunity cost is and why it is defined against the next-best alternative rather than all alternatives, then apply it to a real decision.",
    artifacts: [
      "Cost is how much something costs in money. Opportunity means a chance to do something. So opportunity cost might be the cost of taking an opportunity, like how much you pay for it. Economics is about money and markets and supply and demand. I would need to look this up to say more.",
      "Opportunity cost is the value of the next-best alternative you give up when you make a choice. It is measured against the next-best alternative and not all of them. It includes implicit costs as well as explicit costs. Economic profit accounts for opportunity cost while accounting profit does not. Sunk costs should be ignored.",
      "Opportunity cost is what you give up by choosing one thing over another, specifically the value of the single best option you did not take. The reason it is only the next-best one and not the total of everything else is simple once you see it: you were only ever going to be able to pick one option, so you only actually lost one. Adding up all the roads not taken would double-count losses you were never in a position to avoid. It matters because it forces you to count things that never appear on a receipt. If I spend a Saturday building a piece of furniture myself, the real cost is not just the wood, it is also the day of freelance work I could have done instead. Applying it: I am deciding whether to do a paid internship at 1000 euros a month or spend the summer building my own project. The explicit cost of the project is small, maybe server bills. But the opportunity cost is the 1000 euros a month plus the experience the internship would have given me. So the project has to be worth more than that to me for it to be the right call, and comparing it only against the server bills would badly understate what it costs.",
      "Opportunity cost is the value of the single next-best alternative forgone when a choice is made, and the whole content of the concept sits in three words of that definition that are easy to skim past. Value rather than price, because the measure is what the alternative was worth to the decision-maker, not what it was listed at. Next-best rather than all, and single rather than aggregate. The next-best restriction is not an accounting convention, it follows from what a choice is. Alternatives are mutually exclusive by construction, so at the moment of choosing, exactly one alternative was actually available to be taken instead. Summing every rejected option would count losses that were never simultaneously achievable, and it would produce the absurd result that the cost of a decision rises simply because more irrelevant options were listed, which would make the measure depend on how the choice set happened to be described rather than on anything real. The concept earns its keep by making invisible costs visible, which is where naive accounting goes wrong. Explicit costs are money that changes hands and lands on a receipt. Implicit costs are resources already owned and consumed by the choice, which generate no transaction and therefore no record. A founder who pays herself nothing records no wage expense, but the salary she could have earned elsewhere is consumed by the venture just as surely as rent is. This is precisely the gap between accounting profit, which subtracts only explicit costs, and economic profit, which subtracts both, and it explains the otherwise paradoxical situation of a business that is accounting-profitable and economically loss-making at the same time, meaning its owner would be better off doing something else with the same resources. Applying it to a decision I actually face: continuing a bachelor project into a journal submission versus taking contract work at roughly 25 euros an hour. The explicit cost of the paper is close to zero, some API spend. The opportunity cost is the contract income forgone for however many hours the paper takes, plus the next-best non-paid use of those hours. At 80 hours that is 2000 euros of forgone income, and the honest question is whether the credential and the skill are worth more than 2000 euros to me, not whether the paper is worth its API bill. Note the direction the logic runs, because this is where the concept is most often misapplied: the six months already spent on the project are irrelevant to that comparison. They are sunk, unrecoverable, and identical under both branches, so including them cannot change which branch is better and can only bias me toward continuing something because I have already paid for it. Opportunity cost is strictly forward-looking. The boundary of the concept is worth naming too. It presumes the alternative was genuinely available and that its value can be estimated; where the next-best option is unknown or unquantifiable, opportunity cost remains conceptually correct but operationally unusable, and treating a fabricated estimate as data is worse than admitting the comparison cannot be made precisely.",
    ],
    termSwaps: [
      ["next-best", "worst"],
      ["forgone", "gained"],
      ["implicit", "explicit"],
      ["economic profit", "gross revenue"],
      ["accounting profit", "net margin"],
      ["sunk", "recoverable"],
      ["mutually exclusive", "independent"],
    ],
    specifics: [
      "25 euros an hour",
      "80 hours",
      "2000 euros",
      "six months",
      "accounting profit",
      "economic profit",
    ],
    referenceAnswer:
      "Opportunity cost is the value of the single next-best alternative forgone when a choice is made. It is the next-best rather than the sum of all alternatives because alternatives are mutually exclusive, so only one was actually available instead; summing them would count losses that were never simultaneously avoidable. It captures implicit costs such as forgone wages alongside explicit outlays, which is the difference between accounting profit and economic profit and why a business can be accounting-profitable yet economically loss-making. Sunk costs are excluded because they are unrecoverable and identical across branches, so opportunity cost is strictly forward-looking.",
  },

  {
    id: "art-nouveau",
    domain: "soft",
    goalpostTitle: "The characteristics of Art Nouveau",
    goalpostObjective:
      "Identify the defining formal characteristics of Art Nouveau, explain what the movement was reacting against, and recognise it in a specific work.",
    informationContent:
      "Art Nouveau flourished roughly from 1890 to 1910 across Europe and the United States. Its defining formal traits are the whiplash line, a long asymmetric curve derived from plant stems; motifs taken from nature such as vines, irises and dragonflies; flowing organic forms in place of rectilinear structure; and stylised female figures with elaborate flowing hair. The movement was a deliberate reaction against the historicism of nineteenth-century academic design, which recycled Greek, Gothic and Renaissance forms, and against the visual poverty of early mass-produced industrial goods. It sought a total work of art in which architecture, furniture, glass, ironwork and graphics were designed as one integrated scheme, and it refused the hierarchy separating fine art from decorative art. Key figures include Alphonse Mucha in graphics, Victor Horta and Antoni Gaudi in architecture, Louis Comfort Tiffany in glass and Rene Lalique in jewellery.",
    experiencePrompt:
      "Without looking back at the material, describe what visually identifies a work as Art Nouveau, explain what the movement was pushing back against, and then identify it in a specific work you know.",
    artifacts: [
      "Art Nouveau sounds French so it is probably French art. Nouveau means new. Art movements include impressionism and cubism and surrealism. I think there were a lot of paintings in that period. Art is subjective so different people see different things in it. I would need to see examples to say what it looks like.",
      "Art Nouveau was an art movement from around 1890 to 1910. It is characterised by the whiplash line, natural motifs like flowers and plants, organic flowing forms, and stylised women with long hair. It was a reaction against historicism and industrial mass production. Important artists include Alphonse Mucha, Victor Horta, Antoni Gaudi and Louis Comfort Tiffany.",
      "What identifies a work as Art Nouveau is mostly the line. There is a particular long, asymmetric, whip-like curve that runs through everything, and it clearly comes from looking at plant stems rather than from geometry. Alongside that you get nature motifs everywhere, vines and irises and insects, and a general refusal to use straight lines and right angles where a curve could go instead. Female figures show up constantly, stylised, with hair that turns into the decorative pattern itself. What it was pushing back against was two things. One was historicism, the nineteenth-century habit of designing new buildings by copying Greek or Gothic templates, which Art Nouveau designers saw as having nothing to say about their own moment. The other was the ugliness of early industrial mass production. Their answer was to design everything, the building, the staircase, the door handles, the furniture, as one coherent scheme. A specific work: Mucha's poster of Sarah Bernhardt for Gismonda. The elongated vertical format, the woman framed by an arch of stylised ornament, the hair and drapery flowing into the border pattern rather than stopping at an edge, and the muted palette are all recognisably Art Nouveau.",
      "The identifying trait is the line before anything else. Art Nouveau is organised around the whiplash curve, a long asymmetric line with a sudden change of direction near its end, and the important thing about it is where it comes from: it is derived from observed plant growth, from stems and tendrils under tension, not from compass geometry. That single derivation explains most of the other features, because if your generating principle is organic growth then straight lines and right angles become foreign to the vocabulary, structure starts to look grown rather than assembled, and the ornament stops sitting on top of the object and becomes the object's own form. Hence the nature motifs, irises, vines, peacock feathers, dragonflies, and hence the stylised female figure whose hair dissolves into the surrounding pattern so that figure and ornament are not separable. There is also a strong tendency for a work to have no clear frame edge, with the composition bleeding into its own border. What it reacted against is best understood as two refusals that share a root. The first is historicism: nineteenth-century academic design answered the question of what a new building should look like by selecting a historical style from a catalogue, Greek for a bank, Gothic for a church. Art Nouveau treated that as an abdication, an admission that the present had no form of its own, and set out to invent a genuinely contemporary vocabulary owing nothing to revival. The second is the visual squalor of early industrial mass production, an objection inherited directly from Ruskin and the Arts and Crafts movement. The shared root of both refusals is a conviction that form should arise from a principle rather than be selected from precedent. This is what motivates the Gesamtkunstwerk ambition, the total work of art in which building, ironwork, glass, furniture and even the door handles are one integrated design, and the parallel refusal of the hierarchy that ranked painting above the decorative arts, since a movement whose principle is that ornament and structure are the same thing cannot coherently maintain that distinction. Taking a specific work, Victor Horta's Hotel Tassel in Brussels of 1893. The exposed iron column in the stairwell is not clad to hide that it is industrial metal; it is left visible and its capital unfurls into tendrils, so the whiplash line is doing structural work rather than decorating it, and the same curve then propagates into the mosaic floor, the painted wall, and the banister so that no element is separable from the scheme. That is the argument of the movement compressed into one interior. It is worth marking where the label stops being useful, because Art Nouveau is frequently over-extended. Its own successor, Art Deco, is often confused with it and is close to its opposite in principle: Deco is geometric, symmetrical, machine-referencing and rectilinear, and its arrival marks the point where designers stopped rejecting the machine aesthetic and started celebrating it. The contemporaneous Vienna Secession is the harder boundary case, since Klimt is routinely filed under Art Nouveau, and it is genuinely transitional, but the Secession's drift toward the rectilinear grid in Hoffmann and Moser is already moving away from the organic generating principle, so treating the whole Secession as Art Nouveau blurs exactly the distinction that makes the term mean anything.",
    ],
    termSwaps: [
      ["whiplash", "straight"],
      ["organic", "geometric"],
      ["asymmetric", "symmetrical"],
      ["historicism", "modernism"],
      ["Art Deco", "Art Nouveau"],
      ["1890", "1650"],
      ["curve", "right angle"],
    ],
    specifics: [
      "Hotel Tassel",
      "Brussels",
      "1893",
      "Ruskin",
      "Gesamtkunstwerk",
      "Vienna Secession",
      "Hoffmann and Moser",
      "Art Deco",
    ],
    referenceAnswer:
      "Art Nouveau is identified first by the whiplash line, a long asymmetric curve derived from observed plant growth rather than geometry, which in turn explains its organic forms, nature motifs of vines, irises and dragonflies, stylised female figures whose hair merges into the ornament, and its avoidance of the right angle. It reacted against nineteenth-century historicism, which selected styles from historical precedent, and against the ugliness of early industrial mass production, pursuing instead a Gesamtkunstwerk in which architecture, ironwork, glass and furniture form one scheme and the fine/decorative hierarchy is refused. Horta's Hotel Tassel of 1893 exemplifies it. Art Deco is its geometric, machine-celebrating opposite.",
  },

  {
    id: "lean-seven-wastes",
    domain: "soft",
    goalpostTitle: "The seven wastes (muda) in lean manufacturing",
    goalpostObjective:
      "Name the seven wastes, explain the value-based criterion that defines waste, and apply the analysis to a real process.",
    informationContent:
      "In the Toyota Production System, muda means waste: any activity that consumes resources without creating value for the customer. Value is defined from the customer's point of view, so the test for waste is whether the customer would be willing to pay for the activity. The seven classical wastes are transport (unnecessary movement of materials), inventory (stock held beyond immediate need), motion (unnecessary movement of people), waiting (idle time between steps), overproduction (making more or sooner than demanded), overprocessing (doing more work or to a higher specification than required), and defects (work that must be corrected or scrapped). Overproduction is regarded as the most serious because it generates the others: goods made early must be transported, stored as inventory, and often become defective while waiting. Some activities are non-value-adding but currently necessary, such as regulatory inspection; these are distinguished from pure waste and targeted for reduction rather than elimination.",
    experiencePrompt:
      "Without looking back at the material, name the seven wastes, explain how you decide whether something counts as waste at all, and then apply the analysis to a process you actually know.",
    artifacts: [
      "Waste is when you throw things away and it is bad for the environment. Manufacturing is making products in factories. Lean probably means using less of something. Companies want to be efficient to save money. Recycling helps reduce waste. I do not know the seven types.",
      "The seven wastes in lean manufacturing are transport, inventory, motion, waiting, overproduction, overprocessing and defects. Muda is the Japanese word for waste. Waste is anything that does not add value for the customer. Overproduction is considered the worst waste. Lean comes from the Toyota Production System.",
      "The seven wastes are transport, inventory, motion, waiting, overproduction, overprocessing and defects. The way you decide whether something is waste is to ask whether the customer would pay for it if they could see it. Moving a part across the factory does not make the part better, so the customer would not pay for that, so it is waste. Actually machining the part is what they are paying for. Overproduction is usually singled out as the worst one because it causes the others: if you make things before they are needed you then have to move them, store them, and they can get damaged or go obsolete while they sit there. Applying it to something I know, a university group project. Waiting is the big one, everyone blocked on one person's section. Overprocessing shows up as polishing slides nobody will look closely at. Inventory is half-finished documents sitting in a shared folder. Defects are the rework when two people wrote conflicting sections. Motion is switching between five different tools to find where something was discussed.",
      "The seven wastes are transport, inventory, motion, waiting, overproduction, overprocessing and defects. Reciting the list is the easy part, and the list on its own is close to useless without the criterion that generates it, so the criterion is worth stating first. Muda is any activity that consumes resources without creating value, and value is defined strictly from the customer's standpoint, which makes the operational test whether an informed customer, watching the activity, would agree to pay for it. That external referent is what stops waste analysis collapsing into whatever the people inside the process happen to find annoying. A three-way classification follows from applying it honestly. Value-adding activity transforms the product toward what the customer wants and is what they are actually buying. Pure waste fails the test and can be removed outright. Necessary non-value-adding activity also fails the customer-payment test but cannot currently be removed, typically because of a regulatory, safety or contractual constraint, and the correct response is to minimise it while being honest that it is not adding value, rather than reclassifying it as valuable because removing it is inconvenient. Collapsing the second and third categories is the most common failure of a waste-walk and produces a list nobody acts on. Overproduction deserves its usual designation as the worst waste, and the reason is structural rather than a matter of degree: it is the only waste that generates the other six. Output produced before it is demanded must be moved, which is transport; it must be held, which is inventory; it occupies the space and attention that create motion; it ages and deteriorates into defects; and because it hides the true rate of demand it disguises the waiting that would otherwise be visible. Attacking any of the downstream six while overproduction continues means treating symptoms, which is exactly why pull-based scheduling through kanban is the structural fix rather than a storage or logistics improvement. Applying it to a process I genuinely run, preparing an academic evaluation study. Waiting is the dominant waste and it is largely self-inflicted, sitting idle while a long API-backed run completes when the analysis code for its output could have been written in parallel. Inventory appears as intermediate result files generated and never read, each of which cost compute and attention to produce. Overproduction is the sharpest one and it is the root of the others in exactly the way the theory predicts: running more experimental conditions than the write-up will report means every surplus condition then has to be stored, re-run when a format changes, and checked for defects, so the surplus generates transport, inventory and rework downstream of itself. Defects are the re-runs caused by discovering a parameter was wrong only after a batch finished. Overprocessing is formatting intermediate output that only I will ever read. Transport is the least applicable, which is worth saying rather than forcing a match, and this is where the framework's boundary shows: the seven wastes were derived from physical material flow, and transport and motion translate weakly to knowledge work where moving information is nearly free. The honest move is to note the poor fit rather than to invent an instance, and it is the reason later practitioners proposed an eighth waste, unused human potential, precisely because the original seven miss the failure mode that dominates non-manufacturing work.",
    ],
    termSwaps: [
      ["overproduction", "underproduction"],
      ["waste", "value"],
      ["customer", "manager"],
      ["muda", "kaizen"],
      ["pull-based", "push-based"],
      ["kanban", "Gantt chart"],
      ["value-adding", "cost-adding"],
    ],
    specifics: [
      "kanban",
      "pull-based scheduling",
      "eighth waste",
      "unused human potential",
      "three-way classification",
    ],
    referenceAnswer:
      "The seven wastes are transport, inventory, motion, waiting, overproduction, overprocessing and defects. Muda is any activity consuming resources without creating customer-defined value, so the operational test is whether an informed customer would pay for the activity. This yields three categories: value-adding, pure waste, and necessary non-value-adding activity such as regulatory inspection, which is minimised rather than eliminated. Overproduction is the worst waste because it structurally generates the other six, which is why pull-based kanban scheduling is the fix rather than better storage. The framework derives from physical material flow, so transport and motion translate poorly to knowledge work, motivating the proposed eighth waste of unused human potential.",
  },
];

/** Tier labels, index-aligned with Scenario.artifacts. */
export const TIER_LABELS = [
  "T0 non-answer",
  "T1 recognition",
  "T2 proficient",
  "T3 mastery",
] as const;

export const MASTERY_TIER = 3;
