---
title: Phase 7 — Search
description: Orama BM25 over a watched, disposable index, behind an interface a hybrid implementation can satisfy later.
---

# Phase 7 — Search

**Status:** complete — 216 tests passing
**Delivers:** `packages/search` — index build and query, chokidar watch, the
`Retriever` and `Embedder` interfaces.

## Why here

Recall is half the product, but structured retrieval — `brain_list` by folder,
tag, and type — already works from phase 3, and that is how an agent finds most
of what it wants
([UC-2](../../docs/functional/04-use-cases.md)). Full-text search covers the
residual, so it lands after the write path and history are trustworthy.

It also has one job the rest of the system quietly depends on: the near-duplicate
guard and `gbrain doctor` both need to find similar content, and this is where
that capability lives.

## Scope

**In:** the Orama index, ranking, filters, snippets, the archive penalty, the
watch, `gbrain index --rebuild`, and both interfaces.
**Out:** any embedding implementation. `Embedder` is defined and unimplemented
([ADR-0004](../../docs/technical/12-adr/0004-lexical-search-first.md)).

## What ships

| Piece | Behaviour |
|---|---|
| Index | In-memory Orama, built from the files at startup. The document is the unit of indexing — no chunking; brain documents are one idea per file by convention |
| Ranking | BM25, with `title`, `tags`, and headings weighted above body |
| Filters | `folder`, `tag`, `type` narrow the query **inside** the index, not as a post-filter — this is how the recall agent actually searches |
| Archive | `90-archive/` takes a rank penalty. **De-prioritised, never excluded** — excluding it would make superseded decisions invisible, and reading what was believed at the time is half the reason they are kept |
| Results | path, title, snippet, score, updated, status |
| Freshness | chokidar watch on `BRAIN_ROOT`, debounced; incremental update on change, full rebuild on demand |
| `Retriever` | The only thing callers see |
| `Embedder` | Defined, unimplemented. The seam a local ONNX model plugs into, selected by `SEARCH_MODE` |

## The rule that makes this phase safe

**The index holds no authority.** Deleting `.brain/index` loses nothing. If
search and the filesystem disagree, the filesystem is right and the index is
stale. Every design choice here is allowed to be wrong in a way that a rebuild
fixes — which is what makes shipping lexical-first a low-risk decision rather
than a bet.

## Definition of done

- [x] FR-23, FR-24 implemented and tested; FR-25 shipped as interfaces only.
- [x] `brain_search` returns ranked results with snippets, filterable by
      `folder`, `tag`, and `type`.
- [x] A write is searchable within seconds without a restart.
- [x] `gbrain index --rebuild` rebuilds from scratch; deleting `.brain/index`
      and restarting recovers fully.
- [x] `90-archive/` results rank below equivalent live content and still appear.
- [x] `@orama/orama` and `chokidar` appear in no package other than
      `packages/search`.
- [x] The near-duplicate guard from phase 3 is wired to this, replacing whatever
      placeholder it used.
- [x] `GET /health` reports index freshness truthfully.

## Tests

- Index a fixture brain; assert ranking order for a known query.
- A term in a title outranks the same term in a body.
- Filters narrow correctly, and combine.
- An archived document with an exact-match title ranks below a live document
  with a weaker match, and is still present.
- Write a document → it is searchable within the debounce window.
- Delete the index directory → rebuild recovers every document.
- An external edit (file changed outside g-brain) is picked up by the watch.
- Snippets contain the matched terms.
- The `Retriever` interface is the only export callers use — asserted by a
  dependency test, so hybrid retrieval later cannot leak into callers.

## Risks

- **Vocabulary mismatch fails silently.** The agent gets results, just not the
  right ones, with no signal a better match existed. Nothing in this phase fixes
  that; the honest mitigation is the revisit trigger in ADR-0004 and watching
  for near-duplicates that the guard should have caught.
- **Watch reliability varies by platform and filesystem** — network drives and
  some container mounts drop events. `gbrain index --rebuild` is the escape
  hatch and needs to be documented as such.
- **Cold start cost grows with the corpus.** Acceptable at the sizes in view;
  measure it and record the number rather than assuming.
