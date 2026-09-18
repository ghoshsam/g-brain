---
title: ADR-0002 — Write guards are safety-only
description: A write is rejected only for safety. Never for failing to match the structure document — that is recorded as drift.
status: accepted
date: 2026-09-18
---

# ADR-0002 — Write guards are safety-only

**Status:** Accepted · 2026-09-18
**Depends on:** [ADR-0001](./0001-structure-doc-is-prose-not-schema.md)

## Context

Something has to decide which writes the server refuses. The tempting list is
long: reject paths in folders the structure document does not describe, reject
missing `title`, reject a `type` outside the known set, reject a filename that
is not kebab-case, reject a document with two `#` headings. Each rejection is
individually defensible — every one enforces something the structure document
asks for.

The problem is the failure mode they share. The capture agent is mid-task. It
learned something worth keeping and is taking a detour to write it down. If that
detour returns an error, the cheapest recovery available to the agent is to give
up and carry on with its actual task. Nobody is told. The knowledge is lost, and
the loss is invisible — there is no artifact recording that a capture was
attempted and abandoned.

So the cost of a false rejection is not "the agent fixes it and retries". It is
a silent, permanent loss, repeated, with a learned aversion on top: an agent
that has been rejected twice stops treating capture as worth the interruption.

Compare that to the cost of accepting a write in the wrong folder: the document
exists, it is in git, it is in the search index, `gbrain doctor` reports it as
drift, and the curator agent or a human moves it. A misfiled document is a
recoverable error. A missing document is not.

The asymmetry is the whole argument. It points one way, and it holds for every
structural rule — but not for safety, where writing is the irreversible act. A
secret committed to a shared git repo is leaked; "we'll catch it in curation" is
not a remediation.

## Decision

**A write is rejected only when writing it would be unsafe or destructive.
Nothing is rejected for being in the wrong place or the wrong shape.**

Guards that reject — the complete list:

| Guard | Code | Why it rejects |
|---|---|---|
| Path containment | `INVALID_PATH` | A path resolving outside `BRAIN_ROOT`, or not `.md`, is an escape, not a filing mistake |
| Secrets and PII | `UNSAFE_CONTENT` | Irreversible once committed to a shared repo. Nothing is written to disk |
| Size | `TOO_LARGE` | A runaway body is a malfunction, not a capture |
| Near-duplicate | `CONFLICT` | Protects the corpus from silent triplication. **Overridable** with `force: true` |
| Concurrency | `PRECONDITION_REQUIRED` / `PRECONDITION_FAILED` | Prevents losing a concurrent writer's work |
| Authorisation | `UNAUTHORIZED` / `FORBIDDEN` | A key without scope is not a capture problem |
| Rate limit | `RATE_LIMITED` | Protects the process. Carries a retry hint |

Everything else is recorded, not refused:

- **A write to a folder the structure document does not describe succeeds**, and
  is flagged as drift in the audit log and reported by `gbrain doctor`. This is
  [FR-11](../../functional/06-functional-requirements.md#fr-11--writes-to-undeclared-folders-succeed-p0),
  stated as a requirement so it cannot be "fixed" later by someone who reads it
  as an oversight.
- **Frontmatter is linted, not enforced.** A document with no `title` is written
  and reported as a warning. `created`, `updated`, and `id` are stamped if
  absent rather than demanded.
- **An unknown `type`, a non-kebab-case filename, several `#` headings** — all
  written, all lint warnings.

Note the shape of the rejections that remain: near-duplicate is overridable,
concurrency tells the agent exactly how to retry, and each error names what to
do next. Even inside the safety list, a rejection is an instruction, not a wall.
The one exception is `UNSAFE_CONTENT`, which the agent must not retry.

## Consequences

**Good**
- Capture is cheap, so it happens. This is the behaviour the entire product
  depends on.
- Restructuring stays free: no path was ever validated, so no path can become
  invalid when the structure document changes.
- The brain accumulates real content with known imperfections, instead of less
  content with enforced tidiness — and imperfections are reportable.
- The rejections that remain are ones an agent can act on.

**Costs — stated plainly**
- **The brain will contain misfiled documents.** That is designed, not tolerated.
  It depends on curation actually running; a brain where nobody runs the curator
  degrades, slowly and quietly.
- **Drift reports need a reader.** `gbrain doctor` is a report with no
  enforcement behind it, so it is exactly as useful as the attention it gets.
- **Frontmatter is unreliable in aggregate.** Any consumer that filters by `type`
  or `tags` must tolerate missing and unexpected values. This is why
  [FR-27](../../functional/06-functional-requirements.md) requires presentation
  to render partial frontmatter rather than assume it.
- **Near-duplicate detection is a heuristic** (trigram similarity, default 0.9)
  and will both miss duplicates and occasionally flag distinct documents. It is
  the one guard in the list that can be wrong in the costly direction, which is
  why it is overridable and why the threshold is tuned against real captures.

**Trigger to revisit:** evidence that permissiveness is the actual cause of a
brain becoming unusable — drift and duplicates rising faster than curation can
absorb them, in a brain where curation is genuinely running. The first response
is a better structure document and a more frequent curator, not a validator. A
second candidate trigger is a *human-authored* bulk import, where the write is
not an agent's mid-task detour and rejecting is therefore cheap; that argues for
a stricter mode on an import path, never on the capture path.

## Alternatives considered

**Enforce the structure document.** Rejected: it contradicts
[ADR-0001](./0001-structure-doc-is-prose-not-schema.md), makes restructuring a
migration, and rejects the capture that motivated the whole system.

**Warn-then-enforce** — accept for a grace period, then start rejecting once the
brain is established. Rejected: the failure mode does not weaken with time. An
agent capturing into a mature brain is in exactly the same position as one
capturing into a new brain, and the day enforcement turns on is the day capture
rates drop, with no signal that it happened.

**Reject, but write to `00-inbox/` instead of failing.** A genuinely tempting
middle: the agent's content is never lost, and the misfile never lands. Rejected
because it silently discards the agent's judgement — the agent said
`40-decisions/2026/`, the server said inbox, and the agent is not told in a way
it can learn from. It also fills the inbox with content that was correctly
filed, which is the failure the inbox exists to prevent. Recording drift keeps
both the agent's decision and the signal.

**Strict mode as a configuration option.** Rejected for v1: a flag that changes
whether writes are rejected means every agent and every skill must handle both
behaviours, and the strict setting would be turned on by whoever most wants
tidiness and least feels the capture loss. If a real import path needs it, it
belongs on that path, not as a global mode.
