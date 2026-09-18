---
title: Phase 0 — Docs and plan
description: Write down what is being built and why, before any of it is built.
---

# Phase 0 — Docs and plan

**Status:** in progress
**Delivers:** `docs/functional/`, `docs/technical/`, the ADRs, and this phase set.

## Why this phase exists

The product is a filing convention that an LLM reads. Nearly every hard question
in the build — what rejects a write, what is derived, where routing intelligence
lives — is a design question, not a coding one, and answering it in code means
answering it three times inconsistently. So the decisions get written first, with
their costs stated, and the code follows them.

The phase is also the test of whether the idea holds together. If a document
cannot be written without contradicting another, that contradiction is real and
cheaper to find here.

## Scope

**In:** every document under `docs/`, the four ADRs, the phase files in
`plan/phases/`.
**Out:** any package, any dependency, any line of TypeScript.

## Files

| File | State |
|---|---|
| `docs/functional/01-overview.md` … `08-out-of-scope.md` | Done — eight documents |
| `docs/technical/12-adr/0001-structure-doc-is-prose-not-schema.md` | Done |
| `docs/technical/12-adr/0002-safety-only-write-guards.md` | Done |
| `docs/technical/12-adr/0003-git-as-the-history-layer.md` | Done |
| `docs/technical/12-adr/0004-lexical-search-first.md` | Done |
| `docs/technical/01-architecture.md`, `02-tech-stack.md` | Done |
| `docs/technical/03-structure-doc-guide.md` … `10-testing-and-verification.md` | In progress |
| `plan/phases/00-*.md` … `08-*.md` | This set |
| `plan/STATUS.md`, `plan/decisions-log.md`, `plan/00-implementation-plan.md` | Done, kept current |

## Definition of done

- [ ] Every document in `docs/functional/` and `docs/technical/` exists and is
      internally consistent — no document contradicts another on error codes,
      defaults, module boundaries, or scope.
- [ ] Every `FR-nn` in
      [`06-functional-requirements.md`](../../docs/functional/06-functional-requirements.md)
      is stated with criteria a test can assert.
- [ ] Every ADR states context, decision, consequences **including honest
      costs**, alternatives with reasons for rejection, and a trigger to revisit.
- [ ] Every cross-link resolves.
- [ ] Errors are typed codes everywhere — `core` is transport-neutral, so no
      document describes an operation in terms of a transport's conventions.
- [ ] `plan/phases/` has one file per phase, each with scope, files, definition
      of done, and tests.
- [ ] `plan/STATUS.md` reflects reality.

## Tests

No automated tests. Verification is a read-through for consistency, plus a link
check across `docs/` and `plan/`.

The real check is the next phase: if phase 2 starts and a decision turns out not
to have been made, phase 0 was not finished.

## Notes

`plan/decisions-log.md` is the scratch ahead of an ADR. A choice lands there
first and graduates when it is settled. Open items currently parked there:
`60-sessions/` expiry, push cadence, the drift check being heuristic or
LLM-assisted, the near-duplicate threshold, and whether a separate
`packages/contracts` is worth having.
