# g-brain — Implementation Plan (baseline)

> Baseline for the build. v1 is `packages/core` + `apps/mcp` + `apps/cli` +
> `packages/search` + agent skills.

## Context

Agentic tools (Claude Code, Cursor, MCP clients, CI agents) each keep their own
scratch notes, so knowledge is scattered, duplicated, and lost between sessions.
`g-brain` is a single shared, file-backed second brain: agents read and write
markdown through one contract, and a plain-text `content-structure.md` tells
them **where** each kind of content belongs.

**The central idea:** `content-structure.md` is written for an LLM to read, not
for a parser to enforce. An agent fetches it, reads it like a colleague reading
a team's filing convention, and decides the path itself. The system's job is to
serve that document, keep writes safe and atomic, and never silently lose
anything — not to police folder names with a regex engine.

No database. Markdown on disk is the source of truth; git is the history layer;
the search index is derived and disposable.

## Decisions

| Decision | Choice | Record |
|---|---|---|
| Structure contract | Plain-text `content-structure.md`, LLM-read, ships with presets | [ADR-0001](../docs/technical/12-adr/0001-structure-doc-is-prose-not-schema.md) |
| Write guards | Safety only — no structure enforcement | [ADR-0002](../docs/technical/12-adr/0002-safety-only-write-guards.md) |
| History | Git auto-commit per write, no database | [ADR-0003](../docs/technical/12-adr/0003-git-as-the-history-layer.md) |
| Search | Orama BM25 now, vector-ready interface | [ADR-0004](../docs/technical/12-adr/0004-lexical-search-first.md) |
| Surface | MCP — stdio + streamable HTTP — plus the `gbrain` CLI. Humans read the brain as a git repo | [architecture](../docs/technical/01-architecture.md) |
| Deployment shape | **One installation per team, many projects.** A project is a name, not a repo | [ADR-0005](../docs/technical/12-adr/0005-one-installation-many-projects.md) |
| Adoption | **Drop-in in any MCP client.** Zero-config first run; correct with no skill loaded | [ADR-0006](../docs/technical/12-adr/0006-drop-in-for-any-agentic-tool.md) |
| Stack | TypeScript ESM, MCP TS SDK, pnpm + Turborepo | [tech stack](../docs/technical/02-tech-stack.md) |

## Repo layout

```
g-brain/
  apps/
    mcp/            # MCP server — stdio + streamable HTTP. The only network surface
    cli/            # gbrain init | doctor | index | serve
  packages/
    core/           # structure doc, store, tree, links, git, audit, guards, auth
    search/         # Orama index build/query, Embedder interface
    skills/         # brain-onboard, brain-capture, brain-recall, brain-curate
  seed/
    presets/        # content-structure.md variants
    brain/          # example content used by `gbrain init`
  docs/functional/  # what it does
  docs/technical/   # how it is built, incl. 12-adr/
  plan/             # this plan + per-phase execution plans
```

**Hard rule:** all behaviour lives in `packages/core`, exposed as typed,
transport-neutral functions with typed error results. `mcp` and `cli` are thin.
One implementation of every guard, one write path to test and secure, and no
possibility of two surfaces disagreeing about what a write does.

## Build phases

| # | Phase | Delivers |
|---|---|---|
| 0 | Docs and plan | `docs/functional/`, `docs/technical/`, ADRs, this plan |
| 1 | Structure + presets | `seed/presets/*.md` — the product's actual core |
| 2 | Foundation | pnpm/Turbo/TS/Biome/Vitest skeleton, `seed/brain/` |
| 3 | Core | structure reader, tree, store (atomic + etag + locks), doc lint, guards, auth |
| 4 | MCP | tools, resources, prompts, both transports. **First end-to-end write** |
| 5 | CLI + onboarding | `gbrain init` with presets and tailoring, `doctor` |
| 6 | Git + audit | commit-per-write, history, revert, `audit.jsonl` |
| 7 | Search | Orama BM25, chokidar watch, `Embedder` interface stubbed |
| 8 | Skills + packaging | four skill files, Dockerfile, `.env.example`, README |

Phases 0–1 define the contract. Phases 2–6 are the usable product — an agent can
capture and recall at the end of phase 4. Phases 7–8 make it pleasant. Each phase
ends by updating the affected `docs/` pages and ticking its `plan/phases/` file.

## Verification

**Unit / integration** — `pnpm test`:
- Two concurrent writes to one doc: second gets `PRECONDITION_FAILED`, no corruption.
- Traversal `../../etc/passwd` → rejected; non-`.md` extension → rejected.
- Fake AWS key in body → `UNSAFE_CONTENT` naming the finding, nothing written.
- Near-duplicate write → `CONFLICT` with the existing path; `force` succeeds.
- Write to an undeclared folder → **succeeds**, flagged as drift.
- Crash mid-write leaves no partial file.
- A read-only key cannot write anywhere.

**The test that decides whether the product works** — ~20 fixture capture
requests with expected target folders, run through a real model given only
`brain_structure` output. Target ≥90% correct folder and **zero silent
misfiles** — anything uncertain must land in `00-inbox/`. This is how
`content-structure.md` gets tuned; the results back the advice in
[`03-structure-doc-guide.md`](../docs/technical/03-structure-doc-guide.md).

**MCP** — `npx @modelcontextprotocol/inspector node apps/mcp/dist/index.js`;
all tools list, `brain_structure` → `brain_write` round-trips. Then register in
Claude Code and confirm a real agent captures and recalls **without being told a
path**. That is the product working.

**End-to-end**
```bash
pnpm gbrain init ../g-brain-content     # preset choice + tailoring + key + MCP snippet
pnpm gbrain doctor                      # drift, orphans, broken links, inbox
pnpm gbrain index --rebuild
git -C ../g-brain-content log --oneline # a commit per write
```

**Human reading** — push the brain repo and confirm the git host renders the
folder tree, `content-structure.md`, and individual documents legibly, and that
its code search finds content. This is [FR-27](../docs/functional/06-functional-requirements.md),
and it is a constraint the build must not break rather than a thing to build.

**Docs** — every `FR-nn` in
[`06-functional-requirements.md`](../docs/functional/06-functional-requirements.md)
maps to at least one test.

## Open items (not blocking)

- `60-sessions/` expiry: archive or delete (default archive).
- Push cadence to `origin` for the brain repo (default manual).
- `doctor` drift check: heuristic or LLM-assisted (start heuristic).

## Out of scope for v1

Multi-tenant brains · realtime collaboration · attachments and binary assets ·
embeddings (interface only) · automatic content generation · sub-folder access
control · system-of-record use · regulated data.
Full reasoning and add-back triggers in
[`08-out-of-scope.md`](../docs/functional/08-out-of-scope.md).
