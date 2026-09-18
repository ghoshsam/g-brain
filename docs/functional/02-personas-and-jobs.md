---
title: Personas and jobs
description: Who uses g-brain, what each is trying to get done, and what they need from the system.
---

# Personas and jobs

Four consumers. Three are agents; one is human. Designing for the agents first
is deliberate — they are the high-volume users, and they are the ones who fail
silently when the system is unclear.

---

## 1. The capture agent

**Who:** Claude Code, Cursor, or a CI agent, mid-task, that has just learned
something worth keeping.

**Job:** *When I learn something that will still matter next month, I want to
put it where it will be found, without stopping to ask a human where it goes.*

**Needs**
- A structure document it can read and act on in one call.
- A blessed way to say "I don't know where this goes" — otherwise it guesses,
  and a wrong guess is invisible.
- A cheap duplicate check, because it will try to write the same note twice.
- A write that either succeeds or fails loudly. A half-written file is worse
  than no file.

**Fails when** the structure is ambiguous, the write is rejected for a
formatting reason, or filing correctly takes more effort than not filing at all.
A brain that rejects captures trains agents to stop capturing — this is the
single most important failure mode in the design.

---

## 2. The recall agent

**Who:** An agent starting cold on a task, with no session history.

**Job:** *Before I start, I want to know what has already been decided, tried,
and learned about this, so I don't redo work or contradict a past decision.*

**Needs**
- Structured retrieval first — "decisions about billing", "everything in this
  project" — because it usually knows the shape of what it wants, not the
  wording.
- Full-text search for when it doesn't.
- Backlinks, to follow from one relevant doc to the rest of the cluster.
- Enough result metadata (title, folder, updated date, status) to decide what
  to open without opening everything.

**Fails when** search returns forty results with no way to tell which is
current, or when the relevant doc exists but is buried in an undated session log.

---

## 3. The curator agent

**Who:** A scheduled or manually invoked agent doing hygiene.

**Job:** *I want the brain to stay worth reading — no duplicates, no stale
content, no orphans, an empty inbox.*

**Needs**
- A drift report: which files do not match what `content-structure.md`
  describes.
- Near-duplicate candidates.
- Inbox contents with their stated filing reasons.
- Expired and stale content (old sessions, passed `expires` dates).
- The ability to move, merge, and archive — reversibly.

**Fails when** cleanup is destructive or unreviewable. Every curation action
must land as a git commit a human can read and revert.

---

## 4. The human reader

**Who:** Anyone on the team who wants to know what the agents know. Often
someone who will never run an MCP client.

**Job:** *I want to browse and search what has accumulated, and trust that what
I'm reading is current.*

**They read the brain as a git repo.** It is markdown in a repository, so the
git host already renders the folder tree, `content-structure.md`, and each
document, and searches their text; VS Code or Obsidian open the same files
locally, with Obsidian resolving `[[...]]` links. This persona needs nothing
built, which is the reason the content model refuses to store anything in a form
only g-brain can read.

**Needs**
- Navigation that reflects the real folder structure — which the repo is, by
  construction.
- Full-text search over the content.
- Visible signals of currency — updated date, status, superseded-by — which is
  why they live in frontmatter the git host renders rather than in a database.
- To read the structure document itself, because that is the team's filing
  convention and it is worth agreeing on. It sits at the repo root.

**Fails when** they read stale content with no indication it is stale — which is
why currency signals are frontmatter fields that render, and why the curator
keeps `superseded-by` accurate rather than deleting the old document.

---

## A fifth, briefly: the operator

Whoever runs it. Needs `gbrain init` to work first time, `gbrain doctor` to
tell the truth, config that is one env file, backup that is `git push`, and an
audit log that answers "which agent wrote this?" without a database. Covered in
[operations](../technical/09-operations.md).

---

## What this implies for the design

| Persona need | Design consequence |
|---|---|
| Capture agent must not be blocked | Write guards are safety-only. No folder whitelist, no required-frontmatter rejection ([security](../technical/08-security.md)) |
| Capture agent must be able to admit uncertainty | `00-inbox/` exists in every preset and the structure doc explicitly blesses it |
| Recall agent knows shape before wording | Folder and tag filters come before full-text; lexical search is enough for v1 ([search design](../technical/06-search-design.md)) |
| Recall agent follows clusters | Backlinks are computed, not authored |
| Curator must be reversible | Git commit per write; soft delete to archive ([git and audit](../technical/07-git-and-audit.md)) |
| Human needs truth, not the ideal | Humans read the repo itself, so navigation *is* the real tree — nothing can present an idealised structure |
| Human needs no build step | Documents stay plain markdown with YAML frontmatter and legible paths; nothing is stored in a form only g-brain can read |

## Related

- [Use cases](./04-use-cases.md) — these jobs as concrete flows
- [The agent contract](./07-agent-contract.md) — the rules agents follow
