# Acceptance Criteria - jupyterlab_advanced_file_browser_extension

Folder unfolding in the JupyterLab file browser, ported from jupyterlab-unfold and switched in the column-header menu, plus the Unix Style Sorting and Open in Terminal features of the two extensions it replaces. Sources: `INTENT.md`, the Star Colonel's decisions of 2026-11-06, `docs/migration.md`.

## Authors

- `@kj` Konrad Jelen

## Folder unfolding `UNFOLD`

A triangle on each folder row folds or unfolds the folder in place as a tree; ported from jupyterlab-unfold

- log: 2026-11-06T13:52:03Z @kj category created

- [ ] `ACC-UNFOLD-1-TRIANGLE` **Triangle on folder rows** - HIGH; with unfolding on, every folder row shows a triangle before its icon; file rows show none
  - test: ui-tests/tests/unfold.spec.ts: unfolding on, folder a and file b.txt; assert a triangle on the a row only
  - test-tags: FUNCTIONAL
  - log: 2026-11-06T13:52:03Z @kj added
- [ ] `ACC-UNFOLD-2-EXPAND` **Triangle click unfolds** - CRITICAL; a click on the triangle of a folded folder shows its children as rows directly below it, one level deeper
  - test: ui-tests/tests/unfold.spec.ts: click the triangle of a; assert the a/x.txt row follows the a row
  - test-tags: FUNCTIONAL
  - log: 2026-11-06T13:53:18Z @kj added
- [ ] `ACC-UNFOLD-3-COLLAPSE` **Triangle click folds** - CRITICAL; a click on the triangle of an unfolded folder removes its child rows, deeper levels included
  - test: ui-tests/tests/unfold.spec.ts: unfold a and a/b, click the triangle of a; assert no row under a
  - test-tags: FUNCTIONAL
  - log: 2026-11-06T13:53:18Z @kj added
- [ ] `ACC-UNFOLD-4-DEPTH` **Unfold at any depth** - HIGH; a folder inside an unfolded folder unfolds the same way, to any depth
  - test: ui-tests/tests/unfold.spec.ts: unfold a, a/b, a/b/c; assert the a/b/c/f.txt row at depth 3
  - test-tags: FUNCTIONAL
  - log: 2026-11-06T13:53:18Z @kj added
- [ ] `ACC-UNFOLD-5-ENTER` **Double-click enters a folder** - CRITICAL; a double-click on a folder row at any depth enters the folder as in the stock browser: the listing shows its contents at the top level
  - test: ui-tests/tests/unfold.spec.ts: unfold a, double-click a/b; assert the top rows are the children of a/b
  - test-tags: FUNCTIONAL
  - log: 2026-11-06T13:53:18Z @kj added
- [ ] `ACC-UNFOLD-6-NOENTER` **Triangle click does not enter** - HIGH; a click on a triangle leaves the listing's top folder unchanged
  - test: ui-tests/tests/unfold.spec.ts: click the triangle of a; assert the first row is still a
  - test-tags: FUNCTIONAL
  - log: 2026-11-06T13:53:18Z @kj added
- [ ] `ACC-UNFOLD-7-OPENFILE` **Double-click opens a nested file** - HIGH; a double-click on a file row inside an unfolded folder opens that file
  - test: ui-tests/tests/unfold.spec.ts: unfold a, double-click a/x.txt; assert an open tab for path a/x.txt
  - test-tags: FUNCTIONAL
  - log: 2026-11-06T13:53:18Z @kj added
- [ ] `ACC-UNFOLD-8-INDENT` **Depth shown by indent** - MEDIUM; each row is indented by its depth below the listing's top folder, with one vertical guide line per level
  - test: ui-tests/tests/unfold.spec.ts: unfold a and a/b; assert the a/b/x.txt row has 2 guide lines and twice the indent of a/x.txt
  - test-tags: FUNCTIONAL
  - log: 2026-11-06T13:53:18Z @kj added
- [ ] `ACC-UNFOLD-9-OPENICON` **Open folder icon** - LOW; an unfolded folder shows the open-folder icon; a folded folder shows the closed folder icon
  - test: ui-tests/tests/unfold.spec.ts: unfold a; assert the open-folder icon on a and the closed icon on b
  - test-tags: FUNCTIONAL
  - log: 2026-11-06T13:53:18Z @kj added
