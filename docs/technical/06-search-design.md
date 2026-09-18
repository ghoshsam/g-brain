---
title: Search design
description: Lexical BM25 over an in-memory Orama index, structured filters first, behind a Retriever interface a hybrid implementation can satisfy without any caller changing.
---

# Search design

Retrieval is **structured first, textual second, links third**. Search is the
middle step, not the front door, and the design follows from that
([ADR-0004](./12-adr/0004-lexical-search-first.md)).

`packages/search` sits beside `core` rather than inside it, because it is the one
component allowed to be stale and expected to be replaced. `@orama/orama` and
`chokidar` are named nowhere else in the codebase
([tech stack](./02-tech-stack.md)).

## The retrieval order an agent actually uses

An agent nearly always knows the **shape** of what it wants before it knows the
**wording**. It wants this project's notes, or decisions about billing, or the
release playbook. Folder, tag, and type answer that exactly; text matching
answers it approximately. So the cheap exact thing goes first.

| Step | Call | When it is the right call |
|---|---|---|
| 1 | `brain_list({ folder, tag, type, status, updatedSince })` | The shape is known and the set is small enough to scan. No query terms are guessed |
| 2 | `brain_search({ q, folder, tag, type })` | The shape narrows the corpus but the wording is what identifies the document |
| 3 | `brain_links({ path })` | One good document is found and the rest of the cluster hangs off it |

This is the order in the [agent contract](../functional/07-agent-contract.md)
and in the shipped skills, and it is why filters are first-class in the index
rather than a pass over the results.

**A shape-only query is `brain_list`, not `brain_search`.** `brain_search`
requires `q`. Filters narrow a text query; they are not a substitute for one, and
a search API that answers filter-only queries quietly becomes a worse `brain_list`
that also depends on the index being fresh.

## The index

One Orama index, in memory, built from every `.md` file under `BRAIN_ROOT`
(`~/brain` by default, anchored to `$HOME` and never resolving inside a source
repo), excluding `.brain/` and `.git/`.

| Field | Orama type | Role | Notes |
|---|---|---|---|
| `path` | `string` | Searchable (weight 1.5), returned | Paths are the document's identity and are legible by design ([FR-27](../functional/06-functional-requirements.md)), so their words are real signal — `40-decisions/2026/use-advisory-locks.md` |
| `title` | `string` | Searchable (weight 3.0), returned | Authored deliberately for retrieval |
| `headings` | `string` | Searchable (weight 2.0) | Every `##`/`###` joined. The document's own summary of itself |
| `tags` | `enum[]` | Filterable | Equality filter inside the index |
| `body` | `string` | Searchable (weight 1.0), stored | Stored because snippets are cut from it |
| `folder` | `enum` | Filterable | The document's immediate folder |
| `ancestors` | `enum[]` | Filterable | Every folder prefix — see below |
| `type` | `enum` | Filterable | `decision`, `how-to`, … Often missing; filters must tolerate that |
| `status` | `enum` | Filterable, returned | `draft` \| `active` \| `superseded` |
| `updated` | `number` | Filterable, returned | Epoch millis, so `updatedSince` is a range filter |
| `archived` | `boolean` | Ranking input | Derived from the `90-archive/` path prefix, not authored |

**`ancestors` exists because folder filters are hierarchical and enum equality is
not.** For `20-projects/billing/dunning.md` the list is
`["20-projects", "20-projects/billing"]`, so `folder: "20-projects"` becomes an
equality test against `ancestors` and still runs inside the index. Without it,
a prefix filter would be a post-filter over the ranked results, which silently
truncates: the top 20 hits get filtered down to three and the fourth-best match
in that folder is never seen.

Frontmatter is parsed with `gray-matter`, the same way `core/doc` parses it, so
the index cannot disagree with a read about what a document's `type` is.

### The document is the unit of indexing

No chunking. Brain documents are short by convention — one idea per file, and a
file needing two `#` headings is two files — so chunking would buy little and
cost two things:

- **Fragmentation.** A 600-word document split into three chunks competes with
  itself for the top of the results, and an agent reading the top three hits
  reads one document three times.
- **Reassembly.** Every hit would need mapping back to a path and a range, and
  the snippet and the score would describe a fragment the agent cannot open —
  the path is the unit an agent reads, writes, and links.

`TOO_LARGE` at 256 kB is the backstop. A document big enough to want chunking is
a document that should have been split, and the error says so.

