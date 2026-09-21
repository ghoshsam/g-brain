---
title: The filing convention
description: content-structure.md is the list of folders that decides where every note goes. What it is, how to make it your own, and how to tell if it is working.
---

# The filing convention

Your brain has a file at the top of it called `content-structure.md`. This is
your folder list. It names your folders and says, in plain English, what goes in
each one.

When your AI tool wants to save a note, it reads the list and picks a folder.
That is the whole mechanism.

**Nothing checks this file.** There are no rules to write and no settings to
fill in. To change how your brain is organised, you change the words. Then save.
Your AI tool picks up the change the next time it saves a note. Nothing to
restart.

This is the page worth reading properly.

---

## Step 1: Pick a starting point

`gbrain init` copies one of three ready-made lists into your new brain. Pick the
closest one and edit it. Editing a list that already works is much easier than
starting from a blank file.

To see the three:

```bash
gbrain init --list-presets
```

| Preset | Who it is for | What you get |
|---|---|---|
| `default` | A team, a company, anything shared | Nine folders. Each one says what belongs and what does not |
| `product-team` | One product or platform team | The default, plus `15-specs/` and `45-incidents/` |
| `personal` | Just you | Six folders. Short descriptions, no ceremony |

To pick one:

```bash
gbrain init ~/brain --preset product-team
```

You can change your mind later. Switching means copying a different list over
`content-structure.md`. Your existing notes are not touched.

---

## The folders you get by default

| Folder | What goes in it | An example |
|---|---|---|
| `00-inbox/` | Anything the AI could not confidently place, with a one-line reason | `00-inbox/something-a-customer-said.md` |
| `05-memory/` | How you work everywhere. Things the AI should apply whatever it is working on | `05-memory/git-hygiene.md` |
| `10-knowledge/{topic}/` | Explanations that outlive any one project | `10-knowledge/auth/oidc-token-refresh.md` |
| `20-projects/{project}/` | Anything tied to one piece of work you are doing now | `20-projects/billing-rewrite/open-questions.md` |
| `30-people/` | Who does what, and how to work with them | `30-people/platform-team.md` |
| `40-decisions/{yyyy}/` | A choice, what you rejected, and why | `40-decisions/2026/use-advisory-locks.md` |
| `50-playbooks/` | Steps someone follows to get something done | `50-playbooks/cut-a-release.md` |
| `60-sessions/{yyyy}/{mm}/` | Working notes from one session. Assume they go stale | `60-sessions/2026/09/refactor-auth-middleware.md` |
| `90-archive/` | Finished or replaced notes, kept for history | `90-archive/projects/billing-rewrite/` |

The numbers go up in tens on purpose. That leaves gaps. You can add a folder
later without renumbering anything.

---

## Rules about one project live with that project

Some rules are true whatever you are doing. *Never commit unless I ask.* Those
go in `05-memory/`.

Other rules are only true of one job. *On the billing rewrite, run the tests
before you push.* That one is not true everywhere, so it does not belong in
`05-memory/`. It goes inside the project it is about:

```
20-projects/billing-rewrite/memory/running-the-tests.md
```

Two reasons this is worth the extra folder.

**Your AI reads `05-memory/` at the start of every session.** Every line in there
costs you. Rules about a project you are not touching today are noise.

**When the project ends, the whole folder moves to the archive.** Its rules go
with it. There is nothing left behind to clean up.

The quick test: if you are about to name a memory note after a project, it
belongs in that project.

One thing to expect. A `memory/` folder inside a project is a folder your main
list does not name, so `gbrain doctor` will report it as drift. Nothing stops
working — drift is only a note. To settle it, give that project a list of its
own.

---

## A project can have its own folder list

Most projects never need one. Notes sit loose in the project folder, the list at
the top of your brain covers them, and that is fine. It is the normal case, not
something you forgot to do.

Sometimes one project gets big enough to want folders of its own — `memory/`,
`decisions/`, `research/`. When that happens, put a second `content-structure.md`
inside the project folder and describe them there:

```
20-projects/billing-rewrite/content-structure.md
```

From then on, that file decides what goes where **inside that project**. The list
at the top of your brain still decides what counts as a project in the first
place. The two do not compete: one covers the brain, the other covers one folder
in it.

Three things worth knowing:

- **It is optional, and reversible.** Delete the file and the project goes back
  to being covered by the main list. Nothing moves and nothing breaks.