- [ ] `ACC-UNFOLD-10-POINTS` **Triangle direction** - LOW; the triangle points right on a folded folder and down on an unfolded folder
  - test: ui-tests/tests/unfold.spec.ts: unfold a; assert the triangle state of a and of folded b
  - test-tags: FUNCTIONAL
  - log: 2026-11-06T13:53:18Z @kj added
- [ ] `ACC-UNFOLD-11-REFRESH` **Unfolded folders refresh** - HIGH; a file created, renamed or deleted inside an unfolded folder appears, changes or disappears under that folder on the browser's next refresh
  - test: ui-tests/tests/unfold.spec.ts: unfold a, create a/new.txt through the contents API; assert its row under a within the refresh interval
  - test-tags: FUNCTIONAL
  - log: 2026-11-06T13:53:18Z @kj added
- [ ] `ACC-UNFOLD-12-PERSIST` **Fold state survives reload** - MEDIUM; folders unfolded before a page reload are unfolded after it
  - mechanism: 2026-11-06T13:53:37Z @kj open folders saved in IStateDB under the browser id and restored on load, as upstream jupyterlab-unfold
  - test: ui-tests/tests/unfold.spec.ts: unfold a and a/b, reload the page; assert both unfolded
  - test-tags: FUNCTIONAL
  - log: 2026-11-06T13:53:18Z @kj added
  - log: 2026-11-06T13:53:37Z @kj fold state kept across reload: Star Colonel decided 2026-11-06
- [ ] `ACC-UNFOLD-13-RETURN` **Fold state survives entering a folder** - MEDIUM; a folder unfolded before entering another folder is still unfolded after returning through the breadcrumbs
  - test: ui-tests/tests/unfold.spec.ts: unfold a, double-click b, click the root breadcrumb; assert a unfolded
  - test-tags: FUNCTIONAL
  - log: 2026-11-06T13:53:18Z @kj added
- [ ] `ACC-UNFOLD-14-GONE` **Edge: unfolded folder deleted** - MEDIUM; when an unfolded folder is deleted outside the browser, its rows disappear on the next refresh and no error dialog opens
  - test: ui-tests/tests/unfold.spec.ts: unfold a, delete a through the contents API; assert no a rows and no dialog
  - test-tags: FUNCTIONAL
  - log: 2026-11-06T13:53:18Z @kj added
- [ ] `ACC-UNFOLD-15-EMPTYDIR` **Edge: empty folder unfolds** - LOW; an empty folder unfolds to no child rows and its triangle shows the unfolded state
  - test: ui-tests/tests/unfold.spec.ts: create empty folder e, click its triangle; assert no rows under e and the triangle points down
  - test-tags: FUNCTIONAL
  - log: 2026-11-06T13:53:19Z @kj added
- [ ] `ACC-UNFOLD-16-DROP` **Drop on a nested folder** - HIGH; files dragged onto a folder row at any depth move into that folder; dropped onto a file row they move into that file's folder
  - test: ui-tests/tests/unfold.spec.ts: unfold a, drag x.txt onto the a/b row; assert a/b/x.txt exists and x.txt does not
  - test-tags: FUNCTIONAL
  - log: 2026-11-06T13:53:19Z @kj added
- [ ] `ACC-UNFOLD-17-SORTHEAD` **Header sort at every depth** - HIGH; a click on a column header sorts the rows of every level by that column and direction; children stay directly under their folder
  - test: ui-tests/tests/unfold.spec.ts and src/**tests**/tree-model.spec.ts: unfold a, sort by Last Modified descending; assert the order inside the top level and inside a
  - test-tags: UNIT, FUNCTIONAL
  - log: 2026-11-06T13:53:19Z @kj added
- [ ] `ACC-UNFOLD-18-NBFIRST` **Notebooks above files at every depth** - MEDIUM; with Sort Notebooks Above Files on, notebooks come before other files inside every unfolded folder
  - test: src/**tests**/tree-model.spec.ts: folder a with n.ipynb and m.txt, setting on; assert n.ipynb before m.txt under a
  - test-tags: UNIT
  - log: 2026-11-06T13:53:19Z @kj added
