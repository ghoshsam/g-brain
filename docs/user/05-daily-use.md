---
title: Using it day to day
description: What to save, how to ask for it, how to find it again, and the one habit that makes the whole thing worth it.
---

# Using it day to day

You have a brain, and your AI tool is connected to it. This page is about
getting something out of it.

Almost all of this happens in normal conversation. You will rarely need a
command.

---

## What is worth saving

One test: **will this still be true and useful next month?**

| Worth saving | Not worth saving |
|---|---|
| A decision, and why you rejected the other options | Anything true only today ("the build is broken") |
| How something actually works, once you have worked it out | A log of what you tried in one session |
| A convention you want followed from now on | Anything you would not want a colleague to read |
| A correction you had to give your AI | Passwords, keys, personal details about people |

Two of those deserve more attention than they usually get.

**A decision, with its reasoning.** "We use advisory locks" is worth very little
on its own. Here is the version worth keeping: "We use advisory locks because
the table lock held through the whole batch. We rejected `SKIP LOCKED` because
it broke ordering." The rejected option is the part people come back for.

**A correction you gave your AI.** If you had to tell it something twice, that
is the most valuable thing you can save. Next time it starts cold, it reads that
note and gets it right first time.

---

## How to ask it to save a note

Just say so, in normal conversation:

> Remember that we always run migrations through the release pipeline, never by
> hand against production.

> Save what we just worked out about how the retry backoff behaves under load.

> That correction you just got — write it down so you do not do it again.

> Write this up as a decision, including the option we rejected and why.

**Do not name a folder.** That is the whole point. Your AI reads
`content-structure.md` — your folder list — works out what kind of note this is,
and picks the folder itself.

If you name the folder, you are doing the work the tool exists to do. You will
also pick differently from the way it picks, so your brain ends up inconsistent.

Saying *what kind of thing* it is does help, though. "Write this up as a
decision" or "that is a convention, not a one-off" gives your AI something to
work with, without you choosing a path.

---

## The habit that matters most

At the end of a working session, ask:

> What did we learn today that will still be true next month? Write that down.

That is it. That one question is the difference between a brain that gets more
useful over time and a folder of dated scratch nobody opens.

Here is why. Left alone, AI tools write session notes. The notes are thorough,
honest and dated. Everything valuable in them gets buried within a fortnight.
The knowledge was saved. It just was not saved anywhere anyone will look.

Asking the question moves the durable part out — into a decision, a piece of
knowledge, a convention. The session notes stay behind as the record of what
happened. The shipped folder lists warn about this trap, but it works much
better when you ask too.

---

## Finding things again

Ask normally:

> What do we know about the job runner?

> Have we decided anything about how we do database migrations?

> What did we learn last time we touched the auth middleware?

Your AI narrows down before it reads. It works in three passes:

1. **Filter by folder and tag.** It usually knows the shape of what it wants
   before it knows the wording.
2. **Search the full text** of what is left.
3. **Follow the links** between notes, to pick up the rest of the cluster.

That third pass is why linking matters. A note that links to another one makes
both findable from either end. A note nothing links to is nearly invisible.

Check what it found. Notes carry an `updated` date. Some carry a `status`, or a
`superseded-by` field pointing at a newer note. A superseded note tells you what
you believed at the time, not what is true now.

---

## The inbox

Sometimes your AI cannot work out where a note belongs. When that happens it
writes the note to `00-inbox/` and records a one-line reason.

**This is correct behaviour, not a failure.** It is the most useful thing the
tool can do when it is unsure, because guessing is worse:

| What happens | Can you see it? |
|---|---|
| It guesses wrong | No. The note looks exactly like a correct one. You find out when you fail to find something |
| It uses the inbox | Yes. `gbrain doctor` lists it, with the reason attached |

So an inbox with a few things in it is a healthy brain. An empty inbox in a busy
brain usually means your AI is guessing.

### Emptying the inbox

Do this every week or two. It takes a few minutes.

**Step 1: See what is in there.**

```bash
cd ~/brain
gbrain doctor
```

```
Inbox — each with the reason the agent could not place it
  00-inbox/invoicing-comment.md
    A customer remark that might matter later — no idea which project
```

**Step 2: File them.** Move them yourself, or ask:

> Go through my inbox. For each note, either file it properly or tell me why you
> still cannot.

