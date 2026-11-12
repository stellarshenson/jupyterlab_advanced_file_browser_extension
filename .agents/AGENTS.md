<!-- @import /home/lab/.claude/CLAUDE.md -->
<!-- @import /home/lab/workspace/.claude/CLAUDE.md -->

# Project-Specific Configuration

This file is an overlay. It imports two layers and copies neither:

- **User layer** - `/home/lab/.claude/CLAUDE.md`, applies to every project on this machine
- **Workspace layer** - `/home/lab/workspace/.claude/CLAUDE.md`, applies to everything under `~/workspace`

Both layers apply in full. Rules below extend or strengthen them; where they overlap, the stricter
wording wins. The workspace `/home/lab/workspace/.claude/` directory and the skills the two layers
name carry every standard not restated here. On 2026-11-06 the workspace layer file is absent on
disk; the import stands and nothing restores it.

`.claude/CLAUDE.md` is a symlink to this file; `.claude/skills`, `.claude/commands` and
`.claude/JOURNAL.md` link to `.agents/skills`, `.agents/workflows` and `.agents/JOURNAL.md`.
`.claude/settings.json` sets `worktree.bgIsolation: none`, so a background session works in place
on `main`.

## Mandatory Bans (Reinforced)

The following workspace rules are STRICTLY ENFORCED for this project:

- **No automatic git tags** - only create tags when user explicitly requests
- **No automatic version changes** - only modify version in package.json/pyproject.toml/etc. when user explicitly requests
- **No automatic publishing** - never run `make publish`, `npm publish`, `twine upload`, or similar without explicit user request
- **No manual package installs if Makefile exists** - use `make install` or equivalent Makefile targets, not direct `pip install`/`uv install`/`npm install`
- **No automatic git commits or pushes** - only when user explicitly requests
- **No edit of another extension** - every other extension stays untouched from this project;
  the retirement of the three replaced ones is the Star Colonel's step

## Project Context

JupyterLab 4 extension, `kind: frontend-and-server`, scaffolded from the official copier template
`jupyterlab/extension-template` v4.6.5. It adds features to the JupyterLab file browser and takes
over three extensions of the workspace, `jupyterlab_file_browser_sorting_extension` (Unix Style
Sorting), `jupyterlab_open_in_terminal_extension` (Open in Terminal) and
`jupyterlab_drag_and_drop_path_extension` (drag-and-drop path insertion into terminals, editors
and notebooks), so that all three can be retired. It adds folder unfolding, ported from
`jupyterlab-unfold`. `jupyterlab_drag_and_drop_path_extension` is retired after this campaign.

- **`INTENT.md` is the brief** - the Star Colonel's requirements and his list of the extensions
  to migrate (three) and to keep separate (thirteen); read it in full before any design or code
- **`docs/migration.md`** - the three extensions this one replaces, the thirteen that stay separate,
  and what each of them assumes about the file browser that folder unfolding must keep
- **`docs/acc-crit.md`** - the required behaviour as acceptance criteria, each naming its test
- **Folder unfolding** - ported from https://github.com/jupyterlab-contrib/jupyterlab-unfold and
  modernised for JupyterLab 4.6.5: a triangle on every folder row folds or unfolds the folder in
  place as a tree; a double-click on a folder still enters it; an on/off option in the context
  menu of the column header (`.jp-DirListing-header`), beside the core items at ranks 14-18
  (Show Last Modified Column, Show Date Created Column, Show File Size Column, Show File
  Checkboxes, Sort Notebooks Above Files) and Unix Style Sorting
- **Drag-and-drop path insertion** - ported from `jupyterlab_drag_and_drop_path_extension` 1.0.12:
  dragging a file or folder from the file browser onto a terminal, a Python file, a notebook code
  cell or another open file inserts its path, and the breadcrumbs are a drag source; six settings
  sit on the Advanced File Browser settings page (`dragDropPathEnabled`, `pathType`,
  `pythonPathStyle`, `pathlibConstructor`, `terminalSeparator`, `terminalQuotePaths`); the server
  root comes from the page config `advancedFileBrowserServerRoot`, and the ported
  `terminal-cwd/<name>` route sits under this extension's namespace