- [ ] `ACC-UNFOLD-19-HIDDEN` **Hidden files at every depth** - MEDIUM; the Show Hidden Files setting applies to rows at every depth
  - test: ui-tests/tests/unfold.spec.ts: a/.h present, unfold a; assert .h hidden, then shown after the setting is on
  - test-tags: FUNCTIONAL
  - log: 2026-11-06T13:53:19Z @kj added
- [ ] `ACC-UNFOLD-20-COLUMNS` **Columns on nested rows** - MEDIUM; Last Modified, File Size, Date Created and the file checkbox show on nested rows exactly when they show on top rows
  - test: ui-tests/tests/unfold.spec.ts: turn each column on and off; assert the cell on the a/x.txt row follows
  - test-tags: FUNCTIONAL
  - log: 2026-11-06T13:53:19Z @kj added
- [ ] `ACC-UNFOLD-21-FILTER` **Filter at every depth** - MEDIUM; with the file filter box in use, typed text shows the matching rows at every unfolded depth, and each folder on the path to a match stays visible
  - test: ui-tests/tests/unfold.spec.ts: unfold a/b, type x; assert a, a/b, a/b/x.txt visible and a/y.txt hidden
  - test-tags: FUNCTIONAL
  - log: 2026-11-06T13:53:19Z @kj added
  - log: 2026-11-06T13:53:37Z @kj filter at every depth: Star Colonel decided 2026-11-06; read as every unfolded depth, folded folders are not loaded
- [ ] `ACC-UNFOLD-22-NOTICE` **Upstream licence notice** - HIGH; each source file ported from jupyterlab-unfold carries its BSD 3-Clause notice 'Copyright (c) 2023, Martin Renou', and LICENSE reproduces it
  - test: jupyterlab_advanced_file_browser_extension/tests/test_licence.py: assert the notice in LICENSE and in every ported file
  - test-tags: UNIT
  - log: 2026-11-06T13:53:19Z @kj added

## Unfolding switch `SWITCH`

The column-header menu item that turns unfolding on and off; off by default

- log: 2026-11-06T13:53:19Z @kj category created

- [ ] `ACC-SWITCH-23-ITEM` **Switch in the column-header menu** - HIGH; right-click on the column header shows a checkable unfolding item in the same menu as Show Last Modified Column, Show Date Created Column, Show File Size Column, Show File Checkboxes, Sort Notebooks Above Files and Unix Style Sorting
  - test: ui-tests/tests/switch.spec.ts: right-click .jp-DirListing-header; assert the unfolding item and the six others in one menu
  - test-tags: FUNCTIONAL
  - log: 2026-11-06T13:53:19Z @kj added
- [ ] `ACC-SWITCH-24-DEFAULT` **Off by default** - HIGH; with no saved setting, unfolding is off: no triangles and the item unchecked
  - test: ui-tests/tests/switch.spec.ts: fresh settings folder; assert no triangle and the item unchecked
  - test-tags: FUNCTIONAL
  - log: 2026-11-06T13:53:19Z @kj added
  - log: 2026-11-06T13:53:41Z @kj default off: Star Colonel decided 2026-11-06
- [ ] `ACC-SWITCH-25-CHECK` **Item shows the state** - MEDIUM; the menu item is checked exactly while unfolding is on
  - test: ui-tests/tests/switch.spec.ts: toggle twice; assert the checked state after each toggle
  - test-tags: FUNCTIONAL
  - log: 2026-11-06T13:53:19Z @kj added
- [ ] `ACC-SWITCH-26-ON` **Switch on without reload** - HIGH; turning the item on shows the triangles on folder rows at once, with no page reload
  - test: ui-tests/tests/switch.spec.ts: turn the item on; assert triangles without a reload
  - test-tags: FUNCTIONAL
  - log: 2026-11-06T13:53:19Z @kj added
- [ ] `ACC-SWITCH-27-OFF` **Switch off restores the stock listing** - HIGH; turning the item off removes the triangles and every child row at once; the listing shows only the folder on screen
  - test: ui-tests/tests/switch.spec.ts: unfold a, turn the item off; assert no triangle and no a/ rows
  - test-tags: FUNCTIONAL
  - log: 2026-11-06T13:53:19Z @kj added
