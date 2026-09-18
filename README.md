# g-brain

A shared, file-backed second brain for agentic tools.

Claude Code, Cursor, a CI agent — they each accumulate context inside a session
and lose it at the end. An agent starting on Monday knows nothing an agent
learned on Friday. g-brain gives them one place to put things, and one document
that says where things go.

```bash
npx gbrain init ~/brain
```

Then paste the printed snippet into any MCP client and ask it to remember
something — **without naming a folder**.

## The idea

At the root of every brain sits `content-structure.md`. It is written the way
you would brief a new colleague: folder by folder, what belongs, what does not,
one real example each.

**An LLM reads it and decides the path itself.** There is no schema to satisfy
and no routing rules engine. The intelligence is in the model; the file is its
context.

So reorganising a brain is editing prose. Adapting g-brain to a new team is
rewriting one markdown file — not a migration, not a code change.

## Shape

- **Markdown files on disk** are the source of truth. Readable, diffable,
  greppable, and useful even if every part of this project disappears.
- **No database.** Git provides history, diff, blame and rollback. The search
  index is derived and can be deleted at any time.
- **MCP is the only network surface**, over stdio or streamable HTTP. The
  `gbrain` CLI calls the same core directly.
- **Humans read it as a git repo** — the git host renders the tree and the
  documents, and Obsidian resolves the links.

## Two rules worth knowing before you use it

**A write is never refused for being in the wrong place.** Filing something into
a folder the convention does not describe *succeeds*, and is recorded as drift
for `gbrain doctor` to report. A brain that rejects captures teaches agents to
stop capturing, and a capture that never happens is lost for good — where a
misfiled document is merely inconvenient.

**Writes are refused only for safety:** a path escaping the brain, a credential
in the body, a runaway size, a near-duplicate, a concurrent writer, a missing
permission. That is the whole list.

## Commands

```bash
gbrain init [dir]      # create a brain, print the snippet to connect an agent
gbrain doctor          # drift, broken links, orphans, duplicates, the inbox
gbrain search <query>  # ranked full-text search
gbrain index           # rebuild the search index
```

## Configuration

Everything has a default. The one worth knowing:

```bash
BRAIN_ROOT=~/brain     # never inside a source repo — the server refuses to start
GIT_AUTOCOMMIT=false   # writing to a repository is a side effect nobody should get unasked
```

The full list is in [`.env.example`](./.env.example).

## Docs

**New here? Start with the [user manual](./docs/user/).**

| | |
|---|---|
| **[User manual](./docs/user/)** | **Install it, connect an agent, and use it** |
| [What it does](./docs/functional/01-overview.md) | The problem, the idea, how success is measured |
| [Writing a structure document](./docs/technical/03-structure-doc-guide.md) | The one document worth getting right |
| [The agent contract](./docs/functional/07-agent-contract.md) | If you are building against it |
| [Architecture](./docs/technical/01-architecture.md) | One core, two thin surfaces |
| [Components](./docs/technical/11-components/) | Each one's purpose, responsibilities and interface |
| [Decisions](./docs/technical/12-adr/) | Why it is built this way, and what each choice costs |
| [Development plan](./plan/DEVELOPMENT-PLAN.md) | Start here if you are working on it |

## Development

```bash
pnpm install
pnpm verify    # lint, typecheck, test, build
```

Working rules are in [`CLAUDE.md`](./CLAUDE.md).
