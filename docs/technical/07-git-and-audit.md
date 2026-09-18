---
title: Git and audit
description: How history works — a commit per write in the brain's own repo — and why an append-only audit log exists beside it to record the writes that never became commits.
---

# Git and audit

Two records, with different jobs.

**Git is the history layer.** Every accepted write becomes a commit in the
brain's own repository, authored as the agent that made it. History, diff,
blame, reading a document as it was, and undoing a bad write are all git
primitives over a format git was built for. There is no database
([ADR-0003](./12-adr/0003-git-as-the-history-layer.md)).

**`.brain/audit.jsonl` records what git cannot.** A rejected write produces no
commit, and rejected writes are exactly the events worth keeping — a blocked
secret write is a security event with no other trace. The audit log also records
drift, which git has no opinion about.

Neither is a system of record. Both are honest about what they do not guarantee,
and this document says where those limits are.

---

## The brain is its own repository

`BRAIN_ROOT` points at a git repository containing nothing but the brain.
`gbrain init` runs `git init` in it, writes the first commit, and never touches
any other repo.

It defaults to `~/brain` (`%USERPROFILE%\brain` on Windows), anchored to `$HOME`
and never to `cwd`. That anchoring exists for this document's sake: if the
default could resolve inside the g-brain source repo — or any source repo — then
turning auto-commit on would commit an agent's captures into a working tree
somebody is mid-branch on. That is the one accident the default must make
impossible.

`gbrain init` writes exactly one `.gitignore`:

```gitignore
.brain/
.DS_Store
```

Everything in `.brain/` is derived or operational: the search index (rebuildable
with `gbrain index --rebuild`), computed backlinks, `agents.json` holding agent
keys, and `audit.jsonl`. None of it belongs in the repo. `agents.json` holds
credentials and must never be committed; the index would churn a diff on every
write for no benefit.

**The consequence, stated plainly: the audit log is not backed up by
`git push`.** It is a machine-local operational record. A brain cloned to a
second machine arrives with its full git history and an empty audit log. If the
audit trail matters to you, it is on you to copy it; nothing in g-brain moves it
off the machine that wrote it.

If `BRAIN_ROOT` is not a git repository at all, writes still succeed. Auto-commit
is skipped with a warning on stderr, `brain_history` returns an empty revision
list rather than an error, and `gbrain doctor` reports it. Capture is never
blocked by the history layer being absent — same reasoning as
[ADR-0002](./12-adr/0002-safety-only-write-guards.md).

---

## Commit per write

`GIT_AUTOCOMMIT` defaults to `false`. Writing to a repository is a side effect
nobody should get unasked — installing an MCP server should not start rewriting
git history in a folder you have not looked at yet. You turn it on when you have
decided you want it.

