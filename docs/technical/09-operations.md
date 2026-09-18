---
title: Operations
description: Installing, configuring, running, backing up, and repairing a brain — plus the limits you will actually hit.
---

# Operations

This is the document for whoever runs g-brain. A brain is a git repo of markdown
and a process that serves it, so most operations are git operations and most
recovery is `git checkout` or deleting a derived folder. The parts that are not
obvious are `BRAIN_ROOT` placement, the four CLI commands, and knowing which
failures are real.

## Install and first run

```bash
npx gbrain init ~/brain
```

Nothing to install first beyond Node ≥ 20 and `git`. `init` is interactive by
default and falls back to flags when stdin is not a TTY, so it runs in CI
without hanging.

What it creates, in order:

| Step | Result |
|---|---|
| 1 | The target directory, and `git init` inside it — the brain is its own repo |
| 2 | `content-structure.md` at the root, from the chosen preset |
| 3 | The folder skeleton the preset describes, with one seed document per folder |
| 4 | `.brain/agents.json` holding the first agent key, and `.gitignore` containing `.brain/` |
| 5 | `README.md` carrying the MCP registration snippet, next to the convention it connects to |
| 6 | The first commit |

Then it prints the registration snippet to paste into Claude Code or Cursor.
Preset choice, optional tailoring, key, snippet — under five minutes to a
working brain with an agent connected, which is success criterion S6
([onboarding](../functional/03-onboarding.md)).

`.brain/` is gitignored, and that is deliberate: agent keys must not reach a
remote, and the search index has no business in history. The honest cost is that
`.brain/audit.jsonl` is local to the machine and is **not** backed up by
`git push`. If the audit trail matters to you, copy it off the machine yourself.

## BRAIN_ROOT placement

`BRAIN_ROOT` defaults to `~/brain` — `%USERPROFILE%\brain` on Windows. The
default is anchored to `$HOME`, never to `cwd`.

**`BRAIN_ROOT` must never resolve inside the g-brain source repo, or inside any
other source repo.** With `GIT_AUTOCOMMIT` on, every agent capture becomes a
commit in whatever repo contains it — so a brain root inside a working tree
means agents committing their notes into your code. That is the accident this
whole rule exists to prevent, and it is why the default is anchored to `$HOME`
rather than to the working directory, which moves.

The brain is its own git repo. One repo, one brain, at the root:

```
~/brain/                      ← BRAIN_ROOT, and .git lives here
  content-structure.md
  00-inbox/ 10-knowledge/ 20-projects/ ...
  .brain/                     ← derived and operational, gitignored
```

`seed/brain/` inside the g-brain source repo is **example content copied out by
`gbrain init`**. It is never a brain root, and pointing `BRAIN_ROOT` at it is
always a mistake.

### The startup guard

The guard is one function in `packages/core`, run at config load by every entry
point — `init`, `doctor`, `index`, `serve` — so no surface can skip it or
disagree about it. It resolves `BRAIN_ROOT` to an absolute real path before
touching anything, then walks up the directory chain looking for a `.git`
directory. The rule:

- The nearest `.git` is **at `BRAIN_ROOT` itself** → fine, this is the brain's
  own repo.
- No `.git` anywhere above → fine for `init`, which is about to create one.
  `serve`, `doctor`, and `index` warn: history is off, and `GIT_AUTOCOMMIT`
  silently does nothing.
- The nearest `.git` is **above `BRAIN_ROOT`** → **refuse to start.** The
  process exits 4 with a message naming both paths and the enclosing repo:

```
BRAIN_ROOT resolves inside another git repository.
  BRAIN_ROOT : /Users/sam/ghoshsam-repos/g-brain/seed/brain
  repo root  : /Users/sam/ghoshsam-repos/g-brain
Running here would commit captured content into that working tree.
Set BRAIN_ROOT to a directory that is its own repo, e.g. ~/brain.
```

There is no override flag. The only legitimate arrangement passes the check, so
an escape hatch would exist purely to let someone do the damaging thing.

## Configuration

