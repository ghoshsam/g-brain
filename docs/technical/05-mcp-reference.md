---
title: MCP reference
description: The complete surface an agent sees — nine tools, one resource, one prompt, two transports, and the typed error codes they return.
---

# MCP reference

This is the interface contract. Everything an agent can do to a brain is in this
document, and nothing else is exposed.

`apps/mcp` holds no behaviour. Every tool is a mapping from MCP arguments onto a
`packages/core` function and from that function's `Result<T>` back onto a tool
result — see [architecture](./01-architecture.md). If a rule is not described
here, it is because it lives in `core` and applies identically to the CLI.

## Tool descriptions are part of the product

The model reads the tool descriptions before it reads anything else. They are
the only text guaranteed to be in context at the moment an agent decides whether
to capture and where to put it, so they carry the routing guidance rather than
describing the arguments:

- call `brain_structure` before the first write in a session
- search before you create
- the inbox is a correct answer
- append rather than rewrite
- never write secrets or personal data

These are the same rules as [the agent contract](../functional/07-agent-contract.md),
deliberately duplicated, because an agent that never read the contract still
reads the descriptions. Treat them as shipped product copy: changing the wording
changes routing behaviour, and a change is validated against the routing fixture
set the same way a change to a preset is
([ADR-0001](./12-adr/0001-structure-doc-is-prose-not-schema.md)).

**The cost, stated plainly:** the full tool list is roughly 700–900 tokens in
every session that connects, before a single call. That is the price of the
guidance being where the decision happens, and it is why the descriptions are
written tight and why the routing detail lives in `content-structure.md` — which
is fetched once — rather than being inlined here.

The shipped wording for the three tools that matter most is given verbatim
below.

## The tools

| Tool | Does | FR | Mutates |
|---|---|---|---|
| `brain_structure` | Structure document verbatim + live folder tree | [FR-01](../functional/06-functional-requirements.md) | no |
| `brain_read` | One document, with an etag | FR-05 | no |
| `brain_list` | Filtered metadata listing, no bodies | FR-06 | no |
| `brain_tree` | Folder tree alone | FR-07 | no |
| `brain_links` | Forward links and backlinks | FR-08 | no |
| `brain_write` | Create or replace a document | FR-02, FR-09, FR-11, FR-13 | yes |
| `brain_append` | Add to a document or a section | FR-10 | yes |
| `brain_search` | BM25 search with filters | FR-23 | no |
| `brain_history` | Revisions, and revert | FR-21 | only with `revertTo` |

Signatures below are the Zod schemas `apps/mcp` registers. They are not defined
there: they are `core`'s input types, exported from `core` so that one definition
serves both the tool contract and internal validation. That is why `zod` is a
`core` dependency ([tech stack](./02-tech-stack.md)).

Every tool also carries MCP annotations so a client can reason about it without
parsing the description:

| Annotation | Tools |
|---|---|
| `readOnlyHint: true` | `brain_structure`, `brain_read`, `brain_list`, `brain_tree`, `brain_links`, `brain_search` |
| `idempotentHint: true` | `brain_write` when `idempotencyKey` is supplied |
| `destructiveHint: false` | all of them — nothing in this surface removes content; delete is a move to `90-archive/` (FR-12) and revert is a new commit |

---

### `brain_structure`

```ts
{}   // no arguments
```

```ts
{
  brainName: string
  structure: string | null      // content-structure.md, byte-for-byte
  structureMissing: boolean     // true, with structure: null, on a brain mid-setup
  tree: Array<{ path: string; docCount: number }>
  totalDocs: number
  readAt: string                // ISO timestamp
}
```

The markdown is returned **verbatim** — unparsed, unmodified, not summarised. The
tree is built from the filesystem at call time and includes folders the structure
document does not mention; where the two disagree, the tree is the fact and the
difference is drift ([ADR-0001](./12-adr/0001-structure-doc-is-prose-not-schema.md)).

