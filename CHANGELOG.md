# Changelog

<!-- <START NEW CHANGELOG ENTRY> -->

## [1.0.12] - 2026-11-23

### Fixed

- Elapsed kept growing while a copy or move was paused and dropped back after Retry; it now holds during the pause (DEF-COPY-47-ELAPSED-JUMP)

## [1.0.11] - 2026-11-23

### Added

- A copy or move to another volume writes in 256 MiB chunks and syncs each chunk to disk, so a large file sent to a soft NFS share no longer fails with a read or write error
- A read or write error pauses the copy or move and offers Cancel, Skip file and Retry; Retry goes on from the last synced chunk, and a pause nobody answers for 180 s skips the file
- A partial copy the share does not let the job remove is reported as "partial copy left", with its destination path
- The Move to Trash button of the Delete dialog shows a trash can icon
- The README shows six screenshots of the main features

### Changed

- The Delete dialog offers Cancel, Delete and Move to Trash, left to right; the permanent button is labelled Delete, and with the trash on the question names both outcomes
- The copy and move status item sits in the right-hand group of the status bar
- The progress dialog focuses Hide only after the Tab key is pressed
- The cross-volume note reads "Cross-volume copy, may be slower" or "Cross-volume move, may be slower"
- A failure without a reason of the extension's own shows the operating system's text instead of "reason unknown"
- The copy route makes its file system checks on a worker thread, so a stalled network mount does not hold the server
- A copy or move hidden in the status bar when it pauses goes back to the status bar after Retry or Skip file
- The README is shorter and lists every setting in one table

### Fixed

- A move that failed with a read or write error showed "reason unknown"; it now shows "read or write error" (DEF-COPY-42-MOVE-REASON)
- The Delete dialog showed Delete Permanently, Cancel and Move to Trash in that order (DEF-DELETE-43-BUTTON-ORDER)
- A Retry pressed while the share still failed ended the file instead of pausing again
- Time spent paused counted toward Elapsed, so Speed and Left read wrong after Retry (DEF-COPY-45-PAUSE-ELAPSED)
- A screen reader did not announce the pause reason, and the focused progress dialog had no name (DEF-COPY-46-PAUSE-ALERT)

## [1.0.10] - 2026-11-22

### Added

- A copy or move still running after 1 second, from a Paste after Copy or Cut or from a drag onto a folder, shows a progress dialog with a total bar, a bar for the current file, counters for files, bytes, speed, elapsed time and time left, and a one-line warning when it goes to another volume
- Cancel stops the copy or move, keeps the files already finished and removes the partial file
- Hide or Escape moves the operation to one status bar item; a click on the item opens the dialog again, or a menu of the operations when several run in parallel
- A second copy or move runs in parallel with the first and hides the dialog of the first
- Narrow windows drop parts of the dialog, the status bar item and the menu step by step, down to a 320 px window

### Changed

- Copies and moves to another volume run as server jobs in a worker thread, one per operation, so the interface does not freeze; a move on one volume stays a stock rename, and volumes are judged by device and mount, so bind mounts of one disk count as separate volumes
- Paths on `zip:` and other drives keep the stock copy and rename calls, and their refusals are reported

## [1.0.9] - 2026-11-20

### Added

- A Galata test measures how soon a file written on disk shows in an unfolded folder, on the visible page and on return to the page

### Changed

- Returning to the JupyterLab page refreshes every file browser at once, so a file added while the page was hidden shows on return instead of after the next 10 s poll

### Fixed

- An unfolded folder whose contents read fails with an error other than 404 keeps its rows instead of showing an empty folder (DEF-UNFOLD-41-READ-ERROR)

## [1.0.8] - 2026-11-20

### Added

- Folder unfolding is on by default for a fresh JupyterLab; a saved setting keeps its value
- The folder tree exposes its fold state to assistive technology: the row name node carries `aria-expanded` true on an unfolded folder and false on a folded folder, and no row carries it when unfolding is off
- A Galata test proves the hover tooltip on file and folder rows and inside an unfolded folder

### Changed

- Move to Trash is a red warn button like Delete Permanently, and the Delete dialog orders the confirm buttons Delete Permanently, Cancel and Move to Trash so the destructive action stands away from the default
- The tree's Move to Trash action is identified by the button the dialog returned, not by its translated label
- The Galata suite runs at eight workers outside CI; a worker per spec file pushed page starts past Galata's 15 s app-start wait
- The compat spec sets the unfolding state it tests, and the crumbs spec probes favourites in the running lab

### Fixed

- A Move to Trash click could be routed to permanent deletion if the trash button's label changed; the action now follows the button object
- The shared Playwright browser store held no build every Galata run needed

## [1.0.7] - 2026-11-18

