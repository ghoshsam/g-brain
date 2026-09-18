---
title: Phase 1 — Structure and presets
description: The structure documents themselves. The product's core artifact, written before anything that serves it.
---

# Phase 1 — Structure and presets

**Status:** complete
**Delivers:** `seed/presets/` — `default.md`, `product-team.md`, `personal.md`,
`README.md`.

## Why this phase comes second, before any code

`content-structure.md` is the product. Every other phase builds something that
serves it, keeps it safe, or makes what it organises findable. If the presets
are vague, the brain is filed into badly forever and no amount of search quality
compensates — so they are written before there is anything to serve them, and
they are written as prose a model reads rather than as configuration
([ADR-0001](../../docs/technical/12-adr/0001-structure-doc-is-prose-not-schema.md)).

Writing them first also forces the content model to be settled by argument
rather than by whatever the code happened to make easy.

## Scope

**In:** the three presets and the README explaining how to add a fourth.
**Out:** the code that reads them (phase 3), `gbrain init` that copies them
(phase 5), the fixture set that tunes them (phase 8 and ongoing).

## Files

| File | Holds |
|---|---|
| `seed/presets/default.md` | A team, practice, or company. `00-inbox`, `10-knowledge`, `20-projects`, `30-people`, `40-decisions`, `50-playbooks`, `60-sessions`, `90-archive` |
| `seed/presets/product-team.md` | One product or platform team. Default plus `15-specs`, `45-incidents` |
| `seed/presets/personal.md` | One person. `inbox`, `notes`, `projects`, `log`, `archive` |
| `seed/presets/README.md` | What each preset is for, and how to add one with no code change |

## Definition of done

- [x] Each preset is a complete, standalone `content-structure.md` — copying it
      to a brain root is sufficient.
- [x] Each opens with a **decision procedure** before the folder list, because
      the model reads top-down.
- [x] Each folder section states what belongs **and what does not**. Exclusions
      do the real work — most misfiling is a document that plausibly fits two
      places.
- [x] Each folder gives one real example path.
- [x] Every preset has an inbox and **explicitly blesses using it** as a correct
      answer rather than a failure.
- [x] Every preset names the session-log trap in the session folder's own
      section.
- [x] Every preset carries the knowledge-vs-project test — *if this project were
      cancelled tomorrow, would this still be worth keeping?*
- [x] Every preset forbids secrets and personal data in its conventions.
- [x] Each stays under roughly 400 lines. It is read on every routing decision.
- [x] Adding a preset requires no code change.

## Tests

None automatable in this phase — a preset is prose. It is *measured* in phase 8
by the routing fixture set: ≥90% correct folder, zero silent misfiles. That
measurement tunes these files, and the findings feed
[`03-structure-doc-guide.md`](../../docs/technical/03-structure-doc-guide.md).

Until then the check is a read-through against the criteria above, and the
question asked of each folder section: *could a competent new colleague file
correctly from this alone?*

## Notes

These files will change after the fixture set exists. That is expected and is
the point of the design — editing them is editing prose, not migrating
anything.