**Step 3: Read the reasons.** If three inbox notes have something in common,
that is not an inbox problem. Your folder list is missing a folder, or one
folder's description is too vague. Fix the words. See
[the filing convention](./04-the-filing-convention.md).

---

## Searching it yourself

When you want to search without involving your AI:

```bash
cd ~/brain
gbrain search "advisory locks"
```

```
Use Postgres advisory locks for the job runner
  40-decisions/2026/use-advisory-locks.md
  ...the table lock was held for the whole batch, so we moved to an advisory...

How the job runner claims work
  10-knowledge/infrastructure/job-runner.md
  ...each batch is claimed with an advisory lock keyed on the queue name...
```

If nothing matches, it prints `Nothing matched.` and stops.

| Option | What it does |
|---|---|
| `-f, --folder <folder>` | Only search inside one folder |
| `-t, --tag <tag>` | Only notes with that tag |
| `-n, --limit <n>` | How many results. Ten by default |

```bash
gbrain search "retry" --folder 10-knowledge --limit 3
```

Search uses an index, which is built for you as you go. If results ever look
stale or wrong, rebuild it:

```bash
gbrain index
```

```
Indexed 42 documents in 310ms.
The index is derived — deleting it loses nothing.
```

That last line is worth remembering. The index is not your data. Delete it any
time and rebuild it from the markdown files. Nothing is lost.

---

## Reading your brain like a human

It is markdown in a git repository, so you have options.

**Push it somewhere.** GitHub, GitLab and Azure DevOps all render markdown and
let you browse the folder tree. That gives you a readable, searchable,
backed-up copy with no extra tooling:

```bash
cd ~/brain
git remote add origin <your-private-repo>
git push -u origin main
```

Use a **private** repository. Your brain is not for the public.

**Open the folder in VS Code.** Markdown preview, search across files and git
history all work as usual.

**Open it in Obsidian.** Point a vault at `~/brain`. Obsidian follows the
`[[links]]` your AI writes between notes, so you get the graph and backlinks for
free. This is the nicest way to read a brain that has been running a while.

**Or just use the terminal.** `grep`, `ls`, `cat`. Nothing is hidden and nothing
is encoded.

---

## What it will refuse to save

Two kinds of thing never make it into your brain.

**Credentials.** Passwords, API keys, tokens, private keys, and database
connection strings with a password in them. g-brain scans for these and refuses
the write. Nothing gets saved. The error tells your AI to remove the credential,
not to disguise it.

This is deliberate, and you cannot turn it off. A brain is shared, and it is a
git repository. A secret written into it is a secret in someone's history
forever.

**Personal details about people.** Contact details, opinions on how someone is
performing, anything health-related or private.

This one is a rule in your folder list, not a scanner. So your AI is following
an instruction rather than being blocked. The instruction is in every preset,
and it is worth keeping when you rewrite the list.

The reason is the same as for credentials. Your brain gets read by colleagues
and by tools, months from now, with you not in the room. The default list puts
it well: if you would not say it in a public standup, it does not go in.

A note is also refused if it is nearly the same as a note you already have, if
it is enormous, or if someone else edited the same note while your AI was
writing. Those are covered in [troubleshooting](./07-troubleshooting.md).

**Everything else gets saved.** That includes a note filed somewhere your folder
list does not mention. This is on purpose. A refused note is usually lost for
good. A note in an odd folder is just a bit annoying, and `gbrain doctor` will
tell you about it.

---

## What it will not do

Worth knowing, so you do not wait for something that is not coming.

**It does not read your documents for you.** g-brain will not scan your repo,
your wiki or your ticket system and turn them into notes. Things get in because
your AI put them there, during a conversation you had.

**It does not write anything on its own.** There is no background process
deciding what is worth keeping. Nothing happens unless a tool you are talking to
does it.

**It does not delete anything.** When a note is genuinely finished, it moves to
`90-archive/`, keeping the same path it came from. It stays searchable, just
ranked lower. Nothing is destroyed, and everything is in git anyway.

---

## Where to go next

| | |
|---|---|
| [The filing convention](./04-the-filing-convention.md) | Your folder list, and how to make it fit your work |
| [Keeping it worth reading](./06-maintenance.md) | `doctor`, tidying up, backups |
| [Troubleshooting](./07-troubleshooting.md) | When a save is refused or a note does not turn up |
| [Sharing with a team](./08-sharing-with-a-team.md) | One brain for several people |
