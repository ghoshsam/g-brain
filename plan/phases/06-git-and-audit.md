---
title: Phase 6 — Git and audit
description: Commit per write, history and revert, and the append-only audit log that records what git cannot.
---

# Phase 6 — Git and audit

**Status:** complete — 201 tests passing
**Delivers:** `core/git` and `core/audit` implemented behind the interfaces
phase 3 defined.

## Why

Three of the six success criteria depend on this phase. Nothing is lost (S4)
means every write is recoverable; "which agent wrote this?" is answerable
without a database; and the curator's every action is reviewable and revertible,
which is what makes destructive-looking hygiene safe to run
([ADR-0003](../../docs/technical/12-adr/0003-git-as-the-history-layer.md)).

It comes after the CLI because the write path has to be correct before it starts
producing commits, and because a bug here that rewrites history is much worse
than one that does not commit at all.

## Scope

**In:** commit-per-write with debouncing, commit authorship, `brain_history`,
reading at a revision, revert, `.brain/audit.jsonl`, drift records.
**Out:** remote push automation — cadence stays manual by default. Silently
pushing an agent's writes to a shared remote is a surprise worth not having.

## What ships

| Piece | Behaviour |
|---|---|
| Auto-commit | One commit per write when `GIT_AUTOCOMMIT` is on, **default off**. Debounced so bursts batch into one commit rather than fifty |
| Authorship | `agent-name <agent@g-brain.local>`, suffix from `GIT_AUTHOR_SUFFIX`. This is how attribution works with no database |
| Commit message | Operation and path, machine-greppable and human-readable |
| `brain_history` | `git log` over one path — revisions with sha, author, date, message |
| Read at revision | `brain_read({ at: <sha> })` → `git show` |
| Revert | Restores old content as a **new** commit. Never `amend`, never force-push, never rebase the brain repo |
| `.brain/audit.jsonl` | One JSON line per mutating operation: timestamp, actor, action, path, resulting etag, drift flag, outcome, error code where applicable |
| Drift records | A write to a folder the structure document does not describe is written to the audit log with `drift: true` — and the write **succeeded** |

## Why the audit log exists alongside git

Git records what changed. It cannot record what was **refused**, because a
refused write produces no commit — and a rejected `UNSAFE_CONTENT` write is
precisely the event worth keeping, since it is a credential that someone's agent
tried to put in a shared repo. The audit log is the only trace of it.

It is plain text with no integrity guarantee. Anyone with filesystem access can
edit it. It is an operational record, not tamper-evident evidence — consistent
with the brain not being a system of record.

## Definition of done

- [x] FR-20, FR-21, FR-22 implemented and tested.
- [x] `GIT_AUTOCOMMIT` defaults to `false`, and the default is asserted in a
      test.
- [x] A burst of writes produces one debounced commit, not one per write.
- [x] Revert produces a new commit; a test asserts the original commit still
      exists afterwards.
- [x] Rejected writes appear in `audit.jsonl` with no corresponding commit.
- [x] A write to an undeclared folder appears with `drift: true` and
      `outcome: "ok"`.
- [x] A git failure is logged and **does not fail the write** — the document is
      already safely on disk by then, and failing the write would lose it for a
      history problem.
- [x] `gbrain doctor` surfaces drift from the audit log and the filesystem
      consistently.

## Tests

- A write with auto-commit on produces exactly one commit, authored as the
  calling agent, message naming the path.
- Ten writes in one second produce one commit, not ten.
- `brain_history` returns revisions in order; `at: <sha>` returns the content as
  it was.
- Revert restores content and leaves the original commit reachable.
- An `UNSAFE_CONTENT` rejection: no commit, one audit line with the error code,
  nothing on disk.
- A drift write: one commit, one audit line with `drift: true`.
- Simulated git failure (read-only `.git`): write succeeds, error logged,
  operation returns `ok`.
- Auto-commit off: files change, no commits, audit log still written.

## Risks

- **Debounce plus concurrency is where the subtle bug will be.** A commit firing
  mid-write, or two debounce timers racing, can commit a partial set. The
  per-path locks from phase 3 are the defence; test it under concurrent load.
- **Committing into the wrong repo** is the failure with lasting consequences.
  The `BRAIN_ROOT` guard from phase 5 is what prevents it, and this phase is the
  one that makes it matter.
- **Repo growth.** Every revision of every document is kept, which is the point,
  but a high-churn brain grows a repo much larger than its working tree.
  Document `git gc` in operations; do not automate it.