## Ranking

BM25, with field weights:

| Field | Weight | Why |
|---|---|---|
| `title` | 3.0 | A title is the one line the author wrote to be found by. In a corpus of short documents it is the strongest available signal |
| `tags` | 2.5 | A controlled vocabulary that authors reuse deliberately. A tag match is close to an explicit claim of relevance |
| `headings` | 2.0 | Authored structure. A term in a heading is what the section is about; the same term in the body may be an aside |
| `path` | 1.5 | Folder names and slugs are chosen words, and paths are kept legible anyway |
| `body` | 1.0 | Baseline. High term frequency in a body is weaker evidence than one occurrence in a title |

The weights are constants in `packages/search`, tuned against the retrieval
fixtures in [testing and verification](./10-testing-and-verification.md), not
configuration. A brain whose ranking needs per-deployment tuning has a structure
document problem.

### The `90-archive/` penalty

Hits under `90-archive/` have their score multiplied by **0.25**. They are
de-prioritised, never excluded.

Excluding them would make superseded decisions invisible, and reading what was
believed at the time is half the reason they are kept. A superseded decision
answers "why did we do it that way?" — the question the archive exists for. An
agent that cannot see it either re-decides from nothing or contradicts a decision
it never knew about.

0.25 is chosen so archived content loses to any comparable live document but
still ranks above weak live matches, and wins outright when it is the only match.
Not an environment variable: a brain that needs archived content ranked higher
has an archiving problem, not a configuration problem.

### Snippets

Cut from the stored `body` after retrieval, not stored per document:

1. Locate the densest window of query terms in the body — the smallest span
   containing the most distinct matched terms.
2. Expand to ~240 characters, snapped outward to sentence boundaries.
3. Mark matched terms, and prefix/suffix with `…` where the window is interior.

If no term cluster is found in the body — the match was in the title, tags, or
path — the snippet is the document's first paragraph after the frontmatter. The
[agent contract](../functional/07-agent-contract.md) requires the first paragraph
to carry the answer, so that fallback is a real summary rather than filler.

Snippets are never persisted. They depend on the query, and a stored snippet
would be a third copy of the content to keep in step.

### Result shape

```ts
export interface SearchHit {
  path: string        // brain-root-relative, the document's identity
  title: string       // frontmatter title, or the filename slug if absent
  snippet: string     // query-dependent, ~240 chars
  score: number       // BM25, after the archive penalty. Comparable within one result set only
  updated: string     // ISO 8601
  status?: 'draft' | 'active' | 'superseded'
  type?: string
  tags: string[]
}
```

`status` and `type` ride along because the [agent contract](../functional/07-agent-contract.md)
tells an agent to check `status` before trusting a document, and making it fetch
the document to learn it is `superseded` wastes a read.

No `archived` field: `90-archive/` is visible in the path, and an agent that can
read a path does not need a flag for it.

**Scope filtering happens in `core`, not in the retriever.** The retriever is
scope-blind; `core` drops hits the calling key cannot read before returning
([FR-18](../functional/06-functional-requirements.md), [security](./08-security.md)).
The retriever is therefore asked for more hits than requested — currently three
times `limit`, floor 30 — and `core` truncates after filtering. A heavily scoped
key can still receive fewer than `limit` results, and that is correct: the
alternative is telling it a document exists by returning a padded result set.

## Freshness

A `chokidar` watch on `BRAIN_ROOT`, ignoring `.brain/` and `.git/`, coalesced on
a 300 ms debounce per path. [FR-24](../functional/06-functional-requirements.md)
requires the index to catch up within seconds of a write, which this meets with
room to spare.

The watcher is the only update path. A write through `core` does not push into
the index directly — it touches the file and the watcher notices, the same as a
human saving in VS Code or a `git pull` landing a teammate's commit. One code
path, and no way for an internal write to be indexed while an external edit is
missed.

| Event | Action |
|---|---|
| `add` / `change` on a `.md` file | Re-index that one document |
| `unlink` | Remove that path from the index |
| Rename | Arrives as `unlink` + `add`; no special case |
| More than 50 paths in one debounce window | Full rebuild — a `git pull` or branch checkout is cheaper to rebuild than to apply |
| Watcher error, or a platform watch limit hit | Full rebuild, and log it |
| Startup with no usable snapshot | Full rebuild |
| `gbrain index --rebuild` | Full rebuild, unconditionally |

