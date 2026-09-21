---
title: Structure
description: Serves content-structure.md exactly as written, reports the folder tree as it actually is, and notes where the two differ.
---

# core/structure

## What is core/structure

`core/structure` answers the question an agent asks at the start of a session:
what does this brain look like, and where does content go? It returns the raw
bytes of `content-structure.md` and a folder tree built from the filesystem, and
it is the only module that compares the two. It exists as a separate component
because the comparison is delicate: the prose is authoritative for routing and
nothing parses it, while the tree is authoritative for what exists and nothing
overrides it ([ADR-0001](../12-adr/0001-structure-doc-is-prose-not-schema.md)).

There may be more than one such document. A project under the projects folder can
carry its own `content-structure.md`, and where it does, that is the convention
governing everything inside that project — this module decides which document
applies and then treats it exactly as it treats the root one.

## Responsibilities

- Read `content-structure.md` at the brain root and return its bytes verbatim.
- Read a named project's own `content-structure.md` instead when one is asked
  for, with a tree rooted at that project folder.
- Walk the filesystem to build the folder tree with per-folder document counts.
- Include folders the structure document never mentions, because the tree is the
  fact and the document is the intention.
- Return `structureMissing: true` alongside a tree when there is no structure
  document, so a brain mid-setup is still usable.
- Serve the tree on its own for callers that want cheap orientation without the
  document.
- Heuristically extract `## <folder>/` headings from the document to decide
  which folders are described.
- Mark each `FolderNode` `undeclared` when no extracted heading covers it.
- Compute a `DriftRecord` for a path after a write has already succeeded, and
  return `null` when there is nothing to report.
- Resolve which convention governs a folder before measuring drift against it:
  the project's own document where the project has one, the root document
  otherwise.

## Not its job

- Parsing either document for meaning. There is no schema, no folder whitelist,
  and no rules engine — the routing decision belongs to the model reading the
  prose. A project's own document is read with exactly the same shallow
  extraction as the root one and gains no powers from being nearer the content
  ([ADR-0001](../12-adr/0001-structure-doc-is-prose-not-schema.md)).
- Deciding who may see a project. The project folder is the access boundary and
  `core/auth` evaluates it, the same as any other folder
  ([ADR-0008](../12-adr/0008-project-scope-is-the-project-folder.md)).
- Rejecting anything, ever. Drift is reported after the fact; the write already
  succeeded ([ADR-0002](../12-adr/0002-safety-only-write-guards.md)).
- Creating folders or moving documents. Curation is a human or curator-agent
  action that lands as a reviewable commit.
- Writing the structure document. That goes through `core/ops` and `core/store`
  like any other document.
- Caching the tree across calls. Freshness matters more than the walk costs.

## Sequence diagram

```mermaid
sequenceDiagram
    participant Agent as agent
    participant MCP as apps/mcp
    participant Ops as core/ops
    participant Str as core/structure
    participant Auth as core/auth
    participant FS as filesystem

    Agent->>MCP: brain_structure at session start, optionally naming a project
    MCP->>Ops: getStructure ctx, options
    Ops->>Str: getStructure ctx, options
    alt a project was named
        Str->>Auth: may this actor read the project folder
        Auth-->>Str: allowed, or FORBIDDEN
        Note over Str,Auth: asked before the folder is looked for, so an out-of-scope<br/>project and a missing one cannot be told apart
        Str->>FS: is there such a project folder
        FS-->>Str: yes, or NOT_FOUND
        Str->>FS: read the project's content-structure.md
    else no project named
        Str->>FS: read content-structure.md at the brain root
    end
    alt document present
        FS-->>Str: raw bytes
        Str->>Str: keep bytes verbatim, extract the folder headings
    else no structure document
        FS-->>Str: not found
        Str->>Str: set structureMissing true, markdown empty
    end
    Str->>FS: walk the folders below whichever root was asked for, count .md files per folder
    FS-->>Str: folders with counts
    Str-->>Ops: StructureResult, each node flagged undeclared or not
    Ops-->>MCP: ok StructureResult
    MCP-->>Agent: the prose plus the live tree
```

## Technical features

- `markdown` is the file's raw bytes, decoded as UTF-8 and otherwise untouched —
  no frontmatter split, no reformatting, no trimming, no heading rewrite. What
  the author wrote is what the model reads.
- The tree comes from a `readdir` walk of `BRAIN_ROOT`, never from the document.
  `docCount` is the number of `.md` files directly in that folder, and
  `children` nest to the full depth of the tree.
- `.git/` and `.brain/` are excluded from the walk. Everything else is included,
  whether or not any heading covers it.
- A brain with no `content-structure.md` returns `ok` with
  `structureMissing: true`, an empty `markdown`, and a populated tree. Half a
  brain is still a usable brain, and this is what makes `gbrain init` safe to
  interrupt.
- `brainName` is the basename of the resolved `BRAIN_ROOT`, or the project code
  when a project was asked for.
- `getStructure` with a `project` returns that project's own
  `content-structure.md` and a tree rooted at the project folder. **The project's
  document is additive, never a replacement** — the root document still decides
  what belongs in the projects folder at all; the project's decides only how its
  own internals are arranged. A project with no document of its own returns
  `structureMissing: true` with its tree, the same shape a brain mid-setup
  returns, and that is the ordinary case rather than a defect.
