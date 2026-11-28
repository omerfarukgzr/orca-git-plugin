# Hay Git for Orca

Hay Git is an IntelliJ IDEA-style Git tool window for [Orca](https://github.com/stablyai/orca): local changes and commit, the Log
with its graph, branches, merge, rebase (interactive too) and conflict resolution, for the repository of the focused
workspace.

This is an independent plugin. It is not affiliated with or endorsed by JetBrains or by the makers of Orca.

## Install

```sh
orca plugin install omerfarukgzr/orca-git-plugin
```

The plugin runs code, so Orca stops with `approval_required`, lists what the plugin would be granted and prints the
same command with `--approve <fingerprint>`. Read the grants, then run that command. Later versions:
`orca plugin update`.

Needs Orca 1.4.248 or newer and `git` on the `PATH`. Developed and tested on macOS.

## What you get

- **Commit** panel (right sidebar): the local changes tree with unversioned files, diff preview, commit, amend, commit
  and push, rollback. Drag a file between Unversioned Files and Changes to add it or take it out again.
- **Git** panel (right sidebar): the Log with its commit graph, filters, commit details and changed files, and the
  branches pane. Checkout, new branch, merge, rebase, interactive rebase, cherry-pick, revert, reset, reword, squash,
  fetch, pull, push. The layout follows the panel's width (one column, two, or IntelliJ's three).
- **Center tabs**: a diff, a file at a revision, File History, a comparison or the repository at a revision opens as a
  tab in Orca's center area. "+ ▸ Git" opens the whole tool window as a tab.
- **Conflicts**: the conflicts dialog and a three-pane merge tool. An unfinished merge, rebase or cherry-pick is always
  shown and can always be aborted.
- **Annotate** (blame) in the file view, and an inline blame at the end of the line you click.
- **Console**: every `git` command the plugin runs, as it ran.
- **Worktrees**: when the repository has more than one worktree (say, one per agent session), a chip in the panel's
  header ("PR" and their number) lists them with their branch and how many changes each has. Pick one to see its changes and Log in the same
  panel, without checking anything out; a strip names it and takes you back. Its diffs open in the center tab too,
  which then says which worktree it shows.
- **Stash**: IntelliJ's Stash dialog (Git ▸ Stash Changes…) and a Stash tab beside Commit with each stash's files,
  their diffs, Apply, Pop, Unstash… (also as a new branch), Drop and Clear. A dropped or cleared stash is kept for 14
  days and Restore puts it back; Smart Checkout's own stash is put back by its id, never another session's.
- **Status bar**: the focused workspace's branch, its number of local changes and the commits to push and pull
  (`feature/x *5 ↑2 ↓1`), what runs (`Pushing… 42%`) and a merge, rebase or conflict in progress in the warning colour.
  Click it (or run "Hay Git: Show Git Panel") to bring up the Git panel in the right sidebar.
- **Report a Problem**: in the ⋮ menu at the top right of each panel. It shows what the report carries (versions, the
  plugin's own log of its calls, errors and timings, and how Orca describes the focused workspace as kinds and
  counts; no folder, project, branch or file name), takes your own
  words under it, and opens this repository's new-issue page on GitHub filled in, or copies the text. On macOS it
  also takes screenshots, up to six (drop them on the dialog, click to choose files, or paste one) and puts them on
  your clipboard as one image to paste into that page. Nothing is sent until you submit it there.
- **Updates**: when a newer version is out, the ⋮ button carries a dot and its menu a row "Update to …". When your
  version has a serious problem that a newer one fixes, a dialog asks you to update, at most once a day. Nothing is
  ever locked: "Later" closes it and the panels work as before.
- English by default; Turkish can be chosen in the ⋮ menu at the top right of each panel, which also names the
  installed version.
- **Light and dark, in two skins**: follow Orca's own light or dark interface, or pick one from the Appearance group
  in the ⋮ menu (settings in the full Git window): Default Dark, Default Light, IntelliJ Dark, IntelliJ Light.
  "Follow Orca" is the default and changes with Orca's theme. The IntelliJ skins use IntelliJ's New UI palettes; the
  Default skins keep this plugin's warm surfaces in both schemes.
- **Your editor font**: diffs, the file view with blame and the Console use the font family, size and line height of
  Orca's file editor (Settings, editor zoom included) and follow it when it changes (Orca 1.4.256 or newer; older
  versions keep the plugin's own font).
