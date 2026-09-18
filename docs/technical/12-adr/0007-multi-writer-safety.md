---
title: ADR-0007 — Multi-writer safety — prevent mechanically, reverse semantically
description: Many personas write to one brain. Mechanical conflict is prevented outright; a semantically wrong write is not, and is made attributable, reversible, and narrow instead.
status: accepted
date: 2026-09-18
---

# ADR-0007 — Multi-writer safety: prevent mechanically, reverse semantically

**Status:** Accepted · 2026-09-18
**Depends on:** [ADR-0005](./0005-one-installation-many-projects.md)

## Context

One installation serves a whole team, so several writers act on one brain at
once: a capture agent mid-task, a recall agent, a curator doing hygiene, a CI
agent posting deploy notes, and a human editing files directly in the repo. They
do not coordinate with each other and they run on different machines.

The question that matters is not "can two writes collide?" — that is solved and
tested. It is: **when one writer updates something wrongly, what stops that from
breaking everyone else's work?**

Answering it requires separating two failures that look alike and are not.

**Mechanical failure** — two writers touching the same bytes. Agent A and agent B
both read `status.md`, both edit, and B's write erases A's. This is a
correctness problem with a known solution.

**Semantic failure** — one writer producing something *wrong*. An agent captures
an incorrect fact confidently. A curator merges two documents and loses the
better half. A human edits a decision record to say what they now wish it had
said. Nothing collided; the content is simply worse than it was.

These need different answers, and conflating them leads to the wrong design —
usually validation, which would contradict
[ADR-0002](./0002-safety-only-write-guards.md) and stop captures happening at
all.

The curator deserves specific attention. Every other persona touches one
document per operation. The curator moves, merges, and archives **in bulk**, and
"a human reviews `git log`" is a weak control against a run that touched two
hundred files. It is the one persona whose mistakes are not naturally narrow.

## Decision

**Mechanical conflict is prevented outright. Semantic wrongness is not
prevented — it is made narrow, attributable, and reversible. The two personas
that can do wide damage are constrained by scope and by review.**

### 1. Mechanical: prevented

Already specified, listed here so the guarantee is stated in one place.

| Guarantee | Mechanism |
|---|---|
| No lost update | Replacing requires `ifMatch`; stale gives `PRECONDITION_FAILED` with the current etag |
| External edits detected | Etags are content hashes, so a human editing in an editor invalidates a stale write |
| Additive writes never clobber | `brain_append` resolves its insertion point under the lock, with no read-modify-write cycle |
| No partial file | temp → `fsync` → rename |
| No interleaving | Advisory per-path locks with stale-lock recovery |

### 2. Blast radius is one document

This is the property that actually protects other people's work, and it is
preserved deliberately rather than arrived at by accident:

- **Path is identity.** No cross-document transactions, no cascading updates, no
  references that must stay consistent.
- **Backlinks are computed, never stored.** A bad write cannot corrupt the link
  graph; it rebuilds.
- **The index is derived.** A bad write cannot corrupt search; it rebuilds.

A wrong write to `X.md` cannot make `Y.md` wrong. Any future feature that would
break this — denormalised counts, a stored graph, a generated index document —
is rejected on those grounds.

### 3. Semantic: not prevented, and that is deliberate

Nothing checks whether a captured fact is true. Preventing that means validating
content, which is the behaviour ADR-0002 exists to stop.

What exists instead:

- **Attribution.** Every commit is authored as the calling agent, and every
  mutation is one line in `audit.jsonl` — including rejections.
- **Reversibility.** Revert restores prior content as a new commit; nothing is
  deleted, only archived.
- **Detection after the fact.** `gbrain doctor` reports drift, broken links,
  orphans, near-duplicates, and inbox backlog.
- **Convention.** Accepted decisions are superseded, never rewritten, so the
  record of what was believed survives.

Stated honestly: this is a recovery story, not a prevention story.

### 4. Per-persona key profiles

