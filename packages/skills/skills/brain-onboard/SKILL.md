---
name: brain-onboard
description: Write or revise this brain's filing convention — the content-structure.md that every routing decision depends on. Use when setting up a new brain, or when agents keep filing things in the wrong place.
---

# Define the filing convention

`content-structure.md` is the product. Every other part exists to serve it. A
vague one means the brain is filed into badly forever, and no amount of search
quality compensates.

It is **prose written for a model to read**, not a schema. Nothing parses it.

## How to run this

1. **Read what is there now** with `brain_structure`, and look at the folder
   tree it returns — that is what people are *actually* doing.
2. **Interview the user.** What kinds of things does the team need to remember?
   What does a project look like? Who needs to find what, and when? What got
   lost last time?
3. **Start from a preset and edit it.** A blank document is much harder to write
   well than an edit of a good one.
4. **Write it back** with `brain_write`. It goes through the same path as any
   document: versioned, reversible, auditable.

## What makes one that a model actually follows

**Put a decision procedure at the top, before the folder list.** The model reads
top-down, and the procedure is what it applies to the hard cases.

**For each folder, say what does NOT belong** — and name the folder it belongs
in instead. Exclusions do more work than inclusions: almost no misfile is a
document that fits nowhere, and almost every misfile is one that plausibly fits
two places.

**Give exactly one real example path per folder.** Not a placeholder. A real one.

**Always have an inbox, and bless it explicitly.** Say that using it is a
correct answer. Without that, a model guesses rather than admitting uncertainty
— and a wrong guess is invisible where an inbox item is not.

**Name the known failure modes in the document itself.** The session-log folder
should say that it is where knowledge goes to die, because it is.

**State the test that separates the two folders people confuse most.** For most
teams that is durable knowledge versus project work: *if this project were
cancelled tomorrow, would this still be worth keeping?*

**Keep it under about 400 lines.** It is read on every routing decision, so
every line is tokens in every capture.

## Changing it later is normal

Teams learn what they actually file after a few weeks, and the document should
change. Editing it moves nothing — no path was ever validated against the old
text — and `gbrain doctor` reports what no longer matches as drift. A
restructure is a reviewable list, not a migration.
