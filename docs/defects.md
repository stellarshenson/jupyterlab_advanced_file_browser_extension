# Defects - jupyterlab_advanced_file_browser_extension

Defects found against the acceptance criteria in `docs/acc-crit.md`.

## Authors

- `@kj` Konrad Jelen

## Current folder `FOLDER`

With unfolding on, the current folder (model.path) follows the selected row, and new items land there

- log: 2026-11-06T16:03:07Z @kj category created

- [x] `DEF-FOLDER-1-CRUMB-SHIFT` **rows move under the pointer mid-gesture** - MAJOR; with unfolding on, a double-click on a folder row does not enter it and a right-click on a folder row opens the empty-area menu, when the row's folder wraps the breadcrumbs to a different line count; fix: breadcrumbs kept on one line; `style/base.css`
  - evidence: ui-tests/tests/unfold.spec.ts: ACC-UNFOLD-5-ENTER double-click on a nested folder enters it passed; ui-tests/tests/open-in-terminal.spec.ts: ACC-TERM-55-FOLDER folder rows show only the core item and ACC-TERM-59-SUBNAV empty area after entering a folder passed; suite 61 passed 2 skipped, log tmp/workflows/functional-v1/logs/repair-1.log
  - root-cause: 2026-11-06T16:03:19Z @kj the row mousedown calls setCurrentFolder, which emits refreshed; the stock BreadCrumbs re-render for the new model.path and wrap from one line (20px) to two (36px) or back, so the listing below moves 16px before the next mouseup, click or contextmenu of the same gesture
  - related: ACC-UNFOLD-5-ENTER, ACC-TERM-55-FOLDER, ACC-TERM-59-SUBNAV - the criteria whose tests fail on it
  - repro: unfolding on, 250px file browser, top folder with a long name holding a/b; unfold a, double-click row a/b: the top folder stays
  - test-tags: FUNCTIONAL
  - log: 2026-11-06T16:03:07Z @kj added
  - log: 2026-11-06T16:18:19Z @kj attempted: breadcrumbs one line, clipped on the x axis - did NOT work, a long segment hid the path's end and ACC-UNFOLD-13-RETURN could not click it (log tmp/workflows/functional-v1/logs/repair-1-make-test.log run before, Galata 43 passed 1 failed)
  - log: 2026-11-06T16:18:19Z @kj closed: fixed: while rows carry the indent, the breadcrumbs keep one line (inline-flex) and a long segment ends in an ellipsis; height 20px in every state; style/base.css
  - log: 2026-11-06T16:18:24Z @kj correction: the failed attempt's Galata log was tmp/workflows/functional-v1/logs/repair-1.log, overwritten by the passing rerun; ACC-UNFOLD-13-RETURN failed there on Test timeout of 60000ms exceeded
  - log: 2026-11-06T16:18:31Z @kj amended text "with unfolding on, a double-click on a folder row does not enter it and a right-click on a folder row opens the empty-area menu, when the row's folder wraps the breadcrumbs to a different line count; cause under investigation" -> "with unfolding on, a double-click on a folder row does not enter it and a right-click on a folder row opens the empty-area menu, when the row's folder wraps the breadcrumbs to a different line count; fix: breadcrumbs kept on one line; `style/base.css`"

## Open in Terminal `TERM`

Migrated from jupyterlab_open_in_terminal_extension: Open in Terminal on a file and on the empty area; core keeps the folder item

- log: 2026-11-06T16:03:07Z @kj category created

- [x] `DEF-TERM-2-ROOT-CWD` **terminal at the server root opens in the process folder** - MEDIUM; Open in Terminal on a file at the server root, or on the empty area there, starts the terminal in the server's process folder instead of the server root, when the server starts outside its root_dir; fix: absolute root from the server extension; `src/openInTerminal.ts`
  - evidence: ui-tests/tests/open-in-terminal.spec.ts: ACC-TERM-60-ROOT file at the server root opens at the root passed; suite 61 passed 2 skipped, log tmp/workflows/functional-v1/logs/repair-1.log
  - root-cause: 2026-11-06T16:03:19Z @kj the command passes cwd '' (model.path); core terminal:create-new turns an empty cwd into none, and jupyter_server_terminals then starts the shell in the server's process folder; a non-empty cwd goes through contents.localPath, which strips a leading slash, so no cwd through that command names the root
  - related: ACC-TERM-60-ROOT - the criterion whose test fails on it
  - repro: start the server outside its root_dir, file browser at the root, Open in Terminal on a file, run pwd: the process folder
  - test-tags: FUNCTIONAL
  - log: 2026-11-06T16:03:07Z @kj added
  - log: 2026-11-06T16:18:19Z @kj closed: fixed: at the root the command starts the terminal with the absolute root_dir, given by the server extension as page config advancedFileBrowserServerRoot, then runs terminal:open; src/openInTerminal.ts, `jupyterlab_advanced_file_browser_extension/__init__.py`
  - log: 2026-11-06T16:18:31Z @kj amended text "Open in Terminal on a file at the server root, or on the empty area there, starts the terminal in the server's process folder instead of the server root, when the server starts outside its root_dir; cause under investigation" -> "Open in Terminal on a file at the server root, or on the empty area there, starts the terminal in the server's process folder instead of the server root, when the server starts outside its root_dir; fix: absolute root from the server extension; `src/openInTerminal.ts`"
