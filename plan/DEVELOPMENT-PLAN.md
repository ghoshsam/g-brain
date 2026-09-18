---
title: Development plan
description: What we are building, in what order, and how it stays maintainable. Written to be read first.
---

# Development plan

Read this before any other file in `plan/`. It is the plain-English version.

---

## 1. What we are building

- A **shared memory for AI coding tools**. Claude Code, Cursor, a CI agent — they all read and write to the same place.
- The memory is **markdown files in a git repo**. Nothing else. No database.
- At the top of that repo sits one file: **`content-structure.md`**. It describes, in plain English, which folder each kind of content goes in.
- When an agent wants to save something, it reads that file and **decides the folder itself**.
- We do not check its answer against rules. There are no rules to check against.

### Why this matters

- Today every AI tool keeps its own notes and forgets them at the end of the session.
- An agent working on Monday knows nothing an agent learned on Friday.
- We fix that by giving them one place to put things and one document telling them where.

### The one idea to hold on to

- **`content-structure.md` is written for a language model to read, not for code to parse.**
- Changing how the brain is organised means editing that text file. No migration. No code change.
- If you ever find yourself writing code that decides where a document goes, stop. That is the model's job.

---

## 2. What the code is made of

Six packages. One does the work; the rest are thin.

| Package | What it is |
|---|---|
| `packages/core` | **All the logic.** Reading, writing, safety checks, git, permissions |
| `packages/search` | Full-text search. Kept separate because it is allowed to be out of date |
| `packages/skills` | Instruction files that help an agent use the brain well |
| `apps/mcp` | The server AI tools connect to. Translates requests into `core` calls |
| `apps/cli` | The `gbrain` command for humans — set up, health check, rebuild index |
| `seed/presets` | The starter `content-structure.md` files |

### The rule that keeps this simple

- **Every behaviour lives in `packages/core`.**
- `apps/mcp` and `apps/cli` contain no logic. They call `core` and translate the answer.
- If you are about to add an `if` statement in `apps/`, it belongs in `core` instead.
- **Why:** two places with logic will disagree eventually. One place cannot.

### How errors work

- `core` never crashes for an expected problem. It returns an object saying what went wrong.
- The problem is a **code** like `NOT_FOUND` or `CONFLICT` — never an HTTP status.
- Each surface turns that code into whatever its caller understands.

---

## 3. What we build, in order

Each phase has its own file in [`plan/phases/`](./phases/) with the full detail.

| Phase | We build | You can tell it worked when |
|---|---|---|
| 0 ✅ | Docs, decisions, plans | Every decision is written down with its reasons |
| 1 ✅ | The preset `content-structure.md` files | A person could file correctly by reading one |
| 2 | Empty project skeleton — pnpm, TypeScript, tests, CI | `pnpm test` runs and passes with nothing in it |
| 3 | `packages/core` — the whole engine | A file can be written safely, with tests proving it |
| 4 | `apps/mcp` — the server | **An AI tool saves a note without being told where** |
| 5 | `apps/cli` — `gbrain init` and `doctor` | A new user gets a working brain in five minutes |
| 6 | Git history and the audit log | Every change has a commit you can undo |
| 7 | Search | You can find a note you wrote last week |
| 8 | Skills, Docker, publishing | `npx gbrain` works on a clean machine |

### The milestone that matters

- **Phase 4.** That is when the product first works.
- Everything before it is scaffolding. Everything after it is improvement.
- The test: a real agent saves a note and finds it in a later session, and nobody told it a folder name.

---

## 4. The rules we never break

These are decisions already made. Each has an [ADR](../docs/technical/12-adr/) explaining why.

- **Never reject a write because it is in the "wrong" folder.** Save it, then flag it as drift. A brain that rejects captures teaches agents to stop capturing.
- **Only reject for safety:** a path escaping the folder, a secret in the text, a file too big, a duplicate, a conflicting edit, a missing permission. That is the whole list.
- **Never lose anything.** Deleting moves to `90-archive/`. Git keeps every version.
- **Never rewrite git history.** No amend, no force-push.
- **The search index can always be deleted and rebuilt.** Nothing important lives in it.
- **The brain must be readable with no g-brain installed** — just a git website or a text editor.
- **`BRAIN_ROOT` defaults to `~/brain`** and must never end up inside a source code repo. Auto-commit would put agent notes into someone's project.
- **`GIT_AUTOCOMMIT` is off by default.**

