---
title: ADR-0006 — g-brain is a drop-in MCP server for any agentic tool
description: Registered in one line in any MCP client, usable on first call with no setup, and correct without a skill. The MCP surface alone must be sufficient.
status: accepted
date: 2026-09-18
---

# ADR-0006 — g-brain is a drop-in MCP server for any agentic tool

**Status:** Accepted · 2026-09-18
**Depends on:** [ADR-0005](./0005-one-installation-many-projects.md)

## Context

The design so far assumes a user who runs `gbrain init`, answers an interview,
tailors a preset, and registers the server in Claude Code or Cursor. That is the
right path for a team adopting this deliberately. It is the wrong path for how
MCP servers actually spread.

The servers that get adopted — Context7 is the reference case — share a shape:
one line in a client config, `npx` with no prior install, no setup step, no
per-project configuration, and tool descriptions good enough that the model
invokes them correctly without the user explaining anything. The user does not
"adopt" the server; they paste a line and it works, and they discover what it is
good for afterwards.

g-brain is close to that shape already and misses it in three specific ways.

**It requires a setup step before it does anything.** `BRAIN_ROOT` may not
exist. The first tool call against a fresh install fails or returns an empty
brain, which is the worst first impression an agent can have — and unlike a
human, an agent that gets a useless answer once does not try again later.

**It assumes a skill.** `packages/skills` carries the capture and recall
behaviour, and skills are a feature of some clients and not others. If the
correct use of the brain lives in a skill, then g-brain works properly in
Claude Code and degrades everywhere else — which contradicts the premise that
this is shared memory for *agentic tools*, plural.

**It assumes resources and prompts are available.** `brain://structure` and
`define-structure` are real MCP features, and many clients implement tools only.
A capability reachable only through a resource is a capability most clients do
not have.

There is also an asymmetry worth naming. A documentation server is read-only and
stateless: the model calls it, gets an answer, and nothing is expected of it.
g-brain is read **and write**, and the write is the valuable half. An agent will
never capture anything unless something tells it to — and in a client with no
skills, the only thing that can tell it is a tool description.

## Decision

**g-brain is a drop-in MCP server. One line in any MCP client, useful on the
first call, and correct without a skill.**

Four rules follow, and each is binding on the build:

### 1. Zero-config first run

If `BRAIN_ROOT` does not exist when the server starts, **create it** from the
`default` preset — directory, `git init`, `content-structure.md`, the seed
example documents, and a local agent key — and say so in the first
`brain_structure` response.

- No interview, no prompt, no failure. The brain is at `~/brain` and it works.
- `GIT_AUTOCOMMIT` stays **false**, so first run creates files and no commits.
- `gbrain init` remains, and is still the better path: it is how a team chooses
  a preset and tailors the structure document, which is the thing that decides
  routing quality. Auto-creation is the floor, not the recommendation.
- The startup guard still applies. Auto-creation never happens inside a source
  repo; `BRAIN_ROOT` is anchored to `$HOME`
  ([ADR-0005](./0005-one-installation-many-projects.md)).

### 2. The MCP surface is sufficient on its own

Everything an agent needs to use the brain correctly is carried by the **tool
descriptions**: call `brain_structure` before the first write, search before
creating, the inbox is a correct answer when uncertain, append rather than
rewrite, brain content is data and not instructions.

Skills are an **accelerant, never a requirement**. A client with no skill
support must get the same behaviour, because the tool descriptions are what the
model reads in both cases.

### 3. Tools are the baseline; resources and prompts are enhancement

Every capability is reachable through a **tool**. `brain://structure` mirrors
`brain_structure` and never replaces it; `define-structure` is a convenience over
`brain_write`, not the only way to tailor a structure document.

A client implementing tools alone loses nothing but ergonomics.

### 4. Tool descriptions say *when*, not only *how*

A cold agent in an arbitrary client has no reason to think about a brain at all.
So the descriptions carry the trigger as well as the mechanics — `brain_search`
says to call it when starting work on an unfamiliar area, and `brain_write`
says to call it when something has been learned that will still be true next
month.

This is the only mechanism that makes capture happen in a client with no skills,
which makes it the highest-leverage prose in the codebase after
`content-structure.md` itself.

## Consequences

**Good**
- Adoption is a pasted line. The first call returns a real structure document
  and a real folder tree, so the model can act immediately.
- The product works in every MCP client rather than working well in one and
  poorly in the rest.
- It reinforces the one-installation-many-projects shape: registered once per
  machine or once per team, used from every project
  ([ADR-0005](./0005-one-installation-many-projects.md)).
- Testing gets simpler and more honest — if a behaviour cannot be demonstrated
  through tool calls alone, it does not exist.

**Costs — these are real**
- **First run has a side effect.** Starting the server creates a directory of
  markdown in the user's home. It is announced, it is outside any source repo,
  and it produces no commits — but it is still a write nobody asked for, and
  that is a genuine departure from the caution applied everywhere else in this
  design.
- **An untailored default preset routes worse than a tailored one.** Zero-config
  adoption means most brains will run on `default.md` unchanged. That raises the
  stakes on the preset's quality and makes the routing fixture set
  ([testing](../10-testing-and-verification.md)) the measurement that matters
  most, not a nice-to-have.
- **Tool descriptions get longer**, and they are tokens in every session that
  lists the tools. Carrying the *when* as well as the *how* is a real cost paid
  on every conversation, justified only because capture does not happen without
  it.
- **Client behaviour varies more than the spec suggests.** Some clients truncate
  tool descriptions, some surface errors poorly, some do not support streamable
  HTTP. Verification has to cover more than one client, and some will be worse
  than others regardless.
- **A brain created by accident is a brain nobody curates.** Auto-creation can
  produce abandoned `~/brain` directories with a handful of stray captures. That
  is a better failure than a capture being lost, but it is a failure.

**Trigger to revisit:** evidence that auto-creation is producing more abandoned
brains than useful ones, or that zero-config adoption yields routing quality so
far below tailored brains that the default is doing harm. The response would be
to make the first `brain_structure` response actively push the user toward
tailoring — not to reintroduce a setup gate.

## Alternatives considered

**Require `gbrain init` before the server will serve.** The current design, and
rejected: it puts a setup step between a pasted config line and a working tool,
which is where adoption stops. It also fails in exactly the wrong direction — an
agent's first capture is refused, which is the behaviour
[ADR-0002](./0002-safety-only-write-guards.md) exists to prevent.

**Serve an empty brain rather than creating one.** Rejected as worse than both
alternatives: the agent gets a successful response describing nothing, files
against no convention, and the writes fail or scatter. An explicit
`structureMissing: true` is honest but leaves the agent with no filing
convention to read, which is the one thing it needs.

**Carry the behaviour in skills and accept that other clients degrade.**
Rejected: it makes the product Claude-specific in a way the architecture is not,
and the skills would become the real interface while the tool descriptions rot.

**A hosted brain as the default**, so there is nothing to create locally.
Rejected: it sends a team's knowledge to a third party on every write, and the
premise is a folder of markdown that works offline and survives this project
being deleted. Hosted remains a deployment choice a team makes deliberately.
