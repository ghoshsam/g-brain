---
title: ADR-0008 — A project is a folder, and that folder is the access boundary
description: Project-level scoping reuses folder scopes. Tools take a project code that resolves to 20-projects/{project}/. Authorisation never reads frontmatter.
status: accepted
date: 2026-09-19
---

# ADR-0008 — A project is a folder, and that folder is the access boundary

**Status:** Accepted · 2026-09-19
**Extends:** [ADR-0005](./0005-one-installation-many-projects.md), which made a
project a stable slug, and [ADR-0007](./0007-multi-writer-safety.md), which made
scopes per folder

## Context

One brain has always been one access boundary: everyone who can read it can read
every project in it. [ADR-0005](./0005-one-installation-many-projects.md) records
that as a cost and offers a second brain as the remedy, and
[out of scope](../../functional/08-out-of-scope.md) says finer control implies an
identity system. A team now needs project-level access inside one brain, which
is the reconsider trigger both documents named.

The obvious implementation is to scope on the `project:` frontmatter field,
since that is already the thing that groups content across folders. **It is
unsafe, and the reason matters more than the conclusion.**

Frontmatter is linted, never enforced
([ADR-0002](./0002-safety-only-write-guards.md)). Any agent can write
`project: finance` into a document body. An authorisation check that reads that
field lets an agent grant itself access by writing a file, or hide a document
from a reader by mislabelling it. It also inverts the write path: authorisation
is step 2 and frontmatter parsing is step 7, so the check would have to parse
agent-supplied content before deciding whether the agent may write it.

**Authorisation must depend only on inputs the caller cannot author.** The path
is such an input. The document body is not.

## Decision

**A project is the folder `20-projects/{project}/`, and that folder is the
access boundary. A project code is that folder's name. Authorisation is the
folder scoping that already exists.**

- **No new authorisation mechanism.** `Scope { folder, read, write }` in
  `core/auth` already matches on whole path segments, so a scope on
  `20-projects/billing` covers `20-projects/billing/**` and does not leak into
  `20-projects/billing-platform`. Project scoping is that, and nothing more.
- **Tools take a `project` code where they take a folder.** It resolves to
  `20-projects/{project}/`. It is sugar over the existing `folder` argument, not
  a second addressing scheme.
- **Listing projects is listing directories** under `20-projects/`, filtered by
  the caller's read scopes. The project list and the access rules cannot
  disagree, because they are the same fact.
- **`project:` frontmatter keeps its job and loses one.** It still groups
  related content across folders for search and filtering. **It is never an
  input to an authorisation decision.** This is a rule about `core/auth`, and it
  is the rule most likely to be broken by someone adding a convenience later.
- **`10-knowledge/` and `40-decisions/` stay team-wide**, as the content model
  intends. Content that must not cross a project boundary lives in the project
  folder.

That last point is the whole trade, and it is a **filing rule, not a code
rule** — a paragraph in `content-structure.md` telling agents that confidential
project material belongs in the project folder. Routing stays prose, which is
[ADR-0001](./0001-structure-doc-is-prose-not-schema.md) working as intended.

## Consequences

**Good**
- **Zero new authorisation code**, so zero new ways to get authorisation wrong.
  The mechanism protecting projects is the one already covered by tests.
- Nothing to keep in sync. No manifest, no mapping table, no question about what
  happens to a document nothing has mapped yet.
- The UI's project list is derived from the filesystem, like the folder tree —
  it says what *is*, never what should be.
- It composes with [ADR-0005](./0005-one-installation-many-projects.md) rather
  than reversing it: a project was already a folder, and the repos it spans are
  still recorded and still never identity.

**Costs — these are real**
- **The knowledge/project split now carries an access consequence.** Promoting a
  finding out of a project folder into `10-knowledge/` — the habit the content
  model pushes hardest, because it is what stops the brain becoming a graveyard
  of dead project folders — now also widens who can read it. Curators must
  understand that, and the structure document has to say so plainly.
- **A decision that must stay project-confidential cannot live in
  `40-decisions/{yyyy}/`.** It lives in the project folder, which bends the
  convention that a decision is filed as a decision. Accepted deliberately: the
  alternative is per-document ACLs.
- **Scopes remain per folder**, so a reader who legitimately needs one document
  from another project still has no way to get it without widening the whole
  folder. Unchanged from ADR-0007, and unchanged by this.
- **Project names become security-relevant.** `billing` and `billing-platform`
  being different scopes makes the naming drift ADR-0005 already warns about
  more expensive than it was.

## Alternatives considered

**An enforced project manifest in `.brain/`** — a file mapping path globs to
projects, unwritable through any operation, with authorisation resolving path →
project. It is safe, and it was the original recommendation. **Rejected as
unnecessary complexity:** it introduces a second source of truth about where
content lives, a maintenance surface, and a decision about what happens to
unmapped documents — to express a grouping the filesystem already expresses. If
the answer is a folder, use the folder.

**Restructuring so `{project}/` is top-level**, holding its own knowledge and
decisions. Rejected: it destroys the knowledge-versus-project split that the
content model calls the distinction carrying the most weight, and makes
cross-project knowledge either duplicated or impossible — which is the value
[ADR-0005](./0005-one-installation-many-projects.md) exists to protect.

**Scoping on `project:` frontmatter.** Rejected as an authorisation bypass; see
Context.

**A second brain per boundary** — the standing answer before this ADR. Still
correct when two groups share nothing. Rejected as the general answer because it
also stops knowledge crossing boundaries, which is where most of its value is.

## Related

- [ADR-0009](./0009-read-only-web-ui.md) — the surface that reads a scope
- [Content model](../../functional/05-content-model.md)
- [Security](../08-security.md)