### Cold start

A build reads every `.md` file, parses frontmatter, and inserts. At a thousand
4 kB documents that is a second or two on a laptop and a corpus-sized chunk of
memory plus the inverted index — a few times the corpus, in practice tens of
megabytes. Fine for thousands of documents; not a plan for a hundred thousand.

A serialised snapshot is written to `.brain/index/` after each build and loaded
on startup, fingerprinted by schema version, document count, and the newest
mtime in the corpus. Any mismatch discards it and rebuilds. Since an external
edit while the process was down invalidates the fingerprint, **plan capacity as
if every start is a rebuild** — the snapshot helps a restarting long-lived
server and does nothing for a one-shot CLI command, which builds in process and
discards.

`brain_search` issued while the initial build is running **waits for it** rather
than failing. The wait is seconds, and there is no typed code for "not ready" —
inventing one would make every caller handle a transient state that resolves
itself.

### The index holds no authority

Deleting `.brain/index/` loses nothing. If search and the filesystem disagree,
**the filesystem is right and the index is stale**
([ADR-0003](./12-adr/0003-git-as-the-history-layer.md)). Concretely:

- A hit is a claim that a document existed. `brain_read` on a stale hit returns
  `NOT_FOUND`, and that is the index being wrong, not the read.
- Nothing decides a write from the index alone. The near-duplicate guard uses it
  for candidates and then reads the files (below).
- `GET /health` and `gbrain doctor` report index freshness as an observation.
  Neither blocks on it.

## Interfaces

`Retriever` is the only thing callers see. `core` depends on this type and on
nothing else in `packages/search`.

```ts
export interface SearchQuery {
  q: string
  folder?: string          // prefix match via `ancestors`
  tag?: string
  type?: string
  status?: string
  updatedSince?: string    // ISO 8601
  limit?: number           // default 10, max 50
}

export interface IndexableDoc {
  path: string
  title: string
  headings: string[]
  body: string
  tags: string[]
  type?: string
  status?: string
  updated: number
}

export interface IndexStats {
  documents: number
  builtAt: string          // ISO 8601
  pendingPaths: number     // debounced, not yet applied
  mode: 'lexical' | 'hybrid'
}

export interface Retriever {
  search(query: SearchQuery): Promise<SearchHit[]>

  /** Candidate generation for the near-duplicate guard. Ranked, not decisive. */
  similar(input: { body: string; folder: string; limit?: number }): Promise<SearchHit[]>

  upsert(doc: IndexableDoc): Promise<void>
  remove(path: string): Promise<void>
  rebuild(): Promise<void>
  stats(): IndexStats
}
```

`Embedder` is defined and **unimplemented** in v1. It exists so that the seam is
designed rather than discovered later
([FR-25](../functional/06-functional-requirements.md)).

```ts
export interface Embedder {
  readonly id: string           // e.g. 'bge-small-en-v1.5' — part of the index fingerprint
  readonly dimensions: number   // 384
  embed(texts: string[]): Promise<Float32Array[]>
}
```

`id` is on the interface because a model change invalidates every vector. It goes
into the snapshot fingerprint, so swapping models forces a rebuild rather than
mixing vector spaces and returning confident nonsense.

Callers construct a retriever and never name an implementation:

```ts
const retriever = await createRetriever(config)   // config.searchMode decides
```

### What enabling hybrid retrieval would take

1. An `Embedder` implementation — `onnxruntime-node` with bge-small-en-v1.5,
   384 dimensions, running locally. No network call, no content leaving the
   machine; that constraint is the whole reason the interface is shaped around a
   local model.
2. Vector storage in the same Orama index (`vector[384]` alongside the existing
   fields), so there is still one index, one build, one fingerprint, and one
   thing to delete.
3. `SEARCH_MODE=hybrid`, and the model bytes on disk.
4. Fusion inside `search()` — reciprocal rank fusion over the BM25 and vector
   result lists, with the archive penalty and the scope filter applied exactly
   where they are now.

**No caller changes.** `SearchQuery` and `SearchHit` are unchanged, `core` is
unchanged, the MCP tools are unchanged, and no agent learns which kind of
retrieval it is getting. Scores stop being BM25 values, which is why the type
says a score is comparable within one result set only.

Cold start and memory both go up — model load plus 384 floats per document — and
the index fingerprint gains a model id. That is the cost of the swap, and it is
the reason it is not being paid now.

## Where search is used besides `brain_search`

