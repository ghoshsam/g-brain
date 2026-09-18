---
title: Architecture
description: The shape of the system — one core, two thin surfaces, a git repo of markdown, and a disposable index.
---

# Architecture

## The whole system in one picture

```
   Claude Code · Cursor · CI agent            a human
   (MCP client)                               (git host, VS Code, Obsidian)
         │                                          │
         │ stdio  /  streamable HTTP                │ git clone, git push
         ▼                                          │
   ┌───────────────┐      ┌───────────────┐         │
   │   apps/mcp    │      │   apps/cli    │         │
   │  tools        │      │  gbrain init  │         │
   │  resources    │      │  doctor       │         │
   │  prompts      │      │  index, serve │         │
   └───────┬───────┘      └───────┬───────┘         │
           │                      │                 │
           └──────────┬───────────┘                 │
                      ▼                             │
              ┌───────────────┐                     │
              │ packages/core │ ── all behaviour ───┤
              │  structure    │                     │
              │  store        │   ┌──────────────┐  │
              │  guards       │──▶│ packages/    │  │
              │  git, audit   │   │ search       │  │
              │  auth, links  │   │ (Orama BM25) │  │
              └───────┬───────┘   └──────┬───────┘  │
                      │                  │          │
                      ▼                  ▼          ▼
         ┌──────────────────────────────────────────────┐
         │  BRAIN_ROOT — a git repo of markdown         │
         │                                              │
         │  content-structure.md   ← the contract       │
         │  00-inbox/ 10-knowledge/ 20-projects/ ...    │
         │  .brain/  index · audit.jsonl · agents.json  │
         │           (derived + operational, disposable)│
         └──────────────────────────────────────────────┘
```

Three things to read out of it:

1. **Both surfaces call `core` directly.** The CLI does not talk to the MCP
   server, and the MCP server does not talk to anything but `core`.
2. **The brain is a git repo, not a black box.** The human on the right reaches
   the same files with no g-brain process running at all.
3. **`.brain/` is off to one side.** Everything in it is derived or operational.
   Delete it and the brain is intact.

## The hard rule

**All behaviour lives in `packages/core`, as typed, transport-neutral functions
returning typed error results.**

```ts
// core — the shape every operation takes
type Result<T> = { ok: true; value: T } | { ok: false; error: BrainError }

interface BrainError {
  code: 'NOT_FOUND' | 'INVALID_PATH' | 'PRECONDITION_REQUIRED'
      | 'PRECONDITION_FAILED' | 'CONFLICT' | 'UNSAFE_CONTENT'
      | 'TOO_LARGE' | 'RATE_LIMITED' | 'UNAUTHORIZED' | 'FORBIDDEN'
  message: string          // written for an agent to act on
  details?: unknown        // current etag, the conflicting path, the finding
}

writeDoc(ctx: BrainContext, input: WriteInput): Promise<Result<WriteOutput>>
```

`core` never throws for an expected condition, never formats a message for a
particular client, and never knows what called it. `apps/mcp` maps
`Result<T>` onto tool results; `apps/cli` maps it onto exit codes and printed
output. Both mappings are a `switch` on `code`.

What this buys, concretely:

- **One implementation of every guard.** Path containment, secret scanning, and
  the etag check cannot be bypassed by reaching the system a different way,
  because there is no different way to reach it.
- **Authorisation is enforced in `core`, not at the edge.** A surface added
  later inherits it rather than reimplementing it.
- **Tests target `core`.** Surface tests only check the mapping.

## Request path for a write

`brain_write` is the operation the design is built around. In order:

| # | Step | Where | On failure |
|---|---|---|---|
| 1 | Resolve and contain the path | `core/paths` | `INVALID_PATH` — before any filesystem access |
| 2 | Authorise the actor for that folder | `core/auth` | `UNAUTHORIZED` / `FORBIDDEN` |
| 3 | Rate and size check | `core/guards` | `RATE_LIMITED`, `TOO_LARGE` |
| 4 | Scan the body for secrets and PII | `core/guards` | `UNSAFE_CONTENT` — nothing touches disk |
| 5 | Check the etag precondition | `core/store` | `PRECONDITION_REQUIRED` / `PRECONDITION_FAILED` |
| 6 | Near-duplicate check (create only) | `core/guards` | `CONFLICT`, unless `force` |
| 7 | Stamp `created`, `updated`, `id`; lint frontmatter | `core/doc` | never fails — lint findings are warnings |
| 8 | Atomic write: temp file → `fsync` → rename | `core/store` | the file is old or new, never partial |
| 9 | Compute drift against the structure document | `core/structure` | never fails — drift is recorded |
| 10 | Append the audit line | `core/audit` | — |
| 11 | Debounced git commit | `core/git` | — |
| 12 | Notify the index watcher | `packages/search` | — |