- A project is authorised before it is looked for. `core/auth` is asked whether
  the actor may read the project folder, and only then is the folder's existence
  tested — so a project out of scope returns `FORBIDDEN` whether or not it
  exists, and cannot be told apart from one that was never created. Reversing the
  two would turn `NOT_FOUND` into a probe for project names, which is the same
  leak the pruned tree exists to prevent.
- Drift is measured against whichever convention governs the folder written to:
  the project's own document where that project has one, the root document
  otherwise. A document written directly into the project folder is never drift,
  because there is no subfolder for the project to have declared.
- Drift detection extracts headings matching `## <folder>/` at the start of a
  line. Placeholder segments — `{topic}`, `{yyyy}`, `{mm}`, `{project}` — match
  exactly **one** path segment and never span a `/`, so `10-knowledge/{topic}/`
  covers `10-knowledge/auth/` but not `10-knowledge/auth/oidc/`.
- `DriftRecord.reason` is one of two values: `undeclared-folder` for a write
  under no described folder, and `root-level-document` for a `.md` file written
  at the brain root that is not the structure document itself.
- `checkDrift` is called at step 9 of the write path, after the atomic rename has
  already succeeded. Its return value is recorded on the audit line and attached
  to `WriteOutput.drift`; it cannot fail the write and has no path to doing so.
- **Neither document is parsed for meaning, and the project one is no exception.**
  The extraction is the same `## <folder>/` heading scan in both cases, the same
  placeholder rules apply, and what it produces is still only a flag on a tree
  node and a line in a drift report. Putting a convention nearer the content it
  describes changes which document is read, not what reading it is allowed to do
  ([ADR-0001](../12-adr/0001-structure-doc-is-prose-not-schema.md)).
- **The heuristic is permitted here precisely because it only reports.** A wrong
  heuristic in a drift report is a spurious line somebody reads and dismisses. A
  wrong heuristic inside a validator loses a capture, permanently and silently.
  That asymmetry is the whole reason routing lives in the model and this
  extraction never gates anything.
- The heuristic misses what it is not shaped for: a folder described at `###`
  depth, one named only in a sentence of prose, or one whose heading omits the
  trailing `/`. Each produces a false drift line, which is cheap. There is no
  case in which it produces a rejection, which would not be.
- The folder walk is O(folders + documents) per call and there is no cache. On a
  brain with thousands of documents `brain_structure` is a full directory
  traversal, which is the cost paid for a tree that is never stale.
- Presets are ordinary markdown files in `seed/presets/`, discovered by
  filename. Adding a preset is adding a file, with no code change here or
  anywhere else.
- `getTree` exists so an agent can orient without pulling the document into its
  context on every call — the prose is tokens in every routing decision, which
  is why the writing guide caps it at roughly 400 lines.
- Honest limit: nothing measures whether the document routes *well*. Accuracy is
  a statistical property of the model reading it, tuned against a fixture set,
  and a badly written document degrades filing invisibly until somebody cannot
  find something.

## Interface

```ts
export interface StructureResult {
  brainName: string
  /** Raw bytes of content-structure.md, verbatim. */
  markdown: string
  structureMissing: boolean
  tree: FolderNode[]
}

export interface FolderNode {
  path: string
  docCount: number
  children: FolderNode[]
  /** True when no '## <folder>/' heading in the structure document covers it. */
  undeclared: boolean
}

export interface DriftRecord {
  path: DocPath
  reason: 'undeclared-folder' | 'root-level-document'
}

/**
 * With `project`, returns that project's own content-structure.md and a tree
 * rooted at its folder. FORBIDDEN when the actor cannot read the project —
 * tested before existence — and NOT_FOUND when there is no such project.
 */
export function getStructure(
  ctx: BrainContext,
  options?: { project?: string },
): Promise<Result<StructureResult>>

export function getTree(ctx: BrainContext): Promise<Result<FolderNode[]>>

/**
 * Called AFTER a write has succeeded. Never gates one. Measured against the
 * convention governing the folder: the project's own document where it has one,
 * the root document otherwise.
 */
export function checkDrift(
  ctx: BrainContext,
  path: DocPath,
): Promise<DriftRecord | null>
```

## Related

- [Structure document guide](../03-structure-doc-guide.md) — how to write one that routes well, and the anti-patterns
- [ADR-0001 — The structure document is prose, not schema](../12-adr/0001-structure-doc-is-prose-not-schema.md) — why nothing parses it
- [ADR-0002 — Safety-only write guards](../12-adr/0002-safety-only-write-guards.md) — why drift is reported and never enforced
- [ADR-0008 — Project scope is the project folder](../12-adr/0008-project-scope-is-the-project-folder.md) — the access boundary that makes authorising a project an ordinary folder check
- [Architecture](../01-architecture.md) — drift as step 9, after the write has succeeded
- [Component specifications](../11-components/README.md) — the contract this file expands
- [FR-01](../../functional/06-functional-requirements.md) — serve the structure document, verbatim, with the live tree and `structureMissing`
- [FR-07](../../functional/06-functional-requirements.md) — the folder tree on its own
- [FR-11](../../functional/06-functional-requirements.md) — writes to undeclared folders succeed and are recorded as drift
- [FR-26](../../functional/06-functional-requirements.md) — `gbrain doctor` reports drift and modifies nothing
