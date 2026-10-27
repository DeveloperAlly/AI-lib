---
name: "blog-harness"
description: "Governs writing a post for Ally Haire's personal blog on Ghost, from purpose discovery to a finished, reviewed draft. Use when writing, structuring, editing or reviewing a post; publishing is handed to ghost-blog-posting. Do not use for LinkedIn posts, X threads, or documentation pages."
---

# Blog post production

Every post must solve a real problem or name a real pattern. Opinion without a concrete example is a tweet.

**The governing test:** could someone hand this post to an AI and build the thing described? If yes, publish. A walkthrough of something already documented elsewhere is not a post.

**The second governing test, added 13 Sep 2026 after a full rewrite:** what can a reader do after reading this that they could not do before? A post that fails this passes every other check and still does nothing. See Gate 0.

---

## Gate 0: purpose, before any drafting

This gate exists because it was skipped. A 4,000-word post was researched, written, published as a draft and thrown away, because audience, voice, scope and format were all settled while purpose was never asked. Every quality metric passed. The post was useless.

Ask as a single AskUserQuestion block. Draft nothing first.

**The job.** What can a reader do after reading this that they could not before? Offer concrete options shaped to the topic, and always include "I want to think out loud about this first". Accept a free-text answer.

Reject as purposes, because they are topics: "explain X", "cover the landscape of X", "share my thoughts on X". Push back once, in one sentence, and re-ask.

**The outcome.** What does the post do for Ally? Credibility for a role she is pursuing, positioning for a current project, a reference people return to, making the blogsite substantial (a standing job-search priority), or something she wants to work out by writing it.

**The entry point.** How does a reader arrive: by task, by question, by tool, by role, or from a specific link? This determines the post's index.

Write the three down before proceeding:

```
PURPOSE:  after reading this, a reader can ______
OUTCOME:  this does ______ for Ally
ENTRY:    readers arrive by ______, so the post is indexed by ______
```

**Success metrics.** Propose three to five, get agreement, write them down. At least one must measure a reader completing the job.

| Counts | Does not count |
|---|---|
| A reader with a named task reaches an answer within two screens | 1,500 words |
| Every recommendation carries a confidence rating tied to evidence quality | 10 citations |
| All six fields populated on every entry | Covers 8 models |

Word count, citation count and coverage breadth describe the artefact, not the outcome, and all three can pass while the post fails.

---

## Post anatomy

Required, in order.

1. **Hook**, first 100 words. Personal, specific, first person. What broke, what was built, or what is wrong about the conventional take. Start mid-thought or mid-story. No "In today's AI world". No rhetorical questions.
2. **Thesis or frame**, one sentence or short paragraph. What the post argues or shows.
3. **Body sections**, H2 only. One idea each, one concrete example minimum, honest limitations where relevant. Each section answers a question the reader is already asking.
4. **Diagrams and images**, per `post-images` (coverage, placement and alt text rules live there).
5. **Code examples** where the post covers implementation. Annotate inline. Show the relevant 5 to 15 lines and link a gist for the full file.
6. **Honest limitations** for every feature, tool or approach. No exceptions. This is the credibility mechanism.
7. **Summary table** where the post covers multiple tools: Feature, Shipped, Best for, Real limitation.
8. **Kicker.** A concrete next action, an open question, or a pointed observation. Never a hedge.

### Headings and paragraphs

- H2 only in body sections; the H1 is the post title and is never repeated.
- Titles and headings are named with `naming` (blog post title and blog section heading profiles). Ruling, 27 Oct 2026, superseding the 13 Sep statement-heading rule: H2s are concept names; H3s may carry a claim or a question.
- One paragraph, one job. Lead sentence states the fact. Final sentence is a fact, number or next step, never a hedge. Prose that restates a table is deleted.

---

## Post modes

Pick one at the start. The mode selects the shape.

**TECHNICAL FEATURE.** Hook (what broke or changed), thesis, feature sections (image, concept, code, limitations), summary table, kicker. Minimum one code example, one diagram, one limitations block per feature.

**OPINION / TAKE.** Hook (contrarian opener or paradox), thesis as a named claim, three supporting sections with evidence, steelman of the opposing view, rebuttal, kicker. Minimum one concrete example per supporting section.

**TUTORIAL / HOW-TO.** Hook (what you will have at the end), prerequisites, numbered H2 steps, full working code, what to do next. Code must be copy-pasteable, with honest notes on where it breaks.

**PROVE-IT TUTORIAL.** A hands-on tutorial that also answers whether a technology is worth adopting: build the baseline the reader knows, break it on purpose, fix it with the new technology, and show measured results. Load `prove-it-tutorial` for its skeleton, demo rules, visuals, embeds and verification gate. Its rulings (26 Oct 2026) override this skill for that mode: no length cap with a two-part split proposed past 4,000 words, and complete runnable files inline plus the repo.

