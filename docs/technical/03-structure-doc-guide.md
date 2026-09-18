---
title: Writing a structure document an LLM follows
description: content-structure.md is the product. How to write one that routes well, how to tune it against fixtures, and how to change it later.
---

# Writing a structure document an LLM follows

`content-structure.md` sits at the brain root and answers the only question that
matters at capture time: *where does this go?* It is served verbatim by
`brain_structure` ([FR-01](../functional/06-functional-requirements.md)) and is
written through the same guarded path as any other document
([FR-02](../functional/06-functional-requirements.md)). Nothing parses it. An
agent reads it, decides a path, and writes there.

That makes this document the product. Everything else in the system — atomic
writes, etags, git, the index — exists so that the decision this file drives is
cheap and never lost. If the file is vague, the brain fills up with
plausible-but-wrong paths and nobody notices for weeks. Routing quality is
[success criterion S1](../functional/01-overview.md#success-criteria), and S1 is
the one that decides whether the product works.

## Why prose, not schema

The original design had the document carry a machine-readable block the server
enforced. That was rejected — see
[ADR-0001](./12-adr/0001-structure-doc-is-prose-not-schema.md) — for reasons
that shape everything below.

- **Every consumer is a model.** The judgement being made is semantic: *is this
  content project-scoped?* A sentence like "does not belong here: anything
  scoped to one project" outperforms any pattern list, because the pattern list
  cannot answer the question at all.
- **Two descriptions drift.** A parsed block plus prose beneath it means the
  model routes by one and the server rejects by the other, and the agent gets an
  error the text it was given said was impossible.
- **Restructuring must stay an edit.** Teams learn what they actually file after
  a few weeks. If changing the convention costs a migration, it does not get
  changed.

The practical consequence for you as the author: **there is no validation, no
autocomplete, and no type error.** The only feedback loop is the fixture set
described further down. Write the document, run the fixtures, read the failures.

## Anatomy of a document that routes well

Order matters more than you would expect. The model reads top-down, and it is
deciding a path while it reads — the guidance that has to survive the whole file
goes first.

| # | Part | Why it is there |
|---|---|---|
| 1 | One-paragraph preamble | States that the brain is shared and read later by strangers. Sets the standard for what gets written, not just where |
| 2 | **Decision procedure** — 4–6 numbered steps | The routing algorithm. Read before any folder name, so it frames every section that follows |
| 3 | Naming and frontmatter | Filename shape, one idea per file, the frontmatter block, the `type` list |
| 4 | One section per folder, in tree order | The bulk. Each section is: purpose, belongs here, does **not** belong here, one example path |
| 5 | Conventions | Linking, leading with the answer, no secrets, marking uncertainty. Applies to content, not location |

The decision procedure at the top is the highest-leverage part of the file. It
is what the model applies when a folder section is ambiguous, and it is the only
part guaranteed to be read before the model has started forming a guess. From
`seed/presets/default.md`:

```markdown
**How to choose a location**

1. Ask what the content *is*, not what you were doing when you produced it.
   A decision made during a debugging session is a decision, not a session log.
2. Ask how long it stays true. Durable → `10-knowledge/`. Tied to one piece of
   work → `20-projects/`. True only for today → `60-sessions/`.
3. Read the folder section below and check the "belongs here / does not belong
   here" lines. They are the actual test.
4. If two folders both fit, pick the one where someone would *look for it*, not
   the one where it was produced.
5. If nothing fits, write to `00-inbox/` and set `needs-filing: true`.
```

Step 1 exists because the most common misfile is content filed by the activity
that produced it. Step 4 exists because it breaks ties in the direction of
retrieval rather than provenance, which is what the brain is for.

## Exclusions do more work than inclusions

This is the single rule that most improves fixture scores.

Almost no misfile is a document that fits nowhere. Almost every misfile is a
document that plausibly fits two folders, and the model picked the wrong one.
Listing what belongs in a folder does not help there — both lists look true.
Listing what does **not** belong, naming the folder it belongs in instead, does.

**Weak — inclusion only:**

```markdown
## 10-knowledge/

Durable reference material, explanations, how-tos, research.
```

**Strong — inclusion, exclusion, redirect, test:**

```markdown
## 10-knowledge/{topic}/

Durable reference that outlives any single project. The answer to "how does
this work?" or "what does this mean?"

**Belongs here:** how a system works, what a term means, an explanation of a
protocol or an internal service, a how-to that will still be correct next year.

**Does not belong here:** anything scoped to one project (`20-projects/`),
anything that records a choice and its reasoning (`40-decisions/`), or a
step-by-step operational procedure (`50-playbooks/`).

The test: *if this project were cancelled tomorrow, would this still be worth
keeping?* If yes, it goes here.

Example: `10-knowledge/auth/oidc-token-refresh.md`
```

Three things to copy from that:

- **Every exclusion names the folder that should receive it.** "Not project
  work" leaves the model to re-derive the answer; "anything scoped to one
  project (`20-projects/`)" hands it over.
- **Exclusions are reciprocal.** If `10-knowledge/` excludes project-scoped
  content, `20-projects/` must exclude durable knowledge and say to link to it.
  A one-sided exclusion only fixes the confusion in one direction, and the
  fixture set will show you the other one.
- **The knowledge-vs-project test is a sentence the model can actually
  evaluate.** *If this project were cancelled tomorrow, would this still be
  worth keeping?* Durable versus scoped is the boundary that carries the most
  traffic in every preset, and it deserves an explicit test rather than an
  adjective.

## Exactly one real example path per folder

One, and a real one.

```markdown
Example: `40-decisions/2026/use-git-as-the-history-layer.md`
```

That example does four jobs at once: it shows the `{yyyy}` segment resolved to a
real value, it demonstrates kebab-case, it demonstrates a filename that
describes content rather than date or author, and it anchors the folder's
purpose in a concrete case. A placeholder like `40-decisions/{year}/{slug}.md`
does none of them.

Do not give three examples. A list invites the model to pattern-match the
nearest example instead of applying the belongs / does-not-belong test, and
every extra line is paid on every capture.

## Always provide an inbox, and bless it explicitly

Every structure document needs a catch-all folder, and it needs a sentence
saying that using it is a **correct answer**.

```markdown
5. If nothing fits, write to `00-inbox/` and set `needs-filing: true` in the
   frontmatter with a one-line reason. That is a correct answer, not a failure.
   Guessing wrong is worse than using the inbox — a misfiled doc is invisible.
```

Without that sentence the model treats uncertainty as something to resolve
rather than something to report, and it guesses. The asymmetry is the whole
argument:

| Outcome | Visibility | Cost to recover |
|---|---|---|
| Wrong folder, confidently chosen | None. Nothing distinguishes it from a correct file | Someone has to fail to find it first |
| `00-inbox/` with `needs-filing: true` and a reason | A queue, reported by `gbrain doctor` ([FR-26](../functional/06-functional-requirements.md)) | A curation pass |

Balance it with an exclusion, or the inbox becomes the default and you have
built a folder of unsorted captures:

```markdown
**Does not belong here:** anything you *could* have filed. The inbox is an
escape hatch, not a default. If you find yourself using it more than
occasionally, the problem is this file — say so, and a human will fix it.
```

That last clause matters. The agent is the only party positioned to notice that
the document is failing it, and inviting it to report that turns a silent
degradation into a signal.

## Name the known failure modes in the document itself

A structure document is allowed to talk about its own weak points, and should.
The model is reading it at exactly the moment the warning applies.

The session-log folder is the one that always needs it:

```markdown
**This folder is a trap.** The failure mode of every second brain is that
agents log their sessions and never promote what they learned, so the durable
knowledge is buried in dated scratch nobody reads. Before you close a session,
ask what you learned that will still be true next month, and write *that* to
`10-knowledge/`, `40-decisions/`, or the relevant project — then link to it
from the session log.
```

This is not decoration. Session logs route correctly without it — the folder is
unambiguous — and the brain still fails, because everything worth keeping ends
up inside a file nobody will open again. The warning changes what gets written,
not where. The same guidance is in
[the agent contract](../functional/07-agent-contract.md), and it appears in both
places deliberately: the contract is read by whoever builds the agent, the
structure document by the agent at capture time.

Other failure modes worth naming in-document, where they apply:

- **Archive rather than delete**, in the archive section — otherwise "no longer
  true" reads as "remove".
- **Accepted decisions are not rewritten**, in the decisions section — supersede
  with a new file and set `supersedes:` / `superseded-by:` both ways.
- **Nothing personal or evaluative**, in the people section — the exclusion list
  there is a safety boundary, not a filing one.
- **Reuse an existing topic before inventing one**, wherever a folder has a
  `{topic}` segment. Left unsaid, a brain grows one topic folder per document.

## Numeric folder prefixes

Prefix every top-level folder with a two-digit number in tens: `00-inbox/`,
`10-knowledge/`, `20-projects/`, `30-people/`, `40-decisions/`,
`50-playbooks/`, `60-sessions/`, `90-archive/`.

- **Listing order matches document order.** `brain_structure` returns the live
  filesystem tree alongside the prose. When both read in the same order, the
  model is not holding a mapping between two differently-ordered lists while it
  decides.
- **Gaps of ten absorb new folders without renaming anything.**
  `seed/presets/product-team.md` adds `15-specs/` between knowledge and projects
  and `45-incidents/` after decisions. Neither required moving an existing file.
- **Renaming is the expensive operation**, because it is the one thing that
  makes existing paths inconsistent with the document. Numbering so that
  insertion never forces renumbering is what keeps a restructure to a prose
  edit.

Use `90-` for archive specifically, so it sorts last however many folders get
added.

## Length: keep it under roughly 400 lines

The document is read on **every** routing decision. It is tokens in every
capture, competing for context with the agent's actual task.

| Document | Lines | Rough tokens |
|---|---|---|
| `seed/presets/personal.md` | 108 | ~1,100 |
| `seed/presets/product-team.md` | 185 | ~2,000 |
| `seed/presets/default.md` | 228 | ~2,500 |
| Practical ceiling | ~400 | ~4,500 |

Past roughly 400 lines two things happen, and the second is worse than the
first. The cost per capture stops being negligible; and the decision procedure
at the top is separated from the folder sections by enough text that its
influence weakens. A long document routes worse than a short one saying the same
thing, which is an unusual and useful property — the budget is a quality
constraint, not only an economic one.

Spend the budget on exclusions. Cut, in this order: extra examples, prose
explaining why the convention exists, folders nobody files into, and
frontmatter fields that are optional and rarely used.

## Anti-patterns, with the rewrite

### 1. Vague folder description

**Before**

```markdown
## 10-knowledge/

Important information and useful reference material.
```

Nothing here is false, and nothing here excludes anything. Every capture fits.

**After**

```markdown
## 10-knowledge/{topic}/

Durable reference that outlives any single project — how a system works, what
a term means, a how-to that will still be correct next year.

**Does not belong here:** anything scoped to one project (`20-projects/`), a
choice and its reasoning (`40-decisions/`), or a step-by-step procedure
(`50-playbooks/`).

The test: *if this project were cancelled tomorrow, would this still be worth
keeping?*

Example: `10-knowledge/auth/oidc-token-refresh.md`
```

### 2. Folders whose scopes overlap

**Before**

```markdown
## 20-projects/
Notes about ongoing work.

## 25-workstreams/
Notes about initiatives in progress.
```

No sentence distinguishes these, so routing between them is a coin flip and the
fixture set will show roughly 50% accuracy across both. Two folders a careful
human cannot separate are one folder.

**After** — merge them, or give one a boundary the other's exclusion mirrors:

```markdown
## 20-projects/{project}/
Everything scoped to one active piece of work: status, working notes, meeting
records, open questions.

**Does not belong here:** knowledge that survives the project ending — write it
to `10-knowledge/` and link to it from here.
```

### 3. Inclusion-only descriptions

**Before**

```markdown
## 40-decisions/{yyyy}/
Belongs here: technical choices, process changes, vendor selection.
```

A vendor selection discussed in a project meeting fits this *and*
`20-projects/`. Nothing says which wins.

**After**

```markdown
## 40-decisions/{yyyy}/
Choices and the reasoning behind them, ADR-style.

**Belongs here:** any decision someone might later ask "why did we do it that
way?" about — including things deliberately *not* done.

**Does not belong here:** the resulting implementation details (those are
`10-knowledge/`), or a decision still under discussion — that is a project note
until it is made.
```

The "still under discussion" clause resolves the meeting case explicitly, which
is the kind of sentence exclusions exist for.

### 4. No inbox

**Before** — a document with eight well-described folders and no catch-all.

The model has no legal way to express uncertainty, so it picks the nearest
folder every time. Fixture runs then show a respectable folder-accuracy number
and **silent misfiles above zero**, which fails
[S1](../functional/01-overview.md#success-criteria) regardless of the accuracy
figure.

**After** — add `00-inbox/`, name it in the decision procedure's last step, and
state that using it is correct. Both parts are required: an inbox nobody blessed
is a folder the model avoids.

### 5. Jargon the model cannot resolve

**Before**

```markdown
## 20-projects/
Project docs. Follow the usual RFC flow. Tier-1 items go to the platform space.
```

"The usual RFC flow", "tier-1", and "the platform space" are unresolvable from
this file. The model will either ignore the sentence or invent a meaning for it.

**After**

```markdown
## 20-projects/{project}/
Everything scoped to one active piece of work. `{project}` is kebab-case and
stable — pick the name once and keep it. Within a project folder, use flat
files unless it grows past ~20 docs.
```

Rule: if a term is not defined in this file and is not ordinary English, either
define it in one clause or remove it. The document is read with no other
context.

### 6. A document so long it crowds the capture

**Before** — 900 lines: a rationale essay per folder, four examples each, a full
tag taxonomy, a style guide for prose.

**After** — keep the decision procedure, one paragraph of purpose per folder,
belongs / does-not-belong, one example. Move rationale out of the brain root
entirely; it is not read at capture time and should not be paid for at capture
time. If a tag taxonomy is genuinely needed, it is a document in `10-knowledge/`,
linked once from the conventions section.

## Tuning one against fixtures

You cannot unit-test routing. You measure it.

**The fixture set** is ~20 capture requests in the voice an agent would actually
use, each with the folder it should land in. Keep it beside the document it
tunes — in this repo, `seed/presets/fixtures/<preset>.jsonl`; for a team's own
brain, a file in the brain repo. Preset discovery globs `seed/presets/*.md`, so
a `fixtures/` subfolder stays invisible to it.

```jsonl
{"id":"r-01","capture":"We chose advisory locks over table locks for the job runner, because the table lock held through the whole batch. Rejected SKIP LOCKED for ordering.","expect":"40-decisions/"}
{"id":"r-02","capture":"Notes from today's debugging of the auth timeout — tried three things, none worked, picking it up tomorrow.","expect":"60-sessions/"}
{"id":"r-03","capture":"How OIDC refresh tokens rotate in our gateway, including the 30-second clock-skew allowance.","expect":"10-knowledge/"}
{"id":"r-04","capture":"A half-sentence a customer said about invoicing that might matter later. No idea what it relates to.","expect":"00-inbox/"}
```

**How to run it.** Give a real model nothing but the `brain_structure` output —
the structure document verbatim plus the folder tree — and the capture text. Ask
for a path. Compare the top-level folder. Run it against the *weakest* model you
expect to serve the brain: routing quality varies by model and nothing in the
system catches a weak one
([ADR-0001](./12-adr/0001-structure-doc-is-prose-not-schema.md)).

**The bar** — from [S1](../functional/01-overview.md#success-criteria):

- **≥90% correct folder.**
- **Zero silent misfiles.** A silent misfile is content placed confidently in
  the wrong folder. Content placed in `00-inbox/` when the expected folder was
  something else **counts as success**, not failure — the fixture set exists to
  catch invisible errors, and an inbox item is visible by construction.

The second bar is the hard one and the one that matters. A document scoring 95%
with two confident misfiles is worse than one scoring 88% with the remainder in
the inbox.

**What a failure tells you.** Failures point at the document, not the model.

| Failure pattern | What it means | Fix |
|---|---|---|
| Two folders keep being confused, in both directions | Neither section excludes the other | Add reciprocal exclusions that name each other by path |
| One folder absorbs captures from everywhere | Its "belongs here" is too broad, or it sits first with an inviting name | Tighten it and add exclusions naming the folders it is taking from |
| Content filed by the activity that produced it — a decision landing in sessions | The decision procedure's first step is missing, weak, or buried | Restore step 1 and give it a concrete example of the confusion |
| The model invents a folder that does not exist | Real content the document does not cover | Add the folder, or add an exclusion routing that content to the inbox |
| Right folder, wrong `{topic}` or `{project}` segment | The segment has no selection guidance | Say how to choose one, and to check the tree before inventing one |
| Inbox rate above ~15% | A coverage gap, not a model problem | Find what the inbox items have in common; it is usually one missing folder |

Re-run after every edit. The set is cheap, and a change that fixes one confusion
routinely creates another — an exclusion added to `10-knowledge/` can push
borderline content into `20-projects/` that used to land correctly.

## Evolving one

Editing the structure document later is normal, not exceptional. The system is
built so that it costs a prose edit and nothing else.

- **Agents pick up the change on their next `brain_structure` call.** Nothing to
  redeploy, nothing to reindex, no restart.
- **Existing files are never moved by an edit.** No path was ever validated
  against the old text, so no path can become invalid under the new text. A
  write to a folder the document does not describe succeeds
  ([FR-11](../functional/06-functional-requirements.md)) — and that holds for
  folders the document *used* to describe as well.
- **`gbrain doctor` reports the difference as drift**
  ([FR-26](../functional/06-functional-requirements.md)): the documents whose
  location no longer matches what the file says. It reports; it never moves.
- **A restructure is therefore a reviewable list, not a migration.** Edit the
  prose, run `gbrain doctor`, read the drift list, decide what to move. Moving
  is ordinary curation — a `brain_write` to the new path and a soft delete of
  the old — and every step is a commit you can read and revert
  ([ADR-0003](./12-adr/0003-git-as-the-history-layer.md)).

Practical sequence for a rename such as `10-knowledge/` → `10-reference/`:

```bash
# 1. edit content-structure.md in the brain repo
# 2. see what no longer matches
gbrain doctor
# 3. move what is worth moving, via the curator agent or by hand
# 4. the old folder is empty, or it is not — both are valid end states
git -C ~/brain log --oneline
```

Step 4 is the part worth internalising. A partially completed restructure is not
a broken state. Both folder names coexisting is drift, drift is reported, and
the brain works throughout.

Two things to avoid when evolving:

- **Do not renumber existing folders** to make room. That is what the gaps are
  for; renumbering makes every existing path inconsistent at once.
- **Do not add a folder without exclusions in its neighbours.** A new folder
  that no existing section redirects to attracts nothing, or attracts
  everything. Add the folder and edit the two sections nearest it in meaning in
  the same edit, then re-run the fixtures.

## The shipped presets as worked examples

Three complete documents live in `seed/presets/`. Each demonstrates something
different; read the one closest to your case and edit it rather than starting
from nothing.

| Preset | Lines | What it demonstrates |
|---|---|---|
| [`default.md`](../../seed/presets/default.md) | 228 | The full pattern at reference length. A five-step decision procedure, belongs / does-not-belong / example in every section, the knowledge-vs-project test stated explicitly, the inbox blessed in the procedure and bounded in its own section, the session-log trap warning, and a conventions block covering linking, leading with the answer, and secrets |
| [`product-team.md`](../../seed/presets/product-team.md) | 185 | Extending a working document without renumbering. `15-specs/` and `45-incidents/` slot into the numbering gaps; both carry exclusions pointing back at `10-knowledge/`, and `45-incidents/` adds a rule that every incident must leave at least one link. It is also **shorter** than `default.md` despite two more folders — the per-section prose was compressed to make room |
| [`personal.md`](../../seed/presets/personal.md) | 108 | How small a document can get and still route. Five folders, unnumbered, a decision procedure that is five direct questions rather than a general method, and exclusions of one clause each. Proof that the pattern scales down: what survives the cut is the decision procedure, the exclusions, and the inbox |

`product-team.md` is the most instructive of the three, because it shows what
adding to a structure document actually costs: two new sections, two edited
exclusions elsewhere, no renames, and a re-run of the fixtures.

## Related

- [ADR-0001 — the structure document is prose, not schema](./12-adr/0001-structure-doc-is-prose-not-schema.md)
- [ADR-0002 — write guards are safety-only](./12-adr/0002-safety-only-write-guards.md)
- [The agent contract](../functional/07-agent-contract.md) — the reading side of this document
- [Onboarding](../functional/03-onboarding.md) — how a brain gets its first structure document
- [Testing and verification](./10-testing-and-verification.md) — where the fixture run sits in the suite
