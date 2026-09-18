---
title: Rotate refresh tokens on every use
type: decision
tags: [auth, security]
status: active
created: 2026-09-18
updated: 2026-09-18
---

**Decision:** every refresh returns a new refresh token and invalidates the old
one.

**Context.** Long-lived refresh tokens are the highest-value credential in the
system and we had no way to detect a stolen one.

**Options considered.** Keep long-lived tokens and shorten their lifetime;
rotate on every use; bind tokens to a device fingerprint.

**Consequences.** A replayed token is detectable and revokes the session, which
is what we wanted. The cost is that concurrent refreshes now break, so clients
must serialise them — see [[10-knowledge/auth/oidc-token-refresh.md]].
