# g-brain — working rules

A shared, file-backed second brain for agentic tools. A plain-text
`content-structure.md` at the brain root tells agents where content belongs, and
an LLM reads it to decide. Markdown on disk is the source of truth, git is the
history layer, there is no database, and the search index is derived and
disposable.

New here? Read `plan/DEVELOPMENT-PLAN.md` first.

---

## Write code the way a person writes it

The single most important style rule. Generated-looking code is harder to read
and harder to trust, and it is obvious on sight. Avoid these specific tells:

- **No file-header comment blocks.** Start the file with its imports.
- **Don't hoist every string into a constant.** A message used once belongs at
  the line that returns it, so the check and its explanation read together.
  Hoist only what is reused or genuinely configurable.
- **Don't invent a type for a private helper.** If a helper needs a
  discriminated union to return two shapes, it usually wants to be two functions
  or an early return.
- **Don't put a doc comment on every function.** Comment only where the code
  would otherwise mislead. A name that explains itself needs nothing.
- **Comment the *why*, never the *what*.** `// Windows paths are
  case-insensitive` earns its place. `// loop over the segments` does not.
- **Let modules differ.** Code that fits a template exactly, module after
  module, reads as generated. Shape each file to its job.
- **Prefer a plain early return over a clever abstraction.** Boring, obvious
  code is the goal.

Readability is not in tension with performance here. Where it genuinely is, take
the fast path and add one line saying why.

## Non-negotiables

These are settled decisions with ADRs behind them in `docs/technical/12-adr/`.
If one seems wrong, read the ADR — the reasoning and its costs are there. If it
no longer holds, write a new ADR. Never quietly code around one.

- **Guards are safety-only.** A write is never rejected for being in the "wrong"
  folder. A write to an undeclared folder **succeeds** and is recorded as drift.
  A brain that rejects captures trains agents to stop capturing.
- **All behaviour lives in `packages/core`.** `apps/mcp` and `apps/cli` are
  mappings with no logic. About to add an `if` in `apps/`? It belongs in `core`.
- **Errors are typed codes, never HTTP status codes.** The complete set:
  `NOT_FOUND`, `INVALID_PATH`, `PRECONDITION_REQUIRED`, `PRECONDITION_FAILED`,
  `CONFLICT`, `UNSAFE_CONTENT`, `TOO_LARGE`, `RATE_LIMITED`, `UNAUTHORIZED`,
  `FORBIDDEN`. Never invent one.
- **Every fallible operation returns `Result<T>`.** Never throw for an expected
  condition. `loadConfig` is the exception — it runs at startup.
- **Error messages are written for an agent to act on.** Say what happened and
  what to do next: *"Replacing an existing document requires ifMatch. Read the
  document first and retry with its etag."*
- **Nothing is lost.** Delete moves to `90-archive/`. Git history is never
  rewritten — no amend, no force-push.
- **The index is disposable.** Deleting it must lose nothing.
- **The brain stays readable with no g-brain installed** — plain markdown, YAML
  frontmatter, legible paths. Everything derived lives in `.brain/`.
- **`BRAIN_ROOT` defaults to `~/brain`**, anchored to `$HOME` and never inside a
  source repo. `GIT_AUTOCOMMIT` defaults to `false`.

## The interfaces are fixed

`docs/technical/11-components/` has one document per component: what it does,
what it explicitly does **not** do, a sequence diagram, and its TypeScript
interface. **Implement those signatures verbatim.** Where a phase file and a
component document disagree, the component document wins.

## Tests

- Tests sit beside the code: `packages/core/src/<module>/<name>.test.ts`.
  Cross-package rules live in `tests/`.
- Write the test first for anything in `core/guards` or `core/store`. A bug in
  those two loses data or leaks a credential.
- **Test the property, not the incidental.** Assert that two lock holders never
  overlap — not which one wins. Assert a round trip — not a library's internal
  newline convention. A test that pins down something you do not actually care
  about will fail for reasons that teach you nothing.
- Filesystem tests use a temp dir via `mkdtemp` and clean up. Never touch a real
  brain.
- **Windows is a first-class target.** CI runs Ubuntu and Windows. Use
  `node:path`; never assume POSIX separators or that an open file can be
  deleted.

## Conventions

- TypeScript strict, ESM. Relative imports end in `.js`. `import type` for
  types. No `any`, no non-null assertions — biome fails on both.
- Biome: single quotes, no semicolons, trailing commas, 100 columns, 2 spaces.
- Named exports only.
- British-leaning spelling in prose and messages: behaviour, authorisation,
  normalise, prioritise.
- Run `pnpm verify` — lint, typecheck, test, build — before calling anything
  done.

## Keep the docs true

- Change behaviour → update the affected doc in the same change. A wrong doc is
  worse than no doc.
- Make a decision → add it to `plan/decisions-log.md`; promote to an ADR once
  settled.
- Finish a phase → update `plan/STATUS.md` and tick the phase file.

## Git

- **Do not commit, push, or create branches** unless explicitly asked. Leave
  changes in the working tree for review.
