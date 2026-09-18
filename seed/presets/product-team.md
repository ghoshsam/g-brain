# Content Structure

You are reading the filing convention for this product team's brain. Everything
written here is shared — other agents and humans will read it months from now,
without you around to explain it. Read this file before writing anything.

**How to choose a location**

1. Ask what the content *is*, not what you were doing when you produced it.
   A decision made during an incident is a decision, not an incident log.
2. Ask how long it stays true. Durable → `10-knowledge/`. Tied to one feature →
   `20-projects/`. True only for today → `60-sessions/`.
3. Read the folder section below and check the "belongs here / does not belong
   here" lines. They are the actual test.
4. If two folders both fit, pick the one where someone would *look for it*.
5. If nothing fits, write to `00-inbox/` with `needs-filing: true` and a
   one-line reason. That is a correct answer, not a failure.

**Search before you create.** Updating an existing document beats adding a
near-duplicate almost every time.

---

## File naming and frontmatter

Lowercase kebab-case `.md`. One idea per file. Frontmatter:

```yaml
---
title: Checkout fails on expired card
type: incident
tags: [billing, checkout]
created: 2026-09-18
updated: 2026-09-18
---
```

Optional: `status` (`draft` | `active` | `superseded`), `project`, `source`,
`supersedes` / `superseded-by`, `needs-filing`, `expires`, `severity`
(incidents), `spec-id` (specs).

`type` is one of: `concept`, `how-to`, `reference`, `decision`, `spec`,
`incident`, `playbook`, `note`, `status`, `meeting`, `profile`, `session`.

---

## 00-inbox/

Captures that do not clearly belong anywhere else yet. Set `needs-filing: true`
and say why in one line. An escape hatch, not a default — nothing lives here long.

---

## 05-memory/

How we work. The things an agent should apply without being told.

**Belongs here:** conventions and preferences, standing constraints, corrections
a human has given that should stick, the commands and tools that actually work
here.

**Does not belong here:** how a system works (`10-knowledge/`), a choice and its
reasoning (`40-decisions/`), a procedure (`50-playbooks/`).

The test: *would an agent starting cold need to apply this without being asked?*

Keep these files short — this folder is read at the start of sessions.

Example: `05-memory/local-setup.md`

---

## 10-knowledge/{topic}/

Durable reference that outlives any single feature — how a service works, what
a term means, how the domain behaves.

**Does not belong here:** feature-scoped work (`20-projects/`), the record of a
choice (`40-decisions/`), a requirements document (`15-specs/`), or an
operational procedure (`50-playbooks/`).

The test: *if this feature were cancelled tomorrow, would this still be worth
keeping?*

Example: `10-knowledge/billing/dunning-retry-behaviour.md`

---

## 15-specs/{feature}/

Requirements and designs — what we are building and why, before and while it is
built.

**Belongs here:** problem statements, functional requirements, acceptance
criteria, API contracts, UX notes, open questions on scope.

**Does not belong here:** implementation notes and progress (`20-projects/`),
or how the shipped thing works once it is live — promote that to
`10-knowledge/` when it ships, and link back to the spec.

Keep the spec current while the feature is in flight; mark it
`status: superseded` rather than editing it after ship.

Example: `15-specs/usage-based-billing/requirements.md`

---

## 20-projects/{project}/

Everything scoped to one active piece of work: status, working notes, meeting
records, open questions.

**Does not belong here:** knowledge that survives the project — write it to
`10-knowledge/` and link from here. That habit is what stops the brain becoming
a graveyard of dead project folders.

`{project}` is kebab-case and stable. **A project is a piece of work, not a
repository** — one often spans several repos, and some have none. Reuse an
existing project folder before inventing one; check the tree first. Record the
repos it spans in the project's `README.md`.

When the work finishes, the folder moves to `90-archive/projects/{project}/`.

---

## 30-people/

Roles, ownership, team shapes, areas of expertise, stated working preferences.

**Does not belong here:** anything personal, sensitive, or evaluative. No
contact details, no performance opinions. If you are unsure, leave it out.

---

## 40-decisions/{yyyy}/

Choices and their reasoning, ADR-style: context, options considered, decision,
consequences. Includes things deliberately *not* done.

**Accepted decisions are not rewritten.** Supersede them with a new file, set
`supersedes:` / `superseded-by:`, and leave the old text intact.

Example: `40-decisions/2026/move-billing-off-stripe-invoices.md`

---

## 45-incidents/{yyyy}/

What broke, what we did, what we changed.

**Belongs here:** timeline, impact, root cause, remediation, follow-up actions.
One file per incident, named for the symptom users saw, not the internal cause.

**Does not belong here:** the permanent explanation of the system that failed —
that belongs in `10-knowledge/`, updated as a result of the incident. The
incident record is history; the knowledge doc is the current truth. Write both.

Every incident should leave at least one link: to the knowledge doc it
corrected, the decision it prompted, or the playbook it created.

Example: `45-incidents/2026/checkout-timeouts-during-renewal-run.md`

---

## 50-playbooks/

Repeatable procedures, executed step by step: numbered steps, exact commands,
preconditions, definition of done. Explanation of *why* goes in
`10-knowledge/` — link to it, do not inline it.

Example: `50-playbooks/roll-back-a-deploy.md`

---

## 60-sessions/{yyyy}/{mm}/

Agent session logs and working scratch. Assume deletion after 90 days.

**This folder is a trap.** The failure mode of every team brain is that agents
log sessions and never promote what they learned. Before closing a session, ask
what will still be true next month and write *that* to `10-knowledge/`,
`40-decisions/`, or the spec — then link to it from the log.

---

## 90-archive/

Finished or superseded content, kept for history. Mirror the original path:
`20-projects/foo/` → `90-archive/projects/foo/`. Archive rather than delete;
nothing is ever lost.

---

## Conventions

- **Link generously.** `[[10-knowledge/billing/dunning-retry-behaviour.md]]`,
  relative to the brain root. Backlinks are computed for you. An unlinked
  document is nearly invisible.
- **Write for someone who was not there.** No "as discussed", no unexplained
  pronouns.
- **Lead with the answer.** First paragraph says the thing.
- **Record the reasoning, not just the outcome.**
- **Prefer editing to adding.** Search first.
- **Never write secrets, credentials, customer data, or personal details.**
  Writes containing them are rejected, and the brain is shared. Customer
  specifics in incidents are anonymised — "a customer on the enterprise plan",
  not a name.
- **Say when you are unsure.** Mark uncertain content rather than stating it
  confidently.
