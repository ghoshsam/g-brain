---
title: Phase 4 — MCP
description: Tools, resources, prompts, both transports. The first end-to-end write, and the first point the product is real.
---

# Phase 4 — MCP

**Status:** complete — both transports, 224 tests passing
**Delivers:** `apps/mcp` — the only network surface, over stdio and streamable
HTTP.

## Why this is the milestone

At the end of this phase a real agent in Claude Code can capture a note and
recall it, **without being told a path**. That is the product working. Everything
before it is scaffolding for this moment and everything after it is improvement.

## Scope

**In:** tool registration and schemas, resources, prompts, both transports,
`GET /health`, the mapping from `Result<T>` to MCP tool errors, and the tool
descriptions.
**Out:** any behaviour. If something needs implementing here that is not a
mapping, it belongs in `core` and phase 3 missed it.

## What ships

| Kind | Name | FR |
|---|---|---|
| Tool | `brain_structure` | FR-01 |
| Tool | `brain_read` | FR-05 |
| Tool | `brain_list` | FR-06 |
| Tool | `brain_tree` | FR-07 |
| Tool | `brain_links` | FR-08 |
| Tool | `brain_write` | FR-09 |
| Tool | `brain_append` | FR-10 |
| Tool | `brain_search` | FR-23 — stubbed until phase 7, returning an explicit "index not built" result rather than an empty one |
| Tool | `brain_history` | FR-21 — stubbed until phase 6 |
| Resource | `brain://structure` | FR-01 |
| Prompt | `define-structure` | FR-04 |
| Endpoint | `GET /health` | FR-19 |

## Tool descriptions are part of the product

The model reads them. They are where the routing guidance actually reaches an
agent that has not read any documentation, so they are written with the same
care as the presets, not generated from the schemas:

- `brain_structure` says to call it before the first write in a session and to
  choose the path from what it returns.
- `brain_write` says to search first, that the inbox is a correct answer when
  uncertain, and that `ifMatch` is required when replacing.
- `brain_append` says to prefer it over `brain_write` for anything additive.

Wording is fixed in
[`05-mcp-reference.md`](../../docs/technical/05-mcp-reference.md) and changing it
is a product change, not a refactor.

## Definition of done

- [ ] **Zero-config first run (FR-28):** starting against a non-existent
      `BRAIN_ROOT` creates it from the `default` preset and reports it in the
      first `brain_structure` response. No interview, no failure, no commits.
- [ ] **Tools are sufficient (FR-29):** no capability requires resources or
      prompts. Verified by running the full test set with both disabled.
- [ ] **Descriptions carry the contract (FR-30):** the capture fixtures pass
      with **no skill loaded**. If they only pass with a skill, the descriptions
      are wrong, not the fixtures.
- [ ] Verified in more than one MCP client, not only Claude Code.
- [ ] Both transports serve the full tool set.
- [ ] `apps/mcp` imports `core` and the MCP SDK, and nothing else that touches
      the filesystem, git, or search.
- [ ] Every `BrainError.code` maps to a tool error that carries the code, so an
      agent can branch on it.
- [ ] HTTP connections require a bearer key; stdio is trusted as local by
      default and can still be made to require one.
      **Deferred with the HTTP transport** — key management was cut until a
      caller needs it, see [`decisions-log.md`](../decisions-log.md). The
      per-folder scope check stays and is enforced on every operation.
- [ ] `GET /health` returns brain root reachability, document count, index
      freshness, and git status.
- [ ] Tool input schemas are the Zod schemas from `core`, not a second
      definition.

## Tests

- **Mapping tests only.** For each error code, assert the tool result carries it.
  Behaviour is `core`'s, and re-testing it here duplicates coverage that will
  drift.
- An integration test per tool against a temp brain, asserting the round trip
  rather than the internals.
- `brain_structure` → `brain_write` → `brain_read` round-trips over stdio.
- An out-of-scope key on HTTP gets `FORBIDDEN`; an unknown key gets
  `UNAUTHORIZED`.

**Manual verification, and this is the part that counts:**

1. `npx @modelcontextprotocol/inspector node apps/mcp/dist/index.js` — every
   tool lists, `brain_structure` returns the document verbatim, `brain_write`
   round-trips.
2. Register in Claude Code against a real brain. Ask it to remember something
   without naming a folder. **Confirm it calls `brain_structure`, chooses a path
   from the prose, and writes there.**
3. In a new session, ask it what it knows about that topic. Confirm it finds it.

If step 2 needs a hint about where to put the note, the problem is the structure
document or the tool descriptions — not the code. That is the phase-8 feedback
loop starting early, and starting it here is deliberate.

## Risks

- **The MCP spec moves.** Pin the SDK, and keep the mapping layer thin enough
  that an SDK break touches one file.
- **Streamable HTTP session handling** is the fiddliest part of the SDK. Test
  reconnection and concurrent sessions against the same brain.
- **Temptation to add behaviour here** — a convenience default, a retry, a
  formatted message. Each one is a divergence between what MCP does and what the
  CLI does. Push it into `core`.
