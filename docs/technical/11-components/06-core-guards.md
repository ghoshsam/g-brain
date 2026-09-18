---
title: core/guards
description: The complete list of reasons a write may be refused, and every one of them is a safety reason.
---

# core/guards

## What is core/guards

`core/guards` holds the checks that can stop a write: the secret and PII scan,
the size ceiling, the per-key rate limit, and near-duplicate detection on create.
It is a separate component so that the complete list of rejections is readable in
one file — if a rejection is not here, it does not exist. That containment is
the mechanism behind [ADR-0002](../12-adr/0002-safety-only-write-guards.md):
anything tempted to reject for tidiness has nowhere to live here and belongs in
`core/doc` as a lint finding instead.

## Responsibilities

- Scan the submitted body, frontmatter included, against a curated in-repo rule set.
- Return `UNSAFE_CONTENT` naming the rule and the line, with nothing written to disk.
- Mask the finding excerpt so the credential never enters the error, the agent's context, or the audit log.
- Reject a body above `MAX_DOC_BYTES` with `TOO_LARGE`, before the secret scan and before disk.
- Meter each actor with a token bucket and return `RATE_LIMITED` with a retry hint.
- Compare a create against documents in the same folder by trigram similarity.
- Return `CONFLICT` naming the existing path and the similarity score when the threshold is crossed.
- Honour `force: true` as an override on the duplicate check and on nothing else.

## Not its job

- Path containment. That is `core/paths`, run first so nothing is opened for a path that has not been contained.
- Anything structural — no folder whitelist, no required frontmatter, no filename policy. A guard tempted to reject for tidiness belongs in `core/doc`.
- Preconditions. `PRECONDITION_REQUIRED` and `PRECONDITION_FAILED` are `core/store`, because only the store knows what is on disk.
- Being exhaustive about secrets. It is a pattern scanner and will miss novel and obfuscated formats.
- Logging the rejection. `core/guards` returns the error; `core/ops` hands it to `core/audit`.

## Sequence diagram

```mermaid
sequenceDiagram
    participant Ag as agent
    participant Ops as core/ops
    participant G as core/guards
    participant Au as core/audit
    participant FS as filesystem

    Ag->>Ops: writeDoc path plus body carrying a token
    Ops->>G: checkSize content
    G-->>Ops: ok, under MAX_DOC_BYTES
    Ops->>G: scanSecrets body
    alt no rule matches
        G-->>Ops: empty findings, the write path continues
    else a rule matches
        G-->>Ops: finding rule aws-access-key-id line 14 masked excerpt
        Ops->>Au: record outcome rejected, code UNSAFE_CONTENT, rule name only
        Ops-->>Ag: UNSAFE_CONTENT naming the rule and the line
        Note over FS: nothing opened, nothing written, no commit to record it
    end
```

## Technical features