**TECHNICAL REFERENCE.** Indexed by reader task, not by subject taxonomy. Structured records, not narrative. Visible provenance on every claim. No length cap. Governed by the language rules only: the personal-essay research does not apply, because its length cap, woven-in evidence and single-thread rules each destroy a reference.

**TECHNICAL ARGUMENT.** Thesis-led prose carrying one argument, linking to a reference for the detail. Both rule sets apply, language rules win conflicts.

**PERSONAL NARRATIVE.** Hook, tension, insight, evidence, resolution. 1,200 to 1,800 words. Evidence woven in and light. Single thread. Governed by `Blogs/Research/High Performance Personal Essay Research.md` plus the language rules.

**ANNOUNCEMENT OR UPDATE.** Lead with what changed and who it affects.

**FORUM TO BLOG.** Logged, not built. Monitor forums for domain questions, draft an answer as a post, queue for review.

When two governing sources conflict, surface the conflict and ask Ally to rule. Do not resolve it silently. Record the ruling here and in `Blogs/standards/BLOG-STANDARDS.md`.

---

## Language rules: route, do not duplicate

Four skills already hold the anti-slop rules and they are the source of truth. Load them instead of copying fragments, which drift.

| Skill | Covers |
|---|---|
| `no-ai-slop` | Words to cut, patterns to cut (binary contrasts, throat-clearing, faux-insight setups, colon reveals, importance puffery, weasel attribution, synonym cycling, fake-profound kickers, summary-recap endings), editing principles |
| `copy-rules` | Banned words and phrases, banned constructions, the master sentence test |
| `prose-quality` | The nine drivel patterns |
| `structure-rules` | Section sequence and structural completeness |

Ally's standing preference: these apply to all her written content, not only Livepeer docs. Read them before drafting anything public-facing.

### Hard invariants, inlined because they are load-bearing

| Rule | Check |
|---|---|
| UK English | `organise`, `optimise`, `behaviour`, `licence` (noun) |
| **Zero em dashes** | Strictest of three sources wins. See the conflict note below. |
| First person, builder register | Not marketing register |
| Numbers before abstractions | "3 failed executions per hour", never "frequent failures" |
| Concrete before general | Example first, principle second |
| Parenthetical asides | Natural, keep them |
| Profanity | Casual where it lands, never performative |

**Em dash conflict, unresolved.** Three sources disagree: Ally's memory invariant says none; the `no-ai-slop` skill permits 1 to 2 in longer drafts; the earlier blog-post draft said max 1 per 1,000 words with zero preferred. **Default to zero** until Ally rules, because it is the strictest and it is her own standing invariant.

### Post length

| Mode | Range |
|---|---|
| Technical deep-dive | 1,500 to 2,500 words |
| TIL or short take | 600 to 1,000 words |
| Technical reference | No cap |
| Prove-it tutorial | No cap. Past 4,000 words, propose a two-part split (ruling, 26 Oct 2026) |

Cut to hit the range. Never pad.

---

## Voice

Default for this blog: the `ally-voice` website and long-form tone map. Load that skill for the full corpus. The map, inlined so this skill works standalone:

- Composed byline voice. Technical storyteller.
- Make hard infrastructure legible.
- Front-loaded and proof-carrying: sharpest sentence first, every claim carries a number, link or name.
- Plain over clever, but precise. Never jargon-flex.
- Own things plainly. Never hedge or apologise for a strength.
- Builder to builder, not marketer to market.
- No emojis.

Two exceptions:

- Technical reference content dials personality down toward neutral analytical. The register is the reference, not the author.
- Fiction under the Sidney Lane name: `ally-voice` is firewalled out and must never be used.

Ally can override per post. Ask only when the mode does not settle it.

---

## Research and provenance

Research completes before drafting and before any format skill is opened.

- Present-day facts get searched. Model names, prices, benchmark results and current office-holders cannot come from training data.
- Prefer primary sources: technical reports, model cards, system cards, the lab's own posts.
- Label every figure by provenance. Three tiers, and the gap between tiers exceeds the gap between the things being compared:

| Tier | Weight |
|---|---|
| Externally adjudicated (a third party set the task before knowing who would compete) | Strongest, rare |
| Independent evaluator | Evidence |
| Vendor-reported | Marketing. Say so in the text. |

- Where two research threads report the same figure, reconcile before writing.
- **A hedge you attached to a specific figure is an error marker.** In the reference case every wrong number arrived with a protective qualifier: `~75.4 (contested)`, `>32T`, `~20 Apr`. The correlation was perfect. Verify, do not publish the hedge.

---

