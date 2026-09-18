---
title: ADR-0001 — The structure document is prose, not schema
description: content-structure.md is written for an LLM to read, not for a parser to enforce. There is no routing rules engine.
status: accepted
date: 2026-09-18
---

# ADR-0001 — The structure document is prose, not schema

**Status:** Accepted · 2026-09-18
**Supersedes:** the original design, in which `content-structure.md` carried a
YAML frontmatter block the server parsed and enforced

## Context

`content-structure.md` answers the only question that matters at capture time:
*where does this go?* The original design had it carry machine-readable
frontmatter — a folder list with glob patterns, allowed `type` values per
folder, required frontmatter fields — with the prose beneath it as commentary
for humans. The server parsed the block, and writes were validated against it.

Two things were wrong with that.

**The parser and the prose would disagree.** Two descriptions of the same
convention, one authoritative for validation and one authoritative for the
model's routing decision, drift within weeks. The model reads the prose and
files by it; the server rejects by the schema. The agent gets an error it cannot
act on, because the text it was given said the write was correct.

**A schema makes restructuring a migration.** Renaming `10-knowledge/` to
`10-reference/`, or splitting a folder, means editing the schema, re-validating
existing content, and dealing with everything that no longer matches. Teams
learn what they actually file after a few weeks. If changing the convention is
expensive, it does not get changed, and the brain is filed into badly forever.

The underlying question is where routing intelligence belongs. Every consumer of
this document is an LLM. A model reading "does not belong here: anything scoped
to one project" performs better than any pattern list we could write, because
the judgement is semantic — *is this content project-scoped?* — and that is
exactly what a rules engine cannot do and a model can.

## Decision

**`content-structure.md` is plain markdown prose with no machine-readable
contract. Nothing parses it.**

- `brain_structure` returns it **verbatim**, alongside the live folder tree from
  the filesystem. `core` reads the file and passes the bytes through.
- The agent reads it the way a new colleague reads a team's filing convention,
  and chooses the path itself.
- The folder tree comes from the filesystem, never from the document. The
  document says what *should* be; the tree says what *is*. Where they disagree,
  the tree is the fact and the difference is drift.
- Presets are therefore ordinary markdown files in `seed/presets/`. Adding one
  is adding a file, with no code change.
- The document's quality is a *product* concern, not a code concern. It is
  tuned against a routing fixture set, and the guidance for writing one lives in
  [`03-structure-doc-guide.md`](../03-structure-doc-guide.md).

This is the decision the rest of the system is shaped around. It is why writes
to undeclared folders succeed ([ADR-0002](./0002-safety-only-write-guards.md)),
and why `gbrain doctor` reports drift rather than preventing it.

## Consequences

**Good**
- Restructuring is editing prose. No migration, no code change, no redeploy —
  agents pick up the change on their next `brain_structure` call, and existing
  files are untouched because no path was ever validated against the old text.
- Adapting g-brain to a new team is writing one markdown file. That is success
  criterion S5 and most of the product's adoption story.
- One description of the convention, so nothing can disagree with anything.
- The routing quality ceiling rises as models improve, without a line changing
  here.

**Costs — these are real**
- **Routing quality is not guaranteed and cannot be asserted in a unit test.**
  It is measured statistically against a fixture set (≥90% correct folder, zero
  silent misfiles) and it will vary by model. A weaker model files worse, and
  nothing in the system catches it. This is the price of putting judgement in
  the model.
- **A badly written structure document silently degrades everything**, and the
  failure is invisible: content lands in plausible-but-wrong folders and nobody
  notices until someone cannot find it. The mitigations are the fixture set, the
  writing guide, and `gbrain doctor`'s drift report — none of which is
  prevention.
- **No autocomplete, no validation, no IDE support** for the document. It is
  prose; the only feedback loop is running the fixtures.
- **Prompt cost.** The document is read on every routing decision, so it is
  tokens in every capture. Hence the ~400-line guidance in the writing guide.

**Trigger to revisit:** fixture accuracy that will not rise above ~90% across
several well-written structure documents and current models. That would mean
prose is insufficient and the answer is probably a *hint* layer — a small
optional machine-readable block the model is offered alongside the prose, never
one the server enforces. Enforcement stays rejected regardless; see
[ADR-0002](./0002-safety-only-write-guards.md).

## Alternatives considered

**YAML frontmatter contract, server-enforced.** The original design. Rejected:
it creates two sources of truth, makes restructuring a migration, and turns
every capture into a negotiation with a validator. The deeper problem is that it
rejects writes for being in the wrong place, which is precisely the behaviour
that trains agents to stop capturing.

**Prose plus a parsed folder list used for hints only** — the server extracts
`## folder/` headings and includes them as structured data, but never validates
against them. Rejected for v1 as unnecessary: the model already reads the
headings in the prose, and the extracted list would be a second representation
that can fall out of step. A heuristic version of exactly this extraction *is*
used by `gbrain doctor` to detect drift — which is safe, because doctor reports
and never rejects.

**A routing rules engine** — patterns, priorities, fallbacks, mapping content
signals to folders. Rejected: this is the thing an LLM replaces. Writing and
maintaining routing rules for a filing convention is the work the product exists
to remove.

**Ask the model to generate the schema from the prose at init time.** Rejected:
it reintroduces the two-sources-of-truth problem with an extra generation step,
and the generated schema silently ages as the prose is edited.
