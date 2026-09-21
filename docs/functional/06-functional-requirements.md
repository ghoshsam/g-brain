---
title: Functional requirements
description: Numbered FR-nn requirements with acceptance criteria. Every FR maps to at least one test.
---

# Functional requirements

Each requirement has acceptance criteria written so a test can assert them.
Verification requires every `FR-nn` to map to at least one test.

**Priority:** P0 = v1 cannot ship without it · P1 = v1 should have it ·
P2 = deferred but designed for.

**Surface.** MCP is the only surface that writes — stdio for local clients,
streamable HTTP for remote ones. Requirements are written against
`packages/core` operations, which the MCP tools expose, the CLI calls directly,
and the read-only web UI reads through, so they are transport-neutral: a
requirement states what the operation does, never how a transport reports it.

## Error results

`core` returns typed errors, not HTTP status codes. MCP surfaces them as tool
errors carrying the code.

| Code | Meaning |
|---|---|
| `NOT_FOUND` | No document at that path |
| `INVALID_PATH` | Escapes the brain root, or not `.md` |
| `PRECONDITION_REQUIRED` | Replacing an existing document without `ifMatch` |
| `PRECONDITION_FAILED` | `ifMatch` does not match the current etag |
| `CONFLICT` | A near-duplicate already exists |
| `UNSAFE_CONTENT` | Secret or PII detected; nothing written |
| `TOO_LARGE` | Body above the configured maximum |
| `RATE_LIMITED` | Per-key rate limit exceeded |
| `UNAUTHORIZED` / `FORBIDDEN` | Unknown key / key lacks scope for that folder |

---

## Structure and onboarding

### FR-01 — Serve the structure document (P0)
`brain_structure`, and the MCP resource `brain://structure`, return the raw
`content-structure.md`, the live folder tree with per-folder doc counts, and the
brain name.

- Markdown is returned **verbatim**, unparsed and unmodified.
- The tree reflects the filesystem at call time, including folders the structure
  document does not mention.
- A missing `content-structure.md` returns successfully with an explicit
  `structureMissing: true` flag and the tree — a brain mid-setup is still usable.

### FR-02 — Replace the structure document (P0)
The structure document is written through the same path as any document:
atomic, etag-checked, committed, audited.

### FR-03 — Initialise a brain from a preset (P0)
`gbrain init <dir>` creates the directory, `git init`s it, writes
`content-structure.md` from a chosen preset, seeds one example document per
folder, generates an agent key, and prints the MCP registration snippet.

- Presets are discovered from `seed/presets/*.md` with no code change.
- Refuses to initialise over an existing non-empty brain unless `--force`.

### FR-04 — Tailor the structure conversationally (P1)
The MCP prompt `define-structure` reads the current structure (or a preset),
interviews the user, and writes the result back via `brain_write`.

Convenience over `brain_write`, never the only route — a client that supports
tools alone can tailor a structure document by writing it
([ADR-0006](../technical/12-adr/0006-drop-in-for-any-agentic-tool.md)).

---

## Reading

### FR-05 — Read a document (P0)
`brain_read` returns content plus a strong `etag`.

- `format: raw | parsed | html`; `parsed` splits frontmatter from body.
- `at: <sha>` returns the content at that revision.
- Unknown path → `NOT_FOUND`.

### FR-06 — List and filter (P0)
`brain_list` filters by `folder`, `tag`, `type`, `status`, `updatedSince`, with
`limit` and `cursor`. Returns metadata only — path, title, type, tags, updated,
status — never bodies.

### FR-07 — Folder tree (P1)
`brain_tree` returns the tree alone, for cheap orientation without the full
structure document.

### FR-08 — Links and backlinks (P1)
`brain_links` returns forward links and backlinks for a document, each resolved
to a path and marked `broken: true` where the target does not exist.

---

## Writing

### FR-09 — Create or replace a document (P0)
`brain_write`.

- Creating at a new path needs no precondition.
- Replacing an existing document **requires** `ifMatch`; absent →
  `PRECONDITION_REQUIRED`, stale → `PRECONDITION_FAILED` with the current etag.
- Writes are atomic: a crash mid-write leaves either the old file or the new
  one, never a partial.
- `created`, `updated`, and `id` are stamped if absent.
- The result carries the new `etag`.

### FR-10 — Append and patch (P0)
`brain_append` adds to a document, or to a named section, without a
read-modify-write cycle, so concurrent agents cannot clobber each other.

### FR-11 — Writes to undeclared folders succeed (P0)
A write to a path the structure document does not describe **succeeds**, and is
recorded as drift in the audit log and reported by `gbrain doctor`.

This is a requirement, not an oversight. See
[ADR-0002](../technical/12-adr/0002-safety-only-write-guards.md).

### FR-12 — Soft delete (P1)
Deleting moves the document to `90-archive/`, mirroring its path. A hard delete
removes it, and is still recoverable from git history.

### FR-13 — Idempotent writes (P1)
An `idempotencyKey` replayed within the retention window returns the original
result without writing again.

---

## Safety

