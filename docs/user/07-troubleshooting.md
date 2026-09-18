---
title: Troubleshooting
description: Symptoms, what causes them, and what to do — including the ones that are not faults.
---

# Troubleshooting

Find your symptom below.

Some of these are not faults. A refused note and a vague folder list both look
like failures. They are really the system telling you something. Those are
marked.

| What you see | Jump to |
|---|---|
| No `brain_` tools in your AI tool | [Your AI tool does not show the brain tools](#your-ai-tool-does-not-show-the-brain-tools) |
| "BRAIN_ROOT resolves inside another git repository" | [that error](#brain_root-resolves-inside-another-git-repository) |
| It keeps asking you where to put things | [here](#your-ai-keeps-asking-where-to-put-things) |
| It keeps using the wrong folder | [here](#your-ai-files-things-in-the-wrong-folder-over-and-over) |
| A note was refused for a password or key | [UNSAFE_CONTENT](#a-note-was-refused-for-a-password-or-key) |
| A note was refused as a near-duplicate | [here](#a-note-was-refused-as-a-near-duplicate) |
| A note was refused asking for `ifMatch` | [here](#a-note-was-refused-asking-for-ifmatch) |
| Search finds nothing, or old results | [here](#search-finds-nothing-or-shows-old-results) |
| No commits are appearing | [here](#no-commits-are-appearing) |
| Git conflicts after cloning to two machines | [here](#git-conflicts-after-cloning-the-brain-to-two-machines) |
| It is getting slow | [here](#the-brain-is-getting-large-or-slow) |

---

## Your AI tool does not show the brain tools

**What you see.** You set up the connection, but your AI has no `brain_` tools.
It answers from memory instead of searching.

**Why.** Almost always one of three things. The tool was not restarted. The JSON
you pasted is broken. Or the path is wrong.

**Fix it in this order.**

**Step 1: Restart the tool completely.** Most AI tools read their settings once,
at startup. Closing the window is not always enough — quit the whole application.

**Step 2: Check the JSON is valid.** A stray comma, or a Windows backslash that
is not escaped, silently drops the whole block. Paste it into any JSON validator.

**Step 3: Check the path is real and starts from the root of your disk.**

```bash
ls ~/brain/content-structure.md
```

If that file is not there, your brain is somewhere else, or it was never made.

**Step 4: Check the server starts on its own.**

```bash
BRAIN_ROOT=~/brain npx -y gbrain-mcp
```

It should sit there quietly and wait. If you get an error here, that is the real
problem. Your AI tool would have hidden it from you.

Once it works you will see ten tools: `brain_structure`, `brain_read`,
`brain_list`, `brain_tree`, `brain_links`, `brain_write`, `brain_append`,
`brain_search`, `brain_history`, `brain_delete`.

---

## "BRAIN_ROOT resolves inside another git repository"

**What you see.** `gbrain init` or the server refuses to start:

```
error BRAIN_ROOT resolves inside another git repository.
  BRAIN_ROOT : /home/you/work/api/brain
  repo root  : /home/you/work/api
With GIT_AUTOCOMMIT on, an agent's captures would be committed into the working tree at /home/you/work/api.
Set BRAIN_ROOT to a directory that is its own repo, for example ~/brain.
```

**Why.** Your brain would live inside one of your code projects.
`BRAIN_ROOT` is the setting that says where your brain lives.

**This is not a fault. It is protecting you.** Your brain commits to itself.
Inside a code project, your AI's notes would land in that project. They would
show up in every `git status`, sneak into pull requests, and eventually get
pushed to a repository whose readers never asked for them.

**Fix.** Put the brain outside every code project.

```bash
npx gbrain init ~/brain
```

One brain serves every project you work on. See
[one brain, many projects](./08-sharing-with-a-team.md#one-brain-many-projects).
There is no good reason to want one inside a code project.

---

## Your AI keeps asking where to put things

**What you see.** Instead of just filing a note, your AI asks "should this go in
knowledge or decisions?". Or it keeps writing to `00-inbox/`, and `gbrain doctor`
shows the inbox growing.

**Why.** Your folder list is too vague for what you are actually writing. Your
folder list is the file `content-structure.md`.

**This is not a fault.** Your AI did the right thing. Guessing wrong buries a
note where nobody will look, so it asked you instead.

**Fix.** Read the reasons. Each inbox item carries one:

```bash
gbrain doctor
```

```
Inbox — each with the reason the agent could not place it
  00-inbox/vendor-call-notes.md
    Spans billing and procurement — needs a human to split it
  00-inbox/rate-limit-numbers.md
    Could not tell which project this belongs to
```

Those reasons name the gap. Open `~/brain/content-structure.md` and sharpen the
folder descriptions they point at. Write in plain English and give a real
example. Or ask your AI to do it:

> Read `content-structure.md` and the last ten inbox items with their reasons.
> Propose edits to the folder sections that would have let you place them.

See [the filing convention](./04-the-filing-convention.md).

---

## Your AI files things in the wrong folder, over and over

**What you see.** The same kind of note keeps landing in the wrong place. Meeting
notes in `10-knowledge/`. Configuration facts in `40-decisions/`.

**Why.** Same cause as above, wearing a different hat. Two folder descriptions
overlap. Both look correct, so your AI picks either one.

**Fix.** Do not move the files first. Sharpen the two folder descriptions, then
move them.

A folder description that only says what belongs will be used too often. The line
that actually decides is the one saying what does *not* belong, and where it goes
instead:

```markdown
**Does not belong here:** a statement about how the system is configured
today — that is `10-knowledge/`, even when it contains the word "because".
A decision records a moment of choosing: there were options, one was taken.
If you cannot name the option that was rejected, it is knowledge.
```

One good pair of exclusions fixes a whole class of misfiling for good. Adding
more rules on top does not.

---

## A note was refused for a password or key

**What you see.**

```
Possible credential in the body: aws-access-key on line 14. Nothing was written.
Remove the credential — do not obfuscate it — and reconsider whether this
belongs in a shared brain.
```

**Why.** The text looked like it held a key, a token, a password or a connection
string. This check runs before anything is written to disk.

**Fix.** Take the secret out. Write what a reader actually needs instead: "the
runner authenticates with the deploy key from 1Password, item *ci-deploy*".

**Do not disguise the secret to get past the check.** Masking a few characters or
splitting a token across two lines might fool the checker. It still puts a secret
into a shared repository that gets committed and pushed. Once a secret is in git
history, taking it out means rewriting that history on every copy.

The refusal is recorded in `.brain/audit.jsonl`, with the rule that matched and
the line number. The secret value itself is never recorded. That log line is the
only trace, because a refused note makes no commit.

False alarms do happen. A long random-looking string in an example can trip the
checker. Rewrite the example with an obviously fake value.

---

## A note was refused as a near-duplicate

**What you see.**

```
This is 94% similar to 10-knowledge/auth/token-refresh.md. Append to that
document instead, or retry with force true if it really is a separate capture.
```

**Why.** The new note is nearly the same as a note you already have. "Nearly the
same" means at least as similar as `DUPLICATE_THRESHOLD`, which is 0.9 by
default. This check only runs when a note is created. Adding to an existing note
is never a duplicate of it.

**Fix.** Read the note it named. Then pick one:

| Option | When it is right |
|---|---|
| **Add to it** | Usually. One good note beats two overlapping ones, and adding to a note needs no extra steps. |
| **Improve it** | When your new version is better. Replace it and keep the same path, so every existing link keeps working. |
| **Force it** | When it really is a separate note that just reads similarly. Ask your AI to retry with `force`. That skips the duplicate check and nothing else — every other safety check still runs. |

If this happens constantly, your AI tools are not searching before they write.
Say so in your folder list. Also check that capture keys can read everywhere — a
key that cannot read cannot check for duplicates.

---

## A note was refused asking for ifMatch

**What you see.**

```
20-projects/billing/status.md already exists. Read it first and retry with its
etag as ifMatch, or use append if you are only adding to it.
```

Or, after it has read the note:

```
20-projects/billing/status.md changed since you read it. Read it again, merge
your changes into the current body, and retry with ifMatch a1b2c3d4.
```

**Why.** There is already a note at that path. g-brain checks that nobody else
changed the note while your AI was working on it. It will not let a blind write
replace a note it has not read. That is how a week of somebody's notes disappears
in a single call.

**Fix.** Nothing to set up. Just tell your AI what you want:

| Say this | What happens |
|---|---|
| "Add to it" | Your AI adds to the end. It cannot wipe anything out. Right most of the time. |
| "Read it first, then rewrite it" | Your AI reads the note, then replaces it safely. |

The second message means someone else saved that note in between. Merging by hand
is on purpose: your changes and theirs both matter.

---

## Search finds nothing, or shows old results

**What you see.** You know a note exists, but `gbrain search` does not find it.
Or it finds something you deleted.

**Why.** The search index is out of date. The index is what makes search fast. It
is built from your markdown files, so you can delete it and nothing is lost.

This happens most after you edit files in a text editor, after a `git pull`, or
after a fresh clone.

**Fix.**

```bash
cd ~/brain
gbrain index
```

```
Indexed 214 documents in 412ms.
The index is derived — deleting it loses nothing.
```

The index lives under `.brain/`, which is gitignored. **You can delete it at any
time.** You lose nothing but the second it takes to rebuild.

If a rebuild still does not find the note, check the note is really there:

```bash
grep -ril "the phrase you expect" ~/brain
```

---

## No commits are appearing

**What you see.** Your AI is writing, files are changing, and `git log` shows
nothing new.

**Why.** `GIT_AUTOCOMMIT` is off by default. Writing to a git repository is
something you should choose, not have chosen for you.

**Fix.** Either commit yourself:

```bash
cd ~/brain
git add -A && git commit -m "this week's captures"
```

Or turn autocommit on, in the `env` block of your AI tool's settings:

```json
"env": { "BRAIN_ROOT": "/home/you/brain", "GIT_AUTOCOMMIT": "true" }
```

Restart the tool. Commits then arrive in bursts. `GIT_DEBOUNCE_MS` waits 2
seconds after the last write, so one commit covers a burst instead of one commit
per file.

**If it is still silent with autocommit on,** check git is installed:

```bash
git --version
cd ~/brain && git status
```

`gbrain init` prints `git repository  no (git not found)` when git was missing at
the time you made the brain. Notes still get saved in that state — a git failure
never stops a note being saved — you just get no history. Install git, then run
`git init` inside the brain.

In Docker, the usual cause is *detected dubious ownership*. Git refuses to work
on a folder owned by a different user. Fix it with
`git config --global --add safe.directory /brain`, or run the container as the
owning user.

---

## Git conflicts after cloning the brain to two machines

**What you see.** You cloned the brain onto a laptop and a desktop. Both wrote
notes. Now `git pull` gives you conflicts full of `<<<<<<<` markers.

**Why.** Two copies of one repository drifted apart. g-brain does not sync. There
is nothing clever going on, and nothing has gone wrong.

**Fix it now.** These are ordinary markdown conflicts. Open the files, keep both
sides where both are true, then commit:

```bash
cd ~/brain
git pull --no-rebase
# edit the conflicted files
git add -A && git commit
```

**Fix it properly.** Stop cloning. Run **one** brain over HTTP and point every
machine at it. There is nothing to sync because there is one copy. See
[sharing with a team](./08-sharing-with-a-team.md).

Cloning is fine for one person on several machines, if you treat it like any
repository: pull before you start, push when you stop. The moment two machines
write without pulling, you are back here.

---

## The brain is getting large or slow

**What you see.** `gbrain index` takes a while. Search feels sluggish.

**Why.** Real limits. g-brain reads markdown from disk and builds its index in
memory. That is fast and simple, and it does not scale forever.

| How many notes | What to expect |
|---|---|
| Hundreds | Instant. Everything is under a second. |
| A few thousand | Fine. Indexing takes seconds, search stays fast. |
| Ten thousand and up | It works, and you will feel it. Indexing and startup grow with the count. |

**Fix.** Before you decide you have outgrown it, check you have not simply
stopped archiving:

```bash
gbrain doctor
du -sh ~/brain/*/
```

Finished projects belong in `90-archive/`. Session logs older than
`SESSION_EXPIRY_DAYS` (90 days by default) are reported as expired for exactly
this reason. A tidy-up usually frees more than any setting will — see
[maintenance](./06-maintenance.md).

If your notes really are huge, check `MAX_DOC_BYTES` (256 kB). A note near that
size is usually a dumped log.

---

## Reporting a problem

If nothing above fits, send these four things. Without them the answer is always
"what did it say?".

**1. The exact command you ran, and the exact output.** All of it, not a summary.
The error messages here name the path and the fix.

**2. Your versions.**

```bash
npx gbrain --version
node --version
git --version
```

**3. The doctor report.** It describes the shape of your brain without showing
what is in it:

```bash
gbrain doctor --json
```

**4. The relevant audit lines.** Every refusal is recorded here, and this is the
only trace a refused note leaves:

```bash
tail -20 ~/brain/.brain/audit.jsonl
```

Read those lines before you send them. They hold file paths, tool names and rule
names. They never hold secret values — those are blanked out the moment they are
spotted. But paths in a private brain may still be something you would rather not
share. Black out what you need to. Keep the error codes and rule names, because
those are the part that identifies the problem.

## Where to go next

| | |
|---|---|
| [Configuration](./03-configuration.md) | Every setting and when to change it |
| [The filing convention](./04-the-filing-convention.md) | The fix for most "wrong folder" problems |
| [Maintenance](./06-maintenance.md) | Doctor, tidying up, backups |
| [Sharing with a team](./08-sharing-with-a-team.md) | Hosting one brain instead of cloning it |
