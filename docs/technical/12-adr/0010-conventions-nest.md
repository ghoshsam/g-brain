---
title: ADR-0010 — Conventions nest — a project may carry its own content structure
description: The root document decides what belongs in 20-projects/; a project's own document decides how that project arranges itself. Memory splits by reach for the same reason.
status: accepted
date: 2026-09-19
---

# ADR-0010 — Conventions nest — a project may carry its own content structure

**Status:** Accepted · 2026-09-19
**Extends:** [ADR-0001](./0001-structure-doc-is-prose-not-schema.md), which made
the convention prose, and [ADR-0008](./0008-project-scope-is-the-project-folder.md),
which made the project folder the access boundary

## Context

One `content-structure.md` at the brain root has described the whole brain. It
works for the top-level folders, and it **structurally cannot** describe a
project's internals.

The heading form is a path — `## 20-projects/{project}/`. A document at
`20-projects/billing/memory/pnpm.md` sits in the folder
`20-projects/billing/memory`, which no root heading covers: the placeholder
matches one segment, not an arbitrary depth below it. So **before this ADR,
every subfolder any project created was reported as drift.** Not refused —
guards are safety-only — but reported, on every run, for content filed exactly
as its owners intended. A report that cries wolf gets ignored, which is the
failure mode `gbrain doctor` was built to avoid.

The root document could be extended to enumerate each project's folders, but
that makes one file the union of every project's private arrangement, edited by
everyone, and read in full by every agent at the start of every session.

Separately, `05-memory/` had accumulated files named after the project they
described — `g-brain-non-negotiables.md`, `g-brain-code-style.md`. The prefix
was doing the work a folder should do, and with
[ADR-0008](./0008-project-scope-is-the-project-folder.md) making the project
folder an access boundary, a project's rules living outside that folder means a
reader scoped to the project cannot see the rules for working on it.

## Decision

**Conventions nest. The root document governs the brain's folders; a project's
own `content-structure.md` governs that project's internals. Memory splits the
same way: `05-memory/` for what holds everywhere, `20-projects/{project}/memory/`
for what is only true of one project.**

- **A project document is additive, never a replacement.** The root document
  still decides what belongs in `20-projects/` at all. The project document
  decides only how that project arranges itself.
- **It is optional, and its absence is the normal case.** A project with no
  document behaves exactly as before — flat files, root convention governing. It
  earns one when flat files stop being enough, and deleting it restores the
  previous behaviour with nothing moved.
- **Drift is measured against whichever convention governs the folder** — the
  project's own where it has one, the root document otherwise. A document
  sitting directly in a project folder is never drift, because there is no
  subfolder for a convention to declare.
- **`brain_structure` takes an optional `project`**, returning that project's
  document verbatim and its subtree. Out of scope gives `FORBIDDEN`, checked
  **before** existence, so a project a caller may not read cannot be told apart
  from one that is not there. A project that does not exist gives `NOT_FOUND`.
- **Still nothing parses either document for meaning.** The only extraction is
  the same shallow `## folder/` heading scan that already existed, and it only
  ever reports. [ADR-0001](./0001-structure-doc-is-prose-not-schema.md) is
  intact: this is more prose, not less.

## Consequences

**Good**
- A project subfolder filed on purpose stops being reported as a mistake, so the
  drift report goes back to meaning something.
- A project's rules live inside its access boundary. One scope on
  `20-projects/billing` now reaches billing's notes *and* the rules for working
  on it, instead of needing a second scope elsewhere.
- The root document stays short. It is read at the start of every session, so
  every line in it is paid for repeatedly.
- A project folder stays self-contained, which is what makes archiving it a move
  rather than an extraction.
- Adapting a project is still editing prose — no migration, no redeploy.

**Costs — these are real**
- **There are now two places a rule can live, and the split is a judgement
  call.** "Use pnpm, never npm" is global until the day a second project uses
  npm. Expect rules to sit on the wrong side of the line, and expect moving them
  to be ordinary maintenance rather than a mistake.
- **An agent filing inside a project should read two documents**, not one. The
  root document tells it the content belongs to a project; the project document
  tells it where inside. That is one more call, and an agent that skips the
  second files by the root convention and gets reported as drift — the outcome
  is a report, never a refusal, but it is a worse first experience.
- **A project that has *not* written a convention still gets a drift note the
  moment it creates a subfolder.** The root document names
  `20-projects/{project}/` and no deeper, so nesting relocates the noise rather
  than removing it: it moves from "every project subfolder is drift" to "every
  *undeclared* project subfolder is drift". The answer is a two-line
  `content-structure.md` in the project, which is cheap — but it is a step, and
  a project that never takes it is no better off than before.
- **Routing quality is now a property of more documents.** ADR-0001 already
  accepted that a badly written convention silently degrades filing. This
  multiplies the number of conventions that can be badly written, and nothing
  measures a project-level one — the routing fixture set covers the root
  document only.
- **A project convention can contradict the root one**, and nothing detects it.
  Declaring `## 40-decisions/` inside a project does not make it the brain's
  decisions folder; it makes a project subfolder with a confusing name.

## Alternatives considered

**Enumerate every project's folders in the root document.** Rejected: one file
becomes the union of every project's private arrangement, edited by everyone and
read in full by everyone, and it grows without bound as projects are added.

**Match project subfolders with a deeper placeholder** — a heading like
`## 20-projects/{project}/**/`. Rejected: it silences the drift report rather
than answering it. Every subfolder becomes declared, including the ones nobody
meant to create, which is the same as switching drift reporting off for projects.

**Leave it, and accept the noise.** Rejected on the evidence already recorded in
this project: a report that is wrong on day one is ignored by day three, and
drift reporting is the only thing standing behind safety-only guards
([ADR-0002](./0002-safety-only-write-guards.md)).

**Keep project memory in `05-memory/` with a naming prefix.** This is what was
actually happening, and it works until the access boundary matters. Rejected
because under ADR-0008 it splits a project across two scopes.

## Related

- [ADR-0001](./0001-structure-doc-is-prose-not-schema.md) — the convention is prose
- [ADR-0008](./0008-project-scope-is-the-project-folder.md) — the project folder is the access boundary
- [core/structure](../11-components/03-core-structure.md)
- [Content model](../../functional/05-content-model.md)
