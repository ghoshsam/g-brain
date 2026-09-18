---
title: Keeping it worth reading
description: The trade g-brain makes, and the maintenance that makes it pay off.
---

# Keeping it worth reading

A brain nobody tidies turns into a folder of stale notes. Half an hour a month
keeps it useful. This page is what to do in that half hour.

---

## The trade g-brain makes

g-brain saves notes even when they are not perfect.

Say your AI saves a note to a folder your list does not mention. Your folder list
is `content-structure.md`. **The note is still saved.** g-brain just writes it
down for you to look at later. The same goes for a note with a vague title, or
one that overlaps something from last month.

A note is refused only when it would be unsafe. Here is the whole list:

| Refused when | Why |
|---|---|
| The text contains a password or a key | It would end up in git, forever |
| The file path points outside your brain | It would write somewhere it should not |
| The note is far too big | Usually a dumped log, not a note |
| The note is nearly the same as one you already have | You would end up with two of everything |
| Someone else edited that note first | Your save would wipe out their work |

Nothing else is refused. Here is why:

| | What it costs you |
|---|---|
| A refused note | Everything. The chat ends and the knowledge goes with it. |
| A note in the wrong folder | A minute. It is on disk, it is searchable, and you can move it. |

A brain that keeps rejecting notes teaches AI tools to stop saving them. So
g-brain takes the note and records the problem instead.

**Tidying up is the other half of that deal.** The rest of this page is how.

---

## `gbrain doctor`

```bash
cd ~/brain
gbrain doctor
```

```
Brain /home/you/brain
214 documents

     6  drift            in folders the convention does not describe
     2  broken links     pointing at paths that do not exist
    11  orphans          nothing links to them and they link to nothing
     3  near-duplicates  candidates to merge
     4  inbox            waiting to be filed
     0  expired          past their expires date
     7  lint warnings    documents with frontmatter warnings

Inbox — each with the reason the agent could not place it
  00-inbox/vendor-call-notes.md
    Spans billing and procurement — needs a human to split it
  00-inbox/rate-limit-numbers.md
    Could not tell which project this belongs to

Drift — these were written anyway, which is the point
  70-experiments/prompt-eval-harness.md  no folder section matches

Broken links
  20-projects/billing-migration/status.md → 10-knowledge/billing/legacy-schema.md

Near-duplicates
  10-knowledge/auth/token-refresh.md
  10-knowledge/auth/oidc-token-refresh.md  92% similar

This command reports and changes nothing.
```

**`doctor` only looks.** It never moves a file, edits a note, deletes anything or
commits. You can run it on someone else's brain, or every hour, and nothing
changes. Everything it finds is for you to act on when you choose.

Add `--json` to get the raw report. That is the version to hand to an AI tool or
a dashboard:

```bash
gbrain doctor --json
```

### What each finding means