### The near-duplicate guard

[FR-16](../functional/06-functional-requirements.md) compares an incoming body
against documents in the same folder. Reading every file in a busy folder on
every create is the naive version; the retriever supplies candidates instead:

1. `retriever.similar({ body, folder })` returns the top ~20 lexical candidates
   in that folder.
2. `core/guards` **reads those files from disk** and computes trigram similarity
   against the real content.
3. Above `DUPLICATE_THRESHOLD` (0.9) → `CONFLICT` naming the existing path.
   `force: true` overrides.

The index narrows the candidate set; it never decides. The decision is made
against bytes on disk, so a stale index can make the guard slower or make it miss
a duplicate — it can never make it reject a write on the strength of a document
that is no longer there. If the retriever is unavailable mid-rebuild, the guard
falls back to walking the folder.

**This guard is also the instrument that measures search quality.** When it fires
on a document the writing agent did not find with `brain_search`, that pair is
direct evidence of vocabulary mismatch: the content existed, the agent looked,
and lexical ranking did not surface it. The audit line records the conflicting
path ([git and audit](./07-git-and-audit.md)), so the evidence accumulates
whether or not anyone is watching for it. That is the signal in the revisit
trigger below.

### `gbrain doctor`

[FR-26](../functional/06-functional-requirements.md). `doctor` builds a fresh
index in process and never trusts the on-disk snapshot — it is a diagnostic, and
a diagnostic that reads a possibly stale cache reports on the cache. From that
index it produces:

- **Near-duplicate sweep.** `similar()` per document, folder-scoped, trigram
  confirmation against the files, reported as pairs. The same mechanism as the
  write guard, run over the whole corpus instead of one incoming body.
- **Index freshness.** Snapshot document count and fingerprint against the
  filesystem, reported as an observation.
- **Empty and near-empty documents**, which index to almost nothing and are
  invisible to search — a failure an agent cannot see from the outside.

`doctor` reports and never modifies. Orphans and broken links come from
`core/links`, not from search.

## Failure modes, stated plainly

- **Vocabulary mismatch fails silently.** "Why is the queue backing up" does not
  match a document titled "Dunning retry storm". The agent gets results — just
  not the right ones — with **no signal that a better match existed**. This is
  the one failure embeddings would fix, and the only reason it is tolerable is
  that the near-duplicate guard eventually makes it visible.
- **No conceptual clustering.** "Everything about resilience" returns documents
  containing the word, not documents about the idea.
- **The whole index sits in memory.** Fine for thousands of documents, not for a
  hundred thousand. This is the binding constraint on brain size, and SQLite FTS5
  is the first thing to reconsider when it binds
  ([ADR-0004](./12-adr/0004-lexical-search-first.md)).
- **Stemming and tokenisation are English-first.** Orama's English stemmer and
  stop-word list, fixed in v1. A brain written in another language ranks worse
  until that is configured, and nothing reports that it is happening.
- **Cold start is linear in corpus size**, paid on every process start in
  practice and on every one-shot CLI command by construction.
- **Rank is not relevance.** BM25 ranks by term statistics. A `superseded`
  document can outrank its replacement if it happens to use the query's wording
  more; `status` is returned so the agent can notice, and the agent contract
  tells it to look.

## Trigger to revisit

Either of:

- The brain passing roughly **300–500 documents**, where the vocabulary-mismatch
  tail stops being a tail.
- **Evidence that agents are writing near-duplicates because their search did not
  surface an existing document.**

The second signal matters more than the document count. A count is a proxy; a
`CONFLICT` on a document the agent searched for and did not find is the failure
itself, recorded, with both paths named. The near-duplicate guard is where it
shows up, which is the strongest practical argument for keeping that guard even
though it is a heuristic that can be wrong.

At that point the change is an `Embedder` implementation plus `SEARCH_MODE=hybrid`
— no caller touched, and still no database.

## Related

- [ADR-0004 — Lexical search first](./12-adr/0004-lexical-search-first.md)
- [Architecture](./01-architecture.md)
- [Tech stack](./02-tech-stack.md)
- [Storage and concurrency](./04-storage-and-concurrency.md)
- [MCP reference](./05-mcp-reference.md) — `brain_search` arguments and errors
- [Operations](./09-operations.md) — `gbrain index`, `gbrain doctor`
- [Testing and verification](./10-testing-and-verification.md) — the retrieval fixtures
