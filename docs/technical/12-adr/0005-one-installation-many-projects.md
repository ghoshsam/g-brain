---
title: ADR-0005 — One installation, many projects. A project is a name, not a repo
description: One BRAIN_ROOT serves a whole team across every repo they work in. A project is a stable slug chosen once, and the repos it spans are recorded as metadata rather than used as identity.
status: accepted
date: 2026-09-18
---

# ADR-0005 — One installation, many projects. A project is a name, not a repo

**Status:** Accepted · 2026-09-18

## Context

Two questions arrive together the first time someone deploys this, and they have
the same answer.

**How many brains?** The instinct is one per repo — it puts the knowledge next
to the code, and it is where a `CLAUDE.md` would live.

**What is a project?** `20-projects/{project}/` needs `{project}` to mean
something stable. The instinct is to derive it from the repository the agent is
working in: read `git remote get-url origin`, slugify, done. It is unambiguous,
automatable, and consistent across sessions with no judgement required.

Both instincts are wrong, for reasons that turn out to be the same reason.

**On one brain per repo.** This is the failure
[`01-overview.md`](../../functional/01-overview.md) opens by naming: per-repo
rules files are "scoped to one repo, edited by hand, and they describe how to
work, not what the team knows". A brain per repo means an agent starting on
Monday in the billing service knows nothing an agent learned on Friday in the
billing web app. The product's premise is shared memory —
"deliberately shared; if only one agent reads it, a local file would do".
Sharding by repo removes the sharing and leaves the machinery.

**On project-equals-repo.** A project and a repository are different objects
that happen to correlate:

| | A repository | A project |
|---|---|---|
| Spans | one codebase | often several repos — service, web, infra |
| Requires code | yes | no — a vendor evaluation, a migration, a pricing change, a launch |
| Ends | when it is deleted, which is rarely | when the work is done |
| Then what | stays in production for years | moves to `90-archive/projects/{name}/` |

That last row is decisive. The content model archives a finished project folder.
You do not archive a repository that is still serving traffic.

There is also a structural objection. Deriving a path from `git remote` is a
routing rule — the model would stop reading the prose and start obeying a
lookup, which is exactly what
[ADR-0001](./0001-structure-doc-is-prose-not-schema.md) rejects. The whole
design puts routing judgement in the model reading
`content-structure.md`; carving out one folder as machine-routed is a second
source of truth, and it would be the folder with the most ambiguous membership.

## Decision

**One g-brain installation serves a whole team, across every repository they
work in. A project is a stable, human-chosen name within that brain. The repos
it spans are recorded as metadata and never used as identity.**

- **One `BRAIN_ROOT` per team, not per repo.** One process, one git repo, one
  set of agent keys. Agents on many machines and in many checkouts write to the
  same brain.
- **`{project}` is a kebab-case slug chosen once and kept**, as every preset
  already states. It is a unit of work, it may span several repos, and it may
  have none.
- **The repos a project spans are recorded**, not inferred: a `repos:` list in
  frontmatter, and a `20-projects/{project}/README.md` naming them.
- **An agent picks the project by reading the structure document and the folder
  tree**, exactly as it picks any other path. When it genuinely cannot tell
  which project a repo's work belongs to, it writes to `00-inbox/` with
  `needs-filing: true` — a correct answer, not a failure.
- **`project:` in frontmatter groups across folders**, so knowledge in
  `10-knowledge/`, a decision in `40-decisions/2026/`, and notes in
  `20-projects/` can all carry the same project slug without living in the same
  folder. This already exists in the content model and is the mechanism that
  makes the knowledge-versus-project split survivable.

### How a team runs one brain

| Setup | Mechanism | Use when |
|---|---|---|
| **Hosted** | One `BRAIN_ROOT` on one host; agents connect over MCP streamable HTTP. There is **no sync**, because there is one copy | Any shared team brain |
| **Cloned** | Each machine clones the brain repo; `git pull` and `git push` | One person, several machines |

**Do not mix them.** Several machines writing to clones of one remote is where
merge conflicts and duplicate captures come from. The HTTP transport exists so a
team does not need to.

## Consequences

**Good**
- Knowledge crosses repository boundaries, which is where most of its value is —
  an auth decision made in the platform repo is findable from the web repo.
- Project folders can be archived when the work ends, independently of the code.
- Work with no repository is representable at all.
- One installation to operate, back up, and key: one process, one `git push`,
  one `.brain/agents.json`.
- No routing rule to maintain, and no second source of truth about where things
  go.

**Costs — these are real**
- **Project naming is a judgement call, and judgement drifts.** Without a
  derived identity, `billing`, `billing-svc`, and `billing-platform` can all
  appear. The defences are the structure document telling agents to reuse an
  existing project before inventing one, the folder tree being returned on every
  `brain_structure` call so existing names are visible, and `gbrain doctor`
  reporting near-duplicate project folders. None of these is prevention.
- **Mapping a repo to a project is an inference the agent makes**, and it will
  sometimes be wrong or uncertain. The inbox absorbs the uncertain case; drift
  reporting catches the wrong one after the fact.
- **One brain is one blast radius and one access boundary.** Everyone who can
  read the brain can read every project in it. Where some content must not be
  visible to some readers, the answer is a second brain, not finer permissions
  ([out of scope](../../functional/08-out-of-scope.md)).
- **One installation is one thing to keep running.** A brain that is down is
  down for every project, where per-repo brains would fail independently. The
  mitigation is that the content is a git repo on disk, readable and editable
  with the process stopped.

**Trigger to revisit:** a brain serving groups with genuinely disjoint content
and different access requirements — two departments rather than two projects. At
that point the answer is a second installation, which is cheap by design: a
process, a folder, a git repo. The trigger is **not** project count. A brain with
forty projects in it is working as intended.

## Alternatives considered

**One brain per repository.** Rejected: it recreates the per-repo rules-file
problem the product exists to solve, and it fragments exactly the durable
knowledge `10-knowledge/` is for. It also multiplies operational cost by the
number of repos.

**`{project}` derived from `git remote`.** Rejected: it is a routing rule that
contradicts ADR-0001, it cannot represent a project spanning several repos or a
project with none, and it binds the brain's structure to source-control
topology — so moving a repo, renaming it, or splitting it becomes a
reorganisation of the brain.

**A `projects.json` mapping repos to project slugs**, maintained alongside the
structure document. Rejected for v1 as a second source of truth that would age
silently: it must be edited whenever a repo is added, and when it disagrees with
the prose the agent has two answers. The same information as a `repos:` list in
the project's own `README.md` is discoverable through ordinary search and cannot
drift out of sight. If project-name drift turns out to be a real problem in
practice, this is the first thing to reconsider — as a **hint** the model is
offered, never a rule the server enforces.

**One brain per project.** Rejected: most captures are not project-scoped at all.
`10-knowledge/`, `30-people/`, `40-decisions/`, and `50-playbooks/` span
projects by definition, and a per-project brain has nowhere to put them.