A brain with no `content-structure.md` returns successfully with
`structureMissing: true` and the tree. A half-set-up brain is still usable, and
an agent given a tree and no convention should write to `00-inbox/`.

**Errors:** `UNAUTHORIZED`, `FORBIDDEN`, `RATE_LIMITED`. There is no `NOT_FOUND`
here by design.

**Shipped description:**

> Return this brain's filing convention — the raw `content-structure.md` — plus
> the live folder tree with document counts. Call this before your first write
> in a session and choose the path from what it returns, never from memory or
> from another brain's conventions: the convention differs per brain and
> changes. If your client supports resources, attach `brain://structure` for the
> whole session instead of calling this repeatedly.

---

### `brain_read`

```ts
{
  path: z.string(),                                   // brain-root-relative, must end .md
  format: z.enum(['raw', 'parsed', 'html']).default('raw'),
  at: z.string().optional()                           // git sha or ref
}
```

```ts
{
  path: string
  etag: string                  // content hash — pass to ifMatch when replacing
  format: 'raw' | 'parsed' | 'html'
  content?: string              // raw, html
  frontmatter?: Record<string, unknown>   // parsed
  body?: string                           // parsed
  updated: string
  at?: string                   // the sha actually read, when at was supplied
}
```

`at` reads through git (`git show <sha>:<path>`) and returns no etag usable for a
write — historical content is read-only. To restore it, write it forward with
`brain_write` and the current etag, or use `brain_history({ revertTo })`.

`html` is a rendering convenience for clients that display content; it is derived
from the markdown on every call and is never stored. The brain holds markdown
only ([FR-27](../functional/06-functional-requirements.md)).

**Errors:** `NOT_FOUND`, `INVALID_PATH`, `UNAUTHORIZED`, `FORBIDDEN`,
`RATE_LIMITED`.

---

### `brain_list`

```ts
{
  folder: z.string().optional(),
  tag: z.string().optional(),
  type: z.string().optional(),
  status: z.string().optional(),
  updatedSince: z.string().optional(),   // ISO date or datetime
  limit: z.number().int().min(1).max(200).default(50),
  cursor: z.string().optional()
}
```

```ts
{
  items: Array<{
    path: string
    title: string | null
    type: string | null
    tags: string[]
    status: string | null
    updated: string
    bytes: number
  }>
  nextCursor: string | null
  truncated: boolean
}
```

**Metadata only — never bodies.** This is the tool an agent should reach for when
it knows the *shape* of what it wants, which is most of the time
([ADR-0004](./12-adr/0004-lexical-search-first.md)). Fetch the shortlist here,
then `brain_read` the two documents that matter.

Filters are conjunctive. `title`, `type`, and `status` are `null` where the
document has no such frontmatter field — frontmatter is linted, not enforced
([ADR-0002](./12-adr/0002-safety-only-write-guards.md)), so any consumer must
tolerate missing values.

The listing is a filesystem walk with frontmatter parsing, so it costs
proportionally to the corpus. Past a few thousand documents, prefer
`brain_search` with filters.

**Errors:** `INVALID_PATH` (a `folder` outside the brain root), `UNAUTHORIZED`,
`FORBIDDEN`, `RATE_LIMITED`.

---

### `brain_tree`

```ts
{
  root: z.string().optional(),                        // default: the brain root
  depth: z.number().int().min(1).max(10).default(3)
}
```

```ts
{
  root: string
  nodes: Array<{ path: string; docCount: number; depth: number }>
  totalDocs: number
}
```

The tree without the structure document — cheap orientation when an agent needs
to know what exists, not how to file. Roughly 50× smaller in tokens than
`brain_structure` on a typical brain. `.brain/` and `.git/` are never listed.

**Errors:** `INVALID_PATH`, `NOT_FOUND` (an explicit `root` that does not exist),
`UNAUTHORIZED`, `FORBIDDEN`.

---

### `brain_links`

```ts
{ path: z.string() }
```

```ts
{
  path: string
  links: Array<{ target: string; broken: boolean; raw: string }>
  backlinks: Array<{ from: string; title: string | null }>
}
```

