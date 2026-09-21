---
title: Out of scope for v1
description: What g-brain deliberately does not do, and what would have to change for each.
---

# Out of scope for v1

Each item says what it is, why it is out, and what would trigger reconsidering.
Scope discipline is what makes v1 shippable; this is the record of the trades.

---

## Semantic / vector search

**Why out.** Most retrieval in an agentic brain is structured — folder, tag,
type, links — and BM25 covers the rest at small corpus sizes. Embeddings add an
index that can go stale, a model to ship, and indexing latency, for recall gains
that only appear at scale.

**Designed for.** `packages/search` is built against `Retriever` and `Embedder`
interfaces. Enabling hybrid means adding a local ONNX embedder (bge-small,
384-dim) and setting `SEARCH_MODE=hybrid` — no caller changes, still no
database.

**Reconsider when** the brain passes ~300–500 documents, or when recall
failures show agents searching with different vocabulary than the author used.
See [search design](../technical/06-search-design.md).

---

## Multi-tenant brains

**Why out.** One process serves one `BRAIN_ROOT`. Multi-tenancy means tenant
routing, per-tenant keys and indexes, and isolation guarantees — a different
product shape.

**Today.** Run one instance per brain. They are cheap: a process, a folder, a
git repo.

**Unchanged by the web UI.** The read-only UI
([ADR-0009](../technical/12-adr/0009-read-only-web-ui.md)) is a third surface
over one brain, run by the team that owns that brain. It serves one
`BRAIN_ROOT` like every other surface, and nothing about it is hosted for
anyone else.

**Reconsider when** someone wants to offer g-brain as a hosted service to teams
that do not run it themselves.

---

## Realtime collaboration

**Why out.** Optimistic concurrency plus append handles the actual contention
pattern — agents writing different documents, occasionally the same one. CRDTs
or operational transforms would be enormous complexity for a case that does not
arise.

**Reconsider when** two writers are routinely contending for the same document
and losing the race matters — which would first require an editing surface that
holds a document open, and there is none.

---

## Attachments and binary assets

**Why out.** Images, PDFs, and recordings are not markdown; they bloat the git
repo, cannot be searched by the text index, and do not fit "the file is the
document".

**Today.** Link to assets stored elsewhere. `source:` in frontmatter carries the
reference.

**Reconsider when** transcripts and diagrams become a routine capture type. The
likely answer is git-lfs or an external store with links, not blobs in the repo.

---

## Automatic content generation

No summarising documents, no auto-generating index pages, no rewriting captures
into house style.

**Why out.** Every one of those writes content nobody verified, and a brain's
value depends entirely on trusting what it contains. Generated content is
indistinguishable from written content once it is on disk.

**Reconsider** never, in this form. Agents may generate content — but as an
explicit capture the agent stands behind, not as a background process.

---

## Access control below folder level

Scopes are per folder. No per-document ACLs, no field-level redaction, no
per-person views.

**Why out.** Folder scopes cover the real need (a read-only research agent, a
write-capable capture agent), and finer control implies an identity system.

**The trigger fired, and the answer stayed at folder level.** A team needed
project-level access inside one brain — the case this section said would be
answered with a second brain. It arrived without going below folder level,
because a project *is* the folder `20-projects/{project}/`, so scoping a project
is scoping a folder and there is no new authorisation code
([ADR-0008](../technical/12-adr/0008-project-scope-is-the-project-folder.md)).
The `project:` frontmatter field still groups content for search, and is never
an input to an authorisation decision — frontmatter is linted, not enforced, so
an agent could write its own way in. What that buys is paid for in prose:
`10-knowledge/` and `40-decisions/` stay team-wide, so content that must not
cross a project boundary has to be filed in the project folder. A filing rule,
not a code rule.

**What is still out.** Access is per key, not per person. Two people sharing a
key are one caller, revoking one person means rotating a key others hold, and
the audit log names a key where a team will want a name. A view can differ
between callers — the web UI lists only the projects a caller's read scopes
cover — but that is a scope difference, never a person difference.
[ADR-0009](../technical/12-adr/0009-read-only-web-ui.md) records this as an
accepted cost rather than solving it.

**Reconsider when** more than a handful of people need different project access,
or the audit log has to name a person. That is user identity beside the agent
keys, and the seam for it is the `Actor` that `core/auth` already evaluates —
not per-document ACLs, which stay out.

---

## System-of-record use

g-brain is not the authoritative store for anything with legal, financial, or
compliance weight. It holds what a team knows, not what a team must prove.

**Why out.** It permits undeclared folders, lints rather than enforces
frontmatter, and lets agents write freely. Those are the right trades for a
knowledge store and the wrong ones for a record system.

**No reconsideration path.** If it needs to be provable, it belongs in a system
built for that. Link to it from here.

---

## Regulated data of any kind

No personal data, health data, financial records, or customer PII. The secret
and PII guard rejects the obvious cases at write time, but the real control is
this boundary: if GDPR, DPDP, or SOC 2 obligations attach to the content, it
does not go in the brain. Anonymise before capturing — "a customer on the
enterprise plan", not a name.

---

## Related

- [Overview: non-goals](./01-overview.md#non-goals)
- [Security](../technical/08-security.md)
