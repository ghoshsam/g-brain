---
title: Content model
description: What a document is, the frontmatter fields, the default folders, and the lifecycle content moves through.
---

# Content model

## A document

One markdown file. The path is its identity; there is no separate ID system and
no index that must agree with the filesystem.

```
---
title: OIDC token refresh
type: how-to
tags: [auth, oidc]
created: 2026-09-18
updated: 2026-09-18
---

Access tokens are refreshed by ... (lead with the answer)
```

- **Path is identity.** Moving a file renames the document. Git records the move,
  and `gbrain doctor` reports links that pointed at the old path.
- **Frontmatter is linted, not enforced.** A document missing `title` is written
  successfully and reported as a warning. A brain that rejects captures trains
  agents to stop capturing — see
  [ADR-0002](../technical/12-adr/0002-safety-only-write-guards.md).
- **`created`, `updated`, and `id` are stamped by `core`** on write if absent,
  so an agent never has to think about them.

## Frontmatter fields

| Field | Required | Meaning |
|---|---|---|
| `title` | Expected | A human sentence, not a restatement of the filename |
| `type` | Expected | One of the types below |
| `tags` | Expected | Lowercase, reused rather than invented |
| `created` | Stamped | Date first written |
| `updated` | Stamped | Date last written |
| `id` | Stamped | Stable id, survives a move |
| `status` | Optional | `draft` \| `active` \| `superseded` |
| `project` | Optional | Project slug, for cross-folder grouping |
| `repos` | Optional | Repositories this relates to. Context, never identity |
| `source` | Optional | Where this came from — URL, ticket, conversation |
| `supersedes` / `superseded-by` | Optional | Path of the other document |
| `needs-filing` | Inbox only | `true`, with a one-line reason in the body |
| `expires` | Optional | Date after which this should not be trusted |

**Types:** `concept`, `how-to`, `reference`, `decision`, `playbook`, `note`,
`status`, `meeting`, `profile`, `session`, `memory`. The `product-team` preset adds
`spec` and `incident`. Types are a convention for filtering, not a schema —
adding one is editing the structure document.

## Default folders

Full prose in [`seed/presets/default.md`](../../seed/presets/default.md); this
is the summary.

| Folder | Holds | Lifespan |
|---|---|---|
| `00-inbox/` | Unplaced captures, `needs-filing: true` | Days |
| `05-memory/` | How we work everywhere — rules an agent applies whatever it is working on | Until corrected |
| `10-knowledge/{topic}/` | Durable reference — how things work | Years |
| `20-projects/{project}/` | Work-scoped notes, status, questions, and the rules true only here | Project |
| `30-people/` | Roles, ownership, working preferences | Ongoing |
| `40-decisions/{yyyy}/` | Choices and reasoning, ADR-style | Permanent |
| `50-playbooks/` | Executable procedures | Until superseded |
| `60-sessions/{yyyy}/{mm}/` | Agent logs and scratch | ~90 days |
| `90-archive/` | Finished or superseded | Permanent, de-prioritised |

The numeric prefixes exist so the folder order in a file listing matches the
order of the sections in the structure document, and so new folders can be
slotted in (`15-specs`, `45-incidents`) without renaming anything.

### A project is a piece of work, not a repository

One g-brain installation serves a whole team across every repository they work
in, and `20-projects/{project}/` holds many projects. `{project}` is a stable
slug chosen once — a project may span several repos, and may have none at all.

The repos it relates to are recorded in `repos:` and in the project's
`README.md`. They are never used to derive the path: that would be a routing
rule, and it could not represent a project spanning three repos or a migration
with no code. It would also break archiving, which is the decisive case — a
finished project folder moves to `90-archive/projects/{name}/`, and you do not
archive a repository that is still in production.

`project:` in frontmatter is what makes this work across folders: durable
knowledge in `10-knowledge/`, the decision in `40-decisions/2026/`, and the
working notes in `20-projects/` can all carry the same slug without sharing a
folder. See [ADR-0005](../technical/12-adr/0005-one-installation-many-projects.md).

### A project may carry its own convention

`20-projects/{project}/content-structure.md`, where a project has one, is the
authority for everything inside that project. The root document still decides
what belongs in `20-projects/` at all; the project's document is additive, never
a replacement.

It is optional, and most projects will not have one. A project without one
behaves exactly as before — flat files, root convention governing. That is the
normal case, not a gap to be filled.

