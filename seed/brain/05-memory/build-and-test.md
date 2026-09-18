---
title: How to build and test this codebase
type: memory
tags: [tooling, testing]
created: 2026-09-18
updated: 2026-09-18
---

Use `pnpm`, never `npm` or `yarn`. The workspace is pnpm-specific and npm will
produce a broken install.

- `pnpm verify` runs lint, typecheck, test, and build in that order. Run it
  before saying anything is finished.
- Tests live beside the code as `*.test.ts`, plus `tests/` for rules that span
  packages.
- Do not commit or push unless explicitly asked.

The release steps that rely on this: [[50-playbooks/cut-a-release.md]]
