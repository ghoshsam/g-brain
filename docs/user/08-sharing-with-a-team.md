---
title: Sharing a brain with a team
description: Host one brain over HTTP, hand out narrow keys, and keep one installation across every repository.
---

# Sharing a brain with a team

A brain gets more useful the more people write to it. That is the point. What one
person's AI worked out on Friday, another person's AI knows on Monday.

There are two ways to share one. This choice matters more than anything else on
this page.

---

## Choose one: hosted, or cloned

| | **One hosted brain** | **A cloned brain** |
|---|---|---|
| What it is | One copy on a server. Everyone connects to it over the network. | Each machine has its own copy of the git repository. |
| Keeping copies in step | Nothing to do. There is one copy. | `git pull` and `git push`, by hand. |
| Permissions | Per key. Three levels. | None. Whoever has a copy has everything. |
| Right for | A team. Two or more people writing. | One person with more than one machine. |
| What goes wrong | Nothing to sync, so nothing to clash. | Two machines write without pulling first. |

**Do not mix them.** Several machines writing to copies of one repository is
exactly where merge conflicts come from. There is no clever fix — they are
ordinary markdown conflicts you sort out by hand, forever. If more than one
person writes, host it.

Cloning is fine for one person with a laptop and a desktop. Treat it like any
repository: pull before you start, push when you stop.

The rest of this page is about hosting.

---

## Hosting one

### Step 1: Put the brain on the server

Make a new one, or clone the one you have:

```bash
git clone git@github.com:you/brain.git /srv/brain
```

Anywhere outside a code project is fine. `/srv/brain` is just a habit.

### Step 2: Start the server so it listens on the network

The server is the `gbrain-mcp` package. Tell it to listen on HTTP and start it:

```bash
BRAIN_ROOT=/srv/brain \
MCP_TRANSPORT=http \
MCP_HTTP_PORT=8787 \
GIT_AUTOCOMMIT=true \
npx -y gbrain-mcp
```

```
g-brain listening on http://localhost:8787/mcp
```

If you forget that command, `gbrain serve` prints the same thing.

Three settings matter here:

| Setting | Set it to | Why |
|---|---|---|
| `MCP_TRANSPORT` | `http` | Makes the server listen on the network instead of talking to one local tool. |
| `GIT_AUTOCOMMIT` | `true` | Every note becomes its own commit, authored by the tool that wrote it. `git log` then answers "who wrote this, and when" without anyone remembering to commit. |
| `AUTH_REQUIRED` | leave it alone | It is already `true` on HTTP. Keep it that way. With a local tool, your computer already controls who is on the other end. Over a network, nobody does. |

### Or run the Docker image

```bash
docker run -d --name brain \
  -v /srv/brain:/brain \
  -p 8787:8787 \
  -e MCP_TRANSPORT=http \
  -e GIT_AUTOCOMMIT=true \
  ghcr.io/you/gbrain:latest
```

**Always mount the brain as a volume. Never build it into the image.** Content
inside an image vanishes on the next deploy. It is invisible to `git push`, and
you cannot open it in a text editor.

Two things bite in containers:

| Problem | What you see | Fix |
|---|---|---|
| Folder ownership | Every commit fails with *detected dubious ownership*, while notes keep saving fine. A git failure never stops a note being saved. | `git config --global --add safe.directory /brain`, or run the container as the user who owns the folder. |
| Who authored the commit | Nothing. This one is already handled. | Nothing to do. Each commit gets its author from the AI tool that made it, so no global `user.name` is needed. |

### Step 3: Make a key for each person and each tool

```bash
cd /srv/brain
gbrain key alice-laptop --profile capture
```

```
Key created — capture profile

  gb_live_8f2a91c4d7e60b35a8f1c209e4b7d6a3

Only the hash is stored, so this is the one time you will see it.
Send it as: Authorization: Bearer <key>
```

**You only see a key once.** g-brain keeps a scrambled version, not the key
itself. A lost key cannot be recovered. You issue a new one and stop using the
old.

A key is not a person. Give one per person *per tool*, and name it so you can
tell them apart: `alice-laptop`, `alice-ci`, `nightly-curator`. Then switching
one off does not break everything else.

```bash
gbrain key --list
```

```
k_7c31a0  alice-laptop
k_9e44b2  alice-ci
k_2d81f5  nightly-curator
```

---

## The three key profiles

| Profile | Can read | Can write to | Use it for |
|---|---|---|---|
| **capture** | Everything | `00-inbox`, `05-memory`, `10-knowledge`, `20-projects`, `40-decisions`, `60-sessions` | The normal one. Everyday coding tools. |
| **recall** | Everything | Nothing | Read-only tools: research, review, anything you have not checked. |
| **curator** | Everything | Everything, including `90-archive` | Monthly tidy-ups. The only profile allowed to archive. |

Two things in that table are deliberate.

**Capture can read everywhere, including the archive.** A key that could only
read what it can write would create a copy every time the original was filed
somewhere else. Searching before writing only works if search can see the whole
brain.