- **Licence** - code ported from `jupyterlab-unfold` keeps its upstream licence notice (BSD
  3-Clause, "Copyright (c) 2023, Martin Renou") in the ported file and in `LICENSE`
- **State** - the code is the template placeholder (hello route, activation log); update this
  section when the architecture exists
- npm package `@stellarshenson/jupyterlab-advanced-file-browser-extension`, PyPI package
  `jupyterlab-advanced-file-browser-extension`, Python module
  `jupyterlab_advanced_file_browser_extension`; server routes under
  `jupyterlab-advanced-file-browser-extension/`; settings plugin id
  `@stellarshenson/jupyterlab-advanced-file-browser-extension:plugin`; version read from
  `package.json` by `hatch-nodejs-version`

## Build Lifecycle - Makefile Only

The Makefile owns the whole build lifecycle. Never run `pip`, `jlpm`, `yarn`, `npm`,
`python -m build`, `twine`, or any build, publish or clean command directly - those bypass the
project-local `.nodeenv/` toolchain the Makefile pins.

| Target          | Effect                                                                          |
| --------------- | ------------------------------------------------------------------------------- |
| `make install`  | build and install the extension; raises the patch version on every run          |
| `make publish`  | release to npm and PyPI, committing and pushing first; needs approval each time |
| `make clean`    | remove build artefacts                                                          |
| `make mrproper` | remove all build and virtual-environment artefacts                              |
| `make build`    | resolve `yarn.lock`, format, build the sdist and the wheel; the version stays   |
| `make test`     | Jest, pytest and the endpoint authentication gate                               |

- **Makefile version check** - line 1 of the local Makefile declares its version. Compare it with
  `/home/lab/workspace/private/jupyterlab/@utils/jupyterlab-extensions/Makefile` at the start of any
  build work and copy the canonical file over the local one as soon as it is newer. At project
  creation both are 1.48 and identical
- **Every `make install` is a version change** and needs the Star Colonel's approval
- **Dependency ranges** follow the jupyterlab-extension skill: floor at the installed and tested
  `major.minor`, ceiling at the next major, floors read from the installed packages and never from
  the registries; `typescript` keeps its tilde, `resolutions` stay exact
- **The Galata suite has no Makefile target** - it is the one lifecycle step outside the Makefile
  and runs through the skill's runner `scripts/galata-bwrap.sh`; `JUPYTER_TEST_PORT` carries the
  port. Port 8888 belongs to the workstation's own lab; never pipe the run through `| tee`, which
  reports tee's exit status

## Git Rules (Project-Specific)

- The repository was initialised with `git init -b main` and an initial import of every artefact
- **Always commit `package.json`, `package-lock.json` and `yarn.lock` together** - and
  `ui-tests/package.json` with `ui-tests/yarn.lock`
- This project is its own repository; never commit its files into the workspace repository

## Journal Rules (Project-Specific)

- **APPEND ONLY**: New journal entries MUST be appended at the end of the file, never inserted between existing entries
- Entries maintain strict chronological order by position - the last entry in the file is always the most recent work
- Never reorder, move, or insert entries out of sequence
- The Stellars **journal plugin** is the only writer: create via `/journal:create`, append via `/journal:update`, archive via `/journal:archive`. The `journal:journal` skill auto-triggers on any mention of "journal" and runs `journal-tools check` after every write
- Never edit `JOURNAL.md` by hand, not even for a one-line append

## Acceptance Criteria, Defects and Edge Cases (Project-Specific)

- **Record before working** - when the user states a new acceptance criterion or a new defect, or a change to one, record it through `/project-management:project-management` in the same turn, before working on it
- **Trackers through `pm-tools` only** - every write to `docs/acc-crit*.md` and `docs/defects*.md` goes through `pm-tools`, never a hand edit
- **Real edge cases** - handle the edge cases a real user or a real input reaches; the ones that are cheap to resolve are handled together, in the smallest change, without debating each one
- **No extreme edge cases** - do not chase extreme or contrived edge cases in code, tests or reviews; each one costs tokens and review rounds and changes nothing a user gets

The project-specific rules for the two trackers:

- Criteria live in `docs/acc-crit*.md` and defects in `docs/defects*.md`, written **only** through
  the project-management plugin (the `pm-tools` CLI), never by a hand edit of either file:
  `/project-management:acc-crit` adds, closes, rejects or relates a criterion,
  `/project-management:defect` files, triages, logs or closes a defect, `/project-management:report`
  gives status and coverage