- [ ] `ACC-SWITCH-28-SAVED` **Choice saved** - MEDIUM; the choice is a setting of this extension and survives a page reload
  - test: ui-tests/tests/switch.spec.ts: turn the item on, reload; assert triangles and the setting value true
  - test-tags: FUNCTIONAL
  - log: 2026-11-06T13:53:19Z @kj added

## Current folder `FOLDER`

With unfolding on, the current folder (model.path) follows the selected row, and new items land there

- log: 2026-11-06T13:53:20Z @kj category created

- [ ] `ACC-FOLDER-29-CLICKDIR` **Click on a folder makes it current** - HIGH; with unfolding on, a click on a folder row at any depth makes that folder the current folder, model.path of IDefaultFileBrowser
  - mechanism: 2026-11-06T13:53:37Z @kj a mousedown on a row sets model.path, as upstream DirTreeListing._eventMouseDown; the listing top stays the entered folder
  - test: ui-tests/tests/current-folder.spec.ts: unfold a, click a/b; assert model.path a/b
  - test-tags: FUNCTIONAL
  - log: 2026-11-06T13:53:20Z @kj added
  - log: 2026-11-06T13:53:37Z @kj new items land in the selected row's folder, as upstream jupyterlab-unfold: Star Colonel decided 2026-11-06
- [ ] `ACC-FOLDER-30-CLICKFILE` **Click on a file makes its folder current** - HIGH; with unfolding on, a click on a file row makes the file's folder the current folder
  - test: ui-tests/tests/current-folder.spec.ts: unfold a, click a/x.txt; assert model.path a
  - test-tags: FUNCTIONAL
  - log: 2026-11-06T13:53:20Z @kj added
  - log: 2026-11-06T13:53:37Z @kj new items land in the selected row's folder, as upstream jupyterlab-unfold: Star Colonel decided 2026-11-06
- [ ] `ACC-FOLDER-31-CLICKEMPTY` **Click on the empty area resets** - MEDIUM; with unfolding on, a click on the empty area below the rows makes the listing's top folder current and clears the selection
  - test: ui-tests/tests/current-folder.spec.ts: click a/b, then the empty area; assert model.path is the top folder and nothing selected
  - test-tags: FUNCTIONAL
  - log: 2026-11-06T13:53:20Z @kj added
- [ ] `ACC-FOLDER-32-NEWITEM` **New File and New Folder land in the current folder** - CRITICAL; after a click on a nested folder, New File and New Folder create the item in that folder and show its row there
  - test: ui-tests/tests/current-folder.spec.ts: unfold a, click a/b, run New Folder; assert a/b/Untitled Folder exists with its row under a/b
  - test-tags: FUNCTIONAL
  - log: 2026-11-06T13:53:20Z @kj added
  - log: 2026-11-06T13:53:37Z @kj new items land in the selected row's folder, as upstream jupyterlab-unfold: Star Colonel decided 2026-11-06
- [ ] `ACC-FOLDER-33-UPLOAD` **Upload lands in the current folder** - HIGH; after a click on a nested folder, an uploaded file is saved in that folder
  - test: ui-tests/tests/current-folder.spec.ts: click a/b, upload u.txt; assert a/b/u.txt exists
  - test-tags: FUNCTIONAL
  - log: 2026-11-06T13:53:20Z @kj added
  - log: 2026-11-06T13:53:37Z @kj new items land in the selected row's folder, as upstream jupyterlab-unfold: Star Colonel decided 2026-11-06
- [ ] `ACC-FOLDER-34-PASTE` **Paste lands in the current folder** - HIGH; after a click on a nested folder, Paste puts the copied items in that folder
  - test: ui-tests/tests/current-folder.spec.ts: copy x.txt, click a/b, paste; assert a/b/x.txt exists
  - test-tags: FUNCTIONAL
  - log: 2026-11-06T13:53:20Z @kj added
  - log: 2026-11-06T13:53:37Z @kj new items land in the selected row's folder, as upstream jupyterlab-unfold: Star Colonel decided 2026-11-06
- [ ] `ACC-FOLDER-35-STOCK` **Unfolding off: clicks keep the folder** - HIGH; with unfolding off, a click on a row leaves model.path unchanged, as in the stock browser
  - test: ui-tests/tests/current-folder.spec.ts: unfolding off, click folder a; assert model.path unchanged
  - test-tags: FUNCTIONAL
  - log: 2026-11-06T13:53:20Z @kj added