Forward links are extracted from `[[brain-root-relative]]` wikilinks and relative
markdown links; `raw` is the original text, `target` the resolved brain-relative
path, and `broken: true` where nothing exists there. Backlinks are computed from
the corpus and cached in `.brain/` — derived, never authored, and safe to delete.

Following the link cluster is usually a better third move than a second search:
a document's neighbours were chosen by whoever wrote it.

**Errors:** `NOT_FOUND`, `INVALID_PATH`, `UNAUTHORIZED`, `FORBIDDEN`.

---

### `brain_write`

```ts
{
  path: z.string(),                       // brain-root-relative, must end .md
  content: z.string(),                    // full document including frontmatter
  ifMatch: z.string().optional(),         // required when replacing
  force: z.boolean().default(false),      // overrides near-duplicate only
  idempotencyKey: z.string().optional()
}
```

```ts
{
  path: string
  etag: string
  created: boolean              // true = new document, false = replaced
  drift: boolean                // the path is not described by the structure document
  driftReason?: string
  lint: Array<{ field: string; message: string }>   // warnings, never rejections
  commit?: string               // sha, when GIT_AUTOCOMMIT is on and the debounce has flushed
  replayed?: boolean            // true when an idempotencyKey returned a stored result
}
```

The full request path — every step, and where each can reject — is the table in
[architecture](./01-architecture.md#request-path-for-a-write). Four things matter
to a caller:

- **Creating needs no precondition. Replacing requires `ifMatch`.** Absent →
  `PRECONDITION_REQUIRED`; stale → `PRECONDITION_FAILED` with the current etag in
  `details`.
- **`force` overrides the near-duplicate guard and nothing else.** It does not
  override `ifMatch`, and there is no argument that does. Forcing past a
  concurrent writer is how work is lost.
- **A write to an undeclared folder succeeds** and comes back with
  `drift: true`. That is [FR-11](../functional/06-functional-requirements.md),
  not an oversight ([ADR-0002](./12-adr/0002-safety-only-write-guards.md)).
- **`created`, `updated`, and `id` are stamped** if the frontmatter omits them.
  Do not fabricate them.

The structure document is written through this tool like any other document
(FR-02) — same guards, same etag, same commit, same audit line.

**Errors:** `INVALID_PATH`, `UNAUTHORIZED`, `FORBIDDEN`, `RATE_LIMITED`,
`TOO_LARGE`, `UNSAFE_CONTENT`, `PRECONDITION_REQUIRED`, `PRECONDITION_FAILED`,
`CONFLICT`. Every one of them is a safety guard; none is a structure check.

**Shipped description:**

> Create a document, or replace one that already exists. Call `brain_structure`
> first and choose the path from the convention it returns. Search before you
> create — updating an existing document is almost always better than adding a
> near-duplicate. If you cannot confidently place the content, write it to
> `00-inbox/` with `needs-filing: true` and a one-line reason in the
> frontmatter: that is a correct answer, not a failure, because a wrong guess is
> invisible and an inbox item is a queue someone empties. Writing to a folder
> the convention does not mention succeeds and is recorded as drift — you will
> not be rejected for filing imperfectly. Replacing an existing document
> requires `ifMatch` with the etag from `brain_read`; on `PRECONDITION_FAILED`,
> re-read, merge the other writer's change, and retry with the new etag — never
> force. To add to a document that already exists, use `brain_append` instead.
> Never write secrets, credentials, tokens, connection strings, or personal
> information about people; the brain is shared and such writes are rejected.

---

### `brain_append`

```ts
{
  path: z.string(),
  content: z.string(),
  section: z.string().optional(),               // matches a markdown heading by its text
  createIfMissing: z.boolean().default(false)
}
```

```ts
{
  path: string
  etag: string                  // the etag after the append
  section: string | null
  sectionCreated: boolean       // the named section did not exist and was added
  created: boolean              // the document did not exist and was created
  drift: boolean
}
```

**No `ifMatch`, and none is accepted.** The append is performed inside the
per-path lock, so two agents appending concurrently both land — no read-modify-
write cycle, nothing to clobber, no `PRECONDITION_*` to handle. See
[storage and concurrency](./04-storage-and-concurrency.md).

`section` matches a heading by its text, case-insensitively, at any level; the
first match wins and the content goes at the end of that section, before the next
heading of the same or higher level. A missing section is appended with that
heading rather than failing — appending is additive by definition.

This should be the common mutation. `brain_write` is for genuine rewrites.

**Errors:** `NOT_FOUND` (unless `createIfMissing`), `INVALID_PATH`,
`UNSAFE_CONTENT`, `TOO_LARGE` (measured against the resulting document),
`RATE_LIMITED`, `UNAUTHORIZED`, `FORBIDDEN`. Never `CONFLICT` — near-duplicate
detection runs on create only.

**Shipped description:**

> Add content to the end of a document, or to a named section of it. Prefer this
> over `brain_write` for anything additive: it needs no etag, it cannot clobber
> a concurrent writer, and it never rewrites text someone else wrote. Reserve
> `brain_write` for genuine rewrites. `section` matches a markdown heading by
> its text; if that heading does not exist, the section is added. Never write
> secrets, credentials, tokens, connection strings, or personal information
> about people.

---

### `brain_search`

```ts
{
  q: z.string().min(1),
  folder: z.string().optional(),
  tag: z.string().optional(),
  type: z.string().optional(),
  limit: z.number().int().min(1).max(50).default(10)
}
```

```ts
{
  results: Array<{
    path: string
    title: string | null
    snippet: string             // matched terms in context
    score: number               // BM25, comparable within one result set only
    archived: boolean           // under 90-archive/ — ranked down, never excluded
    updated: string
  }>
  total: number
  indexedAt: string
  stale: boolean                // the watcher is behind the filesystem
}
```

Filters narrow the query inside the index rather than filtering afterwards, so
`folder`-scoped search stays cheap. `90-archive/` is de-prioritised by a rank
penalty, not excluded — superseded decisions must stay findable
([ADR-0004](./12-adr/0004-lexical-search-first.md)).

**BM25 misses vocabulary mismatches, and misses them silently.** An agent that
searched and found nothing relevant has not proved nothing relevant exists. That
is the known cost of lexical-first, and the reason the near-duplicate guard
exists as a second net. Details in [search design](./06-search-design.md).

**Errors:** `INVALID_PATH`, `UNAUTHORIZED`, `FORBIDDEN`, `RATE_LIMITED`. An empty
result set is a success, not an error.

---

### `brain_history`

```ts
{
  path: z.string(),
  limit: z.number().int().min(1).max(100).default(20),
  revertTo: z.string().optional(),      // a sha from revisions — mutating
  ifMatch: z.string().optional()        // required with revertTo
}
```

```ts
{
  path: string
  revisions: Array<{
    sha: string
    author: string               // agent-name <agent@g-brain.local>, or a human
    date: string
    message: string
  }>
  reverted?: { toSha: string; commit: string; etag: string }
}
```

Read-only without `revertTo`: it is `git log --follow` over one path.

With `revertTo`, it restores that revision's content as a **new** commit through
the ordinary write path — same guards, same audit line, history never rewritten
([ADR-0003](./12-adr/0003-git-as-the-history-layer.md)). `ifMatch` is required,
for the same reason it is required on a replace: a revert that silently discards
a concurrent write is the failure this whole design avoids. This is the one tool
whose shape is read but whose behaviour can mutate; it earns that by keeping
revert next to the revision list the agent just read, rather than adding a tenth
tool whose only job is to take a sha.

With `GIT_AUTOCOMMIT` off there is no history to list, and `revisions` comes back
empty. That is the default ([tech stack](./02-tech-stack.md)), so an agent must
handle an empty list as normal rather than as an error.

**Errors:** `NOT_FOUND` (the path, or the sha), `INVALID_PATH`,
`PRECONDITION_REQUIRED`, `PRECONDITION_FAILED`, `UNAUTHORIZED`, `FORBIDDEN`.

## Resources

### `brain://structure`

The same payload as `brain_structure`, exposed as an MCP resource so a client can
attach it to the session rather than calling a tool for it.

```
uri:       brain://structure
name:      Brain filing convention
mimeType:  text/markdown
```

The resource body is the structure document followed by the folder tree, as one
markdown document — readable as-is by a model with no unwrapping.

**Attach it for the whole session.** It is the cheapest way to make every write
in that session land correctly, and the reason is mechanical: the structure
document is only useful if it is in context at the moment the agent picks a path,
and an agent that has to decide *to call a tool first* will sometimes not. A
resource in context needs no decision. It costs the document once per session
instead of once per capture, which is also cheaper than calling `brain_structure`
repeatedly.

The server sends `notifications/resources/updated` when `content-structure.md`
changes, so a long session picks up a re-onboarding without reconnecting. Clients
that do not support resources call `brain_structure` once at session start; the
tool description says so.

Documents are deliberately **not** exposed as resources. A brain of a thousand
markdown files would flood a client's resource list with entries it cannot rank,
and `brain_list` plus `brain_search` are the tools built to rank them.

## Prompts

### `define-structure`

```ts
{
  preset: z.string().optional()    // a name from seed/presets/, e.g. "default"
}
```

The conversational onboarding path (FR-04), for people already inside Claude Code
or Cursor. The prompt returns a message sequence that has the agent:

1. Call `brain_structure`. Use the current document if there is one, otherwise the
   named preset, otherwise `default`.
2. Interview the user about how the team actually works — what they produce, what
   they look for later, what the existing folders miss.
3. Rewrite the prose accordingly: rename folders, drop sections that do not apply,
   add domain-specific ones, keep the "belongs here / does not belong here" lines
   because those are the lines that do the routing work
   ([structure doc guide](./03-structure-doc-guide.md)).
4. Show the diff and ask before writing.
5. Write it back with `brain_write({ path: "content-structure.md", ifMatch })`.

Step 5 is the point. **The structure document is written through the ordinary
write path**, which means it is atomic, etag-checked, committed, audited, and
revertable exactly like any other document. There is no special
`update_structure` tool, because there is no reason the most important document
in the brain should have a weaker write path than a session log.

Re-running the prompt on an established brain is the supported way to restructure:
existing files are not moved, nothing breaks because no path was ever validated,
and `gbrain doctor` reports what no longer matches as drift.

## Transports

`apps/mcp` serves one protocol over two transports. Both mount the identical tool
set from the same `core` instance; nothing is available on one and not the other.

| | stdio | streamable HTTP |
|---|---|---|
| For | Local clients — Claude Code, Cursor, the MCP Inspector | Remote and shared clients, CI agents |
| Started by | The client, as a child process | `gbrain serve`, or the Docker image |
| Endpoint | stdin/stdout | `POST /mcp`, with SSE for server→client messages |
| Auth default | `AUTH_REQUIRED=false` | `AUTH_REQUIRED=true` |
| Identity | The process owner | The bearer key |
| Plain HTTP endpoints | — | `GET /health`, and nothing else |

### stdio

A child process on the user's machine reading the user's filesystem as the user.
There is no privilege boundary to defend at the transport, so **stdio connections
are trusted as local by default** — `AUTH_REQUIRED=false`.

A key can still be required: set `AUTH_REQUIRED=true` and pass
`GBRAIN_KEY` in the client's `env` block. That is worth doing when one machine
runs several agents against one brain and you want per-agent scopes and audit
attribution rather than one undifferentiated local actor. Without a key, the
audit log records the actor as `local`.

### Streamable HTTP

Every request carries `Authorization: Bearer <key>`. Keys live in
`.brain/agents.json`, **stored hashed** — the plaintext is shown once by
`gbrain init` and never again.

```json
{
  "agents": [
    {
      "name": "claude-code",
      "key": "sha256:9f2c1e…",
      "scopes": {
        "read": ["**"],
        "write": ["00-inbox/**", "10-knowledge/**", "20-projects/**", "60-sessions/**"]
      }
    },
    {
      "name": "ci-indexer",
      "key": "sha256:4ab7d0…",
      "scopes": { "read": ["**"], "write": [] }
    }
  ]
}
```

Scopes are per-folder glob lists. An unknown key is `UNAUTHORIZED`; a known key
operating outside its scope is `FORBIDDEN`. An agent with an empty `write` list
cannot write anywhere, including `00-inbox/`.

**Authorisation is enforced in `core`, not in the transport** (FR-18). The
transport's entire security job is to turn a bearer token into an actor identity
and hand it to `core` in the `BrainContext`. That is what makes the CLI and every
future surface inherit the same rules rather than reimplementing them — see
[security](./08-security.md).

Terminate TLS in front of the process. The server speaks plain HTTP and does not
manage certificates; [operations](./09-operations.md) covers the deployment
shape.

### `GET /health`

The only plain HTTP endpoint in the entire project (FR-19). No MCP session, no
JSON-RPC envelope — a probe for a container orchestrator or a monitor.

```json
{
  "ok": true,
  "version": "1.0.0",
  "brainRoot": "/srv/brain",
  "reachable": true,
  "documents": 417,
  "index": { "builtAt": "2026-09-18T09:14:02Z", "documents": 417, "stale": false },
  "git": { "repo": true, "branch": "main", "head": "a1b2c3d", "dirty": false, "autocommit": true }
}
```

`ok` is `false` when the brain root is unreachable or is not a directory —
the one condition under which the server is running and useless. A stale index,
a dirty working tree, and `autocommit: false` are all reported and none of them
makes `ok` false; they are normal states, and a health check that fails on normal
states gets ignored.

Without a valid bearer key the response is `{ ok, version }` only. Document
counts, the brain path, and branch names are information about the brain, and an
unauthenticated probe does not need them.

## Registering the server

### Claude Code — stdio, local brain

`.mcp.json` in the project, or `~/.claude.json` for every project:

```json
{
  "mcpServers": {
    "brain": {
      "command": "npx",
      "args": ["-y", "gbrain", "serve", "--stdio"],
      "env": {
        "BRAIN_ROOT": "/Users/you/brain",
        "GIT_AUTOCOMMIT": "true"
      }
    }
  }
}
```

`gbrain init` prints this snippet with `BRAIN_ROOT` filled in, and writes it into
the new brain's `README.md` so the convention and the way to connect sit
together.

On Windows, `BRAIN_ROOT` is `%USERPROFILE%\brain`. **Never point it at a path
inside a source repository** — with `GIT_AUTOCOMMIT` on, the server would commit
an agent's captures into that working tree. It is the one misconfiguration the
defaults are shaped to prevent.

Verify before trusting it:

```bash
npx @modelcontextprotocol/inspector npx -y gbrain serve --stdio
```

### An HTTP client — shared brain

```bash
claude mcp add --transport http brain https://brain.internal:8787/mcp \
  --header "Authorization: Bearer gbk_7f3a…"
```

Or as configuration, for any client that takes it:

```json
{
  "mcpServers": {
    "brain": {
      "type": "http",
      "url": "https://brain.internal:8787/mcp",
      "headers": { "Authorization": "Bearer gbk_7f3a…" }
    }
  }
}
```

Server side:

```bash
BRAIN_ROOT=/srv/brain \
MCP_TRANSPORT=http \
MCP_HTTP_PORT=8787 \
AUTH_REQUIRED=true \
GIT_AUTOCOMMIT=true \
gbrain serve
```

## Errors

Errors are **typed codes**. `core` is transport-neutral and knows nothing about
HTTP, so there are no status codes anywhere in this surface — the code is what an
agent branches on, and it is identical whether the caller reached `core` through
stdio, through HTTP, or through the CLI.

| Code | Means | What the agent does next |
|---|---|---|
| `NOT_FOUND` | No document at that path | Check the path with `brain_tree` or `brain_search`. Do not create a document at a guessed path to compensate |
| `INVALID_PATH` | Resolves outside the brain root, or is not `.md` | Fix the path. Never retry with a traversal variant |
| `PRECONDITION_REQUIRED` | Replacing an existing document with no `ifMatch` | `brain_read` the document, then retry with its etag |
| `PRECONDITION_FAILED` | Someone wrote since you read | Re-read, merge their change, retry with the etag in `details`. **Never** retry with `force` |
| `CONFLICT` | A near-duplicate exists in the same folder | Read the path in `details` and update that document instead. `force: true` only if yours is genuinely different |
| `UNSAFE_CONTENT` | Secret or PII found; nothing written | **Do not retry.** Remove the credential — do not obfuscate it — and reconsider whether the content belongs in a shared brain |
| `TOO_LARGE` | Body above `MAX_DOC_BYTES` | Split it into the documents it should have been. One idea per file |
| `RATE_LIMITED` | Per-key limit exceeded | Back off for `details.retryAfterMs`, then retry |
| `UNAUTHORIZED` | Unknown or missing key | Stop. This is configuration, not something to retry around |
| `FORBIDDEN` | The key lacks scope for that folder | Report it. Do not probe other paths looking for one that works |

This table is the same set as
[the agent contract](../functional/07-agent-contract.md) and the same set as
[FR error results](../functional/06-functional-requirements.md). There is no
eleventh code, and adding one is a change to `core`'s `BrainError` union that
every surface and both documents follow.

Note what is *not* in the list: there is no error for filing in the wrong place.
A write to an undeclared folder returns `ok` with `drift: true`
([ADR-0002](./12-adr/0002-safety-only-write-guards.md)).

### How `Result<T>` becomes an MCP tool error

`core` returns `Result<T>` and never throws for an expected condition:

```ts
type Result<T> = { ok: true; value: T } | { ok: false; error: BrainError }
```

`apps/mcp` maps it, and the mapping is the whole of the tool handler:

```ts
const r = await writeDoc(ctx, input)
if (r.ok) {
  return { content: [{ type: 'text', text: JSON.stringify(r.value) }],
           structuredContent: r.value }
}
return {
  isError: true,
  content: [{ type: 'text', text: `${r.error.code}: ${r.error.message}` }],
  structuredContent: { code: r.error.code, message: r.error.message, details: r.error.details }
}
```

Two consequences worth stating, because they shape how an agent reads a failure:

- **MCP has no error taxonomy for tool failures.** A failed tool call is an
  ordinary result with `isError: true`, so the typed code has to travel in the
  payload. It is put in both places on purpose: `structuredContent.code` for a
  client that branches programmatically, and the `CODE: message` text for the
  model, which reads the text. `message` is written for an agent to act on, not
  for a log.
- **Protocol errors are a different thing entirely.** An unknown tool name,
  malformed arguments that fail Zod parsing, or a dead transport surface as
  JSON-RPC errors from the SDK, never as a `BrainError`. If an agent sees
  something that is not one of the ten codes above, it is a client or wiring
  problem, and retrying the same call will not fix it.

The CLI performs the mirror-image mapping onto exit codes and printed output.
Both mappings are a `switch` on `code` with no logic in them, which is what keeps
the two surfaces incapable of disagreeing about what a write does.

## Related

- [The agent contract](../functional/07-agent-contract.md) — the behaviour these descriptions encode
- [Functional requirements](../functional/06-functional-requirements.md) — the FR-nn each tool implements
- [Storage and concurrency](./04-storage-and-concurrency.md) — etags, locks, atomic writes
- [Security](./08-security.md) — keys, scopes, secret scanning
- [Operations](./09-operations.md) — running the HTTP transport
- [Search design](./06-search-design.md) — what `brain_search` ranks and why
