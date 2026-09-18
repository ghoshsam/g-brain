# Content Structure

You are reading the filing convention for this brain. Everything written here is
shared — other agents and humans will read what you write, months from now,
without you around to explain it. Read this file before writing anything.

**How to choose a location**

1. Ask what the content *is*, not what you were doing when you produced it.
   A decision made during a debugging session is a decision, not a session log.
2. Ask how long it stays true. A rule to apply from now on → `05-memory/`.
   Durable explanation → `10-knowledge/`. Tied to one piece of work →
   `20-projects/`. True only for today → `60-sessions/`.
3. Read the folder section below and check the "belongs here / does not belong
   here" lines. They are the actual test.
4. If two folders both fit, pick the one where someone would *look for it*, not
   the one where it was produced.
5. If nothing fits, write to `00-inbox/` and set `needs-filing: true` in the
   frontmatter with a one-line reason. That is a correct answer, not a failure.
   Guessing wrong is worse than using the inbox — a misfiled doc is invisible.

**Before you create a file, search first.** Updating an existing document is
almost always better than adding a near-duplicate. A brain with three
overlapping notes on the same topic is worse than one with a single good one.

---

## File naming and frontmatter

- Lowercase kebab-case, `.md`: `oidc-token-refresh.md`, not `OIDC Token Refresh.md`.
- The filename describes the content, not the date or the author. Dates belong
  in frontmatter and, where a folder says so, in the path.
- One idea per file. If a file needs two `#` headings, it is two files.

Every file starts with frontmatter:

```yaml
---
title: OIDC token refresh          # a human sentence, not the filename
type: how-to                       # see the type list below
tags: [auth, oidc, api]            # lowercase, reuse existing tags where you can
created: 2026-09-18                # stamped for you if you omit it
updated: 2026-09-18                # stamped for you on every write
---
```

Useful optional fields: `status` (`draft` | `active` | `superseded`),
`project`, `source` (where this came from — a URL, a ticket, a conversation),
`supersedes` / `superseded-by` (a path), `needs-filing` (inbox only),
`expires` (a date, for content that should not outlive it).

`type` is one of: `concept`, `how-to`, `reference`, `decision`, `playbook`,
`note`, `status`, `meeting`, `profile`, `session`, `memory`.

---

## 00-inbox/

Captures that do not clearly belong anywhere else yet.

**Belongs here:** anything you cannot confidently place; content that spans
several folders and needs a human to split it; a capture made with too little
context to file properly.

**Does not belong here:** anything you *could* have filed. The inbox is an
escape hatch, not a default. If you find yourself using it more than
occasionally, the problem is this file — say so, and a human will fix it.

Set `needs-filing: true` and explain in one line why you could not place it.
The curator agent and humans empty this folder; nothing should live here long.

---

## 05-memory/

How we work. The things an agent should apply without being told.

**Belongs here:** conventions and preferences ("we use pnpm, never npm"),
standing constraints ("never run migrations without asking"), corrections a
human has given that should stick, tool and environment facts, the commands that
actually work in this codebase.

**Does not belong here:** how a system works (`10-knowledge/`), a choice and its
reasoning (`40-decisions/`), a step-by-step procedure (`50-playbooks/`), or
anything about a person as a person (`30-people/`).

The test: *would an agent starting cold need to apply this without being asked?*
If yes, it is memory. If it is something an agent would look up when it needed
it, it is knowledge.

**Keep these files short.** This folder is read at the start of sessions, so
every line costs. One topic per file, a few lines each. When a memory grows into
an explanation, move the explanation to `10-knowledge/` and leave the rule here.

If a human corrects an agent and the correction should hold next time, it goes
here. That is the single most valuable thing in this folder.

Example: `05-memory/build-and-test.md`

---

## 10-knowledge/{topic}/

Durable reference that outlives any single project. The answer to "how does
this work?" or "what does this mean?"

**Belongs here:** how a system works, what a term means, an explanation of a
protocol or an internal service, a how-to that will still be correct next year,
research findings, competitor or vendor analysis.

**Does not belong here:** anything scoped to one project (`20-projects/`),
anything that records a choice and its reasoning (`40-decisions/`), or a
step-by-step operational procedure (`50-playbooks/`).

The test: *if this project were cancelled tomorrow, would this still be worth
keeping?* If yes, it goes here.

`{topic}` is a short domain folder — `auth`, `billing`, `infrastructure`,
`ai`. Reuse an existing topic before inventing one; check the folder tree first.

Example: `10-knowledge/auth/oidc-token-refresh.md`

---

## 20-projects/{project}/

Everything scoped to one active piece of work.

**Belongs here:** status updates, working notes, meeting records, open
questions, scoping and research specific to this project, links to the
decisions and knowledge it depends on.

