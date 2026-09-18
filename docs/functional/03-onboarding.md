---
title: Onboarding
description: Defining the structure is step one. The presets, the three entry points, and when to re-onboard.
---

# Onboarding

Onboarding is not setup ceremony — it is the act of writing the document that
every future routing decision depends on. It happens before any content exists,
and it is the first thing a new user does.

## Why it comes first

`content-structure.md` is the product. Everything else — the MCP server, the
CLI, the search index — exists to serve it, keep it safe, and make what it
organises findable. A brain with a vague structure document will be filed into
badly forever, and no amount of search quality compensates.

So the flow is: choose a preset, tailor it to the team, *then* start capturing.

## Presets

Shipped in `seed/presets/`. Each is a complete `content-structure.md`.

| Preset | For | Folders |
|---|---|---|
| `default` | A team, practice, or company | `00-inbox`, `10-knowledge`, `20-projects`, `30-people`, `40-decisions`, `50-playbooks`, `60-sessions`, `90-archive` |
| `product-team` | One product or platform team | default, plus `15-specs`, `45-incidents` |
| `personal` | One person | `inbox`, `notes`, `projects`, `log`, `archive` |

Adding a preset is adding a markdown file — no code change. Most teams should
start from `default` and tailor rather than build from nothing; a blank
structure document is much harder to write well than an edit of a good one.

---

## Entry point 0 — register the server and call it

The shortest path, and the one most people will take. Add g-brain to any MCP
client and make one call; if `BRAIN_ROOT` does not exist, the server creates it
from the `default` preset and says so
([ADR-0006](../technical/12-adr/0006-drop-in-for-any-agentic-tool.md)).

No interview, no setup step, no per-project configuration. One installation
serves every project
([ADR-0005](../technical/12-adr/0005-one-installation-many-projects.md)).

**This is the floor, not the recommendation.** A brain running on an untailored
`default.md` routes measurably worse than a tailored one, and the structure
document is the thing that decides routing quality. Entry points 1 and 2 are how
it gets tailored — and the first `brain_structure` response says so.

---

## Entry point 1 — `gbrain init <dir>` (primary)

```bash
pnpm gbrain init ../our-brain
```

1. **Creates and `git init`s the target directory.** The brain is its own repo,
   separate from any source repo — see the
   [`BRAIN_ROOT` warning](../technical/09-operations.md#brain_root-placement).
2. **Asks what this brain is for** and suggests a preset.
3. **Writes `content-structure.md`** from that preset.
4. **Offers to tailor it.** The answers go to the calling LLM, which rewrites
   the prose — renames folders, drops sections that do not apply, adds
   domain-specific ones. Declining leaves the preset as-is, which is a fine
   place to start.
5. **Seeds one example document per folder**, so search and links have
   something real on first run, and so an agent can see the conventions
   demonstrated rather than only described.
6. **Generates the first agent key** in `.brain/agents.json` and prints the MCP
   registration snippet to paste into Claude Code or Cursor.

Under five minutes to a working brain with an agent connected. That is success
criterion S6.

---

## Entry point 2 — the MCP prompt `define-structure`

For running onboarding conversationally inside Claude Code or Cursor, which is
where most people already are.

The prompt has the agent read the current structure (or a preset), interview the
user about how their team works, and write the revised `content-structure.md`
back through `brain_write`. Because it is the same write path as any other
document, the result is versioned and reversible like everything else.

This is also the natural way to *revise* a structure later, since the agent can
see the folder tree and the drift report while it edits.

---

## Entry point 3 — reading the file in the brain repo

For the person who needs to understand or agree the convention without running
anything. The brain is a git repo, so `content-structure.md` sits at its root
and the git host renders it. That page *is* the convention, not a description of
it — it is the exact text the agents read, which is what makes it worth
arguing over.

`gbrain init` writes the MCP registration snippet into the brain's `README.md`,
so the convention and the way to connect to it sit next to each other.

---

## Re-onboarding is normal

Editing `content-structure.md` later is expected, not exceptional. Teams learn
what they actually file after a few weeks, and the document should change.

- Agents pick up the change on their next `brain_structure` call — there is
  nothing to redeploy or reindex.
- Existing files are **not** moved. Nothing breaks, because no path was ever
  validated against the old document.
- `gbrain doctor` reports which existing files no longer match the new
  description, as **drift**. A restructure is therefore a reviewable list, not a
  migration, and moving the files is an ordinary curation task the curator agent
  can do.

This property falls directly out of the decision not to enforce structure
server-side. It is the main practical payoff of
[ADR-0001](../technical/12-adr/0001-structure-doc-is-prose-not-schema.md).

## Related

- [Writing a structure doc an LLM follows](../technical/03-structure-doc-guide.md)
- [Content model](./05-content-model.md)
- [Operations](../technical/09-operations.md)
