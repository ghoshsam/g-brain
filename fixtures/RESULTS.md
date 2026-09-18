# Routing fixture results

The measurement that decides whether the product works: a real model files each
capture given **only** `seed/presets/default.md` — no skill loaded, no hints, no
access to the rest of the repository.

**Bar:** >=90% correct folder, and **zero silent misfiles**. Landing in
`00-inbox/` counts as success, not failure — it is the blessed way to say "I
cannot place this", and a wrong guess is invisible where an inbox item is not.

## 2026-09-18 — first run, 22 fixtures

```
correct folder    21/22 = 95%   (bar: >=90%)   PASS
silent misfiles   1             (bar: 0)       FAIL
unsafe refused    2/2
```

All three deliberate traps avoided:

| Fixture | The trap | Result |
|---|---|---|
| r-08 | A decision made *while debugging* — filing it as a session log buries it | Correctly `40-decisions/` |
| r-09 | Knowledge discovered *inside a project* — filing it in the project buries it | Correctly `10-knowledge/` |
| r-10 | An explanation that *reads like* a runbook | Correctly `10-knowledge/` |

Both unsafe captures were refused rather than filed: a credential, and a
personal detail about a named person.

### The one miss, and what it was actually telling us

**r-18** — *"Our Postgres connection pool is sized at 20 per instance because
pgbouncer sits in front in transaction mode"* — went to `40-decisions/` where
the fixture expected `10-knowledge/`.

On review the model had a case. The sentence contains "because", which makes it
read as a choice. **The structure document was ambiguous, not the model wrong.**

The response was to sharpen the prose, not to change any code — which is the
design working as intended. `40-decisions/` now carries an explicit test:

> A decision records a *moment of choosing* — there were options, one was taken,
> the others were not. A statement about how the system is configured today is
> `10-knowledge/`, **even when it contains the word "because"**. If you cannot
> name the option that was rejected, it is probably knowledge.

Re-running r-18 against the sharpened document: `10-knowledge/`, with the model
citing that exact test in its reasoning.

## Standing caveats

- **This is statistical and varies by model.** It cannot be asserted the way a
  unit test can, so it runs on demand and on release rather than per commit.
- **Twenty-two fixtures at a 90% bar means two failures is the boundary.** Treat
  a marginal pass as marginal, and grow the set as real captures accumulate.
- **A fixture disagreeing with the model is not automatically the model being
  wrong.** Read the reasoning before changing anything — twice now the useful
  finding was in the fixture or the prose.

## 2026-09-18 — second run, both arms, 22 fixtures each

Run against the sharpened structure document, so both arms see the same
convention. The question is FR-30's: **do the tool descriptions carry the
contract without a skill?**

```
no skill loaded       21/22 = 95%   1 misfiled   2/2 refused
with brain-capture    22/22 = 100%  0 misfiled   2/2 refused
gap                   +5 points
```

**FR-30 holds.** A five-point gap means the skill helps at the margin rather
than doing the work. If it were twenty, the descriptions would be under-carrying
and the skill would be hiding it.

All three traps avoided in both arms. r-18 passed in both, so the prose fix from
the first run held in a fresh baseline rather than being a one-off.

### The one no-skill miss, and what it exposed

**r-07** — *"The platform team reviews asynchronously and wants infra changes
raised as a decision record before the PR"* — went to `05-memory/` where the
fixture expects `30-people/`.

This is a boundary that did not exist until `05-memory/` was added. Both folders
plausibly hold "a rule to apply", and the document never said which wins. Both
sections now state the line:

> This folder holds how *we* work — rules that apply wherever the work happens.
> How a *named* person or team works goes to `30-people/`, where it stays
> attached to them. "Raise infra changes as a decision record" is memory; "the
> platform team wants infra changes raised as a decision record" is about that
> team, and filing it here loses the one thing that makes it actionable — who it
> is about.

Twice now, adding a folder to a preset has created an ambiguity with an existing
one that only a fixture run surfaced. Worth running the set after any change to
a preset, not only before a release.

## Scoring a run

```bash
pnpm fixtures:score fixtures/last-run.json
```

The scorer reads `fixtures/routing.json`, applies `alsoAcceptable`, treats the
inbox as success, and exits non-zero if either bar is missed. It accepts a
single run or a two-arm comparison.
