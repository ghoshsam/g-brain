# g-brain — how this project files things

This project carries its own filing convention. It governs everything inside
`20-projects/g-brain/`; the brain's root `content-structure.md` still decides
what belongs in `20-projects/` at all.

A project only needs one of these when flat files stop being enough. Delete it
and the root convention takes over again — nothing breaks, and nothing moves.

---

## memory/

Rules an agent working on **this project** should apply without being told.

**Belongs here:** the commands that actually work here, conventions this
codebase insists on, corrections a human has given about this project that
should stick.

**Does not belong here:** anything true regardless of what you are working on —
that is the brain's `05-memory/`. "Never commit unless asked" is global; "run
`pnpm verify` before calling anything done" is this project's.

Keep them short. They are read at the start of a session, so every line costs.

---

## decisions/

Choices that only matter inside this project.

**Does not belong here:** a decision anyone outside this project would want to
find. Those go to `40-decisions/{yyyy}/` in the brain root, where they outlive
the project folder.

---

## research/

Findings gathered for this project — comparisons, spikes, measurements.

**Does not belong here:** anything still true once the project ends. Promote it
to `10-knowledge/` and link to it from here. That single habit is what stops a
finished project folder from becoming the place good work goes to be forgotten.

---

Status, open questions and the project README sit directly in the project
folder, not in a subfolder.
