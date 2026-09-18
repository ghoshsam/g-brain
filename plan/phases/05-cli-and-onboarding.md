---
title: Phase 5 — CLI and onboarding
description: gbrain init, doctor, index, serve. Getting from nothing to a working brain with an agent connected, in under five minutes.
---

# Phase 5 — CLI and onboarding

**Status:** complete — `init` and `doctor` working end to end
**Delivers:** `apps/cli` — `gbrain init | doctor | index | serve`.

## Why

Onboarding is not setup ceremony. It is the act of writing the document every
future routing decision depends on, and it happens before any content exists. A
brain whose structure document was never tailored will be filed into badly
forever, so `init` has to make tailoring the easy path rather than an optional
extra step.

`doctor` is the other half: because guards are safety-only, the brain
accumulates known imperfections by design
([ADR-0002](../../docs/technical/12-adr/0002-safety-only-write-guards.md)).
`doctor` is what makes them visible. Without it, permissiveness has no
counterweight.

## Scope

**In:** the four commands, preset discovery, the tailoring interview, agent key
generation, the MCP registration snippet, and the drift report.
**Out:** behaviour — the CLI calls `core` in-process and maps `Result<T>` to
exit codes and printed output.

## Commands

### `gbrain init [dir]`

Defaults to `~/brain` when no directory is given
([operations](../../docs/technical/09-operations.md#brain_root-placement)).

1. Create the directory and `git init` it. **Refuse** if the target resolves
   inside an existing git repo that is not going to be the brain's own — the
   accident this guard exists to prevent is auto-committing captures into a
   source working tree.
2. Ask what the brain is for; suggest a preset. Presets are discovered from
   `seed/presets/*.md` with no code change, using each file's first `#` heading
   and the paragraph beneath it.
3. Write `content-structure.md` from the chosen preset.
4. **Offer to tailor it.** The answers go to the calling LLM, which rewrites the
   prose — renames folders, drops sections that do not apply, adds
   domain-specific ones. Declining leaves the preset as-is, which is a fine
   place to start.
5. Seed one example document per folder from `seed/brain/`, so search and links
   have something real on first run and an agent can see the conventions
   demonstrated rather than only described.
6. Generate **narrow per-persona keys** into `.brain/agents.json` — capture,
   recall (read-only), and curator — rather than one key that can write
   everywhere (FR-31,
   [ADR-0007](../../docs/technical/12-adr/0007-multi-writer-safety.md)). Print
   the MCP registration snippet using the capture key.
7. Write the brain's `README.md` with that snippet in it.

Refuses to initialise over an existing non-empty brain unless `--force`.
Non-interactive when stdin is not a TTY — flags instead of prompts, so it works
in CI rather than hanging.

### `gbrain doctor`

Reports and **does not modify**: drift, broken links, orphans, near-duplicate
candidates, inbox contents with their stated filing reasons, expired content,
frontmatter lint warnings. Exit code is non-zero only on a real fault, not on
findings — findings are the normal state of a healthy brain.

The drift check starts **heuristic** (compare real paths against the `## folder/`
headings in the structure document, and report paths under no described folder).
The LLM-assisted version — asking a model whether each document matches its
folder's described purpose — is a better product and costs a model call per
document. Ship the heuristic; record the decision in
[`decisions-log.md`](../decisions-log.md).

### `gbrain index [--rebuild]`

Stubbed until phase 7. Rebuilds the search index from the files.

### `gbrain serve`

Starts the MCP HTTP transport. A thin wrapper over `apps/mcp`.

## Definition of done

- [x] FR-03 and FR-26 are implemented and tested.
- [x] `init` on a clean machine produces a working brain with an agent
      registered in under five minutes (success criterion S6), verified by
      actually doing it.
- [x] A **fresh brain reports zero findings**. Anything else teaches people to
      ignore `doctor`, and a report nobody reads is the only thing standing
      behind safety-only guards.
- [x] `init` refuses to create a brain inside a source repo.
- [x] Adding a preset file to `seed/presets/` makes it appear in `init` with no
      code change.
- [x] `init` is usable non-interactively.
- [x] `doctor` reports every category listed above and modifies nothing.
- [x] Every command maps `BrainError.code` to a distinct, documented exit code.

## Tests

- `init` into a temp directory: directory created, git repo initialised,
  `content-structure.md` matches the chosen preset byte for byte, seed documents
  present, `.brain/agents.json` has one key, `README.md` has the snippet.
- `init` into a directory inside an existing repo → refused, with a message that
  explains why.
- `init` over a non-empty brain → refused; `--force` succeeds.
- A preset dropped into `seed/presets/` appears in the list.
- `doctor` on a fixture brain with known faults reports exactly those faults:
  one drifted path, one broken link, one orphan, one near-duplicate pair, one
  inbox item, one expired document.
- `doctor` writes nothing — assert the fixture brain is byte-identical
  afterwards.

## Risks

- **The tailoring step is the highest-value and least testable part of the
  phase.** Its output is prose from a model. Verify it by running the routing
  fixtures against a tailored document in phase 8, not by asserting on strings.
- **`init` defaulting somewhere dangerous** is the failure with the worst
  consequences in the whole project. The guard gets an explicit test.
