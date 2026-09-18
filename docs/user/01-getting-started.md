---
title: Getting started
description: Set up g-brain and watch an AI tool save and find a note on its own. About five minutes.
---

# Getting started

At the end of this page, your AI tool will save a note and find it again later.
You will not have to tell it which folder to use.

**Before you start.** You need Node.js version 20 or newer, and git.

---

## Step 1: Make a brain

Run this:

```bash
npx gbrain init ~/brain
```

You will see this:

```
Created a brain at /home/you/brain

  preset            default
  git repository    yes
  example documents 7

Connect an agent — add this to your MCP client:

{
  "mcpServers": {
    "g-brain": {
      "command": "npx",
      "args": ["-y", "gbrain-mcp"],
      "env": { "BRAIN_ROOT": "/home/you/brain" }
    }
  }
}
```

**Copy that block of text.** You need it in step 2.

### What you just made

A new folder with three things in it:

1. **`content-structure.md`** — a list of the folders and what goes in each one,
   written in plain English. Your AI tool reads this file to decide where to put
   things. This is the important one.
2. **Seven example notes**, one per folder, so the AI can see what good notes
   look like.
3. **A `README.md`** with the text from step 2, in case you lose it.

The folder is also a git repository. That is how you get history and backups.

> **Put your brain outside your code.** `~/brain` is a good choice. Do not put
> it inside a project folder. If you do, your AI's notes can end up saved into
> that project by mistake. g-brain will stop you from making this mistake.

---

## Step 2: Connect your AI tool

Paste the block of text from step 1 into your AI tool's settings.

| Tool | Where it goes |
|---|---|
| Claude Code | `~/.claude/settings.json`, or run `claude mcp add` |
| Cursor | Settings, then MCP, then Add |
| Anything else | Wherever it asks for `mcpServers` |

Now restart the tool. You should see ten new tools whose names start with
`brain_`.

---

## Step 3: Ask it to remember something

Just talk to it normally. For example:

> Remember that we use Postgres advisory locks for the job runner instead of
> table locks, because the table lock held through the whole batch.

**Do not say which folder.** That is the whole point. The AI reads your
`content-structure.md`, works out that this is a decision, and saves it
somewhere like `40-decisions/2026/use-advisory-locks.md`.

Check that it worked:

```bash
ls ~/brain/40-decisions/2026/
```

---

## Step 4: Start a new chat and ask about it

Open a **brand new** conversation, with no history. Ask:

> What do we know about locking in the job runner?

It will find the note from step 3.

That is the whole idea. What one session learns, the next session knows.

---

## Step 5: Check on your brain

```bash
cd ~/brain
gbrain doctor
```

```
Brain /home/you/brain
8 documents

     0  drift            in folders the convention does not describe
     0  broken links     pointing at paths that do not exist
     1  orphans          nothing links to them and they link to nothing
     0  near-duplicates  candidates to merge
     0  inbox            waiting to be filed
```

This command only looks. It never changes anything.

Seeing some numbers above zero is normal. What matters is whether they keep
growing. If they do, it is time for a tidy-up. See
[keeping it worth reading](./06-maintenance.md).

---

## What to do next

### Make the folder list your own

This is the most useful thing you can do. The one you got is a good start, but
one that matches how your team really works will do a much better job.

Open `~/brain/content-structure.md` and edit it. It is plain English, so just
write what you mean. Or ask your AI tool to ask you some questions and rewrite
it for you.

See [the filing convention](./04-the-filing-convention.md).

### Save your work

Your brain is a git repository, so:

```bash
cd ~/brain
git add -A
git commit -m "first week of notes"
```

Push it to a private repository somewhere and that is your backup.

### Turn on automatic saving

Once you trust it, you can have every note saved to git on its own:

```
GIT_AUTOCOMMIT=true
```

This is off to start with. Writing to a git repository is the kind of thing you
should choose, not have chosen for you.

---

## If it did not work

| What happened | What to do |
|---|---|
| The AI does not have the `brain_` tools | Restart it. Then check the settings text you pasted |
| It asks you where to save things | Your folder list is too vague. Edit it — see [page 4](./04-the-filing-convention.md) |
| Something else | See [troubleshooting](./07-troubleshooting.md) |

---

## The rest of the manual

| | |
|---|---|
| [Installation](./02-installation.md) | Other ways to install it |
| [Configuration](./03-configuration.md) | Settings you can change |
| [The filing convention](./04-the-filing-convention.md) | The folder list, and how to write a good one |
| [Using it day to day](./05-daily-use.md) | What to save, and how to find it |
| [Keeping it worth reading](./06-maintenance.md) | Tidying up |
| [Sharing with a team](./08-sharing-with-a-team.md) | One brain for several people |
