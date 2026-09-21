# Presets

Each file here is a complete `content-structure.md` for a brain's **root** — the
folders the brain has and what belongs in each. `gbrain init` copies one to the
brain root; nothing else reads them.

**A preset is not the only convention a brain has.** A project may additionally
carry its own `content-structure.md`, at
`{projects folder}/{project}/content-structure.md`, and where one exists it is
the authority for everything inside that project. The preset, as the root
document, still decides what belongs in the projects folder at all; the project
document is additive, never a replacement. Most projects never have one, so the
preset is still where nearly every routing decision is settled. Project documents are not
seeded from here: they describe one project's subfolders, and there is nothing
generic to copy.

For a project document to be found, `PROJECTS_FOLDER` has to name the folder the
preset uses — `20-projects` for `default.md` and `product-team.md`, `projects`
for `personal.md`. See
[`docs/user/03-configuration.md`](../../docs/user/03-configuration.md).

| Preset | For | Folders |
|---|---|---|
| `default.md` | General shared brain — a team, a practice, a company | `00-inbox`, `05-memory`, `10-knowledge`, `20-projects`, `30-people`, `40-decisions`, `50-playbooks`, `60-sessions`, `90-archive` |
| `product-team.md` | One product or platform team | default, plus `15-specs`, `45-incidents` |
| `personal.md` | One person | `inbox`, `memory`, `notes`, `projects`, `log`, `archive` |

## Adding a preset

Drop a new `.md` file in this folder. No code change — `gbrain init` lists
whatever is here, using the file's first `#` heading and the paragraph beneath
it as the label and description.

## Writing one that an LLM actually follows

The full guidance is in [`docs/technical/03-structure-doc-guide.md`](../../docs/technical/03-structure-doc-guide.md).
The short version:

- **State what does *not* belong** in each folder, not just what does. Exclusions
  do more work than inclusions — most misfiling is a doc that plausibly fits two
  places.
- **Give one real example path** per folder.
- **Give a decision procedure at the top**, before the folder list. The model
  reads top-down.
- **Always provide an inbox and bless it.** Say explicitly that using it is a
  correct answer. Without that, a model guesses rather than admits uncertainty,
  and a wrong guess is invisible where an inbox item is not.
- **Split rules by reach.** A memory folder at the root is for what holds
  everywhere; a rule true of one project belongs in that project's own
  `memory/`. Say so in both places — otherwise the root folder fills with
  project trivia, and a folder read at the start of every session gets skimmed.
- **Name the failure mode.** The session-log folder in every preset carries a
  warning that it is where knowledge goes to die, because it is.
- Keep it under roughly 400 lines. It is read on every routing decision.
