---
title: User manual
description: How to install g-brain, connect your AI tool, and use it.
---

# g-brain user manual

Your AI coding tools forget everything when a chat ends. What you worked out on
Friday is gone by Monday.

g-brain gives them a shared place to keep notes.

It is a folder of markdown files. Inside it is a file called
**`content-structure.md`** that lists your folders and says, in plain English,
what goes in each one. When your AI wants to save something, it reads that list
and picks a folder itself. You never tell it where.

**Want to try it now?**

```bash
npx gbrain init ~/brain
```

Then paste the text it prints into your AI tool, and ask it to remember
something.

---

## The pages

| | |
|---|---|
| **[1. Getting started](./01-getting-started.md)** | **Start here.** Five steps, about five minutes |
| [2. Installation](./02-installation.md) | Other ways to install, and how to connect different AI tools |
| [3. Configuration](./03-configuration.md) | Settings you can change, and the few worth changing |
| **[4. The filing convention](./04-the-filing-convention.md)** | Your folder list. The most useful page here |
| [5. Using it day to day](./05-daily-use.md) | What to save, how to find it later |
| [6. Keeping it worth reading](./06-maintenance.md) | Tidying up, and backups |
| [7. Troubleshooting](./07-troubleshooting.md) | When something goes wrong |
| [8. Sharing with a team](./08-sharing-with-a-team.md) | One brain for several people |

---

## Three things to know first

### Your notes are just files

Markdown files in a git repository. You can open them in any editor, search them
with `grep`, and back them up by pushing to git.

If you stop using g-brain tomorrow, your notes still work. There is no database
and nothing to export.

### It will not reject a note for being in the wrong place

If your AI saves something to a folder your list does not mention, **it still
gets saved**. g-brain just makes a note for you to look at later.

This is on purpose. A note that gets rejected is usually lost for good. A note
in the wrong folder is just a bit annoying, and you can move it.

It *will* stop a note if it is genuinely unsafe — a password or API key in the
text, a file path pointing outside your brain, or a near-copy of a note you
already have.

### The folder list is the whole trick

Everything else exists to serve it. The list you start with works fine, but one
written in your own words, about your own work, will do a much better job.

Improving it means editing a text file. No settings, no restart.
[Page 4](./04-the-filing-convention.md) is the one worth reading properly.

---

## Building on it?

This manual is about using g-brain. If you want to write code against it, or
change how it works:

| | |
|---|---|
| [The agent contract](../functional/07-agent-contract.md) | Writing a tool that talks to the brain |
| [Architecture](../technical/01-architecture.md) | How it is put together |
| [Decisions](../technical/12-adr/) | Why it works this way |
| [Development plan](../../plan/DEVELOPMENT-PLAN.md) | Working on g-brain itself |
