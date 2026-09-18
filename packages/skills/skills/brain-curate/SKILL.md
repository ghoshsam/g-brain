---
name: brain-curate
description: Keep the brain worth reading — empty the inbox, merge duplicates, archive finished work, and promote durable findings out of session logs. Use for a scheduled hygiene pass, or when gbrain doctor reports a backlog.
---

# Curate the brain

The brain accepts writes it knows are imperfect, on purpose: refusing a capture
loses it forever, where a misfiled document is recoverable. **This pass is what
makes that trade work.** Without it the permissiveness has no counterweight.

## Start with the report

```
gbrain doctor
```

It reports and changes nothing: drift, broken links, orphans, near-duplicates,
the inbox with each item's stated reason, expired content, lint warnings.

## Propose before you act

Moves, merges and archives are wide-reaching, and a run that touched two hundred
files is not something a human will review after the fact.

**Write the plan first** — every move, merge and archive you intend, with a
reason each — and get it approved before writing anything. Then make the whole
approved run land as **one labelled commit**, so undoing it is one command
rather than two hundred.

If a run would touch more documents than you can explain individually, it is too
big. Split it.

## The work, in order of value

### 1. Promote out of session logs — do this first

The failure mode of every second brain: agents log what they did, nobody
promotes what they learned, and the durable knowledge is buried in dated scratch
nobody reads.

For each old session log, ask **what here will still be true next month?** Write
that to `05-memory/`, `10-knowledge/`, or `40-decisions/`, then link the session
log to it.

This step is additive — it creates documents rather than moving them — so it
needs no approval. It is also the one most likely to be skipped, and the one
worth the most.

### 2. Empty the inbox

Each item carries the reason an agent could not place it. Read the reason, then
file it. If you still cannot decide, **leave it** and flag it for a human — the
inbox is allowed to be a queue with a person in it.

### 3. Merge near-duplicates

Merge into the better document. Leave the weaker path as a short stub that links
onward, so anything already pointing at it still resolves.

### 4. Fix broken links

A broken link usually means a document moved. Point it at the new path; do not
delete the link.

### 5. Archive finished work

Completed project folders move to `90-archive/projects/{name}/`, mirroring the
path. Archived content is still searchable, just ranked lower.

## Rules

- **Nothing is deleted.** Archive instead. `brain_delete` moves to
  `90-archive/`; hard deletion is for mistakes, and even then git has it.
- **Never rewrite an accepted decision.** Write a new one, set `supersedes` and
  `superseded-by` on both, and leave the old text intact. The record of what was
  believed at the time is the point.
- **Every action is a commit** a human can read and revert.
- **Drift is not automatically wrong.** Agents filing consistently into a folder
  the convention does not describe are telling you the convention is missing
  something. Consider editing `content-structure.md` rather than moving the
  documents.