### FR-14 — Path containment (P0)
Any path resolving outside `BRAIN_ROOT`, or with an extension other than `.md`,
is rejected with `INVALID_PATH` before any filesystem access.

### FR-15 — Secret and PII rejection (P0)
Bodies are scanned for private keys, cloud credentials, bearer tokens, and
connection strings. A match returns `UNSAFE_CONTENT` naming the finding and its
line, and **nothing is written to disk**.

### FR-16 — Near-duplicate detection (P1)
On create, the body is compared against documents in the same folder. Similarity
above the configured threshold returns `CONFLICT` naming the existing path;
`force: true` overrides.

### FR-17 — Size and rate limits (P1)
Bodies above the configured maximum → `TOO_LARGE`. Per-key rate limits →
`RATE_LIMITED` with a retry hint.

### FR-18 — Authentication and scopes (P0)
Remote MCP connections carry a bearer key defined in `.brain/agents.json` with
per-folder `read`/`write` scopes. Unknown key → `UNAUTHORIZED`; out-of-scope
operation → `FORBIDDEN`. A read-only key cannot write anywhere.

- Authorisation is enforced in `core`, not in the transport, so every present
  and future surface inherits it.
- stdio connections are trusted as local by default; a key can still be required
  via config.

### FR-19 — Health endpoint (P1)
The streamable HTTP transport exposes `GET /health` returning brain root
reachability, document count, index freshness, and git status. The only plain
HTTP endpoint that transport exposes.

---

## History

### FR-20 — Commit per write (P0)
When `GIT_AUTOCOMMIT` is on, every write produces a git commit in the brain repo
authored as the calling agent, debounced so bursts batch into one commit.

### FR-21 — History and revert (P1)
`brain_history` lists a document's revisions; revert restores one as a new
commit. Reverting never rewrites history.

### FR-22 — Audit log (P0)
Every mutating operation appends one JSON line to `.brain/audit.jsonl`:
timestamp, actor, action, path, resulting etag, drift flag, outcome. Rejected
writes are logged too — a rejected secret write is exactly the event worth
having.

---

## Search

### FR-23 — Lexical search (P0)
`brain_search` returns BM25-ranked results with path, title, snippet, and score,
filterable by `folder`, `tag`, `type`. `90-archive/` is de-prioritised, not
excluded.

### FR-24 — Index freshness (P1)
The index updates within seconds of a write via filesystem watch, and
`gbrain index` rebuilds it from scratch. The index is derived and disposable —
deleting it must never lose data.

### FR-25 — Hybrid search interface (P2)
`packages/search` exposes `Retriever` and `Embedder` interfaces such that
enabling hybrid search is configuration plus an embedder implementation, with no
change to callers. v1 ships the interface and the lexical implementation only.

---

## Health and presentation

### FR-26 — Doctor (P1)
`gbrain doctor` reports drift, broken links, orphans, near-duplicates, inbox
contents with filing reasons, expired content, and frontmatter lint warnings.
It reports; it does not modify.

### FR-27 — Human-readable without any g-brain surface (P0)
A human can browse the folder tree, read `content-structure.md`, open any
document with its frontmatter visible, and search the text, using only a git
host or a text editor.

This is a **constraint on everything else**, not a feature to build. It holds
because the brain is a git repo of markdown, and it is satisfied by refusing to
break it:

- Documents stay plain markdown with YAML frontmatter. No custom syntax, no
  sidecar files that a document is incomplete without.
- Paths stay legible and are the document's identity, so a file listing is a
  usable table of contents.
- `[[path]]` links are brain-root-relative, so Obsidian resolves them on a clone.
- Derived state — the search index, backlinks, drift — lives in `.brain/` and is
  disposable. Deleting all of it loses nothing.

Verified by pushing a brain repo and confirming the host renders the tree, the
structure document, and individual documents legibly, and that its text search
finds content.

---

## Adoption

### FR-28 — Zero-config first run (P0)
Starting the MCP server against a `BRAIN_ROOT` that does not exist **creates
it** from the `default` preset — directory, `git init`, `content-structure.md`,
seed documents, and a local agent key — and reports it in the first
`brain_structure` response.

- No interview and no failure. Registering the server in any MCP client and
  making one call is sufficient to get a working brain.
- `GIT_AUTOCOMMIT` stays `false`, so first run creates files and no commits.
- The `BRAIN_ROOT` startup guard still applies: auto-creation never happens
  inside a source repo.
- `gbrain init` remains the better path, because tailoring the structure
  document is what decides routing quality.

### FR-31 — Per-persona keys by default (P1)
`gbrain init` generates narrow keys rather than one key that can write
everywhere: a read-only recall key, a capture key scoped to the capture folders,
and a curator key that is the only one permitted to write `90-archive/`.

A read-only key cannot write anywhere — the one preventive control against a
persona's mistakes ([ADR-0007](../technical/12-adr/0007-multi-writer-safety.md)).

### FR-32 — Curation is reviewable (P1)
A curation run produces a change plan — every move, merge, and archive it
intends, with reasons — before writing anything. An approved run lands as **one
labelled commit**, so undoing it is one command.

