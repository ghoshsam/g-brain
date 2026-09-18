---
title: Testing and verification
description: The test layers, the required test list mapped to FR-nn, and the routing fixture set — the one measurement that decides whether the product works.
---

# Testing and verification

Two different things need proving, and they need different tools.

**Does the machinery work?** Atomic writes, path containment, etags, secret
scanning, commits, the audit log. This is ordinary software with ordinary
failure modes, and it is proved by deterministic tests that either pass or fail.

**Does the product work?** An agent, given nothing but `brain_structure` output,
files content where a person would later look for it. That is not assertable. It
is *measured*, against a fixture set, with a real model, and it varies. It is
also the thing that decides whether g-brain is worth running, because everything
else in the system exists to serve it.

The first is most of the test count. The second is the
[routing fixture set](#the-routing-fixture-set), and it is the section that
matters.

## Test layers

| Layer | Location | Asserts | Runs |
|---|---|---|---|
| Unit | `packages/core/src/**/*.test.ts` | Behaviour, against a temp directory | Every change |
| Integration | `packages/core/test/integration/` | Behaviour over a real temp brain with a real git repo | Every change |
| Surface | `apps/mcp/test/`, `apps/cli/test/` | Only the mapping from `Result<T>` to tool errors and exit codes | Every change |
| Routing fixtures | `test/routing/` | Product quality — needs a model call | On demand, and on release |
| Manual | — | Inspector, a real agent, a git host | Before release |

Nearly every test is a `core` test, because
[all behaviour lives in `core`](./01-architecture.md#the-hard-rule). That is not
a testing convention that happened to emerge; it is the reason the architecture
is shaped that way. There is one write path, so there is one write path to test.

### Unit tests

Vitest, co-located with the module. `core` functions take a `BrainContext` and
return `Result<T>`, so a unit test is a function call and an assertion on a
discriminated union — no server, no transport, no mocking framework.

```ts
const res = await writeDoc(ctx, { path: '../../etc/passwd', content: '# x' })
expect(res.ok).toBe(false)
expect(res.ok === false && res.error.code).toBe('INVALID_PATH')
```

Assert on `error.code`, never on `error.message`. The code is the contract; the
message is written for an agent to read and is free to change.

### Integration tests

A real temporary brain, created per test file and removed after:

```ts
// packages/core/test/helpers/temp-brain.ts
export async function makeTempBrain(opts?: {
  preset?: string          // default: seed/presets/default.md
  git?: boolean            // default: true — git init plus an initial commit
  autocommit?: boolean     // default: true, overriding the product default
}): Promise<{ ctx: BrainContext; root: string; cleanup: () => Promise<void> }>
```

The root is `fs.mkdtemp(path.join(os.tmpdir(), 'gbrain-'))`. It is never
`BRAIN_ROOT`, never `~/brain`, and never anywhere inside this source repo — the
same rule the product itself follows, for the same reason: a test with
auto-commit on that resolved into the working tree would commit fixtures into
g-brain ([ADR-0003](./12-adr/0003-git-as-the-history-layer.md)).

Git is real, not stubbed. `simple-git` shells out to the `git` binary, so a
stubbed git tests nothing about what `git log` will actually contain.

### Surface tests

`apps/mcp` and `apps/cli` are mappings, and their tests assert only the mapping.
`core` is stubbed to return a chosen `Result<T>`, and the test checks what comes
out the other side. No surface test writes a file.

```ts
// apps/cli — the mapping, kept total by the type system
const EXIT_CODE: Record<BrainError['code'], number> = {
  NOT_FOUND: 4,  INVALID_PATH: 5,  PRECONDITION_REQUIRED: 6,
  PRECONDITION_FAILED: 7,  CONFLICT: 8,  UNSAFE_CONTENT: 9,
  TOO_LARGE: 10, RATE_LIMITED: 11, UNAUTHORIZED: 12, FORBIDDEN: 13,
}
```

One test iterates every code in that record and asserts a distinct, documented
exit code; the equivalent MCP test asserts each produces a tool error carrying
the code in its structured content. Adding a code to `BrainError` fails
compilation in both apps until both mappings are extended — which is the point
of declaring it as a `Record` over the union rather than a `switch` with a
default.

If a surface test ever needs a temp brain, the behaviour under test is in the
wrong package.

## The required tests

Each is tied to the requirement it proves. Codes are typed codes from `core`;
there are no HTTP status codes anywhere in this system.

### Concurrent writes — FR-09

Two writes to one document, both holding the same etag, issued without awaiting
each other. Exactly one succeeds.

```ts
const { etag } = (await readDoc(ctx, { path: p })).value
const [a, b] = await Promise.all([
  writeDoc(ctx, { path: p, content: A, ifMatch: etag }),
  writeDoc(ctx, { path: p, content: B, ifMatch: etag }),
])
```

Assert: one `ok: true`; the other `PRECONDITION_FAILED` carrying the *current*
etag in `details`, so the agent can re-read and retry; the file on disk is
byte-identical to either `A` or `B` and never a blend of the two; the audit log
has one success line and one rejection line. Then assert the loser's retry path
works — re-read, write with the returned etag, succeed.

Run it with 20 concurrent writers as well as 2. Per-path locks plus etags
([storage and concurrency](./04-storage-and-concurrency.md)) have to hold under
contention, not only in the two-writer case.

### Path containment — FR-14

`../../etc/passwd`, `/etc/passwd`, `C:\Windows\System32\drivers\etc\hosts`,
`10-knowledge/../../escape.md`, a symlink inside the brain pointing out of it,
and `10-knowledge/notes.txt` — all `INVALID_PATH`.

The assertion that matters is **before any filesystem access**. Spy on
`fs.promises` and assert zero calls: not `stat`, not `access`, not `mkdir`. A
guard that rejects after touching the filesystem has already told the caller
whether a path exists.

### Secret rejection — FR-15

A body containing a fake but well-formed AWS access key — `AKIA` followed by 16
uppercase alphanumerics, generated in the test rather than committed as a
literal, so the repo's own scanners stay quiet.

Assert: `UNSAFE_CONTENT`; `error.details` names the finding type and the line
number; **nothing exists at the target path** — assert on `fs.access` rejecting,
not on the result object; no commit was created; and `.brain/audit.jsonl` gained
one line with `outcome: "rejected"` and the finding type.

That last assertion is the one people delete as redundant. It is not. A rejected
secret write is a security event with no other trace — no file, no commit — and
the audit line is the entire record that it happened
([git and audit](./07-git-and-audit.md)).

Assert the inverse too, because false positives are the expensive direction
([security](./08-security.md)): a document *about* credential handling, quoting a
redacted `AKIA…` example and describing rotation, writes successfully.

### Near-duplicate — FR-16

Write a document, then write a second with roughly 95% trigram overlap into the
same folder. Assert `CONFLICT`, with the existing path named in `details` so the
agent can read and update it instead. Then the same write with `force: true`
succeeds. Then a genuinely different document in the same folder succeeds
without `force` — `DUPLICATE_THRESHOLD` is a guess until it is tuned
([decisions log](../../plan/decisions-log.md)), and this test is what shows it
drifting into blocking legitimate writes.

### A write to an undeclared folder succeeds — FR-11

The load-bearing test of [ADR-0002](./12-adr/0002-safety-only-write-guards.md).

```ts
// 77-experiments/ appears nowhere in content-structure.md
const res = await writeDoc(ctx, { path: '77-experiments/spike.md', content })
expect(res.ok).toBe(true)                        // ← this is the requirement
expect(await readFile(root, '77-experiments/spike.md')).toContain('…')
expect(lastAuditLine(root).drift).toBe(true)
expect(await doctor(ctx)).toMatchObject({
  drift: [{ path: '77-experiments/spike.md', reason: 'undeclared-folder' }],
})
```

The test name says why it exists: `write to an undeclared folder SUCCEEDS and is
recorded as drift — FR-11, not a missing validation`. Someone will eventually
read the permissive guard list as an oversight and "fix" it. This test is what
stops the fix landing, and the name is what stops the test being deleted
alongside it.

### Crash mid-write — FR-09

Atomicity is temp file → `fsync` → rename. Inject a failure between the write and
the rename, and separately kill the process at the same point in a child-process
test.

Assert: the target file is either the old content or absent, never truncated and
never partial; no `.tmp` sibling survives the next successful write; the lock is
released, so the next write is not blocked by a stale lock.

### A read-only key cannot write anywhere — FR-18

An agent key in `.brain/agents.json` with `read` scope and no `write` scope.
Attempt `writeDoc`, `appendDoc`, and delete — in a declared folder, in an
undeclared folder, at the brain root, and against `content-structure.md` itself.
All `FORBIDDEN`. An unknown key is `UNAUTHORIZED`.

Assert this at the `core` level, not through a transport. Authorisation is
enforced in `core` precisely so that a surface added later inherits it, and a
test that went through MCP would prove it for MCP only.

### External edit detected by the etag — FR-09, FR-27

Read a document and keep the etag. Modify the file with `fs.writeFile` directly,
as a human in VS Code or a `git pull` would. Write with the held etag: assert
`PRECONDITION_FAILED`.

Etags are content hashes, not sequence numbers, so the external edit is visible
without g-brain having observed it happen. That is what makes editing the brain
outside g-brain safe, and editing it outside g-brain is half of FR-27.

### Deleting the index loses nothing — FR-24

Build a brain, index it, `rm -rf .brain/`, rebuild. Assert the same document
count, the same results for a fixed query set, and every document still
readable. Then assert the stronger version: with `.brain/` deleted and never
rebuilt, `readDoc` and `listDocs` still work. The index is derived and disposable
([ADR-0004](./12-adr/0004-lexical-search-first.md)); only search degrades.

---

## The routing fixture set

This measures the product. Everything above measures the machinery.

`content-structure.md` is prose that nothing parses
([ADR-0001](./12-adr/0001-structure-doc-is-prose-not-schema.md)), so its quality
cannot be checked by a compiler, a schema, or a unit test. The only way to know
whether it works is to give a real model the same thing an agent gets — the
structure document and the folder tree, nothing else — and see where it files
things.

### What a fixture is

```yaml
# test/routing/fixtures/decisions.yaml
- id: decision-during-debugging
  category: ambiguous
  capture: |
    While tracing the billing timeout we established that the retry
    wrapper double-counts attempts, so we are moving retry handling
    into the queue consumer rather than the HTTP client. Rejected
    fixing the wrapper because two other services depend on its
    current behaviour.
  expect: 40-decisions/{yyyy}/
  acceptable: []
  why: >
    Produced during a debugging session, but it is a decision with
    options and reasoning. The session-versus-decision confusion is
    the single most common misfile.
```

`expect` is a folder, not a filename — filenames are a lint concern, not a
routing one. `acceptable` lists alternatives that are genuinely defensible; keep
it empty wherever you can, because a generous `acceptable` list is how a fixture
set quietly stops measuring anything.

### Building the set

Roughly 20 fixtures, drawn from **real captures** — read `audit.jsonl` and
`git log` on a brain that has been in use, take the bodies, strip anything
identifying. Fixtures invented at a desk test the structure document against the
author's own mental model, which it already matches.

Compose the set deliberately:

| Count | Kind | Purpose |
|---|---|---|
| ~10 | Unambiguous, one per declared folder | Catches a folder whose description does not actually describe it |
| ~6 | Ambiguous | The ones that decide the score |
| ~2 | Genuinely unplaceable | Must land in `00-inbox/`. A set with no correct inbox answer teaches the model the inbox is never right |
| ~2 | Near-duplicate of existing content | The correct answer is to update, not to create |

The ambiguous six are the set. At minimum:

- **A decision made during a debugging session.** Session or decision. The
  structure document's answer is "ask what it *is*, not what you were doing".
- **Knowledge discovered inside a project.** `10-knowledge/` or
  `20-projects/{project}/`. The test is whether it survives the project ending.
- **A playbook that is really a knowledge document.** Numbered steps that explain
  *why* rather than *what to run* belong in `10-knowledge/`, and models route on
  the numbered-steps surface form instead.
- **A status update containing a durable finding.** The correct answer is two
  documents: the finding promoted, the status linking to it.
- **A working preference stated inside a meeting note.** `30-people/` or the
  project folder.
- **Research spanning two projects.** The case `00-inbox/` exists for — or
  `10-knowledge/`, if the finding is genuinely durable.

### Running it

The harness constructs exactly the context a capture agent has, and nothing more:

```bash
pnpm test:routing                          # default model, all fixtures
pnpm test:routing --model <id> --runs 3
```

Rules that keep the measurement honest:

- The prompt carries the `brain_structure` payload verbatim — the structure
  document and the live tree — plus the capture body.
- **No path hint, no folder list, no examples from the fixture set.** Anything
  the real agent does not get, the harness does not get.
- The model is asked for a path and, where it is unsure, for
  `needs-filing: true` with a one-line reason — the same thing the
  [agent contract](../functional/07-agent-contract.md) asks of a real agent.
- Each run records the model id, the date, the structure document's git sha, and
  the per-fixture outcomes into `test/routing/runs/<date>-<model>.json`. A score
  without those four is not comparable to anything.

### Scoring

| Outcome | Definition | Counts as |
|---|---|---|
| **Correct** | `expect`, or an entry in `acceptable` | Pass |
| **Inbox** | `00-inbox/` with `needs-filing: true` and a reason | Pass |
| **Misfile** | Any other folder, with no `needs-filing` flag | **Fail** |
| **Silent inbox** | `00-inbox/` with no flag or no reason | **Fail** — a misfile that looks like caution |

**The bar: ≥90% correct-or-inbox, and zero misfiles.**

Zero is not a rounding of "very few". A misfile is a document that exists, looks
filed, and is in the wrong place — nobody is told, and it is found only when
someone cannot find it. An inbox item is a queue with a name on it. One is
recoverable and the other is invisible, so they are scored on different scales
and only one of them gets a tolerance.

The inbox rate is watched separately and is not part of the bar. A run that
passes by routing 40% of fixtures to the inbox has passed the safety test and
failed the usefulness one: the structure document is not discriminating, and the
fix is the same as for a misfile — better "does not belong here" lines.

### Reading a failure

A failure is almost never a code defect. `core` passed the document through
verbatim; the model read it and chose. The failure is in the prose.

| Pattern | What it says about the structure document |
|---|---|
| One fixture splits across two folders on repeated runs | Those two folders' "does not belong here" lines do not separate them. Fix the boundary, in both sections |
| Everything lands in `10-knowledge/` | The knowledge section is described broadly enough to be the default. Narrow it and sharpen the durability test |
| Decisions land in `60-sessions/` | The "what it *is*, not what you were doing" rule is stated at the top and not repeated where it is needed — in the sessions section |
| Unambiguous fixtures land in `00-inbox/` | Folder purposes are vague. The model is being appropriately cautious about a document that told it nothing |
| Right folder, invented subfolder | `{topic}` / `{project}` naming guidance is missing, or the tree is not being consulted. Say "reuse an existing topic before inventing one" in that section |
| `50-playbooks/` attracts explanatory content | The folder is described by its *form* (numbered steps) rather than its *use* (executed, not studied) |

Fix the prose, rerun, keep the run files. The diff between two runs against the
same fixtures with the same model is the only evidence that an edit to the
structure document helped.

### Where the results go

Findings from fixture runs are not a test artifact. They are the product's main
feedback loop:

- **[`03-structure-doc-guide.md`](./03-structure-doc-guide.md)** gets the general
  lesson — the phrasing patterns that route well and the ones that do not. Every
  piece of advice in that guide should be traceable to a run.
- **`seed/presets/*.md`** get the specific fix. A preset that misroutes is a
  defect shipped into every new brain, because `gbrain init` copies it.
- **[`decisions-log.md`](../../plan/decisions-log.md)** gets the thresholds the
  runs tune — `DUPLICATE_THRESHOLD` most of all, since the near-duplicate
  fixtures are where it shows up blocking legitimate writes.

### The honest limitation

This is a statistical measure, and it does not behave like a test.

- **It varies by model.** A weaker model files worse against an identical
  structure document, and nothing in the system catches it. A passing score is a
  statement about one model on one date, not about the brain.
- **It is not deterministic**, even at temperature 0. Run each fixture at least
  three times and score the majority; a fixture that flips between runs is itself
  the finding — that content is genuinely ambiguous, and the structure document
  should say so.
- **It cannot gate a commit.** It needs a model call, it costs money, and it
  takes minutes.
- **20 fixtures is a small sample.** At n=20 a single misfile is 5%. The
  zero-misfile bar is strict precisely because the sample is too small for a
  percentage tolerance to mean anything.
- **It measures the structure document, not the code.** A perfect score proves
  the prose routes well for that model. It proves nothing about whether the write
  landed atomically — that is what the tests above are for.

Accepting all of that is the price of putting routing judgement in the model
rather than a rules engine, and ADR-0001 records it as a cost rather than
pretending otherwise.

---

## End-to-end verification

Run against a scratch brain, never your own. Every command here is real.

```bash
pnpm build
pnpm gbrain init /tmp/verify-brain          # preset choice, tailoring, agent key, MCP snippet
git -C /tmp/verify-brain log --oneline      # one initial commit: preset plus seed docs
```

Check what `init` produced: `content-structure.md` at the root, one example
document per declared folder, `.brain/agents.json` with the generated key, `.git/`
initialised, and a printed MCP registration snippet that pastes without editing.

```bash
export BRAIN_ROOT=/tmp/verify-brain
export GIT_AUTOCOMMIT=true                  # off by default; on for this check
pnpm gbrain doctor                          # clean brain: no drift, no broken links, empty inbox
pnpm gbrain index --rebuild                 # indexed document count matches the file count
```

Then write through the MCP server and confirm the history:

```bash
git -C /tmp/verify-brain log --oneline
# a commit per write, authored as the agent, message naming the operation and the path
git -C /tmp/verify-brain show --stat HEAD
tail -3 /tmp/verify-brain/.brain/audit.jsonl
```

Finally, break it on purpose: `rm -rf /tmp/verify-brain/.brain/`, then
`gbrain index --rebuild`, then `gbrain doctor` again. Nothing is lost. That is
FR-24 verified by hand as well as by test.

## MCP verification

```bash
npx @modelcontextprotocol/inspector node apps/mcp/dist/index.js
```

In the Inspector: every tool listed with a description an agent could act on;
`brain://structure` resolving to the raw structure document; the
`define-structure` prompt rendering; `brain_structure` → `brain_write` →
`brain_read` round-tripping with a stable etag; and a deliberately bad write —
traversal path, fake secret, stale etag — returning a tool error carrying the
typed code rather than a stack trace. See
[MCP reference](./05-mcp-reference.md).

Then the verification that actually counts. Register the server in Claude Code,
open an unrelated task, and let the agent work until it learns something worth
keeping.

**Ask it to remember that. Do not tell it a path.**

Then, in a fresh session with no memory of the first, ask a question the captured
content answers. The agent should find it.

A capture that lands in a sensible folder and a recall that finds it, with no
path in either prompt — that is the product working. If you had to name the
folder, you tested the filesystem.

## Human readability — FR-27

The brain has to stay fully usable with nothing but a git host or a text editor.
That is a constraint on the build, so it is verified by looking.

```bash
cd /tmp/verify-brain
git remote add origin <a scratch repo>
git push -u origin main
```

On the host, confirm:

- The folder tree renders, and the folder names alone are a usable table of
  contents.
- `content-structure.md` renders as readable markdown. It is the first thing a
  new person opens, and it has to survive being read by a human as well as by a
  model.
- An individual document renders with its YAML frontmatter visible rather than
  swallowed or mangled — including one with *partial* frontmatter, since
  frontmatter is linted and never enforced, so incomplete frontmatter is normal.
- The host's text search finds a phrase from inside a document.

Then the local half: open the repo in VS Code and read it; open it as an Obsidian
vault and confirm `[[10-knowledge/auth/oidc-token-refresh.md]]` links resolve and
the graph connects. Finally `rm -rf .brain/` and repeat all of it. If anything
degrades, something essential has leaked out of the markdown and FR-27 is broken.

The automated companion is one test that walks the corpus and asserts that every
file outside `.brain/` is `.md`, every `[[…]]` target is brain-root-relative, and
no document depends on a sidecar file. It catches the regression; the manual pass
catches the thing that merely renders badly.

## CI

Every push and every pull request:

| Step | Command | Budget |
|---|---|---|
| Lint and format | `biome ci .` | seconds |
| Types | `tsc --noEmit` across the workspace | ~20 s |
| Unit and integration | `vitest run` | < 2 min |
| Build | `turbo build` | ~30 s |
| Corpus readability | the FR-27 walker, over `seed/brain/` | seconds |

Turborepo caches by task, so an unchanged package is not retested. The whole run
targets under three minutes; past five, people stop waiting for it and start
merging around it.

CI installs `git` and sets `user.name` and `user.email`, because the integration
tests create real commits. A CI image without git fails the git tests in a way
that reads like a product bug.

**Deliberately not in CI:**

| Excluded | Why | Runs instead |
|---|---|---|
| Routing fixtures | A model call per fixture — costs money, takes minutes, non-deterministic, so it cannot gate a merge | `pnpm test:routing`, on demand and on every release |
| MCP Inspector | Interactive | Manually, before release |
| Real-agent capture and recall | Needs a configured MCP client and a human reading the result | Manually, before release |
| Git host rendering | Needs a push to a real host | Manually, before release |

Putting the routing fixtures in CI is a recurring temptation and a mistake: a
non-deterministic, paid check on the merge path gets retried until it passes, and
a check people retry until green is not a check. The release run executes it,
records the score with the model id, and blocks the release on it.

### Coverage

Coverage is weighted, not uniform. `@vitest/coverage-v8`, thresholds enforced per
path:

| Path | Line | Branch | Why |
|---|---|---|---|
| `core/guards` | 95% | 95% | The complete list of things that can reject a write. An untested branch here is a guard that does not run |
| `core/store` | 95% | 90% | Atomicity, etags, locks. The failure mode is losing a write |
| `core/auth` | 95% | 95% | Same argument as guards |
| `core/*` elsewhere | 85% | 80% | |
| `packages/search` | 75% | — | Derived and disposable. A bug there costs a rebuild |
| `apps/mcp`, `apps/cli` | no threshold | — | Exhaustive mapping tests instead; a percentage would reward testing plumbing |

A coverage number is a floor, not a goal. The nine tests listed above matter more
than any of these percentages, and a change that raises coverage while weakening
one of them is a regression.

## Traceability

**Every `FR-nn` maps to at least one test.** New requirement, new test, in the
same change.

| FR | Test |
|---|---|
| FR-01 | `structure.test.ts` — verbatim bytes; tree includes undeclared folders; missing file → `structureMissing: true` |
| FR-02 | `write.test.ts` — the structure document writes through the normal path: etag, commit, audit |
| FR-03 | `init.integration.test.ts` — init into a temp dir; presets discovered from `seed/presets/*.md`; refuses a non-empty brain without `--force` |
| FR-04 | `prompts.test.ts` (mcp) — `define-structure` registered; renders the current structure |
| FR-05 | `read.test.ts` — etag; `raw` / `parsed` / `html`; `at: <sha>`; `NOT_FOUND` |
| FR-06 | `list.test.ts` — each filter; `limit` and `cursor`; no bodies in the payload |
| FR-07 | `tree.test.ts` — tree matches the filesystem, with per-folder counts |
| FR-08 | `links.test.ts` — forward links, backlinks, `broken: true` |
| FR-09 | `write.test.ts`, `concurrency.integration.test.ts` — precondition rules, concurrent writes, crash mid-write, external-edit detection |
| FR-10 | `append.test.ts` — section append; two concurrent appends both survive |
| FR-11 | `drift.test.ts` — **undeclared folder succeeds**, flagged as drift |
| FR-12 | `delete.test.ts` — soft delete mirrors the path into `90-archive/`; hard delete still recoverable from git |
| FR-13 | `idempotency.test.ts` — replay within the window returns the original result and writes once |
| FR-14 | `paths.test.ts` — traversal, absolute, symlink, non-`.md`; zero `fs` calls |
| FR-15 | `secrets.test.ts` — fake AWS key: `UNSAFE_CONTENT`, nothing on disk, audit line present; redacted example writes fine |
| FR-16 | `duplicate.test.ts` — `CONFLICT` naming the existing path; `force` succeeds |
| FR-17 | `limits.test.ts` — `TOO_LARGE` at `MAX_DOC_BYTES`; `RATE_LIMITED` with a retry hint |
| FR-18 | `auth.test.ts` — unknown key `UNAUTHORIZED`; out-of-scope `FORBIDDEN`; read-only key cannot write anywhere |
| FR-19 | `health.test.ts` (mcp) — `GET /health` reports root reachability, document count, index freshness, git status |
| FR-20 | `git.integration.test.ts` — a commit per write, authored as the agent; a burst debounces into one commit |
| FR-21 | `history.integration.test.ts` — `brain_history` over one path; revert lands as a new commit; history never rewritten |
| FR-22 | `audit.test.ts` — one line per mutating operation, rejections included, with the drift flag |
| FR-23 | `search.test.ts` — BM25 ranking; `folder` / `tag` / `type` filters; `90-archive/` penalised, not excluded |
| FR-24 | `index.integration.test.ts` — index fresh within seconds of a write; delete and rebuild loses nothing |
| FR-25 | **Excepted** — see below |
| FR-26 | `doctor.test.ts` — reports drift, broken links, orphans, duplicates, inbox, expiry, lint; corpus hashes unchanged afterwards |
| FR-27 | `readability.test.ts`, plus the manual pass above |
| FR-28 | `bootstrap.test.ts` — server started against a non-existent `BRAIN_ROOT` creates it from `default`, seeds it, generates a key, reports it in the first `brain_structure` response, and makes **no commit**. A second test asserts it still refuses a root inside a source repo |
| FR-29 | `tools-only.test.ts` — the full suite re-run with resources and prompts disabled. Every capability still reachable; only ergonomics lost |
| FR-31 | `keys.test.ts` — `init` generates narrow keys; the recall key cannot write anywhere; only the curator key may write `90-archive/` |
| FR-32 | `curate.test.ts` — a run emits a plan and writes nothing until approved; an approved run produces exactly one commit; exceeding the cap stops and reports |
| FR-30 | The capture fixtures run **with no skill loaded**. This is the baseline that must pass, because it is what every client without skill support gets |

**FR-25 is the one exception.** `packages/search` ships the `Retriever` and
`Embedder` interfaces with no embedder implementation, so there is no behaviour
to test — an interface with no implementation has none. What is checked is that
it compiles and that the lexical retriever satisfies `Retriever` in full, which
`tsc --noEmit` does on every CI run. The behavioural test arrives with the
implementation.

Any other FR without a test is a gap, not an exception.

## Related

- [Architecture](./01-architecture.md) — why nearly every test is a `core` test
- [Structure doc guide](./03-structure-doc-guide.md) — where routing findings land
- [Storage and concurrency](./04-storage-and-concurrency.md)
- [Security](./08-security.md)
- [Operations](./09-operations.md)
- [Functional requirements](../functional/06-functional-requirements.md)