Environment variables, read once at startup into a Zod-validated config object.
No config file, no layering, no merge order. `.env.example` in the repo root is
the canonical list; this table is the operator's version of it.

| Variable | Default | Notes |
|---|---|---|
| `BRAIN_ROOT` | `~/brain` | **Never inside this or any source repo.** Anchored to `$HOME`, not `cwd`. See the startup guard above |
| `GIT_AUTOCOMMIT` | `false` | Writing to a repository is a side effect nobody should get unasked. Turn it on deliberately; turn it off for bulk import |
| `GIT_AUTHOR_SUFFIX` | `@g-brain.local` | Commits are authored as `agent-name <agent@g-brain.local>` |
| `GIT_DEBOUNCE_MS` | `2000` | Quiet period after the last write before one commit covers the burst ([git and audit](./07-git-and-audit.md)) |
| `MCP_TRANSPORT` | `stdio` | `stdio` or `http` |
| `MCP_HTTP_PORT` | `8787` | HTTP transport only |
| `AUTH_REQUIRED` | `true` for HTTP, `false` for stdio | stdio is a local child process; HTTP is not |
| `MAX_DOC_BYTES` | `262144` | 256 kB. A larger body is a malfunction, not a capture |
| `RATE_LIMIT_PER_MINUTE` | `120` | Token bucket per key → `RATE_LIMITED` with a retry hint |
| `AUDIT_MAX_BYTES` | `8388608` | 8 MiB, then `audit.jsonl` rotates by rename |
| `AUDIT_KEEP` | `8` | Rotated audit files retained; the oldest beyond this is deleted |
| `DUPLICATE_THRESHOLD` | `0.9` | Trigram similarity. Lower it and legitimate writes start failing with `CONFLICT`; that is the expensive direction |
| `SEARCH_MODE` | `lexical` | The seam hybrid retrieval arrives through ([ADR-0004](./12-adr/0004-lexical-search-first.md)) |
| `SESSION_EXPIRY_DAYS` | `90` | Reported by `doctor`; expiry archives, never deletes |

A bad value fails at startup with the variable named, not on the first request
that happens to touch it.

## Running the MCP server

`gbrain serve` starts the MCP server. `--stdio` is what an MCP client's
registration line launches as a child process; `--http` is the mode an operator
runs as a long-lived service. `MCP_TRANSPORT` sets the default.

### stdio — registered in a client

The client owns the process lifecycle. Register it and the client starts it on
demand:

```json
{
  "mcpServers": {
    "brain": {
      "command": "npx",
      "args": ["-y", "gbrain", "serve", "--stdio"],
      "env": {
        "BRAIN_ROOT": "/Users/sam/brain",
        "GIT_AUTOCOMMIT": "true"
      }
    }
  }
}
```

`gbrain init` prints exactly this, with the paths filled in.

**stdout is the protocol channel.** Nothing but MCP frames goes to it. All logs,
warnings, and the startup banner go to stderr, and a stray `console.log` in a
tool handler breaks the session for the client — which is the single most common
way to break a stdio server.

`AUTH_REQUIRED` defaults to `false` here because the process is a local child of
a client the user already trusts. Set it to `true` if you want keys enforced
locally as well; see [security](./08-security.md).

### HTTP — a long-lived service

```bash
BRAIN_ROOT=/srv/brain GIT_AUTOCOMMIT=true gbrain serve --http --port 8787
```

Startup prints the transport, listen address, brain root, document count,
whether auth is required, and whether the watcher attached. Remote clients
register the URL and carry a bearer key from `.brain/agents.json`:

```json
{
  "mcpServers": {
    "brain": {
      "type": "http",
      "url": "https://brain.internal:8787/mcp",
      "headers": { "Authorization": "Bearer gb_live_..." }
    }
  }
}
```

`AUTH_REQUIRED` is `true` here and should stay that way. The HTTP transport also
serves `GET /health`, which is the only plain HTTP endpoint on the server.

## Docker

