---
title: Overview
description: What g-brain is, the problem it solves, and how success is measured.
---

# Overview

## The problem

Agentic tools have no shared memory. Claude Code, Cursor, CI agents, and MCP
clients each accumulate context inside a session and lose it at the end. The
workarounds all fail in the same way:

- **Per-repo `CLAUDE.md` / rules files** — scoped to one repo, edited by hand,
  and they describe how to work, not what the team knows.
- **Scratch notes in a docs folder** — nobody agrees where things go, so the
  same knowledge gets written three times in three places and found zero times.
- **A wiki** — humans maintain it, agents cannot reliably write to it, and it
  goes stale within a quarter.

The result is that an agent starting work on Monday knows nothing an agent
learned on Friday, and a human cannot tell which of five overlapping notes is
current.

## What g-brain is

A single shared, file-backed knowledge store that agents read from and write to
through one contract.

Its distinguishing idea: **a plain-text `content-structure.md` at the brain root
tells agents where things go, and an LLM reads it to decide.** It is written the
way you would brief a new team member — folder by folder, what belongs, what
does not, one example each. There is no schema to satisfy and no routing rules
engine. Routing intelligence lives in the model; the file is its context.

The consequence is that reorganising the brain is editing prose, and adapting
it to a new team is rewriting a document — not a migration, not a code change.

## Shape

- **Markdown files on disk** are the source of truth. Readable, diffable,
  greppable, portable, and useful even if every part of this project is deleted.
- **No database.** Git provides history, diff, blame, and rollback — the things
  a database would have been for. The search index is derived from the files
  and can be thrown away and rebuilt.
- **Two surfaces over one core:** an MCP server (stdio and streamable HTTP) and
  the `gbrain` CLI. All logic lives in `packages/core`; both surfaces are thin,
  so they cannot drift apart. Agent skills ride on the MCP tools rather than
  being a third surface.
- **Humans read the brain as a git repo.** The git host renders the folder tree,
  `content-structure.md`, and individual documents, and searches their text; VS
  Code or Obsidian open the same files locally. Nothing has to be built for this,
  which is a direct dividend of markdown-on-disk being the source of truth.

## Goals

1. An agent with no prior context can capture a note to the right place after a
   single `brain_structure` call, without a human naming a path.
2. Anything written is findable later — by folder, by tag, by full text, or by
   following a link.
3. Nothing is silently lost. Every write is atomic, versioned, and reversible.
4. Nothing unsafe is written. Secrets and personal data are rejected before
   they touch disk.
5. Adopting g-brain for a new team is writing one markdown file.
6. It works in **any** MCP client, not one — registered in a line, useful on the
   first call, and correct without a skill
   ([ADR-0006](../technical/12-adr/0006-drop-in-for-any-agentic-tool.md)).

## Non-goals

- **Not a wiki or a CMS.** There is no editing UI. Writes go through MCP;
  humans edit markdown in their editor or through an agent, and commit it like
  any other file.
- **Not a memory layer for a single agent.** It is deliberately shared. If only
  one agent reads it, a local file would do.
- **Not a RAG pipeline.** Retrieval is structured first — folders, tags, links,
  full text. Embeddings are an interface in v1, not a feature.
- **Not a system of record.** Nothing that must be correct for legal,
  financial, or compliance reasons belongs here.

## Success criteria

| # | Criterion | How it is measured |
|---|---|---|
| S1 | Agents file correctly from the prose alone | ≥90% correct folder on the routing fixture set; **zero silent misfiles** — uncertain content lands in `00-inbox/` |
| S2 | Capture is cheap enough to actually happen | A note is captured in one `brain_write` call after one `brain_structure` call |
| S3 | The brain does not rot | Near-duplicate rate stays low; `gbrain doctor` reports zero broken links and a shrinking inbox |
| S4 | Nothing is lost | Every write has a git commit; any doc is recoverable at any past revision |
| S5 | Nothing unsafe is stored | Zero secrets in the brain; the guard is tested, not assumed |
| S6 | Onboarding is trivial | `gbrain init` to a working brain with agents registered in under five minutes |
| S7 | It is drop-in | One config line in any MCP client → a working brain on the first call, with no setup step and no skill loaded |

S1 is the one that decides whether the product works. Everything else is
infrastructure around it.

## Related

- [Personas and jobs](./02-personas-and-jobs.md)
- [The agent contract](./07-agent-contract.md)
- [Architecture](../technical/01-architecture.md)