- **Every feature gets its acceptance criteria before the code**, and every criterion names the
  test that proves it
- **Functional tests under `ui-tests/` are part of every feature**, not an afterthought, and run
  green before a release
- Close a criterion only on evidence - the test that ran and what it showed

## Tests

Three tiers, to the testing strategy of the jupyterlab-extension skill:

- **pytest** under `jupyterlab_advanced_file_browser_extension/tests/` for server code
- **Jest** under `src/__tests__/` for frontend logic
- **Playwright/Galata** under `ui-tests/` for everything visible in the browser, written to that
  skill's `references/galata-testing.md`: the port through one variable (`JUPYTER_TEST_PORT`), a
  private settings folder for the test server, no snapshot-only assertions, a suite that can fail

## Command-Line Tools and Their Agent Skill

A command-line tool the extension ships (an entry point under `[project.scripts]` in
`pyproject.toml`) gets the `--help` and the agent skill that the jupyterlab-extension skill's
section "Agent Skill for a Shipped CLI" prescribes.

- **Name** - the skill is named after the extension: `jupyterlab-advanced-file-browser-extension`
- **Location** - `.agents/skills/jupyterlab-advanced-file-browser-extension/SKILL.md` at the
  repository root, and in the wheel through the `shared-data` table of `pyproject.toml`
- **Same commit** - the skill and the `--help` text change in the commit that changes the CLI
- **Never inside the Python package** - the CI link check imports the package for every link in a
  Markdown file inside it, and fails without `jupyter_server`
- **Reference implementation** -
  `/home/lab/workspace/private/jupyterlab/jupyterlab_notifications_extension`

## Scope Control - graphify

- Run `/graphify` once the first source is in place to build `tmp/graphify-out/`
- Run `graphify affected` before editing existing code to learn its callers and dependents; that
  affected set is the change budget, and an edit outside it needs the Star Colonel's word
- Run `graphify update` after every edit
- The graph lives in `tmp/graphify-out/`, not in graphify's default `graphify-out/`: prefix every
  graphify command with `GRAPHIFY_OUT=tmp/graphify-out`, for example
  `GRAPHIFY_OUT=tmp/graphify-out graphify update .`
- `tmp/` is gitignored, so the graph never ships

## Required Skills

| Skill                                   | Use                                                                                   |
| --------------------------------------- | ------------------------------------------------------------------------------------- |
| `jupyterlab-extension`                  | extension development guidelines, testing strategy, CI/CD, caveats                    |
| `my-browser`                            | browser automation for screenshots and UI verification against the running JupyterLab |
| `project-management:project-management` | acceptance criteria and defects through the `pm-tools` CLI                            |
| `graphify`                              | the codebase graph and the impact analysis that bounds every change                   |
| `journal:journal`                       | the project journal through the `journal-tools` CLI                                   |

## Strengthened Rules

- **Every server endpoint sits behind Jupyter's authentication** - `@tornado.web.authenticated` on
  every HTTP verb; `.github/scripts/check_auth.py` is the gate and `make test` runs it
- **No dependency on a fix package** - no `*_fix` package and not `stellars_jupyterlab_fixes`
- **One owner per file browser feature** - while a replaced extension is still installed, its
  command ids and settings must not collide with this extension's; a migrated feature takes a new
  command id under this extension's prefix

## Design System

Every visible part of the extension - the folder triangle, the tree indentation, menu items and
any dialog - follows the Extension Design System of the jupyterlab-extension skill. Read both
files below before any UI design or styling work.

- **Source of truth** -
  `/home/lab/.claude/skills/jupyterlab-extension/design-system/extension-design-system.dc.html`
  (open in a browser): tokens, typography, spacing, controls, layouts and the
  `@jupyterlab/ui-components` build notes
- **Repository directives** - `/home/lab/.claude/skills/jupyterlab-extension/design-language.md`:
  the reference implementations to copy from, the class names
  `jp-AdvancedFileBrowser-<component>` with `jp-mod-<state>`, the colour choice
- **Colours** - `--jp-*` CSS variables only, chosen by role; no literal colours