```dockerfile
FROM node:20-slim

# simple-git shells out to the git binary — it must exist in the image
RUN apt-get update \
 && apt-get install -y --no-install-recommends git ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY . .
RUN npm install --omit=dev && npm run build

ENV MCP_TRANSPORT=http \
    MCP_HTTP_PORT=8787 \
    BRAIN_ROOT=/brain \
    AUTH_REQUIRED=true \
    GIT_AUTOCOMMIT=true

VOLUME ["/brain"]
EXPOSE 8787

HEALTHCHECK --interval=30s --timeout=3s --start-period=20s \
  CMD node -e "fetch('http://127.0.0.1:8787/health').then(r=>r.json()).then(h=>process.exit(h.status==='ok'?0:1)).catch(()=>process.exit(1))"

CMD ["gbrain", "serve"]
```

```bash
docker run -d --name brain \
  -v ~/brain:/brain \
  -p 8787:8787 \
  ghcr.io/you/gbrain:latest
```

**The image must never bake a brain into itself.** `BRAIN_ROOT` is a mounted
volume, always. An image with content inside it is content that disappears on
the next deploy, is invisible to `git push`, and cannot be read by a human with
a text editor — which breaks
[FR-27](../functional/06-functional-requirements.md) outright.

Two things that bite in containers:

- **`safe.directory`.** Git refuses to operate on a repo owned by a different
  uid than the process. A volume mounted from the host usually is. Add
  `RUN git config --global --add safe.directory /brain`, or run the container as
  the owning uid. The symptom is every commit failing with
  *detected dubious ownership*, with writes still succeeding — because a git
  failure never fails the write ([architecture](./01-architecture.md), steps
  10–12).
- **Commit identity.** Author and committer are set per commit from the calling
  agent, so no global `user.name` is required. If git still complains, the repo
  is not the brain's own — check the startup guard message.

## Health checks

`GET /health` on the HTTP transport, no auth, always answers with a body
([FR-19](../functional/06-functional-requirements.md)). It reports; it never
returns a typed error, because a degraded brain is still a reachable one.

```json
{
  "status": "ok",
  "version": "0.1.0",
  "uptimeSeconds": 4212,
  "brainRoot": { "path": "/brain", "readable": true, "writable": true },
  "structure": { "present": true, "bytes": 8123 },
  "documents": 386,
  "index": { "mode": "lexical", "documents": 386, "builtAt": "2026-09-18T09:02:11Z", "staleSeconds": 3, "watching": true },
  "git": { "repo": true, "autocommit": true, "head": "a1b2c3d", "uncommitted": 0, "unpushed": 7 }
}
```

| Field | What it tells you |
|---|---|
| `status` | `ok` or `degraded`. Gate your orchestrator on this, not on anything else |
| `brainRoot.writable` | False means every write will fail. The most actionable single field |
| `structure.present` | False means agents are routing with no convention — `brain_structure` still succeeds with `structureMissing: true`, and files will land badly |
| `documents` | Documents on disk. Compare against `index.documents` |
| `index.staleSeconds` | Age of the last index update. Climbing without bound means the watcher is dead |
| `index.watching` | False means the index is frozen at `builtAt`. Restart, or run `gbrain index --rebuild` |
| `git.uncommitted` | Non-zero with `autocommit: true` means commits are failing — check `safe.directory` and ownership |
| `git.unpushed` | How much work exists only on this machine. This is your backup lag |

`status` is `degraded` when the brain root is unwritable, the watcher has
detached, or `GIT_AUTOCOMMIT` is on and the directory is not a git repo. It is
never `degraded` for drift, inbox depth, or unpushed commits — those are
curation and operator cadence, not faults.

## The CLI

`gbrain init | doctor | index | serve`. All four call `packages/core` in
process; none of them talks to the MCP server.

### Exit codes

The same scheme across every command, so scripts can branch on it.