- [ ] `ACC-FOLDER-76-BREADCRUMBS` **Breadcrumbs show the current folder** - HIGH; with unfolding on, the breadcrumbs follow model.path: they show the selected folder, and a click on a breadcrumb segment enters that folder
  - test: ui-tests/tests/current-folder.spec.ts: unfold a, click a/b; assert the breadcrumbs end in b; click the root segment; assert the top rows are the root's children
  - test-tags: FUNCTIONAL
  - log: 2026-11-06T14:03:47Z @kj added
  - log: 2026-11-06T14:03:47Z @kj breadcrumbs follow the current folder: Star Colonel decided 2026-11-06

## Actions on nested rows `NESTED`

File browser actions on rows inside unfolded folders act on the item's own path

- log: 2026-11-06T13:53:20Z @kj category created

- [ ] `ACC-NESTED-36-RENAME` **Rename a nested row** - HIGH; Rename on a row inside an unfolded folder renames the item inside that folder
  - test: ui-tests/tests/nested-actions.spec.ts: unfold a, rename a/x.txt to z.txt; assert a/z.txt exists and its row is under a
  - test-tags: FUNCTIONAL
  - log: 2026-11-06T13:53:20Z @kj added
- [ ] `ACC-NESTED-37-DELETE` **Delete a nested row** - HIGH; Delete on a row inside an unfolded folder deletes that item and no other
  - test: ui-tests/tests/nested-actions.spec.ts: x.txt and a/x.txt present, delete a/x.txt; assert x.txt still exists
  - test-tags: FUNCTIONAL
  - log: 2026-11-06T13:53:20Z @kj added
- [ ] `ACC-NESTED-38-MULTI` **Select across levels** - MEDIUM; Shift and Ctrl clicks select rows at different depths, and selectedItems() returns each with its full path
  - test: ui-tests/tests/nested-actions.spec.ts: Ctrl-click x.txt and a/y.txt; assert selectedItems() paths x.txt and a/y.txt
  - test-tags: FUNCTIONAL
  - log: 2026-11-06T13:53:20Z @kj added
- [ ] `ACC-NESTED-39-COPYPATH` **Copy Path of a nested row** - MEDIUM; Copy Path on a nested row copies the item's full path from the server root
  - test: ui-tests/tests/nested-actions.spec.ts: Copy Path on a/b/x.txt; assert clipboard a/b/x.txt
  - test-tags: FUNCTIONAL
  - log: 2026-11-06T13:53:20Z @kj added
- [ ] `ACC-NESTED-40-DOWNLOAD` **Download a nested file** - LOW; Download on a nested file row downloads that file
  - test: ui-tests/tests/nested-actions.spec.ts: Download on a/x.txt; assert the download is named x.txt with its content
  - test-tags: FUNCTIONAL
  - log: 2026-11-06T13:53:20Z @kj added
- [ ] `ACC-NESTED-41-KEYS` **Keyboard through nested rows** - MEDIUM; Up and Down move the selection through rows at every depth in screen order, and Enter opens the selected file
  - test: ui-tests/tests/nested-actions.spec.ts: unfold a, select a, press Down; assert a/x.txt selected; press Enter; assert its tab opens
  - test-tags: FUNCTIONAL
  - log: 2026-11-06T13:53:20Z @kj added

## Unix Style Sorting `SORT`

Migrated from jupyterlab_file_browser_sorting_extension: names in LC_COLLATE=C byte order, switched in the column-header menu

- log: 2026-11-06T13:53:21Z @kj category created

- [ ] `ACC-SORT-42-ITEM` **Menu item** - HIGH; the column-header context menu shows the checkable item Unix Style Sorting
  - test: ui-tests/tests/sorting.spec.ts: right-click .jp-DirListing-header; assert the item Unix Style Sorting
  - test-tags: FUNCTIONAL
  - log: 2026-11-06T13:53:21Z @kj added
- [ ] `ACC-SORT-43-ORDER` **Byte order** - CRITICAL; with the item on, names sort in LC_COLLATE=C byte order: dot files, then 0-9, A-Z, _, a-z
  - test: src/**tests**/sort.spec.ts: sort b, _c, A, .d, 1; assert .d, 1, A, _c, b
  - test-tags: UNIT, FUNCTIONAL
  - log: 2026-11-06T13:53:21Z @kj added
