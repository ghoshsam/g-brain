# Status

**Last updated:** 2026-09-19 · **Current phase:** 0-8 complete. v1 is built; phase 9 is planned

> New to this project? Read [`DEVELOPMENT-PLAN.md`](./DEVELOPMENT-PLAN.md)
> first — it is the plain-English version of everything here.

## Scope as it stands

v1 = `packages/core` + `apps/mcp` + `apps/cli` + `packages/search` + skills.

MCP (stdio and streamable HTTP) is the only network surface; the `gbrain` CLI
calls `core` directly. Humans read the brain as a git repo — it is markdown on
disk, so the git host, VS Code, and Obsidian already render and search it, and
[FR-27](../docs/functional/06-functional-requirements.md) makes keeping it that
way a constraint on the build.

`BRAIN_ROOT` defaults to `~/brain` and never resolves inside this source repo —
see the [decisions log](./decisions-log.md).

## Done — phase 0 and phase 1 complete

- `plan/00-implementation-plan.md` — baseline
- `plan/decisions-log.md`, `plan/STATUS.md`
- `seed/presets/` — `default.md`, `product-team.md`, `personal.md`, `README.md`
  **(Phase 1 — this is the product's core artifact)**
- `docs/functional/` — all eight documents
- `docs/technical/` — `01-architecture` through `10-testing-and-verification`,
  organised by concern
- `docs/technical/11-components/` — the same system organised by **component**:
  14 documents plus an index, each with what it is, responsibilities, what is
  **not** its job, a mermaid sequence diagram, technical features, and its
  TypeScript interface. This is the contract phase 3 implements against
- `docs/technical/12-adr/` — four ADRs:

  | ADR | Decision |
  |---|---|
  | [0001](../docs/technical/12-adr/0001-structure-doc-is-prose-not-schema.md) | The structure document is prose, not schema |
  | [0002](../docs/technical/12-adr/0002-safety-only-write-guards.md) | Write guards are safety-only |
  | [0003](../docs/technical/12-adr/0003-git-as-the-history-layer.md) | Git is the history layer, and there is no database |
  | [0004](../docs/technical/12-adr/0004-lexical-search-first.md) | Lexical search first, behind a vector-ready interface |

- `plan/phases/00-*.md` … `08-*.md` — one per phase

**Verified across the doc set:** zero broken relative links; all 27 `FR-nn`
mapped to tests in
[`10-testing-and-verification.md`](../docs/technical/10-testing-and-verification.md);
error codes are the typed set everywhere; the environment reference agrees
between [tech stack](../docs/technical/02-tech-stack.md) and
[operations](../docs/technical/09-operations.md).

## Phase 2 complete — the skeleton builds

`pnpm verify` passes from a clean clone: lint, typecheck (6/6), 14 tests, build
(5/5). Node 24 / pnpm 10.5.2 locally; CI runs on Ubuntu **and Windows**, since
atomic rename differs there and Windows is the primary development platform.

- **`packages/contracts` does not exist.** Types live in
  `packages/core/src/types.ts` — one real consumer did not justify a package.
- **`Result<T>` and `BrainError` are shipped**, matching
  [`11-components/README.md`](../docs/technical/11-components/README.md) exactly.
- **No-op `GitPort`, `AuditPort`, `SearchPort`** are in place, so phase 3 builds
  the write path before git and search exist.
- **The architecture rules are tests, not prose.** `tests/architecture.test.ts`
  fails if an app declares `simple-git`, `gray-matter`, `@orama/orama`,
  `chokidar`, or `fast-glob`, if an app imports `node:fs`, or if a core module
  imports `ops`. Verified by deliberately breaking it and watching it fail.

## Phase 3 complete — core works

`pnpm verify` passes: lint, typecheck 6/6, **159 tests**, build 5/5.

All nine modules are in: `config`, `paths`, `structure`, `store`, `doc`,
`guards`, `auth`, `links`, and `ops` — which owns the twelve-step write path.

Proven by test, not by assertion:

- A write to an **undeclared folder succeeds** and is flagged as drift. The
  document is really on disk.
- A document with **no title is written**, with a lint warning.
- A credential is refused with `UNSAFE_CONTENT`, **nothing reaches disk**, and
  the rejection is still recorded — with the rule name and never the secret.
- Two writers with the same etag: the second gets `PRECONDITION_FAILED`,
  re-reads, retries, and nothing is lost.
- A **read-only key cannot write anywhere**, checked across several folders.
- A narrow key cannot see paths it lacks read scope for, including through
  search results.

## Phase 4 — the server runs

`pnpm verify` passes: lint, typecheck, **170 tests**, build. Ten tools, the
`brain://structure` resource, and the `define-structure` prompt, over stdio.

Driven against the built server as a real MCP client would:

```
1. structure   → e2e-brain, 9 folders, missing=false
2. write       → created=true stamped=[created,updated,id]
3. read back   → "Use Postgres advisory locks over Redis" (decision)
4. blind write → PRECONDITION_REQUIRED
5. undeclared  → created=true, drift={"reason":"undeclared-folder"}
6. credential  → UNSAFE_CONTENT
7. list        → 3 documents
```

**Still outstanding in phase 4:** the streamable HTTP transport and
`GET /health`. Key management is deferred with it — see
[`decisions-log.md`](./decisions-log.md).

## Phase 5 — `gbrain init` and `doctor`

`pnpm verify` passes: lint, typecheck, **188 tests**, build.

`gbrain init` creates the brain, `git init`s it, writes a structure document
from a discovered preset, seeds the examples, and prints the MCP snippet.
It refuses a target inside someone else's repo — the accident with lasting
consequences.

`gbrain doctor` reports drift, broken links, orphans, near-duplicates, the
inbox with each item's stated reason, expired content and lint warnings, and
**modifies nothing**. `runDoctor` lives in `core`, so the curator agent can call
it through MCP later rather than shelling out.

Two bugs the tool found in its own project:

- `init` wrote a root `README.md` that `doctor` then reported as drift — a
  permanent false positive on every new brain.
- The seed documents did not link to each other, so a fresh brain reported six
  orphans. The presets tell agents to link generously; the examples ignored
  their own advice. Fixed in `seed/brain/`.

**A fresh brain now reports zero findings.** That matters more than it sounds:
`doctor` is the only thing standing behind safety-only guards, and a report that
cries wolf on day one gets ignored by day three.

## Phase 6 — history and the audit log

`pnpm verify` passes: lint, typecheck, **201 tests**, build.

The ports paid off exactly as intended: `createGitPort` and `createAuditPort`
replaced the no-ops with **no change to the write path**. `ops` still calls
`ctx.git.recordWrite(...)` and has no idea git exists.

Verified against a real repo through the MCP server:

```
3 writes  →  1 commit   "append: 40-decisions/2026/drop-redis.md and 1 more"
          →  3 audit lines
```

- **Debounced.** A burst commits once, not once per write.
- **Authored as the agent**, which is how "who wrote this?" is answerable with
  no database.
- **Revert adds a commit**, never rewrites — a test asserts the original commit
  is still reachable afterwards.
- **A git failure never fails a write.** Tested against a brain with no
  repository at all: the write succeeds, the document is on disk, the failure
  is logged.
- **Rejections are logged with no commit** — the audit line is the only trace a
  credential was refused, and a test asserts the secret itself never appears in
  it.

One new seam: `openBrain()` in `core` builds the context both surfaces use, so
the CLI and the MCP server cannot end up with different ports. `close()` flushes
the debounce before a short-lived process exits.

## Phase 7 — search

`pnpm verify` passes: lint, typecheck, **216 tests**, build. The last no-op port
is gone.

Orama BM25 in memory, document as the unit of indexing, `title`/`headings`/`tags`
weighted above body, filters applied inside the query, and a chokidar watch on
the long-lived server. `gbrain index` and `gbrain search` are real commands.

```
$ gbrain search "dunning retry"
Dunning retry storm            10-knowledge/dunning-retries.md
Dunning retries                90-archive/old-dunning.md      <- present, ranked below
```

**Two bugs found by running it rather than by a test**, both in the
near-duplicate guard, both letting identical documents through:

1. The incoming document was compared **with** its frontmatter against a stored
   one **without** it.
2. `candidatePaths` only listed the folder when the index came back *empty*, so
   a stale index that returned some other hit hid the document that mattered.

The second broke a rule already written down — the index holds no authority — so
it is recorded in the [decisions log](./decisions-log.md) rather than just
fixed. Three regression tests now cover it.

## Phase 8 — skills, packaging, and the measurement

`pnpm verify` passes: lint, typecheck, **216 tests**, build.

**The routing fixture set cleared the bar.** 22 captures through a real model
given only `default.md` — no skill loaded, no hints, no access to the repo:

```
correct folder    21/22 = 95%   (bar: >=90%)
silent misfiles   1             (bar: 0)
unsafe refused    2/2
```

All three deliberate traps avoided — a decision made while debugging, knowledge
found inside a project, an explanation that reads like a runbook. The one miss
was an ambiguity in the *structure document*, fixed by sharpening the prose;
re-running that fixture now passes. Full write-up in
[`fixtures/RESULTS.md`](../fixtures/RESULTS.md).

Also shipped: four skills (`brain-capture`, `brain-recall`, `brain-curate`,
`brain-onboard`), the Dockerfile, the repo README, and npm packaging as
`gbrain` and `g-brain-mcp`.

## The HTTP transport — phase 4 closed

`pnpm verify` passes: lint, typecheck, **224 tests**, build.

Streamable HTTP alongside stdio, `GET /health` answering without a key so a
deployment probe can use it, and bearer keys with the narrow profiles from
ADR-0007. Node's own `http` module — no web framework.

Proven against a real HTTP client:

```
1. GET /health (no key)   ok, autocommit=false
2. no key                 401 UNAUTHORIZED
3. unknown key            401 UNAUTHORIZED
4. capture key writes     created=true
5. recall key reads it    "It works over HTTP"
6. recall key writes      FORBIDDEN
```

Line 6 is the one that matters: the read-only agent of ADR-0007 is now a real
control rather than a described one.

Also fixed here: `createSearchPort` had no `close()`, so a chokidar watcher
outlived its server and kept a handle on a directory that had been deleted.
Found because vitest reported `EPERM` after every test passed.

## Phase 9 — planned, nothing built

Two ADRs accepted on 2026-09-19 opened a phase that has not started:
[ADR-0008](../docs/technical/12-adr/0008-project-scope-is-the-project-folder.md)
makes `20-projects/{project}/` the access boundary, and
[ADR-0009](../docs/technical/12-adr/0009-read-only-web-ui.md) adds a read-only
web UI with no identity system.

[`phases/09-project-scoping-and-ui.md`](./phases/09-project-scoping-and-ui.md)
records what it delivers: a `project` code on the tools that resolves to the
project folder, a UI that lists projects and browses one of them, and a project
list filtered by the caller's read scopes — a project the caller cannot read is
absent from it, not disabled.

It is small because **project scoping needs no new authorisation code**. The
per-folder `Scope { folder, read, write }` that phase 3 shipped and phase 4
proved over HTTP is the whole mechanism; the project code is sugar over the
`folder` argument. The UI is a view over `brain_tree`, `brain_list`,
`brain_read` and `brain_search`, and it never writes.

Not decided here: what the UI is built with, whether it is served alongside the
HTTP transport, and whether search crosses projects.

## What is left

- Running the routing fixtures **with a skill loaded**, to confirm the gap
  against the no-skill baseline is small (FR-30).
- Publishing: `gbrain` and `g-brain-mcp` are packaged but unpublished.

## Constraints that hold throughout

- **All behaviour in `packages/core`**, as typed transport-neutral functions
  with typed error results. `mcp` and `cli` stay thin. One write path to test,
  secure, and document.
- **Write guards are safety-only.** Never reject a write for not matching the
  structure document — record it as drift.
- **The brain stays readable without g-brain.** Plain markdown, YAML
  frontmatter, legible paths; everything derived lives in `.brain/` and is
  disposable.
- **`BRAIN_ROOT` must never default inside this source repo**; git auto-commit
  would commit into the working tree.
- **Do not commit or push** unless the repo owner explicitly asks.