**Does not belong here:** knowledge that would survive the project ending — write
that in `10-knowledge/` and link to it from here. That single habit is what
stops a brain from turning into a graveyard of dead project folders.

`{project}` is kebab-case and stable — pick the name once and keep it. Within a
project folder, use flat files unless it grows past ~20 docs.

**A project is a piece of work, not a repository.** One project often spans
several repos, and some have no code at all — a vendor evaluation, a migration,
a launch. Do not name the folder after the repo you happen to be working in, and
do not create a new project because you are in a different repo. **Check the
folder tree and reuse an existing project before inventing one.** If you cannot
tell which project this belongs to, that is an inbox case.

Record the repos a project spans in its `README.md` and in `repos:` on the
documents that need it. That is context, not the project's identity.

When a project finishes, the whole folder moves to `90-archive/projects/{project}/`.

Example: `20-projects/g-brain/open-questions.md`

---

## 30-people/

Who does what, and how to work with them.

**Belongs here:** roles and ownership, team shapes, areas of expertise, stated
working preferences ("prefers async review", "owns the billing service").

**Does not belong here:** anything personal, sensitive, or evaluative. No
contact details, no performance opinions, no health or personal circumstances,
no anything you would not say to the person's face in a public standup. If you
are unsure whether something is appropriate, it is not — leave it out.

Example: `30-people/platform-team.md`

---

## 40-decisions/{yyyy}/

Choices and the reasoning behind them, ADR-style.

**Belongs here:** any decision someone might later ask "why did we do it that
way?" about — technical choices, process changes, vendor selection, things
deliberately *not* done.

**Does not belong here:** the resulting implementation details (those are
`10-knowledge/`), or a decision still under discussion (that is a project note
until it is made).

Structure each one: context, options considered, decision, consequences.

**Accepted decisions are not rewritten.** If a decision changes, write a new one
in the current year, set `supersedes:` on the new file and `superseded-by:` on
the old, and leave the old text intact. The record of what you believed at the
time is the point.

Example: `40-decisions/2026/use-git-as-the-history-layer.md`

---

## 50-playbooks/

Repeatable procedures someone follows step by step.

**Belongs here:** "how to cut a release", "how to onboard a customer", "what to
do when the queue backs up". Numbered steps, exact commands, clear
preconditions and a definition of done.

**Does not belong here:** explanation of *why* the system works the way it does
(that is `10-knowledge/`). A playbook is executed, not studied — keep the prose
out of it and link to the knowledge doc instead.

Example: `50-playbooks/cut-a-release.md`

---

## 60-sessions/{yyyy}/{mm}/

Agent session logs and working scratch.

This is the session store. Everything an agent needs to remember *within* a
piece of work, and nothing it needs after.

**Belongs here:** what an agent did in a session, intermediate findings, raw
output kept temporarily for traceability.

**Does not belong here:** anything you want to be able to find later. Assume
everything here is deleted after 90 days.

**This folder is a trap.** The failure mode of every second brain is that
agents log their sessions and never promote what they learned, so the durable
knowledge is buried in dated scratch nobody reads. Before you close a session,
ask what you learned that will still be true next month, and write *that* to
`05-memory/`, `10-knowledge/`, `40-decisions/`, or the relevant project — then
link to it from the session log.

Example: `60-sessions/2026/09/refactor-auth-middleware.md`

---

## 90-archive/

Finished or superseded content, kept for history.

**Belongs here:** completed project folders, retired playbooks, content replaced
by something newer.

**Does not belong here:** anything still in use. Archiving is how you keep the
active folders readable — move things here rather than deleting them, and
nothing is ever lost.

Mirror the original path: `20-projects/foo/` → `90-archive/projects/foo/`.
Search de-prioritises this folder; it stays findable, not prominent.

---

## Conventions

- **Link generously.** `[[10-knowledge/auth/oidc-token-refresh.md]]` — relative
  to the brain root. Backlinks are computed for you, so a link in one direction
  makes the document findable from both. An unlinked document is nearly
  invisible; linking is the cheapest thing you can do to make the brain useful.
- **Write for someone who was not there.** No "as discussed", no "the usual
  approach", no unexplained pronouns. State what, why, and what it means.
- **Lead with the answer.** First paragraph says the thing. Detail follows.
  Agents and humans both read the top of the file and stop.
- **Record the reasoning, not just the outcome.** "We use X" is worth little.
  "We use X because Y, having rejected Z for reason W" is worth keeping.
- **Prefer editing to adding.** Search before you write. If a document is
  nearly right, improve it.
- **Never write secrets or personal data** — no keys, tokens, credentials,
  connection strings, or personal details. Writes containing them are rejected,
  and the brain is shared.
- **Say when you are unsure.** Mark uncertain content as such rather than
  stating it confidently. A brain full of confident wrong answers is worse than
  an empty one.
