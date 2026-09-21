# Decisions log

Running record of choices made during the build. Entries graduate into ADRs
under `docs/technical/12-adr/` once settled; this file is the scratch ahead of
that.

---

## 2026-09-18 — Structure document is prose, not schema

Original design had `content-structure.md` carry a YAML frontmatter block that
the server parsed and enforced. Changed to plain prose that an LLM reads.

**Why:** the routing intelligence belongs in the model, not a rules engine. A
schema means restructuring the brain is a migration; prose means it is an edit.

→ ADR-0001.

---

## 2026-09-18 — The default brain folder is `brain`, outside the source repo

`BRAIN_ROOT` defaults to a folder named `brain` in the user's home directory —
`~/brain` (`%USERPROFILE%\brain` on Windows). `gbrain init` with no path argument
creates it there.

**Why home and not the working directory:** if the default ever resolved inside
this source repo, `GIT_AUTOCOMMIT` would commit an agent's captures into the
working tree of g-brain itself. That is the one default that must not be
possible, so the default is anchored to `$HOME` rather than to `cwd`, which
varies. `gbrain init <dir>` overrides it, and `BRAIN_ROOT` in the environment
overrides both.

`seed/brain/` inside this repo is example content copied *out* by `gbrain init`.
It is never a brain root.

---

## 2026-09-18 — One installation, many projects

**Settled by the repo owner:** *"one installation can have many project"*.

One `BRAIN_ROOT` serves a whole team across every repository they work in, and
`20-projects/{project}/` holds many projects. `{project}` is a stable name chosen
once; the repos it spans are recorded as metadata, never used to derive the path.

**Why not a brain per repo:** it recreates the per-repo rules-file problem the
product exists to solve, and fragments the durable knowledge that is most
valuable precisely because it crosses repo boundaries.

**Why not project = repo:** a project spans several repos or none, and it ends
while the repo keeps running. Archiving is the decisive case. Deriving the path
from `git remote` would also be a routing rule, which ADR-0001 rejects.

→ ADR-0005.

---

## 2026-09-18 — Drop-in for any agentic tool

**Raised by the repo owner:** *"this should be use as 2nd brain of any agentic
tool, like context7"*.

That is a positioning decision with three design consequences, all of which the
design was failing: a setup step before the first call, behaviour that lived in
skills rather than tool descriptions, and capabilities reachable only through
MCP resources and prompts that many clients do not implement.

Fixed by: auto-creating `BRAIN_ROOT` from the `default` preset on first run
(FR-28), requiring every capability to be reachable through tools (FR-29), and
requiring the tool descriptions to carry *when* to use the brain as well as how,
so capture happens with no skill loaded (FR-30).

The cost is that most brains will run on an untailored `default.md`, which raises
the stakes on the preset and makes the routing fixture set the measurement that
matters most.

→ ADR-0006.

---

## 2026-09-18 — A memory folder in the default presets

**Raised by the repo owner:** defaults should cover what an AI tool actually
stores — a memory store and a session store.

`60-sessions/` was already the session store. There was no home for the other
kind: rules an agent should apply without being told. Added `05-memory/` to all
three presets, and `memory` to the type list.

**The split:** `05-memory/` holds rules an agent *applies*; `10-knowledge/` holds
explanations an agent *looks up*. "Use pnpm, never npm" is memory. "How package
resolution works here" is knowledge.

**Why it belongs in the defaults:** this is exactly what agentic tools accumulate
today and scatter into per-repo rules files — the problem the overview opens by
naming. Numbered `05` so it sorts before knowledge, because it is read at the
start of a session. Files are kept deliberately short for the same reason.

The highest-value thing in it: a correction a human gives an agent, written down
so it holds next time.

---

## 2026-09-18 — Multi-writer safety

**Raised by the repo owner:** if several personas write and one updates wrongly,
how do we stop that breaking other work?

Two different failures were being conflated. **Mechanical** collision is solved
by etags, locks, append, and atomic writes. **Semantic** wrongness — a
confidently wrong capture, a bad merge — is not prevented, and preventing it
would mean validating content, which ADR-0002 rejects.

What actually protects other people's work is that **blast radius is one
document**: path is identity, there are no cross-document transactions, and both
things that could couple documents — backlinks and the search index — are
derived and rebuild.

The gap was the curator, the one persona with wide reach. Closed by narrow
per-persona keys (FR-31) and curation as a reviewable plan landing in one
labelled commit (FR-32).

→ ADR-0007.

---

## 2026-09-18 — No `packages/contracts`. Types live in `core`

**Settled at phase 2**, as the phase file proposed.

Shared Zod schemas and types live in `packages/core/src/types.ts`. A separate
`contracts` package would have had one real consumer, since `core` is the only
implementation and both apps are thin callers.

Splitting it out later is cheap; maintaining a package nobody imports twice is
not.

---

## 2026-09-18 — Key management deferred until a transport needs it

**Raised by the repo owner:** *"why core auth as i said keep it simple"*.