| Code | Meaning |
|---|---|
| 0 | Success |
| 1 | The command failed — unreadable path, git failure, unexpected error |
| 2 | Usage error — unknown flag, missing argument |
| 3 | The command ran and found something you must act on (`doctor` with `--fail-on`) |
| 4 | Refused for safety — the `BRAIN_ROOT` guard, `init` over a non-empty brain without `--force`, or any typed safety rejection from `core` (`INVALID_PATH`, `UNSAFE_CONTENT`, `CONFLICT`, `PRECONDITION_REQUIRED`, `PRECONDITION_FAILED`, `TOO_LARGE`, `RATE_LIMITED`, `UNAUTHORIZED`, `FORBIDDEN`) |

Code 4 is deliberately distinct from 1: it means the system worked and said no.

### `gbrain init [dir]`

| Flag | Effect |
|---|---|
| `--preset <name>` | Preset from `seed/presets/`, by filename. Skips the question |
| `--force` | Initialise over a non-empty directory. Never overwrites an existing `content-structure.md` |
| `--no-seed` | Skip the example documents. An empty brain, structure document only |
| `--no-git` | Do not `git init`. History is off until you create the repo yourself |
| `--agent <name>` | Name for the first agent key. Default `default-agent` |
| `--yes` | Non-interactive. Takes defaults for everything unasked |

Prints each created path, the preset used, the generated key **once**, and the
MCP registration snippet. The key is also in `.brain/agents.json`, which is
gitignored.

Exit 0 on success, 4 over a non-empty brain without `--force`, 4 if the
`BRAIN_ROOT` guard trips, 1 if the directory cannot be created.

### `gbrain doctor`

Reports; never modifies ([FR-26](../functional/06-functional-requirements.md)).

| Flag | Effect |
|---|---|
| `--json` | Machine-readable report on stdout |
| `--folder <path>` | Restrict to one subtree |
| `--fail-on <none\|any\|drift\|links>` | Which findings exit 3. Default `none` |
| `--quiet` | Counts only, no per-item detail |

Sections printed, in this order: **drift** (documents in folders the structure
document does not describe), **broken links**, **orphans** (no inbound links),
**near-duplicate candidates**, **inbox contents** with each item's stated
`needs-filing` reason, **expired content** (`expires` in the past, and sessions
older than `SESSION_EXPIRY_DAYS`), **frontmatter lint warnings**.

Default exit is 0 even with findings, because findings are the normal state of a
healthy brain. Opt into failure with `--fail-on` when you are wiring it to a
scheduler.

### `gbrain index`

| Flag | Effect |
|---|---|
| `--rebuild` | Delete `.brain/index` and rebuild from the files |
| `--watch` | Stay running, keep the index fresh, print each update |
| `--stats` | Print document count, term count, build time, resident size — then exit |
| `--json` | Machine-readable |

Prints documents indexed, elapsed time, and resident index size. Rebuild is
seconds for a few thousand documents and loses nothing, because the index is
derived ([ADR-0004](./12-adr/0004-lexical-search-first.md)).

Exit 0, or 1 if the brain root is unreadable.

### `gbrain serve`

| Flag | Effect |
|---|---|
| `--stdio` | stdio transport. Logs to stderr only |
| `--http` | Streamable HTTP transport plus `GET /health` |
| `--port <n>` | Overrides `MCP_HTTP_PORT` |
| `--brain-root <dir>` | Overrides `BRAIN_ROOT`. Still subject to the startup guard |
| `--no-watch` | Do not attach the filesystem watcher. The index goes stale as writes land; use it for a read-only process or when inotify handles are scarce |

HTTP prints a startup banner and then structured lines to stderr. stdio prints
the banner to stderr and nothing at all to stdout. Both shut down cleanly on
`SIGINT`/`SIGTERM`: the watcher detaches, any debounced commit is flushed, and
the process exits 0.

Exit 1 if the port is taken or the brain root is unreachable; 4 if the guard
trips.

## Backup and recovery

There is no database and nothing proprietary, so every one of these is a git
operation ([ADR-0003](./12-adr/0003-git-as-the-history-layer.md)).

### Backup is `git push`