With it on, the commit is step 11 of the write path
([architecture](./01-architecture.md#request-path-for-a-write)) — after the file
is durably on disk. It is deferred work: a git failure is logged and **does not
fail the write**, because the document is already safe. The failure mode is an
uncommitted change in the working tree, which the next commit picks up and
`gbrain doctor` reports in the meantime.

### Debouncing

A capture burst — an agent promoting six session findings in one go — should not
produce six commits, and should not make the sixth write wait behind five git
invocations. Writes accumulate in a pending set; `GIT_DEBOUNCE_MS` (default
`2000`) after the last write lands, one `git add` + `git commit` covers all of
them.

| Situation | Commits |
|---|---|
| One write, then silence | 1, about 2 s later |
| Six writes inside 2 s of each other | 1, covering six paths |
| Six writes spread over a minute | 6 |
| Process exits with writes pending | Flushed on shutdown; on `SIGKILL`, picked up by the next commit |

Debouncing trades a little attribution granularity for not serialising every
write behind a git process that costs tens of milliseconds. Per-write commits
remain the default shape because they give exact attribution and
single-document revert; the batch is the concession to bursts, not the target.

---

## Authorship

The author is the agent. The committer is g-brain.

```
Author:    capture-agent <capture-agent@g-brain.local>
Commit:    g-brain <g-brain@g-brain.local>
```

The author name is the actor resolved by `core/auth` — the agent identity behind
the key in `.brain/agents.json`, or the configured local actor for a trusted
stdio connection. The email is `<actor><GIT_AUTHOR_SUFFIX>`, where
`GIT_AUTHOR_SUFFIX` defaults to `@g-brain.local`. Set it to your own domain if
you want the commits to resolve to real accounts on a git host; the default is
deliberately non-routable so nobody's inbox receives mail addressed to a
capture agent.

Actor names are sanitised into a valid git identity before use — angle brackets,
newlines, and leading or trailing whitespace are stripped. An actor that
sanitises to the empty string commits as `unknown-agent`.

**Why attribution is worth the trouble.** "Which agent wrote this?" is the first
question anyone asks about a brain that has been running for a month, and it is
asked in three shapes:

```bash
git -C ~/brain log --author=capture-agent --oneline     # what did this agent write?
git -C ~/brain blame 10-knowledge/auth/oidc-token-refresh.md  # who wrote this line?
git -C ~/brain shortlog -sn                             # who is writing at all?
```

All three are stock git against a folder of markdown. They work on a clone, with
no g-brain process running, using tools the reader already has. That is most of
why git is the history layer rather than a revisions table.

**The honest limit:** authorship is *asserted* by the process, not proved.
g-brain sets the author field from the key that made the call; anyone holding
that key is that agent, and anyone with filesystem access can commit as anything
they like. Commits are not signed in v1. Treat authorship as a useful
operational attribution, not as evidence of who did what.

---

## Commit messages

The subject line is machine-greppable and says the operation and the path.

```
<operation> <path>
```

| Operation | Produced by |
|---|---|
| `write` | `brain_write` — create or replace |
| `append` | `brain_append` |
| `archive` | Soft delete — the move into `90-archive/` ([FR-12](../functional/06-functional-requirements.md)) |
| `delete` | Hard delete |
| `revert` | Restoring a revision, as a new commit |
| `init` | `gbrain init` — the first commit only |

A debounced batch covering more than one operation uses a summary subject and
one operation line per path in the body:

```
batch 3 operations

write 20-projects/billing/dunning-retry-storm.md
write 20-projects/billing/open-questions.md
append 60-sessions/2026/09/billing-investigation.md
```

`git log --grep` matches the body as well as the subject, so one pattern finds
both forms:

```bash
git -C ~/brain log --grep='write 40-decisions/' --oneline
git -C ~/brain log --grep='^revert ' --oneline
```

**The message does not carry the drift flag**, deliberately. Drift is a property
of the current tree measured against the *current* structure document, and the
structure document is expected to change — [ADR-0001](./12-adr/0001-structure-doc-is-prose-not-schema.md)
makes restructuring an edit rather than a migration. A drift marker baked into a
commit message becomes wrong the moment somebody declares that folder, and a
commit message cannot be corrected without rewriting history. Drift lives in the
audit log and is recomputed by `doctor`.

### Example log

```console
$ git -C ~/brain log --pretty='%h  %ad  %an  %s' --date=short
4c1d0a7  2026-09-18  curator-agent   batch 3 operations
9b3e812  2026-09-18  capture-agent   write 70-experiments/prompt-cache-hit-rates.md
8f2a1c4  2026-09-18  capture-agent   write 40-decisions/2026/use-postgres-advisory-locks.md
1a77e30  2026-09-18  gbrain          init brain from preset default
```

`9b3e812` is a write into a folder the structure document does not describe. It
committed like any other write, because that is [FR-11](../functional/06-functional-requirements.md).
Nothing in this log says so.

A fourth write was attempted between `9b3e812` and `4c1d0a7` and rejected for a
credential in the body. It appears nowhere above — which is the entire argument
for the next section.

---

## `.brain/audit.jsonl`

One JSON object per line, one line per mutating operation, **including the ones
that were refused** ([FR-22](../functional/06-functional-requirements.md)).

### Line schema

| Field | Type | Present | Meaning |
|---|---|---|---|
| `ts` | string | always | ISO 8601 UTC with milliseconds |
| `actor` | string | always | Resolved agent identity, same string as the git author name |
| `action` | string | always | `write` · `append` · `archive` · `delete` · `revert` |
| `path` | string | always | Brain-root-relative, the path as requested |
| `outcome` | string | always | `ok` · `rejected` · `error` |
| `code` | string | when not `ok` | The typed error code — `UNSAFE_CONTENT`, `CONFLICT`, `PRECONDITION_FAILED`, and the rest of the set in [FR error results](../functional/06-functional-requirements.md#error-results) |
| `etag` | string | when `ok` | The resulting content hash ([storage and concurrency](./04-storage-and-concurrency.md)) |
| `drift` | boolean | when `ok` | Whether the write landed outside the declared structure |
| `driftFolder` | string | when `drift` | The folder that is not declared |
| `driftReason` | string | when `drift` | `folder-not-declared` · `no-structure-doc` |
| `bytes` | number | always | Body size as submitted, so a `TOO_LARGE` rejection still records what was attempted |
| `via` | string | always | `mcp-stdio` · `mcp-http` · `cli` |
| `detail` | object | optional | The same payload as `BrainError.details` — the finding and line for `UNSAFE_CONTENT`, the conflicting path for `CONFLICT`, the current etag for `PRECONDITION_FAILED` |
| `idempotencyKey` | string | optional | When the caller supplied one ([FR-13](../functional/06-functional-requirements.md)) |

`etag` and `drift` are absent when nothing was written. Their absence is the
signal that no file changed, and it is easier to test for than a null.

### Example lines

A successful write, a write flagged as drift, and a rejection. Wrapped here for
reading; each is one physical line.

```jsonl
{"ts":"2026-09-18T09:14:02.317Z","actor":"capture-agent","action":"write","path":"40-decisions/2026/use-postgres-advisory-locks.md","outcome":"ok","etag":"sha256:1b4f0e98c2a7","drift":false,"bytes":2184,"via":"mcp-stdio"}
{"ts":"2026-09-18T09:16:44.902Z","actor":"capture-agent","action":"write","path":"70-experiments/prompt-cache-hit-rates.md","outcome":"ok","etag":"sha256:c7d2ab4155e0","drift":true,"driftFolder":"70-experiments/","driftReason":"folder-not-declared","bytes":1633,"via":"mcp-stdio"}
{"ts":"2026-09-18T09:19:11.488Z","actor":"ci-agent","action":"write","path":"20-projects/billing/stripe-webhook-setup.md","outcome":"rejected","code":"UNSAFE_CONTENT","bytes":3901,"via":"mcp-http","detail":{"finding":"aws-secret-access-key","line":42}}
```

The third line is the one that justifies the file. Nothing was written, so there
is no file to inspect and no commit to find. Without this line, the only record
that a CI agent tried to put an AWS secret into a shared brain is a tool error
that scrolled past in somebody's terminal.

Useful queries are `grep` and `jq`:

```bash
jq -r 'select(.outcome=="rejected") | "\(.ts) \(.actor) \(.code) \(.path)"' ~/brain/.brain/audit.jsonl
jq -r 'select(.drift==true) | .path' ~/brain/.brain/audit.jsonl | sort -u
grep '"code":"UNSAFE_CONTENT"' ~/brain/.brain/audit.jsonl
```

### Append-only, and what that does and does not mean

Lines are written with a single `O_APPEND` append of one serialised line plus a
newline. g-brain never reads the file back, never rewrites a line, and never
truncates in place. Concurrent writers from separate processes append
independently; the single-append discipline is what keeps their lines from
interleaving.

### Rotation

When the file passes `AUDIT_MAX_BYTES` (default `8388608`, 8 MiB) it is renamed
to `audit-<YYYY-MM-DD>T<HH-MM-SS>Z.jsonl` and a fresh `audit.jsonl` is started.
Rotation is a rename, never a truncation, so nothing is lost at the moment of
rotation. `AUDIT_KEEP` (default `8`) rotated files are retained and the oldest
is deleted beyond that.

**So retention is bounded and old audit lines are eventually discarded.** At
roughly 300 bytes per line, the defaults hold on the order of a quarter of a
million operations. That is generous for a personal brain and finite for a busy
shared one. Raise the numbers, or copy rotated files somewhere with a retention
policy you actually chose.

### The limit worth being blunt about

`audit.jsonl` is plain text in a folder. Anyone with filesystem access to
`BRAIN_ROOT` can edit it, delete lines from it, or replace it. There is no
signing, no hash chain, no append-only enforcement below the application, and no
copy anywhere else. It is an **operational record, not tamper-evident
evidence**, which is consistent with the brain not being a system of record
([out of scope](../functional/08-out-of-scope.md)). Its integrity is exactly the
integrity of the filesystem permissions on `BRAIN_ROOT` — see
[security](./08-security.md).

### No commit sha in the line

The audit line is appended at step 10; the commit happens at step 11, debounced,
possibly two seconds later and possibly batched with five other writes. The sha
does not exist yet, and g-brain does not go back and amend the line — that would
break the append-only discipline for a convenience. Correlate by path and
timestamp:

```bash
git -C ~/brain log --since='2026-09-18T09:14:00Z' --until='2026-09-18T09:15:00Z' --oneline
```

---

## History, reading a revision, and revert

### `brain_history`

```ts
historyDoc(
  ctx: BrainContext,
  input: { path: string; limit?: number; cursor?: string },
): Promise<Result<{ revisions: Revision[]; nextCursor?: string }>>

interface Revision {
  sha: string       // full object id; callers display a prefix
  actor: string     // the git author name
  date: string      // ISO 8601
  op: 'write' | 'append' | 'archive' | 'delete' | 'revert' | 'init'
  message: string   // the commit subject
}
```

It is `git log --follow -- <path>`, paginated. `--follow` matters because soft
delete is a move into `90-archive/` — without it, archiving a document would
appear to end its history rather than continue it.

A path with no commits returns an **empty list**, not `NOT_FOUND`. A brain
running with `GIT_AUTOCOMMIT=false` has no history for any document, and that is
a configuration state rather than an error. `gbrain doctor` is where you find
out why the list is empty.

### Reading at a revision

`brain_read({ path, at: '8f2a1c4' })` is `git show 8f2a1c4:<path>`
([FR-05](../functional/06-functional-requirements.md)). A sha that does not
contain that path returns `NOT_FOUND`. Historical reads carry no etag you can
write against: an etag is a hash of the current file, and a precondition against
a revision you read from history would be asking to overwrite whatever is there
now. Read the head to get an etag, then write.

### Revert

```ts
revertDoc(
  ctx: BrainContext,
  input: { path: string; to: string; ifMatch: string },
): Promise<Result<WriteOutput>>
```

Revert reads the content at `to`, then writes it through the ordinary write
path — guards, etag check, atomic write, audit line, commit. The result is a
**new commit on top**, with subject `revert <path> to <sha>`. The intervening
history stays exactly where it was.

Three consequences follow from reusing the write path rather than calling
`git revert`:

- `ifMatch` is required, because this is a replace. A revert racing a concurrent
  write gets `PRECONDITION_FAILED` like anything else.
- The restored content is re-scanned. A revision written before a secret pattern
  was added to the rule set can be refused on the way back in with
  `UNSAFE_CONTENT`. That is correct: whether content is safe is decided now, not
  by the fact that it was once accepted.
- Reverting one document out of a batched commit touches only that document.
  `git revert` on the commit would undo all three.

### History is never rewritten

g-brain does not run `git commit --amend`, `git rebase`, `git reset --hard`,
`git filter-branch`, `git filter-repo`, or `git push --force` against the brain
repo. Not as a fallback, not to tidy a batch, not to remove something. Every
correction is a new commit.

**Where that costs you:** if a credential does land in the brain — written
before the pattern existed, or pasted into a file by a human editing directly —
deleting it in a new commit removes it from the working tree and leaves it in
history, where a git host will still serve it. g-brain will not rewrite history
to get it out. **The remediation is to rotate the credential**, which is the
correct remediation anyway; anything committed to a shared repo should be
treated as disclosed from that moment. If you additionally want it gone from the
object graph, that is a manual operation on your own repo, done with full
knowledge that every clone keeps the old objects until it is re-cloned.

---

## Drift

A write to a folder the structure document does not describe **succeeds** and is
recorded ([FR-11](../functional/06-functional-requirements.md),
[ADR-0002](./12-adr/0002-safety-only-write-guards.md)). Refusing it would train
agents to stop capturing, and a misfiled document is recoverable in a way a
missing one is not.

### How it is computed

Step 9 of the write path, after the file is on disk, so it cannot affect the
outcome. `core/structure` extracts `## <folder>/` headings from
`content-structure.md` and compares the written path's folder against them.
Single-segment placeholders in a heading — `10-knowledge/{topic}/`,
`40-decisions/{yyyy}/`, `60-sessions/{yyyy}/{mm}/` — match one path segment
each.

This is the heuristic extraction that
[ADR-0001](./12-adr/0001-structure-doc-is-prose-not-schema.md) rejected for
routing and permits here, for one reason: it only reports. A heuristic that is
wrong produces a spurious line in a report somebody reads. A heuristic that is
wrong inside a validator loses a capture.

Two reasons are recorded:

| `driftReason` | Meaning |
|---|---|
| `folder-not-declared` | No heading in the structure document covers this folder |
| `no-structure-doc` | There is no `content-structure.md` at all, so nothing is declared |

Drift is about the *folder*, not the contents. A document filed in a declared
folder that does not belong there is a misfile, not drift, and no heuristic
catches it — that is what curation and the fixture set are for.

### How `doctor` surfaces it

`gbrain doctor` **recomputes** drift over the current tree rather than reading
it out of the audit log, and it reports the log separately. The two answer
different questions, and only the recomputation is current: declaring
`70-experiments/` in the structure document clears the drift without touching a
single file, and the old audit lines still say `"drift":true` forever.

```console
$ gbrain doctor

drift — 2 folders not described in content-structure.md
  70-experiments/            3 documents   first seen 2026-09-18 by capture-agent
  20-projects/billing/logs/  8 documents   first seen 2026-09-16 by ci-agent

  Either declare these folders in content-structure.md, or move the documents.
  Nothing here is broken; the structure document and the tree disagree.

git — auto-commit on · 4 commits ahead of origin/main · working tree clean
audit — 1 rejected write in the last 7 days (UNSAFE_CONTENT, ci-agent)
```

`doctor` reports and never modifies
([FR-26](../functional/06-functional-requirements.md)). It is exactly as useful
as the attention it gets, which is the cost
[ADR-0002](./12-adr/0002-safety-only-write-guards.md) accepted on purpose.

---

## Operating the repo

### Pushing is manual

There is no push cadence, no interval, no push-on-commit. Silently pushing an
agent's writes to a shared remote is a surprise nobody should get from a default,
and the moment after it happens is the wrong moment to discover it.

```bash
git -C ~/brain remote add origin git@github.com:you/brain.git
git -C ~/brain push -u origin main
```

After that it is `git push` when you want it, or a scheduler you set up
yourself. `gbrain doctor` tells you how far behind you are — the
`4 commits ahead of origin/main` line above is there so that "I forgot to push
for three weeks" is a thing you find out about.

### Two machines, one brain

Clone the brain to a laptop and a server, write on both, and you get ordinary
git divergence. `git pull` merges; markdown merges line by line, and separate
documents never conflict with each other at all. The same document edited on
both sides conflicts the way any text file conflicts.

**g-brain does not resolve merge conflicts.** What it does is get out of the way
while one is in progress: if the repo is mid-merge, mid-rebase, or mid-cherry-pick,
auto-commit is suspended, writes continue to succeed, and the pending set flushes
into one commit once the repo is clean again. `doctor` says the repo is in a
merging state. Blocking capture because a human left a merge half-finished would
be the same mistake as blocking it for a folder name.

Two smaller facts that help here:

- Conflict markers are just text to g-brain. A conflicted file is still read,
  still indexed, still returns content. It looks wrong because it is wrong, and
  it is visible.
- A conflicted file's content changed, so its etag changed, so a writer holding
  the pre-merge etag gets `PRECONDITION_FAILED` rather than silently flattening
  the merge. Etags being content hashes rather than sequence numbers is what
  makes external changes — a `git pull` included — first-class
  ([storage and concurrency](./04-storage-and-concurrency.md)).

### The repo grows, forever

Every revision of every document is kept. That is the point, and it has a price:
a brain with heavy churn ends up with a repository substantially larger than its
working tree, and the cost is loose objects and commit count rather than content
bytes — markdown deltas are tiny.

```bash
git -C ~/brain count-objects -vH        # how much is loose
git -C ~/brain gc                       # pack it
git -C ~/brain maintenance start        # or let git schedule it
```

`git gc` is the whole plan. Nothing in g-brain prunes history, and nothing will
— pruning history is the thing this design exists to avoid.

### Bulk import

Importing a few thousand documents with auto-commit on means a few thousand
commits, each paying the git process cost, serialised behind the debounce
window. Turn it off, import, commit once:

```bash
GIT_AUTOCOMMIT=false gbrain import ./old-notes     # or a script calling core
git -C ~/brain add -A
git -C ~/brain commit -m 'import 1,842 documents from old-notes'
gbrain index --rebuild
gbrain doctor
```

The audit log still records every operation, so the import is fully traced even
though it produced one commit. Run `doctor` afterwards: a bulk import is the
single most likely source of drift, broken links, and near-duplicates, and it is
better to see all of it at once than to meet it a month later.

---

## Related

- [ADR-0003 — Git is the history layer, and there is no database](./12-adr/0003-git-as-the-history-layer.md)
- [ADR-0002 — Write guards are safety-only](./12-adr/0002-safety-only-write-guards.md)
- [Storage and concurrency](./04-storage-and-concurrency.md) — etags, locks, atomic writes
- [Security](./08-security.md) — secret scanning, keys, and what protects `BRAIN_ROOT`
- [Operations](./09-operations.md) — the full environment reference
- [MCP reference](./05-mcp-reference.md) — `brain_history` and `brain_read({ at })` as tools
