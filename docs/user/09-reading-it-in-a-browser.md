---
title: Reading it in a browser
description: Run the web page that lists your projects and lets you walk through them, and know what it will and will not do.
---

# Reading it in a browser

There is a web page that shows your projects, lets you click into one, and walk
its folders and notes. It is for reading. **It cannot change anything.**

You do not need it. Your brain is a folder of markdown files, so your git host,
VS Code, and Obsidian already open and search it. The page exists for one thing
those cannot do: open at *the projects you are allowed to see*.

## Starting it

From the g-brain source folder:

```bash
pnpm install
pnpm dev
```

It prints the address to open — usually **http://localhost:3000**, but it moves
to the next free port if something else already has that one, so read the line
it prints rather than assuming.

`pnpm dev` builds the pieces the page depends on first, so it works from a fresh
clone. If you skip it and start the page directly, you will get type errors that
look like bugs in the page and are really a stale build.

For something long-running rather than a dev session:

```bash
pnpm build
pnpm --filter g-brain-web start
```

It reads whatever `BRAIN_ROOT` points at, the same as everything else. To point
it somewhere other than `~/brain`, set `BRAIN_ROOT` before starting it.

## What you get

| Page | What it shows |
|---|---|
| The front page | Every project you can read, with how many notes each holds |
| A project | That project's real folder tree, and its notes |
| A note | The note, with its title, tags and dates pulled out at the top |
| A note, **Markdown** | The same file exactly as it is on disk, frontmatter and all |
| Search | The same results your AI tool gets, in the same order |

A project is a folder inside your projects folder — `20-projects/` unless you
changed `PROJECTS_FOLDER`. If a project's `README.md` lists repositories, they
appear on its card, linked to GitHub where the name is written as `owner/repo`.

**The tree shows what is actually on disk**, including folders your folder list
never mentions. It is not a tidied-up version of your brain.

## Preview and Markdown

Every note has two buttons at the top right.

**Preview** is the default: headings, lists, tables and code blocks rendered the
way you would expect. Links written as `[[folder/note.md]]` — the style your AI
tools use — become links you can click.

**Markdown** shows the file exactly as it sits on disk, frontmatter included. It
is the view to use when you want to copy a note somewhere, or check what was
actually written rather than how it looks.

The choice is in the address, as `view=markdown`, so a link you send someone
opens the way you left it.

If a note contains HTML, you will see the HTML as text rather than as a heading
or an image. That is on purpose: notes are written by AI tools, and a page that
ran whatever HTML they wrote would be a way to attack whoever opens it.

## It only reads

No creating, editing, renaming, moving or deleting. Notes are written by your AI
tools, and that has not changed.

This is deliberate, not unfinished. A page that could edit notes would need to
answer what happens when two people edit at once, and that is a much bigger
piece of software than a page that shows you what is there.

## Keys, and the part that will annoy you

On your own machine, leave the key settings alone. The page runs as a local
reader and shows you everything.

If you set `AUTH_REQUIRED` to `true`, every page needs a key:

```bash
gbrain key browser --profile recall
```

`recall` is the right shape here — it reads everywhere and can write nothing.

**Here is the catch: a browser cannot send that key.** A key travels in a header,
and a browser typing a URL into the address bar has no way to attach one. You
will get `UNAUTHORIZED` on every page. A command-line tool can send the header
and works fine; your browser cannot.

So today there are two honest options:

- **On your own machine:** leave `AUTH_REQUIRED` alone. It is already off unless
  you turned it on.
- **On a shared machine:** put something in front of the page that logs people in
  and adds the header for them, and let that handle HTTPS too. A key sent over
  plain `http://` is readable by anything on the network.

How the page itself should ask for a key has not been decided yet. It is a small
decision and an easy one to get wrong, so it is being left open rather than
guessed at.

## Who sees what

The page shows you exactly what your key is allowed to read, and nothing else.

**A project you cannot read is simply not listed.** It is not greyed out, and
there is no "2 projects hidden" note. Showing you the names of things you cannot
open would tell you how the brain is laid out, which is the thing being kept
back.

If you follow a link straight to a note you are not allowed to read, you get
`FORBIDDEN`. That tells you your key does not reach there. It does not tell you
whether a note exists at that path.

Access is per **key**, not per person. Two people sharing a key are the same
person as far as the brain is concerned, and taking one person's access away
means replacing a key that others may also be holding. That is fine for a few
people and stops being fine beyond that — see
[sharing with a team](./08-sharing-with-a-team.md).

## If something looks wrong

- **`UNAUTHORIZED` on every page** — `AUTH_REQUIRED` is on and your browser
  cannot send a key. See above.
- **No projects listed** — either your key cannot read any, or your projects
  folder is named something else. Check `PROJECTS_FOLDER`.
- **Search finds nothing** — the index builds when the server starts. Give it a
  moment, or run `gbrain index` to rebuild it.
- **Anything else** — add `/health` to the address it printed. It names the brain
  the page is actually reading, which answers most "why is it empty" questions in
  one look.

More in [troubleshooting](./07-troubleshooting.md).
