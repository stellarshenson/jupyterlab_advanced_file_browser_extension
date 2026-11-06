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
- [x] `DEF-FOLDER-3-SCROLLBAR` **a press on the listing scrollbar resets the current folder** - MEDIUM; with unfolding on, a mousedown on the listing's vertical scrollbar clears the selection and makes the top folder current, so New File, New Folder, Upload and Paste no longer land in the clicked folder; fix: the empty area is the content node inside its client width; `src/listing.ts`
  - evidence: `ui-tests/tests/current-folder.spec.ts`: DEF-FOLDER-3-SCROLLBAR a press on the scrollbar keeps the folder and the selection passed, 37 of 37 in the three touched specs, `tmp/workflows/review-v1/logs/r1-galata.log`; it failed on the pre-change build, `tmp/workflows/review-v1/logs/r1-before.log`
  - related: ACC-FOLDER-31-CLICKEMPTY, ACC-FOLDER-29-CLICKDIR - the empty-area rule matches the scrollbar and undoes the folder the click chose
  - repro: unfolding on, a listing long enough to scroll; unfold a, click row a/b, press the scrollbar: the selection clears and model.path is the top folder
  - test-tags: FUNCTIONAL
  - root-cause: 2026-11-06T17:23:40Z @kj TreeDirListing._setCurrentFolder treats every press with no row hit and a target inside contentNode as the empty area; a press on the scrollbar targets contentNode itself, so contentNode.contains(target) is true, while stock _evtMousedown returns at hit index -1 and keeps the selection
  - log: 2026-11-06T17:23:40Z @kj added
  - log: 2026-11-06T17:31:07Z @kj closed: fixed: only a press on contentNode inside its client width is the empty area; src/listing.ts

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

## Actions on nested rows `NESTED`

File browser actions on rows inside unfolded folders act on the item's own path

- log: 2026-11-06T17:25:19Z @kj category created

- [x] `DEF-NESTED-4-TWICE` **a folder selected with its own rows is copied, moved or deleted twice** - MAJOR; with unfolding on, Copy, Cut, Delete or a drop on a selection that holds a folder and rows inside it act on each row as well, in parallel: Paste puts the rows a second time beside the folder copy, and Delete may report Delete Failed; `src/listing.ts`
  - evidence: `ui-tests/tests/nested-actions.spec.ts`: ACC-NESTED-77-OUTERMOST a folder selected with its own rows acts once passed, `tmp/workflows/review-v1/logs/r1-galata.log`; it failed on the pre-change build with b/x.txt present, `tmp/workflows/review-v1/logs/r1-before.log`; `src/__tests__/tree-model.spec.ts` outermost case passed, make test Jest 21 of 21, `tmp/workflows/review-v1/logs/r1-make-test.log`
  - related: ACC-NESTED-37-DELETE, ACC-FOLDER-34-PASTE, ACC-UNFOLD-16-DROP - each acts on a nested row a second time when its folder is selected too
  - repro: unfolding on; unfold a holding x.txt, click a, Ctrl-click a/x.txt, Copy, click folder b, Paste: both b/a/x.txt and b/x.txt appear
  - test-tags: UNIT, FUNCTIONAL
  - root-cause: 2026-11-06T17:25:19Z @kj stock copy (_copy over selectedItems), delete (_sortedItems filtered by the selection) and the tree evtDrop (the dragged selection keys) take every selected path; with unfolding on a selection can hold a folder and its own rows, and each path becomes its own request, sent in parallel
  - log: 2026-11-06T17:25:19Z @kj added
  - log: 2026-11-06T17:31:07Z @kj closed: fixed: copy, cut, delete and the tree drop act on the outermost selected paths; src/listing.ts, src/model.ts

## Folder unfolding `UNFOLD`

A triangle on each folder row folds or unfolds the folder in place as a tree; ported from jupyterlab-unfold

- log: 2026-11-06T17:26:40Z @kj category created

- [x] `DEF-UNFOLD-5-INTOSELF` **a folder Ctrl-dropped inside itself is copied into itself without end** - MAJOR; with unfolding on, a Ctrl-drop of a folder onto its own row or a row inside it asks the server to copy the folder into itself; copytree then recurses about 500 levels, writes about 250 times the folder's size and blocks the server; `src/listing.ts`
  - evidence: `ui-tests/tests/unfold.spec.ts`: ACC-UNFOLD-78-SELFDROP a folder Ctrl-dropped on its own row stays passed, `tmp/workflows/review-v1/logs/r1-galata.log`; it failed on the pre-change build with a POST copy to a/b, `tmp/workflows/review-v1/logs/r1-before.log`
  - related: ACC-UNFOLD-16-DROP - the drop on a nested row reaches the folder's own rows
  - repro: unfolding on; unfold a holding folder b, press row a, Ctrl-drag it onto row a/b and release: a/b/a/b/a appears, then Error while copying/moving files
  - test-tags: FUNCTIONAL
  - root-cause: 2026-11-06T17:26:40Z @kj TreeDirListing.evtDrop skips a path only when the new path equals the old one; stock evtDragOver marks any row under the pointer as the drop target, and jupyter_server 2.21.1 copy calls shutil.copytree with no check that the target lies inside the source
  - log: 2026-11-06T17:26:40Z @kj added
  - log: 2026-11-06T17:31:07Z @kj closed: fixed: evtDrop skips a folder dropped onto itself or below itself; src/listing.ts
