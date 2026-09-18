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
