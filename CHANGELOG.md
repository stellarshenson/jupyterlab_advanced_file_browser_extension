# Changelog

<!-- <START NEW CHANGELOG ENTRY> -->

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
