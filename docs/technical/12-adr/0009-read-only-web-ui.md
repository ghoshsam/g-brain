---
title: ADR-0009 — A read-only web UI, and no identity system
description: The UI lists projects, then browses one project as a folder tree. It never writes, and it introduces no new notion of who a caller is.
status: accepted
date: 2026-09-19
---

# ADR-0009 — A read-only web UI, and no identity system

**Status:** Accepted · 2026-09-19
**Depends on:** [ADR-0008](./0008-project-scope-is-the-project-folder.md), which
makes the project folder the access boundary

## Context

A team wants to see what is in a brain without running an MCP client. Reading
the brain as a git repo already works and stays supported, but it shows the
whole repository or nothing — there is no view that opens at "the projects I can
see" and lets someone walk one of them.

The obvious next step is user identity, so the view can be per person. **It was
considered and deliberately not taken.** An identity system means provider
configuration, sessions, token refresh, a login surface, and something else that
can be down between a team and their notes. That is the largest addition since
v1, in service of a browser for markdown files.

## Decision

**A read-only web UI: list projects, select one, browse its folder tree, read a
document. No new identity system, and no writes.**

- **It introduces no notion of a user.** The UI is a caller like any other, and
  it carries whatever the existing model already gives it — the local actor on a
  trusted local deployment where `AUTH_REQUIRED` is `false`, or a bearer key on
  HTTP, with the profiles from [ADR-0007](./0007-multi-writer-safety.md). A
  `recall` key is exactly the right shape for a browser: read everywhere, write
  nowhere.
- **The project list is directories under `20-projects/`, filtered by the
  caller's read scopes.** A project the caller cannot read is **absent, not
  greyed out** — `core/auth` already declines to name folders a caller cannot
  see, because doing so leaks the shape of the brain, and a UI listing every
  project with some disabled would undo that.
- **Selecting a project shows its real folder tree**, built from the filesystem
  the way `brain_tree` already builds it. The tree says what *is*; nothing
  presents an idealised structure
  ([ADR-0001](./0001-structure-doc-is-prose-not-schema.md)).
- **It browses and searches. It never writes.** No create, edit, delete or move.
  Writes stay on MCP. The non-goal — *not a wiki or a CMS, there is no editing
  UI* — stays true as written, and realtime collaboration stays deferred,
  because nothing holds a document open.
- **It is a third thin surface**, calling `core` and holding no logic, under the
  rule that keeps `apps/mcp` and `apps/cli` thin. The existing architecture
  tests apply to it unchanged.

## Consequences

**Good**
- Small. It is a view over `brain_tree`, `brain_list`, `brain_read` and
  `brain_search` — capabilities that already exist and are already tested.
- Nothing new to secure. The UI cannot do anything the key it carries could not
  already do, and the worst a compromised session does is read what that caller
  could already read.
- No new operational dependency, so the brain stays reachable when whatever
  would have been the identity provider is not.
- The git-repo path keeps working, so the UI is a convenience rather than the
  thing everything now depends on.

**Costs — these are real**
- **"Which person?" stays unanswerable.** Access is per key, not per person, so
  two people sharing a key are indistinguishable, revoking one person's access
  means rotating a key others may hold, and the audit log names a key where a
  team will eventually want a name. **This is the price of not building
  identity, and it is the cost most likely to be felt first.**
- **Project-level access is therefore per key.** Giving one person access to one
  project means issuing and distributing a key scoped to it, by hand. That is
  workable for a handful of people and does not stay workable.
- **A read-only UI invites requests to make it writable**, and a project list
  invites requests to create projects from it. Both reverse recorded decisions
  and need their own ADR, not a pull request.
- **It slightly weakens the "a human needs nothing built" dividend** — there is
  now something to run and keep up, even if the git host still works.

## Alternatives considered

**OIDC user identity alongside agent keys**, with each person carrying folder
scopes. It is the right answer once more than a handful of people need different
project access, and it makes the audit log name people. **Rejected for now on
size**, not on merit: it is a new subsystem in service of a browser. The
interface seam is the `Actor` that `core/auth` already evaluates, so adding it
later does not disturb the UI, the tools, or the authorisation model — only how
an `Actor` is resolved.

**No UI at all**, keeping the git host as the only human surface. Rejected: it
cannot show a viewer only the projects they may see, which is the thing being
asked for.

**An editing UI.** Rejected here, not permanently. It reverses two recorded
non-goals at once, and the second — realtime collaboration — was deferred on the
explicit condition that no surface holds a document open.

## Related

- [ADR-0008](./0008-project-scope-is-the-project-folder.md)
- [ADR-0007](./0007-multi-writer-safety.md) — the key profiles the UI rides on
- [Personas and jobs](../../functional/02-personas-and-jobs.md) — the human reader
