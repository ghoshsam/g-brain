# Content Structure

This is a personal brain. It is small on purpose — four folders, no ceremony.
Read this before writing anything.

**How to choose a location**

1. Is it something I want to be able to look up later? → `notes/`
2. Is it tied to one thing I am actively working on? → `projects/{project}/`
3. Is it a session log or scratch I will not need next month? → `log/`
4. Is it finished or no longer true? → `archive/`
5. Genuinely unsure? → `inbox/`, with `needs-filing: true` and a one-line
   reason. That is a correct answer, not a failure.

**Search before you create.** Improving an existing note beats adding a second
one on the same topic.

---

## File naming and frontmatter

Lowercase kebab-case `.md` — `sourdough-hydration.md`, not `Sourdough Notes.md`.
One idea per file. Frontmatter:

```yaml
---
title: Sourdough hydration ratios
type: note
tags: [baking]
created: 2026-09-18
updated: 2026-09-18
---
```

Optional: `status`, `project`, `source` (a URL or where this came from),
`needs-filing`, `expires`.

`type` is one of: `note`, `how-to`, `reference`, `decision`, `idea`, `log`.

---

## inbox/

Anything unplaced. Set `needs-filing: true` and say why in one line. Empty it
regularly — an inbox that never empties is just a second, worse `notes/`.

---

## memory/

Things I want an agent to apply without me repeating them. Preferences, standing
rules, corrections that should stick.

**Does not belong here:** explanations I would look up when I need them — those
are `notes/`.

Keep these short. They are read at the start of sessions.

Example: `memory/how-i-like-code-reviews.md`

---

## notes/{topic}/

Everything durable. How something works, what I learned, a reference I want
again, a decision and why I made it, an idea worth keeping.

**Does not belong here:** anything scoped to one active project, and anything
I will not care about in a month.

`{topic}` is a short folder — `baking`, `health`, `tech`, `money`. Reuse an
existing topic before inventing one; check the folder tree first. Keep the list
short; a topic per note defeats the point.

Example: `notes/tech/how-dns-propagation-actually-works.md`

---

## projects/{project}/

One folder per active project: status, working notes, open questions, links out
to the notes it depends on.

**Does not belong here:** anything that will still matter once the project is
done — write that to `notes/` and link to it from here. Otherwise the useful
part gets buried in a folder I stop opening.

A project is a piece of work, not a repo — reuse an existing folder rather than
starting a new one because I am in a different checkout.

Finished projects move to `archive/projects/{project}/`.

---

## log/{yyyy}/{mm}/

Session logs and scratch. Assume everything here is gone after 90 days.

Before closing a session, ask what I learned that will still be true next
month, and write *that* to `notes/` — then link to it from the log. Otherwise
this folder quietly becomes where knowledge goes to die.

---

## archive/

Finished or superseded content. Mirror the original path:
`projects/foo/` → `archive/projects/foo/`. Archive rather than delete; nothing
is ever lost, and the active folders stay readable.

---

## Conventions

- **Link generously.** `[[notes/tech/how-dns-propagation-actually-works.md]]`,
  relative to the brain root. Backlinks are computed automatically, so one link
  makes a note findable from both ends.
- **Write for me in two years,** who will not remember the context. No "the
  thing we talked about", no unexplained pronouns.
- **Lead with the answer.** First paragraph says the thing; detail follows.
- **Record why, not just what.**
- **Prefer editing to adding.**
- **Never write secrets or credentials** — no keys, tokens, or passwords.
  Writes containing them are rejected.
- **Say when unsure.** Mark uncertain notes as such.
