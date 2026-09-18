---
title: OIDC token refresh
type: how-to
tags: [auth, oidc]
created: 2026-09-18
updated: 2026-09-18
---

Access tokens live for 15 minutes and are refreshed with the rotating refresh
token, not re-authenticated. The refresh token is single-use: each refresh
returns a new one and invalidates the old.

The failure people hit is refreshing twice concurrently. The second call
presents an already-used token and the whole session is revoked. Serialise
refreshes per session.

Related: [[40-decisions/2026/rotate-refresh-tokens.md]]