```bash
cd ~/brain
git remote add origin git@github.com:you/brain.git
git push -u origin main
```

That is the whole backup story. `git.unpushed` on `/health` is your backup lag.

### Sync between machines is `git pull`

```bash
cd ~/brain && git pull --rebase
```

Nothing to reconcile afterwards. Etags are content hashes, so a pulled file gets
a new etag automatically and optimistic concurrency stays correct across edits
g-brain never saw. The index picks the change up on the next watch tick.

Two machines writing the same document produce an ordinary git merge conflict in
markdown. g-brain does not resolve it — you do, in a text editor, the same way
you resolve any other.

### Recovering a deleted document

```bash
cd ~/brain
git log --oneline --diff-filter=D -- 10-knowledge/auth/oidc-token-refresh.md
git show <sha>^:10-knowledge/auth/oidc-token-refresh.md > 10-knowledge/auth/oidc-token-refresh.md
```

A soft delete never needed this — `brain_delete` moves the document to
`90-archive/` mirroring its path, so it is still on disk and still searchable.
The command above is for a hard delete, or for content removed by hand.

**What is lost:** nothing in the document. The restore is a filesystem write
g-brain did not make, so it produces no audit line and no commit until you
commit it. Commit it.

### Recovering from a corrupted or wrong index

```bash
rm -rf ~/brain/.brain/index
gbrain index --rebuild
```

**What is lost:** nothing. The index is derived from the files and holds no
authority; if search and the filesystem disagree, the filesystem is right. The
cost is the rebuild — seconds.

### Recovering from a lost `.brain/`

Deleting all of `.brain/` costs you the search index (rebuild it), the computed
backlinks (recomputed on demand), the agent keys, and the audit log.

**What is lost:** nothing essential, and two things worth naming. Agent keys are
gone — run `gbrain init --force` in place to generate a new one, or write
`.brain/agents.json` yourself, then re-register every client. And
`audit.jsonl` is gone for good, because it is gitignored and therefore was never
pushed. Every document, every revision, and the full commit history are
untouched.

## Routine operations

None of this is automated for you. The brain accumulates known imperfections by
design ([ADR-0002](./12-adr/0002-safety-only-write-guards.md)), and curation is
what absorbs them. A brain where nobody runs the curator degrades slowly and
quietly.

**Run the curator weekly.** An agent with the `brain-curate` skill, given
`gbrain doctor --json`, works the list: files inbox items, merges
near-duplicates, promotes durable findings out of old session logs, archives
finished projects. Every action is a commit, so `git log -p` is the review and
`git revert` is the undo ([UC-4](../functional/04-use-cases.md)).

**Empty the inbox.** `00-inbox/` is a queue, not a folder. Each item carries a
`needs-filing` reason the agent wrote when it could not decide; that reason is
the instruction. An item nobody can place is a signal the structure document is
missing a section — fix the document, not the item.

**Read the drift report.** Drift means a document sits somewhere
`content-structure.md` does not describe. There are two correct responses and
picking between them is the judgement call:

- The document is in the wrong place → move it.
- The agents keep putting things there → **the structure document is wrong.**
  Agents filing consistently into an undeclared folder are telling you about a
  category you did not write down. Edit `content-structure.md` and the drift
  disappears with no files moving.

Drift concentrated in one folder is almost always the second case.

**Archive finished projects.** Move `20-projects/foo/` to
`90-archive/projects/foo/`, mirroring the path. Archive is de-prioritised in
search, never excluded, so the content stays findable and stops competing with
live work.

**Session expiry.** `doctor` reports `60-sessions/` content older than
`SESSION_EXPIRY_DAYS` (default 90). **Expiry archives; it never deletes.**
Before archiving a batch, ask the curator to promote anything durable out of it
first — session logs are where knowledge goes to die, and archiving them
unpromoted is how it dies quietly.

**Push cadence is manual by default.** Nothing pushes to `origin` unless you do.
An interval push is a one-line cron entry if you want it, but silently pushing
an agent's writes to a shared remote is a surprise worth not having by default.
Decide the cadence deliberately and write it down in the brain's `README.md`.

