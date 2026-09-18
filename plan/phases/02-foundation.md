---
title: Phase 2 — Foundation
description: The workspace skeleton — pnpm, Turborepo, TypeScript, Biome, Vitest — and the example brain content.
---

# Phase 2 — Foundation

**Status:** complete
**Delivers:** a monorepo that builds, lints, and tests with nothing in it yet,
plus `seed/brain/`.

## Why

Everything after this assumes the workspace enforces the architecture rather
than documenting it. pnpm's strictness is what makes "all behaviour in
`packages/core`" checkable in a diff instead of a review habit: if `apps/mcp`
starts importing `simple-git`, it has to declare it, and that declaration is the
violation.

Doing it as its own phase keeps tooling churn out of the phases that write real
logic.

## Scope

**In:** workspace config, TypeScript config, lint/format, test runner, build,
the package skeletons with no implementation, `seed/brain/`, `.env.example`, CI.
**Out:** any behaviour. Every package exports types and stubs.

## Files

```
package.json                 pnpm workspace root, scripts
pnpm-workspace.yaml
turbo.json                   build, test, lint, typecheck task graph
tsconfig.base.json           strict, ESM, NodeNext
biome.json
vitest.config.ts             workspace-level
.env.example                 every variable from 02-tech-stack.md
.github/workflows/ci.yml     install, typecheck, lint, test, build

packages/core/               package.json, tsconfig, src/index.ts (types only)
packages/search/             package.json, tsconfig, src/index.ts (interfaces only)
packages/skills/             package.json — empty until phase 8
apps/mcp/                    package.json, tsconfig, src/index.ts (stub)
apps/cli/                    package.json, bin entry, src/index.ts (stub)

seed/brain/                  example content, one document per default folder
  content-structure.md       a copy of seed/presets/default.md
  00-inbox/…  10-knowledge/…  20-projects/…  40-decisions/…  50-playbooks/…
```

## Key decisions to settle here

- ~~**Whether `packages/contracts` exists at all.**~~ **Settled: collapsed into
  `core`.** Types live in `packages/core/src/types.ts`. Recorded in
  [`decisions-log.md`](../decisions-log.md).
- **The `Result<T>` and `BrainError` shape**, defined once in `core` and
  imported everywhere. It is the contract the whole build hangs off — the full
  shared-type block is specified in
  [`11-components/README.md`](../../docs/technical/11-components/README.md#shared-types)
  and phase 2 ships exactly that file with no logic in it.
- **The dependency rules** at the end of that document become the workspace test
  below. `no module imports ops` and `no apps/* imports fs, simple-git,
  gray-matter, or @orama/orama` are the two that matter.

## Definition of done

- [x] `pnpm install && pnpm build && pnpm test && pnpm lint && pnpm typecheck`
      all pass from a clean clone.
- [x] `tsconfig.base.json` is `strict`, ESM, with no `any` escape hatches
      configured.
- [x] `Result<T>` and `BrainError` are defined in `core` with the complete error
      code union from
      [`06-functional-requirements.md`](../../docs/functional/06-functional-requirements.md).
- [x] `apps/*` declare no dependency on `fs`, `simple-git`, `gray-matter`, or
      `@orama/orama`. They depend on `core` and their own surface library only.
- [x] `seed/brain/` has one realistic example document per default folder, each
      with valid frontmatter, each demonstrating a convention rather than saying
      "example".
- [x] `.env.example` lists every variable in
      [`02-tech-stack.md`](../../docs/technical/02-tech-stack.md) with its
      default, `BRAIN_ROOT` included and commented with the placement warning.
- [x] CI runs the same four commands on every push.

## Tests

- A smoke test per package that imports it and asserts it loads — enough to
  catch ESM and build misconfiguration.
- A workspace test asserting the dependency rule: `apps/*` package manifests
  contain no storage, git, or search dependency. This is the architecture rule
  as a test, and it is worth having because the rule is the thing most likely to
  erode quietly.

## Risks

ESM plus TypeScript plus Vitest plus tsup is the part of any Node monorepo most
likely to cost a day to nothing but configuration. Budget for it here rather
than discovering it in phase 3.
