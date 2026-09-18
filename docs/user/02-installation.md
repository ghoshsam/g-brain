---
title: Installation
description: The three ways to install g-brain, how to connect it to Claude Code, Cursor and anything else, and how to upgrade or remove it.
---

# Installation

There are three ways to run g-brain. Most people use the first one and never
read the rest of this page.

**You need:** Node.js 20 or newer, and git.

Check both:

```bash
node --version
git --version
```

---

## Why you need git

g-brain has no database. Git is the history.

Every note is a markdown file in a git repository. Git gives you what a database
would have to: what changed, when, and which AI tool did it. Running `git log`
on one file shows that note's whole life. Push the repository somewhere private
and that is your backup. There is no export step, because there is nothing to
export.

If git is missing, `npx g-brain init` still makes the folder and the files. It
prints `git repository  no (git not found)`. You then have no history, no undo
and no backup. Install git, run `git init` in the folder, and you get them back.

---

## Which way to install

| Way | Good for | What it costs |
|---|---|---|
| **From source** | Right now, while the packages are unpublished. Also for changing the code | You build it once |
| `npx` — nothing installed | Almost everyone, once it is published | A second or two on the first run. Needs the internet |
| Global install | Heavy command line use, machines with no internet, a fixed version | You do the upgrades yourself |
| Docker | Servers, a brain shared over the network, CI | You look after a container |

> **Read this first.** g-brain is not on npm yet. Until it is, **install from
> source** — the other three sections describe how it will work once the
> packages are published.

---

## 0. From source

g-brain is open source. You can clone it and run it without waiting for
anything.

### Step 1: Get the code and build it

```bash
git clone https://github.com/ghoshsam/g-brain.git
cd g-brain
pnpm install
pnpm build
```

No pnpm? `npm install -g pnpm` first.

### Step 2: Make a brain

```bash
node apps/cli/dist/index.js init ~/brain
```

### Step 3: Connect your AI tool

Use the full path to the server you just built, instead of `npx`:

```json
{
  "mcpServers": {
    "g-brain": {
      "command": "node",
      "args": ["/full/path/to/g-brain/apps/mcp/dist/index.js"],
      "env": { "BRAIN_ROOT": "/home/you/brain" }
    }
  }
}
```

Use the real path on your machine. On Windows use forward slashes:
`C:/Users/you/g-brain/apps/mcp/dist/index.js`.

That is it. This is exactly what the published package does — `npx` only saves
you typing the path.

### Optional: get the short `gbrain` command

Typing `node apps/cli/dist/index.js` every time gets old:

```bash
cd apps/cli && npm link
cd ../mcp && npm link
```

Now `gbrain doctor` works from any folder. To undo it:

```bash
npm uninstall -g g-brain g-brain-mcp
```

### Keeping up to date

```bash
cd g-brain
git pull
pnpm install
pnpm build
```

Your brain is a separate folder, so it is untouched by this.

---

## 1. npx — nothing installed

This is the one to pick.

```bash
npx g-brain init ~/brain
```

npm downloads the package, runs it, and keeps a copy. Nothing is installed for
good. Your AI tool does the same thing for the server. That is why the text
`init` prints uses `npx`:

```json
{
  "mcpServers": {
    "g-brain": {
      "command": "npx",
      "args": ["-y", "g-brain-mcp"],
      "env": { "BRAIN_ROOT": "/home/you/brain" }
    }
  }
}
```

There are two packages:

| Package | What it is |
|---|---|
| `gbrain` | The command you type yourself — `init`, `doctor`, `search` |
| `g-brain-mcp` | The server your AI tool talks to. You rarely run this by hand |

The cost: `npx` asks npm for a newer version each time it starts. So the first
run of the day is slower. And a machine with no internet cannot start the
server unless npm already has a copy saved.

## 2. Global install

```bash
npm install -g g-brain g-brain-mcp
```

Both commands are now on your `PATH`. They start instantly and work with no
internet.

Point your AI tool at the installed command instead of `npx`:

```json
{
  "mcpServers": {
    "g-brain": {
      "command": "g-brain-mcp",
      "env": { "BRAIN_ROOT": "/home/you/brain" }
    }
  }
}
```