**Only curator can write to `90-archive/`.** Deleting a note moves it to the
archive rather than destroying it. So a delete is really a write to the archive.
Which means a tool holding a capture key simply cannot remove a note, and every
archived note traces back to a tidy-up run.

### Why narrow keys are the default

A research tool with a `recall` key **cannot write**. Not "should not" — cannot.
A bad instruction hidden in a web page it reads, a confused loop, a mistake: none
of it can touch your brain, because the permission is not on the key.

That removes a whole class of accident instead of guarding against it. Give
`capture` by default. Give `recall` to anything that only needs to read. Give
`curator` to one named maintenance job — not to people because it is easier.

---

## Connecting an AI tool over the network

Each person adds this to their AI tool's settings, using their own key:

```json
{
  "mcpServers": {
    "g-brain": {
      "type": "http",
      "url": "https://brain.internal:8787/mcp",
      "headers": { "Authorization": "Bearer gb_live_8f2a91c4d7e60b35a8f1c209e4b7d6a3" }
    }
  }
}
```

Restart the tool. The same ten `brain_` tools appear. Nothing else about daily
use changes — see [daily use](./05-daily-use.md).

**Put HTTPS in front of the server.** A key sent over plain HTTP is a key anyone
on the network can read. A reverse proxy is the normal way to do this.

The key belongs in the tool's settings file, never in a code repository. If one
does end up committed somewhere, issue a new key and stop using the old one.

---

## Health checks

`GET /health` is the only address that answers without a key. A deployment check
should not need a password to ask whether the process is alive. It only reports;
it never returns an error.

```bash
curl http://brain.internal:8787/health
```

```json
{
  "status": "ok",
  "brainRoot": "/srv/brain",
  "documents": 386,
  "index": { "builtAt": "2026-09-18T09:02:11Z", "stale": false },
  "autocommit": true
}
```

| Field | What it tells you |
|---|---|
| `status` | The server is up and answering. |
| `brainRoot` | Which brain this server is serving. Worth checking after a deploy that changed a mount. |
| `documents` | How many notes the search index holds. A sudden drop means a mount is wrong. |
| `index.stale` | The index is behind the files on disk. Run `gbrain index`. |
| `autocommit` | Whether notes are being committed. `false` on a shared brain is usually a mistake. |

Everything else is at `/mcp` and needs a key. There is no third address.

---

## What this does not give you

Be clear about this before you put anything sensitive in a shared brain.

- **Everyone who can open the brain can read all of it.** Every profile reads
  everywhere. There is no way to give someone read access to only part of it.
- **There are no per-note permissions.** Permissions are per folder, and only for
  writing.
- **The git repository has no permissions at all.** Anyone who can clone it has
  everything, whatever key they hold on the network.
- **The audit log is a record for you, not evidence.** It is a plain text file,
  and anyone with access to the server can edit it.

**If some content must be hidden from some readers, run a second brain.** That is
the answer, and it is not a workaround. Two brains, with two folder lists and two
sets of keys, is a clean boundary anyone can understand. Trying to hide a folder
inside one brain is not.

Your folder list already says it: no passwords, no personal data, nothing you
would not say to someone's face in a public standup. On a shared brain that is
not advice. That is the security model.

---

## One brain, many projects

A common instinct is to make one brain per code repository. **Do not.**

That rebuilds the exact problem g-brain exists to solve. Knowledge gets trapped
in whichever repository produced it, invisible to the AI working next door. The
decision about retries made in the API repository is the one the worker
repository needs. A brain per repository guarantees it never gets there.

**One brain serves every repository the team works in.** Inside the brain, a
project is a *piece of work*, not a repository:

- One project often spans several repositories. `20-projects/billing-migration/`
  covers the API, the worker and the dashboard.
- Some projects have no code at all: a vendor evaluation, a launch, a migration.
- Some repositories carry several projects at once.

So name a project folder after the work, never after the repository you happen to
be sitting in. Reuse an existing project folder instead of making a new one just
because you opened a different directory. List the repositories a project touches
in its `README.md` — that is background about the project, not its name.

Knowledge that will outlive the project does not go in the project folder at all.
It goes in `10-knowledge/`, with a link from the project. That single habit is
what stops a shared brain becoming a graveyard of dead project folders.

---

## A shared brain needs an owner

One named person. They run the monthly tidy-up, read `gbrain doctor`, and edit
the folder list when the inbox tells them to. Not a rota. Not everybody.

A shared brain goes stale faster than a personal one. More tools write to it, and
nobody feels responsible for the whole thing. See
[maintenance](./06-maintenance.md).

## Where to go next

| | |
|---|---|
| [Configuration](./03-configuration.md) | Every setting and when to change it |
| [The filing convention](./04-the-filing-convention.md) | Everyone shares it, so it is worth agreeing on |
| [Maintenance](./06-maintenance.md) | Doctor, tidy-ups, backups |
| [Troubleshooting](./07-troubleshooting.md) | Connection problems and refused notes |