- **Your AI can read one project's list on its own**, without pulling in the
  whole brain's.
- **`gbrain doctor` checks each project against whichever list covers it** — the
  project's own where there is one, the main list where there is not. A note
  sitting straight in the project folder is never counted as drift.

Write it the same way as the main list: what belongs, what does not, and where
those things go instead. It can be much shorter. It only has to cover one
project.

---

## Step 2: Make the list your own

The list you start with works. One written in your own words works much better.
Here is what to do, most useful first.

### Put the "how to choose" steps at the top

Before you list any folder, write four to six numbered steps saying how to pick
one.

Your AI reads the file from the top down. By the time it reaches the folder
list, it is already forming an answer. The steps at the top are the only part
you can be sure it reads first.

Two steps are worth having in every version:

**Ask what the note *is*, not what you were doing when you wrote it.** A
decision you made while debugging is a decision. It is not a debugging log.
Filing by the activity that produced the note is the most common mistake there
is.

**If two folders both fit, pick the one where someone would go looking.** Not
the one the note came from. Your brain exists to be read later.

### Say what does *not* go in each folder

This is the change that helps most.

Notes are almost never misfiled because they fit nowhere. They are misfiled
because they fit two folders and your AI picked the wrong one. Listing what
belongs does not help. Both lists look true. Listing what does *not* belong
does.

Two rules for writing exclusions:

**Name where it should go instead.** "Not project work" makes your AI work the
answer out again. "Anything tied to one project — that goes in `20-projects/`"
hands it the answer.

**Write exclusions in pairs.** If your knowledge folder excludes project work,
then your projects folder must exclude durable knowledge and say to link to it.
Saying it on one side only fixes the confusion in one direction.

Where two folders are easy to confuse, give a question your AI can actually
answer. Not an adjective. The default list does this for the hardest pair: *if
this project were cancelled tomorrow, would this still be worth keeping?* If
yes, it is knowledge, not project work.

### Give one real example per folder

One. And a real one.

```markdown
Example: `40-decisions/2026/use-git-as-the-history-layer.md`
```

That one line does four jobs. It shows what `{yyyy}` turns into. It shows
lowercase-with-dashes. It shows a filename that describes the content rather
than the date. And it makes the folder concrete. A placeholder like
`40-decisions/{year}/{slug}.md` does none of them.

Do not give three examples. Your AI starts matching the nearest example instead
of thinking about what belongs. And every extra line is read on every single
save.

### Keep an inbox, and say that using it is fine

You need a folder for "I do not know". You also need a sentence saying that
choosing it is a correct answer:

```markdown
5. If nothing fits, write to `00-inbox/` and set `needs-filing: true` in the
   frontmatter with a one-line reason. That is a correct answer, not a failure.
```

Leave that sentence out and your AI treats not knowing as a problem to solve on
its own. So it guesses. Guessing is worse:

| What happens | Can you see it? | What it costs to fix |
|---|---|---|
| It guesses wrong | No. The note looks exactly like a correct one | You have to fail to find the note first |
| It uses the inbox and says why | Yes. `gbrain doctor` lists it | One tidy-up |

Then put a limit on the inbox, or it becomes the default answer. Something like:
*"Does not belong here: anything you could have filed. This is an escape hatch,
not a default."*

### Warn about the traps in the file itself

Your folder list is allowed to talk about its own weak spots. Your AI is reading
it at the exact moment the warning applies.

The session-notes folder always needs one. Every shared brain fails the same
way. The AI writes careful session logs. Nothing ever moves out of them. A year
later, everything worth knowing is buried in dated scratch nobody opens.

The people folder needs one too. Nothing personal, nothing sensitive, nothing
about how good someone is at their job.

### Keep it under about 400 lines

This file is read **every single time** something gets saved. It takes up room
your AI would otherwise spend on the actual task.

| Preset | Lines |
|---|---|
| `personal.md` | 125 |
| `product-team.md` | 209 |
| `default.md` | 322 |
| About as long as you should go | 400 |

Past roughly 400 lines, the "how to choose" steps at the top sit so far from the
folder list that they stop having much effect. A long list works *worse* than a
short one saying the same thing.

So spend the space on exclusions. If you need to cut, cut in this order: extra
examples, then explanations of why the convention exists, then folders nobody
uses, then optional frontmatter fields nobody fills in.

A project's own list has the same budget, and your AI may well read both in one
session. Keep it to the folders that project actually has.

