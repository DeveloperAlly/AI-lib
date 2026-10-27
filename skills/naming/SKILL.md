---
name: naming
description: Generate, score and choose names for any naming surface - blog post titles, blog H2/H3 headings, cover titles and subtitles, documentation headings, sidebar, step, accordion and card titles. Use whenever a title or heading is written or reviewed; it finds the best name rather than the first acceptable one.
---

# Naming

A name labels the governing concept of what it names. Find the best final name, not the most obvious or first plausible one.

**Core rule:** do not name the examples; name the concept those examples instantiate. `AI Runtime Profiles` beats `Batch vs Live Video`.

This skill works alone. Give it: the **surface** (pick a profile below), a **description** of what is being named (the section text, or the post's purpose and argument), and where relevant **pageType**, **audience** and **purpose**. Those three are constraints on language, never candidate names, and are not reinterpreted.

---

## Method

### 1. Diagnose

- Reader question:
- Primary focus:
- Secondary focus:
- Correct conceptual layer: subject, concept, category, role, process, method, path, decision, framework, policy, strategy, audience, use case, lifecycle, reference, runtime, operations, deployment, economics
- Surface labels to avoid: the literal words and examples in the text that a lazy name would copy

Choose the layer the content is actually about, not the words it uses.

### 2. Generate 12 candidates

Within the profile's length. Natural in navigation, no marketing language, no awkward compounds, no filler. Fit the pageType, purpose and audience.

### 3. Score each candidate 1-5

- **Precision**: matches the real content or purpose
- **Depth**: names the governing concept, not the visible examples
- **Stability**: still works if the section grows
- **Clarity**: a reader predicts the content from the name alone
- **Conciseness**: compact without going vague

Total /25.

### 4. Rank with penalties

Core:
- Strongly penalise literal contrast labels (`X vs Y`, `A and B`) unless the content is explicitly a comparison and the contrast is the clearest durable name.
- Penalise comparator labels that describe the act of comparing (`Workload Differences`) instead of the subject.
- Penalise generic umbrellas that are valid but miss the governing concept.
- Penalise the wrong conceptual layer (taxonomy mismatch).
- Penalise names that restate the visible examples, mirror the input wording without improving it, or are stitched together (`Batch-Live Workloads`).
- Penalise brittle numbering (`Two X`, `Three Y`) unless the number is the point.
- Prefer content descriptors, and above them governing-concept labels. Prefer mechanism, process or runtime language when that is what the content describes.

Weak labels, penalised unless genuinely accurate: **types** (only when classifying categories), **profiles** (stable groupings), **modes** (distinct operating states), **models** (frameworks or formal approaches), **overview**, **guide**, **basics/essentials/foundations** (only if explicitly introductory).

Semantic rules:
- Use every term at its real meaning. `architecture` is system structure, not runtime behaviour. `modality` only for media types. `inference` only for request-response model calls, not continuous media processing. `workload` only when it names an execution pattern.
- Prefer the field's native terminology for technical or niche subjects.
- **Domain anchor:** if the name could apply to unrelated domains, add the domain noun.
- **Conditional precision:** process → process language; decision → decision language; path → path language; role → role language; policy → requirement language; strategy → strategic language.

Label classes, worst to best: literal label → comparator label → generic descriptor → taxonomy mismatch → content descriptor → **governing-concept label**.

### 5. Winner filter

The winner must answer yes to all ten. A no on any means it does not rank first.

1. Names the real governing concept, purpose or focus, not the examples?
2. A content descriptor, not a literal label?
3. At the right conceptual layer?
4. Still works if more examples are added?
5. Understandable to someone scanning navigation?
6. Every term used at its correct meaning?
7. Fits the pageType?
8. Fits the purpose?
9. Fits the audience?
10. An expert editor's choice, not a safe generic label?

Then run the chosen profile's own checks.

### 6. Output

**Full** (default for a single name, or when asked):

```
Reader question:
Primary focus:
Secondary focus:
Correct conceptual layer:
Surface labels to avoid:

12 candidates: 1-12
Scoring: [Name] - Precision X/5, Depth X/5, Stability X/5, Clarity X/5, Conciseness X/5, Total X/25 - [one sentence]
Ranked list: 1-12
Best name:
Why it wins:
Why the obvious literal or generic name is weaker:
```

**Compact** (many names at once, such as every heading in a post): one row per name, with the current name, the top three candidates with totals, the winner and a one-line reason. Keep the full working available on request.

Never apply a name without showing the owner the winner and runners-up first.

---

## Profiles

### Blog post title

The H1, the card title, and the default search and share title.

- 3-8 words, at most 60 characters so it fits Google without a separate meta title. Title Case.
- Carries the main search keyword or domain noun. Ask: would a searcher type these words?
- May be a named concept (`Durable Agent Execution`) or a short claim (`The Frontier Is a Surface, Not a Line`). A claim must be specific enough to be wrong.
- Banned: question-stem openers (What, How, When, Where, Why, including `Why & When to ...`), listicle numbers (`7 Things`), `Ultimate`, `Definitive`, `Complete Guide`, `Everything You Need`, colon-stacked subtitles, clickbait gaps.
- Distinct from the blog's other titles: check `list_posts` for near-duplicates.
- Add a sixth axis, **Search fit** /5 (keyword present and natural), so titles total /30.

### Blog section heading (H2)

Ruling, 27 Oct 2026: H2s are concept names; H3s may carry a claim or a question.

- H2: 1-4 words, Title Case noun phrase naming the section's concept (`Crash Recovery`, `Approval Gates`). No questions, no question stems, no `The` opener, no numbering, no sentences, no gerund as the whole heading (`Building Error Logs` → `Error Logs`).
- Read top to bottom, the H2s form a coherent table of contents for the post.
- H3: either a concept name like an H2, or a short claim or reader question (`Checkpoints make crashes cheap`, `Does the node rerun on resume?`). Sentence case for claims and questions.
- Reader questions for answer engines belong in the post's FAQ, not in H2s.

### Cover title and subtitle

- Cover title: the post title or a shorter form of it, at most about 40 characters so it sits on two lines at full size.
- Subtitle: one line, at most about 60 characters, in the author's voice and taken from the post's own words. It completes the title rather than repeating it.

### Documentation heading (H1-H4)

The Livepeer v2 docs bar, and the default for any docs site. Canonical examples (`v2/orchestrators/guides/staking-and-rewards/earning-model.mdx`): `ETH Service Fees`, `LPT Inflationary Rewards`, `Commission Parameters`, `Payment Flow Summary`, `Monitoring Your Earnings`.

Every heading is a noun phrase of 2-5 words, Title Case, concrete and predictive.

Hard rules:
- **No question stems.** `Why Pipelines Matter` → `Pipeline Role`; `What an SPE Is` → `SPEs`; `How Work and Value Move` → `Work and Value Flow`; `Where to go next` → `Continue by Role`.
- **No numbers in names.** `Three Architectural Layers` → `Architectural Layers`. The number goes in the opening sentence.
- **No sentences.** `Trickle carries live frames between gateway and AI worker` → `Trickle Protocol`.
- **No `The` opener.** `The Network's Role` → `Network Role`.
- **No abstract noun piles.** `Surface Selection`, `Composite Health Read` fail the predictive test. If no concrete name exists, the section needs restructuring, not renaming.
- **Title Case**, both halves of hyphenated compounds (`On-Chain`, `Off-Chain`, `Real-Time`, `Trade-Offs`). Short function words stay lowercase unless first. Acronyms stay as written (`ETH`, `LPT`, `BYOC`, `SPE`, `AI`, `gRPC`, `RTMP`).
- **No parenthetical clarifiers** (`X (Y)`): choose one.
- **Sidebar test:** it must work as a navigation link at about 200px.

When no name can be found, in order of preference: delete the section and fold it into one that has a concrete name; restructure the content around named entities; promote a named entity inside it to the heading (`BondingManager Reads`). If none works, it should not be a top-level H2.

Self-check every heading: question stem? `The` opener? leading quantity word? verb claim? Title Case? predictive from the name alone? sidebar-fit?

### Other docs surfaces

| Surface | Length | Format |
|---|---|---|
| Sidebar title | 1-3 words | Short, scannable |
| Tab name | 1-2 words | Domain noun |
| Accordion title | 2-5 words | Content descriptor, not a question (an audience-entry question such as `From a Cloud Background?` is the one exception) |
| Step title | 2-4 words | Imperative verb + noun (`Set Pricing`, `Bridge to Arbitrum`); no `Go to`, no `your`, no parentheticals |
| Card title | 1-3 words | Noun phrase |
| Table header | 1-2 words | Field descriptor |
| Page title (frontmatter) | Full | Descriptive and search-aware, may be longer; the sidebar title follows heading rules |
| Filename | kebab-case | Matches the sidebar concept |

All surfaces: no comparators, no negation (`What You Don't Need`), no first person (`What You Earn` → `Reward Model`), no temporal framing (`Before You Start` → `Prerequisites`).