- [ ] `ACC-SORT-44-DIRSFIRST` **Folders first** - HIGH; with the item on, folders come before files in ascending and descending name order
  - test: src/**tests**/sort.spec.ts: folder z and file a; assert z before a in both directions
  - test-tags: UNIT
  - log: 2026-11-06T13:53:21Z @kj added
- [ ] `ACC-SORT-45-NBSECOND` **Notebooks after folders** - MEDIUM; with the item on and Sort Notebooks Above Files on, .ipynb files come after folders and before other files
  - test: src/**tests**/sort.spec.ts: folder d, a.txt, b.ipynb; assert d, b.ipynb, a.txt
  - test-tags: UNIT
  - log: 2026-11-06T13:53:21Z @kj added
- [ ] `ACC-SORT-46-DESC` **Descending name order** - MEDIUM; a second click on the Name header reverses the byte order of files and of folders, folders still first
  - test: src/**tests**/sort.spec.ts: descending; assert b, _c, A, 1, .d among files
  - test-tags: UNIT
  - log: 2026-11-06T13:53:21Z @kj added
- [ ] `ACC-SORT-47-NESTED` **Order inside unfolded folders** - HIGH; the children of every unfolded folder follow the same byte order
  - test: ui-tests/tests/sorting.spec.ts: unfold a holding b, _c, A; assert A, _c, b under a
  - test-tags: FUNCTIONAL
  - log: 2026-11-06T13:53:21Z @kj added
- [ ] `ACC-SORT-48-OFF` **Off restores JupyterLab's order** - HIGH; with the item off, names sort as JupyterLab sorts them
  - test: src/**tests**/sort.spec.ts: item off; assert the order equals JupyterLab's own name sort
  - test-tags: UNIT
  - log: 2026-11-06T13:53:21Z @kj added
- [ ] `ACC-SORT-49-SIZEDATE` **Size and date sort unchanged** - MEDIUM; sorting by File Size or Last Modified follows JupyterLab's direction: ascending File Size puts the smallest file first
  - test: src/**tests**/sort.spec.ts: files of 1, 2, 3 bytes, File Size ascending; assert 1, 2, 3
  - test-tags: UNIT
  - log: 2026-11-06T13:53:21Z @kj added
- [ ] `ACC-SORT-50-DEFAULT` **On by default** - MEDIUM; with no saved setting, Unix Style Sorting is on, as in the replaced extension
  - test: ui-tests/tests/sorting.spec.ts: fresh settings folder; assert the item checked
  - test-tags: FUNCTIONAL
  - log: 2026-11-06T13:53:21Z @kj added
- [ ] `ACC-SORT-51-SAVED` **Choice saved** - MEDIUM; the choice is a setting of this extension and survives a page reload
  - test: ui-tests/tests/sorting.spec.ts: turn the item off, reload; assert it unchecked
  - test-tags: FUNCTIONAL
  - log: 2026-11-06T13:53:21Z @kj added
- [ ] `ACC-SORT-52-LIVE` **Applies at once** - MEDIUM; switching the item re-sorts every open file browser without a page reload
  - test: ui-tests/tests/sorting.spec.ts: toggle the item; assert the new order without a reload
  - test-tags: FUNCTIONAL
  - log: 2026-11-06T13:53:21Z @kj added

## Open in Terminal `TERM`

Migrated from jupyterlab_open_in_terminal_extension: Open in Terminal on a file and on the empty area; core keeps the folder item

- log: 2026-11-06T13:53:21Z @kj category created

- [ ] `ACC-TERM-53-FILE` **Item on a file** - HIGH; right-click on a file row at any depth shows Open in Terminal
  - test: ui-tests/tests/open-in-terminal.spec.ts: right-click x.txt and a/y.txt; assert one Open in Terminal item each
  - test-tags: FUNCTIONAL
  - log: 2026-11-06T13:53:21Z @kj added
- [ ] `ACC-TERM-54-EMPTY` **Item on the empty area** - HIGH; right-click on the empty area below the rows shows Open in Terminal
  - test: ui-tests/tests/open-in-terminal.spec.ts: right-click below the last row; assert the item
  - test-tags: FUNCTIONAL
  - log: 2026-11-06T13:53:21Z @kj added
