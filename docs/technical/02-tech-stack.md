---
title: Tech stack
description: Every dependency, why it is there, and what it would take to remove it.
---

# Tech stack

The selection rule: **prefer no dependency, then a small one, then a boring
one.** Anything that cannot be removed without redesigning the system has to
earn that.

## Runtime and language

| Choice | Version | Why |
|---|---|---|
| Node.js | ≥ 20 LTS | The MCP TypeScript SDK's runtime. Stable `fs.promises`, `AbortSignal`, and native test tooling |
| TypeScript | 5.x, ESM, `strict` | The whole contract between `core` and the surfaces is types. `strict` is not optional |
| Module format | ESM only | No dual build. The MCP SDK and Orama are both ESM-first |

**Node, not Bun or Deno.** The MCP ecosystem is tested against Node, `gbrain`
has to install on machines that already have Node for other reasons, and nothing
here is performance-bound.

## Workspace

| Choice | Why |
|---|---|
| pnpm workspaces | Strict by default — a package cannot import something it did not declare, which is what keeps `apps/*` thin in practice rather than by convention |
| Turborepo | Task graph and caching across `build`, `test`, `lint`. Six packages is enough to want it and few enough that it stays out of the way |
| Biome | Lint and format in one tool, one config, fast. Replaces ESLint + Prettier |
| Vitest | ESM-native, fast watch, good fixture ergonomics. `@vitest/coverage-v8` for coverage |
| tsup | Bundles each package to ESM with declarations. No bundler config to maintain |
| changesets | Versioning, once anything is published |

**Why a monorepo at all** for one core and two thin apps: the hard rule from
[architecture](./01-architecture.md) — all behaviour in `core` — is enforceable
by the workspace. `apps/mcp` declaring a dependency on `fs` or `simple-git`
directly is visible in a diff and blockable in review.

## Core dependencies

These are the ones `packages/core` actually carries.

| Package | Role | Why this one |
|---|---|---|
| `gray-matter` | Frontmatter parse and stringify | Tolerant of malformed and partial frontmatter, which an agent-written brain will contain. Round-trips without reformatting the body |
| `zod` | Input schemas and typed parsing | The MCP SDK takes Zod schemas for tool inputs, so using it in `core` means one definition serves both the tool contract and internal validation |
| `simple-git` | Commit, log, show, revert | A thin promise wrapper over the `git` binary rather than a reimplementation (`isomorphic-git`). The binary is already installed, already correct, and already what a human uses on the same repo |
| `proper-lockfile` | Advisory per-path locks | Cross-platform, stale-lock handling, no native build. Pairs with etags — see [storage and concurrency](./04-storage-and-concurrency.md) |
| `fast-glob` | Tree walk and listing | Fast, well-tested ignore handling, no native dependency |

**Deliberately absent from `core`:**

- **No web framework.** `GET /health` rides on the MCP HTTP transport's own
  server; it is a handful of lines and needs no router.
- **No ORM, no database driver, no migration tool.** There is no database
  ([ADR-0003](./12-adr/0003-git-as-the-history-layer.md)).
- **No logger framework.** Structured lines to stderr, plus `audit.jsonl` for
  the events that matter.
- **No secret-scanning library.** The rule set is a curated list of ~20 patterns
  maintained in-repo, because a library's rules cannot be reviewed against the
  false-positive cost here — a false positive rejects a capture. See
  [security](./08-security.md).

## Surfaces

| Package | Used by | Why |
|---|---|---|
| `@modelcontextprotocol/sdk` | `apps/mcp` | The reference implementation. Both transports, protocol version handling, and Zod-typed tool registration |
| `commander` | `apps/cli` | Subcommands, help, and parsing without ceremony |
| `@clack/prompts` | `apps/cli` | The `init` interview. Good non-TTY behaviour, so `init` degrades to flags in CI rather than hanging |
| `picocolors` | `apps/cli` | Colour, 2 kB, respects `NO_COLOR` |

## Search

| Package | Role |
|---|---|
| `@orama/orama` | In-memory BM25 index with typed schema and filters |
| `chokidar` | Filesystem watch, debounced, to keep the index fresh |

Both live in `packages/search` behind the `Retriever` interface, so neither name
appears anywhere else in the codebase. That is what makes them replaceable
([ADR-0004](./12-adr/0004-lexical-search-first.md)).

Not installed in v1: any embedding runtime. `Embedder` is an interface with no
implementation, and `onnxruntime-node` plus a bge-small model is what satisfies
it later.

## Configuration

Environment variables, read once at startup into a typed, Zod-validated config
object. No config file format, no layering, no merge order.

| Variable | Default | Notes |
|---|---|---|
| `BRAIN_ROOT` | `~/brain` | **Never defaults inside this source repo.** Anchored to `$HOME`, not `cwd`, so it cannot follow you into a working tree |
| `GIT_AUTOCOMMIT` | `false` | Writing to a repository is a side effect nobody should get unasked |
| `GIT_AUTHOR_SUFFIX` | `@g-brain.local` | Commits are authored as `agent-name <agent@g-brain.local>` |
| `GIT_DEBOUNCE_MS` | `2000` | Quiet period after the last write before one commit covers the burst |
| `MCP_TRANSPORT` | `stdio` | `stdio` or `http` |
| `MCP_HTTP_PORT` | `8787` | HTTP transport only |
| `AUTH_REQUIRED` | `true` for HTTP, `false` for stdio | stdio is a local child process; HTTP is not |
| `MAX_DOC_BYTES` | `262144` | 256 kB. A larger body is a malfunction, not a capture |
| `RATE_LIMIT_PER_MINUTE` | `120` | Token bucket per key. A guard against a runaway loop, not a defence against an attacker |
| `AUDIT_MAX_BYTES` | `8388608` | 8 MiB, then `audit.jsonl` rotates by rename — never by truncation |
| `AUDIT_KEEP` | `8` | Rotated audit files retained |
| `DUPLICATE_THRESHOLD` | `0.9` | Trigram similarity. A guess until tuned against real captures |
| `SEARCH_MODE` | `lexical` | The seam hybrid retrieval arrives through |
| `SESSION_EXPIRY_DAYS` | `90` | Reported by `doctor`; expiry archives, never deletes |

`.env.example` in the repo root is the canonical list; the table above is the
explanation. `GBRAIN_KEY` is the one variable that is *not* server config — it
is set in an MCP client's `env` block to present a bearer key, and is described
in the [MCP reference](./05-mcp-reference.md).

## Packaging

- **npm package** — `gbrain` with a `bin`, so `npx g-brain init` works with
  nothing installed.
- **Docker image** — Node 20 slim, `git` present in the image (`simple-git`
  shells out to it), `BRAIN_ROOT` mounted as a volume, HTTP transport by
  default. The image must never bake a brain into itself.

## Versions and upgrades

Exact versions are pinned in the lockfile and ranges kept narrow. The two
dependencies with real upgrade risk:

- **`@modelcontextprotocol/sdk`** — a young protocol with a moving spec. The
  mitigation is that `apps/mcp` is a mapping layer; an SDK break touches one
  package and no behaviour.
- **`@orama/orama`** — an index format change means rebuilding the index, which
  costs seconds and loses nothing, because the index is derived
  ([ADR-0003](./12-adr/0003-git-as-the-history-layer.md)).

Everything else is either trivially replaceable or the standard tool for its job.

## Related

- [Architecture](./01-architecture.md)
- [Operations](./09-operations.md) — deployment and the full env reference
- [Search design](./06-search-design.md)