## Durability design

Applies to any post citing current facts. Without it, the whole post rots at the rate of its fastest-rotting component.

| Layer | Half-life | Content |
|---|---|---|
| Method | Years | How to reason about the problem. Works on facts that do not exist yet. |
| Posture | 12 to 18 months | How actors behave, read from structural choices |
| Current state | Weeks | Today's answers, dated |

Four mechanisms:

1. Visible half-life label on each layer, so the reader knows what to distrust over time
2. Fast layer physically separated and dated, so an update replaces one section
3. Fast layer held as structured records, so a change edits a row
4. Slow layer predicts the fast layer, so a reader can extrapolate between updates

Canonical version goes in an updatable artifact. The Ghost post is a dated snapshot linking to it.

---

## Images and diagrams

Rules, including minimum coverage, live in `post-images`. Plan the visuals while drafting, not after.

---

## Ghost constraints

Formatting that Ghost and the theme impose (tables, embeds, footnotes, code languages) lives in `ghost-blog-posting` step 5. Draft with those constraints in mind, especially table width.

---

## The CRITIC pass

Run before marking any post ready.

1. **Weakest argument.** Which claim would a hostile reader attack first? Is it defended?
2. **Most generic sentence.** Find the sentence that could appear in any post on this topic. Rewrite it with a specific number, name or example. (The portability test in `no-ai-slop` is the same instrument.)
3. **AI tells.** Scan against `no-ai-slop` and `copy-rules`. Check for uniform paragraph length and suspicious tricolons.
4. **Images and diagrams.** Check against the `post-images` coverage standard.
5. **Limitations block.** Every major tool or feature covered needs one. Missing means the post reads as a sales pitch.
6. **Kicker.** Concrete action, observation or open question. Never "I hope this was helpful".
7. **Purpose.** Re-read Gate 0. Does the post do the job it was written to do?

### Mechanical scan

Run before showing Ally anything. Scan prose only: strip fenced blocks and code spans first, because those legitimately contain banned characters.

```bash
F=<file>
strip() { sed -e '/^```/,/^```/d' "$1" | sed -e 's/`[^`]*`//g'; }
echo -n "em dashes: "; strip "$F" | grep -c $'—'
for w in effectively essentially basically meaningful significant various several simply obviously clearly delve leverage utilize robust harness; do
  echo -n "$w: "; strip "$F" | grep -oiw "$w" | wc -l; done
for p in "rather than" "not just" "In this guide" "This page" "That means" "This shows" "let's dive in" "it's worth noting"; do
  echo -n "$p: "; strip "$F" | grep -oi "$p" | wc -l; done
echo -n "US spellings: "; strip "$F" | grep -oiE "optimiz|organiz|behavior|analyz|defense|center" | wc -l
```

Fix anything non-zero and re-run until clean.

### Adversarial review

Run in a fresh context, read-only. Give the reviewer the purpose and metrics from Gate 0 and ask it to attack the post against those.

**Verify every finding against primary sources before actioning it.** In the reference case two of six critical findings were the reviewer checking the wrong source, and actioning them would have introduced errors while removing none. A reviewer's confidence is evidence of nothing.

Check whole-document consistency, not section by section. A figure in one section falsifying a table in another is the failure mode that section-level review misses.

---

## Publishing to Ghost

Hand the finished draft to `ghost-blog-posting`. It runs naming, slop review, images, cover and post settings, then creates the draft and checks the preview, and publishes only on Ally's approval.

---

## Not covered here

| Need | Skill |
|---|---|
| LinkedIn posts, X threads | `ally-voice` |
| Documentation pages | `page-authoring` |
| Resume or cover letter content | `resume-data-model` |
| Ghost CMS setup or theme configuration | Handle separately |

---

## After publishing

- Record anything learned in `Blogs/learnings/BLOG-LEARNINGS-INDEX.md` when that folder is connected
- Record any new ruling in this skill and in `Blogs/standards/BLOG-STANDARDS.md`
- Ask whether the piece has a follow-up and scope it while the research is fresh

---

## Open items

| Item | Status |
|---|---|
| Em dash count: zero, or 1 to 2 permitted in long drafts | **Needs Ally's ruling.** Defaulting to zero. |
| RAG/CAG post: structure used, heading style, publish friction | Unanswered. Heading style is settled by the 27 Oct ruling regardless. |
| n8n features post: diagrams built inline versus flagged missing, image sourcing | Unanswered |
| OpenClaw post: different voice register, structural variations | Unanswered |
| Word range for technical depth posts | 1,500 to 2,500 held. The 13 Sep reference post landed at 2,088 inside that range. |
| Ghost render gotchas | Recorded in `ghost-blog-posting` (formatting, theme defects). More will surface. |