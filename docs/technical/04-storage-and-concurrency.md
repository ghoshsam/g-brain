---
title: Storage and concurrency
description: How a document gets onto disk without ever being lost or half-written — paths as identity, atomic rename, content-hash etags, and per-path locks.
---

# Storage and concurrency

Everything here is `packages/core/store`, plus the parts of `core/doc` and
`core/paths` that run inside a write. It is steps 1, 5, 7 and 8 of the
[write path](./01-architecture.md#request-path-for-a-write) in detail.

One sentence carries the design: **the lock is an optimisation, the etag is the
guarantee.** Locks make concurrent writers queue instead of collide; etags make
correctness independent of whether a lock was ever held — which is what keeps a
human editing the same file in VS Code from being a corruption event.

## Path is identity

The brain-root-relative path is the primary key. `brain_read({ path })` takes
one, `[[10-knowledge/auth/oidc-token-refresh.md]]` links resolve to one, every
audit line names one, and `git log -- <path>` is the document's history.

**There is no id index and there will not be one.** An `id` → path map would be
a second source of truth living in `.brain/`, and a single `git mv` from a human
or a `git pull` of someone else's rename would invalidate it silently. That is
the failure [ADR-0003](./12-adr/0003-git-as-the-history-layer.md) exists to
avoid. It would also break the property that makes
[FR-27](../functional/06-functional-requirements.md) hold — a file listing is
only a usable table of contents if the listing *is* the index.

The `id` stamped into frontmatter is a correlation token, not a lookup key.
Nothing resolves it. It exists so a document moved by the curator can be tied to
its former path in the audit log, and so two copies of the same document that
drifted apart can be recognised as such. No operation accepts an `id`.

**The cost, stated plainly:** moving a document breaks every inbound link to its
old path. `brain_links` marks them `broken: true` and `gbrain doctor` reports
them, but nothing rewrites them — see [delete](#delete-soft-and-hard) for why.
Git recovers history across the rename (`git log --follow`), because git tracks
content and detects renames after the fact.

### Path rules

Applied in `core/paths` before any filesystem access
([FR-14](../functional/06-functional-requirements.md)):

| Rule | Reason |
|---|---|
| Brain-root-relative, POSIX separators in the API on every platform | One spelling of a path in tool arguments, audit lines and `[[links]]`, regardless of host |
| No leading `/`, no `.` or `..` segment; the resolved absolute path must be a prefix match on the resolved `BRAIN_ROOT` | Containment. Checked after `realpath`, so a symlink leading out of the tree is caught too |
| Must end `.md` | The brain is markdown. Binary assets are [out of scope](../functional/08-out-of-scope.md) |
| Unicode normalised to NFC | macOS hands back NFD; without normalising, the same name read twice hashes to two different keys |
| `.brain/` is not writable through any operation | It is operational state, not content |

Anything failing these is `INVALID_PATH`, before a file handle is opened.

**Case-insensitive filesystems are a real wrinkle.** On Windows and default
macOS, writing `20-projects/Billing/notes.md` when `20-projects/billing/notes.md`
exists targets the *same file*. Existence is checked with the filesystem's own
semantics, so this is a replace, not a create — and a replace with no `ifMatch`
gets `PRECONDITION_REQUIRED` rather than silently overwriting. A brain authored
on macOS and cloned to Linux can end up holding both files, which `doctor`
reports as near-duplicates. We do not case-fold paths, because folding would
make the brain's own filenames unfaithful to what is on disk.

## On-disk layout

```
~/brain/                        # BRAIN_ROOT — %USERPROFILE%\brain on Windows
  .git/
  .gitignore                    # .brain/ and *.tmp
  content-structure.md          # the contract — an ordinary document
  00-inbox/
  10-knowledge/{topic}/
  20-projects/{project}/
  30-people/
  40-decisions/{yyyy}/
  50-playbooks/
  60-sessions/{yyyy}/{mm}/
  90-archive/
  .brain/
    agents.json                 # 0600
    audit.jsonl
    links.json
    index/
    idempotency/
    locks/
```

`content-structure.md` is written through the same path as any other document —
same lock, same etag precondition, same atomic rename, same commit
([FR-02](../functional/06-functional-requirements.md)). There is no special case
for it in `store`.

| Path | What it is | Lost if you delete `.brain/` |
|---|---|---|
| `agents.json` | Agent keys and per-folder read/write scopes. The one operational file that is not derived | Your keys. Re-issue them; no content is affected |
| `audit.jsonl` | Append-only record of every mutating operation, rejections included ([FR-22](../functional/06-functional-requirements.md)) | The operational record. Git still holds every accepted write |
| `links.json` | Computed forward links and backlinks | Nothing — recomputed from the documents |
| `index/` | The Orama index snapshot | Nothing — `gbrain index --rebuild` |
| `idempotency/` | One small JSON record per completed keyed write, inside the retention window | Nothing — a replay after that point rewrites instead of replaying |
| `locks/` | proper-lockfile lock directories | Nothing — stale locks are broken automatically |

`.brain/` is gitignored in full. Nothing a human needs is in there, which is the
point of [FR-27](../functional/06-functional-requirements.md): deleting it loses
no content, only keys you re-issue and caches that rebuild.

**Lock files live in `.brain/locks/`, not beside the documents.** proper-lockfile
defaults to creating `<file>.lock` as a sibling; we redirect it with
`lockfilePath` to `.brain/locks/<sha256(brain-relative path)>.lock`, because a
`.lock` directory appearing next to `notes.md` in someone's git status — or, on a
crash, staying there — is exactly the artefact that makes a brain stop looking
like a folder of markdown.

## The atomic write

```ts
const dir = dirname(abs)
const tmp = join(dir, '.' + basename(abs) + '.' + randomUUID() + '.tmp')

const fh = await fs.open(tmp, 'wx')      // 'wx' — never reuse an existing temp
try {
  await fh.writeFile(bytes, 'utf8')
  await fh.sync()                        // the bytes are on the device
} finally {
  await fh.close()
}
await fs.rename(tmp, abs)                // same directory → same filesystem
await fsyncDir(dir)                      // POSIX: makes the rename itself durable
```

**Why the temp file must be in the same directory.** `rename(2)` is atomic only
within a single filesystem. Put the temp file in `/tmp` or in `.brain/tmp/` and
the rename may cross a mount point, at which point it degrades to
copy-then-unlink — which has exactly the partial-file window the whole exercise
exists to close. Same directory is the cheapest way to guarantee same
filesystem, so that is where it goes. The leading `.` and the `.tmp` suffix keep
it out of `fast-glob` walks and out of git.

**Why `fsync` before the rename and again on the directory.** The first flushes
the file's bytes; without it, a power loss after the rename can leave the new
directory entry pointing at a file of zeros. The second makes the directory
entry itself durable; without it, the rename can be lost on reboot and the old
name survives. Losing the rename is acceptable — you get the old document. A
zero-length file is not.

**Honest limits.**

- **Windows.** `fs.rename` maps to `MoveFileExW` with `MOVEFILE_REPLACE_EXISTING`,
  atomic on NTFS for a same-volume move, but it can fail transiently with `EPERM`
  or `EBUSY` when another process holds the target open — an editor, a file
  indexer, antivirus. `store` retries the rename five times with jittered backoff
  up to roughly 300 ms before giving up. There is no way to open a directory
  handle for `fsync` on Windows, so the directory sync is skipped; the rename is
  atomic, but its durability is at the filesystem's discretion.
- **Network and synced filesystems.** On NFS, SMB, and folders managed by
  Dropbox or OneDrive, neither rename atomicity nor `fsync` semantics are
  guaranteed, and a sync client may resurrect or duplicate files under you.
  `BRAIN_ROOT` belongs on a local filesystem. Get the brain onto another machine
  with `git push`, not with a sync client.
- **Failures here are not typed errors.** `ENOSPC`, `EIO`, a permission failure —
  none is an expected condition the
  [error set](../functional/06-functional-requirements.md#error-results) covers,
  so `core` throws rather than returning a `Result`. `apps/mcp` and `apps/cli`
  surface them as internal failures. The document on disk is untouched in every
  one of these cases, because they all happen before the rename.

## Etags are content hashes

```ts
type Etag = string   // "sha256:<64 lowercase hex>" over the exact bytes on disk
```

Computed over the file's bytes *after* stamping, so the etag a write returns is
the etag the next read returns. There is no sequence number and no version
counter anywhere in the system.

**Why a hash and not a counter.** A counter needs a store to hold it, and that
store is wrong the moment anyone edits a file outside g-brain. A human saves in
VS Code; a `git pull` brings in a teammate's commit; a `git checkout` restores an
old revision. With a counter, the agent's `ifMatch` still matches a file whose
content has changed, and the agent's write silently destroys the human's edit.
With a content hash, all three change the etag automatically, and the agent gets
`PRECONDITION_FAILED` exactly as if another agent had written. External editing
is a first-class case rather than a hazard, and it costs one `sha256` per read.

Two consequences worth knowing:

- **A stamp-only change is a content change.** Rewriting a document on a new day
  changes `updated:`, which changes the bytes, which changes the etag. That is
  correct — the file differs.
- **A → B → A is invisible.** If someone writes B and then restores the original
  bytes, a caller holding the first etag still matches and its write proceeds. It
  overwrites nothing that is currently on disk, and B is still in git history.
  This is the one thing a counter would catch and a hash does not; it is not
  worth a store to fix.

## The concurrency contract

| Situation | `ifMatch` | Result |
|---|---|---|
| No file at the path | Not required | Created |
| No file at the path, `ifMatch` supplied | — | `PRECONDITION_FAILED`, `details.currentEtag: null` |
| File exists, no `ifMatch` | Required | `PRECONDITION_REQUIRED` |
| File exists, `ifMatch` stale | — | `PRECONDITION_FAILED`, `details.currentEtag: "<current>"` |
| File exists, `ifMatch` current | — | Replaced, new etag returned |

**The existence check happens under the lock**, not before it. That is what makes
"create needs no precondition" safe: two agents creating the same new path
concurrently serialise, the first creates, and the second finds a file there and
gets `PRECONDITION_REQUIRED` rather than clobbering it.

**`PRECONDITION_FAILED` returns the current etag. `PRECONDITION_REQUIRED` does
not** — deliberately. A stale writer already read the document once and knows
what it intended to change, so handing back the current etag lets it re-read,
merge, and retry. A writer that sent no precondition at all never read the
document; giving it an etag would let it retry immediately and blind-overwrite
whatever is there. The
[agent contract](../functional/07-agent-contract.md#handling-errors) tells it to
read first, and the error shape makes that the only thing it can do.

Never resolve `PRECONDITION_FAILED` with `force`. `force` overrides the
near-duplicate guard and nothing else; it does not bypass a precondition, and
there is no flag that does.

### Worked two-writer trace

Both agents are working on `20-projects/billing/open-questions.md`.

| t | Actor | Operation | Outcome |
|---|---|---|---|
| 0 | — | on disk | etag `sha256:9f2c…a41` |
| 1 | A | `brain_read` | body + etag `sha256:9f2c…a41` |
| 2 | B | `brain_read` | body + etag `sha256:9f2c…a41` |
| 3 | B | `brain_write`, `ifMatch: 9f2c…a41` | lock acquired · hash matches · stamped · temp → fsync → rename · lock released · **etag `sha256:41b7…0e9`** |
| 4 | A | `brain_write`, `ifMatch: 9f2c…a41` | lock acquired · on-disk hash is `41b7…0e9` · **`PRECONDITION_FAILED`, `details.currentEtag: "sha256:41b7…0e9"`** · nothing written · lock released |
| 5 | A | `brain_read` | B's body + etag `sha256:41b7…0e9` |
| 6 | A | `brain_write`, `ifMatch: 41b7…0e9` | merged body written · **etag `sha256:c803…7d2`** |

Three variants of step 4 worth holding in mind:

- **A human saved the file in VS Code instead of B writing.** Identical
  behaviour. The etag changed because the bytes changed; nothing needed to know
  that no g-brain process was involved.
- **A `git pull` brought in B's commit from another machine.** Also identical.
- **A used `brain_append` instead.** No precondition, no failure, one lock
  acquisition; A's fragment lands after B's content and both survive.

## `brain_append`

```ts
interface AppendInput {
  path: string
  content: string
  section?: string          // an existing "## Heading", matched case-insensitively
  idempotencyKey?: string
}
appendDoc(ctx: BrainContext, input: AppendInput): Promise<Result<WriteOutput>>
```

**Why it exists.** `brain_write` is read-modify-write: the caller reads the whole
document, edits it locally, and sends the whole document back. Every one of those
is an opportunity to lose a concurrent writer's paragraph, which is why the etag
precondition is mandatory. Most of what agents actually do is additive — one more
open question, one more finding, one more link. Forcing a read-modify-write cycle
on an addition means an `ifMatch` round trip, a `PRECONDITION_FAILED` whenever
anyone else is active, and a retry loop. So there is a second operation for the
common case.

**Why it needs no `ifMatch` and cannot clobber.** The caller never supplies the
document, only the fragment, so there is no base version for it to be wrong
about. Under the lock, `store` reads the current bytes, resolves the insertion
point, splices the fragment in, and writes the whole file atomically. Resolution
happens *at write time, inside the lock* — so if the named section moved, grew,
or was renamed between the caller's last read and this call, the fragment still
lands in the right place. Two concurrent appends serialise on the lock and both
land, in acquisition order; nothing beyond that ordering is promised.

**Section resolution.** With no `section`, the fragment goes at the end of the
body after a blank line. With a `section`, it goes at the end of that section —
immediately before the next heading at the same or a higher level, or at the end
of the document. **A section that does not exist is created** as a new
`## <name>` at the end rather than failing: append is on the capture path, and
[ADR-0002](./12-adr/0002-safety-only-write-guards.md) is why nothing on the
capture path rejects for shape.

Append runs the same safety guards as a write, with two differences. The secret
scan runs over the fragment, and `TOO_LARGE` is evaluated against the
**resulting** document rather than the fragment, so a document cannot be grown
past `MAX_DOC_BYTES` one append at a time. The near-duplicate guard does not
apply — it is a create-only check.

## Locks

`proper-lockfile`, advisory, one lock per resolved document path.

| Property | Value | Why |
|---|---|---|
| Granularity | One document path | A folder-level lock would serialise a curator's whole pass behind one slow write |
| Location | `.brain/locks/<sha256(path)>.lock` | No lock artefacts in the content tree or in git |
| Held across | Precondition check → stamp → temp write → fsync → rename | The window in which two writers could interleave |
| Not held across | Audit append, git commit, index notify | A debounced commit takes tens of milliseconds and must not serialise unrelated writes |
| Acquire | Retry with exponential backoff, ~5 s total | Long enough that failing means something is genuinely wrong |
| Stale threshold | 10 s, with the holder refreshing its mtime every 5 s | An abandoned lock has to expire, or one crash wedges a document forever |

These are constants in `core`, not environment variables. There is no entry for
them in [tech stack](./02-tech-stack.md), on purpose — a tunable lock timeout is
a knob that only ever gets turned after an incident, and the etag check means
turning it wrong is not a correctness problem.

**A lock that cannot be acquired within the window fails the write with
`RATE_LIMITED` and a retry hint.** This reuses a code whose stated cause is a
per-key rate limit, which is a wart we accept rather than growing the
[error set](../functional/06-functional-requirements.md#error-results): it is the
one code whose prescribed agent behaviour — back off and retry — is exactly right
here, and `details` names the real cause. Five seconds of contention on one
document path means something is stuck, not busy.

**A lock held by a dead process is broken automatically.** The holder refreshes
the lock's mtime every 5 s; a lock not refreshed within 10 s is treated as
abandoned and broken by the next acquirer, which then proceeds. This is also why
a process paused for longer than the threshold — a laptop suspended, a debugger
breakpoint, a very long GC pause — can have its lock broken under it. That is
survivable precisely because the lock is not the correctness mechanism: when the
paused process resumes and writes, the etag check sees that the file moved on and
it gets `PRECONDITION_FAILED` like any other stale writer.

Locks are advisory in the other direction too. They coordinate g-brain processes
with each other and with nothing else; a human saving in VS Code does not take
one and does not need to.

## Frontmatter stamping

Step 7 of the write path, in `core/doc`. **It never rejects**
([ADR-0002](./12-adr/0002-safety-only-write-guards.md)).

| Field | Rule |
|---|---|
| `created` | Stamped with today's date if absent. A caller-supplied value is respected — an import needs it. On a replace, an existing `created` is preserved even when the incoming body omits it, so a rewrite never resets a document's age |
| `updated` | Always overwritten with the write date, whatever the caller sent. It describes the file, not the caller's intent |
| `id` | `crypto.randomUUID()`, stamped once and preserved across every replace and every move. No dependency; nothing resolves it |

Dates are `YYYY-MM-DD`, matching [the preset](../../seed/presets/default.md) and
what a human expects to read at the top of a file. The honest cost is that
`brain_list({ updatedSince })` is therefore day-granular. A full timestamp would
buy a finer filter at the price of machine noise in a file humans open every day,
and `updated` is never used for concurrency — that is what etags are for — so the
coarseness costs nothing that matters.

Everything else is linted, not enforced: a missing `title`, an unknown `type`, a
filename that is not kebab-case, two `#` headings. Findings come back on the
write result as `warnings: LintWarning[]` and go into the audit line. The write
succeeds.

**Frontmatter that cannot be parsed at all is written through verbatim**, with a
lint warning and no stamping. `gray-matter` is tolerant, so this is rare, but
when it happens the right move is not to rewrite bytes we do not understand.

## Delete, soft and hard

```ts
interface DeleteInput {
  path: string
  hard?: boolean            // default false
  ifMatch?: Etag            // required when hard
  idempotencyKey?: string
}
```

**Soft delete** moves the document into `90-archive/`, mirroring its path with
the numeric prefix dropped from the first segment — the convention the preset
already states: `20-projects/billing/notes.md` becomes
`90-archive/projects/billing/notes.md`. If something is already at the
destination, the basename gains `-archived-YYYY-MM-DD`, and a numeric suffix
after that. Nothing else is stamped; the path is the record, and the audit line
and the commit carry the rest. Search de-prioritises `90-archive/` with a rank
penalty rather than excluding it
([ADR-0004](./12-adr/0004-lexical-search-first.md)), so archived content stays
findable.

**The move is two writes, and they are not atomic as a pair.** The archive copy
is written first and the original unlinked second — in that order, deliberately,
so a crash between them leaves the document at *both* paths rather than at
neither. Duplication is a condition `doctor` reports and a human resolves in
seconds. Loss is not.

**Inbound links are not rewritten.** Fixing twelve other documents so that one
move looks tidy would be twelve more writes, twelve more chances to fail, and
twelve documents edited that the caller never asked to touch. They break,
`brain_links` marks them `broken: true`, and `doctor` lists them. That is the
standing cost of [path as identity](#path-is-identity).

**Hard delete** unlinks the file and requires `ifMatch`. Soft delete does not,
because an archive move is recoverable and a precondition would only add a round
trip. A hard delete is recoverable too, but only from git:

```bash
git -C ~/brain log --diff-filter=D -- 20-projects/billing/notes.md
git -C ~/brain show <sha>^:20-projects/billing/notes.md > notes.md
```

With `GIT_AUTOCOMMIT` off and nothing committed since the document was written, a
hard delete is a real deletion. That is the honest limit of "still recoverable
from git", and the strongest argument for turning auto-commit on
([ADR-0003](./12-adr/0003-git-as-the-history-layer.md)).

## Idempotency keys

`brain_write`, `brain_append`, and delete each accept an optional
`idempotencyKey` ([FR-13](../functional/06-functional-requirements.md)). A
completed operation writes a record to `.brain/idempotency/<hash>.json` holding
the key, the actor, the request fingerprint, and the result. A replay inside the
retention window returns the original result without touching disk.

The record is keyed on
`sha256(actor + key + operation + path + sha256(content))`, not on the key alone.
A replay with the same key and the same request hits the record; a replay with
the same key and *different* content does not, and falls through to an ordinary
write — where, because the first write already changed the etag, it gets
`PRECONDITION_FAILED` on a replace or `PRECONDITION_REQUIRED` on a create. So key
reuse is not detected as such. The precondition catches the case where it would
have cost something, and no error code had to take on a second meaning for the
case where it would not.

**Retention is 24 hours**, swept at startup and opportunistically on write. An
agent retrying a dropped response retries within seconds, so the window is
generous. Records live in `.brain/`, so deleting it means a replay after that
point writes again — which, for a create, produces `PRECONDITION_REQUIRED` rather
than a duplicate.

Only successful operations are recorded. A rejected write changed nothing, so
re-running its guards on a replay is the correct behaviour, not a wasted one.

## Failure modes

| Failure | What happens | What you are left with |
|---|---|---|
| **Process crash mid-write** | Before the rename: the target is untouched and an orphaned `.<name>.<uuid>.tmp` remains. After the rename: the new content is on disk, but the audit line, commit, and index update may not have run | Never a partial file. Orphan temps are gitignored and swept at startup once older than an hour. An uncommitted write is picked up by the next commit, batched with later writes and attributed to that commit's author |
| **Disk full (`ENOSPC`)** | The temp write or its `fsync` throws, before the rename | The old document intact, an orphaned temp, and a thrown error rather than a typed one — `ENOSPC` is not an expected condition |
| **Concurrent writers** | Serialised by the per-path lock; the second sees the first's etag | `PRECONDITION_FAILED` with the current etag on a replace, `PRECONDITION_REQUIRED` on a create. No corruption, no lost paragraph |
| **External edit between read and write** | The content hash changed, so the precondition fails | `PRECONDITION_FAILED`. The external editor's version stands and the agent re-reads and merges. Identical for a human in VS Code, a `git pull`, and a `git checkout` |
| **Lock held by a dead process** | The lock's mtime stops being refreshed; after 10 s the next acquirer breaks it and proceeds | A delay of at most ten seconds. If the "dead" process was only paused and later writes, the etag check catches it |
| **Rename fails on Windows (`EPERM`/`EBUSY`)** | Another process holds the target open. Five retries with jittered backoff, then the error is thrown | The old document intact and an orphaned temp |
| **Power loss after the rename, before the directory `fsync`** | The directory entry may not have reached the device | The old document, or the new one. Never a mixture, and never a file of zeros — the bytes were fsynced before the rename |

The first five are covered directly by the test suite; see
[testing and verification](./10-testing-and-verification.md).

## What is not provided

- **No cross-document transactions.** A curator moving twelve files makes twelve
  writes, and a crash halfway leaves six moved and six not. Every individual step
  is atomic and individually reversible from git; the *set* is not, and nothing
  rolls it back. Run batch operations with `GIT_AUTOCOMMIT` on, so that a partial
  state is at least legible as commits.
- **No distributed locking.** `proper-lockfile` coordinates processes on one
  machine through one filesystem. Two machines writing to the same brain over a
  network share are not protected by it, and NFS client caching can race even the
  read-then-hash precondition check. Share a brain by cloning and pushing, not by
  mounting.
- **Merge conflicts are yours.** A brain cloned to two machines that both write
  produces ordinary git conflicts in markdown on the next pull. That is the most
  tractable form the problem takes — conflict markers are just text, and a file
  containing them stays readable and writable — but g-brain neither prevents nor
  resolves them, and nothing reports them. Git does.
- **No durability guarantee on network or sync-client filesystems.** See
  [the limits above](#the-atomic-write). `BRAIN_ROOT` on a local disk is an
  assumption, not a recommendation.
- **The audit log has no integrity guarantee.** It is append-only by convention
  and editable by anyone with filesystem access
  ([ADR-0003](./12-adr/0003-git-as-the-history-layer.md)).

## Related

- [Architecture](./01-architecture.md) — the write path these steps sit inside
- [Git and audit](./07-git-and-audit.md) — what happens after the rename
- [MCP reference](./05-mcp-reference.md) — tool arguments and error shapes
- [Security](./08-security.md) — the guards that run before any of this
- [ADR-0002](./12-adr/0002-safety-only-write-guards.md) · [ADR-0003](./12-adr/0003-git-as-the-history-layer.md)