Correct. `core/auth` was 209 lines, of which about 16 — `authorise()` — were
doing any work. The rest was `.brain/agents.json`, sha256 hashing, timing-safe
comparison, a cache, and key generation, and **nothing called it**: stdio is a
child process the client already controls, so it is trusted as local, and the
HTTP transport does not exist yet.

Kept: `authorise()`, the per-folder scope check `ops` runs on every operation.
It is what makes the read-only recall agent of ADR-0007 actually preventive, it
costs nothing, and removing it would lose a real guarantee.

Cut: everything else, until the streamable HTTP transport lands and there is a
caller presenting a key. FR-18 and FR-31 are deferred with it, not abandoned.

The general rule this is an instance of: a mechanism with no caller is not
"ready", it is a liability — untested against real use, and it has to be
maintained meanwhile.

---

## 2026-09-18 — The index ranks candidates; the filesystem decides they exist

Found at phase 7, when the near-duplicate guard let two identical documents into
the same folder.

`candidatePaths` asked `search.similar()` first and **only listed the folder if
the index came back empty**. A stale index that returned some other hit therefore
hid the very document worth comparing against. Now both sources are always
unioned.

The rule it broke is one already written down: the index holds no authority. It
is allowed to be stale, so nothing may treat a non-empty answer from it as
proof. Worth remembering wherever else a derived source gets consulted.

A second bug in the same guard: the incoming document was compared **with** its
frontmatter against a stored one **without**, which for short documents dragged
the score well below the threshold.

---

## 2026-09-18 — The fixture set found a gap in the prose, not in the code

First run of the routing fixtures: **21/22 correct, 95%**, all three deliberate
traps avoided, both unsafe captures refused.

The single miss was r-18 — "the pool is sized at 20 **because** pgbouncer fronts
it" — filed to `40-decisions/` where the fixture expected `10-knowledge/`. On
review the model had a case: the sentence reads as a choice.

**The structure document was ambiguous, and that is what got fixed.** No code
changed. `40-decisions/` now carries a test: a decision records a moment of
choosing, and if you cannot name the rejected option it is probably knowledge.
Re-running that fixture gives `10-knowledge/`, with the model citing the new
test.

This is the loop ADR-0001 promised working in practice: a routing failure is
repaired by editing prose. Worth keeping in mind that twice now the useful
finding has been in the fixture or the document rather than in the model.

---

## 2026-09-18 — Key management came back with the transport that needed it

The HTTP transport gave key management its first real caller, so it returned —
about 100 lines: `.brain/agents.json` with sha256 hashes, timing-safe
comparison, and `generateKey`. The plaintext key is returned once and never
stored.

Narrow profiles are the default, not an option (FR-31):

| Profile | Scope |
|---|---|
| `capture` | Reads everywhere so it can search before creating a duplicate; writes only the capture folders |
| `recall` | **Read-only, everywhere** |
| `curator` | Everything, and the only profile that may write `90-archive/` |

Verified end to end over real HTTP: the recall key reads what the capture key
wrote and gets `FORBIDDEN` when it tries to write. That is the one preventive
control in ADR-0007, and it now exists rather than being described.

The deferral was worth it. Written at phase 3 it would have been guesswork about
a transport that did not exist; written now it is shaped by one.

---

## 2026-09-19 — A project is a folder, and that folder is the access boundary

**Raised by the repo owner:** project-level access inside one brain. That is the
reconsider trigger both ADR-0005 and the out-of-scope document already named —
one brain has always been one access boundary.

The obvious implementation is to scope on the `project:` frontmatter field,
since that is already what groups content across folders. It is an authorisation
bypass. Frontmatter is linted, never enforced (ADR-0002), so an agent can write
`project: finance` into a document body and grant itself access, or mislabel a
document to hide it from a reader. It also inverts the write path, since
authorisation would have to parse agent-supplied content before deciding whether
the agent may write it.

**Authorisation may depend only on inputs the caller cannot author.** The path is
such an input; the document body is not.

So a project *is* the folder `20-projects/{project}/`, tools take a `project`
code that resolves to it, and authorisation is the per-folder
`Scope { folder, read, write }` that `core/auth` already applies to every
operation. **Zero new authorisation code**, which is the point rather than a
side effect: the mechanism protecting projects is the one already covered by
tests.

**An enforced manifest in `.brain/` was designed first, and then rejected.** It
mapped path globs to projects, was unwritable through any operation, and it was
safe — it was the original recommendation. Dropped as unnecessary complexity: a
second source of truth about where content lives, a maintenance surface, and a
decision about what happens to documents nothing has mapped yet, all to express
a grouping **the filesystem already expresses**. If the answer is a folder, use
the folder.

The cost lands as a filing rule, not a code rule. `10-knowledge/` and
`40-decisions/` stay team-wide, so content that must not cross a project
boundary lives in the project folder — and promoting a finding out of a project,
the habit the content model pushes hardest, now also widens who can read it.
That belongs in `content-structure.md` as prose, which is ADR-0001 working as
intended.

→ ADR-0008.

---

## 2026-09-19 — A read-only web UI, and no identity system