---

## A weak folder description, rewritten

**Before.** Nothing here is wrong. Nothing here rules anything out either. So
everything fits, and every choice is a coin flip.

```markdown
## 10-knowledge/

Important information and useful reference material.
```

**After.** What it is for. What it is not for. Where those things go instead. A
question that settles the hard cases. And one example.

```markdown
## 10-knowledge/{topic}/

Durable reference that outlives any single project — how a system works, what
a term means, a how-to that will still be correct next year.

**Does not belong here:** anything scoped to one project (`20-projects/`), a
choice and its reasoning (`40-decisions/`), or a step-by-step procedure
(`50-playbooks/`).

The test: *if this project were cancelled tomorrow, would this still be worth
keeping?*

Example: `10-knowledge/auth/oidc-token-refresh.md`
```

Same folder. Four more lines. The hard cases now have an answer.

Two more things to watch for in your own draft.

**Two folders you cannot tell apart are one folder.** If "projects" and
"workstreams" have no sentence separating them, your AI is guessing between
them. Merge them. Or give one a clear edge and make the other one mention it.

**Words you have not explained are invisible.** "Follow the usual RFC flow",
"tier-1 items", "the platform space" — your AI reads this file with nothing else
to go on. It will either skip the sentence or invent a meaning for it. Explain
the term in a few words, or take it out.

---

## Changing the list later is normal

You will not get this right in the first week. After a month you will know what
your team actually saves. Then you will want to change things. That is fine. It
costs nothing but the edit.

**Your existing notes are never moved.** Nothing was ever checked against the
old wording, so nothing can break under the new wording.

**Your AI picks up the change on its next save.** Nothing to restart.

**`gbrain doctor` tells you what no longer matches.** It calls this drift. Drift
means a note is sitting somewhere your list does not mention. `doctor` only
reports. It never moves anything.

So reorganising is a list you can look at, not a migration:

```bash
# 1. edit ~/brain/content-structure.md
# 2. see what no longer matches
gbrain doctor
# 3. move what is worth moving — ask your AI, or do it by hand
# 4. commit
```

Stopping halfway does not break anything. Two folder names living side by side
shows up as drift. Drift gets reported. Your brain keeps working the whole time.

Two things not to do:

**Do not renumber folders** to make room. That is what the gaps are for.
Renumbering makes every note you already have disagree with the list at once.

**Do not add a folder on its own.** A new folder that nothing points to will
either get nothing or get everything. Add the folder. Then, in the same edit, go
to the two folders nearest it in meaning and say "that goes in the new one".

---

## Two ways to edit it

**Open it yourself.** It is a markdown file at `~/brain/content-structure.md`.
Change the words. Save. Commit.

**Ask your AI to interview you.** This is often easier. The hard part is putting
into words a boundary you have never had to explain. Try something like:

> Read the folder list in my brain. Ask me about the folders that overlap, then
> rewrite it to match how we actually work. Keep it under 300 lines, and keep
> the inbox.

Either way it is a commit in a git repository. You can read the change, and you
can undo it.

---

## Is it working?

| What you notice | What it means |
|---|---|
| Your AI keeps asking you where to put things | Your list does not cover that kind of note, or covers it vaguely |
| The same wrong folder keeps filling up | Its description is too broad. Narrow it. Then say in the other folders' descriptions what should not go there |
| Two folders keep getting swapped | Neither one rules the other out. Add a sentence to each pointing at the other |
| The inbox grows faster than you empty it | Something is missing from the list. Look at what the inbox notes have in common — it is usually one folder you never created |
| `gbrain doctor` shows more drift each week | Notes are going where your list says nothing. Either add that folder, or work out which wording is sending them there |

In every case the fix is the same: **change the words**. There is nothing else
to configure, and your AI is not the problem.

One last thing. If your AI tells you it could not place a note, and the reason
sounds fair, that is your list asking to be edited. A good list invites that.
That is why the inbox description says so out loud.

---

## Where to go next

| | |
|---|---|
| [Using it day to day](./05-daily-use.md) | What to save, how to find it, emptying the inbox |
| [Keeping it worth reading](./06-maintenance.md) | Tidying up, and backups |
| [Getting started](./01-getting-started.md) | If you have not made a brain yet |
| [Writing a structure document](../technical/03-structure-doc-guide.md) | The long version, including how to measure how well your list picks folders |