## Troubleshooting

| Symptom | Likely cause | What to do |
|---|---|---|
| Writes failing with `PRECONDITION_REQUIRED` | The agent is replacing an existing document without `ifMatch`. Usually it wrote to a path that already exists, believing it was new | Correct behaviour, not a fault. The agent should `brain_read` for the etag and retry, or use `brain_append` for anything additive. Persistent cases mean the agent is not searching first — see [the agent contract](../functional/07-agent-contract.md) |
| Search returns stale results | The index is behind the filesystem | Check `index.staleSeconds` and `index.watching` on `/health`. If watching is false, restart `serve`; if it is true and stale is climbing, the watcher is saturated — `gbrain index --rebuild` |
| Index not updating at all | Watcher never attached (`--no-watch`), inotify handle limit exhausted, or the brain is on a network or virtualised filesystem where events do not propagate | Raise `fs.inotify.max_user_watches`, or run `gbrain index --watch` as a separate process. On a filesystem with no reliable events, schedule `gbrain index --rebuild` instead |
| Git commits not appearing | `GIT_AUTOCOMMIT` is `false` (the default), the brain root is not a git repo, or git is refusing the repo for dubious ownership in a container | Check `git.autocommit` and `git.repo` on `/health`, then `git status` in the brain root. In Docker, add `safe.directory`. Writes succeed regardless — a git failure never fails a write, which is why this can run unnoticed |
| A lock held by a dead process | The process was killed between acquiring and releasing a per-path lock | `proper-lockfile` expires stale locks on its own; wait out the staleness window before intervening. If it will not clear, delete the specific `.lock` entry for that path — never the whole directory while a server is running. See [storage and concurrency](./04-storage-and-concurrency.md) |
| Disk filling | Git keeps every revision of every document, and a brain with heavy churn grows well past its working tree. Session logs are usually the bulk | `git gc --aggressive`, then archive expired sessions. If the repo itself is the problem, the content is not — the working tree is small; the history is what grew |
| An agent will not call `brain_structure` | Its client did not surface the tool description, or the session never had the structure attached | Attach `brain://structure` as a session resource. Check the drift report — an agent routing from memory produces drift in a recognisable pattern. If a whole client family does it, the tool description is the fix, because the descriptions are part of the product |

## Operational limits

Stated plainly, because you will hit these before you hit anything else.

- **One process serves one `BRAIN_ROOT`.** There is no multi-tenancy. Two brains
  means two processes on two ports. Several `gbrain` invocations and a running
  server against the *same* root are fine — they coordinate through per-path
  locks and etags on the filesystem, not through shared memory.
- **Filesystem walks degrade past a few thousand documents.** `doctor`, the
  initial index build, and any metadata query the index cannot answer read
  frontmatter across the corpus. Comfortable in the hundreds to low thousands;
  genuinely slow beyond that ([ADR-0003](./12-adr/0003-git-as-the-history-layer.md)).
- **The whole index sits in memory.** Fine for thousands of documents, not a
  plan for a hundred thousand. Resident size is in `gbrain index --stats`.
- **Cold start rebuilds the index.** Every process restart pays it, so a large
  brain has a real startup cost. There is no persisted index to load, by
  choice — persistence buys little when the thing is disposable and rebuilds in
  seconds ([ADR-0004](./12-adr/0004-lexical-search-first.md)).
- **Git operations serialise and cost tens of milliseconds.** Commits are
  debounced so bursts batch, but a bulk import should run with
  `GIT_AUTOCOMMIT=false` and one commit at the end.

## Related

- [Tech stack](./02-tech-stack.md) — the dependency behind each of these knobs
- [Storage and concurrency](./04-storage-and-concurrency.md) — locks, etags, atomic writes
- [Git and audit](./07-git-and-audit.md) — commit behaviour, history, revert
- [Security](./08-security.md) — agent keys, scopes, secret scanning
- [Onboarding](../functional/03-onboarding.md) — presets and first run from the user's side
