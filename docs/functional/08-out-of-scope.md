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

**Reconsider when** someone wants to offer g-brain as a hosted service.

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
per-user views.

**Why out.** Folder scopes cover the real need (a read-only research agent, a
write-capable capture agent), and finer control implies an identity system.

**Reconsider when** a brain needs to hold content some readers must not see —
at which point the better answer is usually a second brain.

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