Scopes exist ([FR-18](../../functional/06-functional-requirements.md)) but were
not prescribed. They are the only preventive control available against a
persona's mistakes, so `gbrain init` generates narrow keys by default rather
than one key that can write everywhere.

| Persona | Scope |
|---|---|
| Capture agent | write `00-inbox/`, `05-memory/`, `10-knowledge/`, `20-projects/`, `40-decisions/`, `60-sessions/` |
| Recall / research agent | **read-only, everywhere** |
| Curator | write everywhere; the **only** key permitted to write `90-archive/` |
| CI agent | write `20-projects/` only |

A read-only recall agent that cannot write at all is the strongest guarantee in
this document, because it is the only one that is preventive rather than
corrective.

### 5. Curation is a proposal, not an action

The curator is the only persona with wide reach, so its reach is made
reviewable:

- **`gbrain doctor` reports and modifies nothing.** Already true; now load-bearing.
- **A curation run produces a change plan first** — every move, merge, and
  archive it intends, with reasons — which a human approves before anything is
  written.
- **An approved run lands as one labelled commit**, so undoing it is one
  command rather than two hundred.
- **Bulk operations are capped** at a configured number of documents per run and
  the cap is reported, so a runaway curator stops and says so instead of
  finishing.

Promotion out of session logs into `05-memory/` or `10-knowledge/` is the
curator's most valuable action and is additive, so it is exempt from the
approval step. Moves, merges, and archives are not.

## Consequences

**Good**
- The question "can another agent break my work?" has a precise answer:
  mechanically no, semantically only within one document, and always
  recoverably.
- The worst realistic accident — a bad bulk curation — becomes one revert.
- A research agent physically cannot write, which removes an entire class of
  incident rather than mitigating it.
- Narrow keys make the audit log meaningful. "Which agent wrote this?" has a
  useful answer when agents have different keys.

**Costs — these are real**
- **Semantic correctness is still unguaranteed.** A confidently wrong document
  sits in the brain looking exactly like a right one until somebody notices. The
  system offers detection and recovery, not truth.
- **The approval step slows curation**, and a curator nobody approves is a
  curator that stops running — which lets the brain rot, the failure mode
  ADR-0002's permissiveness depends on curation to prevent. Watch for approval
  fatigue; if plans stop being read, the cap matters more than the approval.
- **More keys to manage.** Four keys instead of one means four things to rotate
  and a worse first-run experience. Mitigated by `gbrain init` generating them,
  and by stdio remaining trusted as local by default.
- **Scopes are per folder**, so a persona that legitimately needs one document
  outside its scope has no way to get it without widening the whole folder.
- **Nothing here constrains a human with filesystem access.** They can edit any
  file, including `audit.jsonl`. The brain is not a system of record and this
  does not make it one.

**Trigger to revisit:** a real incident where one writer's mistake caused work
loss that these controls did not catch or make recoverable. Also revisit if
approval fatigue means curation stops running — the answer there is a narrower
automatic scope for the curator, not the removal of review.

## Alternatives considered

**Validate content on write to prevent wrong captures.** Rejected: it
contradicts ADR-0002 directly. The cost of a false rejection is a silently lost
capture and an agent that learns not to bother; the cost of a wrong document is
a revert.

**Give every agent one key with full scope.** The simplest option and the
current implied default. Rejected: it makes the audit log almost useless for
attribution, and it means a misbehaving research agent can write anywhere. The
narrow-key default costs a little setup and removes a class of incident.

**Have the curator write to a branch for review.** Genuinely attractive — it is
how humans review bulk changes — and rejected for v1 because it requires agents
and humans to understand branch state in a repo they otherwise only ever append
to, and because a brain cloned to several machines makes branch handling a
support burden. The change plan gets the reviewability without the branching.
This is the first thing to reconsider if plan review proves too coarse.

**Per-document locking held across a session**, so an agent can claim a document
while working. Rejected: agents crash and sessions end without cleanup, so held
locks become stale locks blocking real work. Optimistic concurrency fails only
at write time, which is exactly when the agent is present to retry.
