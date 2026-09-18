---
title: ADR-0004 — Lexical search first, behind a vector-ready interface
description: Orama BM25 over an in-memory index. Embeddings are an interface in v1, not a feature — because retrieval here is structured first.
status: accepted
date: 2026-09-18
---

# ADR-0004 — Lexical search first, behind a vector-ready interface

**Status:** Accepted · 2026-09-18

## Context

"A knowledge store for agents" reads as a RAG problem, and the expected answer
is embeddings: chunk the documents, embed them, store the vectors, retrieve by
cosine similarity. It is what most systems in this shape do.

Looking at how the recall agent actually retrieves
([UC-2](../../functional/04-use-cases.md)) gives a different picture. It opens
with `brain_list({ folder: "20-projects/billing" })` and
`brain_search({ q: "billing", folder: "40-decisions" })`. It knows the *shape*
of what it wants — this project's notes, decisions about billing, the playbook
for releases — long before it knows the wording. Folder, tag, type, and links
answer most of that, and they answer it exactly, not approximately.

Semantic search earns its cost on the residual: the query whose vocabulary
differs from the author's. "Why is the queue backing up" against a document
titled "Dunning retry storm". That is a real failure and BM25 does miss it — but
it is the tail, not the trunk, and its frequency rises with corpus size. At the
scale a brain starts at, a couple of hundred documents, there is usually one
obvious match and lexical ranking finds it.

Against that tail gain, embeddings cost a model to ship and load (an ONNX
runtime and weights, or a network call per document and per query), an index
that must be rebuilt when the model changes, chunking decisions that interact
badly with short documents, indexing latency on every write, and a second store
whose staleness is invisible — a stale vector returns a plausible wrong answer
rather than an error.

There is also a structural consideration. The search index is derived and
disposable ([ADR-0003](./0003-git-as-the-history-layer.md)). Whatever goes in it
can be thrown away and rebuilt, which means choosing lexical now forecloses
nothing — provided the callers never learn which kind of retrieval they are
getting.

## Decision

**Ship lexical BM25 search over an in-memory Orama index, behind a `Retriever`
interface that a hybrid implementation can satisfy without any caller changing.**

- **Orama**, in-process, no server, no native dependencies. The index is built
  from the files at startup and kept fresh by a chokidar watch on `BRAIN_ROOT`,
  debounced. `gbrain index --rebuild` rebuilds from scratch.
- **The document is the unit of indexing, not the chunk.** Brain documents are
  short by convention — one idea per file — so chunking would mostly add
  fragmentation and a reassembly problem.
- **Structured filters are first-class, not post-filters.** `folder`, `tag`, and
  `type` narrow the query inside the index, because that is how the recall agent
  actually searches.
- **`90-archive/` is de-prioritised by a rank penalty, never excluded.** Archived
  content stays findable; it just loses to live content. Excluding it would make
  superseded decisions invisible, and reading what was believed at the time is
  half the reason they are kept.
- **`packages/search` exposes `Retriever` and `Embedder`.** `Retriever` is what
  `core` calls and the only thing callers see. `Embedder` is defined and
  unimplemented in v1 — the seam a local ONNX model (bge-small, 384-dim) plugs
  into later, with hybrid retrieval selected by `SEARCH_MODE` and nothing above
  it changing.
- **The index holds no authority.** Deleting `.brain/index` loses nothing. If
  search and the filesystem disagree, the filesystem is right and the index is
  stale.

## Consequences

**Good**
- No model to download, load, or version. Startup is reading files; install is
  `pnpm install`.
- Exact-match retrieval is genuinely better than embeddings for a large share of
  real queries: an error string, a service name, a ticket id, a person's name.
  BM25 finds those precisely, where vectors return neighbours.
- Results are explainable. A BM25 hit can be traced to terms in the document,
  which matters when an agent has to decide whether a result is relevant.
- The index is small and rebuilds in seconds, so index bugs are recoverable by
  deletion rather than by migration.
- Zero additional cost per write and per query — no inference, no API call.

**Costs — these are real**
- **Vocabulary-mismatch queries fail**, and they fail *silently*: the agent gets
  results, just not the right ones, and has no signal that a better match
  existed. This is the one failure mode embeddings would fix and the reason the
  trigger below is watched rather than waited for.
- **No conceptual clustering.** "Everything about resilience" returns documents
  containing the word, not documents about the idea.
- **The whole index sits in memory**, which is fine for thousands of documents
  and not a plan for a hundred thousand.
- **A cold start rebuilds the index**, so a large brain pays a startup cost on
  every process restart.
- **Stemming and tokenisation are English-first**, as configured. A brain in
  another language will rank worse until that is set.

**Trigger to revisit:** the brain passing roughly 300–500 documents, **or**
evidence from real use that agents are searching with vocabulary the authors did
not use — most visibly, an agent writing a near-duplicate of a document that
already existed because its search did not surface it. That second signal is
worth more than the document count, and the near-duplicate guard is where it
shows up. At that point the change is an `Embedder` implementation plus
`SEARCH_MODE=hybrid`, with no caller touched and still no database.

## Alternatives considered

**Embeddings from the start, hybrid retrieval in v1.** Rejected as premature for
the corpus sizes in view: it adds a model, chunking, indexing latency, and a
staleness failure that returns confident wrong answers, to fix a tail that is
small at a few hundred documents. It is also the part of the system most likely
to be rebuilt anyway as local embedding models improve — building it last costs
less than building it twice.

**A hosted vector store (Pinecone, Qdrant, pgvector).** Rejected: it introduces a
service, network latency on every query, and content leaving the machine — for a
product whose premise is a folder of markdown that works offline and survives
the project being deleted.

**A hosted embedding API rather than a local model.** Rejected for the same
reason, more sharply: it sends the brain's content to a third party on every
write. A brain that is safe to run on a laptop with no network is worth more
than better tail recall.

**`grep`/ripgrep with no index at all.** Tempting for how little it is — no
index, no staleness, always correct. Rejected because it has no ranking, no
snippets, and no metadata filtering, so an agent gets forty equal hits and
cannot tell which is current. Ranking is most of what makes a result useful to
an agent that will only read the top few.

**SQLite FTS5 instead of Orama.** A reasonable option: mature, well-ranked,
persistent. Rejected for v1 mainly to avoid a native dependency in a package
meant to install cleanly everywhere, and because persistence buys little when
the index is disposable and rebuilds in seconds. If memory becomes the binding
constraint, this is the first thing to reconsider — and the `Retriever`
interface makes it a swap rather than a rewrite.