A team wants to see what is in a brain without running an MCP client. Reading it
as a git repo works and stays supported, but it shows the whole repository or
nothing — there is no view that opens at "the projects I can see" and lets
someone walk one of them.

What ships is a read-only surface: list projects, select one, browse its real
folder tree, read a document. **It never writes** — no create, edit, delete or
move — so the non-goals about a wiki and about realtime collaboration both stay
true as written. It is a third thin surface over `core` alongside `apps/mcp` and
`apps/cli`, so the existing architecture tests apply to it unchanged.

**It introduces no notion of a user.** It is a caller like any other, carrying
whatever the existing model already gives it: the local actor where
`AUTH_REQUIRED` is false, or a bearer key on HTTP. The `recall` profile from
ADR-0007 is exactly the right shape for a browser — read everywhere, write
nowhere. The project list is directories under `20-projects/` filtered by the
caller's read scopes, and a project the caller cannot read is **absent, not
greyed out**, because naming a folder somebody may not see leaks the shape of
the brain.

**OIDC identity was considered and deferred on size, not on merit.** It is the
right answer once more than a handful of people need different project access,
and it is what would make the audit log name a person. It is also a new
subsystem — provider configuration, sessions, token refresh, a login surface,
and one more thing that can be down between a team and their notes — in service
of a browser for markdown files. The seam is the `Actor` that `core/auth`
already evaluates, so adding it later changes only how an `Actor` is resolved,
not the UI, the tools, or the authorisation model.

**The accepted cost is that access is per key, not per person.** Two people
sharing a key are indistinguishable, revoking one person's access means rotating
a key others may hold, and giving one person one project means issuing and
distributing a scoped key by hand. Workable for a handful of people, and it does
not stay workable.

→ ADR-0009.

---

## 2026-09-19 — Memory splits by reach, and a project may carry its own convention

Two changes to the content model, made together because they are the same idea
applied twice: a rule or a convention belongs where the thing it describes lives.

**`05-memory/` now holds only what is true everywhere** — what an agent should
apply whatever it is working on. A rule true of one project moves to
`20-projects/{project}/memory/`. The project folder is already the access
boundary (ADR-0008), so a scope granted on a project now covers the rules for
working on it, instead of needing a second scope on a slice of `05-memory/` that
scopes cannot express. It also means the rules leave with the project when the
folder is archived, rather than outliving the work they described. The rule of
thumb is written into the preset: if you are about to name a memory file after a
project, it belongs in that project.

**A project may put a `content-structure.md` in its own folder**, and where it
does, that document is the authority for everything inside that project. The
root document still decides what belongs in `20-projects/` at all — the
project's is additive, never a replacement. It is optional, and a project
without one behaves exactly as before: flat files, root convention governs.
`brain_structure` takes an optional project argument returning that project's
document and its subtree; `FORBIDDEN` if the caller cannot read the project,
checked before existence so an out-of-scope project cannot be told apart from a
missing one, and `NOT_FOUND` otherwise.

**Why the root document could not do this:** it describes the brain's folders,
and `20-projects/{project}/` is as deep as it can usefully go. It cannot say
what a particular project's subfolders mean without naming every project in a
document every agent reads on every routing decision. The practical
consequence before this change was that **every subfolder of every project was
drift** — the root document declared the project folder and nothing below it, so
`memory/`, `decisions/` and `research/` all filed as undeclared. Drift only
reports, so nothing was lost, but a drift signal that fires on correct filing is
a signal people learn to ignore. Drift is now measured against whichever
convention governs the folder, and a document sitting directly in the project
folder is never drift.

**The cost, stated plainly.** There are now two places to look for a rule, and
"is this global or is it this project's?" is a judgement an agent has to make
every time it writes one — it will sometimes get it wrong, and a rule filed in
the wrong half is a rule that does not get applied. Filing anywhere inside a
project now means reading two documents instead of one, which is one more call
and more tokens before the first write. Both are accepted because the
alternative — one flat memory folder and one convention for every project — was
already producing false drift on correct filing, and does not survive a brain
with more than a handful of projects.

Nothing enforces any of this. Both changes are prose in `content-structure.md`
and a choice of which document to read, which is ADR-0001 working as intended.

---

## Open, to settle during the build

- **`60-sessions/` expiry** — archive or delete. Leaning archive; deletion is
  the kind of irreversibility this project otherwise avoids everywhere.
- **Push cadence to `origin`** — manual by default. An interval push is a
  one-line config, but silently pushing an agent's writes to a shared remote is
  a surprise worth not having by default.
- **`doctor` drift check** — heuristic (compare paths against `## folder/`
  headings) or LLM-assisted (ask a model whether each document matches the
  described purpose). Start heuristic; the LLM version is a better product but
  needs a model call per document, and the heuristic catches the common case of
  a folder nobody declared.
- **Near-duplicate threshold** — 0.9 trigram similarity is a guess. Tune against
  real captures once the fixture set exists; too aggressive blocks legitimate
  writes, which is the failure mode that matters most.