`brain_structure` takes an optional project and returns that project's document
and its subtree instead of the brain's. It is `FORBIDDEN` when the actor cannot
read the project, checked before existence so that a project out of scope cannot
be told apart from one that does not exist, and `NOT_FOUND` when there is no such
project. The folder is the boundary being checked, which is what
[ADR-0008](../technical/12-adr/0008-project-scope-is-the-project-folder.md)
settles.

Drift is measured against whichever convention governs the folder: the project's
own where it has one, the root document otherwise. A document sitting directly in
the project folder is never drift — there is no subfolder there for a heading to
declare. A subfolder of a project that has no convention of its own is measured
against the root document, which names `20-projects/{project}/` and no deeper, so
it is reported as drift until the project declares it. That is a note to tidy up,
never a refusal ([ADR-0002](../technical/12-adr/0002-safety-only-write-guards.md)).

The cost is a second place to look. Someone reading a project folder has to know
whether it files things its own way before trusting the root document about it,
and two documents can drift apart in wording. That is why the root document
points at the project's rather than trying to describe project internals itself,
and why `brain_structure` returns one or the other instead of merging them.

### The distinction that carries the most weight

**Knowledge vs project.** The test in the structure document — *if this project
were cancelled tomorrow, would this still be worth keeping?* — is what stops
the brain becoming a graveyard of dead project folders containing all the useful
content. Every preset states it explicitly, and the curator agent enforces it
after the fact by promoting knowledge out of finished projects.

**Memory vs knowledge.** `05-memory/` holds rules an agent applies;
`10-knowledge/` holds explanations an agent looks up. "Use pnpm, never npm" is
memory. "How our package resolution works" is knowledge. The test is whether an
agent starting cold needs to apply it without being asked.

**Memory also splits by reach.** `05-memory/` holds only what is true everywhere,
whatever an agent is working on — "never commit unless asked". A rule true of a
single project goes in `20-projects/{project}/memory/`, where it sits inside the
thing it describes and travels with it into the archive when the project ends.
The project folder is already the access boundary
([ADR-0008](../technical/12-adr/0008-project-scope-is-the-project-folder.md)), so
a scope on a project covers its memory too, rather than needing a second scope on
a slice of `05-memory/`. The rule of thumb the presets state: if you are about to
name a memory file after a project, it belongs in that project.

The cost is two places to read at the start of a session instead of one. What is
bought is that `05-memory/` stays short enough to be worth reading every time,
and that rules for work nobody is doing today are not in it.

`05-memory/` exists because agentic tools accumulate exactly this kind of fact and
currently scatter it into per-repo rules files, which is the problem
[the overview](./01-overview.md) opens by naming. Splitting by reach is the same
move made one level down: a rule lives with the smallest thing it is true of.

**Sessions are the known trap.** Agents naturally log what they did, and that
log is where durable findings get buried. Every preset warns about this in the
session folder's own section, and `brain-curate` checks for it.

## Lifecycle

```
capture ──▶ 00-inbox/ ──▶ filed folder ──▶ 90-archive/
             (uncertain)        │
                                ├──▶ superseded by a newer doc
                                │     (supersedes / superseded-by, both kept)
                                └──▶ promoted 60-sessions/ ──▶ 10-knowledge/
```

- **Filing** happens at write time by the agent, or later by the curator.
- **Superseding** never rewrites: accepted decisions in particular are immutable
  by convention — a new document links back and the old text survives. The
  record of what was believed at the time is the point.
- **Archiving** mirrors the original path (`20-projects/foo/` →
  `90-archive/projects/foo/`). Content is archived, not deleted; search
  de-prioritises `90-archive/` rather than excluding it.
- **Expiry** applies to `60-sessions/` by default (~90 days) and to anything
  with an `expires` date. Expiry archives; it does not delete.

## Links

`[[10-knowledge/auth/oidc-token-refresh.md]]`, relative to the brain root.
Standard relative markdown links work too. Backlinks are computed when the index
builds and returned by `brain_links`, so authoring one direction makes a
document findable from both. An unlinked document is nearly invisible, which is
why every preset pushes linking as the cheapest thing an agent can do.

The `[[path]]` form is chosen because Obsidian resolves it natively, so a human
who clones the brain can walk the link graph both ways without anything being
built for them.

## What is deliberately not modelled

No tags taxonomy enforcement, no per-folder schemas, no required fields, no
document relationships beyond links and supersedes. Every one of those would
turn a capture into a negotiation with a validator, and the capture would stop
happening.

## Related

- [Onboarding](./03-onboarding.md) — changing this model for your team
- [Storage and concurrency](../technical/04-storage-and-concurrency.md)
