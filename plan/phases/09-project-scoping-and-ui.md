---
title: Phase 9 — Project scoping and the read-only UI
description: A project code that resolves to the project folder, and a read-only web UI that shows a caller only the projects they may read.
---

# Phase 9 — Project scoping and the read-only UI

**Status:** not started
**Delivers:** a `project` code on the tools, and a third thin surface over
`core` — a read-only web UI that lists projects, browses one, and never writes.

## Why here

Because almost nothing has to be built. A project is already a folder
(ADR-0005), and `Scope { folder, read, write }` in `core/auth` already matches on
whole path segments, so a scope on `20-projects/billing` already covers that
project and already does not leak into `20-projects/billing-platform`. The
`project` code is sugar over the `folder` argument the tools already take
([ADR-0008](../../docs/technical/12-adr/0008-project-scope-is-the-project-folder.md)).
The UI is a view over `brain_tree`, `brain_list`, `brain_read` and
`brain_search`, all shipped and tested in phases 3 to 7
([ADR-0009](../../docs/technical/12-adr/0009-read-only-web-ui.md)).

It comes after v1 because it is the first thing asked for that v1 cannot do. One
brain has always been one access boundary, and reading the brain as a git repo —
still the supported human surface (FR-27) — shows the whole repository or
nothing.

## Scope

**In:** the `project` code on the tools, resolving to `20-projects/{project}/`;
the read-only web UI — project list, folder tree, document view, search; and the
project list filtered by the caller's read scopes, where a project the caller
cannot read is absent rather than disabled.

**Out:** user identity — no OIDC, no users, no sessions. Any editing in the UI:
create, edit, delete and move stay on MCP. Multi-tenancy: one deployment still
serves one brain.

## What ships

| Piece | Behaviour |
|---|---|
| `project` code | Taken where a tool takes a folder, resolving to `20-projects/{project}/`. Sugar over `folder`, **not a second addressing scheme** |
| Authorisation | `core/auth` unchanged. **No new authorisation code** — that is the main reason this phase is small, and the reason it is not the risk it looks like |
| Project list | Directories under `20-projects/`, filtered by the caller's read scopes. A project the caller cannot read is **absent, not greyed out** — a disabled entry would name a folder the caller may not see |
| Folder tree | The real tree from the filesystem, the way `brain_tree` already builds it. It says what *is*, never the idealised structure ([ADR-0001](../../docs/technical/12-adr/0001-structure-doc-is-prose-not-schema.md)) |
| Document view | Read through `brain_read`, frontmatter included — the same document a git host renders |
| Search | `brain_search`, narrowed by project, returning only what the caller's read scopes already allow |
| The caller | Whatever the existing model gives it: the local actor where `AUTH_REQUIRED` is `false`, or a bearer key on HTTP. A `recall` key is the right shape — read everywhere, write nowhere |
| The surface | Thin, holding no logic, like `apps/mcp` and `apps/cli`. `tests/architecture.test.ts` applies to it unchanged |

## The rule that makes this phase safe

**Authorisation never reads frontmatter.** `project:` keeps its grouping and
search job and loses any part in an access decision, because frontmatter is
linted rather than enforced (ADR-0002) and an agent can therefore write it.
Authorisation depends only on the path, which the caller cannot author. This is
the rule most likely to be broken later by someone adding a convenience.

## Definition of done

- [ ] A tool call with a `project` code reaches the same document as the
      equivalent `folder` argument, and no other path.
- [ ] `git diff` on `core/auth` is empty, or the change is unrelated to
      projects.
- [ ] A caller scoped to one project sees exactly that project in the list, and
      a caller scoped to none sees an empty list rather than an error.
- [ ] The UI cannot write: no tool it calls is a write tool, and a write key
      buys it nothing.
- [ ] `content-structure.md` says plainly that project-confidential content
      lives in the project folder, and that promoting a finding into
      `10-knowledge/` widens who can read it.

## Tests

- A scope on `20-projects/billing` grants `20-projects/billing/**` and denies
  `20-projects/billing-platform/**`. This is an existing property of folder
  scoping; assert it again here, because project naming now depends on it.
- A document carrying `project: finance` in its frontmatter, written into a
  folder the caller may read, is still readable — and one carrying that field in
  a folder the caller may not read is still refused. Frontmatter moves nothing.
- The project list for a narrow key omits the projects it cannot read, and the
  omitted names appear nowhere in the response.
- Every route the UI calls is a read.

## Risks

- **A read-only UI invites requests to make it writable**, and a project list
  invites requests to create projects from it. Both reverse recorded decisions
  and need an ADR, not a pull request.
- **Project names become security-relevant.** The naming drift ADR-0005 already
  warns about now costs more than a confusing folder.
- **Access is per key, not per person** — the accepted cost of not building
  identity, and the one most likely to be felt first. Distributing a
  project-scoped key by hand works for a handful of people and does not stay
  working.

## Undecided

Neither ADR settles these, and this phase should not settle them by accident:

- **What the UI is built with, and where it is served from** — alongside the
  HTTP transport or as its own process.
- **Which tools take a `project` code.** ADR-0008 says tools take it where they
  take a folder; whether that means all of them or the retrieval ones first is
  open.
- **Whether the UI searches across projects** or only within the selected one.