| Finding | What it means | What to do |
|---|---|---|
| **drift** | A note sits in a folder your list does not mention. The note was saved. This is just the record of it. | Move the note. Or better, add that folder to your list. See [drift is not always wrong](#drift-is-not-always-wrong). |
| **broken links** | A `[[path]]` link points at a note that is not there. Usually something was renamed or archived. | Fix the link, or put the note back. |
| **orphans** | Nothing links to this note, and it links to nothing. You can only find it by searching. | Link to it from the project or topic it belongs to. An unlinked note is nearly invisible. |
| **near-duplicates** | Two notes cover much the same ground. | Merge them. Keep the better one, add what the other one has, archive the loser. |
| **inbox** | Your AI could not work out where this belongs, so it parked it here and said why. | File it. The reason it gives usually tells you which part of your list is too vague. |
| **expired** | The note set an `expires` date and that date has passed. | Archive it. Or remove the `expires` field if the note turned out to last. |
| **lint warnings** | Small problems at the top of a note: a missing `title`, an unknown `type`, a date in the wrong shape. | Harmless one at a time. Worth a sweep when the count climbs, because `type` and `tags` are what filtered search uses. |

### Findings are normal

A brain people use always has findings. All zeros usually means nobody is writing
to it.

**Watch the trend, not the number.** Compare the same brain a month apart:

| What is growing | What it means | What to do |
|---|---|---|
| Inbox | Your folder list is too vague for what people are actually writing. | Fix the list, not the notes. |
| Near-duplicates | AI tools are not searching before they write. | Say so in your list. Also check that capture keys can read everywhere — see [sharing with a team](./08-sharing-with-a-team.md). |
| Orphans | Nobody is adding links. | Add links. One link makes a note findable from both directions. This is the cheapest fix here. |
| Drift, all in one folder | Your AI keeps choosing a folder you never described. | Read that folder's name. It may be telling you something. |

---

## The monthly tidy-up

This is the half hour. You do not do it by hand. You ask an AI tool connected to
the brain to do it, and you approve what it suggests.

A prompt that works:

> Run a curation pass on the brain. Start with `gbrain doctor`. Read
> `content-structure.md` first and follow it. Propose every change as a list
> before making any of them — for each one: the path, what you want to do, and
> why. Do not delete anything; archive instead.

Do the work in this order. The first job is worth more than the other three put
together.

**Step 1: Rescue the good bits out of `60-sessions/`.** This is where knowledge
goes to die. Your AI logs a chat, learns something that will still be true next
year, and leaves it buried in a dated file nobody opens. Ask it to read the last
month of session logs and pull out anything still true next month. Those go to
`05-memory/`, `10-knowledge/`, `40-decisions/` or the right project, with a link
back to the session log.

**Step 2: Empty `00-inbox/`.** Each item says why it could not be filed. File it.
Then read those reasons — they are free feedback on your folder list.

**Step 3: Merge the near-duplicates.** Keep the better note. Fold in what the
other one adds. Archive the loser and leave a link.

**Step 4: Archive finished projects.** Move `20-projects/foo/` whole to
`90-archive/projects/foo/`. This is what keeps your active folders readable.

Two things make a tidy-up safe to accept:

- **It asks before it acts.** You should see the list and say yes. A run that has
  already moved forty files before telling you is one you cannot judge.
- **It lands as one commit.** Then you have one thing to undo:

```bash
cd ~/brain
git add -A && git commit -m "curation pass, September"
git revert HEAD          # if you change your mind
```

With `GIT_AUTOCOMMIT=true` a run makes a burst of commits of its own. Finish with
a single commit anyway.

---

## Drift is not always wrong

Drift means a note is in a folder your list does not mention. Your first instinct
is to move the note. Often that instinct is wrong.

If your AI files into `70-experiments/` three separate times, unprompted, it is
not misbehaving. It is telling you your list is missing a category your work
actually has.

**Ask which one is wrong: the notes, or the list?**

| What you see | What to do |
|---|---|
| One stray note in an odd folder | Move the note |
| Several notes, over weeks, in the same folder you never described | Edit `content-structure.md` to describe that folder. The drift then stops being drift. |

Describing a folder takes a paragraph: what belongs, what does not, and one real
example. See [the filing convention](./04-the-filing-convention.md).

This is the cheapest improvement in the whole system. You are reading what your
AI chose to do and writing it down, instead of guessing up front.

---

## Backup and history

Your brain is an ordinary git repository. There is no database, no export format
and no backup tool to learn.

**Backup is a push.** Make a private, empty repository somewhere, then:

```bash
cd ~/brain
git remote add origin git@github.com:you/brain.git
git push -u origin main
```

**Restore is a clone.**

```bash
git clone git@github.com:you/brain.git ~/brain
```

Push on a schedule. Or turn on `GIT_AUTOCOMMIT=true` and push at the end of the
day. Anything you have committed and pushed is safe.

### Looking at history

```bash
cd ~/brain

git log --oneline -20                                   # recent changes
git log --follow -- 10-knowledge/auth/oidc-refresh.md   # one note's whole life
git log -p -- 05-memory/build-and-test.md               # what changed, and when
```

Each commit is authored as the tool that wrote it — for example `claude-code
<claude-code@g-brain.local>`. So `git log` tells you which tool saved what. The
`@g-brain.local` part is the `GIT_AUTHOR_SUFFIX` setting, see
[configuration](./03-configuration.md).

**To get back a note someone removed:**

```bash
git log --diff-filter=D --name-only -- 20-projects/    # find the commit that removed it
git checkout <sha>~1 -- 20-projects/old-thing/notes.md # bring it back
```

### Deleting does not destroy

When your AI deletes a note, the note moves to `90-archive/` instead. It keeps
the shape of its old path: `20-projects/foo/notes.md` becomes
`90-archive/projects/foo/notes.md`.

Search pushes archived notes down the results, so they stay findable without
getting in the way. Nothing is lost. And only a curator key is allowed to write
to the archive at all.

---

## The search index

The search index is what makes search fast. It is built from your markdown files,
so you can delete it and nothing is lost.

```bash
gbrain index
```

```
Indexed 214 documents in 412ms.
The index is derived — deleting it loses nothing.
```

It lives under `.brain/`, and `.brain/` is gitignored. So it is never committed,
never pushed and never part of a backup.

Rebuild it when:

- Search finds nothing, and you know the note is there.
- Search finds a note you deleted or moved.
- You edited files in a text editor rather than through your AI tool.
- You have just cloned the brain onto a new machine.

If in doubt, run it. It takes about a second on a few hundred notes and it cannot
lose anything.

---

## A routine that works

| When | Do |
|---|---|
| Whenever you think of it | `gbrain doctor` — ten seconds, changes nothing |
| Monthly | The tidy-up, in the order above |
| Monthly | `git push` to your private repository |
| When your AI keeps drifting to the same folder | Edit your folder list, not the notes |

## Where to go next

| | |
|---|---|
| [The filing convention](./04-the-filing-convention.md) | The file that decides everything |
| [Daily use](./05-daily-use.md) | How to save notes and find them again |
| [Troubleshooting](./07-troubleshooting.md) | When something is actually wrong |
| [Sharing with a team](./08-sharing-with-a-team.md) | One brain, several people |