### If a rule feels wrong while you are coding

- It probably felt wrong to us too. Read the ADR — the reasoning is there, including what it costs us.
- If the reasoning no longer holds, write a new ADR. Do not quietly code around it.

---

## 5. How to work on it day to day

- **Read the phase file first.** `plan/phases/NN-*.md` says what is in scope and when it is done.
- **Read the component doc for what you are touching.** [`docs/technical/11-components/`](../docs/technical/11-components/) has one file per component: what it does, what it does **not** do, a diagram, and the exact TypeScript interface.
- **Build to the interface in that file.** If the phase file and the component doc disagree, the component doc wins.
- **Write the test first for anything in `core/guards` or `core/store`.** A bug in those two loses data or leaks a credential.
- **Stay on your branch.** Do not commit or push unless asked.

### Before you say something is done

- `pnpm test`, `pnpm lint`, `pnpm typecheck`, `pnpm build` all pass.
- Every new behaviour has a test.
- The phase file's checklist is ticked.
- Any doc that is now wrong has been updated in the same change.

---

## 6. How this stays maintainable

The goal is that someone new in a year can change this safely.

### Documentation is part of the work

- Change behaviour → update the doc in the same change. A wrong doc is worse than no doc.
- Make a decision → add it to [`decisions-log.md`](./decisions-log.md). Once it is settled, promote it to an ADR.
- Finish a phase → update [`STATUS.md`](./STATUS.md).

### The structure enforces itself

- `apps/*` are not allowed to import `fs`, `simple-git`, `gray-matter`, or `@orama/orama`. A test checks this.
- **Why a test and not a rule in a document:** rules in documents get forgotten. Tests fail.
- No module may import `core/ops`. Dependencies point one way only.

### Things that will change later, and are ready for it

- **Search** — swapping in semantic search means adding one class. Callers do not change.
- **Git and audit** — plugged in behind interfaces, so phase 3 works without them.
- **New folders in a brain** — edit `content-structure.md`. No code touched.
- **New preset** — drop a markdown file into `seed/presets/`. No code touched.

### The measurement that tells us if it works

- About 20 test cases: "here is something to save" → "here is where it should go".
- A real model runs them with only `content-structure.md` to go on.
- **Target: 90%+ in the right folder, and zero wrong guesses** — anything it is unsure about must go to `00-inbox/`.
- If this score drops, **fix the text, not the code.** That is the design working as intended.

---

## 7. Where to look

| You need | Go to |
|---|---|
| What the product does | [`docs/functional/01-overview.md`](../docs/functional/01-overview.md) |
| The numbered requirements | [`docs/functional/06-functional-requirements.md`](../docs/functional/06-functional-requirements.md) |
| How the pieces fit | [`docs/technical/01-architecture.md`](../docs/technical/01-architecture.md) |
| The exact interface for a component | [`docs/technical/11-components/`](../docs/technical/11-components/) |
| Why a decision was made | [`docs/technical/12-adr/`](../docs/technical/12-adr/) |
| What to build next | [`plan/STATUS.md`](./STATUS.md) |
| The detail for one phase | [`plan/phases/`](./phases/) |
| What a good `content-structure.md` looks like | [`seed/presets/default.md`](../seed/presets/default.md) |

---

## 8. Words we use

| Word | Means |
|---|---|
| **Brain** | One folder of markdown that is also a git repo. One per team |
| **`BRAIN_ROOT`** | Where that folder lives. Defaults to `~/brain` |
| **Structure document** | `content-structure.md` — the filing instructions agents read |
| **Drift** | A file saved somewhere the structure document does not describe. Reported, never blocked |
| **Etag** | A fingerprint of a file's contents, used to stop two writers overwriting each other |
| **MCP** | The protocol AI tools use to talk to external tools |
| **Preset** | A ready-made structure document you start from |
| **Capture** | An agent saving something |
| **Recall** | An agent finding something saved earlier |
