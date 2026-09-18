---
title: Use cases
description: The four core flows end to end — capture, cold-start recall, human browsing, and curation.
---

# Use cases

Four flows. If these work, the product works.

---

## UC-1 — An agent captures a decision mid-session

**Trigger:** During a task, the team decides to drop Redis and use Postgres
advisory locks instead. The agent recognises this as durable.

**Flow**

1. Agent calls `brain_structure`. Gets the raw `content-structure.md`, the live
   folder tree, and per-folder doc counts.
2. Agent reads the prose. `40-decisions/{yyyy}/` says it holds "choices someone
   might later ask *why did we do it that way?* about". It fits.
3. Agent calls `brain_search` for "redis lock" first, as the conventions
   instruct. Nothing relevant.
4. Agent calls `brain_write` to
   `40-decisions/2026/use-postgres-advisory-locks-over-redis.md` with context,
   options considered, decision, consequences, and a link to the knowledge doc
   on the locking behaviour.
5. Server: safety guards pass → atomic write → git commit authored as the
   agent → audit entry → search index updated on the next watch tick.

**Succeeds when** the agent never asked a human where to put it.

**Failure modes handled**
- Agent cannot decide → writes to `00-inbox/` with `needs-filing: true` and a
  reason. Visible, not lost.
- A doc already exists at that path → `PRECONDITION_REQUIRED` when `ifMatch` is
  absent; the agent reads it, merges, and retries with the etag.
- Near-identical doc exists → `CONFLICT` naming it; the agent updates that
  instead.

---

## UC-2 — An agent recalls project context on a cold start

**Trigger:** A new session begins on the billing work. The agent has no history.

**Flow**

1. `brain_structure` → understands the filing convention and sees the tree.
2. `brain_list` filtered to `20-projects/billing/` → current status and open
   questions.
3. `brain_search({ q: "billing", folder: "40-decisions" })` → past decisions, so
   it does not contradict one.
4. `brain_links` on the most relevant doc → follows backlinks to the knowledge
   docs the project depends on.
5. Begins work already knowing what was tried and rejected.

**Succeeds when** the agent avoids redoing or contradicting prior work.

**Design consequence:** structured filters come before full-text, because the
agent knows the *shape* of what it wants long before it knows the wording. This
is why lexical search is sufficient for v1 —
see [search design](../technical/06-search-design.md).

---

## UC-3 — A human browses the brain

**Trigger:** Someone wants to know what the agents have accumulated about auth.

The brain is a git repo of markdown, so this flow needs nothing built — the git
host, VS Code, and Obsidian already do it.

**Flow**

1. Opens the brain repo on the git host. The file listing *is* the folder tree,
   in structure-document order because of the numeric prefixes.
2. Uses the host's code search for "auth", or `grep`/`rg` against a local clone.
   An agent with `brain_search` gets better ranking; the human gets adequate.
3. Opens `10-knowledge/auth/oidc-token-refresh.md`. The host renders the
   markdown and the frontmatter, so `updated`, `status`, and `superseded-by` are
   visible on the page.
4. Reads `content-structure.md` at the repo root to understand the convention
   itself, and disagrees with where sessions are being filed.
5. Edits `content-structure.md` — via an agent, or as a commit in the brain repo
   like any other file. Agents pick up the change on their next
   `brain_structure` call. Nothing to redeploy.

**Succeeds when** the reader can tell what is current without asking anyone.

**Where this flow is weaker than an agent's.** The git host shows a document's
outgoing links but not its backlinks — a human follows the cluster by opening
the clone in Obsidian, where `[[path]]` resolves both ways — and it ranks search
results by its own rules rather than de-prioritising `90-archive/` the way
`brain_search` does. Worth knowing when someone says they could not find
something; neither affects what an agent retrieves.

---

## UC-4 — The curator agent runs weekly hygiene

**Trigger:** Scheduled, or a human asks for a cleanup.

**Flow**

1. `gbrain doctor` → drift (files that do not match the structure doc),
   broken links, orphans, near-duplicate candidates, inbox contents, expired
   content.
2. For each inbox item: reads the stated `needs-filing` reason, decides a
   destination, moves it. If it still cannot decide, it leaves it and flags for
   a human — the inbox is allowed to be a queue with a human in it.
3. Merges near-duplicates into the better document, leaving the weaker path as
   a superseded stub that links onward.
4. Archives finished project folders to `90-archive/projects/{name}/`.
5. Promotes durable findings out of old session logs into `10-knowledge/`,
   then archives the logs. This step is the one that matters most and the one
   most likely to be skipped.
6. Every action is a git commit. A human reviews `git log` and reverts anything
   wrong.

**Succeeds when** the inbox shrinks, duplicates fall, and nothing was destroyed
irreversibly.

---

## Cross-cutting: two agents write the same document at once

Not a user flow, but the concurrency case that must hold.

1. Agents A and B both read `20-projects/billing/status.md`, both get etag `E1`.
2. A writes with `ifMatch: E1` → succeeds, file is now `E2`.
3. B writes with `ifMatch: E1` → `PRECONDITION_FAILED`, current etag returned.
   Nothing overwritten.
4. B re-reads, merges, writes with `ifMatch: E2` → succeeds.

For append-only additions (a note, a log line), agents use `brain_append`
instead, which does not require a read-modify-write cycle and cannot clobber.
See [storage and concurrency](../technical/04-storage-and-concurrency.md).

## Related

- [Functional requirements](./06-functional-requirements.md) — the `FR-nn` these flows map to
- [The agent contract](./07-agent-contract.md)