- Bulk operations are capped per run, and the cap is reported rather than
  silently applied.
- Promotion out of session logs is additive and exempt from approval.
- `gbrain doctor` reports and modifies nothing.

### FR-29 — Every capability is reachable through tools (P0)
No capability requires MCP resources or prompts. `brain://structure` mirrors
`brain_structure`; `define-structure` is convenience over `brain_write`. A client
implementing tools alone loses ergonomics and no function.

### FR-30 — Tool descriptions carry the contract (P0)
The tool descriptions state **when** to reach for the brain as well as how to
use it, so an agent in a client with no skill support still calls
`brain_structure` before its first write, searches before creating, uses the
inbox when uncertain, and appends rather than rewrites.

Skills are an accelerant, never a requirement. Verified by running the routing
and capture fixtures with **no skill loaded**.

---

## Projects and the web UI

### FR-33 — A project code resolves to its folder (P1)
Operations that take a `folder` also take a `project` code, which resolves to
`20-projects/{project}/`. It is sugar over `folder`, not a second addressing
scheme
([ADR-0008](../technical/12-adr/0008-project-scope-is-the-project-folder.md)).

- `project: billing` and `folder: 20-projects/billing` return the same result to
  the same caller, including the same error.
- Scopes match whole path segments, so a scope on `20-projects/billing` covers
  `20-projects/billing/**` and never reaches `20-projects/billing-platform`.
- There is no new authorisation path: a project is authorised by the folder
  scope of FR-18, and nothing else.

### FR-34 — Authorisation reads only the path and the scopes (P0)
An authorisation decision is made from the requested path and the caller's
scopes. It never reads a document body or its frontmatter — in particular, never
the `project:` field.

- Frontmatter is linted, not enforced, so `project: finance` in a body grants
  nothing and hides nothing.
- Authorisation happens before the content is parsed, so an agent's own text
  cannot decide whether the agent may write it.
- `project:` keeps its grouping and filtering job in the
  [content model](./05-content-model.md). It is not an access control field.

Verified by asserting the decision for a given actor and path is identical
whatever frontmatter or body the request carries.

### FR-35 — The project list is filtered by read scope (P1)
Listing projects lists the directories under `20-projects/`, filtered to those
the caller's read scopes cover. A project the caller cannot read is **absent**,
never listed and disabled — naming it would leak the shape of the brain
([ADR-0009](../technical/12-adr/0009-read-only-web-ui.md)).

- The list is derived from the filesystem at call time. There is no manifest, so
  the list and the access rules cannot disagree.
- A caller whose scopes cover no project gets an empty list, and nothing in the
  response says there was anything to hide.
- Addressing a project directly is still FR-18: out of scope is `FORBIDDEN`.
  Listing omits; an operation refuses.

### FR-36 — The web UI reads, and never writes (P1)
A read-only web UI lists projects, browses one project's folder tree, reads a
document, and searches. It has no create, edit, move, or delete path, and it
introduces no notion of a user — it is a caller like any other, carrying the
local actor where `AUTH_REQUIRED` is `false` or a bearer key over HTTP, for
which a read-only recall key is the right shape (FR-31).

- It is a view over `brain_tree`, `brain_list`, `brain_read`, and
  `brain_search`, and holds no logic — the rule that keeps `apps/mcp` and
  `apps/cli` thin applies to it unchanged.
- The tree it shows is the filesystem, never an idealised structure read out of
  `content-structure.md`.
- Access is per key, not per person: two viewers sharing a key are one caller,
  and the audit log names the key. An accepted cost, recorded in ADR-0009.

Verified by the surface exposing no mutating operation, under the same
architecture tests the other surfaces pass.

---

## Traceability

| Area | FRs | Primary flow |
|---|---|---|
| Structure & onboarding | FR-01 – FR-04 | [Onboarding](./03-onboarding.md), [UC-1](./04-use-cases.md) |
| Reading | FR-05 – FR-08 | [UC-2](./04-use-cases.md) |
| Writing | FR-09 – FR-13 | [UC-1](./04-use-cases.md) |
| Safety | FR-14 – FR-19 | Cross-cutting |
| History | FR-20 – FR-22 | [UC-4](./04-use-cases.md) |
| Search | FR-23 – FR-25 | [UC-2](./04-use-cases.md) |
| Health & presentation | FR-26 – FR-27 | [UC-3](./04-use-cases.md), [UC-4](./04-use-cases.md) |
| Adoption | FR-28 – FR-30 | [Onboarding](./03-onboarding.md), [agent contract](./07-agent-contract.md) |
| Multi-writer safety | FR-31 – FR-32 | [UC-4](./04-use-cases.md), cross-cutting |
| Projects & the web UI | FR-33 – FR-36 | [UC-3](./04-use-cases.md), cross-cutting |

FR-25 is the only P2 — an interface shipped without its implementation. Every
other FR maps to at least one test.

Beyond these, the routing quality bar from
[success criterion S1](./01-overview.md#success-criteria) — ≥90% correct folder
and zero silent misfiles on the fixture set — is the measure that decides
whether the product works at all.