### Added

- A new folder, file or notebook shows in the listing as soon as the server confirms the create, in its sorted place, and its rename editor opens after one read of its own folder
- Delete of a `.ipynb_checkpoints` folder removes it, and no Delete leaves a new empty `.ipynb_checkpoints` folder behind

### Changed

- A Paste, Duplicate or drag-copy answer joins or queues behind the create read of its own folder, kept per folder; a create answered in another folder between Paste answers no longer starts a second read of the unfolded folder

### Fixed

- The extra listing read a create in another folder caused between Paste answers into an unfolded folder (DEF-FOLDER-39-PASTE-READ)
- The held-read Galata case takes its release from the test after the editor appears, so it no longer fails its own premise under load

## [1.0.6] - 2026-11-16

### Added

- With the server's trash on, the Delete dialog offers Cancel, Delete Permanently and Move to Trash, and Move to Trash is the default; with the trash off, it offers Cancel and Delete
- Move to Trash moves only the items whose trash the trash management extension monitors; a selection with unmonitored items asks about those in a second dialog after Move to Trash, and the server option `c.AdvancedFileBrowser.trash_on_all_volumes` offers Move to Trash for every item
- A selection larger than 10 GiB shows a warning that moving large files to the trash is not advised
- A removal still running after 1 second shows a progress dialog with a spinner and a progress bar, and its Hide button keeps the removal running
- The server logs one start line when the `jupyterlab_core_patches_extension` delete fix is not installed or its switch is off

### Fixed

- Move to Trash of many items runs in a worker thread, so the server keeps answering requests and kernel messages while the items move

## [1.0.4] - 2026-11-12

### Added

- Drag a file, folder or breadcrumb from the file browser onto a terminal, Python file, other editor or notebook to insert its path; terminal paths are shell-escaped or single-quoted, Python targets receive a string literal or a `pathlib` expression, and a notebook drop lands in the cell under the pointer
- Six settings under Advanced File Browser: the master switch, relative or absolute paths, the Python style and constructor, the terminal separator and quoting
- The authenticated `terminal-cwd` route reports a terminal's working directory for relative paths

### Changed

- The extension replaces three extensions; `jupyterlab_drag_and_drop_path_extension` joins the two retired earlier, and folder unfolding, Unix Style Sorting and Open in Terminal now share one package with drag-and-drop path insertion

## [1.0.3] - 2026-11-10

### Changed

- The version moves to the 1.x line; no functional change since 0.8.6

## [0.8.6] - 2026-11-10

### Changed

- With unfolding on, the file browser's rows use half the stock left padding, so the tree shows its depth with less empty space at the left edge; unfolding off keeps the stock spacing

## [0.8.5] - 2026-11-09

### Added

- Fold and unfold animate over a short interval; the motion runs regardless of the operating system reduced-motion setting

### Changed

- With unfolding on, a folder's children always render directly below it, so unfolding keeps the folder and every row under the pointer in place, even while the replaced sorting extension is still installed
- Folding a folder clears the expansion state of the folders below it, so unfolding the folder again shows them closed
- Holding ArrowLeft folds the focused folder once instead of alternating fold and cancel
- A fold cancelled mid-animation reverses from its live padding and opacity instead of snapping

### Fixed

- Clicking a folder triangle toggled a different folder than the clicked one (DEF-UNFOLD-26-TOGGLE-WRONG)
- Unfolding a folder moved it out of view (DEF-UNFOLD-27-SCROLL-JUMP)
- Unfolding one folder opened folders that were not clicked (DEF-UNFOLD-28-EXTRA-UNFOLD)
- Unfolding a top folder unfolded the folders below it (DEF-UNFOLD-29-TOP-UNFOLD)

## [0.1.2] - 2026-11-09

### Added

- Folder unfolding: a triangle on each folder row folds or unfolds the folder in place as a tree; a double-click on a folder still enters it
- Unfolding switch in the file browser column-header context menu
- Unix Style Sorting in `LC_COLLATE=C` byte order, folders first, also inside unfolded folders
- Open in Terminal on a file, on the empty area, and on a file inside an unfolded folder
- With unfolding on, Copy, Cut, Delete and drag act on the outermost selected folders only

### Changed

- A change of the current folder by click, arrow key or empty-area press no longer re-sorts the rows

### Fixed

- A folder dropped inside itself sends no copy or move
- Paste never puts a folder into itself, and a folder skipped that way stays on the clipboard for a later Paste
- A Copy or Cut during a pending Paste keeps the newer clipboard, on shipped JupyterLab 4.6.5 as well
- A press on the file browser scrollbar keeps the selection and the current folder

<!-- <END NEW CHANGELOG ENTRY> -->
