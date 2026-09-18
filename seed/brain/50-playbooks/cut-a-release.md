---
title: Cut a release
type: playbook
tags: [release]
created: 2026-09-18
updated: 2026-09-18
---

**Preconditions:** `main` is green and every change has a changeset.

1. `pnpm verify` — all four steps pass.
2. `pnpm changeset version` and check the generated changelog.
3. Commit as `release: vX.Y.Z`.
4. Tag and push the tag.
5. Confirm the published package installs: `npx g-brain@X.Y.Z --version`.

**Done when** the tag exists, the package installs, and the changelog is right.

Why `pnpm` and not `npm`: [[05-memory/build-and-test.md]]