Upgrades are now your job. Nothing will tell you a new version exists. See
[upgrading](#upgrading).

## 3. Docker

Use Docker when several people share one brain over the network. Or when you
want the version fixed and kept apart from the rest of the machine.

**Step 1: Build the image.** Do this from a copy of the g-brain repository:

```bash
docker build -t gbrain .
```

**Step 2: Start it with your brain folder attached:**

```bash
docker run -d --name brain \
  -v ~/brain:/brain \
  -e MCP_TRANSPORT=http \
  -e AUTH_REQUIRED=true \
  -p 8787:8787 \
  gbrain
```

**Step 3: Check it started:**

```bash
curl http://localhost:8787/health
```

```json
{
  "status": "ok",
  "brainRoot": "/brain",
  "documents": 8,
  "index": { "builtAt": "2026-09-18T09:12:04.771Z", "stale": false },
  "autocommit": false
}
```

`/health` is the only address that answers without a key. Everything else goes
to `/mcp`, and every request there must carry one. See
[sharing with a team](./08-sharing-with-a-team.md) for how to make keys.

**The image never contains any notes.** It holds the server and nothing else.
Your notes stay on your own machine and are attached at `/brain`. That is on
purpose. An image with notes baked in would hand somebody's notes to everyone
who downloads it. Those notes would also vanish on the next deploy, be invisible
to `git push`, and be unreadable in a text editor.

To use the container on your own machine instead of over the network, drop the
port and the transport setting, and let your AI tool start it:

```json
{
  "mcpServers": {
    "g-brain": {
      "command": "docker",
      "args": ["run", "--rm", "-i", "-v", "/home/you/brain:/brain", "gbrain"]
    }
  }
}
```

---

## Connecting your AI tool

The text that `gbrain init` printed goes wherever your AI tool keeps its list of
MCP servers. MCP is the standard way AI tools connect to outside services.

Restart the tool afterwards. Most of them read that file once, at startup.

### Claude Code

Add it from the command line:

```bash
claude mcp add g-brain --env BRAIN_ROOT=/home/you/brain -- npx -y g-brain-mcp
```

Or open `~/.claude/settings.json` and paste in the `mcpServers` block.

### Cursor

Go to Settings, then MCP, then Add. Or edit `~/.cursor/mcp.json` so it works in
every project:

```json
{
  "mcpServers": {
    "g-brain": {
      "command": "npx",
      "args": ["-y", "g-brain-mcp"],
      "env": { "BRAIN_ROOT": "/home/you/brain" }
    }
  }
}
```

The same file at `.cursor/mcp.json` inside a project turns it on for that
project only.

### Anything else

Every AI tool wants the same three things. The command to run, what to pass it,
and `BRAIN_ROOT`:

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

Every setting goes in that `env` block. The full list is in
[configuration](./03-configuration.md).

**Write `BRAIN_ROOT` out in full**, starting from the top of the drive. Your AI
tool starts the server from whatever folder it happens to be in. And not every
tool turns `~` into your home folder before the server sees it.

---

## Check it worked

Three checks, in order.

**Check 1: the command is there.**

```bash
gbrain --version
```

```
0.1.0
```

If you went the `npx` route, type `npx g-brain --version` instead.

**Check 2: the brain is healthy.**

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
     0  expired          past their expires date
     0  lint warnings    documents with frontmatter warnings

This command reports and changes nothing.
```

Here is what those words mean:

| Word | What it means |
|---|---|
| drift | A note saved somewhere your folder list does not mention |
| broken links | A link pointing at a file that is not there |
| orphans | A note nothing links to, which links to nothing |
| near-duplicates | A note that is nearly the same as one you already have |
| inbox | A note not yet filed anywhere |
| expired | A note older than the age you set for it |
| lint warnings | A note with something odd in its title block |

`doctor` only looks. It never changes anything. It is safe to run at any time.

**Check 3: your AI tool can see the tools.** After a restart, ten should be
listed:

| Tool | What it does |
|---|---|
| `brain_structure` | Read your folder list |
| `brain_read` | Read one note |
| `brain_list` | List a folder |
| `brain_tree` | Show the shape of the whole brain |
| `brain_links` | Show what links to what |
| `brain_write` | Make a new note, or replace one |
| `brain_append` | Add to a note that already exists |
| `brain_search` | Search the text of every note |
| `brain_history` | Show a note's git history |
| `brain_delete` | Move a note to `90-archive/` |

If nothing is listed, the tool has not restarted. Or the file you edited is not
the one it reads. [Troubleshooting](./07-troubleshooting.md) has the rest.

---

## Upgrading

| How you installed it | How to upgrade |
|---|---|
| `npx` | Nothing to do. It fetches the current version every time |
| Global install | `npm install -g g-brain@latest g-brain-mcp@latest` |
| Docker | Rebuild the image and start a new container. Your notes live on your own machine, so they are untouched |

An upgrade never changes your notes. The files on disk are the same files
before and after. Commit first anyway, because it costs nothing:

```bash
cd ~/brain
git add -A && git commit -m "before upgrade"
```

---

## Removing it

Remove the packages:

```bash
npm uninstall -g g-brain g-brain-mcp
```

Then delete the `g-brain` entry from your AI tool's settings and restart it.

**Your notes stay.** They are markdown files in a git repository. None of it
needs g-brain to be installed. Read them in any editor, open them in Obsidian,
search them with `grep`, push them to a remote. If you want them gone, delete
the folder yourself. Nothing else will.

---

## Where to go next

| | |
|---|---|
| [Configuration](./03-configuration.md) | Every setting, and the four worth changing |
| [The filing convention](./04-the-filing-convention.md) | Your folder list, the thing that decides where notes go |
| [Sharing with a team](./08-sharing-with-a-team.md) | Keys, and one brain for several people |