- [ ] `ACC-TERM-55-FOLDER` **Folder: core item only** - HIGH; right-click on a folder row shows exactly one Open in Terminal, the core terminal:open-folder-in-terminal
  - test: ui-tests/tests/open-in-terminal.spec.ts: right-click folder a; assert one item with the core command id
  - test-tags: FUNCTIONAL
  - log: 2026-11-06T13:53:21Z @kj added
- [ ] `ACC-TERM-56-FILECWD` **File: its own folder** - CRITICAL; on a file, the terminal opens in the file's folder, at any depth
  - test: ui-tests/tests/open-in-terminal.spec.ts: unfold a/b, Open in Terminal on a/b/x.txt, run pwd; assert it ends in a/b
  - test-tags: FUNCTIONAL
  - log: 2026-11-06T13:53:22Z @kj added
- [ ] `ACC-TERM-57-EMPTYCWD` **Empty area: the listing's top folder** - HIGH; on the empty area, the terminal opens in the listing's top folder
  - test: ui-tests/tests/open-in-terminal.spec.ts: Open in Terminal on the empty area, run pwd; assert the top folder
  - test-tags: FUNCTIONAL
  - log: 2026-11-06T13:53:22Z @kj added
- [ ] `ACC-TERM-58-NOSELECT` **Empty area ignores the selection** - MEDIUM; with a folder or a file selected, Open in Terminal on the empty area still opens in the listing's top folder
  - test: ui-tests/tests/open-in-terminal.spec.ts: select a/b, Open in Terminal on the empty area; assert pwd is the top folder
  - test-tags: FUNCTIONAL
  - log: 2026-11-06T13:53:22Z @kj added
- [ ] `ACC-TERM-59-SUBNAV` **After entering a folder** - MEDIUM; after a double-click enters folder a, Open in Terminal on the empty area opens in a
  - test: ui-tests/tests/open-in-terminal.spec.ts: double-click a, Open in Terminal on the empty area; assert pwd ends in a
  - test-tags: FUNCTIONAL
  - log: 2026-11-06T13:53:22Z @kj added
- [ ] `ACC-TERM-60-ROOT` **Edge: file at the server root** - MEDIUM; Open in Terminal on a file at the server root opens the terminal at the server root
  - test: ui-tests/tests/open-in-terminal.spec.ts: Open in Terminal on x.txt at the root; assert pwd is the server root
  - test-tags: FUNCTIONAL
  - log: 2026-11-06T13:53:22Z @kj added
- [ ] `ACC-TERM-61-EMPTYDIR` **Edge: empty folder** - LOW; inside an entered empty folder, right-click on the empty area shows Open in Terminal
  - test: ui-tests/tests/open-in-terminal.spec.ts: double-click empty folder e, right-click the empty area; assert the item
  - test-tags: FUNCTIONAL
  - log: 2026-11-06T13:53:22Z @kj added
- [ ] `ACC-TERM-62-MULTI` **Edge: several items selected** - LOW; with several items selected, Open in Terminal on a file opens in that file's folder
  - test: ui-tests/tests/open-in-terminal.spec.ts: select x.txt and a/y.txt, Open in Terminal on a/y.txt; assert pwd ends in a
  - test-tags: FUNCTIONAL
  - log: 2026-11-06T13:53:22Z @kj added
- [ ] `ACC-TERM-63-NOTERM` **Terminals unavailable** - MEDIUM; when the server has terminals switched off, the command and the menu item are not registered
  - test: src/**tests**/open-in-terminal.spec.ts: terminals.isAvailable() false; assert no command and no menu item
  - test-tags: UNIT
  - log: 2026-11-06T13:53:22Z @kj added
- [ ] `ACC-TERM-64-FAIL` **Creation failure reported** - MEDIUM; a failed terminal:create-new shows the error dialog 'Failed to open new terminal'
  - test: src/**tests**/open-in-terminal.spec.ts: terminal:create-new rejects; assert showErrorMessage called with that title
  - test-tags: UNIT
  - log: 2026-11-06T13:53:22Z @kj added
- [ ] `ACC-TERM-65-LABEL` **Label from the core catalogue** - LOW; the label Open in Terminal comes from the jupyterlab translation catalogue, as core's item
  - test: src/**tests**/open-in-terminal.spec.ts: assert the label is trans.__('Open in Terminal') of the jupyterlab domain
  - test-tags: UNIT
  - log: 2026-11-06T13:53:22Z @kj added