Steps 1–6 are the only ones that can reject, and every one of them rejects for
**safety**, never for structure
([ADR-0002](./12-adr/0002-safety-only-write-guards.md)). Step 9 is where a write
to an undeclared folder is noticed — after it has already succeeded.

Steps 10–12 are recorded and deferred work; a failure there is logged and does
not fail the write, because the document is already safely on disk.

## Modules in `packages/core`

| Module | Responsibility | Notable rule |
|---|---|---|
| `structure` | Read `content-structure.md` verbatim; build the folder tree from the filesystem; compute drift | Never parses the document for meaning ([ADR-0001](./12-adr/0001-structure-doc-is-prose-not-schema.md)) |
| `store` | Atomic read/write, etags, per-path locks, soft delete | Etags are content hashes, so external edits are detected |
| `doc` | Frontmatter parse, stamp, lint | Lints; never rejects |
| `guards` | Path containment, secrets/PII, size, near-duplicate, rate | The complete list of things that may reject a write |
| `auth` | Agent keys, per-folder read/write scopes | Enforced here so every surface inherits it |
| `links` | Extract `[[path]]` and relative links; resolve; compute backlinks | Backlinks are derived, never authored |
| `git` | Commit per write, history, revert | Never rewrites history |
| `audit` | Append-only `audit.jsonl` | Logs rejections too |

`packages/search` sits beside `core` rather than inside it, because it is the
one component that is allowed to be stale and is expected to be replaced
([ADR-0004](./12-adr/0004-lexical-search-first.md)).

Each module's purpose, responsibilities, what is explicitly **not** its job, and
its interface are specified in
[component specifications](./11-components/README.md). That document is the
contract phase 3 implements against.

## The surfaces

**`apps/mcp`** — the only network surface. Serves stdio for local clients and
streamable HTTP for remote ones, plus `GET /health` on the HTTP transport. It
exposes tools (`brain_structure`, `brain_read`, `brain_write`, `brain_append`,
`brain_list`, `brain_tree`, `brain_links`, `brain_search`, `brain_history`),
resources (`brain://structure`), and prompts (`define-structure`). Its tool
*descriptions* carry the routing guidance an agent reads, which makes them part
of the product rather than documentation of it. See
[MCP reference](./05-mcp-reference.md).

**`apps/cli`** — `gbrain init | doctor | index | serve`. Calls `core` in-process.
`serve` starts the MCP HTTP transport; the other three are operator commands.

**Neither holds state.** Two `gbrain` invocations and a running MCP server
against the same `BRAIN_ROOT` coordinate through the filesystem — per-path locks
and etags — not through a shared process.

## What the human reader touches

Nothing in this diagram, which is the point. The brain is markdown in a git
repo: the git host renders and searches it, VS Code opens it, Obsidian resolves
`[[path]]` links across it.
[FR-27](../functional/06-functional-requirements.md) makes that a standing
constraint on the build rather than a feature — no custom syntax, no sidecar a
document is incomplete without, nothing essential in `.brain/`.

## Why it is shaped this way

| Property | Comes from |
|---|---|
| Restructuring is an edit, not a migration | The structure document is prose nothing parses ([ADR-0001](./12-adr/0001-structure-doc-is-prose-not-schema.md)) |
| Capture is never blocked for tidiness | Guards are safety-only ([ADR-0002](./12-adr/0002-safety-only-write-guards.md)) |
| Backup is `git push`; nothing to migrate | Git is the history layer, no database ([ADR-0003](./12-adr/0003-git-as-the-history-layer.md)) |
| Retrieval works offline with no model | Lexical search behind a swappable interface ([ADR-0004](./12-adr/0004-lexical-search-first.md)) |
| No surface can disagree with another | All behaviour in `core`; surfaces are mappings |

## Related

- [Component specifications](./11-components/README.md) — every component's interface
- [Tech stack](./02-tech-stack.md)
- [Storage and concurrency](./04-storage-and-concurrency.md)
- [Security](./08-security.md)
