# Changelog

<!-- <START NEW CHANGELOG ENTRY> -->

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
