---
title: Configuration
description: Every setting g-brain reads, where to put it, and the four most people actually change.
---

# Configuration

All settings are environment variables. An environment variable is a named value
you hand to a program when it starts. That is the whole mechanism.

There is no settings file to learn. g-brain reads the environment once when it
starts up and checks every value. If one is wrong, it refuses to start and tells
you which variable it was and what it expected. Nothing is re-read while it is
running, so changing a setting means restarting.

Everything has a default. A brain with no settings at all works fine.

---

## Where to put settings

**In your AI tool**, in the `env` block next to the command. This is the normal
place, because your AI tool is what starts the server:

```json
{
  "mcpServers": {
    "g-brain": {
      "command": "npx",
      "args": ["-y", "g-brain-mcp"],
      "env": {
        "BRAIN_ROOT": "/home/you/brain",
        "GIT_AUTOCOMMIT": "true"
      }
    }
  }
}
```

**In your shell profile**, for when you type `gbrain` yourself. The command
reads the same settings, and it cannot see your AI tool's `env` block:

```bash
export BRAIN_ROOT="$HOME/brain"
```

**In a `.env` file, or the container's settings**, for a server. The repository
comes with [`.env.example`](../../.env.example). It lists every variable, its
default, and what it costs you.

Set the same variable in two places and there is no merge. Whichever settings a
program was handed are the ones it uses.

---

## Every setting

| Variable | Default | What it does |
|---|---|---|
| `BRAIN_ROOT` | `~/brain` | Where your notes live. Measured from your home folder, never from the folder you are in. |
| `GIT_AUTOCOMMIT` | `false` | Commit to git every time a note is saved. |
| `GIT_AUTHOR_SUFFIX` | `@g-brain.local` | Commits are signed `agent-name <agent-name@g-brain.local>`, so `git log` shows which AI tool wrote what. |
| `GIT_DEBOUNCE_MS` | `2000` | How long to wait after the last save before making one commit for the whole batch. |
| `MCP_TRANSPORT` | `stdio` | `stdio` when your AI tool starts the server itself. `http` when the brain is on another machine or shared. |
| `MCP_HTTP_PORT` | `8787` | The port used by `http`. Ignored on `stdio`. |
| `AUTH_REQUIRED` | `true` on http, `false` on stdio | Whether a request must carry a key. |
| `MAX_DOC_BYTES` | `262144` | 256 kB. Anything bigger is a bug or a dumped log file, not a note. |
| `RATE_LIMIT_PER_MINUTE` | `120` | How many requests one key may make per minute. This guards against an AI tool stuck in a loop, not against an attacker. |
| `DUPLICATE_THRESHOLD` | `0.9` | How close a new note has to be to an existing one before it is refused for being nearly the same. |
| `AUDIT_MAX_BYTES` | `8388608` | 8 MiB, then the activity log is renamed and a fresh one started. It is never trimmed. |
| `AUDIT_KEEP` | `8` | How many old activity logs to keep. |
| `SEARCH_MODE` | `lexical` | How search works. `lexical` means plain word matching, and it is the only choice today. |
| `SESSION_EXPIRY_DAYS` | `90` | How old a session note may get before `gbrain doctor` lists it as expired. Expiring moves a note to `90-archive/`. It never deletes it. |

---

## The four most people change

Everything above has a sensible default. These four are worth thinking about.

### `BRAIN_ROOT`

**Change it when** you want your notes somewhere other than `~/brain`. A synced
folder, a second drive, a shared path on a server.

**It costs you** nothing, as long as the path is not inside a code project
folder. That one mistake really hurts, so it has its own section below.

In your AI tool's `env` block, write the path out in full, starting from the top
of the drive. Your AI tool starts the server from whatever folder it happens to
be in. And not every tool turns `~` into your home folder first.

### `GIT_AUTOCOMMIT`

**Change it when** you trust the brain enough to want a commit for every note
saved. That is what makes `brain_history` and `git log` worth reading.

**It costs you** a busier git history, and a git operation every time a note is
saved. Notes get saved either way. A git failure never stops a note being
saved. So if this is on and something is wrong with the repository, your notes
still land and the commits quietly do not happen. Run `git status` in your brain
folder if the history looks thin.

Turn it **off** before importing a lot of notes at once. A hundred notes would
otherwise mean a hundred commits. Import first, then commit once:

```bash
cd ~/brain
git add -A && git commit -m "imported the old wiki"
```

Notes saved within `GIT_DEBOUNCE_MS` of each other share one commit. So a burst
from a single AI turn does not make five separate commits.

