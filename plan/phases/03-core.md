---
title: Phase 3 — Core
description: Every behaviour in the system, as typed transport-neutral functions. The phase the rest of the build depends on.
---

# Phase 3 — Core

**Status:** complete — 159 tests passing
**Delivers:** `packages/core` — structure reader, tree, store, document lint,
guards, links, auth. No surface yet.

## Why

This is the phase where the product actually gets built. Everything after it is
a mapping, a convenience, or a derived index. If `core` is right, `apps/mcp` is
a day and `apps/cli` is a day. If it is wrong, both inherit the wrongness with
no way to correct it at the edge.

Two rules hold throughout, and both are easier to violate here than anywhere
else:

- **Every operation returns `Result<T>`.** No throwing for expected conditions,
  no error messages formatted for a particular caller, no knowledge of what
  invoked it.
- **Guards reject for safety only.** A write to a folder the structure document
  does not describe **succeeds** and is recorded as drift
  ([ADR-0002](../../docs/technical/12-adr/0002-safety-only-write-guards.md)).

## Scope

**In:** the modules below, with full unit coverage.
**Out:** MCP, CLI, git commits (phase 6), the search index (phase 7). `core`
defines the seams those plug into and calls no-op implementations until then.

## Modules

Each module's purpose, responsibilities, non-responsibilities, and **interface**
are specified in
[`11-components/`](../../docs/technical/11-components/README.md). Implement
against those signatures; where this file and that one disagree, that one wins.

| Module | Delivers | Reference |
|---|---|---|
| `core/config` | Zod-validated env config, read once. `BRAIN_ROOT` resolution and the startup guard that refuses a root inside a source repo | [operations](../../docs/technical/09-operations.md#brain_root-placement) |
| `core/paths` | Resolve, normalise, contain. Rejects traversal, absolute paths, symlink escapes, non-`.md`, `.git/`, `.brain/` — before any filesystem access | [security](../../docs/technical/08-security.md) |
| `core/structure` | Read `content-structure.md` verbatim; build the folder tree with counts from the filesystem; compute drift | [ADR-0001](../../docs/technical/12-adr/0001-structure-doc-is-prose-not-schema.md) |
| `core/store` | Atomic write (temp → fsync → rename), content-hash etags, per-path locks, read at path, soft delete | [storage and concurrency](../../docs/technical/04-storage-and-concurrency.md) |
| `core/doc` | Frontmatter parse and stringify, stamp `created`/`updated`/`id`, lint | [content model](../../docs/functional/05-content-model.md) |
| `core/guards` | Secret and PII scan, size, near-duplicate, rate limit | [security](../../docs/technical/08-security.md) |
| `core/links` | Extract `[[path]]` and relative links, resolve, mark broken, compute backlinks | FR-08 |
| `core/auth` | `.brain/agents.json`, key verification, per-folder read/write scopes | FR-18 |
| `core/ops` | The public operations the surfaces call: `readDoc`, `writeDoc`, `appendDoc`, `listDocs`, `getTree`, `getStructure`, `getLinks`, `deleteDoc` | [architecture](../../docs/technical/01-architecture.md) |

## The write path

Implement it in the order given in
[architecture](../../docs/technical/01-architecture.md#request-path-for-a-write),
and preserve that order — it is load-bearing. The secret scan runs **before**
anything touches disk; the etag check runs before the near-duplicate scan
because it is cheaper; drift is computed **after** the write has already
succeeded.

## Definition of done

- [x] Every operation returns `Result<T>`; `core` throws only for genuine bugs.
- [x] FR-01, FR-02, FR-05, FR-06, FR-07, FR-08, FR-09, FR-10, FR-11, FR-12,
      FR-13, FR-14, FR-15, FR-16, FR-17, FR-18 are implemented and tested.
- [x] `core` has no dependency on any transport library.
- [x] Git and search are called through interfaces with no-op implementations,
      so phases 6 and 7 plug in without touching the write path.
- [x] The secret rule set lives in-repo as reviewable patterns, not in a
      dependency.
- [x] Coverage on `core/guards` and `core/store` is materially higher than the
      project average. These two are where a bug loses data or leaks a
      credential.

## Tests

The list from
[`10-testing-and-verification.md`](../../docs/technical/10-testing-and-verification.md),
in full. The ones that must exist before this phase is called done:

- Two concurrent writes to one document → the second gets `PRECONDITION_FAILED`,
  no corruption, both etags accounted for.
- `../../etc/passwd`, an absolute path, a symlinked escape, and a `.txt`
  extension → all `INVALID_PATH`, all before any filesystem access.
- A fake AWS key in the body → `UNSAFE_CONTENT` naming the finding and the line,
  and **nothing on disk**.
- A near-duplicate create → `CONFLICT` naming the existing path; `force: true`
  succeeds.
- **A write to an undeclared folder succeeds and is flagged as drift.** This
  test exists to stop someone later "fixing" the permissiveness as a bug.
- A document with no `title` is written successfully, with a lint warning.
- A crash mid-write (simulated by failing between temp write and rename) leaves
  the original file intact and no partial.
- A file edited outside g-brain gets a new etag, so a stale `ifMatch` fails.
- A read-only key cannot write anywhere; an out-of-scope folder gives
  `FORBIDDEN`.
- `brain_append` under concurrency: two appends to the same document both land.

## Risks

- **Atomic rename semantics differ on Windows.** Test on Windows, not only on
  CI Linux — the primary development machine here is Windows.
- **Near-duplicate threshold is a guess** (0.9 trigram). Ship it configurable,
  and expect to tune it in phase 8 against real captures. Too aggressive blocks
  legitimate writes, which is the failure mode that matters most.
- **Secret scanner false positives reject captures.** Err toward missing a
  novel format rather than rejecting a legitimate document, and log every
  rejection so the rate is visible.
