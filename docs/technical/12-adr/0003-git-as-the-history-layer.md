---
title: ADR-0003 — Git is the history layer, and there is no database
description: Markdown on disk is the source of truth. Git provides versioning, diff, blame, and rollback. Nothing essential is stored where the filesystem cannot hold it.
status: accepted
date: 2026-09-18
---

# ADR-0003 — Git is the history layer, and there is no database

**Status:** Accepted · 2026-09-18

## Context

A shared brain that agents write to needs several things a plain folder does not
give you: a record of what changed and who changed it, the ability to read a
document as it was last month, the ability to undo a bad write, and enough
metadata to answer "which agent wrote this?".

The reflexive answer is a database — SQLite next to the files, or Postgres for a
hosted deployment — holding document metadata, revisions, and an audit trail,
with the markdown either inside it or beside it.

Two considerations push the other way.

**The content is already in a format git was built for.** Markdown is
line-oriented text. Git gives versioning, diff, blame, attribution, branching,
and rollback over exactly that, with tooling everyone already has and a remote
that doubles as backup. Every requirement above is a git primitive.

**A database beside the files creates a second source of truth that can
disagree.** A human edits a file in VS Code, or `git pull`s a teammate's
changes, and the database is now wrong. The failure is silent: search returns a
document whose content has changed, the revision list omits the human's commits,
and the metadata describes a version that no longer exists. Keeping the two in
step means watching the filesystem and reconciling — most of a sync engine,
written to defend a store that adds nothing git did not already provide.

The constraint that settles it:
[FR-27](../../functional/06-functional-requirements.md) requires the brain to be
fully readable with nothing but a git host or a text editor. Anything living
only in a database violates that, so a database could hold nothing essential
anyway — at which point it is a cache with an invalidation problem.

## Decision

**Markdown files on disk are the source of truth. Git is the history layer.
There is no database.**

- **Every write produces a commit** when `GIT_AUTOCOMMIT` is on, authored as the
  calling agent (`agent-name <agent@g-brain.local>`), with a message naming the
  operation and the path. Bursts are debounced, so a flurry of writes batches
  into one commit rather than fifty.
- **History and revert are git.** `brain_history` is `git log` over one path;
  reading `at: <sha>` is `git show`; revert writes the old content as a **new**
  commit. History is never rewritten — no amend, no force-push, no rebase of the
  brain repo.
- **`.brain/audit.jsonl`** is an append-only JSON-lines log of every mutating
  operation: timestamp, actor, action, path, resulting etag, drift flag,
  outcome. It records what git cannot — **rejected** writes, which produce no
  commit and are exactly the events worth keeping. A rejected secret write is a
  security event with no other trace.
- **`.brain/` holds only derived and operational state:** the search index,
  computed backlinks, agent keys, the audit log. Deleting the index loses
  nothing; `gbrain index --rebuild` regenerates it from the files.
- **Etags are content hashes** computed from the file, not sequence numbers from
  a store. A file edited outside g-brain gets a new etag automatically, so
  optimistic concurrency stays correct across external edits.
- **The brain repo is separate from any source repo**, and `BRAIN_ROOT` never
  defaults inside one — it defaults to `~/brain`. Auto-committing an agent's
  captures into a working tree is the accident this rule exists to prevent.
- **`GIT_AUTOCOMMIT` defaults to off.** Writing to a repository is a side effect
  nobody should get unasked.

## Consequences

**Good**
- Backup is `git push`. Sync between machines is `git pull`. Neither is a
  feature anyone has to build or operate.
- History, diff, blame, and attribution work with tools that already exist, over
  a format humans read. Reviewing what the agents wrote last week is
  `git log -p`.
- Nothing to migrate, back up separately, or keep schema-versioned.
- External edits are first-class. A human editing files directly, or pulling a
  teammate's commits, cannot desynchronise anything, because there is nothing to
  be out of sync with.
- Recovery from corrupted derived state is deleting `.brain/` and rebuilding.

**Costs — these are real**
- **Queries a database would answer in one statement take a filesystem walk.**
  "Every document tagged `auth` updated since March" means reading frontmatter
  across the corpus. Fine at hundreds to low thousands of documents; genuinely
  slow past that. The search index absorbs most of it, and being derived, it can
  be rebuilt whenever it is wrong.
- **Git operations cost tens of milliseconds and serialise.** A burst of
  concurrent writes queues behind the commit. Hence debouncing, and hence
  `GIT_AUTOCOMMIT` being switchable off for bulk import.
- **No transactions across documents.** A curator moving twelve files makes
  twelve writes; a crash halfway leaves six moved. The mitigation is that every
  step is individually atomic and individually reversible — not that the set is
  atomic.
- **The repo grows forever.** Every revision of every document is kept, which is
  the point, but a brain with heavy churn will have a repo much larger than its
  working tree. `git gc` helps; nothing else is planned.
- **Merge conflicts are possible** when a brain is cloned to several machines
  and both write. They surface as ordinary git conflicts in markdown, which is
  the most tractable form the problem takes, but g-brain does not resolve them.
- **The audit log is append-only text with no integrity guarantee.** Anyone with
  filesystem access can edit it. It is an operational record, not tamper-evident
  evidence — consistent with the brain not being a system of record.

**Trigger to revisit:** brains where a filesystem walk is too slow for
interactive use and the search index cannot absorb the query — realistically
past several thousand documents with heavy metadata filtering. The answer then
is a **derived, disposable** index (SQLite in `.brain/`, rebuilt from the files,
never authoritative), not a store the files depend on. The moment anything
exists only in a database, FR-27 is broken and the brain stops being readable
without g-brain.

## Alternatives considered

**SQLite beside the files, authoritative for metadata and revisions.** Rejected:
the second-source-of-truth problem in full. Every external edit — a human in VS
Code, a `git pull` — desynchronises it, and defending against that is a sync
engine guarding a store whose only unique contribution is faster queries.

**SQLite as a pure derived cache, rebuilt from the files.** Not rejected on
principle — this is the named revisit path — but rejected for v1 as premature.
The corpus sizes in view are small, the Orama index already covers text and
metadata filtering, and adding a second derived store now means two things to
invalidate before either is needed.

**Postgres, with the markdown stored in it.** Rejected outright: the files stop
existing as files, git stops applying, and the brain becomes unreadable without
g-brain running — losing portability, the editor workflow, and the property that
the content survives this project being deleted.

**Files with no git at all** — atomic writes plus an audit log. Rejected: no
history, no revert, no attribution beyond the log, no backup story, and no way
to read a document as it was. Git costs one `git init` and supplies all of it.

**A commit per session or per batch rather than per write.** Rejected as the
default: per-write commits give exact attribution and single-document revert.
Debouncing recovers most of the efficiency without losing granularity, and a
bulk-import path can turn auto-commit off and commit once at the end.
