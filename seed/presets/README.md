# Presets

Each file here is a complete `content-structure.md`. `gbrain init` copies one to
the brain root; nothing else reads them.

| Preset | For | Folders |
|---|---|---|
| `default.md` | General shared brain — a team, a practice, a company | `00-inbox`, `10-knowledge`, `20-projects`, `30-people`, `40-decisions`, `50-playbooks`, `60-sessions`, `90-archive` |
| `product-team.md` | One product or platform team | default, plus `15-specs`, `45-incidents` |
| `personal.md` | One person | `inbox`, `notes`, `projects`, `log`, `archive` |

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
- **Name the failure mode.** The session-log folder in every preset carries a
  warning that it is where knowledge goes to die, because it is.
- Keep it under roughly 400 lines. It is read on every routing decision.