- [ ] `ACC-TERM-66-ICON` **Icon** - LOW; the item shows terminalIcon, as core's item
  - test: src/**tests**/open-in-terminal.spec.ts: assert the command icon is terminalIcon
  - test-tags: UNIT
  - log: 2026-11-06T13:53:22Z @kj added
- [ ] `ACC-TERM-67-CAPTION` **Caption** - LOW; the item tooltip reads 'Open a terminal at this location'
  - test: src/**tests**/open-in-terminal.spec.ts: assert the command caption
  - test-tags: UNIT
  - log: 2026-11-06T13:53:22Z @kj added
- [ ] `ACC-TERM-68-RANK` **Rank** - LOW; the item sits at rank 3 of the file browser context menu, after Open in New Browser Tab
  - test: src/**tests**/open-in-terminal.spec.ts: assert selector .jp-DirListing-content and rank 3
  - test-tags: UNIT
  - log: 2026-11-06T13:53:22Z @kj added

## Coexistence `COMPAT`

What the thirteen separate extensions rely on keeps working beside this one (docs/migration.md)

- log: 2026-11-06T13:53:23Z @kj category created

- [ ] `ACC-COMPAT-69-TOKEN` **Default file browser token provided** - HIGH; with unfolding on and with it off, IDefaultFileBrowser resolves, so extensions that require it activate
  - test: ui-tests/tests/compat.spec.ts: resolve IDefaultFileBrowser in the page in both switch states
  - test-tags: FUNCTIONAL
  - log: 2026-11-06T13:53:23Z @kj added
- [ ] `ACC-COMPAT-70-MARKUP` **Stock row markup** - HIGH; rows at every depth carry .jp-DirListing-item with data-isdir and data-file-type, .jp-DirListing-itemIcon and .jp-DirListing-itemText
  - test: ui-tests/tests/compat.spec.ts: unfold a; assert the markup on the a/x.txt row
  - test-tags: FUNCTIONAL
  - log: 2026-11-06T13:53:23Z @kj added
- [ ] `ACC-COMPAT-71-HANDLEOPEN` **Open goes through handleOpen** - MEDIUM; a double-click on a file row calls the listing's handleOpen, so a replacement of that method still runs
  - test: ui-tests/tests/compat.spec.ts: replace listing.handleOpen in the page, double-click a/x.txt; assert the replacement ran
  - test-tags: FUNCTIONAL
  - log: 2026-11-06T13:53:23Z @kj added
- [ ] `ACC-COMPAT-72-CD` **model.cd still enters a folder** - HIGH; model.cd() and filebrowser:go-to-path enter the folder, as in the stock browser
  - test: ui-tests/tests/compat.spec.ts: run filebrowser:go-to-path a/b; assert the top rows are the children of a/b
  - test-tags: FUNCTIONAL
  - log: 2026-11-06T13:53:23Z @kj added
- [ ] `ACC-COMPAT-73-ITEMS` **selectedItems and sortedItems at every depth** - MEDIUM; selectedItems() and sortedItems() return items of every depth with their full paths
  - test: src/**tests**/tree-model.spec.ts: unfold a; assert sortedItems() holds a/x.txt in screen order
  - test-tags: UNIT
  - log: 2026-11-06T13:53:23Z @kj added
- [ ] `ACC-COMPAT-74-PATCHES` **Column-width patch** - MEDIUM; with jupyterlab_core_patches_extension installed, the listing renders and its columns resize with unfolding on
  - test: ui-tests/tests/compat.spec.ts in a venv holding both extensions: unfold a, drag a column edge; assert the width changes
  - test-tags: FUNCTIONAL
  - log: 2026-11-06T13:53:23Z @kj added
- [ ] `ACC-COMPAT-75-REPLACED` **Replaced extensions still installed** - MEDIUM; with jupyterlab_file_browser_sorting_extension and jupyterlab_open_in_terminal_extension installed beside this one, every extension activates and no command id is registered twice
  - test: ui-tests/tests/compat.spec.ts in a venv holding all three: assert no activation error in the console
  - test-tags: FUNCTIONAL
  - log: 2026-11-06T13:53:23Z @kj added