- **Orca's look**: the panels are set in Geist, Orca's default interface font, and file icons are the ones Orca's own
  file explorer draws. Orca does not tell plugins about a changed interface font or an installed icon theme, so the
  panels always show Orca's defaults.

## Safety net

The plugin runs real `git` commands, including destructive ones (rollback, hard reset, forced checkout, abort). Before
an operation throws content away, that content is saved under `<repository>/.git/git-panel/trash`, and the
notification offers **Restore**. The last 30 entries are kept, for at most 14 days.

An answer that says "could not be done" or "move these first" has changed nothing in the repository.

One deliberate difference from git: git silently overwrites an *ignored* file that stands in the way of a checkout or
merge. This plugin asks first, and when told to go on it moves the file's content to the trash above.

## What it asks for

- `trusted-worker`: the engine runs `git` as your user, in a Node.js process of its own.
- `workspace:read`: which workspace is focused, the list of workspaces with their folders, and their change events.
  When several workspaces share a name (every project's main worktree is called `main`) and Orca does not say which
  one is focused, the ids of their terminals are read to tell them apart; no terminal content is read.
- `workspace:write`: only to open a file or a diff tab in Orca's editor area.
- One status bar item and one command ("Hay Git: Show Git Panel"); with a status bar item, Orca keeps the
  plugin's worker running while the plugin is enabled. The click runs Orca's own command-line tool
  (`orca plugin open … --panel log`) to show the panel.

Network: what `git` does with your remotes, and one request of the plugin's own. When it starts and every 6 hours it
reads one small file from this repository
(`https://raw.githubusercontent.com/omerfarukgzr/orca-git-plugin/updates/versions.json`) to learn the newest version
and the oldest one that should still be used. That request carries nothing about you, your machine or your
repositories: no identifier, no query, a fixed User-Agent. Without a network nothing changes. "Update Now"
runs Orca's own `orca plugin update` for this plugin. "Report a Problem" opens a page
in your browser when you click it (Orca asks once before a plugin opens a site); the plugin itself sends nothing. A
screenshot you add to a report (macOS) is put on your clipboard with the system's `osascript` as that page opens, for
you to paste there; it is kept as one file under `~/.config/git-panel/report/` for at most two minutes after that.

## Where it keeps things

| Where | What |
|---|---|
| `<repository>/.git/git-panel/` | the trash described above, small state files, the note file behind the diff tab; dropped stashes under `stash-trash/` with refs `refs/git-panel/stash-trash/…` that keep them for Restore |
| `~/.config/git-panel/` | settings, which folder a terminal id was last seen in (at most 300, to tell workspaces of one name apart), and `log/` with one file per day (7 days, at most 20 MB a day) |

The log holds git commands with their duration and exit code, operations and page errors. It holds no file content,
no diff and no commit message text, and user names and passwords in URLs are removed.

Nothing is written into a working tree.

## Limits

- A workspace on another machine (SSH, WSL) is not supported; the panel shows the repository picker instead.
- When the focused workspace itself is a linked worktree, diffs open inside the panel instead of a center tab (Orca
  opens a center tab only for a file inside the workspace, and nothing is written into a working tree).
- Worktrees can be listed and shown, not created, removed, locked or pruned.
- An Orca plugin cannot decorate Orca's Source editor, so the inline blame lives in the plugin's own file view (a file
  opened from the Git or Commit panel), not in the file's Source tab.
- Not included: changelists, shelve UI, patches, pull requests, managing worktrees, commit checks, GPG, a submodule
  UI, committing single lines of a file.

## This repository

It holds the plugin exactly as Orca loads it, published from a development tree where the tests and build tools live.

| Path | What |
|---|---|
| `orca-plugin.json` | the plugin's manifest |
| `core/` | the engine: Node.js, runs the real `git`, no npm dependencies |
| `ui/` | the web UI. `ui/orca-bundle.js` and `ui/css/orca-bundle.css` are its plain scripts and stylesheets joined in order, not minified or changed: each part stands under a `/* ==== <file> ==== */` line (the one minified part is highlight.js, as its authors distribute it). `ui/git/boot.js` starts the UI |
| `hosts/orca/` | the worker and the panels that connect the two to Orca |

License: MIT ([LICENSE](LICENSE)). Third-party files keep their own licenses: [NOTICE.md](NOTICE.md).