- The rule set is roughly twenty patterns, curated in `packages/core`, and each one is added on evidence of the format actually appearing in real captures.
- **Curated rather than a library, because a false positive rejects a capture** — and a rejected capture is a silent permanent loss, not a thirty-second developer inconvenience. Every rule therefore has to be reviewable in a diff, by whoever is weighing that cost, at the moment it is added. A third-party set of several hundred regexes cannot be reviewed that way and is tuned for the opposite balance.
- Pattern families: private key blocks — `-----BEGIN (RSA|EC|OPENSSH|PGP) PRIVATE KEY-----`; cloud credentials — AWS access key ids on `AKIA` or `ASIA` plus sixteen, AWS secret keys in assignment position, GCP service-account JSON key bodies, Azure storage connection strings; provider tokens — GitHub `ghp_` `gho_` `ghs_` `github_pat_`, Slack `xox[baprs]-`, Stripe `sk_live_`, OpenAI and Anthropic-style key prefixes; generic bearer material — `Authorization: Bearer` with a JWT shape, and the same header inside a pasted curl command; connection strings carrying credentials — `postgres://user:pass@host`, `mongodb+srv`, `amqp`, JDBC URLs with a `password=` parameter; high-entropy values in assignment position only; and direct personal identifiers in bulk — many email addresses, many phone numbers, national-ID shapes.
- The entropy rule fires **only** to the right of `password`, `secret`, `token`, `api_key`, `apikey` or `passwd`, at 32 characters or more above a Shannon threshold. Entropy alone flags hashes, UUIDs and base64 diagrams, so position is what keeps it usable.
- The finding excerpt is masked — `AKIA****************`, never the value. The error text travels into the agent's context and into `.brain/audit.jsonl`, and echoing the credential would move it from one shared surface to two. The agent already has the content and does not need to be told the value.
- **The rejection is audited even though there is no commit.** A refused write produces no git object, so one line in `audit.jsonl` with `outcome: rejected`, the rule name, the path and the actor is its only trace — and it is exactly the event worth keeping, because it means an agent is handling credentials it should not be.
- Frontmatter is scanned along with the body, because an agent will put a token in a `source:` field.
- `checkSize` compares the in-memory body against `MAX_DOC_BYTES`, default `262144` — 256 kB — and returns `TOO_LARGE`. It runs at step 3, before the scan and before any disk access, since a body that size is a dumped log or a malfunction rather than a capture, and the error tells the agent to split it into the documents it should have been.
- `checkRate` is a token bucket per key, `RATE_LIMIT_PER_MINUTE` default `120`, with `RATE_LIMITED` carrying a retry hint the agent backs off against. The bucket is **in-process and in-memory**: a restart resets it, and a `gbrain` invocation running alongside a server has its own bucket — two processes against one `BRAIN_ROOT` means two buckets, because they coordinate through the filesystem for locks and etags, not for rate.
- `checkDuplicate` is create-only. It compares the incoming body against documents in the same folder by trigram similarity, and at or above `DUPLICATE_THRESHOLD`, default `0.9`, returns `CONFLICT` with `details.existingPath` and `details.similarity`. `force: true` overrides it — and overrides nothing else, least of all a precondition.
- On append the guards run with two differences: the secret scan covers the fragment, and `TOO_LARGE` is evaluated against the **resulting** document rather than the fragment, so a document cannot be grown past the ceiling one append at a time. The duplicate check does not apply.
- **Honest limits — the scanner.** It matches formats it has been taught, so a credential in a format nobody wrote a rule for goes straight through. It is trivially defeated on purpose: split a key across two lines, base64 it, or bury it in prose and every rule here misses. It does not understand context, so a documented example key in a how-to is rejected like a live one — the workaround is to redact the example, which is the right outcome anyway. It defends against accident, which is the actual threat.
- **Honest limits — the rest.** Near-duplicate detection is the one guard that can be wrong in the costly direction, which is why it is overridable. Size and rate are cheap guards against a runaway loop, not defences against a determined caller, and nothing caps total brain size or repo growth. The real control over secrets is the standing boundary that regulated data and credentials do not enter the brain at all — the scanner is the last net under that rule, never a reason to relax it. An agent receiving `UNSAFE_CONTENT` must not retry, obfuscated or split.

## Interface

```ts
export interface SecretFinding {
  rule: string        // e.g. 'aws-access-key-id'
  line: number
  /** Never the secret itself. */
  excerpt: string
}

export function scanSecrets(body: string): SecretFinding[]

export function checkSize(ctx: BrainContext, content: string): Result<void>

export function checkRate(ctx: BrainContext): Result<void>

export function checkDuplicate(
  ctx: BrainContext,
  path: DocPath,
  body: string,
  force: boolean,
): Promise<Result<void>>   // CONFLICT carries details.existingPath and details.similarity
```

## Related

- [Security](../08-security.md) — the deep dive, the threat model, and the scanner's rule families in full
- [ADR-0002 — Safety-only write guards](../12-adr/0002-safety-only-write-guards.md) — why this list of rejections and no other
- [Architecture](../01-architecture.md) — steps 3, 4 and 6 of the twelve-step write path
- [Git and audit](../07-git-and-audit.md) — the audit line that records a rejection git cannot
- [Component specifications](../11-components/README.md) — the interface contract
- Satisfies [FR-15](../../functional/06-functional-requirements.md), [FR-16](../../functional/06-functional-requirements.md), [FR-17](../../functional/06-functional-requirements.md), [FR-22](../../functional/06-functional-requirements.md)
