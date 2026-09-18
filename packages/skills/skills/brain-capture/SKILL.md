---
name: brain-capture
description: Save something to the shared brain so it is findable later. Use when you learn something during a task that will still be true next month — a decision and its reasoning, how a system actually works, a convention the team follows, a correction someone gave you. Also use before finishing a session, to write down what you learned.
---

# Capture to the brain

## The one rule

**Call `brain_structure` before your first write in a session, and choose the
path from what it returns.**

Never invent a path from memory or from another brain's conventions. The
convention differs per brain and it changes.

## How to decide where something goes

1. **Ask what the content *is*, not what you were doing when you produced it.**
   A decision made while debugging is a decision, not a session log. This one
   confusion causes most misfiling.
2. **Ask how long it stays true.** A rule to apply from now on, durable
   explanation, tied to one piece of work, or true only today — the structure
   document names a folder for each.
3. **Read the "does not belong here" lines.** They do more work than the
   "belongs here" lines, because the hard cases fit two folders plausibly.
4. **If two folders both fit, pick where someone would look for it**, not where
   it was produced.

## Search before you create

```
brain_search({ q: "<the topic>" })
```

Updating an existing document is almost always better than adding a second one
on the same subject. If you skip this you will often get `CONFLICT` back naming
the document you should have updated.

## If you cannot place it, use the inbox

Write to `00-inbox/` with `needs-filing: true` and a one-line reason.

**This is a correct answer, not a failure.** A wrong guess is invisible — nobody
ever finds the document again. An inbox item is a queue someone empties. Do not
guess to avoid looking uncertain.

## Writing

```
brain_write({
  path: "40-decisions/2026/use-advisory-locks.md",
  content: "---\ntitle: ...\ntype: decision\ntags: [db]\n---\n\n...",
  ifMatch: "<etag>"   // required only when replacing
})
```

- **Lead with the answer.** The first paragraph says the thing. Readers stop
  after the top.
- **Record the reasoning, not just the outcome.** "We use X" is worth little.
  "We use X because Y, having rejected Z for reason W" is worth keeping.
- **Write for someone who was not there.** No "as discussed", no unexplained
  pronouns, no "the usual approach".
- **Link generously** — `[[10-knowledge/auth/tokens.md]]`. Backlinks are
  computed, so one link makes a document findable from both ends. An unlinked
  document is nearly invisible.
- **Say when you are unsure.** A brain of confident wrong answers is worse than
  an empty one.
- `created`, `updated` and `id` are stamped for you. Do not fabricate them.

## Adding to something that exists — append, do not rewrite

```
brain_append({ path, content, section: "Open questions" })
```

Needs no etag and cannot clobber a concurrent writer. Prefer it for anything
additive. Reserve `brain_write` for genuine rewrites.

## What comes back

| Code | What to do |
|---|---|
| `CONFLICT` | Read the named document and improve it instead. `force: true` only if it really is separate |
| `PRECONDITION_FAILED` | Someone wrote since you read. Re-read, merge their change, retry with the new etag. **Never force** |
| `PRECONDITION_REQUIRED` | You are replacing something. Read it, retry with its etag — or use `brain_append` |
| `UNSAFE_CONTENT` | A credential is in the body. Do not retry. Remove it — do not obfuscate it — and reconsider whether this belongs in a shared brain |

A write to a folder the convention does not mention **succeeds** and is recorded
as drift. You will not be rejected for filing imperfectly.

## Never

- Write secrets, credentials, tokens, connection strings, or API keys.
- Write personal, sensitive, or evaluative information about people.
- Rewrite an accepted decision — supersede it with a new document, link both
  ways, and leave the old text intact.
- Retry a `PRECONDITION_FAILED` with force. That is how work is lost.