### `MCP_TRANSPORT`

**Change it when** the brain is not on the same machine as your AI tool. A
shared team brain, a CI machine, a server.

**It costs you** key management. On `http`, `AUTH_REQUIRED` is `true` by
default. Every request then has to carry a key, and you make one key per AI
tool:

```bash
gbrain key ci-runner --profile capture
```

```
Key created — capture profile

  gbk_7f2a9c14e8b3d05a6912fe4470c8bd31

Only the hash is stored, so this is the one time you will see it.
Send it as: Authorization: Bearer <key>
```

g-brain only keeps a scrambled copy of the key, so a lost key is replaced, never
recovered. Run `gbrain key --list` to see which keys exist.

There are three kinds of key:

| Profile | What it can do |
|---|---|
| `capture` | Save notes to the everyday folders, and read everything |
| `recall` | Read only. It cannot save anything |
| `curator` | The only one allowed to write to `90-archive/` |

`GET /health` answers without a key. So a load balancer or a container health
check needs no key at all. Every other address needs one.

Leave this on `stdio` for a tool on your own machine. On `stdio` the server is
just a program your AI tool started, which is why it is trusted by default.
[Sharing with a team](./08-sharing-with-a-team.md) covers the rest.

### `DUPLICATE_THRESHOLD`

A near-duplicate is a note that is nearly the same as one you already have.
g-brain refuses to save one.

**Change it when** your brain is filling with near-identical notes and you want
more of them caught. Or when it is refusing notes that are not really
duplicates, and you want fewer caught.

**It costs you** lost notes, in one direction only. Lowering the number makes
the check *stricter*. At `0.7`, two genuinely different notes on the same
subject start to look alike, and the second one is refused. A refused note is
gone for good. A duplicate is only untidy, and `gbrain doctor` will list it for
you to merge. Raising the number is the cheap direction. Lowering it is the
expensive one.

If duplicates are your problem, the better fix is usually your folder list, not
this number. An AI tool that searches before it writes does not make duplicates
in the first place. See
[the filing convention](./04-the-filing-convention.md).

---

## `BRAIN_ROOT` must not be inside a code project

This is the one setting that can do real damage, so g-brain refuses it.

If `BRAIN_ROOT` points anywhere inside another git repository, the server will
not start:

```
error BRAIN_ROOT resolves inside another git repository.
  BRAIN_ROOT : /home/you/work/api/notes
  repo root  : /home/you/work/api
With GIT_AUTOCOMMIT on, an agent's captures would be committed into the
working tree at /home/you/work/api.
Set BRAIN_ROOT to a directory that is its own repo, for example ~/brain.
```

Here is why. With `GIT_AUTOCOMMIT` on, every note your AI tool takes would be
committed into *that project's* repository. Session logs in your pull requests.
Half-formed decisions on the release branch. Private notes pushed to a remote
your whole team can read. Nobody wants that, and by the time you notice it is
already in the history.

The rule is simple. A brain is its own git repository, or it is nothing.
`~/brain` is fine. `~/notes/brain` is fine. Anywhere inside a code project is
not, even with `GIT_AUTOCOMMIT` off, because somebody will turn it on later.

---

## A worked example

Here is a setup on one machine, using the everyday `stdio` setting, with four
things changed:

- notes kept outside the home folder
- a commit every time a note is saved
- a longer wait before committing, so a chatty AI tool makes fewer commits
- session notes that expire after a month instead of three

```json
{
  "mcpServers": {
    "g-brain": {
      "command": "npx",
      "args": ["-y", "g-brain-mcp"],
      "env": {
        "BRAIN_ROOT": "/home/you/work-notes/brain",
        "GIT_AUTOCOMMIT": "true",
        "GIT_DEBOUNCE_MS": "5000",
        "SESSION_EXPIRY_DAYS": "30"
      }
    }
  }
}
```

Restart your AI tool. Then check the server is reading the brain you meant:

```bash
BRAIN_ROOT=/home/you/work-notes/brain gbrain doctor
```

The first line of the report is the folder it is actually using. If that is not
the path you expected, your setting is not reaching the program.

---

## Where to go next

| | |
|---|---|
| [The filing convention](./04-the-filing-convention.md) | Your folder list, the thing that decides where notes go |
| [Daily use](./05-daily-use.md) | Saving and finding notes, day to day |
| [Sharing with a team](./08-sharing-with-a-team.md) | Network access, keys and profiles in full |
| [Troubleshooting](./07-troubleshooting.md) | When a setting does not seem to apply |
